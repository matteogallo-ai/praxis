# Praxis — Roadmap to v1.0

Praxis targets v1.0 in ten releases. Each release ships something a real
user can exercise — no waterfall, no big-bang. The unifying north star:
**produce a consultant-grade briefing that a senior reader mistakes for
the work of their own analysts.**

The Format Registry (v0.1) is the pierre angulaire. Every subsequent
release depends on it.

---

## v0.1 — Format Registry ✅ (shipped 2026-08-14)

- Canonical schema for briefing formats.
- Strict YAML loader and validator.
- In-memory registry with lookup/filter/list APIs.
- CLI: `version`, `formats list`, `formats inspect`, `formats validate`.
- Three production-ready formats: executive pre-read, corporate position
  paper, McKinsey-style note.
- Zero LLM calls. Zero external dependencies (parser vendored).

**Exit criteria:** every criterion in the release brief green (all
tests pass, all CLI commands smoke-tested, docs complete).

---

## v0.2 — Agent Scoping

- Extract the vendored YAML parser as `@promptlang/yaml-parser`. Replace
  the `src/vendor/` folder with a proper dependency.
- Ship the first agent (`scoping`) with its prompt written in PromptLang
  (dogfooding).
- Introduce the orchestrator scaffold that consumes a Format from the
  registry and lays out the per-section execution plan.
- No other agents yet — scoping produces an execution DAG that the rest
  of the pipeline will fill in.

**Exit criteria:** given `--format executive-pre-read` + a topic prompt,
Praxis produces a JSON execution plan naming which agent handles which
section.

---

## v0.3 — Research Agent + Sourcing Policy

- `research` agent — retrieval (initially: local corpus + web fetch
  adapter), evidence extraction, citation normalization.
- Enforce `sourcing_policy: strict` — every fact carries a citation or
  the section is rejected.
- First real end-to-end run: scoping → research on a single section.

---

## v0.4 — Stakeholder + Risk Agents

- `stakeholder` agent — map actors and positions.
- `risk` agent — enumerate risks with likelihood/impact bands.
- Format-driven agent invocation: the registry decides which agents run
  per section via `required_agents`.

---

## v0.5 — Options + Adversarial Agents

- `options` agent — generate the option space that supports the
  recommendation.
- `adversarial` agent — red-team pass that must find at least one
  substantive weakness per option, or explain why none exists.

---

## v0.6 — Synthesis Agent + Full Pipeline

- `synthesis` agent — writes the final section text respecting the
  format's tone directives.
- All seven agents wired together. First fully generated briefing on the
  executive pre-read format.

---

## v0.7 — Output Renderers

- Renderers for the three declared `output_targets`: `md`, `docx`,
  `pdf`.
- PDF pipeline builds on a headless typesetter (no external SaaS).
- CLI: `praxis produce --format <id> --topic <path> --out <path>`.

---

## v0.8 — Style Guide Enforcement

- Post-generation linter: forbidden-terms scan, sentence-length caps,
  paragraph-length caps, MECE checks on argument sections.
- Violations trigger a re-generation loop with the specific violation
  fed back as a constraint.

---

## v0.9 — End-to-End Demos

- Three fully worked demo briefings, one per shipped format.
- Reproducible from a single CLI command; artefacts checked into
  `examples/`.
- Public dogfood: Matteo uses Praxis to produce a real briefing and
  ships it as a public case study.

---

## v1.0 — General Availability

- Documentation complete: architecture, contributor guide, style guide
  authoring, format authoring, deployment.
- CI matrix: Bun 1.3.x on macOS + Linux, TypeScript strictness gate.
- External contributor onboarding: first three merged community PRs.
- Semantic versioning contract locked; breaking changes go through the
  proposal template.

---

## Non-goals (through v1.0)

- No web UI. CLI + library only. UI can come as a separate project on
  top of the stable API.
- No hosted service. Praxis is a library you run against your own model
  provider.
- No format registry federation. The registry is local to the repo in
  v1.0; federation is a v1.x topic.
