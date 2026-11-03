# Live benchmark artefacts

Live-provider runs of `bun run bench:live`, one directory per question.
Which questions run, under what cap and with whose approval is
`docs/live-proof-protocol.md`; every run there is paid and needs a cost
estimate and the maintainer's GO.

Each run writes, in its question's directory:

- `metadata.json` when the briefing completes: question, format, timing,
  word counts, critique summary, rerun status, usage and cost per stage,
  and the commit and prompt versions it ran on;
- `brief.md`, `brief.pdf`, `brief.docx` for the format's output targets;
- `error-<time>.json` when it stops: the cause, what each stage spent, and
  the same provenance. Failures are kept and committed: they are
  measurements too.

The first live record is `05-supply-chain-acquisition/error-*.json`.
What a live briefing costs is estimated by `bun run estimate:cost`, not
stated here.
