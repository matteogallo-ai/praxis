# Pre-registration: single-call baseline

Written and committed before the baseline script exists and before any
paid call. Changing it after the run is an amendment: it goes in
"Amendments" below with its date and reason, and the original text stays.

## Question it answers

Does Praxis's seven-stage pipeline produce a better briefing than one model
call given the same question, the same format declaration and the same web
search tool? Audit 2026-11-07 (B1) found no comparison of any kind.

## Arms

- **Praxis**: the committed live briefing for question 12
  (`benchmarks/outputs/live/12-sodium-ion-plant-morocco/run-2026-11-04T13-20-16-572Z/brief.md`,
  commit `8df678f`, $4.75). Not rerun.
- **Baseline**: one `completeWithTools` call to `claude-opus-5-5`, the
  strongest model any Praxis stage uses, with Anthropic's server-side
  `web_search` tool. The provider may continue a paused server-tool turn
  (at most 3 rounds); that is one call from the caller's side, as each
  Praxis stage's search is. Its prompt holds the question, the format's
  YAML file verbatim (sections, lengths, tone, sourcing policy, trusted
  domains), the instruction to cite a URL for every factual claim and to
  say "not sourced" when it has none, and Praxis's untrusted-content rule.
  It is written by `benchmarks/single-call-baseline.ts`, committed before
  the run.

## Question

Question 12 only: "Should we build a sodium-ion battery cell plant in
Morocco to supply European carmakers?" (`mckinsey-style-note`). It is the
hard case of `benchmarks/questions.yaml`: little is published on
sodium-ion cells in Morocco, so the trap is citing lithium-ion sources for
sodium-ion claims. It was already published live, so it is not held out.

One question, one run per arm: whatever the review finds describes this
question only. No rate, interval or test is computed from it.

## Cost and cap

Estimated by `bun run benchmarks/single-call-baseline.ts --estimate`
before the run, printed in the PR. Hard cap: **$5.00** for the run,
enforced by the cost ledger (`UsageLedger`, which reserves each request's
worst case before sending it). One attempt. If it fails or stops at the
cap, the failure is committed as the result; no second attempt without a
new approval.

## What is measured

By code, from the two Markdown files: word count per section, number of
distinct cited URLs, claims-with-URL per section. Reported as counts, not
as a quality measure.

By a human (Matteo), blind: both briefings are reduced to the format's six
sections and their cited sources, in the same layout, labelled A and B by
a seeded coin flip (`benchmarks/review/q12/`), the key in a separate file.
The grid is `benchmarks/review/REVIEW_GRID.md`. The reviewer fills
`grades.md`, commits it, and only then opens `key.json`.

## Decision rule, written before the run

- If the reviewer prefers the baseline, or calls it a tie: the README and
  the system card say that on question 12 a single call matched or beat
  the pipeline, and Praxis's value over a single call is unproven.
- If the reviewer prefers Praxis: they say so for question 12 only, with
  the grid, and that one question does not establish a general advantage.
- Either way the cost of each arm is published next to the verdict.

## Known limits

- The reviewer wrote Praxis and knows its style; the blinding removes
  labels and Praxis-only sections but cannot remove the style.
- n = 1 question, one sample per arm; model output varies between runs.
- The Praxis briefing ran on 4 Nov 2026 and the baseline later: the web
  changed in between.

## Amendments

- 7 Nov 2026, before the run, while writing the script: the ledger's worst
  case for 3 rounds of up to 8 searches is $22.16, over the $5.00 cap, so
  the cap could not be enforced with those bounds. The baseline gets at
  most **5 searches per round and 2 rounds** (worst case $4.69). The text
  above ("at most 3 rounds") is superseded by this line. The pipeline's
  four searching stages are not bounded the same way, so the baseline
  searches less than Praxis did.
- 7 Nov 2026, after the run, before any review: an independent review of
  the pack found layout that differs between the arms. The pack now writes
  bold, list markers and dates one way for both (`uniformLayout` in
  `benchmarks/review-pack.ts`); the wording is unchanged, as above. The
  same review corrected the first amendment's reason: the ledger enforces a
  $5.00 cap whatever the bounds, by stopping the run; with 3 rounds of 8
  searches the run could have been stopped at the cap before it finished,
  and the lower bounds keep its worst case under it. A further limit: the
  arms can be told apart from the repository (the scripts, the run
  directories, `key.json`); the blinding holds only if the review is made
  from `A.md` and `B.md` alone.
