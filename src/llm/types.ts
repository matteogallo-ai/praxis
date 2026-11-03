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
  /** Cap on uses of this tool per request, for tools that support one. */
  max_uses?: number;
}

/** Tokens and server-tool calls one completion consumed, summed over its rounds. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  web_search_requests: number;
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
  /** What the call consumed, when the provider reports it. */
  usage?: TokenUsage;
  /** The model that answered, when the provider reports it. */
  model?: string;
}

export interface CompleteWithToolsOptions {
  max_tokens?: number;
  /**
   * @deprecated Ignored. Anthropic API version 2026-10-21 rejects sampling
   * parameters; the field stays so 1.x callers that set it still compile.
   */
  temperature?: number;
  /** Hard cap on tool-use rounds. Default: 5. */
  max_tool_rounds?: number;
  /** Overrides the provider's default model, if supported. */
  model?: string;
  /** System prompt; see `CompleteOptions.system`. */
  system?: string;
  /** See `CompleteOptions.output_schema`; ignored when tools are present. */
  output_schema?: Record<string, unknown>;
  /** Per-request timeout for this call, overriding the provider default. */
  timeout_ms?: number;
  /**
   * Called before each request the call sends (a `pause_turn` re-send is a
   * request), with the usage of the requests already answered and the model
   * they went to (a pinned model overrides `model`). Throwing stops the
   * call before that request; the budget cap uses it.
   */
  before_request?: (answered: TokenUsage, model: string) => void;
}
