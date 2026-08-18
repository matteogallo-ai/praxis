/**
 * Public error taxonomy for the Praxis library (v0.8+).
 *
 * This file re-exports every error class that is part of Praxis's
 * PUBLIC API surface — i.e. errors an embedder is expected to
 * catch and reason about. Every error re-exported here inherits
 * from `PraxisError`, so consumers can write:
 *
 *   try { ... } catch (e) { if (e instanceof PraxisError) { ... } }
 *
 * Errors NOT re-exported here (JSON parse failures wrapped inside
 * agent errors, tool-round exhaustion, LLM-provider low-level
 * failures) remain internal — they surface through their public
 * parent class (e.g. `AgentExecutionError`, `LLMError`) which IS
 * re-exported.
 *
 * The v1.0 SemVer contract binds this file: removing an export or
 * changing an error's inheritance requires a major-version bump.
 */

// Root of the taxonomy.
export { PraxisError } from "./base.ts";

// Registry / format validation.
export {
  ValidationError,
  YamlSyntaxError,
  FileNotFoundError,
  DuplicateFormatError,
  FormatNotFoundError,
} from "../registry/errors.ts";
export type { ValidationIssue } from "../registry/errors.ts";

// Orchestrator.
export { OrchestrationError, NotImplementedError } from "../orchestrator/errors.ts";

// LLM / provider layer.
export {
  LLMError,
  ProviderNotSupportedError,
  MockFixtureNotFoundError,
  ToolUseNotSupportedError,
  AnthropicAuthenticationError,
  AnthropicAPIError,
  AnthropicRateLimitError,
  AnthropicTimeoutError,
} from "../llm/errors.ts";

// Agents (structural + cross-artefact validation).
export {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
  ResearchAgentError,
  MaxToolRoundsExceededError,
  StakeholderMappingError,
  RiskAnalysisError,
  InvalidRiskStakeholderReference,
  RiskInflationError,
  OptionsGenerationError,
  InvalidOptionStakeholderReference,
  InvalidOptionRiskReference,
  SynthesisError,
  SynthesisValidationError,
  AdversarialCritiqueError,
  InvalidCritiqueTargetError,
  MissingAlternativeError,
  // v0.8 addition.
  EditorialFailureError,
} from "../agents/errors.ts";

// Sourcing layer (hardened validation).
export {
  SourcingValidationError,
  StaleSourceError,
  UntrustedDomainError,
  DuplicateSourceError,
} from "../sourcing/errors.ts";

// Renderers.
export { RenderError, UnsupportedRenderTargetError } from "../renderers/errors.ts";
