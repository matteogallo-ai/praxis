# Benchmark results

Two tables per release: the **automated objective checks**
(filled by the release runner, must be 100% pass to tag) and
the **qualitative human review** (filled by the release owner
after the tag lands, see `CHECKLIST.md` for the rubric).

Historical runs are appended below the current one so the record
persists across releases.

---

## v0.9.0 — 2026-08-18

### Automated objective checks (mock briefings, v0.9.0)

Filled by the `bench:mock` run and the objective-checks step of
the v0.9.0 release process (2026-08-18). All 10 mock benchmarks
passed every objective check. See `CHECKLIST.md § Objective
checks` for the criteria.

Legend: **✓** pass · **n/a** not declared by the format's
`output_targets[]` (skipped by design, not a failure).

| id                                | format                    | md ok | pdf ok | docx ok | metadata ok | auto-router coherent |
| --------------------------------- | ------------------------- | :---: | :----: | :-----: | :---------: | :------------------: |
| 01-german-market-entry            | mckinsey-style-note       |   ✓   |   ✓    |    ✓    |      ✓      |          ✓           |
| 02-cfo-buyback-briefing           | executive-pre-read        |   ✓   |   ✓    |   n/a   |      ✓      |          ✓           |
| 03-executive-succession-planning  | executive-pre-read        |   ✓   |   ✓    |   n/a   |      ✓      |          ✓           |
| 04-uk-listing-board-briefing      | executive-pre-read        |   ✓   |   ✓    |   n/a   |      ✓      |          ✓           |
| 05-supply-chain-acquisition       | mckinsey-style-note       |   ✓   |   ✓    |    ✓    |      ✓      |          ✓           |
| 06-market-entry-southeast-asia    | mckinsey-style-note       |   ✓   |   ✓    |    ✓    |      ✓      |          ✓           |
| 07-should-we-divest-consumer-line | mckinsey-style-note       |   ✓   |   ✓    |    ✓    |      ✓      |          ✓           |
| 08-ai-regulation-position         | position-paper-corporate  |  n/a  |   ✓    |    ✓    |      ✓      |          ✓           |
| 09-trade-association-response     | position-paper-corporate  |  n/a  |   ✓    |    ✓    |      ✓      |          ✓           |
| 10-esg-position                   | position-paper-corporate  |  n/a  |   ✓    |    ✓    |      ✓      |          ✓           |

Additional hygiene checks:

- Total `benchmarks/outputs/` size on disk: 740 KB (< 10 MiB target).
- Largest single artefact: 50 KB (well under the 500 KB ceiling).
- Grep for `sk-ant` under `benchmarks/outputs/`: no hits.
- Grep for `ANTHROPIC_API_KEY` under `benchmarks/outputs/`: no hits.
- Every PDF: valid `%PDF-` header, `%%EOF` trailer, ≥ 40 KB.
- Every DOCX: valid `PK\x03\x04` ZIP header (Open Packaging Convention container).
- Every `metadata.json`: parses via `jq`, has non-empty
  `synthesis.total_word_count`, and matches the manifest question / format.
- Every `--format auto` on the manifest question resolves to the
  declared format id.

### Qualitative human review (mock briefings, v0.9.0)

_Filled by Matteo post-tag. See CHECKLIST.md § Qualitative for
the rubric. Do NOT auto-fill._

| id                                | Fidelity | Depth | Sourcing | Adversarial | Polish | /25 |
| --------------------------------- | :------: | :---: | :------: | :---------: | :----: | --- |
| 01-german-market-entry            |          |       |          |             |        |     |
| 02-cfo-buyback-briefing           |          |       |          |             |        |     |
| 03-executive-succession-planning  |          |       |          |             |        |     |
| 04-uk-listing-board-briefing      |          |       |          |             |        |     |
| 05-supply-chain-acquisition       |          |       |          |             |        |     |
| 06-market-entry-southeast-asia    |          |       |          |             |        |     |
| 07-should-we-divest-consumer-line |          |       |          |             |        |     |
| 08-ai-regulation-position         |          |       |          |             |        |     |
| 09-trade-association-response     |          |       |          |             |        |     |
| 10-esg-position                   |          |       |          |             |        |     |

### Live results (v0.9.0)

_Populated when a maintainer with `ANTHROPIC_API_KEY` runs
`bun run bench:live` and copies the outputs into
`benchmarks/outputs/live/`._

## AI-Assisted Qualitative Scoring (2026-08-20)

Scored by Claude Sonnet 4.5 via the calibrated rubric in `scoring-prompt.txt`. See `docs/benchmarking-methodology.md` for the methodology, model choice, and known biases.

### Aggregate scores

| Criterion | Mock (n) | Live (n) | Delta |
|---|---|---|---|
| Framing clarity | 1.9 (n=11) | — | — |
| Non-hedging | 3.9 (n=11) | — | — |
| Decisive recommendation | 4.0 (n=11) | — | — |
| Concrete tradeoffs | 3.2 (n=11) | — | — |
| Perceived sourcing | 4.2 (n=11) | — | — |
| Adversarial usefulness | 5.0 (n=11) | — | — |
| Format fidelity | 3.5 (n=11) | — | — |
| **Total /35** | **25.7 (n=11)** | **—** | **—** |

### Per-briefing scores

| # | Slug | Format | Mock | Live | Delta |
|---|---|---|---|---|---|
| 01 | 01-german-market-entry | mckinsey-style-note | 27 | — | — |
| 02 | 02-cfo-buyback-briefing | executive-pre-read | 25 | — | — |
| 03 | 03-executive-succession-planning | executive-pre-read | 25 | — | — |
| 04 | 04-uk-listing-board-briefing | executive-pre-read | 25 | — | — |
| 05 | 05-supply-chain-acquisition | mckinsey-style-note | 26 | — | — |
| 06 | 06-market-entry-southeast-asia | mckinsey-style-note | 24 | — | — |
| 07 | 07-should-we-divest-consumer-line | mckinsey-style-note | 25 | — | — |
| 08 | 08-ai-regulation-position | position-paper-corporate | 26 | — | — |
| 09 | 09-trade-association-response | position-paper-corporate | 25 | — | — |
| 10 | 10-esg-position | position-paper-corporate | 27 | — | — |
| 11 | 11-family-office-co-investment | family-office-memo | 28 | — | — |

### Systematic observations

**Where live significantly outperforms mock (Δ ≥ +1.0):** none observed.

**Where mock holds close (Δ < +0.5):** none observed.

**Weakest aspect across all briefings:** Framing clarity (overall 1.9/5).

**Strongest aspect across all briefings:** Adversarial usefulness (overall 5.0/5).

**Overall verdict:**

- Mock briefings average 25.7/35 (n=11).
- 0 briefing(s) below the 15/35 usability floor; 0 at or above the 32/35 near-excellence line.

