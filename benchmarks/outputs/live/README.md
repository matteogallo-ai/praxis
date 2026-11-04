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
`05-supply-chain-acquisition/run-2026-11-04T10-52-05-822Z/`. Step 1 (4 Nov
2026) left one failure, `02-cfo-buyback-briefing/error-*.json`, and four
completed runs, for questions 08, 10, 11 and 12. `SHA256SUMS` lists every
record file's SHA-256.
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
Question 05 is in the test split (`benchmarks/split.yaml`), but the
sourcing fixes were designed from step 0's failures. Status: q05 used for development after step 0; no longer held-out.
The rerun measures the fixes on the question they were built from.

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
| Held-out (test split) | yes | no: q05 used for development after step 0; no longer held-out |
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
  own results and judged untrusted. ADR 0003's first-party rule (#39) also
  judges the critique, but DSV is not in the reviewed list
  (`src/sourcing/first-party-organisations.ts`), so this citation would
  stay untrusted.

## Step 1: questions 02, 08, 10, 11 and 12

Step 1 of `docs/live-proof-protocol.md`, as amended (question 10 added
before the run), ran on 4 Nov 2026, all five at `8df678f`, each capped at $14. One attempt per question. Counts are items, read from each run's
`metadata.json` (`sourcing`); question 02 stopped before any sourcing
report. The estimate is `estimate:cost` at that commit, frozen in
`benchmarks/estimates/step-1.json`. These are five questions, each run
once, so a difference between columns is not an effect of anything.

| | 02 | 08 | 10 | 11 | 12 |
| --- | --- | --- | --- | --- | --- |
| Format | `executive-pre-read` | `position-paper-corporate` | `position-paper-corporate` | `family-office-memo` | `mckinsey-style-note` |
| Outcome | failed: `InvalidAgentOutputError` | completed | completed | completed | completed |
| Items | — | 47 | 46 | 41 | 49 |
| Sourced from a trusted domain (`ok`) | — | 14 | 16 | 4 | 10 |
| From an untrusted domain | — | 16 | 19 | 23 | 32 |
| Without a source (`missing`) | — | 15 | 6 | 13 | 6 |
| Duplicated | — | 2 | 5 | 1 | 1 |
| Stale or aging (`stale`) | — | 0 | 0 | 0 | 0 |
| Freshness unknown (no publication date) | — | 24 | 26 | 24 | 30 |
| Requester-provided, not sourceable | — | 7 | 6 | 7 | 6 |
| First-party sources (ADR 0003) | — | 0 | 8 | 0 | 0 |
| Options' and critique's untrusted citations | — | 1 options, 2 critique | 1 options, 7 critique | 3 options, 3 critique | 1 options, 8 critique |
| Held-out (test split) | yes, spent by this run | yes, spent by this run | yes, spent by this run | yes, spent by this run | yes, spent by this run |
| Flagged insufficiently sourced | — | yes | yes | yes | yes |
| Cost | $2.33 | $3.66 | $3.92 | $3.29 | $4.75 |
| Estimate: low / central / high | $1.44 / $6.13 / $13.25 | $1.43 / $6.12 / $13.30 | $1.43 / $6.12 / $13.30 | $1.46 / $5.90 / $15.57 | $1.40 / $5.97 / $12.95 |
| Cost / central estimate | 0.38 | 0.60 | 0.64 | 0.56 | 0.80 |
| Stages' wall time | 5.3 min to the failure | 7.9 min | 8.4 min | 7.7 min | 11.9 min |

Step 1 spent $17.96 in all, against a central estimate of $30.23 and a
cap of $70. Every completed briefing cost between 0.56 and 0.80 of its
central estimate: in step 1 every completed run ran below its central
case. Question 12 took 11.9 min of stages, above the
10-minute latency target (`docs/SLO.md`; six briefings set no p95).

What step 1 shows:

- Every completed briefing is flagged insufficiently sourced, as both of
  question 05's were.
- Question 10, the only test question the first-party list covers, cites
  eight first-party sources: IFRS Foundation, GHG Protocol and EFRAG for
  their own standards, and the FCA for its own policy statement. They are
  listed in its briefing's "First-party sources" section; whether each
  sentence states the organisation's own fact is not checked by code.
- No source is stale; 24 to 30 cited items per briefing have no
  publication date, so their freshness is unknown.

### Question 02: why it failed

The synthesis section `supporting-evidence` was refused, and so was its one
retry (`src/agents/retry.ts`, per section): 7 synthesis calls for 6 sections,
in a format with no strict editorial pass. The record keeps only the last
refusal: `content_markdown contains a www. address, which viewers turn into
a link: 'www.'`; the first one's reason is not recorded. (Question 11's 8
calls come from its format's strict editorial regenerations, not from
retries.) The check is right to refuse a `www.`
address in prose (`docs/THREAT_MODEL.md`, item 4), and the synthesis prompt
says so. The format asks this section for its "source in parentheses at
end of paragraph", which invites a host name such as `(www.example.com)`.
The record cannot confirm it: the error quoted only `www.`, and a refused
answer is not kept. Since #42 the error quotes the whole address, cut at
200 characters, so a second failure would name it. Nothing was rerun.

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
