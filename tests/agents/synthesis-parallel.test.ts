/**
 * Synthesis sections are independent calls and run concurrently; the
 * briefing keeps the format's section order whatever order they finish in.
 */
import { describe, expect, test } from "bun:test";

import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";

const NOW = new Date("2026-08-20T00:00:00.000Z");

describe("synthesis concurrency", () => {
  test("sections overlap in flight and come back in format order", async () => {
    const mock = new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });
    let inFlight = 0;
    let peak = 0;
    let n = 0;
    const llm: LLMProvider = {
      name: "mock",
      acceptsSystemPrompt: true,
      complete: (p, o) => mock.complete(p, o),
      completeWithTools: async (prompt, tools, options) => {
        if (!(options?.system ?? "").startsWith("You are a senior editor")) {
          return mock.completeWithTools(prompt, tools, options);
        }
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // Later sections finish first, so order cannot come from timing.
        const delay = 40 - 3 * n++;
        await new Promise((r) => setTimeout(r, Math.max(delay, 1)));
        inFlight -= 1;
        return mock.completeWithTools(prompt, tools, options);
      },
    };
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const format = registry.get("executive-pre-read");
    const result = await new Orchestrator(registry, llm).brief(
      "Should we enter the German market?",
      format.id,
      { now: NOW, onSourcingFailure: "degrade" }
    );
    expect(peak).toBe(format.sections.length);
    expect(result.synthesis.sections.map((s) => s.section_id)).toEqual(
      format.sections.map((s) => s.id)
    );
  });
});
