/**
 * `AnthropicLLMProvider` — Praxis's first real LLM backend.
 *
 * Talks to the Anthropic Messages API (`/v1/messages`) using Bun's
 * native `fetch`. Zero external HTTP libraries, zero SDK — the wire
 * shape we depend on is small and stable.
 *
 * Wire model:
 *   - Request body: { model, max_tokens, messages, tools? } — no sampling
 *     parameters (API version 2026-10-21 rejects them).
 *   - Response body: { content: [text|tool_use blocks…], stop_reason, … }
 *
 * Server-side tool use (specifically `web_search_20250305`) means the
 * API executes the tool itself and inlines both the invocation and its
 * result into the same response — no client-side loop needed for the
 * common case. When `stop_reason === "pause_turn"` the model asks to
 * continue; the provider sends the paused content blocks back unchanged
 * and issues another API call, up to `max_tool_rounds`.
 *
 * Reliability:
 *   - Timeout: 60s per HTTP request (configurable).
 *   - Retries: up to 3 attempts total on 429 / 5xx, exponential backoff
 *     [1s, 2s, 4s]. Never retries on 4xx (client errors).
 *   - No retries on ECONNRESET etc — Bun's fetch surfaces those as
 *     TypeError which we let bubble up as-is; the CLI will render them.
 *
 * The provider does not persist history across calls. Each invocation
 * of `complete()` / `completeWithTools()` starts a new conversation.
 */

import type { LLMProvider, CompleteOptions } from "./provider.ts";
import type {
  Tool,
  ToolCall,
  CompletionResult,
  CompleteWithToolsOptions,
  TokenUsage,
} from "./types.ts";
import {
  AnthropicAuthenticationError,
  AnthropicAPIError,
  AnthropicRateLimitError,
  AnthropicTimeoutError,
} from "./errors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// 2026-10-21 rejects temperature, top_p and top_k with a 400 on every model,
// so the request builder never sends them.
export const ANTHROPIC_VERSION = "2026-10-21";
// claude-sonnet-4-5 is deprecated (retires 2026-11-30).
const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOOL_ROUNDS = 5;

/** Anthropic API tool identifiers mapped from Praxis-side names. */
const TOOL_TYPE_MAP: Readonly<Record<string, string>> = {
  web_search: "web_search_20250305",
};

/** Retry sequence in milliseconds — indexed by attempt number. */
const RETRY_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000];

/** Minimal fetch signature Praxis needs — a subset of `typeof fetch`. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface AnthropicLLMProviderOptions {
  /** Overrides the ANTHROPIC_API_KEY env var. Primarily for tests. */
  apiKey?: string;
  /**
   * Pins one model for every call, overriding each stage's `@model`. The
   * ANTHROPIC_MODEL env var does the same when this option is absent.
   */
  model?: string;
  /** Per-request timeout in ms. Default 60_000. */
  timeoutMs?: number;
  /**
   * Total attempt count (initial + retries) on retriable statuses.
   * Default 3. Set to 1 to disable retries.
   */
  maxAttempts?: number;
  /**
   * Injectable fetch — useful for tests. Defaults to the global
   * `fetch`. Only the (input, init) call form is used.
   */
  fetchFn?: FetchLike;
  /**
   * Injectable sleep — useful for tests that want to skip real delays.
   * Called with the delay in ms.
   */
  sleepFn?: (ms: number) => Promise<void>;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  /**
   * A string for the user turn; for a resent assistant turn, the response's
   * content blocks exactly as received (see `rawContentBlocks`).
   */
  content: string | readonly unknown[];
}

interface AnthropicResponseBody {
  content?: unknown;
  stop_reason?: unknown;
  model?: unknown;
  usage?: unknown;
}

export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly acceptsSystemPrompt = true;
  // An ECMAScript private field: absent from JSON.stringify, Object.keys and
  // inspect output, so printing the provider cannot print the key.
  readonly #apiKey: string;
  private readonly pinnedModel: string | undefined;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchFn: FetchLike;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: AnthropicLLMProviderOptions = {}) {
    const key = options.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    if (typeof key !== "string" || key.length === 0) {
      throw new AnthropicAuthenticationError();
    }
    this.#apiKey = key;
    const envModel = process.env["ANTHROPIC_MODEL"];
    this.pinnedModel = options.model ?? (envModel !== "" ? envModel : undefined);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? RETRY_BACKOFF_MS.length;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
    const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];
    const body = await this.request(messages, [], {
      max_tokens: options.max_tokens ?? DEFAULT_MAX_TOKENS,
      model: this.modelFor(options.model),
      system: options.system,
      outputSchema: options.output_schema,
      timeoutMs: options.timeout_ms ?? this.timeoutMs,
    });
    return extractText(body);
  }

  async completeWithTools(
    prompt: string,
    tools: Tool[],
    options: CompleteWithToolsOptions = {}
  ): Promise<CompletionResult> {
    const maxRounds = options.max_tool_rounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    const model = this.modelFor(options.model);
    const max_tokens = options.max_tokens ?? DEFAULT_MAX_TOKENS;
    const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];

    const collectedToolCalls: ToolCall[] = [];
    const usage = emptyUsage();
    let answeredBy: string | undefined;
    let rounds = 0;
    let stopReason = "";
    let finalText = "";

    for (let i = 0; i < maxRounds; i++) {
      options.before_request?.({ ...usage }, model);
      rounds++;
      const body = await this.request(messages, tools, {
        max_tokens,
        model,
        system: options.system,
        // Structured outputs are a 400 alongside citations, and web search
        // citations are always on, so a schema rides only on tool-less calls.
        outputSchema: tools.length === 0 ? options.output_schema : undefined,
        timeoutMs: options.timeout_ms ?? this.timeoutMs,
      });
      addUsage(usage, body.usage);
      if (typeof body.model === "string") answeredBy = body.model;
      const raw = rawContentBlocks(body);
      const content = parseContentBlocks(raw);
      collectedToolCalls.push(...extractToolCalls(content));
      finalText = extractFinalText(content);
      stopReason = typeof body.stop_reason === "string" ? body.stop_reason : "";

      if (stopReason === "pause_turn") {
        // The API resumes only from the paused turn sent back unchanged:
        // web_search_tool_result blocks carry tool_use_id and encrypted
        // content, cited text carries encrypted_index, and a dropped or
        // altered field is a 400.
        messages.push({ role: "assistant", content: raw });
        continue;
      }
      break;
    }
    const result: CompletionResult = {
      text: finalText,
      tool_calls: collectedToolCalls,
      rounds,
      stop_reason: stopReason,
      usage,
    };
    if (answeredBy !== undefined) result.model = answeredBy;
    return result;
  }

  /** Pinned model, else the stage's `@model`, else the built-in default. */
  private modelFor(requested: string | undefined): string {
    return this.pinnedModel ?? requested ?? DEFAULT_MODEL;
  }

  private async request(
    messages: AnthropicMessage[],
    tools: Tool[],
    opts: {
      max_tokens: number;
      model: string;
      system: string | undefined;
      outputSchema: Record<string, unknown> | undefined;
      timeoutMs: number;
    }
  ): Promise<AnthropicResponseBody> {
    const payload: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.max_tokens,
    };
    if (opts.system !== undefined && opts.system.length > 0) {
      payload["system"] = opts.system;
    }
    payload["messages"] = messages;
    if (opts.outputSchema !== undefined) {
      payload["output_config"] = { format: { type: "json_schema", schema: opts.outputSchema } };
    }
    if (tools.length > 0) {
      payload["tools"] = tools.map(mapToolToAnthropic);
    }

    let lastRetriableBody = "";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const response = await this.fetchWithTimeout(payload, opts.timeoutMs);
      if (response.ok) {
        const text = await response.text();
        try {
          return JSON.parse(text) as AnthropicResponseBody;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new AnthropicAPIError(
            response.status,
            `malformed JSON response: ${msg} — body: ${text.slice(0, 200)}`
          );
        }
      }
      const errBody = await response.text();
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        lastRetriableBody = errBody;
        if (attempt < this.maxAttempts) {
          const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!;
          await this.sleepFn(backoff);
          continue;
        }
        if (response.status === 429) {
          throw new AnthropicRateLimitError(attempt, errBody);
        }
        throw new AnthropicAPIError(response.status, errBody);
      }
      // Non-retriable client error.
      throw new AnthropicAPIError(response.status, errBody);
    }
    // Only reachable if maxAttempts is 0, which the constructor should
    // prevent, but keep the throw explicit.
    throw new AnthropicRateLimitError(this.maxAttempts, lastRetriableBody);
  }

  private async fetchWithTimeout(
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchFn(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.#apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return response;
    } catch (err) {
      if (isAbortError(err)) {
        throw new AnthropicTimeoutError(timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapToolToAnthropic(tool: Tool): Record<string, unknown> {
  const anthropicType = TOOL_TYPE_MAP[tool.type] ?? tool.type;
  const mapped: Record<string, unknown> = { type: anthropicType, name: tool.name };
  if (tool.max_uses !== undefined) mapped["max_uses"] = tool.max_uses;
  return mapped;
}

function emptyUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: 0,
  };
}

/** Adds one response's `usage` object to the running total; absent fields count 0. */
function addUsage(total: TokenUsage, raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  const u = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  total.input_tokens += n(u["input_tokens"]);
  total.output_tokens += n(u["output_tokens"]);
  total.cache_creation_input_tokens += n(u["cache_creation_input_tokens"]);
  total.cache_read_input_tokens += n(u["cache_read_input_tokens"]);
  const server = u["server_tool_use"];
  if (typeof server === "object" && server !== null) {
    total.web_search_requests += n((server as Record<string, unknown>)["web_search_requests"]);
  }
}

function rawContentBlocks(body: AnthropicResponseBody): readonly unknown[] {
  const raw = body.content;
  if (!Array.isArray(raw)) {
    throw new AnthropicAPIError(
      200,
      "Anthropic response is missing a 'content' array"
    );
  }
  return raw;
}

/** A typed read-only view of the blocks, for text and tool-call extraction. */
function parseContentBlocks(raw: readonly unknown[]): AnthropicContentBlock[] {
  const out: AnthropicContentBlock[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["type"] !== "string") continue;
    const block: AnthropicContentBlock = { type: rec["type"] };
    if (typeof rec["text"] === "string") block.text = rec["text"];
    if (typeof rec["id"] === "string") block.id = rec["id"];
    if (typeof rec["name"] === "string") block.name = rec["name"];
    if (rec["input"] !== undefined) block.input = rec["input"];
    out.push(block);
  }
  return out;
}

function extractText(body: AnthropicResponseBody): string {
  return extractTextFromBlocks(parseContentBlocks(rawContentBlocks(body)));
}

function extractTextFromBlocks(blocks: AnthropicContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/**
 * The answer is the text after the turn's last tool block. Text before it is
 * the model narrating its searches ("I'll search for …"), and the answer
 * itself arrives in several text blocks wherever a web search citation
 * attaches, so the blocks after the boundary are joined.
 */
function extractFinalText(blocks: AnthropicContentBlock[]): string {
  let lastToolBlock = -1;
  blocks.forEach((b, i) => {
    if (isToolUseType(b.type) || b.type.endsWith("_tool_result")) lastToolBlock = i;
  });
  return extractTextFromBlocks(blocks.slice(lastToolBlock + 1));
}

function extractToolCalls(blocks: AnthropicContentBlock[]): ToolCall[] {
  const out: ToolCall[] = [];
  for (const block of blocks) {
    if (!isToolUseType(block.type)) continue;
    if (typeof block.id !== "string" || typeof block.name !== "string") continue;
    const input =
      typeof block.input === "object" && block.input !== null && !Array.isArray(block.input)
        ? (block.input as Record<string, unknown>)
        : {};
    out.push({ id: block.id, name: block.name, input });
  }
  return out;
}

/** Server-tool blocks Anthropic returns include `server_tool_use` and `web_search_tool_use`. */
function isToolUseType(t: string): boolean {
  return t === "tool_use" || t === "server_tool_use" || t.endsWith("_tool_use");
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  if (typeof err === "object" && err !== null && "name" in err) {
    const n = (err as { name?: unknown }).name;
    if (n === "AbortError") return true;
  }
  return false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
