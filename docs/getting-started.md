# Get your first briefing in 5 minutes

Praxis is a multi-agent CLI + library that produces analytical
briefings — executive pre-reads, McKinsey-style notes, corporate
position papers — in the exact codes of the target organization.
This guide walks you from a fresh clone to a rendered PDF in
three steps.

## Prerequisites

- **Bun 1.3 or newer** (`bun --version`).
- A Unix-ish shell (`bash`, `zsh`, `fish`). The Windows path via
  WSL works too.
- Optional: an `ANTHROPIC_API_KEY` if you want live briefings.
  Everything below works offline against the mock provider.

## Step 1 — Clone and install

```bash
git clone https://github.com/matteogallo-ai/praxis.git
cd praxis
bun install
```

`bun install` fetches exactly two runtime dependencies:
`@promptlang/yaml-parser` (workspace-linked) and `pdfkit`.
Everything else is standard library or hand-rolled.

## Step 2 — Verify the install

```bash
bun run cli version
# → praxis v0.9.0
```

```bash
bun run cli formats list
# → executive-pre-read (v1.0.0) — Executive Pre-Read
#   mckinsey-style-note (v1.0.0) — McKinsey-Style Note
#   position-paper-corporate (v1.0.0) — Corporate Position Paper
```

## Step 3 — Generate your first briefing

Pick a question the shipped `executive-pre-read` format was
calibrated for and run the full seven-agent pipeline against the
mock provider:

```bash
bun run cli brief "Should we enter the German market?" \
  --format executive-pre-read \
  --full
```

Expected output on `stdout`:

```
---
question: "Should we enter the German market?"
format: "executive-pre-read"
provider: "mock"
generated_at: "2026-08-18T13:29:14.139Z"
recommended_option: "OPT-A"
aggregated_risk: "high"
sourcing_summary: "total=29 ok=28 stale=0 untrusted=0 duplicated=1 missing=0"
total_word_count: 338
target_word_count: 800
word_deviation_pct: -57.8
---

# Should we enter the German market?

## Context
...
```

You just ran seven agents — Scoping, Research, Stakeholders,
Risks, Options, Synthesis, and Adversarial Critique — end to end
against pre-scripted fixtures. Total time: under a second.

## Choosing a format

You do not need to know the format id up front. `--format auto`
picks one from your question:

```bash
bun run cli brief "Should we enter Southeast Asia?" \
  --format auto \
  --full
```

The auto-router matches on keywords:

- `board`, `executive`, `leadership decision`
  → `executive-pre-read`
- `position`, `regulatory`, `policy`, `association`
  → `position-paper-corporate`
- `should we`, `market entry`, `M&A`, `acquisition`, `strategic`
  → `mckinsey-style-note`

If two groups fire, you get an actionable error naming the
candidates. If none fire, you get an error asking you to spell
the id.

## Render to PDF, DOCX, or enhanced Markdown

```bash
bun run cli brief "Should we enter the German market?" \
  --format executive-pre-read \
  --full \
  --render pdf --output brief.pdf \
  --theme consulting \
  --include-toc --include-appendices
```

Three renderers ship:

- `pdf`         — via `pdfkit`, three themes (professional /
                  government / consulting).
- `docx`        — hand-rolled from Open Packaging Convention parts,
                  no `docx` npm dep.
- `md-enhanced` — Markdown with front-matter, TOC, sources
                  appendix.

## Turn on the editorial re-run loop

v0.8's stress-test loop: run Synthesis a second time in
REVISION MODE if the adversarial critique flags the
recommendation for revision. Hard cap: one rerun.

```bash
bun run cli brief "Should we enter the German market?" \
  --format executive-pre-read \
  --full \
  --with-rerun
```

`--with-rerun` implies `--critique` and requires `--full`. The
CLI prints a one-line summary to `stderr`; the `--json` payload
carries the full rerun metadata.

## Verbosity

The pipeline can be loud, quiet, or default:

```bash
bun run cli brief "Q" --format executive-pre-read --full --verbose
bun run cli brief "Q" --format executive-pre-read --full --quiet
```

`--verbose` prints every step to `stderr`; `--quiet` suppresses
progress markers but keeps the final output and errors.

## Live provider

To hit the real Anthropic API instead of the mock:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run cli brief "Should we enter the German market?" \
  --format executive-pre-read \
  --full \
  --provider anthropic
```

Live runs take 30–120 seconds and cost a few dollars per brief on
Sonnet-class models. Do NOT commit the key.

---

## Next steps

- `docs/cookbook.md` — ten recipes covering formats, providers,
  library embedding, error interpretation, and benchmarking.
- `docs/embedding-praxis.md` — quick-start for TypeScript
  callers who want the library, not the CLI.
- `docs/api.md` — narrated reference of every named export in
  `src/index.ts` (the v1.0 SemVer contract).
- `docs/troubleshooting.md` — the ten most common errors and how
  to fix them without opening the source.
- `benchmarks/RESULTS.md` — the 10 calibrated benchmarks and the
  automated + human review scores.
