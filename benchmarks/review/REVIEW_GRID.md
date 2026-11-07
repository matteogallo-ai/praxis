# Review grid: blind comparison of two briefings

Protocol: [`docs/preregistration/single-call-baseline.md`](../../docs/preregistration/single-call-baseline.md).
One reviewer, the maintainer. Read `q12/A.md` and `q12/B.md`, fill
`q12/grades.md`, commit it, and only then open `q12/key.json`. Do not open
the source briefings under `benchmarks/outputs/` before the grades are
committed: their paths name the arm.

## Order

1. Read A, then B, once each, without grading.
2. Check claims (criterion 2) before scoring anything else.
3. Score criteria 1 and 3–5 for A, then for B.
4. Give the preference, then the one-paragraph reason.
5. Commit `grades.md`. Then open the key.

## Criteria (1 = poor, 4 = good)

| # | Criterion | 1 | 4 |
| --- | --- | --- | --- |
| 1 | **Answers the question.** A decision a board could act on, stated early, with its conditions. | No decision, or one buried in hedges. | A clear decision in the first section, with what would change it. |
| 2 | **Checked claims are right.** See "Claim check" below. | 2 or more of the 5 claims wrong or unsupported by their source. | All 5 supported by the cited page. |
| 3 | **Sodium-ion, not lithium-ion.** The question's trap: a sodium-ion claim resting on a source about another chemistry. | A central claim rests on an LFP or generic battery source. | Every sodium-ion claim cites a sodium-ion source, or is marked as unsourced. |
| 4 | **Says what it does not know.** Gaps, conflicting figures and unsourced points are named, not papered over. | Unsourced figures stated as fact. | Gaps and conflicts named where they matter. |
| 5 | **Useful to the reader.** Length, order and density fit a ~1200-word decision note. | Padding, repetition, or missing sections. | Every section earns its place. |

## Claim check (criterion 2)

Per briefing, the claims are chosen by rule, not by taste: in each of the
sections Situation, Complication, Answer, Supporting Arguments and So What,
the **first sentence that carries a numbered marker** `[n]`. If a section
has none, take the next marked sentence after it in the document. Open the
cited URL and record: supported / not supported / page unavailable. A page
that is unavailable counts as not supported.

## Preference

A, B or tie, and one paragraph saying why. A tie is a valid answer.

## What this grid cannot measure

One question, one sample per arm, one reviewer who wrote one of the two
systems. The result describes this question; it is not a rate.
