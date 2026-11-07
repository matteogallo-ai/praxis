/**
 * Public API of the Praxis library.
 *
 * This module is the CONTRACT: every named export below is covered
 * by the SemVer contract (docs/SEMVER-CONTRACT.md). Removing an export, changing its
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
// Registry — the source of truth for briefing format contracts.
// ---------------------------------------------------------------------------

export * from "./registry/schema.ts";
export { validateFormat } from "./registry/validator.ts";
export { loadFormatFile, loadFormatFromSource } from "./registry/loader.ts";
export { FormatRegistry, loadRegistry } from "./registry/registry.ts";
export type { RegistryEntry, LoadDirectoryOptions } from "./registry/registry.ts";

// ---------------------------------------------------------------------------
// LLM provider layer.
// ---------------------------------------------------------------------------

export type { LLMProvider, CompleteOptions } from "./llm/provider.ts";
export type {
  Tool,
  ToolCall,
  CompletionResult,
  CompleteWithToolsOptions,
  TokenUsage,
} from "./llm/types.ts";
export { DEFAULT_PRICE_TABLE, loadPriceTable } from "./llm/pricing.ts";
export type { PriceTable } from "./llm/pricing.ts";
export { MockLLMProvider } from "./llm/mock-provider.ts";
export type { MockFixture, MockLLMProviderOptions } from "./llm/mock-provider.ts";
export { AnthropicLLMProvider } from "./llm/anthropic-provider.ts";
export type {
  AnthropicLLMProviderOptions,
  FetchLike,
} from "./llm/anthropic-provider.ts";

// ---------------------------------------------------------------------------
// Sourcing layer.
// ---------------------------------------------------------------------------

export type {
  SourceReference,
  SourceMissing,
  SourceStatus,
  SourcingWarning,
  UntrustedCitation,
  FirstPartySource,
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
// Agent RESULT types.
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

// Risk analysis — RESULT type only. `executeRiskAnalysis` is
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

// Options generation — RESULT type only. Access via
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

// Synthesis — RESULT type only.
// `executeSynthesis` is internal on purpose: it is reachable via
// `Orchestrator.brief()`. The REVISION MODE inputs
// (`RevisionContext`) live inside `SynthesisContext` and are set
// only by `Orchestrator.briefWithCritiqueAndRerun()`.
export type {
  SynthesisContext,
  SynthesisResult,
  SynthesizedSection,
  ForbiddenTermHit,
  FailedValidationRule,
  FormatConformance,
  EditorialAttempt,
  RevisionContext,
} from "./agents/types.ts";

// Adversarial critique — RESULT type only. Reachable via
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
// Orchestrator (the sole entry point for pipeline runs).
// ---------------------------------------------------------------------------

export { Orchestrator } from "./orchestrator/orchestrator.ts";
export { computeReSynthesisDeviations } from "./orchestrator/orchestrator.ts";
export { UsageLedger } from "./orchestrator/ledger.ts";
export { CheckpointStore } from "./orchestrator/checkpoint.ts";
export type { RunManifest } from "./orchestrator/checkpoint.ts";
export type { StageUsage, UsageSummary, UsageLedgerOptions } from "./orchestrator/ledger.ts";
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
  BriefWithCritiqueAndRerunResult,
  RerunMetadata,
} from "./orchestrator/orchestrator.ts";

// ---------------------------------------------------------------------------
// Renderers dispatcher.
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
// Error taxonomy (canonical public surface).
//
// The `errors/public.ts` barrel is the source of truth. Every error
// class re-exported here inherits from `PraxisError` — consumers can
// write one `catch (e instanceof PraxisError)` at the top level and
// narrow from there.
// ---------------------------------------------------------------------------

export * from "./errors/public.ts";
