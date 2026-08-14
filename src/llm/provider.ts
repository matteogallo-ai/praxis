/**
 * Minimal `LLMProvider` interface — the surface that Praxis agents call
 * to obtain a completion from a language model.
 *
 * Kept intentionally narrow so any backend (mock, Anthropic, OpenAI,
 * local Ollama, etc.) can plug in without touching agent code.
 */

export interface CompleteOptions {
  max_tokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, options?: CompleteOptions): Promise<string>;
}
