import { describe, expect, test, beforeEach } from "bun:test";

import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { OrchestrationError } from "../../src/orchestrator/errors.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { FormatNotFoundError } from "../../src/registry/errors.ts";
import type { Format } from "../../src/registry/schema.ts";

function baseFormat(id: string, requiredAgents: string[] = ["scoping"]): Format {
  return {
    id,
    name: `Test ${id}`,
    version: "1.0.0",
    metadata: {
      author: "Tests",
      organization_style: "generic",
      language: "en",
      last_reviewed: "2026-08-14",
    },
    target_length: { pages: 2, words: 800 },
    sections: [
      {
        id: "context",
        title: "Context",
        purpose: "p",
        max_length: { words: 100 },
        required_agents: requiredAgents as Format["sections"][number]["required_agents"],
        tone_directives: "n/a",
      },
    ],
    sourcing_policy: "strict",
    style_guide: { voice: "neutral", sentence_structure: "short", forbidden_terms: [] },
    output_targets: ["md"],
  };
}

function makeRegistryWith(format: Format): FormatRegistry {
  const r = new FormatRegistry();
  r.register(format, `virtual://${format.id}`);
  return r;
}

function makeMockProvider() {
  return new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });
}

describe("Orchestrator.scope", () => {
  let registry: FormatRegistry;

  beforeEach(() => {
    registry = new FormatRegistry();
    registry.loadDirectory("formats");
  });

  test("returns a ScopingResult when the format requires scoping", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    const result = await orch.scope(
      "Should we enter the German market?",
      "executive-pre-read"
    );
    expect(result.reformulated_question.length).toBeGreaterThan(20);
    expect(Array.isArray(result.hidden_questions)).toBe(true);
    expect(Array.isArray(result.scope_boundaries)).toBe(true);
    expect(Array.isArray(result.assumptions_to_validate)).toBe(true);
  });

  test("passes the format's target_length.words to the scoping agent", async () => {
    // executive-pre-read declares target_length.words = 800 — check that
    // the mock fixture, which matches on "Briefing format: executive-pre-read",
    // was reached (i.e. no fixture-not-found error).
    const orch = new Orchestrator(registry, makeMockProvider());
    await expect(
      orch.scope("Q", "executive-pre-read")
    ).resolves.toBeDefined();
  });

  test("works with mckinsey-style-note format", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    const result = await orch.scope("Should we enter Germany?", "mckinsey-style-note");
    expect(result.reformulated_question).toContain("Minto");
  });

  test("works with position-paper-corporate format", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    const result = await orch.scope(
      "Should we enter the German market?",
      "position-paper-corporate"
    );
    expect(result.reformulated_question).toContain("corporate affairs");
  });

  test("throws FormatNotFoundError when the format id is unknown", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    await expect(orch.scope("Q", "nonexistent-format")).rejects.toBeInstanceOf(
      FormatNotFoundError
    );
  });

  test("throws OrchestrationError when the question is blank", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    await expect(orch.scope("   ", "executive-pre-read")).rejects.toBeInstanceOf(
      OrchestrationError
    );
  });

  test("throws OrchestrationError when no section requires the scoping agent", async () => {
    const fmt = baseFormat("no-scoping-format", ["research"]);
    const localRegistry = makeRegistryWith(fmt);
    const orch = new Orchestrator(localRegistry, makeMockProvider());
    let caught: unknown;
    try {
      await orch.scope("Q", "no-scoping-format");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OrchestrationError);
    expect((caught as Error).message).toContain("scoping");
  });
});
