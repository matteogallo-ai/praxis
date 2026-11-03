/**
 * An answer cut at `max_tokens`, end to end through the real Anthropic
 * provider (fake fetch) and the cost meter: refused with a typed error that
 * existing `InvalidAgentOutputError` handlers still catch, not retried, and
 * every billed round recorded.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InvalidAgentOutputError, TruncatedOutputError } from "../../src/agents/errors.ts";
import { callModel, loadPrompt } from "../../src/agents/prompt-runtime.ts";
import { isRecoverable } from "../../src/agents/retry.ts";
import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { meter, UsageLedger } from "../../src/orchestrator/ledger.ts";

const PROMPT = `@version "1.0.0"
@model claude-sonnet-5-5
@description "test"

prompt demo() -> string {
  system: """
    S
  """
  user: """
    U
  """
  output: string
}
`;

function round(stop: string, output: number) {
  return {
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: '{"risks": []} and the rest was cut' }],
    stop_reason: stop,
    usage: { input_tokens: 1000, output_tokens: output },
  };
}

describe("an answer cut at max_tokens", () => {
  test("after a pause_turn round: refused, catchable as invalid output, every round metered", async () => {
    const bodies = [round("pause_turn", 100), round("max_tokens", 16_000)];
    let sent = 0;
    const fetchFn = async () => new Response(JSON.stringify(bodies[sent++]), { status: 200 });
    const provider = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn, sleepFn: async () => {} });
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    const dir = mkdtempSync(join(tmpdir(), "praxis-trunc-"));
    writeFileSync(join(dir, "demo.prompt"), PROMPT);
    const loaded = loadPrompt("risk", join(dir, "demo.prompt"), "demo");

    const err = await callModel("risk", meter(provider, ledger, "risk"), loaded, { system: "S", user: "U" }, {
      tools: [{ type: "web_search", name: "web_search" }],
      errorContext: "while assessing risks",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TruncatedOutputError);
    expect(err).toBeInstanceOf(InvalidAgentOutputError);
    expect((err as Error).message).toContain("while assessing risks");
    expect((err as Error).message).toContain("src/agents/stage-limits.ts");
    expect(isRecoverable(err)).toBe(false);
    expect(sent).toBe(2);
    const stage = ledger.summary(false).stages["risk"];
    expect(stage?.input_tokens).toBe(2000);
    expect(stage?.output_tokens).toBe(16_100);
  });
});

describe("estimate:cost --cap-usd", () => {
  const run = (...args: string[]) =>
    Bun.spawnSync(["bun", "run", "benchmarks/estimate-cost.ts", "--ids", "02-cfo-buyback-briefing", ...args]);

  test("refuses a non-decimal or missing amount", () => {
    for (const bad of [["--cap-usd", "0x10"], ["--cap-usd", "1e3"], ["--cap-usd"]]) {
      const out = run(...bad);
      expect(out.exitCode).toBe(2);
      expect(out.stderr.toString()).toMatch(/--cap-usd <positive decimal number>/);
    }
    expect(run("--cap-usd", "14").exitCode).toBe(0);
  });
});
