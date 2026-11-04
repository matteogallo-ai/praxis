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
`05-supply-chain-acquisition/run-2026-11-04T08-33-09-131Z/` (step 0). The
same question was rerun at `3a7ca6a` (the sourcing fixes, #31 to #35) as
`05-supply-chain-acquisition/run-2026-11-04T10-52-05-822Z/`.
What a live briefing costs is estimated by `bun run estimate:cost`, not
stated here.

## Question 05: step 0 and its rerun

Both runs are `mckinsey-style-note` under `strict`. They are two samples
of one question: the model searched and cited differently each time, so a
difference between them is not by itself an effect of the fixes. The `ok`
and `stale` rows were measured under different rules: step 0 judged
freshness on the retrieval time, so its sources could not be stale, and a
source the rerun counts as aging would have been `ok` at step 0. Counts
are items, read from each run's `metadata.json` (`sourcing`).

| | Step 0 (08:33 UTC) | Rerun (10:52 UTC) |
| --- | --- | --- |
| Items | 44 | 47 |
| Sourced from a trusted domain (`ok`) | 9 | 15 |
| From an untrusted domain | 24 | 17 |
| Without a source (`missing`) | 11 | 8 |
| Duplicated | 0 | 2 |
| Stale or aging (`stale`) | 0, not measured (see Errata) | 5, all past the format's warning age; the one source past the limit is counted as untrusted |
| Freshness unknown (no publication date) | not recorded | 23 |
| Requester-provided, not sourceable | not recorded | 7 |
| Options' and critique's untrusted citations | not checked | 3 options, 3 critique |
| Flagged insufficiently sourced | yes | yes |
| Cost | $3.51 | $3.69 |
| Stages' wall time | 7.8 min | 8.4 min |

What the rerun shows that step 0 could not:

- 23 of its cited items have a source that states no publication date.
  Their age is unknown, and none of them is counted fresh.
- 7 facts concern only the requester (its budget, footprint, hurdle rate).
  The briefing lists them apart and counts none as sourced.
- Its options cite three untrusted hosts; under `strict` they are listed
  among the 29 entries of "Insufficiently sourced" with the 17 untrusted
  and 8 missing items. The one source past the age limit is also
  untrusted, and is listed for both reasons.
- `investor.dsv.com`, DSV's own site, is cited by the critique for DSV's
  own results and judged untrusted. ADR 0003's first-party rule covers the
  research, stakeholder and risk stages only, so it would leave this
  critique citation untrusted.

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
