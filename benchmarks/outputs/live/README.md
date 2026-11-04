# Live benchmark artefacts

Live-provider runs of `bun run bench:live`, one directory per question.
Which questions run, under what cap and with whose approval is
`docs/live-proof-protocol.md`; every run there is paid and needs a cost
estimate and the maintainer's GO.

Each run writes, in its question's directory:

- when the briefing completes, a `run-<start time>/` directory holding
  `metadata.json` (question, format, timing, word counts and the sections
  over their length cap, critique
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

## Errata

Records are never rewritten; corrections to what they say are listed here.

- **`stale: 0` in question 05's run of 4 Nov 2026** (`metadata.json`
  `sourcing.counts.stale`, `brief.md` `sourcing_summary`) does not mean its
  sources were recent. Freshness was then measured on `accessed_at`, the time
  the page was retrieved during the run, so every source was a day old or
  less by construction. No publication date was recorded, so the freshness
  of that run's sources is unknown. Freshness is now judged on the
  publication date (`published_at`), and a source without one is counted as
  freshness unknown, never as fresh (`docs/sourcing.md`).
