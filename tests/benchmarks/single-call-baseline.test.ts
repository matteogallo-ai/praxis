/**
 * The single-call baseline (docs/preregistration/single-call-baseline.md),
 * without a paid call: its prompt, its cost bound against the registered
 * cap, and one run against a provider that answers from memory.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { BASELINE, baselinePrompt, countBriefing, estimateUsd, runBaseline } from "../../benchmarks/single-call-baseline.ts";
import { UNTRUSTED_CONTENT_RULE } from "../../src/agents/prompt-runtime.ts";
import { BudgetExceededError } from "../../src/llm/errors.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { CompleteWithToolsOptions, Tool } from "../../src/llm/types.ts";
import { UsageLedger } from "../../src/orchestrator/ledger.ts";

const yaml = readFileSync(`formats/${BASELINE.formatId}.yaml`, "utf-8");
const prompt = baselinePrompt(BASELINE.question, yaml);

function provider(answer: string, seen: { tools?: Tool[]; options?: CompleteWithToolsOptions } = {}): LLMProvider {
  return {
    name: "fake",
    acceptsSystemPrompt: true,
    complete: async () => answer,
    completeWithTools: async (_prompt, tools, options) => {
      seen.tools = tools;
      seen.options = options;
      return {
        text: answer,
        tool_calls: [],
        rounds: 1,
        stop_reason: "end_turn",
        model: BASELINE.model,
        usage: { input_tokens: 20_000, output_tokens: 3_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, web_search_requests: 4 },
      };
    },
  };
}

describe("single-call baseline", () => {
  test("is the registered question 12, and the question is the one in questions.yaml", () => {
    expect(BASELINE.questionId).toBe("12-sodium-ion-plant-morocco");
    expect(readFileSync("benchmarks/questions.yaml", "utf-8")).toContain(`question: "${BASELINE.question}"`);
  });

  test("its prompt holds the question, the format YAML verbatim and the untrusted-content rule", () => {
    expect(prompt.user).toContain(BASELINE.question);
    expect(prompt.user).toContain(yaml);
    expect(prompt.system).toContain(UNTRUSTED_CONTENT_RULE);
    expect(prompt.system).toContain("(not sourced)");
  });

  test("its worst case fits the registered $5 cap", () => {
    expect(BASELINE.capUsd).toBe(5);
    expect(estimateUsd(prompt)).toBeLessThanOrEqual(BASELINE.capUsd);
  });

  test("one call, with web search bounded, on the registered model", async () => {
    const seen: { tools?: Tool[]; options?: CompleteWithToolsOptions } = {};
    const run = await runBaseline(provider("## Situation\n\nText.", seen), new UsageLedger({ maxCostUsd: 5 }), prompt);
    expect(seen.tools).toEqual([{ type: "web_search", name: "web_search", max_uses: BASELINE.maxSearches }]);
    expect(seen.options?.model).toBe(BASELINE.model);
    expect(seen.options?.max_tool_rounds).toBe(BASELINE.maxToolRounds);
    expect(run.usage.total.calls).toBe(1);
    // 20k in × $4/M + 3k out × $20/M + 4 searches × $0.01.
    expect(run.usage.total.cost_usd).toBeCloseTo(0.08 + 0.06 + 0.04, 6);
  });

  test("a cap below the request's worst case refuses before anything is sent", async () => {
    let sent = false;
    const p = provider("x");
    const spy: LLMProvider = {
      ...p,
      completeWithTools: async (...a) => {
        sent = true;
        return p.completeWithTools!(...a);
      },
    };
    await expect(runBaseline(spy, new UsageLedger({ maxCostUsd: 0.01 }), prompt)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(sent).toBe(false);
  });

  test("countBriefing counts words and links per section, not quality", () => {
    const md = "## Situation\n\nOne two [three](https://a.example/x).\n\n## Answer\n\nFour (not sourced). [five](https://a.example/x) [six](https://b.example/y)\n";
    expect(countBriefing(md)).toEqual({
      sections: [
        { title: "Situation", words: 3, links: 1 },
        { title: "Answer", words: 5, links: 2 },
      ],
      distinct_urls: 2,
    });
  });
});
