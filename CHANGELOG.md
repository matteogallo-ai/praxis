# Changelog

All notable changes to Praxis are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and Praxis adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned in v1.3.1

Empirical validation of v1.3.0 framing_clarity improvement.
Runbook in [`docs/v1.3.1-runbook.md`](./docs/v1.3.1-runbook.md).
Blocked only on Anthropic API credits refill.

### Post-v1.3.1

Praxis enters maintenance mode. See
[`ROADMAP.md § Project status`](./ROADMAP.md#project-status--feature-complete-at-v130).

## [1.3.0] — 2026-08-20

### Framing clarity — structural prompt overhaul

v1.2.1 empirical scoring identified **framing clarity** as the
weakest criterion across all eleven mock briefings (1.9 / 5
average, with 8 / 11 briefings scoring 1 or 2). The root cause
was consistent: opening sections led with context or
meta-commentary ("This memo examines...", "Germany presents both
opportunities and challenges...") rather than with the decision
the reader is being asked to make.

v1.3.0 attacks the root cause at three layers of the pipeline —
the format schema, the section directives, and the Synthesis
prompt itself. Every layer pushes the model toward a
decision-first opening on the section that determines whether the
reader keeps reading or delegates.

### Added

- **New optional `tone_hook` field on `FormatSection`** — a
  short, opinionated override that Synthesis treats as the
  ABSOLUTE FIRST PRIORITY for the section, overriding any
  conflicting guidance from the section's `tone_directives` on
  ordering and opening. Used exclusively on the opening section
  of each format (`context`, `situation`, `issue-framing`,
  `principal-summary`) with the same imperative payload:
  _"Open with the decision. Not the context. Not the framing.
  THE DECISION. Reader must know within 15 words whether to keep
  reading or delegate."_
- **FRAMING RULES block appended to every section's
  `tone_directives`** across the four shipped formats. Each block
  imposes three constraints: (1) the first sentence names the
  decision (not the context, not "this report"); (2) the first
  sentence carries the subject AND the temporality (immediate /
  3-6 months / long-term); (3) the first paragraph enables a
  triage decision in three lines or fewer (advantage / risk /
  recommendation). Opening sections also carry a format-specific
  ✓/✗ example pair to anchor the model on the target register.
- **FRAMING CLARITY CHECK block in
  `prompts/synthesis.prompt`** — a pre- and post-writing gate
  that instructs the Synthesis agent to (a) verify the opening
  sentence contains the decision and enables 15-second triage
  before producing the section, and (b) re-read the opening
  sentence in isolation after writing and rewrite if an
  executive reading ONLY that sentence would not know what
  action to take. When `section_tone_hook` is provided
  (i.e. not `"(none)"`), the prompt treats it as the absolute
  first priority.

### Changed

- **`src/registry/schema.ts`** — `FormatSection` gains the
  optional `tone_hook?: string` field. `SECTION_ALLOWED_KEYS`
  gains `"tone_hook"`.
- **`src/registry/validator.ts`** — validator accepts
  `tone_hook` as an optional non-empty string on any section;
  rejects empty strings with a clear message.
- **`src/agents/synthesis.ts`** — `buildSectionInputs()` passes
  the section's `tone_hook` (or the literal `"(none)"` when
  absent) into the Synthesis prompt.
- **`prompts/synthesis.prompt`** — new `section_tone_hook`
  prompt parameter; new FRAMING CLARITY CHECK block in the
  system message; new `Section tone hook:` line in the user
  message.
- **`formats/executive-pre-read.yaml`,
  `formats/mckinsey-style-note.yaml`,
  `formats/position-paper-corporate.yaml`,
  `formats/family-office-memo.yaml`** — every section's
  `tone_directives` extended with the FRAMING RULES block.
  Opening sections (`context`, `situation`, `issue-framing`,
  `principal-summary`) additionally carry `tone_hook` and a
  format-specific ✓/✗ example pair.
- **`tests/fixtures/mock-llm/synthesis-{format}-{opening}.json`**
  (four fixtures) — rewritten to lead with the decision. The
  original context-first phrasings ("This memo surfaces the
  co-investment opportunity...", "Germany presents both
  opportunities and challenges...") are replaced with imperative
  openings that name the recommended action, the subject, and
  the temporality inside the first sentence. `sources_cited`
  arrays preserved verbatim so upstream sourcing validation is
  unaffected.
- **`benchmarks/outputs/mock/*/brief.{md,pdf,docx}` +
  `metadata.json`** regenerated via `bun run bench:mock`. All
  eleven mock briefings render cleanly under the new opening
  fixtures.

### Deferred — empirical re-scoring

Empirical re-scoring of the eleven mocks against the improved
prompts is deferred to **v1.3.1** (awaiting Anthropic API
credits refill). The structural changes are shipped now to
preserve the disciplined shipping cadence and to make the
prompt improvements available to library consumers immediately.

Expected direction of change (to be validated empirically in
v1.3.1):

- **`framing_clarity`** — meaningful lift from the 1.9 / 5
  baseline. The specific magnitude is a v1.3.1 finding, not a
  v1.3.0 claim; no synthetic numbers are recorded in this
  release.
- **Other criteria** (`non_hedging`, `decisive_recommendation`,
  `concrete_tradeoffs`, `perceived_sourcing`,
  `adversarial_usefulness`, `format_fidelity`) — no regression
  expected, since the changes are additive to the sections'
  directives and do not touch downstream agents or sources.

`benchmarks/RESULTS.md` is intentionally NOT updated in this
release. It will land in v1.3.1 alongside the empirical scores.

### Notes

- **No API surface change.** `src/index.ts` public exports are
  unchanged. `tone_hook` is an optional field on a
  data-only interface (`FormatSection`); adding it is additive
  under the v1.0 SemVer contract.
- **No new npm dependency.**
- **Format registry compatibility.** Formats authored against
  v1.2.x continue to load unchanged — `tone_hook` is optional
  and defaults to absent.
- **Test count**: 1221 pass (up from 1212 baseline). Zero
  non-live regressions. Six pre-existing live tests continue to
  require `ANTHROPIC_API_KEY` and are unaffected by this
  release.
- **Approximate API cost for this release: $0.** All work is
  structural (schema, prompts, formats, fixtures). Empirical
  scoring cost (~$0.30–0.80 for the eleven mocks) shifts to
  v1.3.1.
- **Follow-up in ROADMAP.md § v1.3.1**: empirical re-scoring
  and RESULTS.md refresh.

## [1.2.1] — 2026-08-20

### First empirical qualitative scoring — mock briefings

First empirical run of the v0.10 AI-assisted scoring framework
against the eleven mock briefings shipped in v0.9 / v1.1.1 / v1.2.
Every briefing scored by Claude Sonnet 4.5 through the calibrated
seven-criterion rubric (`benchmarks/scoring-prompt.txt`, "3/5 is
normal, 4-5 requires genuine excellence, do not inflate").

The live-side of the mock-vs-live comparison table is left blank
in this release. The first `bun run bench:live` attempt exposed
systematic gaps between the mock provider (which always synthesises
well-sourced findings) and the real Anthropic API — see the
"Deferred — live empirical run" note below. Those gaps are real
product findings surfaced by the framework and will be addressed
in a follow-up release; they do not invalidate the mock scoring,
which is the empirical baseline against which the live results
will eventually be compared.

### Added

- `benchmarks/RESULTS.md` now carries an `## AI-Assisted
  Qualitative Scoring (2026-08-20)` section with an aggregate
  table (7 criteria × mock, n=11), an 11-row per-briefing table,
  and a systematic-observations block generated deterministically
  by `benchmarks/score-all.ts`.
- `benchmarks/.scoring-cache/` populated with eleven cached
  scoring payloads (one per mock briefing, 24 h TTL). The cache
  keeps future `bun run score` runs cheap and idempotent as long
  as the mock briefings are unchanged.

### Empirical results (mock, n=11)

- **Total score:** 25.7 / 35 average (73 %), range 24 – 28.
- **Strongest criterion across the set:** Adversarial usefulness
  — perfect 5.0 / 5 on every briefing. The critique regeneration
  loop consistently produces steelmanned counter-arguments that
  the scorer flags as genuinely challenging.
- **Weakest criterion across the set:** Framing clarity —
  1.9 / 5 average, with 8 / 11 briefings scoring 1 or 2. Root
  cause: the mock synthesis fixtures do not open with a crisp
  reformulated question. The framework surfaces this as
  actionable: "add an executive summary box with decision,
  magnitude, timing up-front" is the recurring `improvement`
  suggestion.
- **Top three briefings:**
  `11-family-office-co-investment` (28 / 35, family-office-memo),
  `01-german-market-entry` (27 / 35, mckinsey-style-note),
  `10-esg-position` (27 / 35, position-paper-corporate).
- **Bottom briefing:** `06-market-entry-southeast-asia`
  (24 / 35, mckinsey-style-note) — flagged for weakest framing
  and thinnest concrete tradeoffs.
- **Format ranking by mean score:**
  family-office-memo 28.0 (n=1),
  position-paper-corporate 26.0 (n=3),
  mckinsey-style-note 25.5 (n=4),
  executive-pre-read 25.0 (n=3).

### Deferred — live empirical run

The intended mock-vs-live delta table remains unpopulated. The
first `bun run bench:live` attempt aborted every briefing before
any artefact was written:

- 3 / 5 briefings — `SourcingValidationError: strict policy, 7-8
  of 8 items lack a source`. The real Anthropic model, given the
  research prompt, returned findings with `SOURCE_MISSING`
  markers rather than extracting URLs from `web_search` results.
  The mock provider hides this because its fixtures always carry
  four verified source fields.
- 1 / 5 — research agent raw output began with prose ("I …")
  before the JSON, tripping `JSON.parse`.
- 1 / 5 — `AnthropicTimeoutError` at the 60 000 ms default. The
  research agent's tool-use loop exceeded the per-request timeout
  on a corporate-strategy question.

These are genuine live-pipeline gaps, not scoring-framework
gaps, and warrant a dedicated fix rather than a config workaround
inside this chore release. The scoring framework itself is
validated: it runs to completion on eleven inputs with zero
errors and produces a well-formed RESULTS.md.

### Notes

- No code changes (src/, prompts/, formats/ untouched).
- No API surface change; the v1.x additive-only contract is
  preserved.
- Baseline test count preserved verbatim (only the
  `version-constant` string and its dispatch-test assertions
  change).
- Approximate API cost for this release: under $2 (11 scoring
  calls at ~$0.05 each, plus 5 partial live briefing attempts).
- Follow-up work tracked in ROADMAP.md § "Post-1.2 (planned)":
  live-pipeline hardening (research JSON extraction, per-agent
  timeout, permissive-fallback under strict policy) is the
  precondition for the still-outstanding "empirical mock-vs-live
  delta" line.

## [1.2.0] — 2026-08-19

### Fourth shipped format — family-office-memo

Praxis 1.2 introduces the fourth shipped briefing format:
`family-office-memo`. It is a discreet, three-page,
institution-voiced memo calibrated for a family principal or a
family council — the audience for which corporate briefings
(`executive-pre-read`, `mckinsey-style-note`,
`position-paper-corporate`) are not the right register.

Typical use cases: co-investment authorisations, external
private-banker or family-lawyer selection, generational
transition governance, philanthropic vehicle structuring,
response to a regulatory or supervisory inquiry.

### Added

- **`formats/family-office-memo.yaml`** — six-section format
  (Principal Summary, Context and Heritage, Stakeholders and
  Alignment, Options and Tradeoffs, Risks and Preservation,
  Recommended Next Step), 1200-word target, discreet
  institutional voice. Enforces a roles-not-names vocabulary
  (Principal, Successor Generation, External Trustee, Private
  Banker, External Advisor, Family Lawyer) via the
  `forbidden_terms` guard on `"the family"`.
- **Strict-editorial by design.** Unlike the three prior
  formats which ship with `strict_editorial: false` (warn-only),
  `family-office-memo` sets `strict_editorial: true` with every
  axis on `"reject"`. Synthesis regenerates a section that trips
  forbidden terms, length caps, or validation rules — the memo
  goes to the council in the tone it was authored for, or not
  at all.
- **Patrimonial sourcing profile.** `sourcing_rules.freshness`
  admits sources up to 5 years old (warning after 3 years) —
  patrimonial decisions digest over longer horizons than
  corporate cycles. `sourcing_rules.domain_trust` uses a
  reputation-only tiering with tier-1 anchors on FT, Reuters,
  Bloomberg, WSJ, Economist, government / OECD / BIS / IMF,
  Swiss admin.ch and finma.ch, and Campden FB. Tier-2 includes
  Wealth Briefing, Family Officer, STEP, Law360. Tier-3
  (Wikipedia) is excluded via `min_tier: 2`.
- **12 mock-llm fixtures** under `tests/fixtures/mock-llm/`
  covering the full seven-agent pipeline (scoping, research,
  stakeholders, risks, options, adversarial, plus one synthesis
  fixture per section). Content is calibrated to a realistic
  co-investment authorisation scenario: "Should the council
  approve the co-investment alongside the external advisor in
  the Zurich-based fintech?". All stakeholders appear by role;
  no named individuals; no invented families.
- **11th benchmark** in `benchmarks/questions.yaml`
  (`11-family-office-co-investment`). All 11 mock briefings are
  scorable end-to-end (up from 10).
- **Router keywords** in `src/cli/format-auto.ts`:
  `--format auto` now routes questions containing
  `family council`, `family principal`, `successor generation`,
  `patrimonial`, or `family office` to `family-office-memo`.
- **Format-integrity tests** in
  `tests/formats/formats-integrity.test.ts` covering the
  section order, tone directives, forbidden-term coverage,
  strict-editorial posture, sourcing-rule freshness thresholds,
  tier-1 and tier-2 domain lists, output targets, and fixture
  presence on disk.
- **`docs/formats/family-office-memo.md`** — full format
  reference covering when to use, section structure, tone
  conventions, discretion protocols (roles-not-names),
  sourcing standards, and example use cases.

### Changed

- Root `package.json` version bumped to `1.2.0`.
- `src/cli/version-constant.ts`: `PRAXIS_VERSION = "1.2.0"`.
- `README.md`: format table now lists four shipped formats.
- Structural invariant tests in
  `tests/formats/formats-integrity.test.ts` and
  `tests/cli/list.test.ts` /
  `tests/cli/format-auto.test.ts` /
  `tests/benchmarks/questions-schema.test.ts` /
  `tests/benchmarks/run-all-mock.test.ts` updated to reflect
  the 4-format / 11-benchmark set.
- The old "every format ships with `strict_editorial: false`"
  invariant relaxed to "every format declares the editorial
  block explicitly" — both `false` (warn-only) and `true`
  (reject-and-regenerate) are valid postures under v0.8's
  editorial framework.

### Notes

- **No API change.** `src/index.ts` public surface is unchanged.
  The frozen v1.0 SemVer contract is preserved verbatim.
- **No new npm dependency.** The format is a data file plus
  fixtures; no runtime code is added.
- **Test count**: 1212 pass (up from 1188 in v1.1.1). +24 new
  tests from the family-office-memo integrity block, fixture
  presence loop, and the benchmark-schema and cli test updates.
- The seven-agent pipeline (scoping → research → stakeholders →
  risks → options → synthesis → adversarial critique + rerun)
  operates on the new format identically to the prior three.
  The only format-specific behaviour is the strict-editorial
  regeneration loop.

## [1.1.1] — 2026-08-19

### Fixed

- **Benchmark artefact coverage** — `benchmarks/run-all.ts` now
  always emits the full `brief.md` + `brief.pdf` + `brief.docx` +
  `metadata.json` trifecta for every benchmark, regardless of the
  format's `output_targets[]` declaration. Previously 6/10 mock
  benchmark output directories were incomplete: 3
  position-paper-corporate briefings (08/09/10) lacked `brief.md`
  and 3 executive-pre-read briefings (02/03/04) lacked
  `brief.docx`. As a result, the v0.10 scoring framework reported
  only 7/10 mocks as scorable; it now reports 10/10.
- **Root cause.** `run-all.ts` was gating each artefact write on
  `format.output_targets.includes(target)` and then delegating to
  the `render()` dispatcher, which enforces the same rule. This
  is the correct behaviour for the user-facing CLI
  (`praxis brief ... --render docx`) — a format that doesn't
  declare a target shouldn't accept it. But a benchmark run is a
  harness, not a user-facing artefact; scoring uniformity
  requires the full trifecta on every entry. The fix bypasses the
  dispatcher's guard by calling the individual renderer
  implementations (`markdownEnhancedRenderer`, `pdfRenderer`,
  `docxRenderer`) directly, all already exported from
  `src/renderers/index.ts`. Zero change to the user-facing CLI or
  the dispatcher itself.

### Added

- `tests/benchmarks/coverage.test.ts` — regression test that
  asserts every mock benchmark output directory carries all four
  expected files (non-empty). Guards against silent
  reintroduction of the gap on future changes to `run-all.ts` or
  the format registry.

### Changed

- `benchmarks/outputs/mock/*/` regenerated end-to-end via
  `bun run bench:mock`. All 10 entries now carry the full
  trifecta. Same content envelope, same size class, deterministic
  under `MockLLMProvider`.

### Notes

- Empirical scoring coverage is now 10/10 mocks scorable (up from
  7/10 in v0.10 / v1.1.0).
- No API change, no functional change beyond the bug fix.
- The 1146-test v1.1 baseline is preserved; 42 new tests come
  from the coverage regression file (one per file × 10
  directories, plus the two structural assertions). The
  `enumerateBriefings` test in `score-all.test.ts` had to be
  updated in place: it previously encoded the 7/10 gap as
  expected behaviour, and now encodes the 10/10 fix.
- `docs/benchmarking-methodology.md` updated: the known-limitation
  bullet on the 7/10 gap now records the v1.1.1 resolution.

## [1.1.0] — 2026-08-19

### npm dependency switch (yaml-parser)

`@promptlang/yaml-parser` is now consumed as a versioned npm
dependency (`^1.0.0`) instead of a workspace `file:` linking
against `../promptlang/packages/yaml-parser`. `bun install` alone
now resolves the parser from
[npmjs.com/package/@promptlang/yaml-parser](https://www.npmjs.com/package/@promptlang/yaml-parser).

**Scope note.** This release switches only the extracted
`@promptlang/yaml-parser` sub-package. The `promptlang` **core**
(lexer / parser / ast / runtime) imported by the agents is still
consumed via TypeScript `paths` from the sibling
`~/dev/promptlang/` checkout — publishing the core to npm is a
follow-up release.

### Changed

- `package.json` dependency:
  `"@promptlang/yaml-parser": "file:../promptlang/packages/yaml-parser"`
  → `"@promptlang/yaml-parser": "^1.0.0"`. Bun resolves and
  downloads the package from the npm registry.
- `bun.lock` regenerated to record the npm-resolved
  `@promptlang/yaml-parser@1.0.0` (with sha512 integrity).
- `README.md` and `CONTRIBUTING.md`: clarify that only the
  yaml-parser sub-package is on npm as of v1.1; the sibling
  PromptLang checkout is still required for the `promptlang` core
  imports.
- `ROADMAP.md`: v1.1 milestone marked as SHIPPED, follow-up entry
  added for eventual core publication.
- `src/cli/version-constant.ts`: `PRAXIS_VERSION = "1.1.0"`.

### Notes

- **Zero functional change.** Same public API, same 1146-test
  baseline, same behaviour. The parser's API contract is unchanged —
  same `parseYaml`, `YamlParseError`, and `YamlValue` exports.
- One piece of technical debt from v1.0 is resolved: the
  `@promptlang/yaml-parser` distribution path. The remaining
  workspace linking (the `promptlang` core, via `tsconfig` paths)
  is out of scope for this release.
- Local development against an unpublished `@promptlang/yaml-parser`
  change is still possible via `bun link` or by temporarily
  switching the dependency back to a `file:` path — neither is
  required for day-to-day work anymore.

## [1.0.0] — 2026-08-18

### SemVer stability release

Praxis 1.0 is the frozen public API contract. Every public
export from `src/index.ts` is now bound by SemVer: removing an
export, renaming one, or changing an error class's inheritance
chain requires a major version bump. Additive changes (new
exports, new optional fields, new methods) land in minor
releases. Bug fixes and internal refactors are patches.

This release is **symbolic**: no new functional code, no new
tests, no new dependencies. The 1146-test v0.10 baseline is
preserved verbatim. The only src/ change is the
`PRAXIS_VERSION` constant.

See `docs/SEMVER-CONTRACT.md` for the full contract text.

### The journey — v0.1 → v1.0

- **v0.1** Format Registry — declarative catalog of professional
  briefing formats, YAML schema, in-memory registry.
- **v0.2** Scoping agent + Orchestrator scaffold + PromptLang
  integration + first `MockLLMProvider`.
- **v0.3** Real `AnthropicLLMProvider` + Research agent +
  embryonic sourcing (SourceReference / SourceMissing).
- **v0.4** Stakeholder Mapping agent (first multi-input agent).
- **v0.5** Risk Analysis agent + hardened Sourcing layer
  (freshness, domain trust, cross-agent dedupe).
- **v0.6** Options Generation + Synthesis + `brief()` complete
  (first full briefing end to end).
- **v0.7** Adversarial Critique agent + PDF/DOCX/MD renderers
  (first executive-ready deliverables). Introduced `pdfkit` —
  the sole external runtime dep.
- **v0.8** Editorial re-run loop (hard cap 1) + strict_editorial
  retry mode + PraxisError base + `src/index.ts` refactored as
  the stable library API surface.
- **v0.9** Benchmarks framework (10 calibrated questions) + CLI
  polish (`--verbose`, `--quiet`, `--format auto`, structured
  error blocks) + refreshed v1.0-ready docs (getting-started,
  cookbook, troubleshooting, api, embedding).
- **v0.10** AI-assisted scoring framework
  (`benchmarks/score-all.ts` + anti-complaisance prompt + 41
  unit tests + methodology doc). Empirical mock-vs-live run
  deferred to v1.0.1.

### What v1.0 guarantees

- **Seven agents** — Scoping, Research, Stakeholder, Risk,
  Options, Synthesis, Adversarial Critique. Pipeline is final.
- **Three rendering targets** — PDF (via `pdfkit`), DOCX
  (from-scratch, no `docx` npm), enhanced Markdown.
- **Three shipped briefing formats** — executive-pre-read,
  position-paper-corporate, mckinsey-style-note.
- **Sourcing layer** — freshness / domain-trust / cross-agent
  dedupe.
- **Editorial re-run loop** with hard cap 1 iteration + opt-in
  `strict_editorial` reject/regenerate.
- **Stable public API** — `PraxisError` taxonomy + every
  typed export from `src/index.ts` covered by SemVer.
- **1146 tests + 11 optional live tests** (`tests/live/` skip
  when `ANTHROPIC_API_KEY` is absent).
- **One external npm dependency** — `pdfkit`, the planned
  exception listed at v0.1.
- **Ten mock briefings shipped as empirical evidence** —
  `benchmarks/outputs/mock/*` under 800 KB, reproducible
  bit-for-bit.
- **Scoring framework ready** — `bun run score:dry` runs
  offline, `bun run score` runs against Sonnet 4.5.

### Compatibility commitment (v1.x)

- **Additive** changes only to the public API surface.
- New agents, formats, renderers, providers — all additive.
- Breaking changes require **v2.0**. Every proposed break goes
  through a proposal template with a migration guide.

### Known limitations (documented, not blocking)

- **Live benchmarks empirical run deferred to v1.0.1.** The
  scoring framework is complete and tested against fixtures;
  the mock-vs-live delta table lands when a maintainer with
  API credits runs `bun run bench:live && bun run score`.
- **position-paper-corporate scoring gap** — v0.10.0's
  `enumerateBriefings` covers 7 of 10 mock briefings because
  that format does not declare `md` in `output_targets[]`.
  Documented in `docs/benchmarking-methodology.md`; a v1.0.1
  or v1.1 patch adds a scoring-source text artefact.
- **`@promptlang/yaml-parser` workspace dependency** — still
  a `file:../promptlang/…` link. v1.1 publishes PromptLang to
  npm and Praxis switches to `"promptlang": "^1.x"`.

---

## [0.10.0] — 2026-08-18

**AI-assisted qualitative scoring — framework release (empirical
results deferred to v0.10.1).**

Ships the entire scoring infrastructure end to end — script,
calibrated anti-complaisance prompt, cache, aggregation,
RESULTS.md rewriter, unit tests, methodology docs — but the
**empirical mock-vs-live delta table lands in v0.10.1** when a
maintainer with API credits runs `bun run score`. The
framework is otherwise complete, tested, and ready.

No new npm dependencies. No breaking API change. No API calls
during `bun test`. The v0.9 baseline of 1105 tests is preserved
verbatim; v0.10 adds 41 new scoring-framework tests, all
fixture-driven.

### Added — scoring framework

- **`benchmarks/score-all.ts`** — the runner. Reads every
  `brief.md` + `metadata.json` under
  `benchmarks/outputs/{mock,live}/*`, interpolates the
  calibrated prompt, calls `AnthropicLLMProvider.complete()` on
  `claude-sonnet-4-5`, validates the JSON payload, caches it,
  and rewrites the "AI-Assisted Qualitative Scoring" block in
  `benchmarks/RESULTS.md`.
- **`benchmarks/scoring-prompt.txt`** — the calibrated prompt.
  7 criteria × 1–5 scale, anti-complaisance framing ("You are
  NOT the author", "A score of 3/5 is NORMAL. Do NOT inflate.",
  "Executives who read weak briefings make bad decisions").
  Per-criterion: score + 5–10 word example + concrete
  improvement to raise +1. Free-text: weakest_aspect,
  strongest_aspect, comparative_note vs a competent human
  analyst.
- **Cache** under `benchmarks/.scoring-cache/{slug}-{mode}.json`
  (gitignored). 24h TTL by default; `--refresh <slug>`
  bypasses. Malformed cache files are silently ignored.
- **CLI flags**: `--mock-only`, `--live-only`, `--refresh <slug>`,
  `--dry-run` (enumerate without touching the API), `--root
  <path>` (test-only).
- **Failure model**: missing `ANTHROPIC_API_KEY` on a non-dry
  run emits a structured error pointing at
  `docs/benchmarking-methodology.md`. `--dry-run` never
  requires the key.
- **New public exports from `benchmarks/score-all.ts`**:
  `parseScoreArgs`, `enumerateBriefings`,
  `interpolateScoringPrompt`, `parseScoringPayload`,
  `ScoringParseError`, `extractJsonBody`, `aggregate`,
  `computeObservations`, `insertScoringSection`,
  `renderScoringSection`, `readCache`, `writeCache`,
  `scoreAll`, `SCORING_CRITERIA`, `CRITERION_LABELS`. Types:
  `ScoringPayload`, `CriterionScore`, `Aggregates`,
  `CriterionAggregate`, `SystematicObservations`,
  `ScoreAllOptions`, `BriefingRef`, `ScoringMode`.

### Added — tests

- `tests/benchmarks/score-all.test.ts` — 41 unit tests
  covering flag parsing, payload validation (happy path +
  malformed + edge cases: score 0, score 6, missing criterion,
  total mismatch, unknown provider, non-object input), JSON
  extraction (plain, fenced, embedded in prose, garbage),
  prompt interpolation, aggregation, observation computation,
  section rewriting (idempotent), rendering, cache round-trip
  + TTL enforcement, enumeration (7 of the 10 mock briefings —
  see limitations below), and `--dry-run` end-to-end.
- **All tests use fixtures under
  `tests/fixtures/scoring/`** — `valid-scoring.json`,
  `malformed-scoring.json`, `edge-cases.json` (5 variants),
  `aggregates-synthetic.json` (10 scorings, 5 mock + 5 live).
  **Zero real API calls in `bun test`.**

### Added — documentation

- `docs/benchmarking-methodology.md` — the full methodology
  document. Rubric with score bands, prompt design choices,
  model choice rationale, known biases (same-family scoring,
  deterministic mock content, position-paper coverage gap),
  reproduction instructions, budget ($5–7 per full pass), and
  how to interpret the numbers.
- `docs/cookbook.md` — new recipe "Score your own briefings
  against the calibrated rubric" with the four `score:*`
  invocations and notes on the same-family bias.
- `benchmarks/README.md` — v0.10 additions listed (score-all,
  scoring-prompt, .scoring-cache).

### Added — package.json scripts

- `bun run score`, `score:mock`, `score:live`, `score:dry`.

### Notes — v0.10.0 vs v0.10.1

**Empirical validation results deferred to v0.10.1.** The
framework is shipped and tested against fixtures. When a
maintainer with `ANTHROPIC_API_KEY` and ~$10 credit runs
`bun run bench:live && bun run score`, the resulting
`benchmarks/RESULTS.md` diff lands as v0.10.1 (chore commit,
no code change).

### Known limitations

- **v0.10.0 scoring covers 7 of the 10 mock briefings.** The
  three `position-paper-corporate` briefings (08–10) do not
  emit `brief.md` (that format does not declare `md` in
  `output_targets[]`). Documented in
  `docs/benchmarking-methodology.md`. v0.10.1 will emit a
  scoring-source text artefact to close the gap.

### Not changed (v0.8+ API frozen)

- Every v0.8/v0.9 public API export unchanged. `Orchestrator`
  and the seven agents behave identically.
- Dependencies: `@promptlang/yaml-parser` + `pdfkit`. No
  additions.

---

## [0.9.0] — 2026-08-18

**Release-readiness release: CLI polish, `--format auto`, ten
calibrated benchmarks, refreshed documentation.**

The final consolidation before v1.0. No new agent. No new npm
dep. No breaking API change. The v0.8 baseline of 1042 tests is
preserved verbatim; v0.9 adds ~60 new tests around the CLI
polish and the benchmarks framework.

Dependencies remain exactly `{ @promptlang/yaml-parser (workspace),
pdfkit }`.

### Added — CLI polish

- New helpers in `src/cli/output.ts`:
  - `symbols` and `styledSymbols` — the canonical glyph set
    (`✓`, `✗`, `⚠`, `ℹ`, `•`, `→`) with colour-styled variants.
  - `log(level, message)` — leveled stderr logger with a
    verbosity gate (info/success suppressed under `--quiet`,
    verbose messages gated on `--verbose`, errors always
    pass).
  - `progress(step, detail?)` — one-line stderr step marker,
    suppressed under `--quiet`, brightened under `--verbose`.
  - `errorWithContext({ what, cause?, suggestion?, see? })` —
    structured error block with actionable guidance.
- **`--verbose` / `--quiet` global flags** — stripped by the
  dispatcher before command parsing; can appear anywhere on the
  command line.
- **`--format auto`** — opinionated keyword-based format
  router. Matches on:
  - `board`, `executive`, `leadership decision`
    → `executive-pre-read`
  - `position`, `regulatory`, `policy`, `association`
    → `position-paper-corporate`
  - `should we`, `market entry`, `M&A`, `acquisition`,
    `strategic` → `mckinsey-style-note`
  - Ambiguous matches surface as an actionable error naming
    the candidates. No matches also error out. Deterministic
    substring / word-boundary matching, not an LLM router.
- The `brief` command now uses `progress()` markers at every
  major pipeline stage and upgrades the three most common
  actionable failures to structured error blocks:
  - `FormatNotFoundError` → suggests `praxis formats list`.
  - `AnthropicAuthenticationError` → suggests `--provider mock`.
  - `UnsupportedRenderTargetError` → suggests a valid target.

### Added — benchmarks framework

- **`benchmarks/questions.yaml`** — 10 calibrated benchmark
  questions distributed across the three shipped formats. The
  set is closed at v0.9; adding an 11th requires a v-plus-1
  release.
- **`benchmarks/run-all.ts`** — the runner. Modes:
  - default: mock always, live if `ANTHROPIC_API_KEY` is set.
  - `--mock-only`: mock only, ignore the key.
  - `--live-only`: live only, error if no key.
  - `--dry-run`: manifest × modes → outcome list without
    dispatching the pipeline (used by the unit tests).
  - `--root <path>`: override the repo root.
- **`benchmarks/CHECKLIST.md`** — scoring rubric with two
  blocks: objective checks (automated) and qualitative axes
  (five, human review only, 1–5 scale).
- **`benchmarks/RESULTS.md`** — running scoreboard. v0.9.0
  objective check row: 10/10 pass on the mock briefings; live
  block populated when a maintainer with API access runs the
  live path.
- **`benchmarks/outputs/mock/`** — 10 mock briefings committed
  at v0.9.0 (`brief.md` where the format declares `md`,
  `brief.pdf`, `brief.docx` where the format declares `docx`,
  and `metadata.json`). Total on disk: 740 KB, well under the
  10 MiB target; largest single artefact ≤ 50 KB, well under
  the 500 KB per-file ceiling.
- **`benchmarks/outputs/live/`** — placeholder + README
  explaining regeneration. Populated when a maintainer with
  API access runs `bun run bench:live`.
- New package.json scripts: `bench`, `bench:mock`, `bench:live`.

### Added — documentation

- `docs/getting-started.md` — the 5-minute walkthrough (clone,
  install, first brief, formats, rendering, verbosity, live
  provider).
- `docs/cookbook.md` — 10 recipes (adding a format, adding a
  provider, embedding as a library, configuring
  `strict_editorial`, interpreting a `SourcingReport`,
  debugging `EditorialFailureError`, interpreting critiques,
  chaining briefings, using `--with-rerun`, generating own
  benchmarks).
- `docs/troubleshooting.md` — 12 common errors with cause and
  fix (format not found, ambiguous auto-router, missing key,
  rate limits, timeouts, sourcing failures, editorial
  exhaustion, render targets, YAML restrictions, PromptLang
  parse errors, adversarial parser rejections).
- `README.md` refreshed as a v1.0-ready landing page (badges,
  tagline, sample output, quick start, ASCII pipeline
  diagram, formats table, library snippet, dev setup, FAQ).
- `docs/architecture.md` gains a `§ 7. Final pipeline (v0.9)`
  section with the complete pipeline diagram and the invariants
  worth stressing (no recursion in the rerun loop, no
  agent-to-agent calls, rendering is always last).

### Changed

- CLI output style unified across `brief`, format helpers, and
  the top-level dispatcher — every user-facing error now goes
  through `errorWithContext` or the plain `✗` prefix; every
  progress marker goes through `progress()` with a consistent
  arrow glyph.
- `src/cli/index.ts` gains `stripVerbosityFlags(argv)` as an
  exported helper so tests can pin the verbosity dispatch
  discipline.

### Not changed (v0.8 baseline preserved)

- Every v0.8 public API method signature is unchanged.
  `briefWithCritiqueAndRerun()` produces the same output as at
  v0.8.0.
- Dependencies: `@promptlang/yaml-parser` (workspace) + `pdfkit`.
- The seven shipped agents. No new agent in v0.9, and none
  planned for v1.0 either.

### Migration notes

- **Library callers**: no change. Every new symbol
  (`stripVerbosityFlags`, `symbols`, `progress`, `log`,
  `errorWithContext`, `detectFormatFromQuestion`,
  `AUTO_FORMAT_IDS`, `AUTO_FORMAT_KEYWORDS`) is additive.
- **Format authors**: no change. Existing formats work
  unchanged. `--format auto` is a shortcut, not a replacement.
- **CI**: `bun test` should still pass in ~5 seconds against
  the mock provider. `bun run bench:mock` takes ~200 ms and is
  a useful pre-merge smoke test.

---

## [0.8.0] — 2026-08-18

**Consolidation release: editorial re-run loop (hard-cap 1), `strict_editorial` retry mode, Praxis-as-library API surface.**

No new agent, no new npm dep, no Web UI. Three bricks that harden
Praxis toward v1.0 without expanding scope. Dependencies remain
exactly `{ @promptlang/yaml-parser (workspace), pdfkit }`.

### Added — editorial re-run loop

- `Orchestrator.briefWithCritiqueAndRerun(question, formatId, options)`
  runs `briefWithCritique()`, then — iff `revised_recommendation_needed:
  true` AND `steelmanned_alternative !== null` — re-invokes the
  Synthesis agent ONCE in REVISION MODE, addressing the critical and
  material critiques and aligning the recommendation with the
  steelmanned alternative.
- **Hard cap: exactly one rerun.** No recursion. A post-rerun brief
  is never critiqued or re-synthesized again inside the same call.
  Downstream callers can invoke the method a second time on the new
  output if they want another pass — the library never loops on its
  own. See `docs/editorial-loop.md`.
- New payload `BriefWithCritiqueAndRerunResult` — superset of
  `BriefWithCritiqueResult` carrying:
  - `rerun_performed: boolean`
  - `rerun_reason: string | null`
  - `original_synthesis: SynthesisResult | null` (pre-rerun audit)
  - `rerun_metadata: RerunMetadata | null` — `critiques_addressed[]`,
    `steelmanned_alternative_used`, and `re_synthesis_deviations[]`
    (section IDs whose text changed substantially).
- Deviation heuristic: word-count delta > 20% OR normalised
  Levenshtein distance > 0.30. Both signals published as
  `computeReSynthesisDeviations()` in the public API.
- `SourcingReport.edited_after_critique?: boolean` flips to `true`
  on the returned payload when the rerun fires.
- CLI: `praxis brief ... --full --with-rerun` (implies `--critique`,
  requires `--full`). One-line rerun summary printed to stderr; the
  `--json` payload carries the full rerun metadata block.

### Added — `strict_editorial` retry mode

- Optional `sourcing_rules.editorial` block on every format:
  - `strict_editorial: boolean` — master switch (default `false`,
    preserving v0.7 warn-only behaviour).
  - `max_regeneration_attempts: number` — in `[1, 3]`, default 2.
  - `forbidden_terms_action`, `over_length_action`,
    `validation_rules_action` — each `"reject" | "warn"`, default
    `"warn"`.
- Under strict mode, the Synthesis agent enforces `"reject"`-action
  rules as HARD refusals: a failing section is re-generated up to
  `max_regeneration_attempts` times, with a per-attempt
  `STRICT EDITORIAL RETRY` block in the prompt naming the reason
  and details. Every attempt is recorded in
  `SynthesizedSection.editorial_attempts[]`; the accepted attempt
  is at `final_attempt_number`.
- Exhausted retries throw `EditorialFailureError`, carrying the
  section id, the last failure reason, and the full attempt
  history for downstream inspection.
- Reason precedence when several axes fail simultaneously:
  `forbidden_terms` > `over_length` > `validation_rule`. Fix the
  loudest first.
- Reason on accepted attempts: `"accepted"` with a synthesised
  detail message; useful for auditing that the section passed
  without a retry.

### Added — Praxis-as-library

- `src/index.ts` refactored as the v1.0 stable API surface. Every
  named export is covered by the SemVer contract — removing an
  export or changing an error's inheritance requires a
  major-version bump.
- `src/errors/public.ts` — canonical barrel for the public error
  taxonomy. Every re-exported error inherits from `PraxisError`; a
  single top-level `catch (e instanceof PraxisError)` is now
  sufficient to catch every typed Praxis failure.
- Public value exports now include (v0.8 additions in bold):
  - Every agent RESULT type from v0.2 through v0.7 (`ScopingResult`,
    `ResearchResult`, `StakeholderMapResult`, `RiskAnalysisResult`,
    `OptionsGenerationResult`, `SynthesisResult`,
    `AdversarialCritiqueResult`).
  - **`EditorialAttempt`, `RevisionContext`,
    `BriefWithCritiqueAndRerunResult`, `RerunMetadata`,
    `EditorialFailureError`, `EditorialAction`, `EditorialRules`,
    `DEFAULT_MAX_REGENERATION_ATTEMPTS`,
    `MAX_REGENERATION_ATTEMPTS_CEILING`, `EDITORIAL_ACTIONS`,
    `isEditorialAction`, `computeReSynthesisDeviations`.**
  - Renderer dispatcher (`render`, `resolveTarget`, three renderer
    instances, `RENDER_TARGETS`, `RENDER_THEMES`).
  - Complete `PraxisError` taxonomy from
    `src/errors/public.ts`.
- Post-Stakeholder agent `executeXxx()` implementations
  (`executeRiskAnalysis`, `executeOptionsGeneration`,
  `executeSynthesis`, `executeAdversarialCritique`) remain
  INTERNAL — the Orchestrator owns their sequencing.
- New docs: `docs/api.md` (narrated API reference),
  `docs/embedding-praxis.md` (quick-start for library embedders),
  `docs/editorial-loop.md` (the rerun mechanics and hard-cap
  rationale).

### Changed

- `SynthesizedSection` gained two REQUIRED fields:
  `editorial_attempts: EditorialAttempt[]` and
  `final_attempt_number: number`. Backward-compat default is
  `[]` and `1` respectively for sections that ran under the
  default warn-only editorial mode.
- `SynthesisContext` gained an OPTIONAL `revision_context?:
  RevisionContext` field. Set only by
  `Orchestrator.briefWithCritiqueAndRerun()`; end-user code never
  provides it directly.
- `prompts/synthesis.prompt` gained two conditional parameters
  (`revision_block`, `retry_block`) that are empty strings on
  the initial pass and non-empty on rerun / strict-mode retry.

### Not changed (v0.7 baseline preserved)

- The public v0.6 / v0.7 API — every existing method signature is
  unchanged. `brief()` and `briefWithCritique()` produce the same
  outputs as v0.7.
- Dependencies: still exactly two runtime deps
  (`@promptlang/yaml-parser`, `pdfkit`). Zero additions.
- The seven shipped agents — no new agent in v0.8, and no plans
  for one in v0.9 or v1.0 either. The v0.7 pipeline is the final
  pipeline.

### Migration notes

- **Formats**: adding `sourcing_rules.editorial: { strict_editorial:
  false }` is optional and a no-op; formats that omit the block
  behave identically to v0.7. Formats that set
  `strict_editorial: true` MUST also set at least one
  `*_action: "reject"` to make the strict mode meaningful.
- **Library callers**: `briefWithCritique()` continues to work
  unchanged; `briefWithCritiqueAndRerun()` is the opt-in v0.8
  entry point. Every existing `catch (e instanceof PraxisError)`
  continues to catch the same set plus `EditorialFailureError`.
- **Direct consumers of `SynthesizedSection`**: the two new
  required fields are populated by the Synthesis agent and by the
  renderers already; only test fixtures that construct
  `SynthesizedSection` literals directly need to add
  `editorial_attempts: []` and `final_attempt_number: 1`.

---

## [0.7.0] — 2026-08-18

**Adversarial Critique agent + PDF/DOCX/MD renderers + first (and only planned) external npm dependency.**

Two bricks in this release: the seventh (and last-before-v1.0)
Praxis agent stress-tests the completed briefing against its
strongest counter-arguments; and the render pipeline finally
converts the Markdown produced by Synthesis into calibrated
executive deliverables in three formats.

### Notes on the first external npm dependency

**`pdfkit` (^0.19.1) is the SOLE external runtime dependency
added to Praxis in this release.** This was explicitly listed as
the one planned exception to the zero-npm-dep rule in the
migration prompt that shipped v0.1 — the alternative would be a
from-scratch PDF writer that would triple the renderer LOC and
require font-embedding (AFM parsing, Type 1 programs, encoding
tables) for zero incremental capability.

Every other renderer in this release stays from-scratch:

- The DOCX renderer emits Open Packaging Convention parts by
  hand (`docx-internals/{xml-builder,zip-builder,document-xml,styles-xml,content-types}.ts`)
  and uses `node:zlib` (bundled in Bun) for DEFLATE. No `docx`
  npm library was added.
- The enhanced Markdown renderer is 300 lines of TypeScript with
  no dependencies beyond `node:url` (Bun built-in).

The `dependencies` field in `package.json` is now exactly:

```json
{
  "@promptlang/yaml-parser": "file:../promptlang/packages/yaml-parser",
  "pdfkit": "^0.19.1"
}
```

No further external runtime deps are anticipated for v0.8+. The
v0.1 promise of "essentially no dependencies" holds — pdfkit is
the one exception, justified above, and the CHANGELOG will
mention it every time a new dep is proposed.

### Added

- **Adversarial Critique agent** (`src/agents/adversarial.ts`) —
  seventh and last Praxis agent before v1.0:
  - `executeAdversarialCritique(ctx, llm)` loads
    `prompts/adversarial.prompt`, dispatches to
    `llm.completeWithTools` with the `web_search` tool, and
    validates the returned JSON against
    `AdversarialCritiqueResult`.
  - Hard caps: `MIN_CRITIQUES = 3`, `MAX_CRITIQUES = 15`,
    `MIN_STEELMAN_WORDS = 20` (steelmanned positions under 20
    words are rejected — a steelman needs room to breathe).
  - **Every `target` field cross-checked**: `section_id`,
    `option_id`, `risk_id`, `stakeholder_name`, `finding_index`
    must resolve to actual artefacts in the supplied
    `BriefResult`. Empty targets and unknown references raise
    `InvalidCritiqueTargetError`.
  - **Severity aggregation + revision derivation are enforced**:
    the parser recomputes `critical_count` /`material_count` /
    `minor_count` and rejects mismatches;
    `revised_recommendation_needed` is derived (`critical ≥ 1` OR
    `material ≥ 3`) and mismatches raise
    `AdversarialCritiqueError`; when true,
    `steelmanned_alternative` must be non-null or
    `MissingAlternativeError` is raised.
  - Errors: `AdversarialCritiqueError`,
    `InvalidCritiqueTargetError`, `MissingAlternativeError`.
- **Adversarial types** (`src/agents/types.ts`):
  `CritiqueCategory` (8 values), `CritiqueSeverity` (3 bands),
  `CritiqueTarget`, `Critique`, `AdversarialCritiqueResult`,
  `AdversarialContext`.
- **Orchestrator.briefWithCritique()** — chains the six-agent
  `brief()` pipeline and feeds the completed `BriefResult` to
  the adversarial agent. Returns a `BriefWithCritiqueResult`
  (superset of `BriefResult`) plus a re-aggregated
  `sourcing_report` that now covers the critique's counter-
  evidence sources. **`brief()` itself is unchanged** —
  API-compatible with v0.6.
- **Enhanced Markdown renderer** (`src/renderers/markdown-enhanced.ts`)
  — extends the v0.6 `renderFullBrief()` with:
  - Table of Contents (opt-in via `include_toc`).
  - Dedicated Sources section with de-duplicated,
    domain-grouped, alphabetically-sorted references.
  - Optional Adversarial Critique section (when the brief
    carries one and `include_critique` is set).
  - Optional Appendices (findings, stakeholder table, risk
    register).
  - Richer YAML front-matter (adds `critique_summary` when
    critique is attached).
- **DOCX renderer** (`src/renderers/docx.ts`) — from-scratch OOXML
  (no npm dep). Emits Content_Types, root and document rels,
  styles.xml (Heading1/2/3, Normal, PraxisTable), and
  document.xml with the six-section body, options / risks /
  stakeholders tables, optional critique / appendices / sources
  / sourcing-report sections. ZIP writer uses `node:zlib`
  DEFLATE and pinned timestamps for byte-reproducible archives.
- **PDF renderer** (`src/renderers/pdf.ts`) — via pdfkit. Three
  themes (`professional` / `government` / `consulting`) affect
  accent colour and headline font. Layout: cover page, optional
  TOC, section pages, options / risks / stakeholders tables,
  optional critique, optional appendices, sources (grouped by
  domain), optional sourcing report, page footers with
  numbering. Supports `compress_pdf_streams: false` for tests
  that need to grep the raw buffer.
- **Renderers dispatcher** (`src/renderers/index.ts`) — one-line
  entry `render(brief, target, format, options)` that resolves
  the target against `format.output_targets[]` (accepts both
  the short YAML spelling `"md"` and the renderer-native
  `"md-enhanced"`) and dispatches to the right implementation.
  Unknown or format-disallowed targets raise
  `UnsupportedRenderTargetError`.
- **CLI `brief` command** extended with five new flags:
  - `--critique` — runs `briefWithCritique()` instead of
    `brief()`; renders the critique inline on stdout.
  - `--render <target>` — dispatches to the renderer; requires
    `--output <path>` (binary formats do not stream to stdout).
    Requires `--full`.
  - `--theme <name>` — picks the PDF theme
    (`professional` | `government` | `consulting`).
  - `--include-toc` — passes `include_toc: true` to the renderer.
  - `--include-appendices` — passes `include_appendices: true`
    to the renderer.
- **New prompt** (`prompts/adversarial.prompt`) — steelmanning
  discipline, precise-reference rule, severity calibration, and
  the derived `revised_recommendation_needed` logic explained
  in full to the model.
- **New fixtures** (`tests/fixtures/mock-llm/`):
  - `adversarial-{executive-pre-read,mckinsey-style-note,position-paper-corporate}.json`
    — five-critique analyses per shipped format calibrated on
    the German-market-entry test question, mixing minor,
    material, and critical severities. Every target
    cross-references a real artefact from the corresponding
    mock brief.
  - `adversarial-critical-triggering-revision.json` — three
    critical critiques force
    `revised_recommendation_needed=true`.
  - `adversarial-invalid-target.json` — references a
    non-existent `section_id` to exercise the cross-reference
    rejection path.
- **Optional live tests** (`tests/live/`):
  - `adversarial-agent.live.test.ts` — runs the critique agent
    against the real Anthropic API on a synthetic brief.
  - `full-brief-with-critique.live.test.ts` — runs the full
    seven-agent pipeline and writes the deliverable to
    `/tmp/praxis-live-brief-with-critique-<ts>.{md,pdf,docx}`
    for post-hoc human review.
- **~140 new tests** across adversarial-agent (39),
  briefWithCritique orchestrator (6), CLI v0.7 flags (13),
  markdown-enhanced renderer (23), DOCX renderer (17), PDF
  renderer (14), dispatcher (16), adversarial-e2e (5),
  render-pipeline-e2e (10), errors (3). **Total: 826 tests +
  11 optional live tests** (skipped without ANTHROPIC_API_KEY).

### Changed

- **`package.json.dependencies`** gains pdfkit (see justification
  above). `devDependencies` gains `@types/pdfkit`.
  `@promptlang/yaml-parser` remains a workspace dep.
- **CLI help** now advertises `--critique`, `--render`, `--theme`,
  `--include-toc`, `--include-appendices`.
- **Praxis version bumped** to `0.7.0` in `package.json` and
  `src/cli/version-constant.ts`.

### Notes on the design

- **`brief()` API unchanged.** v0.7 adds `briefWithCritique()`
  as a superset method. A v0.6-era consumer of `brief()` keeps
  working with zero code changes.
- **Steelman is structural, not stylistic.** The 20-word
  minimum on `steelmanned_position` is enforced at parse time
  because a critique the reviewer could not spend 20 words
  defending is not a critique — it is a complaint. The
  discipline is the whole point of the agent.
- **`revised_recommendation_needed` is derived, not asked.**
  The model classifies severity; the parser derives the
  revision signal from the count thresholds. Mismatches raise.
- **DOCX is from-scratch on purpose.** Adding a Word-writer
  library would double the runtime dep footprint for a format
  we render with three sections and one table style. From-scratch
  is ~500 lines and gives us full control.
- **PDF via pdfkit is the one exception.** Rendering PDF
  from-scratch would triple the LOC and require font-embedding.
  pdfkit was explicitly listed as the planned exception in the
  v0.1 migration prompt.

### Security notes

- No new environment variables. `ANTHROPIC_API_KEY` still guards
  the live provider; the adversarial agent reuses the same auth
  path.
- `--output` writes to any path the process can write to —
  automation callers should validate paths themselves; the CLI
  does not sandbox.
- pdfkit does not execute arbitrary code paths: only the
  metadata info dict includes user-provided strings, which
  pdfkit escapes for PDF syntax.

### Next

- **v0.8 — Polish + Web UI minimaliste.** Options: a minimal
  web UI that runs the pipeline in the browser (via a small
  server backend), an editorial re-run loop that feeds
  adversarial critiques back into a second Synthesis pass, or
  a Praxis-as-library API package. Priorities set by
  post-v0.7 dogfooding.

[0.7.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.7.0

## [0.6.0] — 2026-08-18

**Options Generation agent + Synthesis agent + `brief()` finally
implemented.** This is the release where Praxis crosses from
"pipeline components" to "pipeline output". Three tightly coupled
bricks land together because they validate each other: Options
without Synthesis has no rendered form; Synthesis without Options
has nothing specific to assemble in the recommendation section; and
`brief()` without both is still the `NotImplementedError` stub that
has been in the code since v0.2. The first complete, sourced,
format-conformant briefing rolls off the pipeline in this release.

### Added

- **Options Generation agent** (`src/agents/options.ts`) — fifth
  Praxis agent, first to consume ALL FOUR prior artefacts (Scoping +
  Research + Stakeholders + Risks):
  - `executeOptionsGeneration(ctx, llm)` loads
    `prompts/options.prompt`, dispatches to `llm.completeWithTools`
    with the `web_search` tool, and validates the returned JSON
    against `OptionsGenerationResult`.
  - Hard caps: `MIN_OPTIONS = 2`, `MAX_OPTIONS = 4`, 3-6 tradeoff
    dimensions per option, exactly one option carries
    `recommendation_level === "recommended"`.
  - Cross-artefact validation: every
    `stakeholder_impact.stakeholder_name` must exist in the
    supplied `StakeholderMapResult`; every `risks_mitigated[]` and
    `risks_introduced[]` id must exist in the supplied
    `RiskAnalysisResult`; a risk cannot appear in both lists for
    the same option. Fabricated cross-references are structurally
    forbidden.
  - Anti-vague tradeoff heuristic: `pros`, `cons`, `advantages`,
    `disadvantages`, `strengths`, `weaknesses`, `general`,
    `positives`, `negatives`, `benefits`, `drawbacks` are rejected
    at parse time (case-insensitive). The model must pick a
    concrete label (`cost`, `time-to-market`,
    `regulatory-exposure`, …).
  - Sequential IDs (`OPT-A`, `OPT-B`, `OPT-C`, `OPT-D`); duplicates
    and non-sequential IDs rejected.
  - Errors: `OptionsGenerationError`,
    `InvalidOptionStakeholderReference`,
    `InvalidOptionRiskReference`.
- **Synthesis agent** (`src/agents/synthesis.ts`) — sixth Praxis
  agent, consumes ALL FIVE prior artefacts:
  - `executeSynthesis(ctx, llm)` loads
    `prompts/synthesis.prompt`, iterates over
    `ctx.format.sections[]` in declared order, and issues ONE
    LLM call per section (no tool use — synthesis does not add
    facts).
  - Per-section post-validation: word count vs `max_length` with
    10% tolerance; forbidden_terms hit-count; validation_rules
    acknowledgement tracking; sources_cited existence check
    (every cited URL must appear in one of the upstream artefacts).
  - Aggregated `format_conformance` report with per-section
    over-length, per-section forbidden-term hits, and failed
    validation rules.
  - Fabricated sources are structurally forbidden — a cited URL
    absent from every upstream artefact raises `SynthesisError`.
  - Errors: `SynthesisError`, `SynthesisValidationError`.
- **`Orchestrator.brief()` implemented** — the six-agent pipeline
  chains Scoping → Research → Stakeholders → Risks → Options →
  Synthesis, threads a single `SourcingAccumulator` through every
  sourcing validation, and returns a `BriefResult`:

  ```ts
  interface BriefResult {
    scoping: ScopingResult;
    research: ResearchResult;
    stakeholders: StakeholderMapResult;
    risks: RiskAnalysisResult;
    options: OptionsGenerationResult;
    synthesis: SynthesisResult;
    sourcing_report: SourcingReport;
    generated_at: string;      // ISO 8601 UTC
    format_id: string;
    question: string;
    provider_name: string;
  }
  ```

  Refuses to run when the format's sections do not list every agent
  from `scoping` through `synthesis` in their `required_agents`.
- **CLI `brief` command** (`src/cli/commands/brief.ts`):
  - New flag `--full` — runs the full six-agent pipeline via
    `Orchestrator.brief()` and prints the assembled Markdown
    briefing (YAML front-matter + section headings + sources +
    validation notes) to stdout.
  - New flag `--output <path>` — writes the Markdown to a file
    instead of stdout. Requires `--full`. A one-line confirmation
    lands on stderr so pipelines don't silently swallow the output
    location.
  - `--full --json` — emits the complete `BriefResult` as JSON for
    audit / downstream tooling.
  - New flag `--with-sourcing-report` — appends the aggregated
    cross-agent sourcing report (as Markdown) beneath the briefing
    when used with `--full`. Also usable stand-alone (aliases the
    v0.5 `--sourcing-report` behaviour outside `--full`).
- **CLI output** (`src/cli/output.ts`):
  - `renderFullBrief(result)` — self-contained ANSI-free Markdown
    document with a YAML front-matter header (question, format,
    provider, generated_at, recommended option, aggregated risk,
    sourcing summary, word-count deviation).
- **New prompts** (`prompts/`):
  - `options.prompt` — MECE-tradeoffs, cross-artefact
    reference discipline, exactly-one-recommended.
  - `synthesis.prompt` — no-invention rule, per-section context
    (tone directives, max words, validation rules, forbidden
    terms), sources_cited discipline.
- **New fixtures** (`tests/fixtures/mock-llm/`):
  - `options-{executive-pre-read,mckinsey-style-note,position-paper-corporate}.json`
    — three-option analyses per shipped format, with valid
    stakeholder / risk cross-references.
  - `synthesis-{format}-{section}.json` × 18 — one fixture per
    (format, section) pair, calibrated on the German-market-entry
    test question, all cited URLs sourced from the upstream mock
    fixtures.
  - `synthesis-forbidden-terms.json`, `synthesis-over-length.json`
    — failure-mode fixtures exercising the per-section validation
    code paths.
- **Optional live integration tests** (`tests/live/`):
  - `options-agent.live.test.ts`,
    `synthesis-agent.live.test.ts`,
    `full-brief.live.test.ts` — the last writes a Markdown
    briefing to `/tmp/praxis-live-brief-<ts>.md` for post-hoc
    human review.
- **~150 new tests** across options-agent unit tests, synthesis-agent
  unit tests, orchestrator brief() end-to-end, CLI `--full`,
  options-e2e, synthesis-e2e, and full-brief-e2e. **Total: 651
  tests + 9 optional live tests** (all live tests skip without
  `ANTHROPIC_API_KEY`).

### Changed

- **`NotImplementedError` no longer thrown by `brief()`.** The class
  is kept in `src/orchestrator/errors.ts` (still re-exported from
  `src/index.ts`) because it is part of the public API surface and
  useful for future stubs. Its constructor message is
  generalised — the previous "Not implemented in v0.2" hardcode is
  removed.
- **`executive-pre-read` format** now lists `options` alongside
  `synthesis` in the `recommendation` section's `required_agents`.
  The recommendation section receives the recommended option from
  the Options agent; this makes the format honest about its
  agent-graph. The other two shipped formats already declared
  `options` in a section.
- **CLI help** now advertises `--full`, `--output`,
  `--with-sourcing-report` and drops the "coming in v0.6+" line.
- **Praxis version bumped** to `0.6.0` in `package.json` and
  `src/cli/version-constant.ts`.

### Notes on the design

- **Three bricks in one release, on purpose.** Options and Synthesis
  validate each other: without Synthesis, Options is a JSON payload
  the reader never sees rendered; without Options, Synthesis has
  nothing specific to assemble under `recommendation`. And without
  `brief()` implemented, the pipeline has no user-facing shape. All
  three land together because splitting them across three releases
  would ship two non-testable half-features.
- **Synthesis makes ONE LLM call per section**, not one call for the
  whole briefing. This keeps each call focused on one section's
  tone directives / max_length / validation_rules and lets the mock
  fixture set stay decomposable. It costs more LLM round-trips
  per brief (6 for the shipped formats vs 1 for a monolithic
  approach) but produces much better format conformance in
  practice — the tradeoff is worth it.
- **No-invention is enforced structurally, not stylistically.** A
  cited URL in a synthesized section that does not appear in an
  upstream artefact raises `SynthesisError` — the same discipline
  the sourcing layer applies to Research, Stakeholder, and Risk
  evidence.
- **The Markdown briefing is ANSI-free by design.** `--full` output
  is meant to be piped to a file, opened in an editor, or fed to a
  Markdown-to-PDF pipeline. ANSI codes would corrupt every
  downstream consumer.

### Security notes

- No new environment variables. `ANTHROPIC_API_KEY` still guards
  the live provider; Options and Synthesis reuse the same auth
  path.
- `--output` writes to any path the process can — no sandboxing.
  In a shell context this is desirable (users control where the
  file lands). Automation callers should validate the path
  themselves.
- The no-invention rule for Synthesis is a hard structural guard,
  not a soft prompt request — the parser rejects fabricated URLs
  regardless of what the LLM tries to emit.

### Next

- **v0.7 — Adversarial Critique agent.** Seventh Praxis agent —
  reads the completed brief and stress-tests the recommendation
  against its strongest counter-arguments. Output layer (PDF,
  DOCX, MD renderers) begins landing in the same release cycle.

[0.6.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.6.0

## [0.5.0] — 2026-08-18

**Risk Analysis agent + hardened Sourcing & Verification Layer.**
This release is deliberately larger than the previous ones because two
tightly coupled bricks land together: the fourth Praxis agent (Risk)
is the *first consumer* of a real, production-grade sourcing layer.
Shipping Risk against the v0.4 embryonic validator would have forced a
re-test cycle at v0.6, so v0.5 promotes the layer first — freshness
gates, domain trust bands, cross-agent citation dedupe — and then
exercises it seriously with the Risk agent.

### Added

- **Risk Analysis agent** (`src/agents/risk.ts`) — fourth Praxis
  agent, first to consume THREE prior outputs (Scoping + Research +
  Stakeholders):
  - `executeRiskAnalysis(ctx, llm)` loads `prompts/risk.prompt`,
    dispatches to `llm.completeWithTools` with the `web_search` tool,
    and validates the returned JSON against `RiskAnalysisResult`.
  - Hard caps: `MAX_RISKS = 25` (throws `RiskInflationError`), 5-15
    risks recommended.
  - Every `Risk` carries sourced likelihood_evidence AND
    impact_evidence (SourceReference OR explicit SOURCE_MISSING —
    same discipline as Research and Stakeholders).
  - `affected_stakeholders` must reference names verbatim from the
    supplied `StakeholderMapResult`; unknown names raise
    `InvalidRiskStakeholderReference`.
  - Sequential IDs (`RISK-001`, `RISK-002`, …); duplicates rejected.
  - Vague mitigations (`"monitor closely"`) rejected as
    `RiskAnalysisError`.
  - Exports: `RiskAnalysisError`, `InvalidRiskStakeholderReference`,
    `RiskInflationError`, `MAX_RISKS`, `MIN_RISKS`.
- **Risk types** (`src/agents/types.ts`): `RiskCategory` (8 values),
  `RiskLikelihood` (5 bands), `RiskImpact` (5 bands),
  `RiskTimeframe` (4 buckets), `AggregatedRiskLevel`, `Risk`,
  `RiskAnalysisResult`, `RiskContext`.
- **Hardened Sourcing & Verification Layer** (`src/sourcing/`):
  - `types.ts` extended with `SourcingRules`, `FreshnessRule`,
    `DomainTrustRule`, `DedupeRule`, `SourcingAccumulator`,
    `SourcingItemCategory`, `SourcingCategoryCounts`.
  - `freshness.ts` — `classifyFreshness(accessed_at, rule, now)` returns
    `fresh | warn | stale` with age in days. Malformed timestamps are
    treated as stale.
  - `domain-trust.ts` — `evaluateDomainTrust(url, rule)` returns
    `trusted | untrusted` with a human-readable reason. Wildcards
    supported: `*.gov`, `gov.*`, `*.gov.uk`, and generic patterns.
  - `dedupe.ts` — `InMemorySourcingAccumulator` and
    `NoopSourcingAccumulator`. URL normalisation (lowercase, strip
    tracking params, drop fragment, sort query), Levenshtein
    similarity threshold.
  - `report.ts` — `buildReport(policy, totalItems, warnings)` +
    `mergeReports([...])` build a `SourcingReport` with per-category
    counts (`ok / stale / untrusted / duplicated / missing`).
    Reconciles with `total_items`; most-severe wins.
  - `validator.ts` refactored into a unified dispatcher. Three public
    entry points (`validateSourcing`, `validateStakeholderSourcing`,
    `validateRiskSourcing`) all accept an optional `ValidateOptions`
    with `rules`, `accumulator`, `now`. Under strict policy the
    first blocking warning raises the most specific typed subclass;
    duplicates are non-blocking (warning only).
  - `errors.ts` — new typed subclasses: `StaleSourceError`,
    `UntrustedDomainError`, `DuplicateSourceError`. All inherit from
    `SourcingValidationError` so v0.4 catch-blocks still work.
    `isBlockingUnderStrict(warning)` helper for downstream code.
- **Format schema extension** (`src/registry/`):
  - `Format.sourcing_rules?: SourcingRules` — optional block covering
    `freshness`, `domain_trust`, and `dedupe`. Absent → v0.4 behaviour.
  - The three shipped formats now declare a `sourcing_rules` block
    calibrated to their genre:
    - `executive-pre-read`: freshness 730/365 days, reputation-only
      tiers (min_tier 2), cross-agent dedupe at similarity 0.85.
    - `position-paper-corporate`: freshness 1095/730 days (institutional
      positions age more slowly), allow-list mode.
    - `mckinsey-style-note`: freshness 545/270 days (consulting tempo),
      reputation-only min_tier 2 with a strategy-consultancy tier 2.
  - `validator.ts` extended with structural validation for every
    sub-schema (freshness, domain trust, reputation tiers, dedupe).
- **Orchestrator** (`src/orchestrator/orchestrator.ts`):
  - `assessRisksAfterStakeholders(question, formatId, options?)` —
    chains Scoping → Research → Stakeholders → Risks, threads a
    single `SourcingAccumulator` across all four validations, and
    returns `{ scoping, research, stakeholders, risks, sourcing_report }`.
  - Refuses to run when the format's sections do not list `research`,
    `stakeholder`, AND `risk`.
- **CLI `brief` command** (`src/cli/commands/brief.ts`):
  - New flag `--with-risks` (implies `--with-stakeholders` which
    implies `--with-research`). Emits a stdout note when used
    without the earlier flags (suppressed under `--json`).
  - New flag `--sourcing-report` — prints ONLY the aggregated
    cross-agent report (implies `--with-risks`; the full pipeline is
    what produces the report).
  - `--with-risks --json` emits a combined
    `{ scoping, research, stakeholders, risks, sourcing_report }`.
- **CLI output** (`src/cli/output.ts`):
  - `renderRisks(result)` — compact ANSI table
    (ID | Category | Likelihood | Impact | Timeframe | Description),
    followed by aggregated score, top-3, per-risk detail blocks with
    likelihood/impact evidence lines.
  - `renderSourcingReport(report)` — one-line summary with per-category
    counts plus a categorised warnings list.
- **New prompt** (`prompts/risk.prompt`) — Risk agent prompt with
  explicit calibration for likelihood, impact, mitigation quality,
  and the anti-fabrication rule for BOTH source references and
  stakeholder names.
- **New fixtures** (`tests/fixtures/mock-llm/`):
  - `risks-executive-pre-read.json`,
    `risks-mckinsey-style-note.json`,
    `risks-position-paper-corporate.json` — one 8-9-risk analysis
    per shipped format, calibrated on the German-market-entry test
    question. All evidence URLs sit on the shipped formats' trusted
    tiers; all `affected_stakeholders` reference the corresponding
    stakeholder fixture's names verbatim.
- **New reference fixtures** (`tests/fixtures/hardened-sourcing/`):
  - `stale-sources.json`, `untrusted-domains.json`,
    `duplicate-sources.json` — canonical failure examples used by
    `tests/integration/sourcing-hardened-e2e.test.ts`.
- **Optional live integration tests** (`tests/live/`):
  - `risk-agent.live.test.ts` — end-to-end run of the Risk agent
    against the real Anthropic API.
  - `full-pipeline.live.test.ts` — end-to-end run of the full v0.5
    pipeline (Scoping → Research → Stakeholders → Risks + hardened
    sourcing), writes the report to `/tmp` for post-hoc inspection.
- **181 new tests** across schema/validator (v0.5 rules), sourcing
  (freshness, domain trust, dedupe, report, unified validator), risk
  agent (nominal + every error path), orchestrator
  (`assessRisksAfterStakeholders`), CLI brief (`--with-risks`,
  `--sourcing-report`), integration (`risks-e2e`,
  `sourcing-hardened-e2e`), and errors. **Total: 549 tests + 6 optional
  live tests** (all live tests skip without `ANTHROPIC_API_KEY`).

### Changed

- **Sourcing validator dispatcher.** The three entry points
  (`validateSourcing`, `validateStakeholderSourcing`,
  `validateRiskSourcing`) now share a common `inspectSource` pipeline.
  v0.4 behaviour is preserved: without `rules` in `ValidateOptions`,
  only the SOURCE_MISSING check runs, and strict/permissive
  semantics are unchanged.
- **`SourcingReport` shape.** The v0.4 `{ policy, total_items,
  missing_sources_count, warnings }` shape gains a `counts:
  SourcingCategoryCounts` field for per-category totals.
  `missing_sources_count` is preserved as a convenience alias.
  Consumers reading only the v0.4 fields keep working.
- **`SourcingValidationError`** now accepts an optional custom
  `message` (used by the typed subclasses to attach URL/reason
  context). The v0.4 default message shape is preserved when no
  custom message is provided.
- **`SourcingWarning`** gains four new variants: `missing_risk_evidence`,
  `stale_source`, `untrusted_domain`, `duplicate_source`. Consumers
  narrowing on `kind` must handle the new variants (or exhaustive
  switches will fail the compiler under strict TS settings).
- **Shipped format YAML files.** Every shipped format now declares a
  `sourcing_rules` block. Existing `sourcing_policy` values (all
  strict) are unchanged and now describe the failure mode (throw on
  first blocking warning).
- **Existing fixtures** (`stakeholders-*.json`,
  `research-mckinsey-style-note.json`) now use tier-1/tier-2 URLs
  compatible with the shipped formats' `sourcing_rules`. The
  substantive claims and stakeholder names are unchanged.
- **CLI help** now documents `--with-risks` and `--sourcing-report`.
- **Praxis version bumped** to `0.5.0` in `package.json` and
  `src/cli/version-constant.ts`.

### Notes on the design

- **Two bricks in one release, on purpose.** v0.1-v0.4 shipped one
  agent per release. v0.5 breaks that pattern because the sourcing
  layer had to be promoted from embryonic to production-grade
  *before* Risk consumed it — otherwise Risk would have been built
  against the wrong contract and re-tested at v0.6. The discipline
  "one release = one well-formed brick" is preserved: here the brick
  is *the transition to production-grade sourcing*, with Risk as its
  first serious consumer.
- **Retro-compat for `sourcing_rules`.** A format that omits the
  block behaves exactly as under v0.4. This lets contributors ship a
  format now and adopt rules later. The three shipped formats have
  been migrated to the new block.
- **Cross-agent dedupe is warning-only by default.** Two agents
  citing the same URL is often legitimate (the CEO's statement
  appears in both Research and Stakeholder evidence). Rather than
  block, the report flags it so the reader can audit. Future
  releases may add a strict-dedupe opt-in.
- **Risk stakeholder validation is exact-name matching.** No fuzzy
  matching, no alias resolution. If the Risk agent wants to cite an
  actor not in the mapping, it must return SOURCE_MISSING evidence
  and add the actor to `unresolved_uncertainties` — the mapping is
  the ground truth.

### Security notes

- No new environment variables. `ANTHROPIC_API_KEY` still guards the
  live provider; the risk agent reuses the same auth path.
- The risk prompt's stakeholder-reference rule is reinforced with a
  note that fabricated cross-references are misconduct — the reader
  will make an operational decision partly based on which
  stakeholders a risk touches.

### Next

- **v0.6 — Options Generation agent + Synthesis agent.** Fifth and
  sixth Praxis agents. Options reads all four prior outputs and
  enumerates the two-to-four courses of action worth putting in
  front of the reader.

[0.5.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.5.0

## [0.4.0] — 2026-08-17

**Stakeholder Mapping agent.** Third Praxis agent, and the first one
whose input includes BOTH the Scoping and Research outputs. Also the
first agent that is "analytical" in the strong sense — it synthesises
a model of the terrain rather than reformulating or collecting.

The Sourcing & Verification layer grows to cover a second agent
without duplication: the same `SourceReference | SOURCE_MISSING`
discipline that governs Research findings now governs Stakeholder
position evidence.

### Added

- **Stakeholder Mapping agent** (`src/agents/stakeholder.ts`):
  - `executeStakeholderMapping(ctx, llm)` loads
    `prompts/stakeholder.prompt`, parses it via PromptLang,
    interpolates `{{scoping_json}}` / `{{research_json}}` /
    `{{format_id}}` / `{{sourcing_policy}}`, dispatches to
    `llm.completeWithTools` with the `web_search` tool, and validates
    the returned JSON against `StakeholderMapResult`.
  - Hard caps: minimum 3, maximum 20 stakeholders per mapping. Enforced
    by the parser as `StakeholderMappingError`.
  - Every `position_evidence` field must be either a real
    `SourceReference` or an explicit `SOURCE_MISSING` marker —
    fabricated evidence is structurally forbidden.
  - Errors: `StakeholderMappingError`.
- **Stakeholder types** (`src/agents/types.ts`):
  - `StakeholderCategory` (decision-maker / influencer / gatekeeper /
    affected-party / external-observer).
  - `StakeholderPower` (high | medium | low),
    `StakeholderPosition` (supportive | neutral | resistant | unknown),
    `StakeholderPriority` (critical | important | monitor).
  - `Stakeholder`, `StakeholderMapResult`, `StakeholderContext`.
- **Sourcing Layer extension** (`src/sourcing/`):
  - `validateStakeholderSourcing(map, policy)` — same policy semantics
    as `validateSourcing`, applied to stakeholder position evidence.
  - `SourcingWarning` is now a discriminated union with two variants:
    `missing_source` (research finding) and
    `missing_stakeholder_evidence` (stakeholder position).
  - `SourcingReport.total_findings` renamed to `SourcingReport.total_items`
    so the shape works uniformly across agents.
- **Orchestrator** (`src/orchestrator/orchestrator.ts`):
  - `mapStakeholdersAfterResearch(question, formatId)` — chains
    Scoping → Research → Stakeholder Mapping, enforces
    `format.sourcing_policy` on BOTH research findings and stakeholder
    positions, returns `{ scoping, research, stakeholders }`.
  - Refuses to run when the format's sections do not list `research`
    AND `stakeholder`.
  - `brief()` still throws `NotImplementedError`.
- **CLI `brief` command** (`src/cli/commands/brief.ts`):
  - New flag `--with-stakeholders`. Implies `--with-research`; a note
    is emitted to stdout when the flag is used alone (suppressed under
    `--json` to keep the piped stream valid).
  - `--with-stakeholders --json` emits a combined
    `{ scoping, research, stakeholders }` object.
  - `--with-stakeholders --provider anthropic` without
    `ANTHROPIC_API_KEY` exits 1 with the same clear error as
    `--with-research`.
- **CLI output helpers** (`src/cli/output.ts`):
  - `renderStakeholders(result)` — compact ANSI table
    (Name | Category | Position | Power | Priority) followed by
    per-stakeholder interest / engagement / sourced-evidence blocks,
    plus Key dynamics and Blind spots sections.
- **New prompt** (`prompts/stakeholder.prompt`) — Stakeholder Mapping
  prompt with the same anti-hallucination rule as the Research prompt
  applied to `position_evidence`.
- **New fixtures** (`tests/fixtures/mock-llm/`):
  - `stakeholders-executive-pre-read.json`,
    `stakeholders-mckinsey-style-note.json`,
    `stakeholders-position-paper-corporate.json` — one realistic
    mapping per shipped format (7-8 stakeholders each, all fully
    sourced under the strict policy the shipped formats declare).
- **Optional live integration test** (`tests/live/stakeholder-agent.live.test.ts`)
  — end-to-end run against the real Anthropic API, skipped without
  `ANTHROPIC_API_KEY`.
- **59 new tests** (30 stakeholder-agent, 5 sourcing extension, 8
  orchestrator, 9 CLI-brief, 7 integration). **Total: 368 tests + 4
  optional live tests** (all live tests skip without the key).

### Changed

- **`SourcingReport.total_findings` → `total_items`.** The generic
  name lets the same report shape describe research-finding
  validation and stakeholder-position validation. v0.3 consumers that
  read `total_findings` must rename.
- **`SourcingWarning` is now a discriminated union.** Existing
  `missing_source` variant kept unchanged; new
  `missing_stakeholder_evidence` variant added. Consumers reading
  variant-specific fields must narrow on `kind`.
- **`SourcingValidationError` message** updated to use the generic
  "items" wording so it reads correctly for both agents.
- **CLI help** now documents `--with-stakeholders`.
- **Praxis version bumped** to `0.4.0` in `package.json` and
  `src/cli/version-constant.ts`.

### Security notes

- No new environment variables. `ANTHROPIC_API_KEY` still guards the
  live provider; the stakeholder agent reuses the same auth path.
- The prompt's sourcing rule is reinforced with a note about people:
  fabricated evidence about a real person or organisation is a
  distinct kind of harm — the agent must default to `SOURCE_MISSING`
  when in doubt.

### Notes on the design

- Stakeholder Mapping is the first agent whose `AgentContext` includes
  two prior outputs. The pattern generalises: future agents (Risk,
  Options, Adversarial) will each declare which prior outputs they
  consume and the Orchestrator will type-check the sequencing.
- The category vocabulary (decision-maker / influencer / gatekeeper /
  affected-party / external-observer) is deliberately coarse. Later
  releases may add sub-typing for regulator vs media vs union under
  `external-observer` — the enum extension will be additive.

### Next

- **v0.5 — Risk Analysis agent + hardened Sourcing Layer.** Fourth
  agent (Risk), extension of the sourcing layer with freshness gates
  and domain-trust bands.

[0.4.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.4.0

## [0.3.0] — 2026-08-17

**Research agent + real Anthropic provider.** First live LLM backend,
second Praxis agent, first pass at the Sourcing & Verification layer.

The `MockLLMProvider` still ships and remains the default for tests and
offline runs. What's new is that Praxis can now talk to the real
Anthropic Messages API — using Bun's native `fetch`, with zero
external HTTP libraries and zero npm dependencies added.

### Added

- **AnthropicLLMProvider** (`src/llm/anthropic-provider.ts`):
  - `complete(prompt, options?)` and `completeWithTools(prompt, tools, options?)`
    against `POST https://api.anthropic.com/v1/messages`.
  - Reads the API key from `ANTHROPIC_API_KEY`; throws
    `AnthropicAuthenticationError` if unset.
  - Reads the model from `ANTHROPIC_MODEL`; defaults to
    `claude-sonnet-4-5`.
  - Retry on `429` / `5xx` with exponential backoff `1s → 2s → 4s`,
    up to 3 attempts total. **Never** retries on `4xx`.
  - Per-request timeout (`60s` default) enforced via `AbortController`.
  - Server-side tool-use loop up to `max_tool_rounds` (default 5) —
    handles `stop_reason: "pause_turn"` by echoing the assistant
    message back and issuing another request.
- **LLM interface extension** (`src/llm/`):
  - `LLMProvider.completeWithTools(prompt, tools, options?)` — optional
    method for providers that support tool use.
  - New types: `Tool`, `ToolCall`, `CompletionResult`,
    `CompleteWithToolsOptions` (`src/llm/types.ts`).
  - New errors: `ToolUseNotSupportedError`,
    `AnthropicAuthenticationError`, `AnthropicAPIError`,
    `AnthropicRateLimitError`, `AnthropicTimeoutError`.
  - `MockLLMProvider` gains `completeWithTools` — reads optional
    `tool_calls`, `rounds`, `stop_reason` fields from its fixtures.
- **Research agent** (`src/agents/research.ts`):
  - `executeResearch(ctx, llm)` loads `prompts/research.prompt`,
    parses it via PromptLang, interpolates `{{scoping_json}}` /
    `{{format_id}}` / `{{sourcing_policy}}` / `{{target_words}}`,
    dispatches to `llm.completeWithTools` with the `web_search` tool,
    caps the tool-use loop at `max_tool_rounds`, and validates the
    returned JSON against `ResearchResult`.
  - Errors: `ResearchAgentError`, `MaxToolRoundsExceededError`.
- **Sourcing & Verification Layer** (`src/sourcing/`, embryonic):
  - Types: `SourceReference`, `SourceMissing`, `SourceStatus`,
    `SourcingWarning`, `SourcingReport`.
  - `validateSourcing(result, policy)` — `strict` throws
    `SourcingValidationError` if any finding is `SOURCE_MISSING`;
    `permissive` returns a report with warnings and never throws.
  - The Orchestrator wires this in after Research runs. Later releases
    (v0.5+) will expand the layer with dedupe, freshness checks, and
    cross-agent citation normalisation.
- **Orchestrator** (`src/orchestrator/orchestrator.ts`):
  - `researchAfterScoping(question, formatId)` — chains Scoping then
    Research, enforces `format.sourcing_policy`, returns
    `{ scoping, research }`.
  - Refuses to run when the format's sections do not list `research`.
  - `brief(...)` still throws `NotImplementedError` — the full
    pipeline (synthesis, editorial, style, formatter) lands from v0.6.
- **CLI `brief` command** (`src/cli/commands/brief.ts`):
  - New flag `--with-research` — runs Scoping + Research.
  - New provider option `--provider anthropic` — enables live LLM.
  - `--provider mock` remains the default.
  - `--json` in `--with-research` mode emits a combined
    `{ scoping, research }` object.
  - `--provider anthropic` without `ANTHROPIC_API_KEY` exits 1 with
    a clear "see CONTRIBUTING.md" pointer.
- **New prompt** (`prompts/research.prompt`) — Research agent prompt
  with an explicit anti-hallucination rule ("real source or
  SOURCE_MISSING — never invent").
- **New fixtures** (`tests/fixtures/mock-llm/`):
  - `research-executive-pre-read.json`,
    `research-mckinsey-style-note.json`,
    `research-position-paper-corporate.json` — one per shipped format.
  - `anthropic-api/` — raw response bodies for the AnthropicLLMProvider
    parsing tests (`simple-message-response.json`,
    `tool-use-response.json`, `multi-turn-tool-use.json`,
    `rate-limit-error.json`).
- **Optional live integration tests** (`tests/live/`):
  - `anthropic-provider.live.test.ts`,
    `research-agent.live.test.ts` — skipped by default via
    `describe.skipIf(!ANTHROPIC_API_KEY)`. Run manually with
    `bun test tests/live/` after exporting the key.
- **Environment configuration**:
  - `.env.example` at the repo root, documenting
    `ANTHROPIC_API_KEY` and the optional `ANTHROPIC_MODEL`.
  - `.gitignore` already excluded `.env`; no changes needed.
- **Documentation**:
  - `docs/providers.md` — provider interface, setup, cost model,
    how to add a new provider.
  - `docs/sourcing.md` — sourcing philosophy, `SourceReference` /
    `SOURCE_MISSING` shape, strict vs permissive policy.
  - `README.md` — new **Configuring providers** section covering
    `ANTHROPIC_API_KEY` and provider selection.
  - `CONTRIBUTING.md` — updated with `.env` setup and pointer to
    live tests.
- **90 new tests** across the LLM tool-use extension, AnthropicLLMProvider
  (fetch-mocked), Sourcing validator/errors, Research agent,
  Orchestrator `researchAfterScoping`, extended CLI brief, and one
  end-to-end integration test. **Total: 309 tests + 3 optional
  live tests** (skipped without `ANTHROPIC_API_KEY`).

### Changed

- **`ProviderNotSupportedError` message** — now lists both supported
  providers (`mock`, `anthropic`) instead of v0.2's "only mock" hint.
- **`Orchestrator.scope` refactor** — internal `prepareForScoping`
  and `doScoping` helpers factor out common validation shared with
  `researchAfterScoping`. No behavioural change to `scope()`.
- **CLI help** now documents `--with-research` and
  `--provider mock|anthropic`.
- **Praxis version bumped** to `0.3.0` in `package.json` and
  `src/cli/version-constant.ts`.

### Security notes

- `.env` remains git-ignored. `.env.example` uses a placeholder
  (`your-key-here`) — never commit a real key.
- No API key is logged, echoed, or written to disk by the provider —
  the key lives in memory only and is sent via the `x-api-key` header.
- The AnthropicLLMProvider truncates response bodies inside error
  messages to 400 chars so accidental log leaks are bounded.

### Notes on the tool-use design

- Anthropic's `web_search_20250305` is a **server-side** tool: the API
  executes it and inlines the tool_use / tool_result blocks in the
  same response. The provider still handles a client-side loop for
  `stop_reason: "pause_turn"` (up to `max_tool_rounds`) so that
  multi-search runs work identically to single-search runs.
- Praxis-side tool identifiers are vendor-neutral (`web_search`); the
  provider maps them to versioned API strings (`web_search_20250305`).
  This lets us swap tool implementations without touching agent code.

### Next

- **v0.4 — Stakeholder Mapping agent.** Third Praxis agent, first
  agent whose input includes both Scoping and Research outputs.

[0.3.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.3.0

## [0.2.0] — 2026-08-14

**Agent Scoping.** First Praxis agent, first end-to-end run through the
Orchestrator, first use of PromptLang as a first-class dependency.

No real LLM calls yet — the CLI is wired to a deterministic
`MockLLMProvider` that reads pre-scripted fixtures. The real Anthropic
provider lands in v0.3.

### Added

- **LLM provider abstraction** (`src/llm/`):
  - `LLMProvider` interface — the single surface all agents call
    (`complete(prompt, options?)`).
  - `MockLLMProvider` — deterministic, offline provider that reads JSON
    fixtures under `tests/fixtures/mock-llm/`. Matches on the first
    fixture whose `match_substring` appears in the rendered prompt.
  - Typed error hierarchy: `LLMError`, `ProviderNotSupportedError`,
    `MockFixtureNotFoundError`.
- **Scoping agent** (`src/agents/`):
  - `executeScoping(ctx, llm)` loads `prompts/scoping.prompt`, parses it
    via PromptLang, interpolates `{{question}}` / `{{format_id}}` /
    `{{target_words}}`, dispatches the resulting prompt to the injected
    `LLMProvider`, and validates the returned JSON against
    `ScopingResult`.
  - Errors: `AgentExecutionError`, `InvalidAgentOutputError`,
    `PromptFileError`.
- **Orchestrator** (`src/orchestrator/`):
  - `Orchestrator.scope(question, formatId)` — resolves the format from
    the registry, checks that at least one section requires the
    `scoping` agent, then runs it. Returns the typed `ScopingResult`.
  - `Orchestrator.brief(...)` — explicit `NotImplementedError`; full
    pipeline lands in v0.6+.
  - Errors: `NotImplementedError`, `OrchestrationError`.
- **CLI `brief` command** (`src/cli/commands/brief.ts`):
  - `praxis brief "<question>" --format <id> [--provider mock] [--json]`.
  - Runs scoping only in v0.2; prints the JSON output pretty-printed or,
    with `--json`, raw for piping.
  - Rejects any `--provider` other than `mock` with a clear v0.2 error.
- **Prompt file** (`prompts/scoping.prompt`) — the scoping prompt
  authored in PromptLang, plus `prompts/README.md` documenting the
  authoring convention.
- **Mock fixtures** (`tests/fixtures/mock-llm/`) — one per shipped
  format: `scoping-executive-pre-read.json`,
  `scoping-mckinsey-style-note.json`,
  `scoping-position-paper-corporate.json`.
- **Documentation**:
  - `docs/architecture.md` — v0.2 architecture map with an ASCII flow
    diagram (Registry → Orchestrator → Agent → PromptLang → LLM
    Provider → JSON output).
  - `docs/writing-a-prompt.md` — contributor guide for authoring a
    `.prompt` on the Praxis side.
  - `CONTRIBUTING.md` — development setup (Bun 1.3+,
    `~/dev/promptlang` sibling checkout).
  - `README.md` extended with **Development setup** and
    **Architecture** sections.
- **73 new tests** covering the LLM abstraction, Scoping agent,
  Orchestrator, brief CLI command, and one end-to-end integration test.
  Total: **219 tests**, zero fails, zero skips.

### Changed

- **YAML parsing** now imports from `@promptlang/yaml-parser`
  (workspace-linked to the sibling `~/dev/promptlang` checkout) instead
  of the vendored copy.
- **`Orchestrator` supersedes** any earlier ad-hoc plan for a "plan JSON
  emitter" — v0.2 actually executes the scoping agent rather than only
  emitting a static plan, which is a stronger validation of the
  architecture.
- **CLI dispatcher** (`src/cli/index.ts`) is now `async` and awaits the
  new `brief` command.
- **Praxis version bumped** to `0.2.0` in `package.json` and
  `src/cli/version-constant.ts`.

### Removed

- **Vendored YAML parser** (`src/vendor/yaml-parser/`) — the v0.1 tech
  debt is resolved. Consumers now depend on `@promptlang/yaml-parser`
  directly.

### Notes on the PromptLang integration

- Praxis expects the sibling checkout `~/dev/promptlang` (see
  `CONTRIBUTING.md`). `package.json` declares
  `"@promptlang/yaml-parser": "file:../promptlang/packages/yaml-parser"`
  and `tsconfig.json` maps `promptlang/*` paths to
  `../promptlang/src/*`. This will migrate to a plain npm dependency
  when PromptLang publishes to the registry.
- The `.prompt` extension is used (PromptLang's official convention) —
  older Praxis planning docs mentioned `.pl`; that name is dropped.
- The scoping prompt's return type is declared as `string` (an opaque
  JSON blob) because PromptLang v1.1 does not yet parse array types
  inside struct fields. The full schema is enforced Praxis-side by
  `parseScopingResult` in `src/agents/scoping.ts`. When PromptLang
  ships array types, the return type will migrate to a proper struct
  without any behavioural change.

### Next

- **v0.3 — Research agent + real Anthropic provider.** Replace the
  MockLLMProvider hook with a live `AnthropicProvider`, and ship the
  second agent (retrieval, evidence extraction, citation
  normalisation).

[0.2.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.2.0

---

## [0.1.0] — 2026-08-14

Initial release. The **Format Registry** — the declarative foundation
every future release depends on.

### Added

- **Format schema** (`src/registry/schema.ts`): typed contract for a
  briefing format, including seven `organization_style` values, three
  `language` values, two `sourcing_policy` values, seven canonical
  `agent` ids, and three `output_target` values.
- **Strict validator** (`src/registry/validator.ts`): accumulates all
  structural issues before throwing, rejects unknown top-level keys,
  validates SemVer, ISO dates, kebab-case, positive integers, section id
  uniqueness, and agent-id whitelist.
- **YAML loader** (`src/registry/loader.ts`): reads a `.yaml` file,
  parses it, validates it, and surfaces errors as typed subclasses of
  `PraxisError`.
- **In-memory registry** (`src/registry/registry.ts`): `FormatRegistry`
  class with `register`, `get`, `find`, `has`, `list`,
  `filterByOrgStyle`, `listEntries`, plus `loadDirectory` and
  `loadRegistry` convenience helpers.
- **CLI** (`src/cli/index.ts`): four commands — `version`,
  `formats list [--org-style]`, `formats inspect <id>`,
  `formats validate <path>`. Native ANSI colour, `NO_COLOR` support,
  fixed-width table renderer with zero dependencies.
- **Three production-ready formats** (`formats/`):
  - `executive-pre-read.yaml` — universal 2-page briefing (generic org
    style, 800-word target).
  - `position-paper-corporate.yaml` — corporate affairs 4-page paper
    (1600-word target) with rebuttal discipline.
  - `mckinsey-style-note.yaml` — Barbara Minto pyramid-principle
    3-page note (1200-word target).
- **146 tests** across schema, validator, loader, registry, CLI, and
  format integrity. Zero skips.
- **Documentation**: `README.md`, `ROADMAP.md`, `docs/format-schema.md`,
  `docs/creating-a-format.md`.

### Technical debt (carried into v0.2)

- **Vendored YAML parser** at `src/vendor/yaml-parser/`. Copied verbatim
  from PromptLang to preserve the "zero external dependencies" rule of
  v0.1. **Must** be extracted as an npm package
  (`@promptlang/yaml-parser`) before v0.2 ships. The extraction plan is
  documented in `src/vendor/yaml-parser/PROVENANCE.md`.

### Next

- **v0.2 — Agent Scoping.** Ship the first PromptLang-authored agent
  (`scoping`) and the orchestrator scaffold that will read the Format
  Registry to decide which agents to invoke per section. See
  `ROADMAP.md` for the full ten-step plan.

[0.1.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.1.0
