# Live proof protocol (Part C)

The first live briefings Praxis would publish: what runs, how it is checked,
what it may claim, and what it costs. Nothing here has run; it waits for the
maintainer's GO on the cost in [§ Cost](#cost).

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

1. Pull requests #15 (split), #16 (properties) and this one merged; CI green.
2. A clean working tree on `main`: `run-all.ts` refuses a live run over
   modified tracked files, because the artefacts record the commit.
3. `ANTHROPIC_API_KEY` set; `PRAXIS_NOW` unset (live freshness uses the real
   date).
4. `bun run estimate:cost -- --ids <the five>` re-run on that commit, in
   case prompts or prices changed since this page.

## Run (paid, after GO)

```bash
# 1. One briefing first: catches a key, model or configuration fault for ~$5.
bun run bench:live -- --max-cost-usd 14 --ids 02-cfo-buyback-briefing
# 2. Only if step 1 completed without a timeout: the other four.
bun run bench:live -- --max-cost-usd 14 --ids 05-supply-chain-acquisition,08-ai-regulation-position,11-family-office-co-investment,12-sodium-ion-plant-morocco
```

- `--max-cost-usd 14` caps each briefing: the ledger refuses the next
  request, `pause_turn` re-sends included, once $14 is spent. It sits above
  the highest high estimate ($13.07, question 11) so a costly but healthy
  briefing completes; it is a fuse, not a target.
  `tests/benchmarks/live-protocol.test.ts` fails if it drops below.
- Stop after step 1 if it failed for a systematic cause (authentication,
  model id, request shape) or if any stage timed out: fix it, free, before
  spending more. A timed-out request is the one cost the cap cannot see
  ([§ Ceiling](#ceiling)).
- **One attempt per question.** A failure leaves
  `benchmarks/outputs/live/<id>/error-<time>.json` (cause, usage spent,
  commit, prompt versions, redacted); a completed run leaves `brief.md`,
  `brief.pdf`, `brief.docx` and `metadata.json` and is never overwritten.
  Running a question again needs a new estimate and a new GO.
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

- **Model**: `gpt-6.1-sol` (OpenAI), another family than every stage of
  the pipeline, which is all Claude. Generally available, $2 / $10 per
  million tokens (OpenAI pricing page, read 2026-11-03), JSON-schema
  structured output. Alternative: `gemini-3.1-pro-preview` ($2 / $12, still
  a preview).
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

- **Against a human**: the maintainer scores the five briefings blind on the
  same grid (≈ 1 hour). Agreement: quadratic-weighted Cohen's kappa over the
  35 criterion pairs. The pairs are clustered (seven per briefing), so its
  95% interval is a bootstrap over briefings, not over pairs.
  **Threshold: kappa ≥ 0.6.** With five briefings the interval will be wide;
  it is published as is.
- **Against planted errors**: for each briefing, three copies with one fault
  each, all detectable from the text alone: a figure changed so it
  contradicts the same figure elsewhere in the brief; a citation to a source
  id absent from the brief's own source list; the recommendation reversed
  against its own analysis. Each copy is judged 3 times, against the
  unchanged briefing's 3 judgments as control. A fault is detected when the
  median score on the matching criterion is at least 1 below the control's
  median. **Threshold: at least 12 of 15 detected**, published as k/15 with
  its Wilson interval.

**What the five consume.** Once their results shape a prompt or a
threshold, these five test questions are dev data. A later held-out claim
uses the three test questions left (03, 07, 10) or new ones.

## Not built yet (free, after the judge provider is chosen)

- The judge adapter for the chosen provider in `score-all.ts`, with its
  contract test (request shape, structured output, no key in logs). It needs
  that provider's API key, which is the maintainer's to create.
- The script that writes `RESULTS.md` from the artefacts and its `--check`
  in CI (methodology point 4), the cluster-bootstrap kappa, and the
  perturbation generator.
- For the hard case, a per-source check of whether each cited source is
  about sodium-ion cells (its `intent`). The judge cannot do it without
  reading the sources; it is a manual check on the sourcing report until it
  is built.

## Cost

`bun run estimate:cost -- --ids <the five>` on this commit:

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

### Ceiling

The cap is checked before each request, so a briefing ends above it by at
most the requests in flight when it is reached. In the high scenario the
costliest single request is adversarial (Opus, 5 searches, ≈ $2.45); the
six concurrent synthesis requests together cost less (≈ $0.85).

- **Metered ceiling**: five briefings at $14 + $2.45 each, **$82.25**.
- **Not metered: timed-out requests.** A request cut off by its timeout
  reports no usage, so the ledger does not count it, yet it may have been
  billed. Each stage call has two attempts, so a briefing in which every
  request timed out twice would add ≈ $17.66 unseen by the cap (high
  scenario). Timeouts are set for a decode rate of 40 tokens/s
  (`src/agents/stage-limits.ts`), so this needs a degraded API; the stop
  rule after step 1 bounds it to one briefing unless the degradation starts
  during step 2. The worst case, every request of all five timing out twice:
  $82.25 + 5 × $17.66 = **$170.55**.

### Judge

≈ 8 000 input and up to 4 000 output tokens per call (briefing, grid,
reasoning): $0.056 per call. Per briefing, 3 judgments of the unchanged
briefing (noise band and control) and 3 × 3 of the perturbed copies: 12
calls, 60 in all, **$3.36**; **$6.72** with a 2× margin.

## What GO authorizes

Two separate GOs:

1. **Anthropic**: the two `bench:live` commands above, one attempt per
   question. Expected ≈ $25, metered ceiling $82.25, worst case with
   timeouts $170.55.
2. **Judge**, once the adapter is built and the briefings are in: the 60
   judge calls, at most $6.72 on the judge provider.

Anything else, a second attempt at a question included, needs a new
estimate.
