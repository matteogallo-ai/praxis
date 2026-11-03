# Praxis benchmarks

A frozen set of twelve briefing questions that stress the four
shipped formats end to end, one of them a hard case. The benchmarks live here to give
reviewers, contributors, and downstream embedders a fixed
reference set they can regenerate at any commit.

## What is here

- `questions.yaml` — the twelve questions and their target
  formats. This is the manifest; every other file is derived.
- `split.yaml` — the frozen dev/test split of the manifest, drawn by
  `split.ts` (stratified by format, the hard case as its own stratum,
  fixed seed). Tune on dev; publish live results on test. It records
  the manifest's version and SHA-256, so any edit to `questions.yaml`
  fails the test suite until `bun run bench:split` redraws it. Adding
  questions redraws the split: do it before tuning, never after.
  `run-all.ts --split dev|test` runs one half.
- `run-all.ts` — the Bun script that generates artefacts. Modes:
  `--mock-only`, `--live-only`, or default (mock + live if
  `ANTHROPIC_API_KEY` is set).
- `run-all.sh` — trivial wrapper so `bash` callers reach the same
  entrypoint.
- **v0.10** `score-all.ts` — the AI-assisted scoring script.
  Reads every `brief.md` + `metadata.json`, sends each to Claude
  Sonnet 4.5 via the calibrated prompt in `scoring-prompt.txt`,
  and rewrites the "AI-Assisted Qualitative Scoring" section of
  `RESULTS.md` with per-criterion and per-briefing scores plus
  systematic observations. Modes: `--live-only`, `--refresh <slug>`,
  `--dry-run`; `--mock-only` is refused.
- **v0.10** `scoring-prompt.txt` — the calibrated
  anti-complaisance prompt (7 criteria × 1–5 scale, "score of 3
  is normal", "do NOT inflate"). Edited by the release owner,
  never by the CLI.
- `CHECKLIST.md` — the scoring rubric (five qualitative axes for
  human review, plus a block of objective checks the runner or a
  future scoring script can automate).
- `RESULTS.md` — the running scoreboard. The `Automated objective
  checks` section is filled by `run-all.ts`; the
  `AI-Assisted Qualitative Scoring` section is filled by
  `score-all.ts` when a maintainer with API access runs it.
- `outputs/mock/` — artefacts produced with `MockLLMProvider`.
  Reproducible bit-for-bit from a clean tree.
- `outputs/live/` — artefacts produced with `AnthropicLLMProvider`.
  Present only when a maintainer with API access has run the live
  path.
- **v0.10** `.scoring-cache/` — gitignored local cache of
  scoring payloads keyed by `{slug}-{mode}`. TTL 24h; avoids
  spending tokens on repeated iteration. Never committed.

## Running

From the repo root:

```
bun run bench:mock     # twelve mock briefings, always reproducible
bun run bench:live -- --max-cost-usd 8   # PAID: live briefings, each capped at $8
bun run bench          # mock; also live if a key is set AND --max-cost-usd given
bun run bench:live -- --max-cost-usd 8 --ids 02-cfo-buyback-briefing   # one question
```

### v0.10 — scoring

```
bun run score:dry      # enumerate what would be scored, no API call
bun run score:live     # AI-assisted scoring of the live briefings (paid)
bun run score          # same; mock briefings are never scored
```

`score:*` rewrites the "AI-Assisted Qualitative Scoring" block in
`RESULTS.md`. See `docs/benchmarking-methodology.md` for the
rubric, prompt design, model choice, known biases, and budget.

Each benchmark writes four files under `outputs/<mode>/<id>/`:

- `brief.md`      — enhanced Markdown (with TOC, sources, critique)
- `brief.pdf`     — pdfkit output
- `brief.docx`    — from-scratch DOCX
- `metadata.json` — question, format, timing, word counts, critique
  counts, rerun status, sourcing summary

## Design notes

- **A frozen set.** The point is a stable reference, not a growing
  one. The rule that closed the set at ten (v0.9) was retired when
  the family-office question (v1.2.0) and the hard case (version 2
  of the manifest) were added. A change to the set bumps the
  manifest's `version` and redraws `split.yaml`, before any tuning.
- **Formats are canonical.** The `format` field on each entry is
  what `--format auto` should pick from the question alone. If
  the auto-router disagrees, that is a bug — either in the
  keyword table or in the question phrasing.
- **Mock is always green.** The mock fixtures respond to the
  format id, not the question. So every mock benchmark for a
  given format returns identical body content; the metadata,
  timing, and file names differ. Mock benchmarks exist to prove
  end-to-end runnability and to snapshot the rendered
  deliverables at each commit — not to demonstrate stylistic
  diversity.
- **Live is idiomatic.** Live benchmarks are the ones that show
  Praxis at its intended quality. They cost real API tokens and
  are refreshed at each release, not per-commit.
- **The `outputs/live/` directory is gitignore-friendly.** When a
  maintainer without API access runs `bench:mock`, `live/` stays
  populated with the last live release. Fresh clones without a
  key see a `.gitkeep` and a short README explaining how to
  regenerate.

## For contributors

Do not commit outputs > 500 KB per file. The DOCX and PDF for
each mock benchmark should land around 30–60 KB; anything much
larger is a regression in the renderer. Report it as a bug.

Do not add a fourth format or an eleventh benchmark on this
branch. Both are scope-closed until v1.1.
