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
bun run bench:live -- --max-cost-usd 12 --ids 02-cfo-buyback-briefing
# 2. If it completed, or failed for a cause that is not systematic, the other four.
bun run bench:live -- --max-cost-usd 12 --ids 05-supply-chain-acquisition,08-ai-regulation-position,11-family-office-co-investment,12-sodium-ion-plant-morocco
```

- `--max-cost-usd 12` caps each briefing: the ledger refuses the next call
  once $12 is spent. It sits above the high estimate ($10.65) so a costly but
  healthy briefing completes; it is a fuse, not a target.
- Stop after step 1 if it fails for a systematic cause (authentication,
  model id, request shape, timeout on every stage): fix it, free, before
  spending more.
- Each question runs at most twice. A failure leaves
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

**2. Judge**, on completed briefings only.

- **Model**: `gpt-6.1-sol` (OpenAI), another family than every stage of
  the pipeline, which is all Claude. Generally available, $2 / $10 per
  million tokens (OpenAI pricing page, read 2026-11-03), JSON-schema
  structured output. Alternative: `gemini-3.1-pro-preview` ($2 / $12, still
  a preview).
- **Prompt**: `benchmarks/scoring-prompt.txt`, the briefing delimited as
  untrusted content (`interpolateScoringPrompt`).
- **Grid**: the seven criteria scored 1–5 in
  [`benchmarking-methodology.md`](benchmarking-methodology.md#the-rubric)
  (total /35). For the hard case the judge also answers, per cited source,
  whether it is about sodium-ion cells.
- **Noise band**: each briefing judged 3 times; the spread per criterion is
  published next to the median.

**3. The judge is checked** (DoD B2) before its scores are called anything
but *unvalidated*:

- **Against a human**: the maintainer scores the five briefings blind on the
  same grid (≈ 1 hour). Agreement: quadratic-weighted Cohen's kappa over the
  35 criterion pairs, with its 95% interval.
- **Against planted errors**: for each briefing, three copies with one
  planted fault each (a figure changed, a citation to a source that does not
  exist, the recommendation reversed against its own analysis). The judge
  passes a copy when its score on the matching criterion drops by at least 1;
  the detection rate is published as k/15 with its Wilson interval.

## Not built yet (free, after the judge provider is chosen)

- The judge adapter for the chosen provider in `score-all.ts`, with its
  contract test (request shape, structured output, no key in logs). It needs
  that provider's API key, which is the maintainer's to create.
- The script that writes `RESULTS.md` from the artefacts and its `--check`
  in CI (methodology point 4), the kappa computation, and the perturbation
  generator.

## Cost

`bun run estimate:cost -- --ids <the five>` on this commit:

| Question | Low | Central | High |
| --- | ---: | ---: | ---: |
| 02-cfo-buyback-briefing | $1.10 | $4.80 | $10.46 |
| 05-supply-chain-acquisition | $1.08 | $4.70 | $10.26 |
| 08-ai-regulation-position | $1.10 | $4.80 | $10.50 |
| 11-family-office-co-investment | $1.12 | $4.62 | $10.65 |
| 12-sodium-ion-plant-morocco | $1.08 | $4.70 | $10.26 |
| **Total** | **$5.48** | **$23.63** | **$52.14** |

Assumptions (`SCENARIOS` in `benchmarks/estimate-cost.ts`):

| | Low | Central | High |
| --- | --- | --- | --- |
| Live prompt size vs mock | ×1 | ×2 | ×3 |
| Searches per web-search call (cap 5) | 2 | 5 | 5 |
| Tokens added per search | 3 000 | 8 000 | 15 000 |
| Output, share of `max_tokens` (thinking included) | 25% | 50% | 100% |
| Synthesis passes, `strict_editorial` format | 1 | 1.5 | 2 |
| Synthesis rerun | no | as in the mock run | yes |
| Stage retries | 0 | 0 | the costliest stage once |

Prices: Claude Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10 per million tokens,
web search $10 per 1000 (`src/llm/pricing.ts`, 2026-11-02). No prompt
caching is assumed.

**Ceiling.** The cap stops a briefing before its next call, so one call can
overshoot it. The costliest single call in the high scenario is adversarial
(Opus, ≈ 481 000 input and 16 000 output tokens, 5 searches): ≈ $2.29. Five
briefings at most $12 + $2.29 each: **$71.45**.

**Judge.** ≈ 8 000 input and up to 4 000 output tokens per call (briefing,
grid, reasoning). 15 calls for the noise band and 15 for the planted errors:
30 × (8 000 × $2 + 4 000 × $10) / 10⁶ = **$1.68**; **$3.36** with a 2× margin.

**What GO authorizes**: the two `bench:live` commands above (expected ≈ $24,
at most $71.45 on Anthropic) and the judge passes once built (at most ≈ $3.40
on the judge provider). Anything else, a rerun beyond the second attempt
included, needs a new estimate.
