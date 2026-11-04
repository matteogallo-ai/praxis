# Architecture decision records

| ADR | Decision |
| --- | --- |
| [0001](0001-getting-json-from-the-model.md) | Getting JSON out of each stage: the text after the last tool block, the largest balanced object that parses (nothing repaired), and the output schema sent as `output_config.format` for scoping and synthesis |
| [0002](0002-degrade-on-insufficient-sourcing.md) | Degrade a briefing with an "Insufficiently sourced" section instead of aborting it under `strict` sourcing |
| [0003](0003-source-trust-criteria.md) | Accepted: a company's own site is primary for its own facts only, its domains taken from an explicit, reviewed, versioned list; specialist press joins `tier_2` only on six written criteria; law-firm memos, vendors' content and aggregators stay untrusted |

Each record states the context, the options weighed and why one was chosen.
A record is not edited after it is accepted; a later decision that changes it
gets its own record.

## What I'd do differently

Each point is something the repository's history shows went wrong, and what
would have caught it earlier.

1. **One real briefing before the second stage.** Seven stages and four
   formats were built and tested on fixtures before a single live run. The
   first live runs failed five times out of five, on three causes (sources
   missing under `strict`, prose before the JSON, a 60 s timeout during web
   search; CHANGELOG 1.2.1) that one early end-to-end call would have shown.
   Mock tests prove the wiring; only a live call proves the model fits it.
2. **Never score fixture text.** v1.2.1 published quality scores computed on
   mock briefings, which replay hand-written fixtures chosen by format; the
   scores graded the fixtures, and a planned re-score would have graded a
   hand edit. They are withdrawn (`docs/benchmarking-methodology.md`). A
   score needs model output, a held-out set and a judge checked against a
   human first.
3. **Design for partial failure from the start.** A strict sourcing failure
   at stage 4 threw away stages 1–3, and nothing was saved between stages.
   Checkpoints, `--resume`, bounded retries and the degraded section came
   after the failures (ADR 0002). In a pipeline of paid calls, each stage's
   output is worth keeping before the next one runs.
4. **Publish a dependency before depending on it.** PromptLang's lexer and
   parser were imported through a `tsconfig` path to a sibling checkout, so
   for months a fresh clone did not build alone. Depending on a published,
   pinned package from day one, as `@promptlang/core` is now, would have
   kept the repository self-contained.
5. **Claims backed by tests from the first README.** The README once called
   the project feature-complete and running live. `docs/CLAIMS.md` and the
   `check:claims` CI job now tie each claim to passing tests; written first,
   they would have stopped the claim.
6. **Inject the clock from the start.** Freshness depends on today's date,
   and tests that read the real clock passed until the fixtures' sources
   would have aged past the format's limit; the CLI clock and the date-moved
   CI job came late (`PRAXIS_NOW`).
