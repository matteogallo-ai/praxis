# Live benchmark artefacts

Live-provider runs of `bun run bench:live`, one directory per question.
Which questions run, under what cap and with whose approval is
`docs/live-proof-protocol.md`; every run there is paid and needs a cost
estimate and the maintainer's GO.

Each run writes, in its question's directory:

- when the briefing completes, a `run-<start time>/` directory holding
  `metadata.json` (question, format, timing, word counts, critique
  summary, rerun status, usage and cost per stage, and the commit and
  prompt versions it ran on) and `brief.md`, `brief.pdf`, `brief.docx`.
  A question completed again gets a new directory; none is overwritten;
- `error-<time>.json` when it stops: the cause, what each stage spent, and
  the same provenance. Failures are kept and committed: they are
  measurements too.

The first live record is `05-supply-chain-acquisition/error-*.json` (3 Nov
2026); the first completed briefing is
`05-supply-chain-acquisition/run-2026-11-04T08-33-09-131Z/`.
What a live briefing costs is estimated by `bun run estimate:cost`, not
stated here.
