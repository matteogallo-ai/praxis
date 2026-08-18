# Praxis cookbook — ten recipes

Concrete recipes for the ten highest-frequency things you might
do with Praxis, from adding a new format to interpreting a
critique. Each recipe is a short context + copy-paste block +
notes on edge cases.

For the narrated API reference see `docs/api.md`. For the
end-to-end 5-minute walkthrough see `docs/getting-started.md`.

---

## 1. Add a new briefing format

**Context.** Every format is a YAML file under `formats/`. The
validator enforces the schema at load time.

```yaml
# formats/family-office-memo.yaml
id: family-office-memo
name: Family Office Investment Memo
version: 1.0.0
metadata:
  author: Your Name
  organization_style: family-office
  language: en
  last_reviewed: 2026-10-01
target_length:
  pages: 3
  words: 1200
sections:
  - id: thesis
    title: Investment thesis
    purpose: State the single asymmetric bet the memo argues for.
    max_length:
      words: 200
    required_agents:
      - scoping
      - research
    tone_directives: crisp, confident, first-person plural.
sourcing_policy: strict
style_guide:
  voice: measured, non-hyperbolic
  sentence_structure: short declarative
  forbidden_terms:
    - "obviously"
    - "clearly"
output_targets:
  - md
  - pdf
```

Validate then use:

```bash
bun run cli formats validate formats/family-office-memo.yaml
bun run cli brief "Take a position in X?" --format family-office-memo --full
```

**Notes.** `id` must be kebab-case. `sourcing_policy: strict`
means missing sources throw; `permissive` records them as
warnings. Add `sourcing_rules.editorial` if you want the v0.8
strict-editorial retry loop (see recipe 4).

---

## 2. Add a new LLM provider

**Context.** `LLMProvider` is a two-method interface. Any
service with an HTTP JSON API can back it — the shipped
`AnthropicLLMProvider` is 200 lines of `fetch`.

```ts
import type {
  LLMProvider,
  CompleteOptions,
  CompletionResult,
  Tool,
} from "praxis";

export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";

  async complete(prompt: string, _opts?: CompleteOptions): Promise<string> {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env["OPENROUTER_API_KEY"]}`,
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
    const j = await r.json() as { choices: [{ message: { content: string } }] };
    return j.choices[0].message.content;
  }

  // Optional: only implement if the provider supports tool use.
  async completeWithTools(
    _prompt: string,
    _tools: Tool[]
  ): Promise<CompletionResult> {
    throw new Error("Tool use not supported by this provider.");
  }
}
```

Pass it to the Orchestrator:

```ts
const orch = new Orchestrator(registry, new OpenRouterProvider());
```

**Notes.** Agents that don't need tools (Scoping, Stakeholders,
Risks, Options, Synthesis) call `complete()`. Research and
Adversarial can call `completeWithTools()` for `web_search`; if
your provider has no tool support they fall back to `complete()`
with an empty tool list.

---

## 3. Embed Praxis as a library in a TypeScript project

**Context.** `src/index.ts` is the v1.0 stable API surface.

```ts
import {
  FormatRegistry,
  AnthropicLLMProvider,
  Orchestrator,
  PraxisError,
} from "praxis";

const registry = new FormatRegistry();
registry.loadDirectory("formats");

const orch = new Orchestrator(registry, new AnthropicLLMProvider());

try {
  const out = await orch.briefWithCritiqueAndRerun(
    "Should we enter the German market?",
    "executive-pre-read"
  );
  console.log(out.synthesis.total_word_count, "words");
  if (out.rerun_performed) {
    console.log("rerun addressed:", out.rerun_metadata.critiques_addressed);
  }
} catch (e) {
  if (e instanceof PraxisError) console.error(e.name, e.message);
  else throw e;
}
```

**Notes.** Every method returns pure JSON — safe to serialise,
log, or diff. `catch (e instanceof PraxisError)` catches every
typed failure the library declares.

---

## 4. Configure strict_editorial mode for institutional formats

**Context.** In v0.7 forbidden-terms hits were soft warnings.
v0.8 adds an opt-in reject/regenerate mode per format.

```yaml
# In your format's YAML:
sourcing_rules:
  editorial:
    strict_editorial: true
    max_regeneration_attempts: 3   # 1..3, default 2
    forbidden_terms_action: reject
    over_length_action: warn
    validation_rules_action: reject
```

Under `strict_editorial: true`, each section runs up to
`max_regeneration_attempts` LLM calls. A `"reject"`-action
failure triggers a retry with a `STRICT EDITORIAL RETRY` prompt
block; exhausted retries raise `EditorialFailureError`.

**Notes.** `strict_editorial: false` (the default) collapses all
actions to `"warn"` regardless of the individual settings. See
`docs/editorial-loop.md` for the mechanics.

---

## 5. Interpret a SourcingReport

**Context.** Every brief ships a `sourcing_report` aggregating
every source the pipeline inspected. Read it top-down.

```ts
const rep = out.sourcing_report;

// Big picture.
console.log(`total inspected: ${rep.total_items}`);
console.log(`policy: ${rep.policy}`);   // "strict" or "permissive"
console.log(`ok=${rep.counts.ok} stale=${rep.counts.stale} `+
            `untrusted=${rep.counts.untrusted} `+
            `duplicated=${rep.counts.duplicated} `+
            `missing=${rep.counts.missing}`);

// Per-warning drill-down.
for (const w of rep.warnings) {
  if (w.kind === "stale_source") console.log(`stale: ${w.url} (${w.age_days}d)`);
  if (w.kind === "untrusted_domain") console.log(`untrusted: ${w.url} — ${w.reason}`);
  if (w.kind === "missing_source") console.log(`missing @${w.finding_index}`);
}
```

**Notes.** `edited_after_critique: true` on a v0.8 rerun payload
means the Synthesis was re-invoked. The counts are cumulative
across all seven agents.

---

## 6. Debug a briefing that fails EditorialFailureError

**Context.** Raised when a section under `strict_editorial: true`
exhausts its retries. The error carries the full attempt history.

```ts
try {
  await orch.briefWithCritiqueAndRerun(question, formatId);
} catch (e) {
  if (e instanceof EditorialFailureError) {
    console.error(`Section '${e.sectionId}' failed on ${e.reason}`);
    for (const attempt of e.attempts) {
      console.error(`  attempt ${attempt.attempt_number}: ${attempt.details}`);
    }
  }
}
```

Fix options, easiest to hardest:

1. Bump `max_regeneration_attempts` (ceiling: 3).
2. Change the offending `*_action` from `"reject"` to `"warn"`.
3. Loosen the format's `forbidden_terms` list or
   `validation_rules`.
4. Rework the section's `tone_directives` / `purpose` so the LLM
   can satisfy the rules without going over-length.

**Notes.** Under warn mode, the same failure surfaces in
`synthesis.format_conformance.forbidden_terms_found[]` without
stopping the pipeline.

---

## 7. Interpret adversarial critiques

**Context.** The Adversarial agent produces 3–15 critiques over
eight taxonomy categories, each with a severity in `minor |
material | critical`.

```ts
const adv = out.adversarial;

console.log(`robustness: ${adv.recommendation_robustness}`);
console.log(`critical=${adv.critical_count} `+
            `material=${adv.material_count} `+
            `minor=${adv.minor_count}`);

for (const c of adv.critiques) {
  if (c.severity !== "minor") {
    console.log(`[${c.severity}] ${c.category}: ${c.steelmanned_position}`);
    console.log(`  → suggested: ${c.suggested_revision}`);
  }
}

if (adv.revised_recommendation_needed) {
  console.log(`revised alternative: ${adv.steelmanned_alternative}`);
}
```

**Notes.** `revised_recommendation_needed` is a DERIVED signal:
true iff ≥1 critical OR ≥3 material critiques. If true,
`steelmanned_alternative` is guaranteed non-null (the parser
enforces this).

---

## 8. Chain multiple briefings in a script

**Context.** The Orchestrator is stateless; running N briefings
is just N calls.

```ts
import { readFileSync } from "node:fs";
import { parseYaml } from "@promptlang/yaml-parser";

const questions = parseYaml(readFileSync("questions.yaml", "utf-8")) as {
  benchmarks: { id: string; question: string; format: string }[];
};

for (const b of questions.benchmarks) {
  try {
    const out = await orch.brief(b.question, b.format);
    console.log(`${b.id}: ${out.synthesis.total_word_count} words`);
  } catch (e) {
    console.error(`${b.id}: FAILED — ${e instanceof Error ? e.message : e}`);
  }
}
```

**Notes.** Live runs are IO-bound on the LLM API; parallelising
with `Promise.all()` hits rate limits fast. Sequential with a
short `sleep` between calls is the polite pattern.

---

## 9. Use --with-rerun and inspect the audit trail

**Context.** The v0.8 rerun loop preserves the pre-rerun
synthesis under `original_synthesis` for audit.

```ts
const out = await orch.briefWithCritiqueAndRerun(question, formatId);

if (!out.rerun_performed) {
  console.log("No rerun — the critique did not require a revision.");
  return;
}

console.log("=== BEFORE ===");
for (const s of out.original_synthesis!.sections) {
  console.log(`# ${s.title}\n${s.content_markdown}\n`);
}

console.log("=== AFTER ===");
for (const s of out.synthesis.sections) {
  console.log(`# ${s.title}\n${s.content_markdown}\n`);
}

console.log("Deviations:", out.rerun_metadata!.re_synthesis_deviations);
```

**Notes.** Deviations are section IDs whose text changed
substantially (word-count delta > 20% OR normalised Levenshtein
> 0.30). The public helper
`computeReSynthesisDeviations(orig, rerun)` runs the same
diagnostic on any two `SynthesisResult` values.

---

## 10. Generate benchmarks for your own use case

**Context.** `benchmarks/questions.yaml` is a manifest; the
runner turns each entry into `brief.md` + `brief.pdf` +
`brief.docx` + `metadata.json`.

```yaml
# benchmarks/questions.yaml — add your entry to the list
- id: "11-my-portfolio-review"
  question: "Should we rebalance the Asia allocation?"
  format: "family-office-memo"
  tags:
    - portfolio
    - asia
  intent: "Quarterly rebalancing brief for the investment committee."
```

Then:

```bash
bun run bench:mock         # mock provider — always green
bun run bench:live         # live provider — needs ANTHROPIC_API_KEY
bun run bench              # both if the key is set
```

**Notes.** The shipped v0.9 set is capped at 10 benchmarks for
release-scope reasons. In your own fork you can grow it; if you
want a schema check, mirror `tests/benchmarks/questions-schema.test.ts`
against the new size.

---

## 11. Score your own briefings against the calibrated rubric

**Context.** v0.10 ships `benchmarks/score-all.ts` — an
AI-assisted scorer that grades every briefing under
`benchmarks/outputs/*/` on the 7-criterion rubric in
`benchmarks/scoring-prompt.txt`. Uses Claude Sonnet 4.5, same
model as the pipeline. Full methodology, biases, and budget:
[`docs/benchmarking-methodology.md`](benchmarking-methodology.md).

Prerequisites: `ANTHROPIC_API_KEY` in `.env` (gitignored) or
exported.

```bash
# Enumerate what will be scored; no API call, no cost.
bun run score:dry

# Score every mock briefing on disk.
bun run score:mock

# Score every live briefing on disk (requires bench:live first).
bun run score:live

# Score both.
bun run score

# Bypass the 24h cache for a single slug.
bun run benchmarks/score-all.ts --refresh 01-german-market-entry
```

Each run rewrites the "AI-Assisted Qualitative Scoring" block in
`benchmarks/RESULTS.md` (the "Automated objective checks" block
above it is preserved verbatim). The scorer output payload is
cached under `benchmarks/.scoring-cache/{slug}-{mode}.json`
(gitignored) with a 24h TTL — re-running within the day is free.

For your own briefings (outside the shipped 10), the scorer
picks up any directory under `benchmarks/outputs/{mock,live}/`
that contains both `brief.md` and `metadata.json`. Add yours
with the same layout, run `bun run score`, done.

**Notes.**

- The rubric assumes 7 criteria × 1–5 = total /35. Do not add or
  remove criteria without also updating the prompt, the parser,
  and the tests.
- Same-family scoring bias is real (Claude scoring Claude
  output). Interpret **deltas** (mock-vs-live, release-vs-release)
  more than absolute scores. See methodology doc.
- Formats whose `output_targets[]` do not declare `md` skip
  scoring in v0.10.0 (no `brief.md` on disk). v0.10.1 will emit
  a scoring-source text artefact to close this gap.
