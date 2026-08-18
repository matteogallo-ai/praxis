# Praxis

**Praxis** is an open-source multi-agent system that produces analytical
briefings — executive pre-reads, position papers, McKinsey-style notes,
family-office memos — in the exact codes of the target organization. The
differentiator is not "we use multiple agents" but the **format
discipline enforced upstream**: the briefing arrives already shaped like
the organization's own analysts wrote it, with rigorous sourcing and a
consistent voice. That is 80% of what a senior reader values.

The current release, **v0.6 — Options Generation agent + Synthesis
agent + `brief()` implemented**, is the release where Praxis
crosses from "pipeline components" to "pipeline output". Three
tightly coupled bricks land together: the fifth agent (Options,
first to consume all four prior artefacts), the sixth agent
(Synthesis, which assembles the final briefing text respecting the
format's tone directives / max_length / forbidden_terms /
validation_rules), and `Orchestrator.brief()` — the
`NotImplementedError` stub that has been in the code since v0.2 is
finally replaced by the real six-agent pipeline that rolls the
first complete, sourced, format-conformant briefing off the
assembly line.

New CLI:

```
praxis brief "<question>" --format executive-pre-read --full
praxis brief "<question>" --format executive-pre-read --full --output brief.md
praxis brief "<question>" --format executive-pre-read --full --with-sourcing-report
praxis brief "<question>" --format executive-pre-read --full --json
```

Sample output (truncated, mock provider):

```
---
question: "Should we enter the German market?"
format: "executive-pre-read"
provider: "mock"
generated_at: "2026-08-18T..."
recommended_option: "OPT-A"
aggregated_risk: "high"
sourcing_summary: "total=29 ok=28 stale=0 untrusted=0 duplicated=1 missing=0"
total_word_count: 338
target_word_count: 800
word_deviation_pct: -57.8
---

# Should we enter the German market?

## Context

German mid-market SaaS grew 12% CAGR between 2022 and 2025 …

## Recommendation

Enter Germany in Q1 2027 via a bounded greenfield office capped at
15 staff for year one, owned by the Head of EMEA Sales with a
first-referenceable-customer milestone at month nine …

## Risks and Mitigations

SAP's likely bundled counter-offer is the largest strategic risk …
```

Highlights:

- Everything from v0.1 (Format Registry), v0.2 (Scoping agent,
  Orchestrator), v0.3 (Research agent, AnthropicLLMProvider,
  embryonic sourcing), v0.4 (Stakeholder Mapping agent), and v0.5
  (Risk Analysis agent + hardened sourcing).
- **Options Generation agent** — reads Scoping + Research +
  Stakeholders + Risks, calls `web_search` for precedent, produces
  2-4 mutually-exclusive options with concrete tradeoff dimensions
  (vague labels like `pros`/`cons` are structurally rejected),
  cross-referenced stakeholder impact and risk implications, and
  exactly one `recommended` option. Prompt:
  [`prompts/options.prompt`](prompts/options.prompt). Design guide:
  [`docs/options.md`](docs/options.md).
- **Synthesis agent** — one LLM call per format section (no tool
  use — synthesis does not add facts). Per-section validation
  against `tone_directives`, `max_length`, `validation_rules`, and
  format-level `forbidden_terms`. Fabricated URLs are structurally
  forbidden (any cited URL absent from the upstream artefacts
  raises `SynthesisError`). Prompt:
  [`prompts/synthesis.prompt`](prompts/synthesis.prompt). Design
  guide: [`docs/synthesis.md`](docs/synthesis.md).
- **`Orchestrator.brief()` implemented** — six-agent pipeline
  end-to-end with a single `SourcingAccumulator` threaded through
  every sourcing validation. Returns a `BriefResult` (all six
  artefacts + aggregated `sourcing_report` + audit metadata).
- **CLI `--full` + `--output` + `--with-sourcing-report`** —
  produces a self-contained Markdown briefing with YAML
  front-matter (question, format, provider, generated_at,
  recommended option, aggregated risk, sourcing summary,
  word-count deviation).
- **Risk Analysis agent (v0.5)** — reads Scoping + Research + Stakeholders,
  calls the Anthropic `web_search` tool for precedent and
  benchmarks, produces a `RiskAnalysisResult` with 5-15 risks (hard
  cap 25). Each risk carries category / likelihood / impact /
  timeframe, sourced likelihood AND impact evidence (real
  `SourceReference` OR explicit `SOURCE_MISSING`), a cross-reference
  to at least one stakeholder from the mapping by exact name, 1-3
  concrete mitigations, and a residual-risk estimate. Also emits an
  aggregated overall / by-category score and top-3 priorities.
  Prompt: [`prompts/risk.prompt`](prompts/risk.prompt). Design
  guide: [`docs/risks.md`](docs/risks.md).
- **Hardened Sourcing & Verification Layer** — the v0.3-v0.4
  embryonic layer is promoted to a production-grade transverse layer:
  - **Freshness gates** — per-format `max_source_age_days` and
    `warn_after_days`. Sources past max raise `StaleSourceError`
    under strict.
  - **Domain trust bands** — per-format `allow-list`, `deny-list`,
    or `reputation-only` tiered mode, with wildcard host matching
    (`*.gov`, `gov.*`, `*.gov.uk`). Raises `UntrustedDomainError`
    under strict.
  - **Cross-agent dedupe** — pipeline-scoped `SourcingAccumulator`
    with URL normalisation (strip UTM/fragments, sort query params)
    and Levenshtein similarity threshold. Duplicates are warning-only
    by default.
  - **Aggregated `SourcingReport`** with per-category counts
    (`ok / stale / untrusted / duplicated / missing`) that reconciles
    with `total_items`. See [`docs/sourcing.md`](docs/sourcing.md).
- **Format schema extension** — optional `sourcing_rules` block on
  every format. Absent → v0.4 behaviour. Present → hardened rules
  apply. All three shipped formats now declare rules calibrated to
  their genre (executive pre-read: 2-year freshness, tier-2
  reputation; corporate position paper: 3-year freshness, strict
  allow-list; McKinsey note: 18-month freshness, tier-2 with
  strategy-consultancy tier).
- **Orchestrator** — new `assessRisksAfterStakeholders()` chains the
  four agents end-to-end and returns
  `{ scoping, research, stakeholders, risks, sourcing_report }`.
- **CLI extension** —
  `praxis brief "<question>" --format <id> --with-risks
   [--provider mock|anthropic] [--json]` runs the full four-agent
  pipeline. Add `--sourcing-report` to print ONLY the aggregated
  cross-agent report (implies `--with-risks`; the pipeline is what
  produces the report).

The test suite still runs offline by default (`MockLLMProvider`); live
integration tests live under [`tests/live/`](tests/live/README.md) and
run only when `ANTHROPIC_API_KEY` is set.

---

## Install

Praxis runs on [Bun](https://bun.sh) 1.3+.

```bash
git clone https://github.com/matteogallo-ai/praxis.git
cd praxis
bun install
```

**Development setup.** Praxis depends on the sibling PromptLang checkout.
Before `bun install`, clone PromptLang next to Praxis:

```
~/dev/
├── praxis/        ← this repo
└── promptlang/    ← must exist at this exact relative location
```

`package.json` declares
`"@promptlang/yaml-parser": "file:../promptlang/packages/yaml-parser"`
and `tsconfig.json` maps the `promptlang/*` import prefix to
`../promptlang/src/*`. Both paths resolve against the sibling checkout.
See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contributor
walkthrough. This constraint disappears once PromptLang publishes to
npm — Praxis will switch to `"promptlang": "^1.x"` in `dependencies`.

---

## CLI usage

### `praxis version`

```
$ bun run cli version
praxis v0.6.0
```

### `praxis formats list`

Prints every registered format as a table. Add `--org-style <style>` to
filter (values: `pwc`, `mckinsey`, `bcg`, `family-office`,
`corporate-affairs`, `government`, `generic`).

```
$ bun run cli formats list
ID                        Name                              Org Style          Language  Pages  Version
------------------------  --------------------------------  -----------------  --------  -----  -------
executive-pre-read        Executive Pre-Read                generic            en        2      1.0.0
mckinsey-style-note       McKinsey-Style Note               mckinsey           en        3      1.0.0
position-paper-corporate  Corporate Affairs Position Paper  corporate-affairs  en        4      1.0.0

3 formats registered.
```

### `praxis formats inspect <format-id>`

Renders the full format tree — metadata, sections, style guide, sourcing
policy, output targets.

### `praxis formats validate <path/to/file.yaml>`

Parses and validates any YAML file against the Format schema. Exit code 0
on success, 1 on failure with every issue listed.

### `praxis brief "<question>" --format <id>`

Runs the Scoping agent by default. Add flags to chain further
agents; each flag implies the earlier ones:

```bash
# scoping only
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read

# scoping + research
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --with-research

# scoping + research + stakeholder mapping (v0.4)
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --with-stakeholders

# scoping + research + stakeholders + risk analysis (v0.5)
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --with-risks

# audit view: aggregated cross-agent sourcing report only (v0.5)
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --sourcing-report

# full brief — six-agent pipeline, Markdown output (v0.6)
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --full

# full brief, written to a file (v0.6)
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --full --output /tmp/brief.md

# full brief with the aggregated sourcing report appended (v0.6)
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --full --with-sourcing-report

# full brief as JSON for audit / downstream tooling (v0.6)
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --full --json
```

Flags:

- `--format <id>` — required. Format id from the registry.
- `--with-research` — optional. Runs Scoping + Research; prints both.
  Enforces the format's `sourcing_policy` on the research findings.
- `--with-stakeholders` — optional. Runs the three-agent pipeline.
  Implies `--with-research`. Prints a compact ANSI stakeholder table
  plus per-stakeholder details.
- `--with-risks` — optional. Runs the four-agent pipeline
  (Scoping + Research + Stakeholders + Risks). Implies
  `--with-stakeholders`. Prints a compact ANSI risk table, aggregated
  score, top-3 priorities, per-risk details, and the aggregated
  cross-agent sourcing report at the end.
- `--sourcing-report` — optional. Prints ONLY the aggregated
  cross-agent sourcing report (implies `--with-risks`).
- `--full` — optional. Runs the full six-agent pipeline (Scoping +
  Research + Stakeholders + Risks + Options + Synthesis) and prints
  the assembled Markdown briefing. See `docs/options.md` and
  `docs/synthesis.md`.
- `--output <path>` — optional, requires `--full`. Writes the
  Markdown to a file instead of stdout; a one-line confirmation
  lands on stderr.
- `--with-sourcing-report` — optional. Appends the aggregated
  sourcing report (as Markdown) beneath the briefing when used with
  `--full`.
- `--provider <name>` — optional. Values: `mock` (default, fixture-driven)
  and `anthropic` (live API; requires `ANTHROPIC_API_KEY`).
- `--json` — optional. Prints raw JSON only, for piping. Under
  `--with-risks`, emits
  `{ scoping, research, stakeholders, risks, sourcing_report }`.

---

## Configuring providers

Praxis ships two providers:

| Provider | When to use | Requires |
| --- | --- | --- |
| `mock` (default) | tests, offline runs, deterministic demos | fixtures under `tests/fixtures/mock-llm/` |
| `anthropic` | live briefings, real web search | `ANTHROPIC_API_KEY` env var; optional `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`) |

Copy the example env file and fill in your key:

```bash
cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is git-ignored; **never commit a real key.** Praxis reads
`ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) via
`process.env` at provider construction time.

Selecting the live provider from the CLI:

```bash
bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --with-research \
    --provider anthropic
```

Cost model, retry policy, and the "add-a-provider" walkthrough live in
[`docs/providers.md`](docs/providers.md).

### Testing

`bun test` runs the full offline suite (fixture-driven, no network,
zero cost). Live integration tests are opt-in:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun test tests/live/
```

Live tests self-skip when `ANTHROPIC_API_KEY` is unset. See
[`tests/live/README.md`](tests/live/README.md).

---

## Architecture

v0.6 completes the six-agent pipeline. `Orchestrator.brief()` runs
Scoping → Research → Stakeholders → Risks → Options → Synthesis with
a single `SourcingAccumulator` threaded through every sourcing
validation, and returns a `BriefResult` that carries all six
artefacts, the aggregated cross-agent sourcing report, and audit
metadata:

```
                      ┌─────────────────────────┐
                      │  Format Registry (v0.1) │
                      └───────────┬─────────────┘
                                  │
                      ┌───────────▼──────────────────────────┐
                      │            Orchestrator              │
                      │  scope() /                           │
                      │  researchAfterScoping() /            │
                      │  mapStakeholdersAfterResearch() /    │
                      │  assessRisksAfterStakeholders() /    │
                      │  brief()  ← v0.6, six-agent pipeline │
                      └───────────┬──────────────────────────┘
                                  │
              ┌───────────────────┴──────────────────────────────┐
              │                                                  │
   ┌──────────▼──────────────────────────────┐    ┌──────────────▼───────────────┐
   │  Scoping → Research → Stakeholder →     │◀───│  Sourcing & Verification     │
   │  Risk → Options → Synthesis             │    │  Layer (v0.5 hardened)       │
   │  (six-agent pipeline, v0.6)             │    │  • freshness / trust / dedupe│
   └──────────┬──────────────────────────────┘    │  • SourcingAccumulator       │
              │                                   │  • aggregated SourcingReport │
              ▼                                   └──────────────────────────────┘
   ┌────────────────────────────────────────┐
   │              LLMProvider               │
   │      MockLLMProvider (offline)         │
   │      AnthropicLLMProvider (live)       │
   │      .complete() / .completeWithTools()│
   └────────────────────────────────────────┘
```

Full detail and design rationale: [`docs/architecture.md`](docs/architecture.md).
For authoring a new agent prompt: [`docs/writing-a-prompt.md`](docs/writing-a-prompt.md).
For the stakeholder mapping philosophy: [`docs/stakeholders.md`](docs/stakeholders.md).
For the risk analysis philosophy: [`docs/risks.md`](docs/risks.md).
For the options generation philosophy: [`docs/options.md`](docs/options.md).
For the synthesis philosophy: [`docs/synthesis.md`](docs/synthesis.md).
For the hardened sourcing layer: [`docs/sourcing.md`](docs/sourcing.md).

---

## Format schema — quick reference

A format YAML declares a briefing's structure and stylistic contract:

```yaml
id: executive-pre-read           # kebab-case, unique
name: Executive Pre-Read
version: 1.0.0                   # SemVer
metadata:
  author: ...
  organization_style: generic    # pwc | mckinsey | bcg | family-office
                                 # | corporate-affairs | government | generic
  language: en                   # en | fr | multi
  last_reviewed: 2026-08-14      # ISO date
target_length:
  pages: 2
  words: 800
sections:
  - id: context
    title: Context
    purpose: ...
    max_length:
      words: 100
    required_agents: [scoping, research]
    tone_directives: ...
    validation_rules:
      - "must_contain_recommendation: true"
sourcing_policy: strict          # strict | permissive
style_guide:
  voice: ...
  sentence_structure: ...
  forbidden_terms: [...]
output_targets: [md, pdf]        # pdf | docx | md
```

The full schema and an annotated example live in
[`docs/format-schema.md`](docs/format-schema.md). A step-by-step guide
for contributing a new format is in
[`docs/creating-a-format.md`](docs/creating-a-format.md).

> **YAML subset.** Praxis parses YAML with `@promptlang/yaml-parser` — a
> minimal block-style parser (no flow-style `[..]`/`{..}`, no anchors,
> no block scalars). Every shipped format uses the block form.

---

## Roadmap

Praxis targets a v1.0 release in ten steps.

| Release | Focus |
| --- | --- |
| v0.1 | Format Registry |
| v0.2 | Agent scoping — first PromptLang-authored agent + orchestrator scaffold |
| v0.3 | Research agent + real Anthropic provider + embryonic sourcing layer |
| v0.4 | Stakeholder Mapping agent + sourcing extension |
| v0.5 | Risk Analysis agent + hardened sourcing (freshness, domain trust, dedupe) |
| **v0.6** | Options + Synthesis agents; `brief()` implemented; first end-to-end briefing (this release) |
| v0.7 | Adversarial Critique agent + output renderers (PDF/DOCX/MD) |
| v0.8 | Style guide enforcement (forbidden terms, sentence caps, MECE checks) |
| v0.9 | End-to-end demos on the three shipped formats |
| v1.0 | Documentation, CI matrix, external contributor onboarding |

Full detail: [`ROADMAP.md`](ROADMAP.md).

---

## License

MIT — © 2026 Matteo Gallo. See [`LICENSE`](LICENSE).
