# Live benchmark artefacts

This directory holds the live-provider benchmark outputs — one
directory per manifest entry, populated by
`bun run bench:live` when `ANTHROPIC_API_KEY` is present.

**Currently empty at the v0.9.0 tag.** Fresh clones and CI runs
that do not have API access see this placeholder plus a
`.gitkeep`. Mock benchmarks live at `../mock/` and are always
available (no API key required).

## Regenerating

From the repo root, with a valid Anthropic key exported:

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # do NOT commit; use direnv or 1password
bun run bench:live                     # runs the 10 live benchmarks
```

Each entry writes:

- `brief.md`      — enhanced Markdown (when the format declares
                    `md` in `output_targets[]`)
- `brief.pdf`     — pdfkit
- `brief.docx`    — from-scratch DOCX (when the format declares
                    `docx` in `output_targets[]`)
- `metadata.json` — question, format, timing, word counts,
                    critique summary, rerun status

## Cost expectations

At the v0.9.0 pipeline defaults, one live briefing runs seven
LLM agents plus the strict/rerun retry loop. Ballpark:
1–3 USD per benchmark on Sonnet-class models. Ten benchmarks =
10–30 USD per full pass.

Keep this file up to date with any live-benchmark policy changes.
