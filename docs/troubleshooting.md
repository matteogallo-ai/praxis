# Troubleshooting

Twelve error messages you might hit, ranked roughly by
frequency. Each entry: what you see → why it happens → how to
fix it.

For the full error taxonomy see `src/errors/public.ts`; every
public error inherits from `PraxisError`.

---

## 1. `--format 'foo' not found` (`FormatNotFoundError`)

**Cause.** The format id you passed is not registered in the
`FormatRegistry`.

**Fix.**

```bash
bun run cli formats list      # shows every registered id
```

If it's a new format you just wrote, run
`bun run cli formats validate formats/your-file.yaml` first — the
loader skips invalid files silently. If the file loads but the
id is different from the filename, that's fine: registration is
by `id:` field, not filename.

---

## 2. `--format auto: ambiguous match`

**Cause.** Your question hit keywords from two format groups.

**Fix.** Spell the format id explicitly.

```bash
bun run cli brief "Board briefing on the regulatory shift?" \
  --format executive-pre-read \
  --full
```

The CLI's error output lists the ambiguous candidates so you can
pick.

---

## 3. `--format auto: no keyword match`

**Cause.** Your question did not contain any keyword the
auto-router recognises.

**Fix.** Either rephrase or spell the format id. The keyword
groups are enumerated in `docs/getting-started.md#choosing-a-format`.

---

## 4. `Anthropic authentication failed` (`AnthropicAuthenticationError`)

**Cause.** `--provider anthropic` was requested but
`ANTHROPIC_API_KEY` is missing or invalid.

**Fix.**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run cli brief "…" --format executive-pre-read --full --provider anthropic
```

For offline runs, switch to `--provider mock` — every test
fixture ships with the repo.

---

## 5. `Anthropic rate limit hit` (`AnthropicRateLimitError`)

**Cause.** The Anthropic tier throttled the request. The
provider retries with backoff automatically; this error means
the retries were also throttled.

**Fix.** Reduce concurrency (Praxis is sequential by default —
if you added parallelism, drop it), wait a few minutes, or
upgrade the API tier. Long term, keep live benchmarks to a
low-concurrency script.

---

## 6. `Anthropic request timed out` (`AnthropicTimeoutError`)

**Cause.** A single request exceeded the provider's timeout
(default 5 minutes for tool-using agents).

**Fix.** Usually a transient network hiccup — retry. If it
persists, check the Anthropic status page and reduce
`researchMaxToolRounds` (default is generous) so the agent
does not burn budget on a stuck tool loop.

---

## 7. `SourcingValidationError: SOURCE_MISSING under strict policy`

**Cause.** A finding / stakeholder position / risk evidence
came back marked `SOURCE_MISSING`, and the format's
`sourcing_policy: strict` stops the pipeline on any miss.

**Fix.** Two options:

- Switch the format to `sourcing_policy: permissive` — misses
  become warnings in `sourcing_report.warnings[]`.
- Improve the upstream prompt (e.g. tighten
  `prompts/research.prompt`) so the LLM invests more search
  effort. Live runs almost never miss; mock runs miss when a
  fixture is intentionally sparse.

---

## 8. `EditorialFailureError: retry loop exhausted`

**Cause.** A section under `strict_editorial: true` failed a
`"reject"`-action rule and used up all
`max_regeneration_attempts`.

**Fix.**

```ts
// e.reason: "forbidden_terms" | "over_length" | "validation_rule"
// e.attempts: [{ attempt_number, reason, details, accepted }]
```

Bump `max_regeneration_attempts` to 3 (its ceiling), flip the
offending `*_action` to `"warn"`, or ease the constraint that
tripped it (a single forbidden term that keeps re-appearing
usually means the prompt is asking for it implicitly).

---

## 9. `Renderer 'X' failed: format 'Y' does not declare 'X'`
   (`UnsupportedRenderTargetError`)

**Cause.** You asked for a target that's not in the format's
`output_targets[]`.

**Fix.** Either pick a supported target (the error message
lists them) or add the missing target to the format's YAML:

```yaml
output_targets:
  - md
  - pdf
  - docx   # add this
```

---

## 10. `benchmarks/questions.yaml: YAML flow-style collections are not supported`

**Cause.** You wrote `tags: [a, b, c]` or `{a: b}` in a Praxis
YAML file. The vendored parser is deliberately restrictive —
block-style only.

**Fix.**

```yaml
# INSTEAD OF:
tags: [market-entry, europe]

# WRITE:
tags:
  - market-entry
  - europe
```

Same for mappings: no `{a: b}`, always block-style.

---

## 11. `not a valid PromptLang program`

**Cause.** You edited a `.prompt` file and the PromptLang parser
rejects it. The most common culprits: forgetting the `@version`
declaration, mixing `system:` and `user:` sections outside a
`prompt(...) { ... }` block, or using unsupported YAML in
embedded literals.

**Fix.** Compare to `prompts/scoping.prompt` — the smallest
working example in the repo. Every prompt has a header block
(`@version`, `@model`, `@description`) followed by a single
`prompt name(params) -> string { system: "..." user: "..." output: string }`
body.

---

## 12. `Adversarial critique parser rejected the output`
    (subclass of `AdversarialCritiqueError`)

**Cause.** The critique agent returned a JSON payload that
violates the contract: too few (< 3) or too many (> 15)
critiques, a `steelmanned_position` under 20 words, a
`revised_recommendation_needed: true` without a
`steelmanned_alternative`, or a cross-reference to an artefact
that does not exist in the brief.

**Fix.** For live runs, retry — the model occasionally slips.
If it happens repeatedly, tighten `prompts/adversarial.prompt`
with an explicit reminder ("MUST NOT reference stakeholders not
listed in the input"). For mock runs, the fixture is the source
of truth; fix the fixture.

---

## Escalation

If none of the above fits:

1. Re-run with `--verbose` to see every step Praxis takes.
2. Add `--json` to the CLI to inspect the raw payload.
3. Read the specific error class in `src/errors/public.ts` — it
   documents fields you can drill into (`e.rawOutput`,
   `e.attempts`, `e.critiqueId`, ...).
4. Open an issue at
   `https://github.com/matteogallo-ai/praxis/issues` with the
   verbose log and the payload attached.
