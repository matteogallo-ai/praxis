/**
 * Minimal `LLMProvider` interface — the surface that Praxis agents call
 * to obtain a completion from a language model.
 *
 * Kept intentionally narrow so any backend (mock, Anthropic, OpenAI,
 * local Ollama, etc.) can plug in without touching agent code.
 *
 * v0.3 adds an optional `completeWithTools` method for agents that need
 * tool use (currently: Research via web search). Providers that do not
 * support tools simply omit the method; agents that need tools check
 * for its presence and throw a typed error otherwise.
 */

import type {
  Tool,
  CompletionResult,
  CompleteWithToolsOptions,
} from "./types.ts";

export interface CompleteOptions {
  max_tokens?: number;
  /**
   * System prompt, sent in the provider's system field. Only honoured by
   * providers that set `acceptsSystemPrompt`; agents fold it into the
   * prompt text for the others.
   */
  system?: string;
  /** Model for this call (a stage's `@model`), when the provider supports it. */
  model?: string;
  /**
   * @deprecated Ignored. Anthropic API version 2026-10-21 rejects sampling
   * parameters; the field stays so 1.x callers that set it still compile.
   */
  temperature?: number;
}

export interface LLMProvider {
  readonly name: string;
  /**
   * True when `options.system` reaches the model as a system prompt. A
   * provider written before that option existed would drop it silently,
   * so agents send it separately only when this is true.
   */
  readonly acceptsSystemPrompt?: boolean;
  complete(prompt: string, options?: CompleteOptions): Promise<string>;
  completeWithTools?(
    prompt: string,
    tools: Tool[],
    options?: CompleteWithToolsOptions
  ): Promise<CompletionResult>;
}
