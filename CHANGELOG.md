# Changelog

All notable changes to Praxis are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and Praxis adheres to [Semantic Versioning](https://semver.org/).

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
