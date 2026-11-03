# Live proof protocol (Part C)

The first live briefings Praxis would publish: what runs, how it is checked,
what it may claim, and what it costs. Nothing here has run. Each paid step
waits for its own GO from the maintainer ([§ What each GO authorizes](#what-each-go-authorizes)):
first one briefing, then the other four, then the judge.

## What it can prove

- **Completion and cost**: whether the pipeline finishes against Anthropic on
  real questions, and what each stage spends ([`CLAIMS.md`](CLAIMS.md) C14).
- **Quality, as examples**: five judged briefings are five examples, not a
  rate. Every proportion is published with its `n` and a 95% Wilson
  interval; with n = 5, 5/5 completed reads "57%–100%".

It cannot prove that one prompt or model is better than another: that needs
the noise band of repeated runs (DoD B4), which this protocol measures on
the judge only.

## The five briefings

Chosen by rule, not by hand, from the **test** half of the frozen split
(`benchmarks/split.yaml`): the first test question of each format in id
order, plus the hard case. `tests/benchmarks/live-protocol.test.ts` fails if
the command below names other questions.

| Question | Format | Why |
| --- | --- | --- |
| `02-cfo-buyback-briefing` | executive-pre-read | first test question of the format |
| `05-supply-chain-acquisition` | mckinsey-style-note | first test question of the format |
| `08-ai-regulation-position` | position-paper-corporate | first test question of the format |
| `11-family-office-co-investment` | family-office-memo | the format's only question; `strict_editorial: true` |
| `12-sodium-ion-plant-morocco` | mckinsey-style-note, hard case | thin sodium-ion sourcing; outcome defined in its `intent` |

## Before GO (free)

1. Pull requests #19 (strict cap parsing, answers cut at `max_tokens`
   refused) and the `@promptlang/core` switch merged, and this one; CI green.
2. A clean working tree on `main`: `run-all.ts` refuses a live run over
   modified tracked files, because the artefacts record the commit.
3. `ANTHROPIC_API_KEY` set; `PRAXIS_NOW` unset (live freshness uses the real
   date); `ANTHROPIC_MODEL` unset, so each stage runs on its `@model` as
   estimated.
4. `bun run estimate:cost -- --ids 05-supply-chain-acquisition --cap-usd 8`
   re-run on that commit, in case prompts or prices changed since this page.

## Run (paid, one GO per step)

### Step 0: one briefing, capped at $8

```bash
bun run bench:live -- --max-cost-usd 8 --ids 05-supply-chain-acquisition
```

`05-supply-chain-acquisition` is the cheapest representative of the five:
its format, `mckinsey-style-note`, is the one two of the five use (the hard
case included), and it is not `strict_editorial`. Question 11 is a few
cents cheaper in the central case but atypical (synthesis regenerated
under `strict_editorial`, $13.07 in the high case).

What $8 lets through, by the estimator's stages (high scenario, cumulative):
scoping $0.17, research $0.95, stakeholders $1.77, risks $2.68, options
$4.68, synthesis $5.52, adversarial $7.83. A healthy briefing therefore
completes in the low and central cases; in the high case the cap is reached
during the synthesis rerun, and if a stage retries, earlier. A stop at the
cap is a result, not a fault: `error-*.json` records what each stage spent,
which is the measurement step 1 is costed from.

### Step 1: the other four, capped at $14 each

```bash
bun run bench:live -- --max-cost-usd 14 --ids 02-cfo-buyback-briefing,08-ai-regulation-position,11-family-office-co-investment,12-sodium-ion-plant-morocco
```

Only after step 0 completed, or stopped at its cap, without a timeout, and
after `estimate:cost` has been re-costed from step 0's measured usage.

- `--max-cost-usd 14` caps each briefing: the ledger refuses the next
  request, `pause_turn` re-sends included, once $14 is spent. It sits above
  the highest high estimate ($13.07, question 11) so a costly but healthy
  briefing completes; it is a fuse, not a target.
  `tests/benchmarks/live-protocol.test.ts` fails if it drops below.
- Stop after step 0 if it failed for a systematic cause (authentication,
  model id, request shape) or if any stage timed out: fix it, free, before
  spending more. A timed-out request is the one cost the cap cannot see
  ([§ Ceiling](#ceiling)).
- **One attempt per question.** The rule is procedural: `run-all.ts`
  refuses only a question that already has a `metadata.json`, so a question
  that failed can be run again by the same command. Do not: running a
  question again, 05 included after a fix that follows step 0, is a second
  attempt and needs a new estimate and a new GO. A failure leaves
  `benchmarks/outputs/live/<id>/error-<time>.json` (cause, usage spent,
  commit, prompt versions, redacted); a completed run leaves `brief.md`,
  `brief.pdf`, `brief.docx` and `metadata.json` and is never overwritten.
- Then: `shasum -a 256 benchmarks/outputs/live/*/* > benchmarks/outputs/live/SHA256SUMS`
  and one commit with every artefact, failures included (DoD B6).

## Checks, in order

**1. Deterministic, before any judge** (DoD B3), read from each
`metadata.json`:

| Check | Pass when |
| --- | --- |
| Completed | `metadata.json` exists (else the `error-*.json` cause is reported) |
| Sourcing | `sourcing.counts`; `insufficiently_sourced` reported, never hidden |
| Format conformance | `synthesis.forbidden_terms_found = 0`, `sections_over_length` and `deviation_pct` reported |
| Adversarial | `critical_count`, `material_count`; `rerun.performed` |
| Cost and latency | `usage.stages.*.cost_usd` and `duration_ms`, against [`SLO.md`](SLO.md) |
| Hard case | completed and `insufficiently_sourced: true` with the unsourced sodium-ion claims listed (its `intent`); an abort fails it |

**2. Judge**, on completed briefings only, under its own GO
([§ Judge](#judge)).

- **Model**: `claude-fable-5-1` (`JUDGE_MODEL` in `benchmarks/score-all.ts`).
  Every stage runs on Claude Opus 5.5 or Sonnet 5.5, so no stage's output is
  scored by the model that wrote it; a test fails if `JUDGE_MODEL` becomes
  any stage's `@model`. $10 / $50 per million tokens, thinking always on.
  It is a Covered Model: 30-day retention, and an organisation under zero
  data retention gets a 400 from it.
- **Limitation, same family.** Judge and pipeline are all Claude models,
  trained by the same company on overlapping data. A bias they share (a
  phrasing they all reward, a claim they all accept) is not seen by the
  judge. No judge from another provider is available to this project; the
  human review below is the only check on that bias, and it is small.
- **Prompt**: `benchmarks/scoring-prompt.txt`, the briefing delimited as
  untrusted content (`interpolateScoringPrompt`). The judge has no web
  access: it scores the text, and cannot tell whether a cited page exists.
- **Grid**: the seven criteria scored 1–5 in
  [`benchmarking-methodology.md`](benchmarking-methodology.md#the-rubric)
  (total /35).
- **Noise band**: each briefing judged 3 times; the median per criterion is
  the score, the spread is published next to it.

**3. The judge is checked** (DoD B2). Its scores are called *validated*
only if both thresholds hold; otherwise they are published as
*unvalidated*, with the numbers that failed.

- **Against a human**: the maintainer scores two briefings blind on the
  same grid: `05-supply-chain-acquisition` (step 0) and the first of 02, 08,
  11, 12 in id order that completes. `bun run export:annotation -- --ids
  <the two> > review.jsonl` writes them for an annotation tool, one JSON
  object per line: question, format, the brief's Markdown, and the seven
  criteria with their definitions and an empty `score` (1–5) and `note`.
  Nothing the judge wrote is in the file. The maintainer knows the pipeline:
  one informed rater, published as such. Agreement over the 14 criterion
  pairs: exact and within-one agreement, and quadratic-weighted Cohen's
  kappa. **Threshold: kappa ≥ 0.6**, read as indicative: 14 pairs from two
  briefings support no interval, and none is claimed.
- **Against planted errors**: for each briefing, three copies with one fault
  each, all detectable from the text alone, each with the criterion it must
  lower, fixed before any judging:

  | Fault | Criterion |
  | --- | --- |
  | A figure changed so it contradicts the same figure elsewhere in the brief | 4 Concrete trade-offs |
  | A citation to a source id absent from the brief's own source list | 5 Perceived sourcing |
  | The recommendation reversed against its own analysis | 3 Decisive recommendation |

  Two controls: the unchanged briefing, and a neutral copy (three sentences
  reworded, meaning kept). Each copy and each control is judged 3 times. A
  fault is detected when the median on its criterion is at least 1 below the
  unchanged briefing's median; the neutral copy measures how often that
  happens with no fault. **Threshold: at least 12 of 15 faults detected and
  at most 1 of 15 neutral criterion readings (the same three criteria, five
  briefings) 1 or more below the unchanged median**, each published as k/15
  with its Wilson interval.

**What the five consume.** Running and publishing these five test
questions spends them: from then on they are dev data. A later held-out
claim uses the three test questions left (03, 07, 10) or new ones.

## Not built yet (free, before the judge's GO)

- A cap and an output ceiling on the judge: `score-all.ts` calls
  `complete()` with neither a ledger nor `max_tokens`, and Fable 5.1 thinks
  on every call.
- Reading the maintainer's scores back from the annotation file, and the
  agreement computation.
- The script that writes `RESULTS.md` from the artefacts and its `--check`
  in CI (methodology point 4), and the perturbation generator.
- For the hard case, a per-source check of whether each cited source is
  about sodium-ion cells (its `intent`). The judge cannot do it without
  reading the sources; it is a manual check on the sourcing report until it
  is built.

## Cost

`bun run estimate:cost -- --ids <the five> --cap-usd 14` on this commit:

| Question | Low | Central | High |
| --- | ---: | ---: | ---: |
| 02-cfo-buyback-briefing | $1.16 | $5.08 | $11.18 |
| 05-supply-chain-acquisition | $1.13 | $4.98 | $10.98 |
| 08-ai-regulation-position | $1.16 | $5.08 | $11.22 |
| 11-family-office-co-investment | $1.18 | $4.90 | $13.07 |
| 12-sodium-ion-plant-morocco | $1.13 | $4.98 | $10.98 |
| **Total** | **$5.76** | **$25.03** | **$57.44** |

Assumptions (`SCENARIOS` in `benchmarks/estimate-cost.ts`):

| | Low | Central | High |
| --- | --- | --- | --- |
| Live prompt size vs mock | ×1 | ×2 | ×3 |
| Searches per web-search call (cap 5) | 2 | 5 | 5 |
| Tokens added per search | 3 000 | 8 000 | 15 000 |
| Output, share of `max_tokens` (thinking included) | 25% | 50% | 100% |
| Synthesis passes, `strict_editorial` format | 1 | 1.5 | 2 |
| Synthesis rerun | no | as in the mock run | yes, for every question |
| Stage retries | 0 | 0 | the costliest stage once |

Each web-searching call re-reads its context after every search, model
output included. Prices: Claude Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10 per
million tokens, web search $10 per 1000 (`src/llm/pricing.ts`, 2026-11-02).
No prompt caching is assumed.

### Step 0 alone

`bun run estimate:cost -- --ids 05-supply-chain-acquisition --cap-usd 8`:

| | Low | Central | High |
| --- | ---: | ---: | ---: |
| Estimate | $1.13 | $4.98 | $10.98 |

- Metered ceiling: **$10.30**, the $8 cap plus the costliest request ($2.30,
  adversarial). In the high case the run stops at the cap rather than
  reaching $10.98.
- Worst case with every request timing out twice, unseen by the cap:
  **$27.66**.

These are estimates from the mock run's prompt sizes, 4 characters per
token, and assumed search sizes. Anthropic's token-counting endpoint is
free and would replace the 4-characters rule with the model's own count,
but it rejects requests that carry `web_search` and needs the API key; the
search sizes stay assumptions. Step 0 itself is the measurement.

### Ceiling

`bun run estimate:cost -- --ids <the five> --cap-usd 14` computes it
(`ceiling` in `benchmarks/estimate-cost.ts`). These are high-scenario
figures, not hard bounds: no code limits the size of one request (the
tokens a search adds are not capped; the context window is the real limit).

The cap is checked before each request, so a briefing ends above it by at
most the request in flight when it is reached. In the high scenario the
costliest single request $2.45 is adversarial (Opus, 5 searches); the six
concurrent synthesis requests together cost less (≈ $0.85).

- **Metered ceiling, high scenario**: $82.27, five briefings at $14 +
  $2.45 each.
- **Not metered: timed-out requests.** A request cut off by its timeout
  reports no usage, so the ledger does not count it, yet it may have been
  billed. Each stage call has two attempts, so if every request of a
  briefing timed out twice, this much would escape the cap:

  | Question | Unseen by the cap |
  | --- | ---: |
  | 02-cfo-buyback-briefing | $17.66 |
  | 05-supply-chain-acquisition | $17.36 |
  | 08-ai-regulation-position | $17.66 |
  | 11-family-office-co-investment | $21.23 |
  | 12-sodium-ion-plant-morocco | $17.36 |

  Question 11 is higher because `strict_editorial` runs its synthesis twice.
  Timeouts are set for a decode rate of 40 tokens/s
  (`src/agents/stage-limits.ts`), so this needs a degraded API; the stop
  rule after step 0 bounds it to one briefing unless the degradation starts
  during step 1.
- **Also not metered**, both narrow: a request whose answer arrives but
  cannot be parsed (a 200 with a body that is not JSON, or content blocks
  the parser rejects), and, when a synthesis section fails, the sibling
  sections still in flight when `error-*.json` is written (they are
  recorded, after it).
- **Worst case**: $173.55, the metered ceiling plus every question's
  timeouts.

### Judge

On `claude-fable-5-1`, ≈ 16 000 input tokens per call (a mock brief is
4 200–4 800 tokens, a live one 2–3 times that, plus the grid) and up to
8 000 output tokens, thinking included: $0.56 per call. Per briefing, 3
judgments each of the unchanged briefing (noise band and control), the
neutral copy and the three faulty copies: 15 calls, **$8.40 per briefing**,
$42.00 for the five; **$84.00** with a 2× margin.

Cheaper and rejected: Opus 5.5 ($0.22 per call, $16.80 for the five). It
wrote the scoping, the options and the adversarial critique the judged
brief rests on, so it would score its own work.

## What each GO authorizes

1. **Step 0**: the one `bench:live` command for `05-supply-chain-acquisition`,
   one attempt. Expected ≈ $5 (central), metered ceiling $10.30, worst
   case with timeouts $27.66.
2. **Step 1**, after step 0 and a re-costing from its measured usage: the
   other four. Before that re-costing, the estimate above stands: metered
   ceiling $82.27 for all five at $14, worst case $173.55.
3. **Judge**, once its cap is built and the briefings are in: at most
   $8.40 per briefing judged, $84.00 for the five with the margin.

Anything else, a second attempt at a question included, needs a new
estimate.
