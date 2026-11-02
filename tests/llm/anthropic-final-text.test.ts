/**
 * With web search, a turn opens with the model announcing its search ("I'll
 * search for …"), then tool blocks, then the answer — split into several text
 * blocks wherever a citation attaches (web search citations are always on).
 * Shape copied from the response example in Anthropic's web search docs.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";

const FIXTURE = readFileSync(
  resolve(import.meta.dir, "..", "fixtures", "mock-llm", "anthropic-api", "web-search-prose-then-json.json"),
  "utf-8"
);

describe("AnthropicLLMProvider — final answer text", () => {
  test("keeps only the text after the last tool block, joined across citation splits", async () => {
    const p = new AnthropicLLMProvider({
      apiKey: "sk-test",
      fetchFn: async () => new Response(FIXTURE, { status: 200 }),
    });
    const out = await p.completeWithTools("q", [{ type: "web_search", name: "web_search" }]);
    expect(out.text).toBe(
      '{"findings": [{"claim": "The German software market grew 9.4 percent in 2026"}]}'
    );
    expect(JSON.parse(out.text)).toEqual({
      findings: [{ claim: "The German software market grew 9.4 percent in 2026" }],
    });
  });
});
