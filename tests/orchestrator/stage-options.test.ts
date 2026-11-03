/**
 * Each stage's own options reach that stage's agent: its prompt path and its
 * cap on search rounds. A dropped option would otherwise go unnoticed, since
 * the agent falls back to its default.
 */
import { describe, expect, setSystemTime, test } from "bun:test";

import type { CompleteWithToolsOptions, Tool } from "../../src/llm/types.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { UsageLedger } from "../../src/orchestrator/ledger.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { OrchestrationError } from "../../src/orchestrator/errors.ts";
import { StaleSourceError } from "../../src/sourcing/errors.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { FIXTURE_CLOCK } from "../fixtures/clock.ts";
import { restoreSystemTime } from "../helpers/clock.ts";

const QUESTION = "Should we enter the German market?";
const FORMAT = "executive-pre-read";
const now = new Date(FIXTURE_CLOCK);

function orchestrator(seenRounds: number[] = []): Orchestrator {
  const registry = new FormatRegistry();
  registry.loadDirectory("formats");
  const mock = new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });
  const recording = Object.assign(Object.create(mock) as MockLLMProvider, {
    completeWithTools(prompt: string, tools: Tool[], options?: CompleteWithToolsOptions) {
      if (options?.max_tool_rounds !== undefined) seenRounds.push(options.max_tool_rounds);
      return mock.completeWithTools(prompt, tools, options);
    },
  });
  return new Orchestrator(registry, recording);
}

describe("Orchestrator — per-stage options", () => {
  test("every search stage's round cap reaches its agent", async () => {
    const seen: number[] = [];
    await orchestrator(seen).briefWithCritique(QUESTION, FORMAT, {
      now,
      researchMaxToolRounds: 11,
      stakeholderMaxToolRounds: 12,
      riskMaxToolRounds: 13,
      optionsMaxToolRounds: 14,
      adversarialMaxToolRounds: 15,
    });
    expect([...new Set(seen)].sort()).toEqual([11, 12, 13, 14, 15]);
  });

  test.each([
    "scopingPromptPath",
    "researchPromptPath",
    "stakeholderPromptPath",
    "riskPromptPath",
    "optionsPromptPath",
    "synthesisPromptPath",
    "adversarialPromptPath",
  ])("%s is the prompt the stage loads", async (option) => {
    const path = `/nonexistent/${option}.prompt`;
    const err = await orchestrator()
      .briefWithCritique(QUESTION, FORMAT, { now, [option]: path })
      .catch((e: unknown) => e);
    expect(String((err as Error).message) + String((err as Error).cause ?? "")).toContain(path);
  });

  test("each stage's usage and wall time are recorded under its own name", async () => {
    const ledger = new UsageLedger({ simulated: true });
    const before = Date.now();
    await orchestrator().briefWithCritique(QUESTION, FORMAT, { now, ledger });
    const elapsed = Date.now() - before;
    const { stages } = ledger.summary();
    expect(Object.keys(stages).sort()).toEqual(
      ["adversarial", "options", "research", "risk", "scoping", "stakeholder", "synthesis"].sort()
    );
    for (const s of Object.values(stages)) {
      expect(s.duration_ms).toBeGreaterThanOrEqual(0);
      expect(s.duration_ms).toBeLessThanOrEqual(elapsed);
    }
  });

  test("scope() and a stopped pipeline record exactly the stages they ran", async () => {
    const scoped = new UsageLedger({ simulated: true });
    await orchestrator().scope(QUESTION, FORMAT, { ledger: scoped });
    expect(Object.keys(scoped.summary().stages)).toEqual(["scoping"]);
    const risks = new UsageLedger({ simulated: true });
    await orchestrator().assessRisksAfterStakeholders(QUESTION, FORMAT, { now, ledger: risks });
    expect(Object.keys(risks.summary().stages).sort()).toEqual(["research", "risk", "scoping", "stakeholder"]);
  });

  test("a rerun is recorded as its own stage", async () => {
    const ledger = new UsageLedger({ simulated: true });
    const out = await orchestrator().briefWithCritiqueAndRerun(QUESTION, FORMAT, { now, ledger });
    expect(out.rerun_performed).toBe(true);
    const { stages } = ledger.summary();
    expect(Object.keys(stages).sort()).toEqual(
      ["adversarial", "options", "research", "risk", "scoping", "stakeholder", "synthesis", "synthesis-rerun"].sort()
    );
    // Each run of synthesis makes one call per section, so the rerun's calls are its own.
    expect(stages["synthesis-rerun"]?.calls).toBe(out.synthesis.sections.length);
    expect(stages["synthesis"]?.calls).toBe(out.original_synthesis?.sections.length);
  });

  test("an empty question is refused with its reason", async () => {
    await expect(orchestrator().scope("   ", FORMAT)).rejects.toThrow(
      "Question is empty. Provide a non-blank briefing question."
    );
  });

  test("a format without a stage says why the run cannot go on", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const base = registry.get(FORMAT);
    const without = (agent: string, id: string) => ({
      ...base,
      id,
      sections: base.sections.map((sec) => ({
        ...sec,
        required_agents: sec.required_agents.filter((a) => a !== agent),
      })),
    });
    registry.register(without("risk", "no-risk"), "virtual://no-risk");
    registry.register(without("research", "no-research"), "virtual://no-research");
    const orch = new Orchestrator(registry, new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" }));
    await expect(orch.brief(QUESTION, "no-risk", { now })).rejects.toThrow(
      "Format 'no-risk' does not list 'risk' in any section's required_agents; the full brief pipeline requires it."
    );
    const err = await orch.researchAfterScoping(QUESTION, "no-research").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrchestrationError);
    expect((err as Error).message).toBe(
      "Format 'no-research' does not list 'research' in any section's required_agents; nothing to research."
    );
  });

  test("the format's sourcing rules apply from the risk stage on, not to research alone", async () => {
    // In 2040 every fixture source is past the format's 730-day cap.
    // researchAfterScoping takes no clock: it would read this one.
    const later = new Date("2040-06-01T00:00:00Z");
    setSystemTime(later);
    try {
      await expect(orchestrator().researchAfterScoping(QUESTION, FORMAT)).resolves.toBeDefined();
      await expect(orchestrator().brief(QUESTION, FORMAT, { now: later })).rejects.toBeInstanceOf(StaleSourceError);
    } finally {
      restoreSystemTime();
    }
  });

  test("a source cited by two agents is a duplicate only when the format dedupes across agents", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const base = registry.get(FORMAT);
    const rules = base.sourcing_rules;
    if (rules?.dedupe === undefined) throw new Error("the format dedupes across agents");
    // Same id in its own registry: the mock picks its fixtures by format id.
    const withoutDedupe = new FormatRegistry();
    withoutDedupe.register(
      { ...base, sourcing_rules: { ...rules, dedupe: { ...rules.dedupe, cross_agent: false } } },
      "virtual://no-dedupe"
    );
    const kinds = async (r: FormatRegistry) =>
      (
        await new Orchestrator(r, new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" })).brief(QUESTION, FORMAT, {
          now,
        })
      ).sourcing_report.warnings.map((w) => w.kind);
    expect(await kinds(registry)).toContain("duplicate_source");
    expect(await kinds(withoutDedupe)).not.toContain("duplicate_source");
  });
});
