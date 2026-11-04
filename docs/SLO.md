# Service level objectives

Praxis is a CLI that one person runs on a question, so its "service" is one
briefing: `praxis brief --full` against Anthropic, stages 1–6. These are the
targets a live briefing is held to. Each is set from intended use (what a
reader waits for, tolerates and pays for one briefing), not from what the
pipeline happens to cost. A status of **met** or **not met** is published
only from live measurements, never from an estimate; a target the
measurement misses is published as not met, not moved to fit.
**Six live briefings have completed** (questions 05, 08, 10, 11 and 12, 4 Nov 2026; `docs/CLAIMS.md` C14),
all flagged insufficiently sourced, a success with a flag ("What counts"):
too few briefings for any status.

| Objective | Target | Status | Measured on |
| --- | --- | --- | --- |
| Latency | p95 ≤ 10 minutes per briefing | 7.8, 8.4, 7.9, 8.4, 7.7 and 11.9 min on n = 6 (4 Nov 2026); n too small, no status | the sum of `usage.stages.<stage>.duration_ms` in `metadata.json` |
| Error rate | ≤ 10% of started briefings end in an error | 2/8 since run records began (failed 3 Nov 2026 and 4 Nov 2026: TruncatedOutputError, InvalidAgentOutputError; completed 4 Nov 2026); the five aborted runs of 1.2.1 predate the records; n too small, no status | `error-*.json` (budget stops excluded) against `metadata.json` under `benchmarks/outputs/live/` |
| Cost | p95 ≤ $10.00 per briefing | $3.51, $3.69, $3.66, $3.92, $3.29 and $4.75 on n = 6 (4 Nov 2026); n too small, no status; estimate for question 05, not a status: $1.40 low, $5.98 central, $12.96 high | `usage.total.cost_usd` in `metadata.json` |

The estimate comes from `bun run estimate:cost` (prompt sizes measured
with count_tokens, `docs/live-proof-protocol.md`), and
`tests/docs/slo.test.ts` fails if it moves without this page. The low and
central cases fall under the target and the high case above it; the five
protocol questions range from $5.90 to $6.13 central. An estimate rests on
assumed search sizes and output shares, so it decides no status. Each
measured cost is below its question's central estimate, and question 12's
11.9 min of stages is above the latency target; six briefings set no p95.

## What counts

- **Error**: a run that exits 1 for a reason the operator did not choose. A
  missing key and a budget cap the operator set are not errors of the
  service; a timeout, an invalid answer after its retry, an answer cut at
  its stage's `max_tokens` (not retried), or a refused checkpoint are. A briefing that completes with an "Insufficiently sourced"
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

- **Output tokens**: one round per stage costs at most $1.60 (8 000 tokens
  on Opus for scoping, $0.16; 16 000 on Sonnet for each of research and
  stakeholders, $0.32; 32 000 on Sonnet for risks, $0.32; 16 000 on Opus
  for options, $0.32; 8 000 on Sonnet for each of six sections, $0.48).
  With every search stage using its five rounds, the ceiling is $5.44; a
  retried stage or section pays its ceiling again.
- **Web search**: five searches per request, so 20 with one round per
  search stage ($0.20) and 100 with five ($1.00).
- **Input tokens** have no ceiling in code: search results enter the
  context, and each continuation resends them, model output included. The
  estimate does not split its total into input and output, so which one
  drives the high case over the target (fewer search rounds, shorter
  upstream outputs passed downstream, prompt caching) is for live runs to
  measure.
- **Worst case versus target**: the output and search ceilings add up to
  $6.44, under the target, but input tokens have no ceiling and a retried
  stage pays its ceiling again, so the target cannot be proven from the
  limits alone. The hard
  stop is `--max-cost-usd` (below): each request reserves its worst case
  before it is sent, timeouts are charged at it, and a run passes the cap
  only when a request costs more than its worst case, through searches
  that add more than 15 000 tokens each (`src/orchestrator/ledger.ts`).
- **Latency**: the request timeouts add up to 47 minutes with one round
  per stage, 203 minutes with five rounds per search stage (adversarial
  aside); they are sized for a request using its whole output ceiling at a
  slow 40 tokens per second. Risk's alone, 15 minutes, is above the
  10-minute target: a timeout bounds a hung request, it is not the
  expected duration. Ten minutes is what a reader waiting for a briefing tolerates, and
  assumes stages use a fraction of their ceilings and rounds, which only a
  live measurement can confirm.
- **Cost**: a briefing must cost less than 10 minutes of the time of the
  analyst it replaces (the maintainer's rule), priced at $60 an hour.
  $10.00 for 10 minutes is $60.00 an hour of analyst time. An earlier target
  of $2.50 priced that analyst at $15 an hour, below what the analyst a
  briefing replaces costs; the target was raised for that reason, not to
  fit the estimate, and stays the maintainer's choice, not a figure derived
  from the pipeline.
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
