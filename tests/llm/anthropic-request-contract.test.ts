/**
 * Contract test: the exact request AnthropicLLMProvider puts on the wire.
 *
 * API version 2026-10-21 rejects `temperature`, `top_p` and `top_k` with
 * HTTP 400 on every model, even at their default values
 * (https://platform.claude.com/docs/en/api/migration-2026-10-21). This file
 * pins the whole request — URL, headers, and body keys — so a field that
 * would turn every live call into a 400 cannot slip back in.
 */
import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import type { FetchLike } from "../../src/llm/anthropic-provider.ts";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function capturingFetch(): { fn: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  const fn: FetchLike = async (input, init) => {
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "{}" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
      { status: 200 }
    );
  };
  return { fn, calls };
}

/**
 * Models Anthropic lists as retired, or deprecated with a retirement date,
 * as of 2026-11-02 (models overview, "Deprecated" and "Retired" tables).
 */
const RETIRED_OR_DEPRECATED = [
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-0",
  "claude-opus-4-0",
  "claude-opus-4-1",
  "claude-3-7-sonnet-latest",
  "claude-3-5-haiku-latest",
  "claude-3-haiku-20240307",
];

const ALLOWED_BODY_KEYS = new Set(["model", "max_tokens", "system", "messages", "tools"]);

describe("Anthropic request contract — API version 2026-10-21", () => {
  test("complete(): headers, endpoint and body keys", async () => {
    const { fn, calls } = capturingFetch();
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.complete("hello", { max_tokens: 100, system: "rules" });

    const call = calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers).toEqual({
      "x-api-key": "sk-test",
      "anthropic-version": "2026-10-21",
      "content-type": "application/json",
    });
    for (const key of Object.keys(call.body)) {
      expect(ALLOWED_BODY_KEYS.has(key)).toBe(true);
    }
  });

  test("a caller-supplied temperature is never sent", async () => {
    const { fn, calls } = capturingFetch();
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.complete("hello", { temperature: 0.2 });
    await p.completeWithTools("hello", [{ type: "web_search", name: "web_search" }], {
      temperature: 0,
    });
    for (const call of calls) {
      expect(call.body).not.toHaveProperty("temperature");
      expect(call.body).not.toHaveProperty("top_p");
      expect(call.body).not.toHaveProperty("top_k");
    }
  });

  test("completeWithTools(): the full body", async () => {
    const { fn, calls } = capturingFetch();
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn, model: "claude-sonnet-5-5" });
    await p.completeWithTools("question", [{ type: "web_search", name: "web_search" }], {
      max_tokens: 2000,
    });
    expect(calls[0]!.body).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: "question" }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });
  });

  test("system text goes in the system field, never in the user message", async () => {
    const { fn, calls } = capturingFetch();
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    await p.complete("the question", { system: "the rules", model: "claude-opus-5-5" });
    expect(calls[0]!.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      system: "the rules",
      messages: [{ role: "user", content: "the question" }],
    });
  });

  test("a pinned model (constructor or ANTHROPIC_MODEL) overrides the stage's model", async () => {
    const { fn, calls } = capturingFetch();
    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn, model: "claude-haiku-5-5" });
    await p.complete("q", { model: "claude-opus-5-5" });
    expect(calls[0]!.body["model"]).toBe("claude-haiku-5-5");
  });

  test("the built-in default model is neither retired nor deprecated", async () => {
    const saved = process.env["ANTHROPIC_MODEL"];
    delete process.env["ANTHROPIC_MODEL"];
    try {
      const { fn, calls } = capturingFetch();
      const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
      await p.complete("hello");
      const model = String(calls[0]!.body["model"]);
      expect(RETIRED_OR_DEPRECATED).not.toContain(model);
      expect(model).toMatch(/^claude-(opus|sonnet|haiku)-\d+(-\d+)?$/);
    } finally {
      if (saved !== undefined) process.env["ANTHROPIC_MODEL"] = saved;
    }
  });
});
