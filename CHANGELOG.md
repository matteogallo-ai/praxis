# Changelog

All notable changes to Praxis are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and Praxis adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Corrected

- Mock briefings printed figures attributed to real institutions, with
  invented URLs, and counted their fixture sources as `ok` (the quickstart
  said `ok=25`). Every mock output (CLI Markdown, enhanced Markdown, PDF,
  DOCX) now opens with "DONNÉES FICTIVES — mode mock", and every printed
  sourcing count shows `ok=0` and the fixture sources as `unverified`.
- The system card's "6 of 13 | 23%–71% (Wilson)" pooled four versions of
  the code and five attempts without a record. It now gives completions per
  commit, from the run records, the 1.2.1 attempts apart, and no interval.
- README said "nothing runs in parallel" while the synthesis sections run
  concurrently; it says the latter. "McKinsey-style" is gone from the
  tagline (the format id `mckinsey-style-note` is unchanged).
- CLAUDE.md forbids comments that say when ("v0.8 additions."); 193 did,
  118 of them under `src/`. They are rewritten to say what the code does,
  and `check:stale-narrative` now fails on a release number in a `.ts`
  comment under `src/`, `tests/`, `benchmarks/` or `scripts/`.
- The seven stages each repeated the same JSON-answer reader; it is one
  function, `parseAnswerObject()`. Scoping now refuses an empty answer as
  "empty response", like the other stages, instead of a JSON parse error.
- `bun run lint` (and the CI lint job) fails on any Biome warning. The 42
  warnings in production code are fixed; tests may use non-null assertions.
- A format's validation rule was checked with a regular expression whose
  time grew with the square of a run of spaces. The check is linear and
  refuses a rule whose value is only whitespace (CodeQL `js/polynomial-redos`).
- A stakeholder name with backticks across lines could become a link in the
  enhanced Markdown's stakeholder table: the cell joined its lines after
  escaping, which changed how its backticks paired. It joins them first.
- Tests wrote fixed or time-stamped names under the shared temp directory;
  they use a fresh 0700 directory per run (CodeQL
  `js/insecure-temporary-file`).
- SECURITY.md offered GitHub's private vulnerability reporting, which is
  disabled on the repository; e-mail is the one channel it names.
- `@promptlang/core` 3.0.0 (was 2.0.0). Praxis uses none of the APIs it
  breaks; the prompts parse to identical ASTs.

- The live-proof protocol and the live outputs' README no longer say question
  10's amendment was recorded before the run. q10 added by the operator's GO
  before step 1 started; the amendment was written down after step 1 had
  started (commit 0417613, 13:02:53Z), 78 s before q10 itself ran. The
  amendment row reads "added by the operator's GO before step 1 started" and
  its test parses that form.

- No model text in the Markdown outputs (the brief, `--render
  md-enhanced`, the CLI's Markdown sourcing report) becomes a link, an
  image or an autolink: `www.` addresses, URLs, e-mail addresses, links,
  images and reference definitions are escaped outside code spans, so
  nothing the model wrote is fetched or clickable when the briefing is
  opened. A citation marker shows as `[1]`, written `\[1\]`; a host heading
  of the Sources section is no longer an autolink. A backtick that may not
  pair as a viewer pairs it is text, so a span across lines or in a table
  row cannot hide a link. The model's own escapes (`\*`), task lists and
  footnotes now show as text. PDF and DOCX unchanged.
- Position paper 1.1.0: the rationale's strands end with the citation
  marker `[n]` of each source, with no site name, host or URL in the text.
  "Citations at the end of each strand" named no form and invited a host
  name, which the synthesis refuses.

- The human review of question 10's step 1 first-party sources is
  published in `benchmarks/outputs/live/README.md`: 8 reviewed, 6 accepted,
  2 refused (both a risk's likelihood). The rule now excludes a risk's
  evidence and, by the maintainer's decision, a critique's counter-evidence,
  which backs an argument (ADR 0003, amendments of 4 Nov 2026; see Added).
- The URLs, hosts and searched-for queries of the "Insufficiently
  sourced" section and of the CLI's Markdown sourcing report are code spans.
  A Markdown viewer turned them into links: in question 10's step 1
  briefing, the untrusted host `www.bracewell.com` showed as a link in the
  line that reports it as untrusted.

- PDF: a table row is as tall as its longest wrapped cell, and the header
  is repeated after a page break. Rows were 20 points high whatever their
  text, so long option titles and stakeholder names ran over the next row
  (question 10's step 1 briefing, pages 14, 16 and 24).

- PDF: the footer no longer opens pages of its own. It was drawn inside
  the bottom margin, so pdfkit opened a new page for each footer line:
  question 10's step 1 briefing has 96 pages, 32 of them with content.

- A refused `www.` address in a synthesis section is quoted whole in the
  error, cut at 200 characters (it was quoted as `'www.'`, which left
  question 02's step 1 failure undiagnosable). Every refused text the prose
  check quotes is cut at 200 characters.

- Question 05 is no longer held-out. It is in the test split, but the
  sourcing fixes (#31 to #39) were designed from its step 0 failures; the
  benchmark README, the system card and the live comparison table say so,
  and `tests/benchmarks/held-out.test.ts` requires it.

- The judge prompt embedded the briefing bare, and expanded `$&`-style
  patterns in it; the briefing is now delimited as untrusted content.
- The project was described as feature-complete and as running live against
  Anthropic. Until 4 Nov 2026 it had never completed a live briefing (5 of
  5 aborted, see 1.2.1). README, ROADMAP and `docs/architecture.md` now say so.
- The "AI-assisted qualitative scoring" of mock briefings is withdrawn: mock text
  is fixture output chosen by format, so the scores graded the fixtures. The
  v1.3.1 re-scoring plan is abandoned (`docs/benchmarking-methodology.md`).
- README and the system card said every live run failed "5 of 5". There
  have been 7 live attempts: 6 failed (5 in 1.2.1 without committed
  records, 1 on 3 Nov 2026), 1 completed (4 Nov 2026). The count is
  computed from the run records (`tests/docs/live-records.ts`) and checked
  in `tests/docs/live-attempts.test.ts`. Live runs start from their own
  worktree (`docs/live-proof-protocol.md`).
- Source freshness was measured on `accessed_at`, the retrieval time, so a
  live source was always fresh, and question 05's run of 4 Nov 2026
  reported `stale: 0` without knowing any publication date (erratum in
  `benchmarks/outputs/live/README.md`; the record is unchanged). Freshness
  is now judged on an optional `published_at`; a source without a readable
  one is counted in the report's `freshness_unknown`, never as fresh.
  Briefings list each source's publication date or "publication date
  unknown".
- The citations of the options and adversarial stages escaped the format's
  domain-trust rule. Options' citations now follow it like stages 2–4
  (strict fails or degrades, permissive reports); critiques' are reported
  without blocking. Both are listed in `SourcingReport.untrusted_citations`.

### Added

- A single-call baseline for question 12, pre-registered
  (`docs/preregistration/single-call-baseline.md`), run once at $0.48, and
  a blind A/B review pack with its grid (`benchmarks/review/`). The review
  itself is the maintainer's.
- `bun run hard-case:sources`: for question 12, the hard case, each
  sodium-ion sentence of the latest live brief (in the model's sections,
  cited or not, or a research finding) with each source it cites and that
  source's chemistry, read from its title and URL: on sodium-ion, another
  chemistry, unclear or no source. Sodium-sulfur and sodium-nickel chloride
  count as another chemistry. It reads files only and fails nothing; a
  human opens the unclear rows and tells an uncited claim from a
  recommendation. On the 4 Nov 2026 record: 22 pairs, 9 on sodium-ion, 0 on
  another chemistry, 1 unclear, 12 without a source.

- `bun run results` writes `benchmarks/RESULTS.md` from the committed
  artefacts: every completed live run and every recorded failure, with
  cost, stages' time and sourcing counts, and the committed judgments with
  the judge–human agreement that labels them indicative or unvalidated. CI
  runs `bun run results -- --check`. The page it replaces still counted two
  live briefings; the records hold six and two failures. `score:live`
  writes each judgment to `benchmarks/judgments/` to be committed, instead
  of editing `RESULTS.md`.

- `bun run agreement`: the maintainer's blind scores, read back from the
  annotation file, against the judge's cached scores for the same
  briefings: exact and within-one agreement and quadratic-weighted kappa,
  with the protocol's 0.6 threshold deciding whether the judge's scores are
  called indicative or unvalidated. Each review is paired only with the
  judgment of the run it reviewed: `export:annotation` records that run. It
  reads files only.

- The hostile-output tests render the Markdown with marked (GFM), a pinned
  devDependency, and check that no `href` or `src` points at the hostile
  host, in addition to the pattern check; the check reads any quoting
  and case and decodes entities.

- Every listing of a first-party source (Markdown, PDF, DOCX, CLI report)
  shows the claim it was accepted for, cut at 160 characters on a word
  boundary: a finding's claim, or a stakeholder's position and interest
  (only those two stages can cite first-party sources). Without it the
  human review of question 10's step 1 briefing could not check whether
  each sentence states the organisation's own fact. `FirstPartySource.claim` is a new optional field; a report
  stored without it reads "claim not recorded". In the CLI's Markdown
  sourcing report the claim and label are made inert, as in the brief.

- Step 1 live records (4 Nov 2026, `8df678f`): questions 08, 10, 11 and 12
  completed, all flagged insufficiently sourced; question 02 failed in
  synthesis. $17.96 spent against a $30.23 central estimate. Compared in
  `benchmarks/outputs/live/README.md`, with the estimate frozen in
  `benchmarks/estimates/step-1.json`; `SHA256SUMS` lists every record.

- First-party sources (ADR 0003, now implemented for its first decision).
  A research or stakeholder source on an untrusted host (never a risk's or
  a critique's: they back a judgement) counts as the organisation's own
  source when the
  stage marks it `first_party_for` an organisation of the reviewed list
  `src/sourcing/first-party-organisations.ts`, the host is one of its
  domains and the item names it. Such sources do not block under `strict`
  and are listed apart (`SourcingReport.first_party_sources`, a
  "First-party sources" section, every sourcing report). Prompts:
  research and stakeholder 3.1.0, risk 3.1.1, adversarial 4.0.0; token
  counts re-measured with count_tokens (question 05: $1.40 / $5.96 / $12.92).

- The research, stakeholder, risk and options prompts (3.0.0: a new
  required `source_guidance` parameter) name the format's trusted hosts by
  tier and ask for each source's `published_at` as the page states it,
  never a guess. The options' citations are judged by the same domain
  check, so their stage gets the same guide. The list guides the search;
  web search gets no `allowed_domains`. Prompt token counts re-measured
  with count_tokens; the protocol's and the SLO page's estimates follow
  (question 05: $1.40 / $5.97 / $12.95).

- The scoping stage names the facts only the requester can supply
  (`requester_provided`, scoping prompt 2.1.0). The briefing lists them under
  "Requester-provided, not sourceable", written by code; the sourcing report
  counts them apart (`requester_provided`), never as sourced (C24). Prompt
  token counts re-measured with count_tokens.

- The first completed live briefing: question 05, 4 Nov 2026, $3.51 and
  7.8 minutes of stages, committed under
  `benchmarks/outputs/live/05-supply-chain-acquisition/run-2026-11-04T08-33-09-131Z/`.
  It is flagged insufficiently sourced: 11 of 44 items without a source, 24 from untrusted domains.
  `docs/SLO.md` reports cost, latency and the error rate (1/2 since the
  records began) on n = 1, with no status. Its quality is not yet reviewed.
- Part C preparation: `docs/live-proof-protocol.md` (five test-split
  briefings, deterministic checks, a judge on a Claude model no stage uses
  with its same-family limitation, the maintainer's blind review of two
  briefings (`bun run export:annotation`), cost; one briefing first, capped
  at $8, under its own GO) and `bun run estimate:cost`. `bench:live` needs
  `--max-cost-usd` (per briefing), a key alone never makes `bun run bench` go
  live, `--ids` selects questions; live artefacts record the commit and each
  prompt's version, model and hash, are never overwritten, and a failure
  leaves a redacted `error-<time>.json`.
- A hard case in the evaluation set (question 12, manifest version 2) and a
  frozen dev/test split of it (`benchmarks/split.yaml`, 4 / 8, stratified by
  format, fixed seed), checked by the test suite against the manifest's
  SHA-256; `run-all.ts --split dev|test`. The rule that capped the set at ten
  questions is retired.
- Property-based tests (fast-check) of the tolerant JSON extraction, the
  source validators and `parseCitedSource`; mutation testing (Stryker,
  `bun run mutation`) of the orchestrator and the validators, scored and
  each surviving mutant explained in `docs/mutation-testing.md`.
- CI: typecheck, tests, Biome, knip, `check:claims`, `check:stale-narrative`,
  `bench:mock` drift check, Conventional Commits.
- `docs/CLAIMS.md` and `scripts/check-claims.ts`; `CLAUDE.md`; `SECURITY.md`;
  pull request and issue templates; `docs/ENGINEERING_STANDARDS.md`.
- `docs/THREAT_MODEL.md` (OWASP LLM Top 10 2025, each mitigation with its
  test, checked by `tests/docs/threat-model.test.ts`), `docs/SYSTEM_CARD.md`,
  `docs/SLO.md`, `docs/RUNBOOK.md` (replaces the abandoned v1.3.1 runbook),
  and the ADR index with what the author would do differently.
- Supply chain (`docs/supply-chain.md`): actions pinned to commit SHAs,
  Dependabot (bun, GitHub Actions), CodeQL and OSV-Scanner on every pull
  request and weekly, OpenSSF Scorecard with its badge, and a release
  workflow that publishes a tag's attested source archive with its Sigstore
  bundle once the `release` environment's reviewer approves.
- `PRAXIS_NOW` (a UTC date and time) freezes the CLI clock: freshness
  verdicts and run ids no longer depend on the day a briefing runs. The test
  suite sets it, and CI runs the suite with the in-process wall clock in 2029
  and 2040.
- Per-stage checkpoints and `praxis brief --resume <run-id>`; `--runs-dir`
  (default `$PRAXIS_RUNS_DIR`, else `.praxis/runs`) (C16).
- `UsageLedger`: tokens, web searches and cost per stage and per briefing,
  written to `metadata.json`; `DEFAULT_PRICE_TABLE`, `loadPriceTable`,
  `--price-table`; budget cap `maxCostUsd` / `--max-cost-usd`, raising
  `BudgetExceededError` (C16).
- `onSourcingFailure: "degrade"` and `--on-sourcing-failure`: a strict
  sourcing failure adds an "Insufficiently sourced" section instead of
  aborting (ADR 0002, C15).
- Per-stage `max_tokens`, request timeout and web-search cap
  (`src/agents/stage-limits.ts`); `timeout_ms` on provider calls (C15).
- CI job `prompt-semver` running `promptlang semver-check`.

### Changed

- `pdfkit` 0.19.1 → 0.20.2 and `@types/pdfkit` 0.17.6 → 0.17.7. pdfkit
  0.20 breaks its virtual file system, AcroForm and annotation options,
  named exports and standard-font loading in browser builds; Praxis uses
  the first three nowhere, and its four standard fonts still load lazily
  under Bun, which resolves the Node build. The mock PDFs are byte for
  byte the same (`bun run bench:mock` leaves the tree clean). `@types/bun`
  stays at 1.3.14, the Bun version CI runs: types of a newer Bun would
  let code typecheck against APIs the runtime lacks.

- A synthesis section cites a source in its text by the marker `[n]`, the
  n-th entry of its `sources_cited`; each section's source list is numbered
  `[n]` in Markdown, PDF and DOCX. `executive-pre-read` 1.1.0 asks its
  supporting-evidence paragraphs to end with that marker, with no site name,
  host or URL, where it asked for the "source in parentheses" (the likely
  cause of question 02's step 1 failure). A marker pointing at no listed
  source is refused; `every_paragraph_ends_with_citation` is checked by
  code. Synthesis prompt 2.2.0; token counts re-measured (question 05:
  $1.40 / $5.97 / $12.96).

- The live-proof protocol has a dated "Amendments" section: question 10
  was added to step 1 by the operator's GO before step 1 started
  (2026-11-04), as the only test
  question the first-party list covers. The original plan is unchanged;
  its test accepts the original commands plus declared amendments only.
  Held-out test questions left: 03 and 07.

- A benchmark run's `metadata.json` names the sections over their length
  cap (`synthesis.sections_over_length_ids`) beside their count; the count
  alone did not say which section to check.
- A question run live again is no longer refused once it has a completed
  run: each completed run is kept in `live/<id>/run-<start time>/`, never
  over an earlier one, and a failed run leaves no partial directory.
  Scoring and `export:annotation` read a question's latest completed run;
  a cached score is keyed by the run it scored.
- The risk stage's `max_tokens` rises from 16 000 to 32 000 (timeout
  15 minutes). The first live run cut its answer at 16 000; a cut answer
  gives only a lower bound, so the ceiling is twice it. Question 05's
  estimate moves to $1.37 / $5.87 / $12.78. The run record is committed
  under `benchmarks/outputs/live/05-supply-chain-acquisition/`.
- `docs/SLO.md` publishes each target's status, met or not met only from
  live measurements; no target has a status yet. The cost target is p95 ≤
  $10.00 per briefing: less than 10 minutes of an analyst at $60 an hour
  (the earlier $2.50 assumed $15 an hour). Question 05's estimate ($5.87
  central, $12.78 high) is shown beside it, not as a status, pinned by
  `tests/docs/slo.test.ts`.
  The advice to run with `--max-cost-usd 5`, below that estimate, is gone.
- The judge is Claude Opus 5 (`claude-opus-5`), sent as one Message Batch
  at half price (`benchmarks/judge-batch.ts`). A paid scoring run needs
  `--max-cost-usd`. The batch's worst case is reserved before it is
  submitted: each prompt at 2.5 characters per token (an allowance, as for
  the pipeline) plus 8 000 `max_tokens`, effort `medium`. A batch whose
  worst case does not fit is not sent; a spend past the cap fails the run. `refusal` and `max_tokens` answers fail their briefing. A
  submitted batch is resumed, never sent twice. `--dry-run` prints the
  worst case.
- The live-proof protocol judges each briefing once. The judge's noise
  band and planted-error detection are roadmap (CLAIMS C23), and the
  judge's scores are checked against the human only.
- The cost estimate reads prompt sizes at the 2.73 characters per token
  Anthropic's count_tokens endpoint measured on the prompts of questions
  02, 05, 08 and 11, one per format (`benchmarks/token-counts/`,
  `benchmarks/count-tokens.ts`), not the mock's 4; 05's estimate rises to
  $1.33 / $5.75 / $12.54. The cap's floor drops
  from 3 to 2.5 characters per token, below every measured request.
- The budget cap is a limit. Under `--max-cost-usd` (or `maxCostUsd`),
  each request reserves its worst case before it is sent: its whole
  `max_tokens`, every search its `max_uses` allows with 15 000 tokens of
  context each, its prompt at 2.5 characters per token. It is sent only if
  the spend, the reservations of requests in flight and its worst case fit
  in the cap. A request that fails or reports no usage, a timeout included,
  stays charged at its worst case (`unreported_usd`); an HTTP error answer
  is not charged. When a synthesis section fails, the sections in flight
  are awaited, so `metadata.json` records them. `estimate:cost
  --cap-usd` walks each question through the reservations instead of
  printing an overshoot ceiling. Opus 5 is in the price table.
- When the cost cap is reached during the synthesis rerun, the complete
  pre-rerun brief is returned instead of being discarded with the run;
  `rerun_skipped` (a new optional field of the result, and `rerun.skipped`
  in benchmark metadata) says why.
- An answer the model stopped at `max_tokens` is refused with
  `TruncatedOutputError` (new public export, a subclass of
  `InvalidAgentOutputError`) before JSON extraction, which could return a
  complete first object of a cut answer. It is not retried: a second sample
  bills the whole ceiling again. Providers that implement only `complete()`
  report no stop reason and are not covered.
- `--max-cost-usd` (`praxis brief`, `run-all.ts`) and `--cap-usd`
  (`estimate:cost`) take plain decimal digits only; `0x10`, `1e3`, `+8`,
  `.5` and padded values are refused instead of read by `Number()`.
- Live tests run only with `PRAXIS_LIVE_TESTS=1`; a key in `.env` no longer
  makes `bun test` call the paid API.
- `bun run bench:mock` is reproducible (fixed clock in mock runs, PDF creation
  date taken from the brief); `duration_ms` is omitted from mock metadata.
- `benchmarks/score-all.ts` refuses mock briefings; `score:mock` is removed.
- Anthropic API version `2026-10-21`: no `temperature` is sent (a 400 on that
  version); the default model is `claude-sonnet-5-5` (`claude-sonnet-4-5` is
  deprecated). `temperature` in the call options is ignored.
- System text goes in the `system` field and each stage's `@model` is sent;
  stage models are chosen per stage (`prompts/README.md`). Prompts are 2.0.0.
- A `pause_turn` continuation resends the paused assistant content unchanged
  (it dropped `tool_use_id`, the search results and the citations).
- The JSON answer is read past prose, fences and citation splits; Praxis
  stamps `accessed_at` instead of asking the model for it.
- The orchestrator's four staged entry points share one implementation, and
  the seven agents share one prompt runtime.
- Each stage is retried once on a timeout, rate limit, 5xx or malformed JSON
  (synthesis per section), so a failing stage can cost two calls; minor
  behaviour change under `docs/SEMVER-CONTRACT.md`, turned off with
  `stageAttempts: 1`.
- A checkpoint is validated on load by its stage's own output parser; a
  corrupt one (or a corrupt `metadata.json` on resume) raises
  `OrchestrationError` naming the file. `CheckpointStore.load(stage,
  validate)` takes the validator. A resume under another provider, sourcing
  mode, prompts or format is refused.
- `callModel` prefers `completeWithTools` (with no tools for scoping and
  synthesis) because only it returns usage; a custom provider implementing
  both now receives tool-less calls there.
- Synthesis sections are written concurrently.
- Earlier stages' output enters prompts inside `<untrusted_data>` blocks, every
  system text carries an untrusted-content rule, and an answer repeating the
  system text is rejected (C17).
- The API key is held in a private field and CLI stderr is redacted (C20).

### Security

- A cited source URL must be an absolute `http(s)` URL; a synthesis
  section's prose may hold no image and no link or URL other than an
  upstream source's; the Markdown renderer writes model text inert (raw HTML,
  `-->` in a validation issue, link targets). OWASP LLM05, in
  `docs/THREAT_MODEL.md`.

### Deprecated

- `NotImplementedError`: nothing throws it. It remains exported for 1.x
  compatibility; removal is scheduled for the next major release.

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

**First empirical scoring of the mock briefings, and the first live
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
