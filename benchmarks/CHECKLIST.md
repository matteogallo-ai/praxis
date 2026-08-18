# Benchmark scoring checklist (v0.9)

Two blocks: **objective** checks the release runner (or a future
scoring script) can automate, and **qualitative** axes that
require human review.

The release process fills the objective block before tagging.
The qualitative block is filled by the release owner (Matteo
today) after the tag lands.

---

## Objective checks (automated)

These are boolean pass/fail per benchmark. Fillable by grep,
YAML parsing, and file inspection. The v0.9 release runner
scores every mock benchmark against every item in this block;
a failure is a bug, not a signal to lower the bar.

For each artefact:

- [ ] `brief.md` starts with a valid YAML front-matter (starts
      with `---\n`, closes with `\n---\n`).
- [ ] `brief.md` contains every section id from the format's
      `sections[]` as a Markdown `##` heading.
- [ ] `brief.md` contains a `## Sources` appendix.
- [ ] `brief.md` does NOT contain any of the format's
      `style_guide.forbidden_terms` (case-insensitive) UNLESS the
      run was under a warn-only editorial mode AND the term
      appears explicitly listed in the sourcing report as a hit.
- [ ] `brief.pdf` starts with the `%PDF-` magic header.
- [ ] `brief.pdf` ends with `%%EOF`.
- [ ] `brief.pdf` size is > 1 KiB and ≤ 500 KiB.
- [ ] `brief.docx` size is > 1 KiB and ≤ 500 KiB.
- [ ] `brief.docx` starts with a `PK\x03\x04` ZIP header (DOCX
      is a ZIP-packaged Open Packaging Convention container).
- [ ] `metadata.json` parses as valid JSON.
- [ ] `metadata.json.synthesis.total_word_count` is > 0.
- [ ] `metadata.json.sourcing.total_items` is > 0.
- [ ] `metadata.json.adversarial.{critical_count, material_count,
      minor_count}` sum to a valid critique count (3–15).

Cross-artefact:

- [ ] The `question` field in the manifest matches
      `metadata.json.question` exactly.
- [ ] The `format` field in the manifest matches
      `metadata.json.format` exactly.
- [ ] `metadata.json.provider_name` is `"mock"` for mock runs,
      `"anthropic"` for live runs.
- [ ] `--format auto` on the manifest's question resolves to the
      same format id (auto-router coherence check).

Security / hygiene:

- [ ] Grep for `sk-ant` across `benchmarks/outputs/` returns
      nothing.
- [ ] Grep for `ANTHROPIC_API_KEY` across
      `benchmarks/outputs/` returns nothing.
- [ ] Total `benchmarks/outputs/` size on disk is ≤ 10 MiB
      (mock + live combined at v0.9).

---

## Qualitative axes (human review)

Five axes, one score per benchmark on a 1–5 scale (1 = fails
its purpose, 3 = passable, 5 = better than a mid-level analyst
would produce). Only fillable by human reading — do NOT let
Claude Code score these.

1. **Format fidelity** — Does the brief read like the target
   format's canonical exemplars? (McKinsey-style-note: strict
   Situation/Complication/Question/Answer/So-What arc; executive
   pre-read: 6-section board-audience tone; position paper:
   external, defensible voice.)

2. **Analytical depth** — Are the stakeholders / risks / options
   substantive enough to survive a senior reader's pushback?
   Vague or generic entries score low.

3. **Sourcing discipline** — Every material claim carries a
   source in the appendix. Fabricated URLs are a 1 (the sourcing
   layer should prevent this — a fail here is a bug report,
   not a low score).

4. **Adversarial coherence** — The critique's steelmanned
   positions are non-trivially strong, target real weak points,
   and the revised recommendation (if the rerun fired) actually
   moves.

5. **Editorial polish** — No obvious typos, format contract
   respected (word budgets, tone directives, forbidden terms),
   the reader could ship this to a stakeholder with light edits.

Total: /50 per benchmark; /500 across the ten.

### Interpretation

- < 3.0 average: quality bar failing; investigate before the
  next tag.
- 3.0–3.9 average: acceptable; note the axes that dragged and
  plan a follow-up.
- ≥ 4.0 average: shippable quality for external show-and-tell.

**Do NOT let Claude Code fill this table.** These scores exist
to keep the release owner honest about quality, not to
short-circuit judgment.
