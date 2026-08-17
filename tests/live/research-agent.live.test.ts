/**
 * Live integration test for the Research agent end-to-end against
 * the real Anthropic API.
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set.
 */

import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { executeResearch } from "../../src/agents/research.ts";
import { isSourceMissing } from "../../src/sourcing/types.ts";
import type { ResearchContext } from "../../src/agents/types.ts";

const hasKey = typeof process.env["ANTHROPIC_API_KEY"] === "string" &&
  process.env["ANTHROPIC_API_KEY"]!.length > 0;

const CTX: ResearchContext = {
  scoping: {
    reformulated_question:
      "What are the top two policy trends in EU AI regulation as of 2026?",
    hidden_questions: ["Which regulators are driving the trend?"],
    scope_boundaries: [
      "EU only; UK and US out of scope.",
      "Time horizon 2025-2026.",
    ],
    assumptions_to_validate: ["The EU AI Act remains in force in 2026."],
  },
  formatId: "executive-pre-read",
  sourcingPolicy: "permissive",
  targetWords: 500,
};

describe.skipIf(!hasKey)("Research agent (live)", () => {
  test("returns at least one sourced finding on a live API run", async () => {
    const llm = new AnthropicLLMProvider();
    const result = await executeResearch(CTX, llm, { maxToolRounds: 4 });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    // At least one finding must carry a real URL — otherwise the run
    // does not demonstrate the sourcing loop actually worked.
    const sourced = result.findings.filter((f) => !isSourceMissing(f.source));
    expect(sourced.length).toBeGreaterThanOrEqual(1);
    const first = sourced[0]!.source;
    if (!isSourceMissing(first)) {
      expect(first.url.startsWith("http")).toBe(true);
      expect(first.title.length).toBeGreaterThan(0);
    }
  }, 180_000);
});
