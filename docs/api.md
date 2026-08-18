# Praxis API reference (v0.8 → v1.0)

This document is the narrated tour of the public API surface. For
a quick-start, see `docs/embedding-praxis.md`. For the editorial
re-run loop mechanics, see `docs/editorial-loop.md`. This document
enumerates every export and shows what it's for.

Every export named in `src/index.ts` is covered by the v1.0 SemVer
contract. Removing an export or changing its shape is a
major-version bump.

## Registry (v0.1)

- **`FormatRegistry`** — in-memory registry of `Format` values
  loaded from YAML.
- **`loadRegistry(path)`** — convenience: load a directory of
  format YAMLs into a fresh `FormatRegistry`.
- **`loadFormatFile(path)` / `loadFormatFromSource(yaml)`** — the
  loader primitives.
- **`validateFormat(value)`** — the schema validator. Throws
  `ValidationError` (with `issues: ValidationIssue[]`) on any
  structural failure.
- Schema types: `Format`, `FormatMetadata`, `FormatSection`,
  `StyleGuide`, `TargetLength`, `SourcingPolicy`,
  `OrganizationStyle`, `Language`, `OutputTarget`, `AgentId`.
- v0.5 sourcing-rules schema: `SourcingRules`, `FreshnessRule`,
  `DomainTrustRule`, `DedupeRule`, `ReputationTiers`,
  `DomainTrustMode`.
- **v0.8 additions**: `EditorialRules`, `EditorialAction`,
  `EDITORIAL_ACTIONS`, `DEFAULT_MAX_REGENERATION_ATTEMPTS`,
  `MAX_REGENERATION_ATTEMPTS_CEILING`, `isEditorialAction`.

## LLM providers (v0.2 / v0.3)

- **`LLMProvider`** — the interface. Implementations expose
  `complete(prompt, opts?)` and/or
  `completeWithTools(prompt, tools, opts?)`.
- **`MockLLMProvider`** — fixture-driven, deterministic. Reads
  JSON fixtures from a directory. Used in every unit test.
- **`AnthropicLLMProvider`** — production provider. Reads
  `ANTHROPIC_API_KEY` from the environment (or accepts one via
  the constructor). Handles retries on 429/5xx, timeouts via
  `AbortController`, and tool-use loops with `web_search`.

## Sourcing (v0.3 / v0.5 hardened)

- **`SourceReference`** — the sourced-evidence record. Every
  agent that consumes external evidence attaches one per finding
  / claim / risk / option.
- **`SourceMissing`** — the explicit "we searched, we found
  nothing" marker. Never fabricate a URL; use this instead.
- **`isSourceMissing(v)`** — narrowing helper.
- **`SourcingReport`** — the cross-agent audit report emitted by
  `brief()` and every downstream method. Under v0.5 hardened
  rules, it carries per-agent counts and every stale / untrusted
  / duplicate warning.
- **v0.8 addition**: `SourcingReport.edited_after_critique?:
  boolean` — flips to `true` when the rerun loop fires.
- **`validateSourcing` / `validateStakeholderSourcing` /
  `validateRiskSourcing`** — the primitives the Orchestrator
  wires up. Available publicly for callers who assemble their
  own pipelines.

## Agents (RESULT types are public; some `executeXxx()` are internal)

Each agent has:

- A **RESULT type**: the shape of the agent's output. Always
  public.
- A **CONTEXT type**: the shape of the agent's input. Always
  public.
- An **`executeXxx()`** function that runs the agent against an
  `LLMProvider`. Public for Scoping / Research / Stakeholder
  Mapping (v0.2 / v0.3 / v0.4 compat). INTERNAL for Risks /
  Options / Synthesis / Adversarial — reachable only via the
  Orchestrator.

### Scoping (v0.2)

- `ScopingResult` / `AgentContext`.
- `executeScoping(ctx, llm, opts?)`.

### Research (v0.3)

- `ResearchResult` / `ResearchContext` / `Finding`.
- `executeResearch(ctx, llm, opts?)`.

### Stakeholder Mapping (v0.4)

- `StakeholderMapResult` / `StakeholderContext` / `Stakeholder`.
- Enum unions: `StakeholderCategory`, `StakeholderPower`,
  `StakeholderPosition`, `StakeholderPriority`,
  `CoverageConfidence`.
- Constants: `MIN_STAKEHOLDERS`, `MAX_STAKEHOLDERS`.
- `executeStakeholderMapping(ctx, llm, opts?)`.

### Risk Analysis (v0.5) — internal implementation

- `RiskAnalysisResult` / `RiskContext` / `Risk`.
- Enum unions: `RiskCategory`, `RiskLikelihood`, `RiskImpact`,
  `RiskTimeframe`, `AggregatedRiskLevel`.
- Constants: `RISK_CATEGORIES`, `RISK_LIKELIHOODS`,
  `RISK_IMPACTS`, `RISK_TIMEFRAMES`, `AGGREGATED_RISK_LEVELS`.
- Access via `Orchestrator.assessRisksAfterStakeholders()`.

### Options Generation (v0.6) — internal implementation

- `OptionsGenerationResult` / `OptionsContext` / `Option` /
  `OptionTradeoff` / `OptionStakeholderImpact`.
- Enum: `OptionRecommendationLevel`,
  `OPTION_RECOMMENDATION_LEVELS`.
- Access via `Orchestrator.brief()`.

### Synthesis (v0.6, extended v0.8) — internal implementation

- `SynthesisResult` / `SynthesisContext` / `SynthesizedSection` /
  `FormatConformance` / `ForbiddenTermHit` /
  `FailedValidationRule`.
- **v0.8 additions**:
  - `SynthesizedSection` gained REQUIRED
    `editorial_attempts: EditorialAttempt[]` and
    `final_attempt_number: number`.
  - `EditorialAttempt` — one entry per LLM attempt under strict
    mode. `reason` values: `"forbidden_terms" | "over_length" |
    "validation_rule" | "accepted"`.
  - `RevisionContext` — the REVISION MODE inputs (set only by
    the rerun loop).
  - `SynthesisContext.revision_context?: RevisionContext`.
- Access via `Orchestrator.brief()` /
  `Orchestrator.briefWithCritique()` /
  `Orchestrator.briefWithCritiqueAndRerun()`.

### Adversarial Critique (v0.7) — internal implementation

- `AdversarialCritiqueResult` / `AdversarialContext` / `Critique`
  / `CritiqueTarget`.
- Enum unions: `CritiqueCategory`, `CritiqueSeverity`.
- Constants: `CRITIQUE_CATEGORIES`, `CRITIQUE_SEVERITIES`.
- Access via `Orchestrator.briefWithCritique()` /
  `Orchestrator.briefWithCritiqueAndRerun()`.

## Orchestrator

Class: `Orchestrator(registry, llm)`.

Methods (in dependency order):

| Method                                          | Version | Purpose                                     |
| ----------------------------------------------- | ------- | ------------------------------------------- |
| `scope(q, fmt, opts?)`                          | v0.2    | Scoping only                                |
| `researchAfterScoping(q, fmt, opts?)`           | v0.3    | Scoping → Research                          |
| `mapStakeholdersAfterResearch(q, fmt, opts?)`   | v0.4    | + Stakeholder Mapping                       |
| `assessRisksAfterStakeholders(q, fmt, opts?)`   | v0.5    | + Risk Analysis + hardened sourcing         |
| `brief(q, fmt, opts?)`                          | v0.6    | Full six-agent pipeline                     |
| `briefWithCritique(q, fmt, opts?)`              | v0.7    | + Adversarial Critique                      |
| `briefWithCritiqueAndRerun(q, fmt, opts?)`      | v0.8    | + editorial re-run loop (hard cap 1)        |

Each method has:

- An options interface (`ScopeOptions`, ...,
  `BriefWithCritiqueOptions`), one per method.
- A result interface (`ResearchAfterScopingResult`, ...,
  `BriefWithCritiqueAndRerunResult`).

### v0.8: `briefWithCritiqueAndRerun()`

Returns `BriefWithCritiqueAndRerunResult`:

- Every field of `BriefWithCritiqueResult`, plus
- `rerun_performed: boolean`
- `rerun_reason: string | null`
- `original_synthesis: SynthesisResult | null`
- `rerun_metadata: RerunMetadata | null`

`RerunMetadata` carries:

- `critiques_addressed: string[]` — critique IDs the rerun
  addressed (critical + material).
- `steelmanned_alternative_used: string | null`.
- `re_synthesis_deviations: string[]` — section IDs whose text
  changed substantially between the initial and rerun synthesis.

### Public helper: `computeReSynthesisDeviations()`

`computeReSynthesisDeviations(original, rerun)` returns the same
list of section IDs. Exposed for callers who want to run their
own diff diagnostics on a `SynthesisResult` pair.

## Renderers (v0.7)

Dispatcher:

- **`render(brief, target, format, opts?)`** — the one-line
  entry point. Returns a `Buffer`.
- **`normaliseRenderTarget(input)`** — maps `"md"` / `"docx"` /
  `"pdf"` (schema-side names) to the renderer-native
  `RenderTarget` union.
- **`resolveTarget(target, format)`** — checks the requested
  target is declared in the format's `output_targets[]`. Throws
  `UnsupportedRenderTargetError` otherwise.

Renderer instances:

- `markdownEnhancedRenderer` — enhanced Markdown with TOC and
  sources appendix.
- `docxRenderer` — DOCX built from scratch (no `docx` npm dep).
- `pdfRenderer` — PDF via `pdfkit` (the only external runtime
  dep).

Types + constants: `Renderer`, `RenderOptions`, `RenderTarget`,
`RenderTheme`, `RENDER_TARGETS`, `RENDER_THEMES`,
`hasCritique(v)`.

## Error taxonomy

Root: **`PraxisError`**. Every typed failure in the public API
inherits from it. See `src/errors/public.ts` for the canonical
list.

Grouped for orientation:

- **Registry** — `ValidationError`, `YamlSyntaxError`,
  `FileNotFoundError`, `DuplicateFormatError`,
  `FormatNotFoundError`.
- **Orchestrator** — `OrchestrationError`, `NotImplementedError`.
- **LLM** — `LLMError`, `ProviderNotSupportedError`,
  `MockFixtureNotFoundError`, `ToolUseNotSupportedError`,
  `AnthropicAuthenticationError`, `AnthropicAPIError`,
  `AnthropicRateLimitError`, `AnthropicTimeoutError`.
- **Agents** — `AgentExecutionError`,
  `InvalidAgentOutputError`, `PromptFileError`,
  `ResearchAgentError`, `MaxToolRoundsExceededError`,
  `StakeholderMappingError`, `RiskAnalysisError`,
  `InvalidRiskStakeholderReference`, `RiskInflationError`,
  `OptionsGenerationError`,
  `InvalidOptionStakeholderReference`,
  `InvalidOptionRiskReference`, `SynthesisError`,
  `SynthesisValidationError`, `AdversarialCritiqueError`,
  `InvalidCritiqueTargetError`, `MissingAlternativeError`.
- **v0.8** — **`EditorialFailureError`** (extends
  `SynthesisError`). Raised when a section under
  `strict_editorial: true` exhausts its
  `max_regeneration_attempts`. Carries `sectionId`, `reason`,
  and the full attempt history.
- **Sourcing** — `SourcingValidationError`, `StaleSourceError`,
  `UntrustedDomainError`, `DuplicateSourceError`.
- **Renderers** — `RenderError`,
  `UnsupportedRenderTargetError`.

## The SemVer contract

- **Patch** — bug fixes, exact behaviour + public shape
  preserved.
- **Minor** — additive changes: new exports, new optional
  fields, new methods.
- **Major** — removing / renaming an export; changing a method
  signature; changing an error class's inheritance chain.

The tests that pin the surface — `tests/library/public-api.test.ts`
and `tests/library/errors-public-api.test.ts` — MUST pass on every
release. A PR that intentionally changes the surface must update
both files and land the corresponding version bump.
