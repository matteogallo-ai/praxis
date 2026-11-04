/**
 * The research, stakeholder, risk and options prompts carry the format's sourcing
 * guide (`src/sourcing/guidance.ts`), so the model knows which hosts the
 * format trusts and that a publication date is asked for.
 */
import { describe, expect, test } from "bun:test";

import { executeOptionsGeneration } from "../../src/agents/options.ts";
import { executeResearch } from "../../src/agents/research.ts";
import { executeRiskAnalysis } from "../../src/agents/risk.ts";
import { executeStakeholderMapping } from "../../src/agents/stakeholder.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";

const registry = new FormatRegistry();
registry.loadDirectory("formats");
const FORMAT = registry.get("mckinsey-style-note");
const RULES = FORMAT.sourcing_rules;
if (RULES === undefined) throw new Error("mckinsey-style-note ships sourcing_rules");
const SCOPING = {
  reformulated_question: "Should we buy a European logistics competitor?",
  hidden_questions: ["At what price?"],
  scope_boundaries: ["Europe"],
  assumptions_to_validate: ["Financing is available"],
};

/** Records the prompt, then fails: only what the stage sends is under test. */
function recorder(): { provider: LLMProvider; prompts: string[] } {
  const prompts: string[] = [];
  const provider: LLMProvider = {
    name: "recorder",
    async complete() {
      throw new Error("not used");
    },
    async completeWithTools(prompt: string) {
      prompts.push(prompt);
      throw new Error("recorded");
    },
  };
  return { provider, prompts };
}

async function promptOf(run: (llm: LLMProvider) => Promise<unknown>): Promise<string> {
  const { provider, prompts } = recorder();
  await run(provider).catch(() => undefined);
  expect(prompts).toHaveLength(1);
  return prompts[0] ?? "";
}

describe("sourcing guide in the search stages' prompts", () => {
  const empty = { findings: [], open_questions: [], search_queries_used: [] };
  const stages: Record<string, (llm: LLMProvider) => Promise<unknown>> = {
    research: (llm) =>
      executeResearch(
        { scoping: SCOPING, formatId: FORMAT.id, sourcingPolicy: "strict", targetWords: 800, sourcingRules: RULES },
        llm
      ),
    stakeholder: (llm) => executeStakeholderMapping({ scoping: SCOPING, research: empty, format: FORMAT }, llm),
    risk: (llm) =>
      executeRiskAnalysis(
        { scoping: SCOPING, research: empty, stakeholders: { stakeholders: [], key_dynamics: [] } as never, format: FORMAT },
        llm
      ),
    options: (llm) =>
      executeOptionsGeneration(
        {
          scoping: SCOPING,
          research: empty,
          stakeholders: { stakeholders: [], key_dynamics: [] } as never,
          risks: { risks: [] } as never,
          format: FORMAT,
        },
        llm
      ),
  };

  for (const [stage, run] of Object.entries(stages)) {
    test(`${stage}: names the format's trusted hosts and asks for the stated publication date`, async () => {
      const p = await promptOf(run);
      expect(p).toContain("Tier 1 (accepted): reuters.com");
      expect(p).toContain("Tier 3 (not accepted): wikipedia.org");
      expect(p).toContain('"published_at"');
      expect(p).toContain("Never guess a date");
      expect(p).not.toContain("{{source_guidance}}");
      // The system example lists the field the guide asks for, so the two agree.
      expect(p).toContain('"published_at": "YYYY-MM-DD');
      expect(p).not.toContain("these three fields");
      // Only the research stages' sources are freshness-checked.
      expect(p.includes("treats sources older than")).toBe(stage !== "options");
    });
  }
});
