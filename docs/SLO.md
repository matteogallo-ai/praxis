# Service level objectives

Praxis is a CLI that one person runs on a question, so its "service" is one
briefing: `praxis brief --full` against Anthropic, stages 1–6. These are the
targets a live briefing is held to. Each is set from intended use (what a
reader waits for, tolerates and pays for one briefing), not from what the
pipeline happens to cost. A target that the measurement, or before it the
estimate, misses is published as **not met**; it is not moved to fit.
**No live briefing has been measured yet** (`docs/CLAIMS.md` C14).

| Objective | Target | Status | Measured on |
| --- | --- | --- | --- |
| Latency | p95 ≤ 10 minutes per briefing | Not measured | the sum of `usage.stages.<stage>.duration_ms` in `metadata.json` |
| Error rate | ≤ 10% of started briefings end in an error | Not measured | exit code of each run |
| Cost | p95 ≤ $2.50 per briefing | **Not met**, on the estimate: question 05 (step 0), $1.33 low, $5.75 central, $12.54 high | `usage.total.cost_usd` in `metadata.json` |

The cost status comes from `bun run estimate:cost` (prompt sizes measured
with count_tokens, `docs/live-proof-protocol.md`), and
`tests/docs/slo.test.ts` fails if the estimate moves without it. Only the
low case meets the target; the central and high cases miss it, and the five
protocol questions range from $5.68 to $5.90 central. The first live
measurements replace the estimate here.

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

Each limit applies per request, and a web-searching stage (research,
stakeholders, risks, options) may continue a paused turn up to five times,
each continuation a new request with its own limits
(`DEFAULT_MAX_TOOL_ROUNDS`). The ceilings below are therefore per round, and
per briefing in the worst case.

- **Output tokens**: one round per stage costs at most $1.44 (8 000 tokens
  on Opus for scoping, $0.16; 16 000 on Sonnet for each of research,
  stakeholders and risks, $0.48; 16 000 on Opus for options, $0.32; 8 000 on
  Sonnet for each of six sections, $0.48). With every search stage using its
  five rounds, the ceiling is $4.64; a retried stage or section pays its
  ceiling again.
- **Web search**: five searches per request, so 20 with one round per
  search stage ($0.20) and 100 with five ($1.00).
- **Input tokens** have no ceiling in code: search results enter the
  context, and each continuation resends them, model output included. The
  estimate does not split its total into input and output, so which one
  closes the gap to the target (fewer search rounds, shorter upstream
  outputs passed downstream, prompt caching) is for live runs to measure.
- **Worst case versus target**: the ceilings add up to more than the
  target, so the target cannot be proven from the limits alone. The hard
  stop is `--max-cost-usd` (below): each request reserves its worst case
  before it is sent, timeouts are charged at it, and a run passes the cap
  only when a request costs more than its worst case, through searches
  that add more than 15 000 tokens each (`src/orchestrator/ledger.ts`).
- **Latency**: the request timeouts add up to 40 minutes with one round
  per stage, 168 minutes with five rounds per search stage; they are sized
  for a request using its whole output ceiling at a slow 40 tokens per
  second. Ten minutes is what a reader waiting for a briefing tolerates, and
  assumes stages use a fraction of their ceilings and rounds, which only a
  live measurement can confirm.
- **Cost**: a briefing must cost less than 10 minutes of the time of the
  analyst it replaces (the maintainer's rule). $2.50 for 10 minutes is $15.00
  an hour of analyst time; a dearer analyst raises the bound, and the target
  stays the maintainer's choice, not a figure derived from the pipeline.
- **Error rate**: one failed briefing in ten is tolerable for a CLI that
  resumes from its checkpoints without paying again for finished stages.

The cap is not the objective. It is set per run above the estimate's
central case so a normal briefing completes and a runaway one stops: $10
for the first live briefing, $14 for each of the next four
(`docs/live-proof-protocol.md`).

## How it is reported

Each objective is reported over the last n live briefings with n and a 95%
interval (Wilson for the error rate), as `docs/DEFINITION_OF_DONE.md` B4
asks, from committed live artefacts under `benchmarks/outputs/live/`. That
report does not exist yet: it needs paid runs, which need the maintainer's
approval and a cost estimate.
