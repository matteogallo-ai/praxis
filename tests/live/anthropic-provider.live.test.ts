/**
 * Live integration test for `AnthropicLLMProvider`.
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set in the environment.
 *
 * These tests hit the real Anthropic API. They cost real money and
 * depend on network availability — never run them from CI without
 * explicit budget.
 */

import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";

const hasKey = typeof process.env["ANTHROPIC_API_KEY"] === "string" &&
  process.env["ANTHROPIC_API_KEY"]!.length > 0;

describe.skipIf(!hasKey)("AnthropicLLMProvider (live)", () => {
  test("complete() returns non-empty text for a trivial prompt", async () => {
    const p = new AnthropicLLMProvider();
    const out = await p.complete(
      "Reply with the single word: pong. Nothing else.",
      { max_tokens: 20 }
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.toLowerCase()).toContain("pong");
  }, 60_000);

  test("completeWithTools() runs against web_search and returns text + tool_calls", async () => {
    const p = new AnthropicLLMProvider();
    const out = await p.completeWithTools(
      "Use the web_search tool to look up the capital of Portugal, then reply with only the city name.",
      [{ type: "web_search", name: "web_search" }],
      { max_tokens: 200, max_tool_rounds: 3 }
    );
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.text.toLowerCase()).toContain("lisbon");
    expect(out.rounds).toBeGreaterThanOrEqual(1);
    // The model may or may not have called web_search depending on
    // model discretion — do not assert on tool_calls length.
  }, 120_000);
});
