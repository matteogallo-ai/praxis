/**
 * `AnthropicLLMProvider` — Praxis's first real LLM backend.
 *
 * Talks to the Anthropic Messages API (`/v1/messages`) using Bun's
 * native `fetch`. Zero external HTTP libraries, zero SDK — the wire
 * shape we depend on is small and stable.
 *
 * Wire model:
 *   - Request body: { model, max_tokens, messages, tools? }
 *   - Response body: { content: [text|tool_use blocks…], stop_reason, … }
 *
 * Server-side tool use (specifically `web_search_20250305`) means the
 * API executes the tool itself and inlines both the invocation and its
 * result into the same response — no client-side loop needed for the
 * common case. When `stop_reason === "pause_turn"` the model asks to
 * continue; the provider echoes the assistant message back and issues
 * another API call, up to `max_tool_rounds`.
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
} from "./types.ts";
import {
  AnthropicAuthenticationError,
  AnthropicAPIError,
  AnthropicRateLimitError,
  AnthropicTimeoutError,
} from "./errors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-5";
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
  /** Overrides the ANTHROPIC_MODEL env var and the built-in default. */
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
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      }>;
}

interface AnthropicResponseBody {
  content?: unknown;
  stop_reason?: unknown;
}

export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchFn: FetchLike;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: AnthropicLLMProviderOptions = {}) {
    const key = options.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    if (typeof key !== "string" || key.length === 0) {
      throw new AnthropicAuthenticationError();
    }
    this.apiKey = key;
    this.defaultModel =
      options.model ?? process.env["ANTHROPIC_MODEL"] ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? RETRY_BACKOFF_MS.length;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
    const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];
    const requestOpts: { max_tokens: number; temperature?: number; model: string } = {
      max_tokens: options.max_tokens ?? DEFAULT_MAX_TOKENS,
      model: this.defaultModel,
    };
    if (options.temperature !== undefined) requestOpts.temperature = options.temperature;
    const body = await this.request(messages, [], requestOpts);
    return extractText(body);
  }

  async completeWithTools(
    prompt: string,
    tools: Tool[],
    options: CompleteWithToolsOptions = {}
  ): Promise<CompletionResult> {
    const maxRounds = options.max_tool_rounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    const model = options.model ?? this.defaultModel;
    const max_tokens = options.max_tokens ?? DEFAULT_MAX_TOKENS;
    const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];

    const collectedToolCalls: ToolCall[] = [];
    let rounds = 0;
    let stopReason = "";
    let finalText = "";

    for (let i = 0; i < maxRounds; i++) {
      rounds++;
      const requestOpts: { max_tokens: number; temperature?: number; model: string } = {
        max_tokens,
        model,
      };
      if (options.temperature !== undefined) requestOpts.temperature = options.temperature;
      const body = await this.request(messages, tools, requestOpts);
      const content = parseContentBlocks(body);
      collectedToolCalls.push(...extractToolCalls(content));
      finalText = extractTextFromBlocks(content);
      stopReason = typeof body.stop_reason === "string" ? body.stop_reason : "";

      if (stopReason === "pause_turn") {
        messages.push({ role: "assistant", content });
        continue;
      }
      break;
    }
    return {
      text: finalText,
      tool_calls: collectedToolCalls,
      rounds,
      stop_reason: stopReason,
    };
  }

  private async request(
    messages: AnthropicMessage[],
    tools: Tool[],
    opts: { max_tokens: number; temperature?: number; model: string }
  ): Promise<AnthropicResponseBody> {
    const payload: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.max_tokens,
      messages,
    };
    if (opts.temperature !== undefined) {
      payload["temperature"] = opts.temperature;
    }
    if (tools.length > 0) {
      payload["tools"] = tools.map(mapToolToAnthropic);
    }

    let lastRetriableBody = "";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const response = await this.fetchWithTimeout(payload);
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

  private async fetchWithTimeout(payload: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return response;
    } catch (err) {
      if (isAbortError(err)) {
        throw new AnthropicTimeoutError(this.timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapToolToAnthropic(tool: Tool): Record<string, unknown> {
  const anthropicType = TOOL_TYPE_MAP[tool.type] ?? tool.type;
  return { type: anthropicType, name: tool.name };
}

function parseContentBlocks(body: AnthropicResponseBody): AnthropicContentBlock[] {
  const raw = body.content;
  if (!Array.isArray(raw)) {
    throw new AnthropicAPIError(
      200,
      "Anthropic response is missing a 'content' array"
    );
  }
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
  return extractTextFromBlocks(parseContentBlocks(body));
}

function extractTextFromBlocks(blocks: AnthropicContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
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
