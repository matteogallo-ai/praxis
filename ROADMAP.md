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

## v0.5 — Risk Analysis Agent + Hardened Sourcing Layer ✅ (shipped 2026-08-18)

- `risk` agent — fourth Praxis agent, first to consume THREE prior
  outputs (Scoping + Research + Stakeholders). Enumerates 5-15 risks
  (hard cap 25) with likelihood and impact bands, each sourced on
  BOTH likelihood and impact evidence, each cross-referenced to the
  stakeholder mapping by exact name, each paired with 1-3 concrete
  mitigations and a residual-risk estimate.
- Sourcing & Verification Layer HARDENED from an embryonic validator
  into a production-grade transverse layer:
  - freshness gates (per-format `max_source_age_days` +
    `warn_after_days`);
  - domain trust (per-format `allow-list`, `deny-list`, or
    `reputation-only` tiers with wildcard host matching);
  - cross-agent dedupe via a pipeline-scoped `SourcingAccumulator`
    (URL normalisation + Levenshtein similarity threshold);
  - unified `SourcingReport` with categorised counts (ok / stale /
    untrusted / duplicated / missing).
- Format schema extended with an optional `sourcing_rules` block; the
  three shipped formats now declare it. `sourcing_policy` remains for
  retro-compat and controls failure mode.
- Orchestrator: `assessRisksAfterStakeholders()` — runs the four
  agents end-to-end and returns a merged cross-agent
  `sourcing_report`.
- CLI: `--with-risks` (implies --with-stakeholders which implies
  --with-research) plus a `--sourcing-report` audit view.
- Follow-on `options` and `adversarial` agents move to v0.6.

---

## v0.6 — Options Generation Agent + Synthesis Agent + Full Brief ✅ (shipped 2026-08-18)

- `options` agent — fifth Praxis agent, first to consume all four
  prior artefacts. Enumerates 2-4 mutually-exclusive courses of
  action with concrete tradeoff dimensions (vague labels like
  `pros`/`cons` are structurally rejected), cross-referenced
  stakeholder impact predictions and risk implications, and exactly
  one `recommended` option. Errors: `OptionsGenerationError`,
  `InvalidOptionStakeholderReference`, `InvalidOptionRiskReference`.
- `synthesis` agent — sixth Praxis agent. One LLM call per format
  section, respecting per-section `tone_directives`, `max_length`,
  and `validation_rules`, plus format-level `forbidden_terms`.
  Non-invention is structural: any cited URL absent from the
  upstream artefacts raises `SynthesisError`. Returns a full
  `format_conformance` audit (over-length sections, forbidden-term
  hit counts, failed validation rules).
- `Orchestrator.brief()` **implemented**. Chains Scoping → Research
  → Stakeholders → Risks → Options → Synthesis with a single
  `SourcingAccumulator` threaded through every sourcing
  validation. Returns a `BriefResult` (all six artefacts +
  aggregated sourcing report + audit metadata).
- CLI: `--full`, `--output <path.md>`, `--with-sourcing-report`.
  Produces a Markdown briefing with a YAML front-matter header
  suitable for a Markdown-to-PDF pipeline or a human review.
- **First complete, sourced, format-conformant briefing rolls off
  the pipeline in this release.**

---

## v0.7 — Adversarial Critique Agent + Output Renderers ✅ (shipped 2026-08-18)

- `adversarial` agent — seventh and last Praxis agent before v1.0.
  Reads the completed brief and stress-tests the recommendation
  against the strongest counter-arguments (steelmanned, never
  strawmanned). Eight fixed categories; 3-15 critiques per run;
  20-word minimum on `steelmanned_position`; every target
  cross-referenced against the brief.
- `Orchestrator.briefWithCritique()` — chains the six-agent
  `brief()` and feeds the result to the critique agent. Returns a
  `BriefWithCritiqueResult` with re-aggregated sourcing report.
  `brief()` itself is API-unchanged.
- Renderers for the three declared `output_targets`: `md-enhanced`,
  `docx`, `pdf`. Enhanced Markdown has TOC + de-duplicated
  Sources; DOCX is from-scratch OOXML (no npm dep); PDF is via
  `pdfkit` — the ONE external npm runtime dep Praxis takes on,
  explicitly listed as the planned exception in the v0.1
  migration prompt.
- CLI: `--critique`, `--render <target>`, `--output <path>`,
  `--theme <name>`, `--include-toc`, `--include-appendices`.

---

## v0.8 — Consolidation: editorial re-run loop, strict_editorial, Praxis-as-library ✅ (shipped 2026-08-18)

Consolidation release. No new agent, no new npm dep, no Web UI. Three
bricks that harden Praxis toward v1.0 without expanding scope:

- **Editorial re-run loop** — `Orchestrator.briefWithCritiqueAndRerun()`
  re-invokes Synthesis in REVISION MODE if the adversarial critique
  flagged `revised_recommendation_needed`. **Hard cap: exactly one
  rerun.** The method never re-iterates. `original_synthesis` is
  preserved for audit, `rerun_metadata` records which critiques were
  addressed and which sections changed substantially.
- **Forbidden-terms hard-reject** — opt-in `strict_editorial` mode
  under `sourcing_rules.editorial`. Rejects and regenerates sections
  that hit a `"reject"`-action rule (`forbidden_terms_action`,
  `over_length_action`, `validation_rules_action`) up to
  `max_regeneration_attempts` (default 2, ceiling 3). Every attempt
  is recorded in `SynthesizedSection.editorial_attempts[]`. Exhausted
  → `EditorialFailureError`.
- **Praxis-as-library** — `src/index.ts` refactored as the v1.0
  stable API surface. Every public export covered by SemVer.
  Complete error taxonomy under `PraxisError` — a single top-level
  `catch (e instanceof PraxisError)` is enough. Post-Stakeholder
  agent `executeXxx()` implementations remain internal on purpose:
  the Orchestrator owns their sequencing.
- **CLI**: `--with-rerun` (implies `--critique`, requires `--full`).
  Prints a one-line rerun summary to stderr; the JSON payload
  carries `rerun_performed`, `original_synthesis`, `rerun_metadata`.

Deliberately deferred (moved to a later release):

- Web UI: rejected as out-of-scope for v1.0. The library API IS the
  contract; UIs are downstream projects.

---

## v0.9 — Release readiness: CLI polish, calibrated benchmarks, docs ✅ (shipped 2026-08-18)

The final consolidation release before v1.0. No new agent, no
new npm dep, no breaking change.

- **CLI polish** — new `symbols`, `log`, `progress`, and
  `errorWithContext` helpers unify the user-facing surface.
  Global `--verbose` and `--quiet` flags stripped by the
  dispatcher and honoured across every command. Structured
  error blocks (cause / suggestion / see) upgrade the three
  most common actionable failures (`FormatNotFoundError`,
  `AnthropicAuthenticationError`, `UnsupportedRenderTargetError`).
- **`--format auto`** — deterministic keyword-based format
  router. Matches on `board` / `executive` / `leadership
  decision` → `executive-pre-read`; `position` / `regulatory`
  / `policy` / `association` → `position-paper-corporate`;
  `should we` / `market entry` / `M&A` / `acquisition` /
  `strategic` → `mckinsey-style-note`. Ambiguous or no-match
  paths emit actionable errors. Documented as an opinionated
  shortcut, not an LLM router.
- **Ten calibrated benchmarks** — `benchmarks/questions.yaml`
  ships the manifest; `benchmarks/run-all.ts` produces
  `brief.md` / `brief.pdf` / `brief.docx` / `metadata.json`
  per entry under `benchmarks/outputs/{mock|live}/`. Mock
  runs are reproducible bit-for-bit; live runs are refreshed
  by the release owner when they have API access. Objective
  checks (100% pass at v0.9.0) filled automatically;
  qualitative axes (5 scores × 10 benchmarks) filled by
  human review after tag.
- **Documentation** — new `docs/getting-started.md` (5-min
  walkthrough), `docs/cookbook.md` (10 recipes),
  `docs/troubleshooting.md` (12 common errors), refreshed
  `README.md` (v1.0-ready landing page with badges, tagline,
  ASCII pipeline diagram), and `docs/architecture.md § 7`
  (final v0.9 pipeline diagram with invariants).

**Metrics**: 1100+ tests pass (+60 vs v0.8 baseline of 1042),
0 fail, `bunx tsc --noEmit` clean, 0 new dependencies.

---

## v0.10 — AI-assisted qualitative scoring framework ✅ (shipped 2026-08-18)

Framework release. Ships the entire scoring infrastructure but
defers the empirical mock-vs-live delta table to v0.10.1 (a
maintainer with API credits runs `bun run score` and commits
the resulting `RESULTS.md` diff).

- **`benchmarks/score-all.ts`** — reads every `brief.md` +
  `metadata.json` under `benchmarks/outputs/*/`, calls Claude
  Sonnet 4.5 with the calibrated prompt, validates the JSON
  payload, caches under `.scoring-cache/` (24h TTL,
  gitignored), aggregates, rewrites the "AI-Assisted
  Qualitative Scoring" block in `RESULTS.md`. Modes:
  `--mock-only`, `--live-only`, `--refresh <slug>`,
  `--dry-run`.
- **`benchmarks/scoring-prompt.txt`** — the anti-complaisance
  calibrated prompt (7 criteria × 1–5, "3/5 is normal",
  per-criterion example + improvement, free-text weakest /
  strongest / comparative note).
- **41 unit tests** covering flag parsing, payload validation,
  aggregation, systematic observations, section rewriting,
  cache TTL, and `--dry-run` end-to-end. All fixture-driven;
  **zero real API calls in `bun test`**.
- **`docs/benchmarking-methodology.md`** — rubric, prompt
  design, model choice, known biases (same-family scoring,
  deterministic mock content), reproduction, budget ($5-7 per
  full pass), interpretation guide.

**Metrics**: 1146 tests pass (+41 vs v0.9 baseline of 1105),
0 fail, `bunx tsc --noEmit` clean, 0 new dependencies.

### v0.10.1 (chore) — empirical validation

A maintainer with `ANTHROPIC_API_KEY` and ~$10 credit runs:

```
bun run bench:live
bun run score
```

The resulting `benchmarks/outputs/live/*` artefacts +
`benchmarks/RESULTS.md` diff (mock-vs-live delta table +
systematic observations) land as v0.10.1. No code change.

---

## v1.0 — General Availability ✅ (shipped 2026-08-18)

Symbolic release. No new functional code. The 1146-test v0.10
baseline is preserved verbatim; the only src/ change is
`PRAXIS_VERSION = "1.0.0"`. The tag freezes the public API
contract.

- **SemVer contract locked.** `src/index.ts` is the surface;
  every named export is bound. Removing / renaming an export
  or changing an error class's inheritance requires v2.0.
  See `docs/SEMVER-CONTRACT.md` for the full contract text.
- **Public release.** Repo becomes the reference implementation
  of the multi-agent briefing pattern. External contributors
  onboarded via `CONTRIBUTING.md`.
- **Compatibility commitment (v1.x).** Additive changes only —
  new agents, formats, renderers, providers, optional fields,
  new methods. Breaking changes require v2.0 with a proposal
  template and a migration guide.

No new pipeline capability shipped at v1.0 — the seven-agent
pipeline is final. v1.0 is the stability tag.

---

## v1.2 — family-office-memo format ✅ (shipped 2026-08-19)

Fourth shipped format. `formats/family-office-memo.yaml` is a
discreet, three-page, institution-voiced patrimonial memo for a
family principal or family council. Six sections (Principal
Summary, Context and Heritage, Stakeholders and Alignment,
Options and Tradeoffs, Risks and Preservation, Recommended Next
Step). Strict-editorial by design: Synthesis regenerates any
section that trips forbidden terms, length caps, or validation
rules rather than warning. Roles-not-names discretion protocol
enforced via `forbidden_terms` on `"the family"`. Patrimonial
sourcing profile: 5-year freshness horizon, reputation-only
domain trust with tier-1 anchors on FT / Reuters / Bloomberg /
OECD / BIS / IMF / admin.ch / finma.ch / Campden. Ships with
12 mock-llm fixtures and an 11th benchmark
(`11-family-office-co-investment`). See
`docs/formats/family-office-memo.md`. +24 tests; baseline
1188 → 1212. Zero API change, zero new npm dependency.

---

## v1.1.1 — position-paper-corporate coverage fix ✅ (shipped 2026-08-19)

Patch release. `benchmarks/run-all.ts` was gating each artefact
write on `format.output_targets[]`, leaving 6/10 mock briefing
directories incomplete (3 without `brief.md`, 3 without
`brief.docx`). Fix: benchmark harness now always emits the full
md+pdf+docx trifecta regardless of format declaration. Scoring
coverage went from 7/10 to 10/10. See CHANGELOG for the full
root-cause writeup.

---

## v1.1 — @promptlang/yaml-parser via npm ✅ (shipped 2026-08-19)

Chore release. The `@promptlang/yaml-parser` sub-package
dependency migrated from the workspace
`file:../promptlang/packages/yaml-parser` linking to the versioned
npm dependency `"^1.0.0"`, published on
[npmjs.com](https://www.npmjs.com/package/@promptlang/yaml-parser).
The `promptlang` **core** (lexer / parser / ast / runtime) is
still consumed via TypeScript `paths` from the sibling
`~/dev/promptlang/` checkout — decoupling that piece is planned
for a follow-up release. Zero functional change; 1146-test
baseline preserved verbatim.

---

## v1.3.0 — Framing clarity: structural prompt overhaul ✅ (shipped 2026-08-20)

Structural release addressing the framing-clarity gap
surfaced by v1.2.1 empirical scoring (1.9 / 5 baseline,
8 / 11 briefings scoring 1 or 2). Three coordinated changes
push the seven-agent pipeline toward decision-first openings:

- **New optional `tone_hook` field on `FormatSection`** —
  short opinionated override that Synthesis treats as the
  absolute first priority for the section. Used exclusively on
  the four opening sections (`executive-pre-read.context`,
  `mckinsey-style-note.situation`,
  `position-paper-corporate.issue-framing`,
  `family-office-memo.principal-summary`) with a shared
  imperative payload demanding decision-first framing within
  the first 15 words.
- **FRAMING RULES block appended to every section's
  `tone_directives`** across the four shipped formats. Three
  constraints: name the decision (not the context), carry the
  subject and temporality in the first sentence, enable a
  triage decision in three lines or fewer. Opening sections
  additionally carry format-specific ✓ / ✗ examples anchoring
  the target register.
- **FRAMING CLARITY CHECK block in `prompts/synthesis.prompt`**
  — a pre- and post-writing gate telling Synthesis to verify
  the opening sentence enables 15-second triage and to rewrite
  it if an executive reading only that sentence would not know
  what action to take. Honours `section_tone_hook` when
  present.

Four opening mock synthesis fixtures were rewritten
decision-first (source arrays preserved verbatim) and all
eleven mock briefings were regenerated via `bun run bench:mock`.
Zero API surface change; zero new npm dependency; 1221 tests
pass (up from 1212). Empirical re-scoring is deferred to
v1.3.1 — see below.

## v1.3.1 — Empirical validation of v1.3.0 prompt improvements (planned)

Chore release. A maintainer with `ANTHROPIC_API_KEY` and
~$1 credit runs:

```
bun run score --mock-only
```

with the eleven-brief `.scoring-cache/` refreshed (or after
the 24 h TTL naturally expires) so every mock is re-scored
against the v1.3.0 prompts. The resulting
`benchmarks/RESULTS.md` diff — a new dated block replacing the
2026-08-20 aggregate table, per-briefing table, and
systematic-observations block — lands as v1.3.1. No code
change.

Ship criteria for v1.3.1:

- `framing_clarity` mean **≥ 3.0** on the 11-brief set (from
  the 1.9 baseline; a +1.1 lift or better is required to
  consider the v1.3.0 structural changes empirically
  validated).
- No other criterion regresses by more than 0.3 versus its
  v1.2.1 baseline (notably `format_fidelity` at 3.5 must
  stay ≥ 3.2).

If either gate fails, v1.3.1 becomes an iteration release
rather than a validation release — the fixtures and prompts
are re-tuned before another paid pass.

## v1.2.1 — First empirical mock scoring ✅ (shipped 2026-08-20)

Chore release. First empirical run of the v0.10 AI-assisted
scoring framework against the 11 mock briefings. Every briefing
scored by Claude Sonnet 4.5 through the calibrated seven-criterion
rubric. RESULTS.md now carries the aggregate table, an 11-row
per-briefing table, and a systematic-observations block. Mock
mean: 25.7 / 35 (73 %). Strongest criterion: Adversarial
usefulness (5.0 / 5). Weakest: Framing clarity (1.9 / 5). The
live-side column stays blank in this release — see the "live
pipeline hardening" item below. Zero code change; only version
constants + CHANGELOG + RESULTS.md.

---

## v1.x — Post-1.2 (planned)

Post-tag work, ordered by dependency:

- **Live pipeline hardening (precondition for the live empirical
  mock-vs-live delta).** The first `bun run bench:live` attempt
  aborted every briefing before any artefact was written: 3 / 5
  on `SourcingValidationError` under strict policy (research
  agent returned `SOURCE_MISSING` for most findings because
  `web_search` results didn't map to the four-field source
  schema), 1 / 5 on `JSON.parse` of research output that opened
  with prose ("I …"), 1 / 5 on `AnthropicTimeoutError` at the
  60 000 ms default. Three tracks for the fix release:
  research-prompt tightening on source extraction, per-agent
  timeout override (research needs > 60 s), and JSON prose-strip
  fallback in `parseResearchOutput`. See v1.2.1 CHANGELOG for the
  full failure catalogue.
- **Live empirical mock-vs-live delta (blocked by above).** Once
  `bun run bench:live` succeeds on ≥ 8 / 11 briefings, the
  RESULTS.md live column and delta column populate automatically
  on the next `bun run score`. No code change at that point.
- **Publish `promptlang` core to npm.** Replace the current
  tsconfig `paths` mapping to `../promptlang/src/*` with an npm
  dependency on `promptlang` once the core package is published.
  Removes the last sibling-checkout requirement.
- **v1.4+ — Additional formats + integrations.**
  - New shipped formats: BCG-style structured brief,
    negotiation-brief-OMC-style. (The family-office memo
    shipped in v1.2.0; the v1.3.0 slot was consumed by the
    framing-clarity structural overhaul.)
  - MCP server integration so the pipeline runs as a Claude
    Code / Claude.ai skill.
  - Notion / Google Drive connectors — export a rendered
    briefing directly to the caller's workspace.

Non-goals stay non-goals through v1.x (see below).

---

## Non-goals (through v1.0 and v1.x)

- No web UI. CLI + library only. UI can come as a separate project on
  top of the stable API.
- No hosted service. Praxis is a library you run against your own model
  provider.
- No format registry federation. The registry is local to the repo in
  v1.0; federation is a v1.x topic.
