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
  temperature?: number;
}

export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, options?: CompleteOptions): Promise<string>;
  completeWithTools?(
    prompt: string,
    tools: Tool[],
    options?: CompleteWithToolsOptions
  ): Promise<CompletionResult>;
}
