# Benchmark results

## Live briefings

No live briefing has completed. The only recorded live benchmark (v1.2.1,
August 2026) aborted on all 5 of the 5 briefings it attempted, before any
artefact was written:

| Briefings | Cause |
| --- | --- |
| 3 of 5 | `SourcingValidationError` under the `strict` policy: 7 to 8 of 8 research findings carried `SOURCE_MISSING` instead of a URL from the `web_search` results. |
| 1 of 5 | The research stage's output began with prose before the JSON, and `JSON.parse` failed. |
| 1 of 5 | `AnthropicTimeoutError` at the 60 000 ms default during the research stage's tool-use loop. |

Source: [`CHANGELOG.md` § 1.2.1](../CHANGELOG.md), "Deferred — live empirical
run". Live artefacts are committed under `benchmarks/outputs/live/`; it holds
none.

## Renderer smoke test (no model involved)

`bun run bench:mock` runs the 11 entries of `questions.yaml` through the full
pipeline on the mock provider and writes `brief.md`, `brief.pdf`,
`brief.docx` and `metadata.json` for each under `benchmarks/outputs/mock/`.
It proves that every stage, the sourcing checks and the three renderers are
wired together, and that the output is reproducible byte for byte
([`docs/CLAIMS.md`](../docs/CLAIMS.md) C03, C08, C12).

It is not a quality measure: the mock provider replays hand-written fixtures
chosen by format, not by question, so a score on its output grades the
fixtures and not a model.

## Withdrawn

The "AI-assisted qualitative scoring" published here on 2026-08-20 scored the
11 mock briefings above with a Claude model. For the reason just given it
measured the fixtures, and it is withdrawn; `benchmarks/score-all.ts` now
refuses mock briefings. The scoring method for live briefings is described in
[`docs/benchmarking-methodology.md`](../docs/benchmarking-methodology.md).
