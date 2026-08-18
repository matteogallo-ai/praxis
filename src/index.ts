/**
 * Public API of the Praxis library (v0.8 — v1.0 preparation).
 *
 * This module is the CONTRACT: every named export below is covered
 * by the v1.0 SemVer contract. Removing an export, changing its
 * shape, or altering an error class's inheritance is a breaking
 * change (major-version bump).
 *
 * What is public and what is NOT:
 *
 *   - Public   → the FormatRegistry / validator / loader; the
 *                Orchestrator (its methods AND result types); every
 *                agent RESULT type (used to reason about brief
 *                outputs); LLM provider types; the sourcing types;
 *                the renderers dispatcher; the full error taxonomy.
 *
 *   - Internal → the per-agent `executeXxx()` implementations for
 *                agents beyond Scoping/Research/Stakeholder (Risks,
 *                Options, Synthesis, Adversarial). These are only
 *                reachable via the Orchestrator on purpose — the
 *                library owns their sequencing.
 *
 * See docs/api.md for the narrated tour and docs/embedding-praxis.md
 * for the quick-start.
 */

// ---------------------------------------------------------------------------
// Registry (v0.1) — the source of truth for briefing format contracts.
// ---------------------------------------------------------------------------

export * from "./registry/schema.ts";
export { validateFormat } from "./registry/validator.ts";
export { loadFormatFile, loadFormatFromSource } from "./registry/loader.ts";
export { FormatRegistry, loadRegistry } from "./registry/registry.ts";
export type { RegistryEntry, LoadDirectoryOptions } from "./registry/registry.ts";

// ---------------------------------------------------------------------------
// LLM provider layer (v0.2 / v0.3).
// ---------------------------------------------------------------------------

export type { LLMProvider, CompleteOptions } from "./llm/provider.ts";
export type {
  Tool,
  ToolCall,
  CompletionResult,
  CompleteWithToolsOptions,
} from "./llm/types.ts";
export { MockLLMProvider } from "./llm/mock-provider.ts";
export type { MockFixture, MockLLMProviderOptions } from "./llm/mock-provider.ts";
export { AnthropicLLMProvider } from "./llm/anthropic-provider.ts";
export type {
  AnthropicLLMProviderOptions,
  FetchLike,
} from "./llm/anthropic-provider.ts";

// ---------------------------------------------------------------------------
// Sourcing layer (v0.3 / v0.5 hardened).
// ---------------------------------------------------------------------------

export type {
  SourceReference,
  SourceMissing,
  SourceStatus,
  SourcingWarning,
  SourcingReport,
  SourcingPolicy,
} from "./sourcing/types.ts";
export { isSourceMissing } from "./sourcing/types.ts";
export {
  validateSourcing,
  validateStakeholderSourcing,
  validateRiskSourcing,
} from "./sourcing/validator.ts";

// ---------------------------------------------------------------------------
// Agent RESULT types (v0.2 through v0.8).
//
// These are the shapes callers reason about after a run. The
// executeXxx() implementations that PRODUCE them are internal past
// the Stakeholder agent — the Orchestrator owns their sequencing.
// ---------------------------------------------------------------------------

// Scoping.
export type { AgentContext, ScopingResult } from "./agents/types.ts";
export { executeScoping } from "./agents/scoping.ts";
export type { ExecuteScopingOptions } from "./agents/scoping.ts";

// Research.
export type {
  ResearchContext,
  ResearchResult,
  Finding,
} from "./agents/types.ts";
export { executeResearch } from "./agents/research.ts";
export type { ExecuteResearchOptions } from "./agents/research.ts";

// Stakeholder mapping.
export type {
  StakeholderContext,
  StakeholderMapResult,
  Stakeholder,
  StakeholderCategory,
  StakeholderPower,
  StakeholderPosition,
  StakeholderPriority,
  CoverageConfidence,
} from "./agents/types.ts";
export {
  executeStakeholderMapping,
  MIN_STAKEHOLDERS,
  MAX_STAKEHOLDERS,
} from "./agents/stakeholder.ts";
export type { ExecuteStakeholderMappingOptions } from "./agents/stakeholder.ts";

// Risk analysis (v0.5) — RESULT type only. `executeRiskAnalysis` is
// internal on purpose: it is reachable via
// `Orchestrator.assessRisksAfterStakeholders()`.
export type {
  RiskContext,
  RiskAnalysisResult,
  Risk,
  RiskCategory,
  RiskLikelihood,
  RiskImpact,
  RiskTimeframe,
  AggregatedRiskLevel,
} from "./agents/types.ts";
export {
  RISK_CATEGORIES,
  RISK_LIKELIHOODS,
  RISK_IMPACTS,
  RISK_TIMEFRAMES,
  AGGREGATED_RISK_LEVELS,
} from "./agents/types.ts";

// Options generation (v0.6) — RESULT type only. Access via
// `Orchestrator.brief()`.
export type {
  OptionsContext,
  OptionsGenerationResult,
  Option,
  OptionTradeoff,
  OptionStakeholderImpact,
  OptionRecommendationLevel,
} from "./agents/types.ts";
export { OPTION_RECOMMENDATION_LEVELS } from "./agents/types.ts";

// Synthesis (v0.6, extended in v0.8) — RESULT type only.
// `executeSynthesis` is internal on purpose: it is reachable via
// `Orchestrator.brief()`. The v0.8 REVISION MODE inputs
// (`RevisionContext`) live inside `SynthesisContext` and are set
// only by `Orchestrator.briefWithCritiqueAndRerun()`.
export type {
  SynthesisContext,
  SynthesisResult,
  SynthesizedSection,
  ForbiddenTermHit,
  FailedValidationRule,
  FormatConformance,
  // v0.8 additions.
  EditorialAttempt,
  RevisionContext,
} from "./agents/types.ts";

// Adversarial critique (v0.7) — RESULT type only. Reachable via
// `Orchestrator.briefWithCritique()` /
// `Orchestrator.briefWithCritiqueAndRerun()`.
export type {
  AdversarialContext,
  AdversarialCritiqueResult,
  Critique,
  CritiqueTarget,
  CritiqueCategory,
  CritiqueSeverity,
} from "./agents/types.ts";
export { CRITIQUE_CATEGORIES, CRITIQUE_SEVERITIES } from "./agents/types.ts";

// ---------------------------------------------------------------------------
// Orchestrator (the sole entry point for multi-agent runs).
// ---------------------------------------------------------------------------

export { Orchestrator } from "./orchestrator/orchestrator.ts";
export { computeReSynthesisDeviations } from "./orchestrator/orchestrator.ts";
export type {
  // Options types for every method.
  ScopeOptions,
  ResearchAfterScopingOptions,
  MapStakeholdersAfterResearchOptions,
  AssessRisksAfterStakeholdersOptions,
  BriefOptions,
  BriefWithCritiqueOptions,
  // Result types for every method.
  ResearchAfterScopingResult,
  MapStakeholdersAfterResearchResult,
  AssessRisksAfterStakeholdersResult,
  BriefResult,
  BriefWithCritiqueResult,
  // v0.8 additions.
  BriefWithCritiqueAndRerunResult,
  RerunMetadata,
} from "./orchestrator/orchestrator.ts";

// ---------------------------------------------------------------------------
// Renderers dispatcher (v0.7).
// ---------------------------------------------------------------------------

export {
  render,
  normaliseRenderTarget,
  resolveTarget,
  markdownEnhancedRenderer,
  docxRenderer,
  pdfRenderer,
} from "./renderers/index.ts";
export type {
  Renderer,
  RenderOptions,
  RenderTarget,
  RenderTheme,
} from "./renderers/index.ts";
export { RENDER_TARGETS, RENDER_THEMES, hasCritique } from "./renderers/index.ts";

// ---------------------------------------------------------------------------
// Error taxonomy (v0.8 canonical public surface).
//
// The `errors/public.ts` barrel is the source of truth. Every error
// class re-exported here inherits from `PraxisError` — consumers can
// write one `catch (e instanceof PraxisError)` at the top level and
// narrow from there.
// ---------------------------------------------------------------------------

export * from "./errors/public.ts";
