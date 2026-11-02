# Architecture

Praxis is a pipeline of seven LLM calls in a fixed order. This page maps the
modules as the code stands, the data that flows between stages, and the known
weaknesses that keep the live path from working. The status of each
capability is in [`CLAIMS.md`](CLAIMS.md).

## Modules

```
src/
  cli/            argv parsing, commands (brief, formats list/inspect/validate, version),
                  terminal and Markdown output, --format auto keyword routing
  orchestrator/   Orchestrator: runs the stages in order, applies the sourcing checks,
                  the adversarial review and the single synthesis rerun
  agents/         one module per stage: load its .prompt file, render it, call the
                  provider, parse and validate the JSON answer into a typed result
  sourcing/       source checks: SOURCE_MISSING markers, freshness, domain trust,
                  cross-stage duplicates; strict policy throws, permissive reports
  registry/       format schema, YAML loader, validator, in-memory registry
  renderers/      Markdown, PDF (pdfkit) and DOCX (hand-written OPC parts) renderers
  llm/            LLMProvider interface, MockLLMProvider (fixtures), AnthropicLLMProvider
  errors/         the public error hierarchy re-exported by src/index.ts
  index.ts        library entry point
prompts/          one PromptLang .prompt file per stage
formats/          the four shipped format YAML files
benchmarks/       questions.yaml, run-all.ts (bench:mock / bench:live), score-all.ts
```

The CLI and the library both go through `Orchestrator`. Agents depend on
`llm/` and `sourcing/` types, never on each other's modules; the orchestrator
passes each stage the typed results of the earlier ones.

## Stage flow

`Orchestrator.briefWithCritiqueAndRerun()` is the full path:

| # | Stage | Module | Tools | Input | After the stage |
| --- | --- | --- | --- | --- | --- |
| 1 | Scoping | `agents/scoping.ts` | — | question, format | — |
| 2 | Research | `agents/research.ts` | `web_search` | scoping | `validateSourcing` |
| 3 | Stakeholders | `agents/stakeholder.ts` | `web_search` | scoping, research | `validateStakeholderSourcing` |
| 4 | Risks | `agents/risk.ts` | `web_search` | scoping, research, stakeholders | `validateRiskSourcing` |
| 5 | Options | `agents/options.ts` | `web_search` | stages 1–4 | — |
| 6 | Synthesis | `agents/synthesis.ts` | — | stages 1–5, one call per format section | format conformance (length, forbidden terms) |
| 7 | Adversarial review | `agents/adversarial.ts` | `web_search` | the assembled brief | if it asks for a revised recommendation, stage 6 runs once more |

Every stage awaits the previous one, and each reads the one before it: risks
reference stakeholder names, options reference risk IDs. In the current data
flow no two stages can run concurrently without changing what a stage reads.

The sourcing checks follow the format's `sourcing_policy`. Under `strict`, a
finding, position or risk without a valid source throws and the whole brief
is lost; under `permissive`, the problem is recorded in the sourcing report.

`Orchestrator` also exposes the shorter paths the CLI flags use: `scope()`,
`researchAfterScoping()`, `mapStakeholdersAfterResearch()`,
`assessRisksAfterStakeholders()`, `brief()` (stages 1–6) and
`briefWithCritique()` (1–7, no rerun). Each restates the sequence of the
stages before it rather than sharing one implementation.

## Providers

`LLMProvider` has `complete(prompt)` and an optional
`completeWithTools(prompt, tools)`. Both take a single prompt string.

- `MockLLMProvider` returns the fixture under `tests/fixtures/mock-llm/` whose
  key matches the stage and the format id. The question does not select the
  fixture, so every question with the same format gets the same text.
- `AnthropicLLMProvider` calls `/v1/messages` with `fetch`: default model
  `claude-sonnet-5-5` (or `ANTHROPIC_MODEL`), API version `2026-10-21` with no
  sampling parameters, up to 3 attempts with backoff on 429 and 5xx, and up
  to 5 `pause_turn` rounds for the server-side `web_search` tool. Each stage
  sends its own `max_tokens`, request timeout and web-search cap
  (`max_uses`) from `src/agents/stage-limits.ts`; the provider's own 4096
  tokens and 60 s apply only to callers that set neither.

## Usage and cost

When a caller passes a `UsageLedger` (`src/orchestrator/ledger.ts`), every
stage gets the provider wrapped so each call's `usage` (input, output and
cache tokens, web searches) is recorded under its stage and priced from a
table (`src/llm/pricing.ts`: list prices by default, a JSON file through
`loadPriceTable`). A model missing from the table is costed `null`, not
guessed. With `maxCostUsd` set, no call starts once the briefing has spent
the cap, so a briefing ends above it by at most its last call.
`benchmarks/run-all.ts` writes the summary to `metadata.json` under `usage`.
The mock provider simulates usage from text length (`simulated: true`).

## Known weaknesses

These are confirmed in the code and are why live runs fail or cannot be
trusted. Each is a Roadmap item in [`CLAIMS.md`](CLAIMS.md).

- The per-stage timeouts are derived from each stage's token and search
  ceilings, not from measured durations; no live stage duration exists yet.
- A failure at any stage loses the stages before it: there is no checkpoint.
- Freshness is checked on `accessed_at`, which Praxis sets to the retrieval
  time; the page's own age (`page_age`) is not used.
- Web search results and earlier stages' output enter the next prompt
  between `---` lines with a label, but with no instruction to treat them as
  data, and `---` also separates the system text from the user text.

## Dependencies

- `pdfkit` for PDF output.
- `@promptlang/yaml-parser` (npm) for format YAML.
- PromptLang's lexer and parser, imported as `promptlang/*` through
  `tsconfig.json` `paths` pointing at a sibling checkout (`../promptlang`).
  CI checks that repository out at a pinned tag.

## Errors

Every error the library throws extends `PraxisError`. The public classes are
listed in `src/errors/public.ts`; [`api.md`](api.md) groups them by layer.
