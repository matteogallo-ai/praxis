/**
 * Public API of the Praxis library.
 *
 * v0.1: Format Registry (schema, validator, loader, registry).
 * v0.2: adds LLM provider abstraction, Scoping agent, Orchestrator.
 * v0.3: adds AnthropicLLMProvider, Research agent, Sourcing Layer,
 *       Orchestrator.researchAfterScoping().
 */

export * from "./registry/schema.ts";
export * from "./registry/errors.ts";
export { validateFormat } from "./registry/validator.ts";
export { loadFormatFile, loadFormatFromSource } from "./registry/loader.ts";
export { FormatRegistry, loadRegistry } from "./registry/registry.ts";
export type { RegistryEntry, LoadDirectoryOptions } from "./registry/registry.ts";

// LLM provider layer
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
export {
  LLMError,
  ProviderNotSupportedError,
  MockFixtureNotFoundError,
  ToolUseNotSupportedError,
  AnthropicAuthenticationError,
  AnthropicAPIError,
  AnthropicRateLimitError,
  AnthropicTimeoutError,
} from "./llm/errors.ts";

// Sourcing Layer
export type {
  SourceReference,
  SourceMissing,
  SourceStatus,
  SourcingWarning,
  SourcingReport,
  SourcingPolicy,
} from "./sourcing/types.ts";
export { isSourceMissing } from "./sourcing/types.ts";
export { validateSourcing } from "./sourcing/validator.ts";
export { SourcingValidationError } from "./sourcing/errors.ts";

// Agents
export type {
  AgentContext,
  ScopingResult,
  ResearchContext,
  ResearchResult,
  Finding,
} from "./agents/types.ts";
export { executeScoping } from "./agents/scoping.ts";
export type { ExecuteScopingOptions } from "./agents/scoping.ts";
export { executeResearch } from "./agents/research.ts";
export type { ExecuteResearchOptions } from "./agents/research.ts";
export {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
  ResearchAgentError,
  MaxToolRoundsExceededError,
} from "./agents/errors.ts";

// Orchestrator
export { Orchestrator } from "./orchestrator/orchestrator.ts";
export type {
  ScopeOptions,
  ResearchAfterScopingOptions,
  ResearchAfterScopingResult,
} from "./orchestrator/orchestrator.ts";
export { NotImplementedError, OrchestrationError } from "./orchestrator/errors.ts";
