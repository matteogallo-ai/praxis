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

## v0.2 — Agent Scoping ✅ (shipped 2026-08-14)

- Vendored YAML parser removed; Praxis now depends on
  `@promptlang/yaml-parser` (workspace-linked to the sibling
  `~/dev/promptlang` checkout).
- First agent (`scoping`) shipped with its prompt in PromptLang
  (`prompts/scoping.prompt`).
- `LLMProvider` interface + `MockLLMProvider` — deterministic, offline,
  fixture-driven. No real network calls yet.
- `Orchestrator` scaffold with `scope(question, formatId)` implemented
  and `brief(...)` explicitly throwing `NotImplementedError`.
- New CLI command: `praxis brief "<question>" --format <id>
  [--provider mock] [--json]`.
- 73 new tests (LLM, agents, orchestrator, CLI, end-to-end). Total: 219.

**Exit criteria met:** `praxis brief "..." --format executive-pre-read`
returns a valid `ScopingResult` JSON with the four expected fields.

---

## v0.3 — Research Agent + Real Anthropic Provider ✅ (shipped 2026-08-17)

- Real `AnthropicLLMProvider` — native `fetch`, retries on `429`/`5xx`
  with exponential backoff, `AbortController` timeout, zero external
  HTTP libraries, zero npm dependencies added.
- `LLMProvider` extended with optional `completeWithTools()` for tool
  use. `MockLLMProvider` covers it too via new fixture fields.
- `research` agent — reads Scoping output, calls the Anthropic
  server-side `web_search` tool, produces `findings[]` each carrying
  either a real `SourceReference` or an explicit `SOURCE_MISSING`
  marker (never a fabricated URL).
- **Sourcing & Verification Layer** (embryonic) — `SourceReference`,
  `SourceMissing`, `validateSourcing(strict|permissive)`, wired in by
  the Orchestrator after Research runs.
- `Orchestrator.researchAfterScoping()` — chains both agents and
  enforces the format's `sourcing_policy`.
- CLI: `--with-research` runs Scoping + Research; `--provider anthropic`
  goes live.
- Optional live tests under `tests/live/` (skipped without
  `ANTHROPIC_API_KEY`).
- 90 new tests. **Total: 309 + 3 optional live.**

**Exit criteria met:** `praxis brief "..." --format executive-pre-read
--with-research` prints both agents' outputs with every finding
carrying a source URL; `--provider anthropic` runs end-to-end against
the live API when the key is present.

---

## v0.4 — Stakeholder Mapping Agent ✅ (shipped 2026-08-17)

- `stakeholder` agent — third Praxis agent, first one whose input
  includes BOTH the Scoping output and the Research output. First
  agent that is analytical in the strong sense (synthesises a model
  of the terrain).
- Structured taxonomy: five stakeholder categories
  (decision-maker / influencer / gatekeeper / affected-party /
  external-observer), three power bands, four position states,
  three priority tiers, plus key dynamics and blind spots.
- Every `position_evidence` follows the Research sourcing discipline:
  real `SourceReference` OR explicit `SOURCE_MISSING` — never
  fabricated evidence about a real person or organisation.
- Sourcing Layer extended: `validateStakeholderSourcing`,
  `SourcingWarning` becomes a discriminated union so the same policy
  semantics apply to both agents.
- `Orchestrator.mapStakeholdersAfterResearch()` chains all three
  agents and enforces the format's `sourcing_policy` on both research
  findings and stakeholder positions.
- CLI: `--with-stakeholders` runs the full pipeline; alone it emits
  a stdout note and implies `--with-research`.
- Hard caps: 3-20 stakeholders per mapping, enforced by the parser.
- 59 new tests. **Total: 368 + 4 optional live.**

**Exit criteria met:** `praxis brief "..." --format executive-pre-read
--with-stakeholders` prints the three agent sections plus a compact
stakeholder table, with every position_evidence carrying a source URL
under the strict-policy shipped formats.

---

## v0.5 — Risk Analysis Agent + Hardened Sourcing Layer

- `risk` agent — fourth Praxis agent. Enumerates risks tied to the
  recommendation with likelihood and impact bands, and pairs each
  risk with a mitigation the reader's owner can execute.
- Consumes Scoping + Research + Stakeholder outputs (first agent with
  three prior inputs; validates the general pattern for downstream
  agents).
- Sourcing Layer extensions: freshness gates (per-format ceiling on
  source age), domain-trust bands (per-format allow/deny lists),
  cross-agent citation dedupe.
- Orchestrator: `assessRisksAfterStakeholders()`.
- CLI: `--with-risks` flag chains the four agents.
- Follow-on `options` and `adversarial` agents move to v0.6 if scope
  demands.

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
