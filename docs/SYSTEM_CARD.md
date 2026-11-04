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

**Status: one briefing has completed against a real model** (question 05,
4 Nov 2026); its quality is not yet reviewed. 7 live attempts: 6 failed
(5 in 1.2.1 without committed records, 1 on 3 Nov 2026), 1 completed
(4 Nov 2026). Every other result on this page comes from the mock provider,
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

## Measured performance

| What | n | Result | 95% interval |
| --- | --- | --- | --- |
| Live briefings completed | 7 attempts | 1 of 7 | 3%–51% (Wilson) |
| Live briefing quality | 0 | not measured | — |
| Live cost and latency per briefing | 1 | $3.51, 7.8 min of stages; n too small for the targets in [`docs/SLO.md`](SLO.md) | — |
| Mock pipeline end to end | 12 benchmark questions | completes; outputs committed under `benchmarks/outputs/mock/` | not a quality measure |

The mock row proves the wiring: stage order, validation, rendering,
checkpoints, cost accounting with simulated usage. The text it produces is
fixture text chosen by format, so scoring it would grade the fixtures
(`docs/benchmarking-methodology.md`). The live rows are the ones that
matter, and they are empty or failing.

## Known limits

- **Faithfulness is not checked.** Code checks that a claim has a source,
  that the source was returned by search, is fresh and is on a trusted
  domain; it does not check that the page says what the claim says.
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
- **Freshness uses the retrieval time**, not the page's own date (C21).
- **English only** in prompts, formats and tests.
