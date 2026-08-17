/**
 * Shared types for the LLM provider layer.
 *
 * v0.3 introduces tool use (specifically Anthropic's server-side
 * `web_search_20250305`). These types describe the request/response
 * shape at the Praxis boundary — providers are free to translate them
 * to whatever their backend expects.
 *
 * The mock provider and the Anthropic provider both conform to this
 * surface.
 */

/**
 * Declares a tool the model may call. `type` is the vendor-neutral
 * identifier used by the Praxis-side agent; for Anthropic server tools
 * the provider maps this to the versioned type string (e.g. `web_search`
 * → `web_search_20250305`).
 */
export interface Tool {
  /** Praxis-side tool identifier (e.g. `web_search`). */
  type: string;
  /** Human-readable name surfaced to the LLM. */
  name: string;
}

/**
 * A single tool invocation the model asked for during a completion.
 * Recorded for audit and available to callers even when the provider
 * loops server-side.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Result of a `completeWithTools` invocation.
 *
 * `text` is the final textual answer after all tool loops. `tool_calls`
 * is the flat list of every tool call the model made (across all
 * rounds), in call order. `rounds` counts how many API calls the
 * provider issued to satisfy the request.
 */
export interface CompletionResult {
  text: string;
  tool_calls: ToolCall[];
  rounds: number;
  stop_reason: string;
}

export interface CompleteWithToolsOptions {
  max_tokens?: number;
  temperature?: number;
  /** Hard cap on tool-use rounds. Default: 5. */
  max_tool_rounds?: number;
  /** Overrides the provider's default model, if supported. */
  model?: string;
}
