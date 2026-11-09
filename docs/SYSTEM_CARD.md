# System card — Praxis

After *Model Cards for Model Reporting* (Mitchell et al., 2019), adapted to
a pipeline that calls models rather than trains one.

## Summary

Praxis turns a business question into a written briefing in a declared
format (executive pre-read, McKinsey-style note, corporate position paper,
family-office memo). Seven stages, each calling an Anthropic model, scope
the question, research it on the web, map stakeholders, assess risks,
generate options, write each section (one call per section) and critique the
result. Output: Markdown, PDF, DOCX.

**Status: six briefings have completed against a real model** (questions
05, 08, 10, 11 and 12, 4 Nov 2026): question 05's step 0, flagged insufficiently sourced: 11 of 44 items without a source, 24 from untrusted domains;
question 05's rerun after the sourcing fixes, flagged insufficiently sourced: 8 of 47 items without a source, 17 from untrusted domains; question 08, flagged insufficiently sourced: 15 of 47 items without a source, 16 from untrusted domains;
question 10, flagged insufficiently sourced: 6 of 46 items without a source, 19 from untrusted domains; question 11, flagged insufficiently sourced: 13 of 41 items without a source, 23 from untrusted domains; question 12,
flagged insufficiently sourced: 6 of 49 items without a source, 32 from untrusted domains. A human review (4 Nov 2026) covered only question 10's eight first-party sources, the ones the rule accepted: the reviewer accepted 6 and refused 2 ([review](../benchmarks/outputs/live/README.md#question-10-human-review-of-its-first-party-sources)). The quality of the briefings themselves is reviewed for question 12 only, in one blind comparison with a single model call. Live attempts by commit (3 Nov 2026 and 4 Nov 2026), completed of attempted: fe09710 0 of 1, 7c75a06 1 of 1, 3a7ca6a 1 of 1, 8df678f 4 of 5; 5 earlier attempts, in 1.2.1, failed and left no record. On question 12, a blind review (8 Nov 2026, by Praxis's author;
[grades](../benchmarks/review/q12/grades.md), [key](../benchmarks/review/q12/key.json))
preferred one model call given the same format and search tool, with fewer
searches, at $0.48 to the pipeline's briefing at $4.75. Of one sourced claim
checked per section, 3 of 4 in the pipeline's briefing and 2 of 4 in the
single call's were not supported by their source. Praxis's value over a
single call is not demonstrated: n = 1 question, 1 reviewer who wrote
Praxis, one run per arm, the two runs three days apart on a changing web.
Next step: more questions, and an ablation of the pipeline's stages.
Every other result on this page comes from the mock provider,
which replays hand-written fixtures.

## Owner

Matteo Gallo (matteogallo-ai on GitHub), sole maintainer. Security reports:
[`SECURITY.md`](../SECURITY.md).

## Intended use

- A first draft for a person who will read, check and rewrite it before
  anyone acts on it: an analyst, a consultant, an executive's staff.
- Questions about a decision a business faces (enter a market, buy back
  shares, plan a succession), answerable from public web sources.
- Run by the owner of the Anthropic key, on their machine, with a budget cap.

## Out of scope

- Decisions taken on the briefing without a human reading the sources. The
  briefing can be wrong in ways no check here detects (see "Known limits").
- Legal, medical, tax or investment advice to a person.
- Confidential questions: the question is sent to Anthropic and shapes the
  web searches the model runs (`docs/THREAT_MODEL.md`, LLM02).
- Facts more recent than what web search returns, or behind paywalls.
- Unattended or high-volume use: there is no server, queue or rate control
  beyond one run's budget cap.

## Models

Per stage, from each prompt's `@model` ([`prompts/README.md`](../prompts/README.md#stage-models)
explains each choice, cost against quality): Opus 5.5 for scoping, options and the adversarial review; Sonnet
5.5 for research, stakeholders, risks and synthesis. No fine-tuning; the
provider sends no sampling parameter.

## Data

- **Inputs**: the question, the format YAML, and web pages the model finds
  with Anthropic's server-side `web_search` tool. Pages are untrusted
  (`docs/THREAT_MODEL.md`).
- **Stored**: each run's checkpoints and `metadata.json` (tokens, searches,
  cost and duration per stage) under `.praxis/runs/`, on the operator's
  disk, git-ignored. No telemetry; nothing is sent anywhere but Anthropic.
- **Evaluation data**: `benchmarks/questions.yaml`, twelve business
  questions across the four formats plus a hard case, with a frozen
  dev/test split (4 / 8) in `benchmarks/split.yaml`; no human labels.
  Question 05 is in the test split but was the development case for the
  sourcing fixes (#31, #32, #34, #35, #37, #38 and #39). Status:
  q05 used for development after step 0; no longer held-out. Which test
  questions remain held-out is set by
  [`docs/live-proof-protocol.md`](live-proof-protocol.md) ("Amendments"):
  a test question published live is spent.

## Measured performance

| What | n | Result | 95% interval |
| --- | --- | --- | --- |
| Live briefings completed at `fe09710` | 1 | 0 of 1 | — |
| Live briefings completed at `7c75a06` | 1 | 1 of 1 | — |
| Live briefings completed at `3a7ca6a` | 1 | 1 of 1 | — |
| Live briefings completed at `8df678f` | 5 | 4 of 5 | — |
| Live attempts in 1.2.1, no record committed | 5 | failed, as stated in CHANGELOG 1.2.1 | — |
| Live briefing quality | 1 question | question 12 only, one blind reviewer, against a single call: see the next row | — |
| Single-call baseline, question 12 | 1 per arm | one `claude-opus-5-5` call: $0.48, 13 cited URLs; Praxis at `8df678f`: $4.75; the blind review preferred the single call ([protocol](preregistration/single-call-baseline.md), [grid](../benchmarks/review/REVIEW_GRID.md)) | — |
| Live cost and latency per briefing | 6 | $3.51, 7.8 min of stages; $3.69, 8.4 min of stages; $3.66, 7.9 min of stages; $3.92, 8.4 min of stages; $3.29, 7.7 min of stages; $4.75, 11.9 min of stages; n too small for the targets in [`docs/SLO.md`](SLO.md) | — |
| Mock pipeline end to end | 12 benchmark questions | completes; outputs committed under `benchmarks/outputs/mock/` | not a quality measure |

Each commit is a different version of the pipeline, so completions are
counted per commit and no rate is pooled across them; with at most five
attempts per commit, no interval is given. Question 05 ran at three of
these commits: those are three attempts, not three questions.

The mock row proves the wiring: stage order, validation, rendering,
checkpoints, cost accounting with simulated usage. The text it produces is
fixture text chosen by format, so scoring it would grade the fixtures
(`docs/benchmarking-methodology.md`). The live rows are the ones that
matter: completions per commit, and one blind comparison on one question.

## Known limits

- **Faithfulness is not checked.** Code checks that a claim has a source,
  fresh by its stated date and on a trusted domain; it does not check that
  the URL came from the search, nor that the page says what the claim says.
- **No validated judge.** Quality would be scored by a model whose agreement
  with a human has not been measured (`docs/CLAIMS.md` C18).
- **The judge is from the same model family.** It is Claude Opus 5, a
  model no stage uses, so no stage's output is scored by the model that
  wrote it; but judge and pipeline are all Claude models, and a bias they
  share would not be seen. No judge from another provider is available. The
  only check on that bias is the maintainer's blind review of two briefings
  (`docs/live-proof-protocol.md`), too few to measure it, only to catch a
  large one.
- **Injection resistance is structural, not measured.** Code refuses
  references to things that do not exist and links to sources that were not
  returned; it cannot tell a slanted claim from a fair one.
- **Freshness rests on the date the model reports.** It is judged on the
  publication date the model copies from the page (`published_at`); the
  search prompts ask for it, and a source without one is counted as
  freshness unknown, never as fresh. Nothing checks that date against the
  page's own age (C21), and no live run has measured how often it is given
  or wrong.
- **The question 12 review's blinding rests on the reviewer alone.** A/B key
  generated and committed by the reviewer the day before grading
  ([6e5ed72](https://github.com/matteogallo-ai/praxis/commit/6e5ed72), then
  [1d13a80](https://github.com/matteogallo-ai/praxis/commit/1d13a80));
  blinding is self-enforced. The bias would have favoured Praxis; the result
  went against it.
- **English only** in prompts, formats and tests.
