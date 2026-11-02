/**
 * Usage reporting and per-call limits on AnthropicLLMProvider.
 *
 * The cost ledger reads `CompletionResult.usage`, so every round's `usage`
 * (tokens and `server_tool_use.web_search_requests`) must be summed across
 * pause_turn continuations. Each stage sends its own timeout; a request that
 * outlives it must surface as `AnthropicTimeoutError` carrying that timeout.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import type { FetchLike } from "../../src/llm/anthropic-provider.ts";
import { AnthropicTimeoutError } from "../../src/llm/errors.ts";

const FIXTURES = resolve(import.meta.dir, "..", "fixtures", "mock-llm", "anthropic-api");
const load = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), "utf-8"));

function scripted(responses: unknown[]): { fn: FetchLike; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  const fn: FetchLike = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(responses[bodies.length - 1]), { status: 200 });
  };
  return { fn, bodies };
}

const WEB_SEARCH = [{ type: "web_search", name: "web_search", max_uses: 5 }];

describe("AnthropicLLMProvider — usage", () => {
  test("usage is summed over the paused and the final round", async () => {
    const paused = load("web-search-pause-turn.json") as { usage: Record<string, unknown> };
    const done = load("web-search-end-turn.json") as { usage: Record<string, unknown> };
    const { fn } = scripted([paused, done]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    const out = await p.completeWithTools("q", WEB_SEARCH);
    const num = (u: Record<string, unknown>, k: string): number =>
      typeof u[k] === "number" ? (u[k] as number) : 0;
    expect(out.usage).toEqual({
      input_tokens: num(paused.usage, "input_tokens") + num(done.usage, "input_tokens"),
      output_tokens: num(paused.usage, "output_tokens") + num(done.usage, "output_tokens"),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      web_search_requests: 1,
    });
  });

  test("a response without usage counts zero rather than failing", async () => {
    const { fn } = scripted([{ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    const out = await p.completeWithTools("q", []);
    expect(out.usage?.input_tokens).toBe(0);
    expect(out.usage?.web_search_requests).toBe(0);
  });

  test("the answering model is reported", async () => {
    const { fn } = scripted([
      { model: "claude-opus-5-5", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" },
    ]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    expect((await p.completeWithTools("q", [])).model).toBe("claude-opus-5-5");
  });
});

describe("AnthropicLLMProvider — per-call limits", () => {
  test("max_uses reaches the web_search tool definition", async () => {
    const { fn, bodies } = scripted([
      { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" },
    ]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.completeWithTools("q", WEB_SEARCH);
    expect(bodies[0]!["tools"]).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    ]);
  });

  test("an output schema rides on a tool-less completeWithTools call", async () => {
    const { fn, bodies } = scripted([
      { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" },
    ]);
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    const schema = { type: "object", properties: {}, additionalProperties: false };
    await p.completeWithTools("q", [], { output_schema: schema });
    expect(bodies[0]!["output_config"]).toEqual({ format: { type: "json_schema", schema } });
    expect(bodies[0]).not.toHaveProperty("tools");
  });

  test("timeout_ms overrides the provider default and names itself in the error", async () => {
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: hanging, timeoutMs: 60_000 });
    const started = Date.now();
    const err = await p.complete("q", { timeout_ms: 30 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnthropicTimeoutError);
    expect((err as Error).message).toContain("30");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
