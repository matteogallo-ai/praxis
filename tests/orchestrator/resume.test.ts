/**
 * Checkpoints, bounded retry and resume.
 *
 * The resume demonstration: a briefing fails at stage 5 (options); the same
 * run resumed afterwards makes no call for stages 1–4 and produces the
 * briefing a run without the failure produces.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { CheckpointStore } from "../../src/orchestrator/checkpoint.ts";
import { isRecoverable, withRetry } from "../../src/agents/retry.ts";
import { OrchestrationError } from "../../src/orchestrator/errors.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import {
  AnthropicAPIError,
  AnthropicAuthenticationError,
  AnthropicTimeoutError,
  BudgetExceededError,
} from "../../src/llm/errors.ts";
import { AgentExecutionError, InvalidAgentOutputError } from "../../src/agents/errors.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";

const QUESTION = "Should we enter the German market?";
const FORMAT = "executive-pre-read";
const NOW = new Date("2026-08-20T00:00:00.000Z");

/** Which stage a call belongs to, from the opening words of its system prompt. */
const STAGE_OPENINGS: Array<[string, string]> = [
  ["scoping", "You are the Scoping analyst"],
  ["research", "You are the Research analyst"],
  ["stakeholder", "You are a senior political-economy analyst"],
  ["risk", "You are a senior risk analyst"],
  ["options", "You are a senior strategy consultant"],
  ["synthesis", "You are a senior editor"],
];

/** The mock provider, logging each call's stage and failing `options` while `failOptions` is set. */
function countingProvider(state: { failOptions: boolean }): {
  llm: LLMProvider;
  calls: string[];
} {
  const mock = new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });
  const calls: string[] = [];
  const llm: LLMProvider = {
    name: "mock",
    acceptsSystemPrompt: true,
    complete: (prompt, options) => mock.complete(prompt, options),
    completeWithTools: async (prompt, tools, options) => {
      const system = options?.system ?? "";
      const stage = STAGE_OPENINGS.find(([, opening]) => system.startsWith(opening))?.[0] ?? "other";
      calls.push(stage);
      if (state.failOptions && stage === "options") throw new AnthropicAuthenticationError();
      return mock.completeWithTools(prompt, tools, options);
    },
  };
  return { llm, calls };
}

function orchestrator(llm: LLMProvider): Orchestrator {
  const registry = new FormatRegistry();
  registry.loadDirectory("formats");
  return new Orchestrator(registry, llm);
}

describe("resume after a failure at stage 5 (options)", () => {
  test("stages 1–4 are not run again, and the briefing matches an uninterrupted run", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const state = { failOptions: true };
    const { llm, calls } = countingProvider(state);
    const store = CheckpointStore.create(runsDir, QUESTION, FORMAT, NOW);

    const first = await orchestrator(llm)
      .brief(QUESTION, FORMAT, { checkpoints: store, onSourcingFailure: "degrade" })
      .catch((e: unknown) => e);
    expect(first).toBeInstanceOf(AgentExecutionError);
    for (const stage of ["scoping", "research", "stakeholder", "risk"]) {
      expect(existsSync(join(store.dir, `${stage}.json`))).toBe(true);
    }
    expect(existsSync(join(store.dir, "options.json"))).toBe(false);
    // Four stages, then the failed options call; authentication is not retried.
    expect(calls).toEqual(["scoping", "research", "stakeholder", "risk", "options"]);
    const firstRunCalls = calls.length;

    state.failOptions = false;
    const resumed = CheckpointStore.open(runsDir, store.manifest.run_id);
    const result = await orchestrator(llm).brief(QUESTION, FORMAT, {
      checkpoints: resumed,
      onSourcingFailure: "degrade",
    });
    const resumedCalls = calls.slice(firstRunCalls);
    // Nothing for stages 1–4: options, then the synthesis sections.
    expect(resumedCalls[0]).toBe("options");
    expect(new Set(resumedCalls.slice(1))).toEqual(new Set(["synthesis"]));

    const fresh = await orchestrator(countingProvider({ failOptions: false }).llm).brief(QUESTION, FORMAT, {
      now: NOW,
      onSourcingFailure: "degrade",
    });
    expect(result).toEqual(fresh);
  });

  test("a resumed run uses the first attempt's clock for freshness and generated_at", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const store = CheckpointStore.create(runsDir, QUESTION, FORMAT, NOW);
    const result = await orchestrator(countingProvider({ failOptions: false }).llm).brief(QUESTION, FORMAT, {
      checkpoints: store,
      onSourcingFailure: "degrade",
    });
    expect(result.generated_at).toBe(NOW.toISOString());
  });
});

describe("CheckpointStore", () => {
  test("run.json records the question, format and start time", () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const store = CheckpointStore.create(runsDir, QUESTION, FORMAT, NOW);
    const manifest = JSON.parse(readFileSync(join(store.dir, "run.json"), "utf-8"));
    expect(manifest).toEqual({ run_id: store.manifest.run_id, question: QUESTION, format_id: FORMAT, started_at: NOW.toISOString(), settings: {} });
    expect(store.manifest.run_id).toMatch(/^20260820T000000Z-[0-9a-f]{6}$/);
  });

  test("an unknown run id or one that walks out of the runs directory is refused", () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    expect(() => CheckpointStore.open(runsDir, "nope")).toThrow(OrchestrationError);
    expect(() => CheckpointStore.open(runsDir, "../etc")).toThrow(/not a run id/);
  });
});

describe("withRetry", () => {
  const failing = (errors: unknown[]): (() => Promise<string>) => {
    let i = 0;
    return async () => {
      const err = errors[i++];
      if (err !== undefined) throw err;
      return "ok";
    };
  };

  test("a timeout wrapped by an agent is retried, within the bound", async () => {
    const timeout = new AgentExecutionError("research", "x", { cause: new AnthropicTimeoutError(1) });
    expect(await withRetry(failing([timeout]), 2)).toBe("ok");
    await expect(withRetry(failing([timeout, timeout]), 2)).rejects.toBe(timeout);
  });

  test("malformed model output and a 5xx are recoverable; auth, 4xx and budget are not", () => {
    expect(isRecoverable(new InvalidAgentOutputError("research", "bad", "raw"))).toBe(true);
    expect(isRecoverable(new AnthropicAPIError(529, "overloaded"))).toBe(true);
    expect(isRecoverable(new AnthropicAPIError(400, "bad request"))).toBe(false);
    expect(isRecoverable(new AnthropicAuthenticationError())).toBe(false);
    expect(isRecoverable(new BudgetExceededError(1, 1, "risk"))).toBe(false);
  });

  test("a non-recoverable error is thrown on the first attempt", async () => {
    let calls = 0;
    const err = new AnthropicAuthenticationError();
    await expect(
      withRetry(async () => {
        calls += 1;
        throw err;
      }, 5)
    ).rejects.toBe(err);
    expect(calls).toBe(1);
  });
});

describe("corrupt checkpoints", () => {
  /** A finished run whose `stage` checkpoint is then replaced by `content`. */
  async function runWithCorrupt(stage: string, content: string): Promise<{ store: CheckpointStore; runsDir: string }> {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const store = CheckpointStore.create(runsDir, QUESTION, FORMAT, NOW);
    await orchestrator(countingProvider({ failOptions: false }).llm).brief(QUESTION, FORMAT, {
      checkpoints: store,
      onSourcingFailure: "degrade",
    });
    writeFileSync(join(store.dir, `${stage}.json`), content);
    return { store, runsDir };
  }

  const resume = (runsDir: string, store: CheckpointStore) =>
    orchestrator(countingProvider({ failOptions: false }).llm)
      .brief(QUESTION, FORMAT, {
        checkpoints: CheckpointStore.open(runsDir, store.manifest.run_id),
        onSourcingFailure: "degrade",
      })
      .catch((e: unknown) => e);

  test("a checkpoint with the wrong shape is refused with a clear message", async () => {
    const { store, runsDir } = await runWithCorrupt("research", JSON.stringify({ findings: "none" }));
    const err = await resume(runsDir, store);
    expect(err).toBeInstanceOf(OrchestrationError);
    expect((err as Error).message).toContain(`Checkpoint 'research' of run '${store.manifest.run_id}' is invalid`);
    expect((err as Error).message).toContain("'findings' must be an array");
  });

  test("a checkpoint that is not JSON is refused", async () => {
    const { store, runsDir } = await runWithCorrupt("scoping", "{ truncated");
    const err = await resume(runsDir, store);
    expect(err).toBeInstanceOf(OrchestrationError);
    expect((err as Error).message).toContain("Checkpoint 'scoping'");
  });

  test("a risk checkpoint naming an unknown stakeholder is refused", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const store = CheckpointStore.create(runsDir, QUESTION, FORMAT, NOW);
    await orchestrator(countingProvider({ failOptions: false }).llm).brief(QUESTION, FORMAT, {
      checkpoints: store,
      onSourcingFailure: "degrade",
    });
    const path = join(store.dir, "risk.json");
    const risks = JSON.parse(readFileSync(path, "utf-8"));
    risks.risks[0].affected_stakeholders = ["Nobody In Particular"];
    writeFileSync(path, JSON.stringify(risks));
    const err = await resume(runsDir, store);
    expect(err).toBeInstanceOf(OrchestrationError);
    expect((err as Error).message).toContain("Checkpoint 'risk'");
  });

  test("a synthesis checkpoint missing its sections is refused", async () => {
    const { store, runsDir } = await runWithCorrupt("synthesis", JSON.stringify({ total_word_count: 3 }));
    const err = await resume(runsDir, store);
    expect(err).toBeInstanceOf(OrchestrationError);
    expect((err as Error).message).toContain("Checkpoint 'synthesis'");
  });
});

describe("stageAttempts", () => {
  /** The mock, answering the research stage with prose `failures` times first. */
  function flakyResearch(failures: number): { llm: LLMProvider; researchCalls: () => number } {
    const mock = new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });
    let calls = 0;
    const llm: LLMProvider = {
      name: "mock",
      acceptsSystemPrompt: true,
      complete: (p, o) => mock.complete(p, o),
      completeWithTools: async (prompt, tools, options) => {
        if ((options?.system ?? "").startsWith("You are the Research analyst")) {
          calls += 1;
          if (calls <= failures) return { text: "no JSON here", tool_calls: [], rounds: 1, stop_reason: "end_turn" };
        }
        return mock.completeWithTools(prompt, tools, options);
      },
    };
    return { llm, researchCalls: () => calls };
  }

  test("by default a malformed answer is retried once", async () => {
    const { llm, researchCalls } = flakyResearch(1);
    await orchestrator(llm).researchAfterScoping(QUESTION, FORMAT, { onSourcingFailure: "degrade" });
    expect(researchCalls()).toBe(2);
  });

  test("stageAttempts: 1 turns retry off", async () => {
    const { llm, researchCalls } = flakyResearch(1);
    const err = await orchestrator(llm)
      .researchAfterScoping(QUESTION, FORMAT, { onSourcingFailure: "degrade", stageAttempts: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidAgentOutputError);
    expect(researchCalls()).toBe(1);
  });
});

describe("checkpoint round trip on every shipped format", () => {
  const FORMATS = ["executive-pre-read", "mckinsey-style-note", "position-paper-corporate", "family-office-memo"];
  const refusing: LLMProvider = {
    name: "mock",
    acceptsSystemPrompt: true,
    complete: async () => {
      throw new Error("a resumed finished run must not call the model");
    },
    completeWithTools: async () => {
      throw new Error("a resumed finished run must not call the model");
    },
  };

  for (const format of FORMATS) {
    test(`${format}: every stage's checkpoint, rerun and critique included, is accepted and reused`, async () => {
      const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
      const store = CheckpointStore.create(runsDir, QUESTION, format, NOW);
      const opts = { onSourcingFailure: "degrade" as const };
      const first = await orchestrator(countingProvider({ failOptions: false }).llm).briefWithCritiqueAndRerun(
        QUESTION,
        format,
        { ...opts, checkpoints: store }
      );
      const again = await orchestrator(refusing).briefWithCritiqueAndRerun(QUESTION, format, {
        ...opts,
        checkpoints: CheckpointStore.open(runsDir, store.manifest.run_id),
      });
      expect(again).toEqual(first);
    });
  }
});

describe("stageAttempts and synthesis", () => {
  test("stageAttempts: 1 also stops a malformed synthesis section from being retried", async () => {
    const mock = new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });
    let synthesisCalls = 0;
    const llm: LLMProvider = {
      name: "mock",
      acceptsSystemPrompt: true,
      complete: (p, o) => mock.complete(p, o),
      completeWithTools: async (prompt, tools, options) => {
        if ((options?.system ?? "").startsWith("You are a senior editor")) {
          synthesisCalls += 1;
          return { text: "no JSON here", tool_calls: [], rounds: 1, stop_reason: "end_turn" };
        }
        return mock.completeWithTools(prompt, tools, options);
      },
    };
    const err = await orchestrator(llm)
      .brief(QUESTION, FORMAT, { now: NOW, onSourcingFailure: "degrade", stageAttempts: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidAgentOutputError);
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    // One call per section, none repeated.
    expect(synthesisCalls).toBe(registry.get(FORMAT).sections.length);
  });
});

describe("synthesis checkpoint sources", () => {
  test("a cited source that is not a SourceReference is refused", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const store = CheckpointStore.create(runsDir, QUESTION, FORMAT, NOW);
    await orchestrator(countingProvider({ failOptions: false }).llm).brief(QUESTION, FORMAT, {
      checkpoints: store,
      onSourcingFailure: "degrade",
    });
    const path = join(store.dir, "synthesis.json");
    const synthesis = JSON.parse(readFileSync(path, "utf-8"));
    synthesis.sections[0].sources_cited = [{}];
    writeFileSync(path, JSON.stringify(synthesis));
    const err = await orchestrator(countingProvider({ failOptions: false }).llm)
      .brief(QUESTION, FORMAT, {
        checkpoints: CheckpointStore.open(runsDir, store.manifest.run_id),
        onSourcingFailure: "degrade",
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrchestrationError);
    expect((err as Error).message).toContain("sections[0].sources_cited[0]");
  });
});
