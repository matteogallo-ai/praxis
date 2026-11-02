# Service level objectives

Praxis is a CLI that one person runs on a question, so its "service" is one
briefing: `praxis brief --full` against Anthropic, stages 1–6. These are the
targets a live briefing is held to. **No live briefing has been measured
yet** (`docs/CLAIMS.md` C14); until one is, each objective below is a
target, not a fact about Praxis.

| Objective | Target | Measured on |
| --- | --- | --- |
| Latency | p95 ≤ 10 minutes per briefing | the sum of `usage.stages.<stage>.duration_ms` in `metadata.json` |
| Error rate | ≤ 10% of started briefings end in an error | exit code of each run |
| Cost | p95 ≤ $2.50 per briefing | `usage.total.cost_usd` in `metadata.json` |

## What counts

- **Error**: a run that exits 1 for a reason the operator did not choose. A
  missing key and a budget cap the operator set are not errors of the
  service; a timeout, an invalid answer after its retry, or a refused
  checkpoint are. A briefing that completes with an "Insufficiently sourced"
  section is a success with a flag, counted separately: it is the pipeline
  declining to present unsourced claims (ADR 0002).
- **Latency**: wall time of the stages, from `metadata.json`; a resumed
  briefing adds its attempts' durations.
- **Cost**: list prices from `src/llm/pricing.ts`, web search included.

## Why these numbers

Computed from the per-stage limits in `src/agents/stage-limits.ts` and the
`@model` of each prompt, for a six-section format:

- **Output tokens** cannot cost more than $1.44 per briefing when no stage
  is retried (a retried stage or section pays its ceiling again): 8 000 tokens
  on Opus for scoping ($0.16), 16 000 on Sonnet for each of research,
  stakeholders and risks ($0.48), 16 000 on Opus for options ($0.32), 8 000
  on Sonnet for each of six sections ($0.48).
- **Web search** is at most 20 searches, $0.20.
- **Input tokens** have no ceiling in code: search results enter the
  context. The $2.50 target leaves about $0.85 for them; a briefing above it
  is the signal to look at `input_tokens` per stage.
- **Latency**: the stage timeouts add up to 40 minutes, the worst case
  before a stage gives up; they are sized for every stage using its whole
  output ceiling at a slow 40 tokens per second. Ten minutes is what a
  reader waiting for a briefing tolerates, and assumes stages use a fraction
  of their ceilings, which only a live measurement can confirm.
- **Error rate**: one failed briefing in ten is tolerable for a CLI that
  resumes from its checkpoints without paying again for finished stages.

Run with `--max-cost-usd 5`: twice the cost objective, so a normal briefing
never reaches it and a runaway one stops; the objective is a target, the cap
is a hard stop.

## How it is reported

Each objective is reported over the last n live briefings with n and a 95%
interval (Wilson for the error rate), as `docs/DEFINITION_OF_DONE.md` B4
asks, from committed live artefacts under `benchmarks/outputs/live/`. That
report does not exist yet: it needs paid runs, which need the maintainer's
approval and a cost estimate.
