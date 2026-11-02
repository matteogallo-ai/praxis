# Benchmarking methodology

Praxis has two kinds of benchmark output, and only one of them can say
anything about quality.

| Run | What it proves | What it cannot prove |
| --- | --- | --- |
| `bun run bench:mock` (renderer smoke test) | Every stage, the sourcing checks and the renderers are wired; output is reproducible. | Anything about what a model writes. |
| `bun run bench:live` (paid) | Whether the pipeline completes against a real model, and at what cost. | Quality, until the output is scored as below. |

## The old benchmark was circular

From v0.10 to v1.3.0 the published "AI-assisted qualitative scoring" graded
the **mock** briefings with a Claude model and reported 7 criteria on a 1–5
scale. Three faults made those numbers meaningless as a measure of Praxis:

1. **The input was not model output.** The mock provider replays fixtures
   written by hand and selected by format, not by question; every briefing of
   a given format had the same body text. Eleven scores covered four
   distinct texts.
2. **The score could be moved by editing fixtures.** v1.3.0 rewrote four
   opening-section fixtures to lead with the decision and planned to re-score
   them, in a v1.3.1 release, to show that `framing_clarity` improved. The
   measurement would have graded the hand edit; v1.3.1 was abandoned.
3. **No check on the scorer.** The judge was the same model family as the
   pipeline's default, and it was never compared with a human reading.

Those scores are withdrawn from [`benchmarks/RESULTS.md`](../benchmarks/RESULTS.md),
and `benchmarks/score-all.ts` refuses mock briefings.

## The method for live briefings

Adopted on 2026-11-02. No briefing has been scored with it: none has completed
live ([`CLAIMS.md`](CLAIMS.md) C14, C18).

A score is published only when all of the following hold. None of the tooling
for points 1 and 4 exists today; it is roadmap work (C14, C18).

1. **Only live output is scored.** Each scored briefing has a committed run
   artefact under `benchmarks/outputs/live/<date>/`: the briefing, and a
   `metadata.json` with the model IDs, prompt versions, tokens, cost, duration
   per stage and git SHA. Failed runs are committed with their cause. Today's
   live metadata records none of tokens, cost or prompt versions.
2. **The rubric** is the 7-criterion grid below, each scored 1–5 (total /35).
3. **The judge is checked.** Either the judge is from another model family
   than the pipeline, or a human annotates at least two briefings on the same
   grid; judge–human agreement is computed and published next to the scores.
   A judged score without that check is labelled *unvalidated*.
4. **Every number states its `n`.** Scores in `RESULTS.md` come from a script
   that reads the artefacts, and CI runs it with `--check` so the page cannot
   drift from the data. Until that script exists, `RESULTS.md` publishes no
   score.

## The rubric

1. **Framing clarity**: is the question stated, and the reader oriented, in
   the first paragraph?
2. **Non-hedging**: does the brief commit, or hedge with "may", "could",
   "arguably"?
3. **Decisive recommendation**: is there a clear call to action?
4. **Concrete trade-offs**: are cost, time and exposure dimensioned?
5. **Perceived sourcing**: do the citations look credible to a senior reader?
6. **Adversarial usefulness**: does the critique steelman real objections?
7. **Format fidelity**: does it read like the target format?

| Score | Meaning |
| --- | --- |
| 1 | Unusable on that criterion. |
| 2 | Below what a junior analyst would produce. |
| 3 | Passable; most competent output lands here. |
| 4 | Above expectations. |
| 5 | Excellent; surprises a senior reader. |

The scoring prompt is `benchmarks/scoring-prompt.txt`; the parser
(`parseScoringPayload` in `benchmarks/score-all.ts`) rejects anything but the
expected JSON.

## Cost

Every live run and every scoring pass is a paid API call. Each needs a
written estimate (tokens × price per model × number of briefings, web search
included) and the maintainer's approval before it runs.
