/**
 * The orchestrator hands the format's sourcing rules to the research stage,
 * which unlike stakeholder and risk does not read the format itself.
 */
import { describe, expect, test } from "bun:test";

import type { CompleteWithToolsOptions, CompletionResult, Tool } from "../../src/llm/types.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { FIXTURE_CLOCK } from "../fixtures/clock.ts";

class Recording extends MockLLMProvider {
  readonly toolPrompts: string[] = [];
  override async completeWithTools(prompt: string, tools: Tool[], options?: CompleteWithToolsOptions): Promise<CompletionResult> {
    this.toolPrompts.push(prompt);
    return super.completeWithTools(prompt, tools, options);
  }
}

describe("sourcing guide wiring", () => {
  test("the research prompt names the format's trusted hosts", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const llm = new Recording({ fixturesDir: "tests/fixtures/mock-llm" });
    await new Orchestrator(registry, llm).brief("Should we enter the German market?", "mckinsey-style-note", {
      now: new Date(FIXTURE_CLOCK),
    });
    const research = llm.toolPrompts.find((p) => p.includes("Research task for briefing"));
    expect(research).toContain("Tier 1 (accepted): reuters.com");
    expect(research).toContain("fails the sourcing check, like a missing source");
  });
});
