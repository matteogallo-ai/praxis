# Changelog

All notable changes to Praxis are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and Praxis adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Corrected

- README's Status opens with the single-call verdict; its Roadmap no longer
  lists live completion as missing when six briefings completed (CLAIMS C14);
  README and the system card state that the question 12 review's blinding is
  self-enforced. ROADMAP.md's dated status is a pointer to README and the
  system card, and `check:stale-narrative` scans it up to its release history.
- Mock briefings printed figures attributed to real institutions with
  invented URLs and counted fixture sources as `ok`. Every mock output opens
  with "DONNÉES FICTIVES — mode mock" and shows `ok=0`, sources `unverified`.
- The system card's "6 of 13 | 23%–71% (Wilson)" pooled four code versions
  and five unrecorded attempts; it gives completions per commit, no interval.
- README said "nothing runs in parallel" while the synthesis sections run
  concurrently; "McKinsey-style" is gone from the tagline.
- Comments that said when ("v0.8 additions.") are rewritten, and
  `check:stale-narrative` fails on a release number in a `.ts` comment under
  `src/`, `tests/`, `benchmarks/` or `scripts/`.
- The seven stages share one JSON-answer reader, `parseAnswerObject()`;
  scoping refuses an empty answer as "empty response".
- `bun run lint` fails on any Biome warning; tests may use non-null
  assertions.
- A format's validation-rule check took time quadratic in a run of spaces;
  it is linear and refuses a whitespace-only rule (CodeQL
  `js/polynomial-redos`).
- A stakeholder name with backticks across lines could become a link in the
  enhanced Markdown's stakeholder table; the cell joins its lines before
  escaping.
- Tests use a fresh 0700 temp directory per run (CodeQL
  `js/insecure-temporary-file`).
- SECURITY.md names e-mail as its one channel; GitHub's private
  vulnerability reporting is disabled.
- `@promptlang/core` 3.0.0 (was 2.0.0); the prompts parse to identical ASTs.
- The live-proof protocol no longer says question 10's amendment was
  recorded before the run: it was written down after step 1 had started.
- No model text in the Markdown outputs becomes a link, an image or an
  autolink; citation markers show as `[1]`. PDF and DOCX unchanged.
- Position paper 1.1.0: the rationale's strands end with the marker `[n]`,
  with no site name, host or URL in the text.
- The human review of question 10's step 1 first-party sources is published
  (8 reviewed, 6 accepted, 2 refused); the rule excludes a risk's evidence
  and a critique's counter-evidence (ADR 0003).
- URLs, hosts and queries of the "Insufficiently sourced" section and of the
  CLI's Markdown sourcing report are code spans, not links.
- PDF: a table row is as tall as its longest wrapped cell, and the header
  repeats after a page break.
- PDF: the footer no longer opens pages of its own (question 10's step 1
  briefing has 96 pages, 32 of them with content).
- A refused `www.` address in a synthesis section is quoted whole in the
  error, cut at 200 characters.
- Question 05 is no longer held-out: the sourcing fixes were designed from
  its step 0 failures.
- The judge prompt delimits the briefing as untrusted content and no longer
  expands `$&`-style patterns in it.
- The project was described as feature-complete and running live; until 4
  Nov 2026 it had never completed a live briefing (5 of 5 aborted, see
  1.2.1).
- The "AI-assisted qualitative scoring" of mock briefings is withdrawn: the
  scores graded the fixtures. The v1.3.1 re-scoring plan is abandoned.
- README and the system card said every live run failed "5 of 5"; the count
  is computed from the run records (`tests/docs/live-records.ts`).
- Source freshness was measured on `accessed_at`, so a live source was
  always fresh; it is judged on an optional `published_at`, and a source
  without one counts in `freshness_unknown`.
- The options' citations follow the domain-trust rule like stages 2–4
  (strict fails or degrades); critiques' are reported without blocking. Both
  are listed in `SourcingReport.untrusted_citations`.

### Added

- On question 12 the blind review preferred the single call ($0.48) to the
  pipeline ($4.75); 3 of 4 checked claims (one per section) in the pipeline's briefing and 2 of
  4 in the single call's were unsupported. Applying the pre-registered rule,
  README and the system card state that Praxis's value over a single call is
  not demonstrated (n = 1 question, 1 reviewer), and that briefing quality
  is reviewed for question 12 only.
- A pre-registered single-call baseline for question 12, run once at $0.48,
  and a blind A/B review pack (`benchmarks/review/`); the review is the
  maintainer's.
- `bun run hard-case:sources`: for question 12, each sodium-ion sentence of
  the latest live brief with each source's chemistry, read from its title
  and URL. It reads files only and fails nothing. On the 4 Nov 2026 record:
  22 pairs, 9 on sodium-ion, 0 on another chemistry, 1 unclear, 12 without a
  source.
- `bun run results` writes `benchmarks/RESULTS.md` from the committed
  artefacts; CI runs it with `--check`. `score:live` writes each judgment to
  `benchmarks/judgments/`.
- `bun run agreement`: the maintainer's blind scores against the judge's
  (exact, within-one, quadratic-weighted kappa; 0.6 threshold).
- The hostile-output tests render the Markdown with marked (GFM) and check
  that no `href` or `src` points at the hostile host.
- Every listing of a first-party source shows the claim it was accepted for,
  cut at 160 characters (`FirstPartySource.claim`, optional).
- Step 1 live records (4 Nov 2026, `8df678f`): questions 08, 10, 11 and 12
  completed, all flagged insufficiently sourced; question 02 failed in
  synthesis. $17.96 spent against a $30.23 central estimate.
- First-party sources (ADR 0003): a research or stakeholder source on an
  untrusted host counts as the organisation's own source when the stage marks
  it `first_party_for` an organisation of the reviewed list, the host is one
  of its domains and the item names it; such sources do not block under `strict` and are listed apart.
- The research, stakeholder, risk and options prompts (3.0.0) name the
  format's trusted hosts by tier and ask for each source's `published_at`.
- Scoping names the facts only the requester can supply
  (`requester_provided`); they are listed apart, never counted as sourced.
- The first completed live briefing: question 05, 4 Nov 2026, $3.51, flagged
  insufficiently sourced (`benchmarks/outputs/live/05-supply-chain-acquisition/`).
- `docs/live-proof-protocol.md` and `bun run estimate:cost`; `bench:live`
  needs `--max-cost-usd`, and live artefacts are never overwritten.
- A hard case in the evaluation set (question 12) and a frozen dev/test split
  (`benchmarks/split.yaml`); `run-all.ts --split dev|test`.
- Property-based tests (fast-check) and mutation testing (Stryker,
  `bun run mutation`, `docs/mutation-testing.md`).
- CI: typecheck, tests, Biome, knip, `check:claims`, `check:stale-narrative`,
  `bench:mock` drift check, Conventional Commits, `prompt-semver`.
- `docs/CLAIMS.md` with `scripts/check-claims.ts`, `CLAUDE.md`,
  `SECURITY.md`, PR and issue templates, `docs/ENGINEERING_STANDARDS.md`.
- `docs/THREAT_MODEL.md`, `docs/SYSTEM_CARD.md`, `docs/SLO.md`,
  `docs/RUNBOOK.md` and the ADR index.
- Supply chain: SHA-pinned actions, Dependabot, CodeQL, OSV-Scanner, OpenSSF
  Scorecard, and an attested, reviewer-approved release workflow.
- `PRAXIS_NOW` freezes the CLI clock for freshness verdicts and run ids.
- Per-stage checkpoints and `praxis brief --resume <run-id>`; `--runs-dir`.
- `UsageLedger` (tokens, web searches, cost per stage), `--price-table`, and
  the budget cap `maxCostUsd` / `--max-cost-usd` (`BudgetExceededError`).
- `onSourcingFailure: "degrade"` / `--on-sourcing-failure`: a strict sourcing
  failure adds an "Insufficiently sourced" section instead of aborting.
- Per-stage `max_tokens`, request timeout and web-search cap; `timeout_ms` on
  provider calls.

### Changed

- README fits one page; the live excerpt is in `benchmarks/outputs/live/README.md`
  and the per-briefing figures in the system card. Authorship is stated in one
  sentence, the same in the README, the standards and the defence sheet.
- `orchestrator.ts` (1 068 lines before, 819 after) keeps the `Orchestrator` class; its option and
  result types are in `orchestrator/types.ts` and the rerun heuristic in
  `orchestrator/rerun.ts`, re-exported, so no import path changes.
- This CHANGELOG keeps one entry per user-visible change; the detail is in the
  git history.
- `pdfkit` 0.19.1 → 0.20.2 and `@types/pdfkit` 0.17.6 → 0.17.7; the mock PDFs
  are byte for byte the same. `@types/bun` stays at 1.3.14, the Bun version
  CI runs.
- A synthesis section cites a source by the marker `[n]`, the n-th entry of
  its `sources_cited`; a marker pointing at no listed source is refused.
  `executive-pre-read` 1.1.0 asks for that marker, synthesis prompt 2.2.0.
- The live-proof protocol has a dated "Amendments" section (question 10 added
  to step 1); its test accepts the original commands plus declared
  amendments only.
- A benchmark run's `metadata.json` names the sections over their length cap
  (`synthesis.sections_over_length_ids`).
- Each completed live run is kept in `live/<id>/run-<start time>/`, never over
  an earlier one; a failed run leaves no partial directory.
- The risk stage's `max_tokens` rises from 16 000 to 32 000 (timeout 15
  minutes).
- `docs/SLO.md` publishes each target's status only from live measurements;
  the cost target is p95 ≤ $10.00 per briefing.
- The judge is Claude Opus 5 (`claude-opus-5`), sent as one Message Batch; a
  paid scoring run needs `--max-cost-usd`, and its worst case is reserved
  before the batch is submitted.
- The live-proof protocol judges each briefing once; the judge's scores are
  checked against the human only.
- The cost estimate reads prompt sizes at the 2.73 characters per token
  count_tokens measured, not the mock's 4; the cap's floor drops from 3 to
  2.5 characters per token.
- The budget cap is a limit: each request reserves its worst case before it
  is sent, and a request that reports no usage stays charged at it
  (`unreported_usd`).
- When the cost cap is reached during the synthesis rerun, the pre-rerun
  brief is returned (`rerun_skipped`).
- An answer stopped at `max_tokens` is refused with `TruncatedOutputError`
  (new public export, a subclass of `InvalidAgentOutputError`), not retried.
- `--max-cost-usd` and `--cap-usd` take plain decimal digits only.
- Live tests run only with `PRAXIS_LIVE_TESTS=1`; a key in `.env` no longer
  makes `bun test` call the paid API.
- `bun run bench:mock` is reproducible; `duration_ms` is omitted from mock
  metadata.
- `benchmarks/score-all.ts` refuses mock briefings; `score:mock` is removed.
- Anthropic API version `2026-10-21`: no `temperature` is sent; the default
  model is `claude-sonnet-5-5`.
- System text goes in the `system` field and each stage's `@model` is sent;
  prompts are 2.0.0.
- A `pause_turn` continuation resends the paused assistant content unchanged.
- The JSON answer is read past prose, fences and citation splits; Praxis
  stamps `accessed_at` itself.
- The orchestrator's four staged entry points share one implementation, and
  the seven agents share one prompt runtime.
- Each stage is retried once on a timeout, rate limit, 5xx or malformed JSON,
  so a failing stage can cost two calls; `stageAttempts: 1` turns it off.
- A checkpoint is validated on load by its stage's parser; a resume under
  another provider, sourcing mode, prompts or format is refused.
- `callModel` prefers `completeWithTools`, so a custom provider implementing
  both receives tool-less calls there.
- Synthesis sections are written concurrently.
- Earlier stages' output enters prompts inside `<untrusted_data>` blocks with
  an untrusted-content rule; an answer repeating the system text is rejected.
- The API key is held in a private field and CLI stderr is redacted.

### Security

- A cited source URL must be an absolute `http(s)` URL; synthesis prose may
  hold no image, link or URL other than an upstream source's; the Markdown
  renderer writes model text inert (OWASP LLM05).

### Deprecated

- `NotImplementedError`: nothing throws it. It remains exported for 1.x
  compatibility.

### Removed

- Unused internal exports and three dead helpers found by knip.

## [1.3.0] — 2026-08-20

**Framing clarity — structural prompt overhaul.** Opening sections led with
context or meta-commentary rather than with the decision the reader is asked
to make; three layers of the pipeline now push for a decision-first opening.

### Added

- Optional `tone_hook` on `FormatSection`, which Synthesis treats as the
  section's absolute first priority. The opening section of each format
  carries one: _"Open with the decision. Not the context. Not the framing.
  THE DECISION. Reader must know within 15 words whether to keep reading or
  delegate."_
- A FRAMING RULES block in every section's `tone_directives` across the four
  shipped formats.
- A FRAMING CLARITY CHECK block in `prompts/synthesis.prompt`, applied before
  and after writing a section.

### Changed

- The validator accepts `tone_hook` as an optional non-empty string and
  rejects an empty one; formats without it load unchanged.
- `prompts/synthesis.prompt` gains the `section_tone_hook` parameter.
- The four opening-section mock fixtures lead with the decision, and the mock
  briefings are regenerated with `bun run bench:mock`.

## [1.2.1] — 2026-08-20

**Scoring of the mock briefings (withdrawn, see below), and the first live
attempt.** No code changes (src/, prompts/, formats/ untouched).

The first `bun run bench:live` attempt aborted every briefing before any
artefact was written:

- 3 / 5 briefings — `SourcingValidationError: strict policy, 7-8 of 8 items
  lack a source`: the model returned findings with `SOURCE_MISSING` markers
  rather than extracting URLs from `web_search` results.
- 1 / 5 — research agent raw output began with prose ("I …") before the
  JSON, tripping `JSON.parse`.
- 1 / 5 — `AnthropicTimeoutError` at the 60 000 ms default: the research
  agent's tool-use loop (web search) exceeded the per-request timeout.

### Added

- `benchmarks/RESULTS.md` carries an `## AI-Assisted Qualitative Scoring
  (2026-08-20)` section scoring the eleven mock briefings with Claude
  Sonnet 4.5.

> **Withdrawn (2026-11-02).** These scores graded mock briefings whose text is
> hand-written fixture output, so they measure the fixtures, not a model. See
> Unreleased › Corrected and `benchmarks/RESULTS.md`.

## [1.2.0] — 2026-08-19

**Fourth shipped format: `family-office-memo`**, a discreet, three-page memo
for a family principal or a family council.

### Added

- `formats/family-office-memo.yaml`: six sections, 1200-word target, a
  roles-not-names vocabulary enforced by `forbidden_terms` on `"the family"`.
- It sets `strict_editorial: true` with every axis on `"reject"`, unlike the
  three other formats.
- Sourcing profile: sources up to 5 years old (warning after 3 years),
  reputation-only tiers with `min_tier: 2`.
- 11th benchmark (`11-family-office-co-investment`) with its mock fixtures.
- `--format auto` routes `family council`, `family principal`,
  `successor generation`, `patrimonial` and `family office` to it.
- `docs/formats/family-office-memo.md`.

### Changed

- `README.md` lists four shipped formats.
- A format declares its editorial block explicitly; `strict_editorial` may be
  `false` (warn-only) or `true` (reject and regenerate).

## [1.1.1] — 2026-08-19

### Fixed

- `benchmarks/run-all.ts` writes `brief.md`, `brief.pdf`, `brief.docx` and
  `metadata.json` for every benchmark, whatever the format's
  `output_targets[]`. 6/10 mock output directories were incomplete, so the
  scoring framework reported only 7/10 mocks as scorable; it now reports
  10/10. The user-facing CLI and the `render()` dispatcher are unchanged.

### Added

- `tests/benchmarks/coverage.test.ts`: every mock benchmark directory carries
  all four files, non-empty.

### Changed

- `benchmarks/outputs/mock/*/` regenerated with `bun run bench:mock`.

## [1.1.0] — 2026-08-19

### Changed

- `@promptlang/yaml-parser` is an npm dependency (`^1.0.0`) instead of a
  `file:../promptlang/packages/yaml-parser` link. The `promptlang` core is
  still read from the sibling `~/dev/promptlang/` checkout.
- No functional change: same public API, and the parser keeps its
  `parseYaml`, `YamlParseError` and `YamlValue` exports.

## [1.0.0] — 2026-08-18

**SemVer stability release.** Every public export from `src/index.ts` is
bound by SemVer: removing or renaming an export, or changing an error class's
inheritance chain, requires a major version bump. Contract text:
`docs/SEMVER-CONTRACT.md`.

- No new functional code, no new tests, no new dependencies; the only `src/`
  change is the `PRAXIS_VERSION` constant.
- v1.x makes additive changes only to the public API; breaking changes
  require v2.0.
- `@promptlang/yaml-parser` is still a `file:../promptlang/…` link.

---

## [0.10.0] — 2026-08-18

**AI-assisted qualitative scoring — framework release.** No empirical
results in this release, no new npm dependency, no breaking API change.

### Added

- `benchmarks/score-all.ts`: scores each briefing under
  `benchmarks/outputs/{mock,live}/*` on `claude-sonnet-4-5` and rewrites the
  scoring block of `benchmarks/RESULTS.md`.
- `benchmarks/scoring-prompt.txt`: 7 criteria on a 1–5 scale with
  anti-complaisance framing ("A score of 3/5 is NORMAL. Do NOT inflate.").
- Cache under `benchmarks/.scoring-cache/` (24h TTL, `--refresh <slug>`);
  flags `--mock-only`, `--live-only`, `--dry-run`.
- Scripts `score`, `score:mock`, `score:live`, `score:dry`; docs
  `docs/benchmarking-methodology.md` and a cookbook recipe.
- Scoring covers 7 of the 10 mock briefings: the `position-paper-corporate`
  briefings emit no `brief.md`.

---

## [0.9.0] — 2026-08-18

**Release-readiness release: CLI polish, `--format auto`, ten calibrated
benchmarks, refreshed documentation.** No new agent, no new npm dependency,
no breaking API change.

### Added

- Global `--verbose` / `--quiet` flags, accepted anywhere on the command line.
- `--format auto`: a deterministic keyword router to one of the three formats;
  an ambiguous or empty match is an error naming the candidates.
- Structured errors with a suggestion for `FormatNotFoundError`,
  `AnthropicAuthenticationError` and `UnsupportedRenderTargetError`.
- Benchmarks: `benchmarks/questions.yaml` (10 questions),
  `benchmarks/run-all.ts`, `CHECKLIST.md`, `RESULTS.md`, and the mock
  briefings under `benchmarks/outputs/mock/`; scripts `bench`, `bench:mock`,
  `bench:live`.
- Docs: `docs/getting-started.md`, `docs/cookbook.md`,
  `docs/troubleshooting.md`, and a refreshed `README.md`.

### Changed

- Every user-facing CLI error goes through `errorWithContext` or the plain
  `✗` prefix.

---

## [0.8.0] — 2026-08-18

**Consolidation release: editorial re-run loop (hard-cap 1),
`strict_editorial` retry mode, Praxis-as-library API surface.** No new agent,
no new npm dependency.

### Added

- `Orchestrator.briefWithCritiqueAndRerun()`: when the critique sets
  `revised_recommendation_needed` and gives a steelmanned alternative,
  Synthesis reruns exactly once, never recursively. CLI
  `brief --full --with-rerun`.
- `computeReSynthesisDeviations()`: a section deviates on a word-count delta of
  more than 20% OR a normalised Levenshtein distance > 0.30.
- Optional `sourcing_rules.editorial` block: under `strict_editorial`, a
  section failing a `"reject"` rule is regenerated up to
  `max_regeneration_attempts` (in `[1, 3]`, default 2), then
  `EditorialFailureError`.
- `src/index.ts` is the stable library API; every public error inherits from
  `PraxisError`. Docs: `docs/api.md`, `docs/embedding-praxis.md`,
  `docs/editorial-loop.md`.

### Changed

- `SynthesizedSection` gains the required fields `editorial_attempts` and
  `final_attempt_number`; code that builds it as a literal adds
  `editorial_attempts: []` and `final_attempt_number: 1`.
- `prompts/synthesis.prompt` gains the `revision_block` and `retry_block`
  parameters, empty on the initial pass.

---

## [0.7.0] — 2026-08-18

**Adversarial Critique agent + PDF/DOCX/MD renderers + first external npm
dependency.**

### Added

- Adversarial Critique agent (`prompts/adversarial.prompt`):
  `MIN_CRITIQUES = 3`, `MAX_CRITIQUES = 15`, `MIN_STEELMAN_WORDS = 20`; every
  target must resolve to an artefact of the brief.
- `revised_recommendation_needed` is derived by the parser (`critical ≥ 1` OR
  `material ≥ 3`), not asked of the model.
- `Orchestrator.briefWithCritique()`; `brief()` is unchanged.
- Renderers: enhanced Markdown (TOC, de-duplicated sources, critique,
  appendices), DOCX written from scratch with `node:zlib`, and PDF through
  pdfkit with three themes; one entry point `render(brief, target, format,
  options)`.
- CLI `brief` flags `--critique`, `--render <target>`, `--theme <name>`,
  `--include-toc`, `--include-appendices`.

### Changed

- `package.json` gains `pdfkit` (^0.19.1), the sole external runtime
  dependency: a from-scratch PDF writer would triple the renderer LOC and
  require font-embedding (AFM parsing, Type 1 programs, encoding tables).

[0.7.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.7.0

## [0.6.0] — 2026-08-18

**Options Generation agent + Synthesis agent + `brief()` implemented.**
The first complete, sourced, format-conformant briefing.

### Added

- Options Generation agent (`prompts/options.prompt`): `MIN_OPTIONS = 2`,
  `MAX_OPTIONS = 4`, exactly one `recommended` option; stakeholder and risk
  references must exist upstream; vague tradeoff labels (`pros`, `cons`, …)
  are rejected.
- Synthesis agent (`prompts/synthesis.prompt`): one LLM call per format
  section, word count checked against `max_length` with 10% tolerance; a
  cited URL absent from every upstream artefact raises `SynthesisError`.
- `Orchestrator.brief()` runs the six-agent pipeline and returns a
  `BriefResult`.
- CLI `brief --full` prints the Markdown briefing; `--output <path>`,
  `--full --json`, `--with-sourcing-report`.

### Changed

- `brief()` no longer throws `NotImplementedError`; the class stays exported.
- `executive-pre-read` lists `options` in its `recommendation` section's
  `required_agents`.
- `--output` writes to any path the process can write to; it does not
  sandbox.

[0.6.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.6.0

## [0.5.0] — 2026-08-18

**Risk Analysis agent + hardened Sourcing & Verification Layer.**

### Added

- Risk Analysis agent (`prompts/risk.prompt`): `MAX_RISKS = 25`, sourced
  likelihood and impact evidence, `affected_stakeholders` matched verbatim
  against the stakeholder map, vague mitigations rejected.
- Sourcing rules: freshness (`fresh | warn | stale`), domain trust with
  wildcards, cross-agent dedupe (warning only), per-category report counts.
- Typed errors `StaleSourceError`, `UntrustedDomainError`,
  `DuplicateSourceError`, all subclasses of `SourcingValidationError`.
- Optional `Format.sourcing_rules`; a format without it behaves as in 0.4.
  The three shipped formats declare one.
- `Orchestrator.assessRisksAfterStakeholders`; CLI `brief --with-risks` and
  `--sourcing-report`.

### Changed

- `SourcingReport` gains `counts`; `missing_sources_count` is kept.
- `SourcingWarning` gains `missing_risk_evidence`, `stale_source`,
  `untrusted_domain`, `duplicate_source`; exhaustive switches on `kind` must
  handle them.

[0.5.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.5.0

## [0.4.0] — 2026-08-17

**Stakeholder Mapping agent.** Third Praxis agent, the first to read both
the Scoping and Research outputs.

### Added

- Stakeholder Mapping agent (`prompts/stakeholder.prompt`): minimum 3,
  maximum 20 stakeholders; every `position_evidence` is a real
  `SourceReference` or an explicit `SOURCE_MISSING`.
- `validateStakeholderSourcing(map, policy)`, with the same policy semantics
  as `validateSourcing`.
- `Orchestrator.mapStakeholdersAfterResearch` and CLI
  `brief --with-stakeholders` (implies `--with-research`).
- `renderStakeholders(result)` table in the CLI output.

### Changed

- **Breaking:** `SourcingReport.total_findings` is renamed `total_items`.
- `SourcingWarning` is a discriminated union (`missing_source`,
  `missing_stakeholder_evidence`); consumers narrow on `kind`.

[0.4.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.4.0

## [0.3.0] — 2026-08-17

**Research agent + real Anthropic provider.** No npm dependency added;
`MockLLMProvider` stays the default.

### Added

- `AnthropicLLMProvider`: reads `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`
  (default `claude-sonnet-4-5`); retries `429` / `5xx` up to 3 attempts,
  never `4xx`; `60s` request timeout; server-side tool-use loop.
- `LLMProvider.completeWithTools` and the tool-use types and errors.
- Research agent (`prompts/research.prompt`) with the `web_search` tool and
  the rule "real source or SOURCE_MISSING — never invent".
- Sourcing layer: `validateSourcing(result, policy)`; `strict` throws on any
  `SOURCE_MISSING`, `permissive` returns warnings.
- `Orchestrator.researchAfterScoping`; CLI `brief --with-research` and
  `--provider anthropic`.
- Live tests under `tests/live/`, skipped without `ANTHROPIC_API_KEY`;
  `.env.example`; `docs/providers.md`, `docs/sourcing.md`.

### Changed

- `ProviderNotSupportedError` lists both providers (`mock`, `anthropic`).
- The API key is never logged or written to disk; response bodies in error
  messages are truncated to 400 chars.

[0.3.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.3.0

## [0.2.0] — 2026-08-14

**Agent Scoping.** First Praxis agent, run end to end through the
Orchestrator on a deterministic `MockLLMProvider`; no real LLM calls.

### Added

- `LLMProvider` interface and `MockLLMProvider`, which reads JSON fixtures
  under `tests/fixtures/mock-llm/`.
- Scoping agent (`prompts/scoping.prompt`, authored in PromptLang), with its
  output validated against `ScopingResult`.
- `Orchestrator.scope(question, formatId)`; `Orchestrator.brief(...)` throws
  `NotImplementedError`.
- CLI `praxis brief "<question>" --format <id> [--provider mock] [--json]`
  (scoping only).
- Documentation: `docs/architecture.md`, `docs/writing-a-prompt.md`,
  `CONTRIBUTING.md`.

### Changed

- YAML parsing imports `@promptlang/yaml-parser`, linked to a sibling
  `~/dev/promptlang` checkout.

### Removed

- The vendored YAML parser (`src/vendor/yaml-parser/`).

[0.2.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.2.0

---

## [0.1.0] — 2026-08-14

Initial release: the **Format Registry**.

### Added

- Format schema and strict validator: accumulates every structural issue
  before throwing and rejects unknown top-level keys.
- YAML loader with typed `PraxisError` subclasses, and an in-memory
  `FormatRegistry`.
- CLI: `version`, `formats list [--org-style]`, `formats inspect <id>`,
  `formats validate <path>`; `NO_COLOR` support.
- Three formats: `executive-pre-read`, `position-paper-corporate`,
  `mckinsey-style-note`.
- Documentation: `README.md`, `ROADMAP.md`, `docs/format-schema.md`,
  `docs/creating-a-format.md`.

[0.1.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.1.0
