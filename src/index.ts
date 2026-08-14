/**
 * Public API of the Praxis library.
 *
 * v0.1: Format Registry (schema, validator, loader, registry).
 * v0.2: adds LLM provider abstraction, Scoping agent, Orchestrator.
 */

export * from "./registry/schema.ts";
export * from "./registry/errors.ts";
export { validateFormat } from "./registry/validator.ts";
export { loadFormatFile, loadFormatFromSource } from "./registry/loader.ts";
export { FormatRegistry, loadRegistry } from "./registry/registry.ts";
export type { RegistryEntry, LoadDirectoryOptions } from "./registry/registry.ts";

// LLM provider layer
export type { LLMProvider, CompleteOptions } from "./llm/provider.ts";
export { MockLLMProvider } from "./llm/mock-provider.ts";
export type { MockFixture, MockLLMProviderOptions } from "./llm/mock-provider.ts";
export { LLMError, ProviderNotSupportedError, MockFixtureNotFoundError } from "./llm/errors.ts";

// Agents
export type { AgentContext, ScopingResult } from "./agents/types.ts";
export { executeScoping } from "./agents/scoping.ts";
export type { ExecuteScopingOptions } from "./agents/scoping.ts";
export { AgentExecutionError, InvalidAgentOutputError, PromptFileError } from "./agents/errors.ts";

// Orchestrator
export { Orchestrator } from "./orchestrator/orchestrator.ts";
export type { ScopeOptions } from "./orchestrator/orchestrator.ts";
export { NotImplementedError, OrchestrationError } from "./orchestrator/errors.ts";
