# Live proof protocol (Part C)

The first live briefings Praxis would publish: what runs, how it is checked,
what it may claim, and what it costs. Step 0 has run: its first attempt
failed, its second completed ([§ Step 0](#step-0-one-briefing-capped-at-10)). Each paid step
waits for its own GO from the maintainer ([§ What each GO authorizes](#what-each-go-authorizes)):
first one briefing, then the other four, then the judge.

## What it can prove

- **Completion and cost**: whether the pipeline finishes against Anthropic on
  real questions, and what each stage spends ([`CLAIMS.md`](CLAIMS.md) C14).
- **Quality, as examples**: five judged briefings are five examples, not a
  rate. Every proportion is published with its `n` and a 95% Wilson
  interval; with n = 5, 5/5 completed reads "57%–100%".

It cannot prove that one prompt or model is better than another: that needs
the noise band of repeated runs (DoD B4), which this protocol does not
measure, on the pipeline or on the judge ([§ Roadmap](#roadmap-not-run-by-this-protocol)).

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
2. A clean worktree at `origin/main`: `run-all.ts` refuses a live run over
   modified tracked files, because the artefacts record the commit.
   The run starts from its own worktree, never from a checkout an agent or
   another session works in: on 4 Nov 2026 a `git checkout main` made for
   step 0 in the shared checkout moved an agent's branch under it
   mid-commit. From the main checkout:
   `git fetch origin && git worktree add --detach ../praxis-live origin/main`
   (a stale `origin/main` would put the run of record on the wrong commit),
   then in `../praxis-live`: `bun install --frozen-lockfile`, and the key in
   that directory's `.env` or the environment (Bun reads `.env` from the
   working directory; the worktree has none). The artefacts land in the
   worktree's `benchmarks/outputs/live/`; commit them there after
   `git switch -c <branch>` (the worktree is detached), then
   `git worktree remove ../praxis-live`.
3. `ANTHROPIC_API_KEY` set; `PRAXIS_NOW` unset (live freshness uses the real
   date); `ANTHROPIC_MODEL` unset, so each stage runs on its `@model` as
   estimated.
4. `bun run estimate:cost -- --ids 05-supply-chain-acquisition --cap-usd 10`
   re-run on that commit, in case prompts or prices changed since this page.

## Run (paid, one GO per step)

### Step 0: one briefing, capped at $10

```bash
bun run bench:live -- --max-cost-usd 10 --ids 05-supply-chain-acquisition
```

`05-supply-chain-acquisition` is the cheapest representative of the five:
its format, `mckinsey-style-note`, is the one two of the five use (the hard
case included), and it is not `strict_editorial`. Question 12 costs
within a cent of it but is the hard case, built to stress sourcing, not to represent.
Question 11 is $0.07 cheaper in the central case but atypical (synthesis
regenerated under `strict_editorial`, $15.54 in the high case).

$10 is a limit, not a fuse: before each request the ledger reserves that
request's worst case and sends it only if what is spent, what requests in
flight hold and that worst case fit in $10 ([§ Ceiling](#ceiling)). The
estimator's stages, high scenario, cumulative: scoping $0.17, research
$1.00, stakeholders $1.89, risks $3.14, options $5.45, synthesis $6.46,
adversarial $9.17. Walked through the reservations
(`bun run estimate:cost -- --ids 05-supply-chain-acquisition --cap-usd 10`):

| Scenario | Under $10 |
| --- | --- |
| Low | completes at $1.40 |
| Central | completes at $5.96 |
| High | stops before adversarial at $9.17 |

The high scenario retries its costliest stage once, and that stage is
adversarial (Opus, 5 searches, 16 000 `max_tokens`): the first attempt
runs, then the retry reserves $2.99 on top of $9.17 spent, more than $10
allows. Without that retry the high case yields a brief under $10, with
its synthesis rerun skipped at $9.17.
A run that stops leaves no brief: `error-*.json` records what each stage
spent, which is the measurement step 1 is costed from. The high case would
yield a brief from a cap of $9.46 (rerun skipped) and finish in full from
$10.26, without a retry; with one stage retry, $12.17 and $12.97. A cap
reached during the synthesis rerun keeps the complete pre-rerun brief,
with `rerun.skipped` in its `metadata.json`.

**First attempt, 2026-11-03.** It stopped at risk: the answer was cut at
its 16 000 `max_tokens` (`TruncatedOutputError`, not retried). It spent
$0.92: scoping $0.03, research $0.20, stakeholders $0.24, risks $0.44
(`benchmarks/outputs/live/05-supply-chain-acquisition/error-2026-11-03T14-47-43-035Z.json`).
Risk's ceiling is now 32 000, twice the one its answer was cut at
(`src/agents/stage-limits.ts`), and the figures above include it. The
second attempt is the same command: `bench:live` keeps no checkpoints, so
it is a new run that pays the first three stages again.

**Second attempt, 2026-11-04.** It completed on commit 7c75a06: $3.51 under
the $10 cap, 469 s of stages, 23 web searches; the adversarial review
raised 0 critical, 3 material and 4 minor points and the synthesis was
rerun; the brief was flagged insufficiently sourced: 11 of 44 items without a source, 24 from untrusted domains
(`benchmarks/outputs/live/05-supply-chain-acquisition/run-2026-11-04T08-33-09-131Z/`).
Completion says nothing of quality: the checks below come first.

### Step 1: the other four, capped at $14 each

```bash
bun run bench:live -- --max-cost-usd 14 --ids 02-cfo-buyback-briefing,08-ai-regulation-position,11-family-office-co-investment,12-sodium-ion-plant-morocco
```

Only after step 0 completed, or stopped at its cap, without a timeout, and
after `estimate:cost` has been re-costed from step 0's measured usage.

- `--max-cost-usd 14` caps each briefing the same way. Walked through the
  reservations, every question's high case yields a brief under it;
  question 11, the costliest ($15.54 in full), does so with its rerun
  skipped, at $13.48. `tests/benchmarks/live-protocol.test.ts` fails if
  one would not.
- Stop after step 0 if it failed for a systematic cause (authentication,
  model id, request shape) or if any stage timed out: fix it, free, before
  spending more. A timed-out request is charged its worst case, so
  timeouts eat the cap fast ([§ Ceiling](#ceiling)).
- **One attempt per question.** The rule is procedural: `run-all.ts`
  refuses no question, so any question can be run again by the same
  command. Do not: running a question again is another attempt and needs a
  new estimate and a new GO. A failure leaves
  `benchmarks/outputs/live/<id>/error-<time>.json` (cause, usage spent,
  commit, prompt versions, redacted); a completed run leaves `brief.md`,
  `brief.pdf`, `brief.docx` and `metadata.json` in
  `benchmarks/outputs/live/<id>/run-<start time>/`, so a second completed
  run sits beside the first and never over it. Scoring and the blind-review
  export read a question's latest completed run.
- Then: `find benchmarks/outputs/live -type f ! -name README.md ! -name SHA256SUMS ! -path '*.staging/*' | sort | xargs shasum -a 256 > benchmarks/outputs/live/SHA256SUMS`
  and one commit with every artefact, failures included (DoD B6).

## Checks, in order

**1. Deterministic, before any judge** (DoD B3), read from each
`metadata.json`:

| Check | Pass when |
| --- | --- |
| Completed | `metadata.json` exists (else the `error-*.json` cause is reported) |
| Sourcing | `sourcing.counts`; `insufficiently_sourced` reported, never hidden |
| Format conformance | `synthesis.forbidden_terms_found = 0`, `sections_over_length` (count) with `sections_over_length_ids` (which sections) and `deviation_pct` reported; step 0's record predates the ids and gives the count only |
| Adversarial | `critical_count`, `material_count`; `rerun.performed` |
| Cost and latency | `usage.stages.*.cost_usd` and `duration_ms`, against [`SLO.md`](SLO.md) |
| Hard case | completed and `insufficiently_sourced: true` with the unsourced sodium-ion claims listed (its `intent`); an abort fails it; `bun run hard-case:sources` lists each sodium-ion sentence of the model's sections and each sodium-ion finding, with each source it cites (or none) and that source's chemistry, read from title and URL, for a human to confirm |

**2. Judge**, on completed briefings only, under its own GO
([§ Judge](#judge)).

- **Model**: Opus 5 (`claude-opus-5`, `JUDGE_MODEL` in
  `benchmarks/score-all.ts`) through the Message Batches API, chosen by the
  maintainer on 2026-11-03 from the variants of [§ Judge](#judge). Every
  stage runs on Claude Opus 5.5 or Sonnet 5.5, so none scores the model
  that wrote the brief; a test fails if `JUDGE_MODEL` becomes any stage's
  `@model`. It thinks by default, within the same `max_tokens` as its
  answer, and can stop with `refusal`.
- **Cost cap**: `score-all.ts` refuses a paid run without
  `--max-cost-usd`. Before submitting, it reserves the batch's worst case:
  each prompt at 2.5 characters per token plus all 8 000 `max_tokens`, at
  batch prices (half the standard price). A batch whose worst case passes
  the cap is not sent; `--dry-run` prints that worst case. The 2.5 is an
  allowance, as for the pipeline ([§ Ceiling](#ceiling)): a briefing that
  tokenizes below it costs more than it reserved, and a spend past the cap
  makes the run exit non-zero. Effort is `medium`. A `refusal` or
  `max_tokens` answer fails its briefing and is charged; errored, canceled
  and expired requests are not billed. A file under
  `benchmarks/.scoring-cache/` records the submitted batch, so a rerun
  polls it instead of paying for a second one; the raw results are kept
  there as `batch-<id>.jsonl`. A rerun whose briefings differ from the
  pending batch's (a cache entry past its 24 hours, say) is refused until
  that file is deleted.
- **Limitation, same family.** Judge and pipeline are all Claude models,
  trained by the same company on overlapping data. A bias they share (a
  phrasing they all reward, a claim they all accept) is not seen by the
  judge. The standard asks for different families "when possible"
  (`ENGINEERING_STANDARDS.md`); here it is not: the maintainer has no
  account with another model provider. The human review below is the only
  check on that bias, and it is small.
- **Prompt**: `benchmarks/scoring-prompt.txt`, the briefing delimited as
  untrusted content (`interpolateScoringPrompt`). The judge has no web
  access: it scores the text, and cannot tell whether a cited page exists.
- **Grid**: the seven criteria scored 1–5 in
  [`benchmarking-methodology.md`](benchmarking-methodology.md#the-rubric)
  (total /35).
- **One judgment per briefing**: that judgment is the score. Its noise is
  not measured, so a one-point gap between two briefings is published as
  is, never as a difference ([§ Roadmap](#roadmap-not-run-by-this-protocol)).

**3. The judge is checked** (DoD B2), against a human only. Its scores are
called *indicative* only if that threshold holds; otherwise they are
published as *unvalidated*, with the numbers that failed.

- **Against a human**: the maintainer scores two briefings blind on the
  same grid: `05-supply-chain-acquisition` (step 0) and the first of 02, 08,
  11, 12 in id order that completes; if 05 does not complete, the first two
  of those that do. `bun run export:annotation -- --ids
  <the two> > review.jsonl` writes them for an annotation tool, one JSON
  object per line: question, format, the brief's Markdown, and the seven
  criteria with their definitions and an empty `score` (1–5) and `note`.
  Nothing the judge wrote is in the file. The brief is model output built
  on web excerpts: the annotation tool renders it as plain text, not as
  Markdown or HTML. The scores are filled in and the file committed, its
  SHA-256 recorded, **before the judge's GO**, so no judge score can be
  seen first. The maintainer will already have read step 0's run record
  while applying the stop rule; that is said next to the agreement. The maintainer knows the pipeline:
  one informed rater, published as such. Agreement over the 14 criterion
  pairs: exact and within-one agreement, and quadratic-weighted Cohen's
  kappa. **Threshold: kappa ≥ 0.6.** The 14 pairs come from one rater and
  two briefings, are not independent, and support no interval; kappa is
  unstable when scores bunch at 3–4. Passing this check makes the judge's
  scores *indicative*, never *validated*, and CLAIMS C18 stays on the
  roadmap.

**What the five consume.** Running and publishing these five test
questions spends them: from then on they are dev data. A later held-out
claim uses the three test questions left (03, 07, 10) or new ones.
Question 05 was spent before the others: the sourcing fixes (#31, #32, #34, #35, #37, #38 and #39)
were designed from its step 0 failures. Status: q05 used for development after step 0; no longer held-out.

## Roadmap (not run by this protocol)

The judge's own reliability ([`CLAIMS.md`](CLAIMS.md) C23). Neither is
built; neither result exists, and no published score depends on them.

- **Noise band**: each briefing judged 3 times; the median per criterion
  would be the score, the spread published next to it.
- **Against planted errors**: for each briefing, three copies with one fault
  each, all detectable from the text alone, each with the criterion it must
  lower, fixed before any judging:

  | Fault | Criterion |
  | --- | --- |
  | A figure changed so it contradicts the same figure elsewhere in the brief | 4 Concrete trade-offs |
  | A citation to a source id absent from the brief's own source list | 5 Perceived sourcing |
  | The recommendation reversed against its own analysis | 3 Decisive recommendation |

  Two controls: the unchanged briefing, and a neutral copy (three sentences
  reworded, meaning kept). Each copy and each control would be judged 3 times. A
  fault is detected when the median on its criterion is at least 1 below the
  unchanged briefing's median; the neutral copy measures how often that
  happens with no fault. **Threshold: at least 12 of 15 faults detected and
  at most 1 of 15 neutral criterion readings (the same three criteria, five
  briefings) 1 or more below the unchanged median**, each published as k/15
  with its Wilson interval. It needs a perturbation generator.

## Not built yet (free, before the judge's GO)

- Reading the maintainer's scores back from the annotation file, and the
  agreement computation.
- The script that writes `RESULTS.md` from the artefacts and its `--check`
  in CI (methodology point 4).

## Cost

`bun run estimate:cost -- --ids <the five> --cap-usd 14` on this commit:

| Question | Low | Central | High |
| --- | ---: | ---: | ---: |
| 02-cfo-buyback-briefing | $1.43 | $6.11 | $13.21 |
| 05-supply-chain-acquisition | $1.40 | $5.96 | $12.92 |
| 08-ai-regulation-position | $1.43 | $6.10 | $13.26 |
| 11-family-office-co-investment | $1.46 | $5.89 | $15.54 |
| 12-sodium-ion-plant-morocco | $1.40 | $5.96 | $12.92 |
| **Total** | **$7.11** | **$30.02** | **$67.84** |

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

Prompt sizes are the mock run's, read at the 2.73 characters per token
Anthropic's count_tokens endpoint measured on 66 rendered prompts of 4 questions,
one per format: 02, 05, 08, 11 (`benchmarks/token-counts/`, 2026-11-04;
2.60 to 3.04 per request). Every question, 12 included, is read at that
one ratio. The mock scoping answers name no requester-provided facts, so
the later stages, which embed the scoping output, are measured without them. Each web-searching call re-reads its context after every search,
model output included. Prices: Claude Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10 per
million tokens, web search $10 per 1000 (`src/llm/pricing.ts`, 2026-11-02).
No prompt caching is assumed.

### Step 0 alone

`bun run estimate:cost -- --ids 05-supply-chain-acquisition --cap-usd 10`:

| | Low | Central | High |
| --- | ---: | ---: | ---: |
| Estimate | $1.40 | $5.96 | $12.92 |

- Ceiling: **$10.00**, timeouts included, within the allowances below. In
  the high case the run stops before adversarial's retry at $9.17 rather than
  reaching $12.92.

The prompt sizes are measured; the search sizes, output shares and the
growth of live upstream outputs over the fixtures stay assumptions:
count_tokens refuses requests that carry `web_search`. Step 0 itself is the
measurement.

### Ceiling

Each request reserves its worst case before it is sent (`meter` and
`UsageLedger.reserve` in `src/orchestrator/ledger.ts`, `requestCostUsd` in
`src/llm/pricing.ts`):

- its whole `max_tokens` of output, thinking included;
- every search its `max_uses` allows, at $10 per 1000;
- each search adding 15 000 tokens of context (`TOKENS_PER_SEARCH_CEILING`,
  the high scenario's figure), the context re-read after each search, and
  all of the output, thinking included, written before the first search so
  that every later round re-reads it;
- its prompt at 2.5 characters per token (`CHARS_PER_TOKEN_FLOOR`), below
  every request count_tokens measured;
- a `pause_turn` re-send carrying back each earlier round's prompt,
  searches and output.

The request is sent only if what the briefing has spent, what its requests
in flight hold and this worst case fit in the cap; the six synthesis
sections start together, so they must fit together. A request that
answers is charged what it reports. A request that fails or reports no
usage (a timeout, a dropped connection, a body that cannot be read) may
have been billed, so it stays charged at its worst case, recorded as
`unreported_usd` in `metadata.json`; an HTTP error answer (4xx, 429, 5xx)
is not billed and not charged. When a synthesis section fails, the
sections still in flight are awaited, so their usage is in
`metadata.json` before a `--resume` reads it back. A request that cannot be sized (a
model without a price, no `max_tokens`, a web search without `max_uses`)
is not sent.

So a briefing spends at most its cap, timeouts included, **as long as the
allowances hold**. They are assumptions, not bounds the API enforces:

- No request parameter limits what a search returns. A search that adds
  more than 15 000 tokens makes its request cost more than it reserved,
  and the spend can pass the cap by that excess on the requests in flight;
  the next request is then refused.
- Text that tokenizes below 2.5 characters per token (base64, CJK) is
  sized low the same way. The tool definitions and message framing the API
  adds are not counted apart: on the measured prompts, the margin between
  2.5 and the measured 2.61 or more is at least 204 tokens on the shortest
  (scoping, which has no tools) and 219 on the shortest search stage
  (research).
- A run killed by a signal writes no `metadata.json`: what it spent since
  its last stage is unknown to a `--resume`.
- A 429 or 5xx is retried inside one reservation; such responses are not
  billed.

The worst cases are conservative, so a capped run can be refused before it
would really have reached its cap: that is the price of the limit. A
`pause_turn` re-send reserves about 2.5 times its first request (it carries
the first round back), so the walks above assume no stage pauses; a pause
late in a briefing can be refused where the walk completes. To cost step 1
from step 0, read `cost_usd` minus `unreported_usd`: the latter is charged
worst cases, not measured spend. For all
five at $14 the ceiling is $70.00 within the allowances.

### Judge

Opus 5 through the Batch API, chosen 2026-11-03; the other rows are what
it was chosen against. Each call reads ≈ 16 000
input tokens (a mock brief is 4 200–4 800 tokens, a live one 2–3 times
that, plus the grid) and writes up to 8 000 output tokens, thinking
included. The table sizes the full design: per briefing, 3 judgments each
of the unchanged briefing, the neutral copy and the three faulty copies,
15 calls, 75 for the five. This protocol sends one call per briefing
(the noise band and the copies are roadmap): on Opus 5 through the Batch
API, $0.14 per briefing, $0.70 for the five. Prices from Anthropic's pricing page, read 2026-11-03
(`src/llm/pricing.ts`). The table is the full design (roadmap), not this
protocol's cost:

| Variant | Per call | Per briefing | Five | Five, 2× margin |
| --- | ---: | ---: | ---: | ---: |
| Fable 5.1, $10 / $50 | $0.56 | $8.40 | $42.00 | $84.00 |
| Opus 5, $5 / $25 | $0.28 | $4.20 | $21.00 | $42.00 |
| Opus 5, input cached | — | $3.58 | $17.90 | $35.80 |
| Opus 5, Batch API | $0.14 | $2.10 | $10.50 | $21.00 |

- **Opus 5** (`claude-opus-5`): no stage uses it, at half Fable 5.1's
  price, with the same same-family limitation. Cache reads $0.50, writes
  $6.25 per million tokens.
- **Input cached**: the grid and the briefing are the same text in the 3
  judgments of each copy, so the first call writes them to the prompt
  cache (1.25× input) and the next two read them (0.1×), sent one after
  the other. Input per copy falls from $0.24 to $0.116. It saves little,
  because output is most of the bill: 15 × 8 000 tokens at $25 is $3.00 of
  the $4.20.
- **Batch API**: the same calls through Message Batches, 50% off input and
  output, answers within 24 hours. Nobody waits on the judge, so it costs
  only latency. This is the path `score-all.ts` takes.
- Rejected: Opus 5.5 ($0.22 per call). It wrote the scoping, the options
  and the adversarial critique the judged brief rests on, so it would
  score its own work.

## What each GO authorizes

1. **Step 0**: the one `bench:live` command for `05-supply-chain-acquisition`,
   one attempt. Expected ≈ $5.96 (central); at most $10.00, timeouts included,
   within the allowances of [§ Ceiling](#ceiling).
2. **Step 1**, after step 0 and a re-costing from its measured usage: the
   other four. Before that re-costing: at most $14 each, $56.00 for the
   four, within the same allowances.
3. **Judge**, once the briefings are in:
   `bun run score:live -- --max-cost-usd <n>`, one judgment per
   briefing, with `<n>` the worst case `bun run score:dry` prints.
   Expected ≈ $0.70 for the five; `<n>` at most $1.40 (2× margin).

Anything else, a second attempt at a question included, needs a new
estimate.

## Amendments

The plan above is kept as first written. A change to it is recorded here,
dated, before the run it changes; `tests/benchmarks/live-protocol.test.ts`
accepts the original commands plus the changes declared below, nothing
else.

| Date | Step | Change | Reason |
| --- | --- | --- | --- |
| 2026-11-04 | 1 | `10-esg-position` added, before the run | the only test question covered by the first-party list (ADR 0003) |

Step 1 as amended, five briefings under the same cap:

```bash
bun run bench:live -- --max-cost-usd 14 --ids 02-cfo-buyback-briefing,08-ai-regulation-position,10-esg-position,11-family-office-co-investment,12-sodium-ion-plant-morocco
```

Its GO covers at most $14.00 each, $70.00 for the 5, and the judge: ≈ $0.84
for the 6; `<n>` at most $1.68. Question 10 is in
the test split, so running it spends it as held-out evidence, and "What
the five consume" no longer holds for it.
Held-out test questions left: `03-executive-succession-planning` and `07-should-we-divest-consumer-line`.
