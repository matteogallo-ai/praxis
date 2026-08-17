import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import type { FetchLike } from "../../src/llm/anthropic-provider.ts";
import {
  AnthropicAuthenticationError,
  AnthropicAPIError,
  AnthropicRateLimitError,
  AnthropicTimeoutError,
} from "../../src/llm/errors.ts";

const FIXTURES = resolve(import.meta.dir, "..", "fixtures", "mock-llm", "anthropic-api");
const SIMPLE = JSON.parse(readFileSync(resolve(FIXTURES, "simple-message-response.json"), "utf-8"));
const WITH_TOOL = JSON.parse(readFileSync(resolve(FIXTURES, "tool-use-response.json"), "utf-8"));
const MULTI_TURN = JSON.parse(readFileSync(resolve(FIXTURES, "multi-turn-tool-use.json"), "utf-8"));
const RATE_LIMIT = readFileSync(resolve(FIXTURES, "rate-limit-error.json"), "utf-8");

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  payload: unknown;
}

function noSleep(): (ms: number) => Promise<void> {
  return async (_ms) => {};
}

function scriptedFetch(
  responses: Array<() => Response | Promise<Response>>
): { fn: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    let payload: unknown;
    try {
      payload = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      payload = undefined;
    }
    calls.push({ url, init, payload });
    if (i >= responses.length) {
      throw new Error(`scriptedFetch: no scripted response for call #${i + 1}`);
    }
    const factory = responses[i]!;
    i++;
    return factory();
  };
  return { fn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json" },
  });
}

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env["ANTHROPIC_API_KEY"];
});

afterEach(() => {
  if (savedKey === undefined) {
    delete process.env["ANTHROPIC_API_KEY"];
  } else {
    process.env["ANTHROPIC_API_KEY"] = savedKey;
  }
});

describe("AnthropicLLMProvider — construction", () => {
  test("name is 'anthropic'", () => {
    const p = new AnthropicLLMProvider({ apiKey: "sk-test" });
    expect(p.name).toBe("anthropic");
  });

  test("reads API key from constructor option in priority", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-env";
    const p = new AnthropicLLMProvider({ apiKey: "sk-override" });
    expect(p).toBeDefined();
  });

  test("falls back to ANTHROPIC_API_KEY env var", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-env";
    const p = new AnthropicLLMProvider();
    expect(p).toBeDefined();
  });

  test("throws AnthropicAuthenticationError when key is missing", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    expect(() => new AnthropicLLMProvider()).toThrow(AnthropicAuthenticationError);
  });

  test("throws AnthropicAuthenticationError when key is empty string", () => {
    process.env["ANTHROPIC_API_KEY"] = "";
    expect(() => new AnthropicLLMProvider()).toThrow(AnthropicAuthenticationError);
  });
});

describe("AnthropicLLMProvider.complete — happy path", () => {
  test("returns concatenated text from a simple message response", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, SIMPLE)]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    const out = await p.complete("What is the capital of France?");
    expect(out).toBe("The capital of France is Paris.");
    expect(calls).toHaveLength(1);
  });

  test("sends x-api-key, anthropic-version, and content-type headers", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, SIMPLE)]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-secret", fetchFn: fn });
    await p.complete("hi");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-secret");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");
  });

  test("targets the /v1/messages endpoint", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, SIMPLE)]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.complete("hi");
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
  });

  test("wraps the prompt into a single user message", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, SIMPLE)]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.complete("please summarise X");
    const payload = calls[0]!.payload as { messages: Array<{ role: string; content: string }> };
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]!.role).toBe("user");
    expect(payload.messages[0]!.content).toBe("please summarise X");
  });

  test("uses the default model when none is configured", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, SIMPLE)]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.complete("hi");
    const payload = calls[0]!.payload as { model: string };
    expect(payload.model).toBe("claude-sonnet-4-5");
  });

  test("respects the model constructor override", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, SIMPLE)]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      model: "claude-opus-4-7",
    });
    await p.complete("hi");
    const payload = calls[0]!.payload as { model: string };
    expect(payload.model).toBe("claude-opus-4-7");
  });

  test("forwards temperature when supplied", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, SIMPLE)]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.complete("hi", { temperature: 0.2, max_tokens: 500 });
    const payload = calls[0]!.payload as { temperature: number; max_tokens: number };
    expect(payload.temperature).toBe(0.2);
    expect(payload.max_tokens).toBe(500);
  });
});

describe("AnthropicLLMProvider.completeWithTools", () => {
  test("returns text and tool_calls from a single-round tool_use response", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, WITH_TOOL)]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
    });
    const out = await p.completeWithTools("please research German market", [
      { type: "web_search", name: "web_search" },
    ]);
    expect(out.text).toContain("Median setup cost is €150k over 6 months.");
    expect(out.tool_calls).toHaveLength(1);
    expect(out.tool_calls[0]!.name).toBe("web_search");
    expect(out.tool_calls[0]!.input.query).toBe(
      "cost of entering German market for B2B SaaS 2026"
    );
    expect(out.rounds).toBe(1);
    expect(out.stop_reason).toBe("end_turn");
    expect(calls).toHaveLength(1);
  });

  test("maps the 'web_search' tool to the versioned Anthropic type in the payload", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, WITH_TOOL)]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.completeWithTools("q", [{ type: "web_search", name: "web_search" }]);
    const payload = calls[0]!.payload as { tools: Array<{ type: string; name: string }> };
    expect(payload.tools).toEqual([
      { type: "web_search_20250305", name: "web_search" },
    ]);
  });

  test("loops when the API returns stop_reason 'pause_turn' and stops on end_turn", async () => {
    const { fn, calls } = scriptedFetch([
      () => jsonResponse(200, MULTI_TURN),
      () => jsonResponse(200, WITH_TOOL),
    ]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
    });
    const out = await p.completeWithTools("q", [
      { type: "web_search", name: "web_search" },
    ]);
    expect(out.rounds).toBe(2);
    expect(out.stop_reason).toBe("end_turn");
    // Two accumulated tool calls: one per round.
    expect(out.tool_calls).toHaveLength(2);
    expect(calls).toHaveLength(2);
    // Round 2 should have appended the assistant content.
    const round2 = calls[1]!.payload as { messages: Array<{ role: string }> };
    expect(round2.messages).toHaveLength(2);
    expect(round2.messages[0]!.role).toBe("user");
    expect(round2.messages[1]!.role).toBe("assistant");
  });

  test("respects the max_tool_rounds cap and stops even if pause_turn persists", async () => {
    const { fn, calls } = scriptedFetch([
      () => jsonResponse(200, MULTI_TURN),
      () => jsonResponse(200, MULTI_TURN),
    ]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
    });
    const out = await p.completeWithTools(
      "q",
      [{ type: "web_search", name: "web_search" }],
      { max_tool_rounds: 2 }
    );
    expect(out.rounds).toBe(2);
    expect(out.stop_reason).toBe("pause_turn");
    expect(calls).toHaveLength(2);
  });

  test("does not pass a 'tools' key when no tools are declared", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(200, SIMPLE)]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.completeWithTools("q", []);
    const payload = calls[0]!.payload as Record<string, unknown>;
    expect(payload["tools"]).toBeUndefined();
  });
});

describe("AnthropicLLMProvider — retry and errors", () => {
  test("retries on 429 up to maxAttempts, then throws AnthropicRateLimitError", async () => {
    const { fn, calls } = scriptedFetch([
      () => jsonResponse(429, RATE_LIMIT),
      () => jsonResponse(429, RATE_LIMIT),
      () => jsonResponse(429, RATE_LIMIT),
    ]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
      maxAttempts: 3,
    });
    let caught: unknown;
    try {
      await p.complete("q");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AnthropicRateLimitError);
    expect((caught as AnthropicRateLimitError).attempts).toBe(3);
    expect(calls).toHaveLength(3);
  });

  test("retries on 500 up to maxAttempts, then throws AnthropicAPIError", async () => {
    const { fn, calls } = scriptedFetch([
      () => jsonResponse(500, "server error 1"),
      () => jsonResponse(503, "server error 2"),
      () => jsonResponse(502, "server error 3"),
    ]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
      maxAttempts: 3,
    });
    let caught: unknown;
    try {
      await p.complete("q");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AnthropicAPIError);
    expect((caught as AnthropicAPIError).status).toBe(502);
    expect(calls).toHaveLength(3);
  });

  test("succeeds after a transient 429 followed by 200", async () => {
    const { fn, calls } = scriptedFetch([
      () => jsonResponse(429, RATE_LIMIT),
      () => jsonResponse(200, SIMPLE),
    ]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
      maxAttempts: 3,
    });
    const out = await p.complete("q");
    expect(out).toBe("The capital of France is Paris.");
    expect(calls).toHaveLength(2);
  });

  test("does NOT retry on 400 (client error)", async () => {
    const { fn, calls } = scriptedFetch([() => jsonResponse(400, "bad request")]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
      maxAttempts: 3,
    });
    let caught: unknown;
    try {
      await p.complete("q");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AnthropicAPIError);
    expect((caught as AnthropicAPIError).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  test("does NOT retry on 401 (unauthorised)", async () => {
    const { fn, calls } = scriptedFetch([
      () => jsonResponse(401, "invalid api key"),
    ]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
      maxAttempts: 3,
    });
    await expect(p.complete("q")).rejects.toBeInstanceOf(AnthropicAPIError);
    expect(calls).toHaveLength(1);
  });

  test("uses exponential backoff between retries (1s, 2s)", async () => {
    const delays: number[] = [];
    const { fn } = scriptedFetch([
      () => jsonResponse(429, "r1"),
      () => jsonResponse(429, "r2"),
      () => jsonResponse(200, SIMPLE),
    ]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: async (ms) => {
        delays.push(ms);
      },
      maxAttempts: 3,
    });
    await p.complete("q");
    expect(delays).toEqual([1000, 2000]);
  });

  test("surfaces timeout as AnthropicTimeoutError", async () => {
    const fetchFn: FetchLike = async (_input, init) => {
      return await new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    };
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn,
      sleepFn: noSleep(),
      timeoutMs: 10,
    });
    await expect(p.complete("q")).rejects.toBeInstanceOf(AnthropicTimeoutError);
  });

  test("throws AnthropicAPIError on malformed JSON body", async () => {
    const { fn } = scriptedFetch([
      () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
    });
    let caught: unknown;
    try {
      await p.complete("q");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AnthropicAPIError);
    expect((caught as AnthropicAPIError).message).toContain("malformed");
  });

  test("throws AnthropicAPIError when response has no 'content' array", async () => {
    const { fn } = scriptedFetch([
      () => jsonResponse(200, { stop_reason: "end_turn" }),
    ]);
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: fn,
      sleepFn: noSleep(),
    });
    await expect(p.complete("q")).rejects.toBeInstanceOf(AnthropicAPIError);
  });
});
