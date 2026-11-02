/**
 * pause_turn continuation must resend the paused assistant turn unchanged.
 *
 * The web search docs: "To continue, send the paused assistant message back
 * unchanged in a new request", and "If `encrypted_content` is missing or
 * modified, the request fails with a 400 validation error"
 * (https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).
 * The fixtures copy the documented `server_tool_use` / `web_search_tool_result`
 * / cited `text` structure.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import type { FetchLike } from "../../src/llm/anthropic-provider.ts";

const FIXTURES = resolve(import.meta.dir, "..", "fixtures", "mock-llm", "anthropic-api");
const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), "utf-8")) as Record<string, unknown>;

describe("AnthropicLLMProvider — pause_turn continuation", () => {
  test("the second request carries the paused assistant content byte for byte", async () => {
    const paused = load("web-search-pause-turn.json");
    const done = load("web-search-end-turn.json");
    const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    const responses = [paused, done];
    const fn: FetchLike = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(responses[bodies.length - 1]), { status: 200 });
    };

    const p = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn: fn });
    const out = await p.completeWithTools("q", [{ type: "web_search", name: "web_search" }]);

    expect(out.stop_reason).toBe("end_turn");
    expect(bodies).toHaveLength(2);
    const resent = bodies[1]!.messages[1]!;
    expect(resent.role).toBe("assistant");
    // Deep equality on the whole array: tool_use_id, the result list with each
    // encrypted_content and page_age, and the text citations all survive.
    expect(resent.content).toEqual(paused["content"]);
  });
});
