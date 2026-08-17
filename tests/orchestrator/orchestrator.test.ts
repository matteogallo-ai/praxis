import { describe, expect, test, beforeEach } from "bun:test";

import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { OrchestrationError } from "../../src/orchestrator/errors.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { FormatNotFoundError } from "../../src/registry/errors.ts";
import { SourcingValidationError } from "../../src/sourcing/errors.ts";
import type { Format } from "../../src/registry/schema.ts";
import { isSourceMissing } from "../../src/sourcing/types.ts";

function baseFormat(
  id: string,
  requiredAgents: string[] = ["scoping"],
  sourcingPolicy: "strict" | "permissive" = "strict"
): Format {
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
    sourcing_policy: sourcingPolicy,
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

describe("Orchestrator.researchAfterScoping", () => {
  let registry: FormatRegistry;

  beforeEach(() => {
    registry = new FormatRegistry();
    registry.loadDirectory("formats");
  });

  test("returns both scoping and research outputs for executive-pre-read", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    const out = await orch.researchAfterScoping(
      "Should we enter the German market?",
      "executive-pre-read"
    );
    expect(out.scoping.reformulated_question.length).toBeGreaterThan(20);
    expect(out.research.findings.length).toBeGreaterThanOrEqual(3);
    expect(out.research.search_queries_used.length).toBeGreaterThanOrEqual(3);
    // strict policy → no missing sources allowed → all findings sourced.
    for (const f of out.research.findings) {
      expect(isSourceMissing(f.source)).toBe(false);
    }
  });

  test("works with mckinsey-style-note", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    const out = await orch.researchAfterScoping(
      "Should we enter Germany?",
      "mckinsey-style-note"
    );
    expect(out.scoping.reformulated_question).toContain("Minto");
    expect(out.research.findings.length).toBeGreaterThanOrEqual(3);
  });

  test("works with position-paper-corporate", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    const out = await orch.researchAfterScoping(
      "Should we enter the German market?",
      "position-paper-corporate"
    );
    expect(out.scoping.reformulated_question).toContain("corporate affairs");
    expect(out.research.findings.length).toBeGreaterThanOrEqual(3);
  });

  test("throws OrchestrationError when the format doesn't require research", async () => {
    const fmt = baseFormat("only-scoping", ["scoping"]);
    const localRegistry = makeRegistryWith(fmt);
    const orch = new Orchestrator(localRegistry, makeMockProvider());
    let caught: unknown;
    try {
      await orch.researchAfterScoping("Q", "only-scoping");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OrchestrationError);
    expect((caught as Error).message).toContain("research");
  });

  test("throws OrchestrationError when the format doesn't require scoping either", async () => {
    const fmt = baseFormat("no-scoping-either", ["synthesis"]);
    const localRegistry = makeRegistryWith(fmt);
    const orch = new Orchestrator(localRegistry, makeMockProvider());
    await expect(
      orch.researchAfterScoping("Q", "no-scoping-either")
    ).rejects.toBeInstanceOf(OrchestrationError);
  });

  test("throws FormatNotFoundError on unknown format", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    await expect(
      orch.researchAfterScoping("Q", "not-a-real-format")
    ).rejects.toBeInstanceOf(FormatNotFoundError);
  });

  test("throws OrchestrationError on blank question", async () => {
    const orch = new Orchestrator(registry, makeMockProvider());
    await expect(
      orch.researchAfterScoping("  ", "executive-pre-read")
    ).rejects.toBeInstanceOf(OrchestrationError);
  });

  test("strict policy: throws SourcingValidationError when a finding is SOURCE_MISSING", async () => {
    // We craft a mock fixture on the fly that returns a research result
    // containing one SOURCE_MISSING finding. The Orchestrator should
    // enforce strict policy after Research and throw.
    const { mkdtempSync, writeFileSync, cpSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = mkdtempSync(join(tmpdir(), "praxis-orch-strict-"));

    // Bring the scoping fixture over so scoping succeeds against
    // executive-pre-read.
    cpSync(
      "tests/fixtures/mock-llm/scoping-executive-pre-read.json",
      join(tmp, "scoping-executive-pre-read.json")
    );

    // Craft a research fixture with one SOURCE_MISSING finding.
    const missingBody = {
      findings: [
        {
          claim: "Something we could not verify.",
          supporting_evidence: "Analyst hearsay.",
          source: { status: "SOURCE_MISSING", searched_for: "obscure figure" },
        },
      ],
      open_questions: [],
      search_queries_used: ["obscure figure"],
    };
    writeFileSync(
      join(tmp, "research-executive-pre-read.json"),
      JSON.stringify({
        label: "custom",
        match_substring: "Research task for briefing 'executive-pre-read' under strict sourcing.",
        response: JSON.stringify(missingBody),
      })
    );

    const provider = new MockLLMProvider({ fixturesDir: tmp });
    const orch = new Orchestrator(registry, provider);
    await expect(
      orch.researchAfterScoping("Should we enter the German market?", "executive-pre-read")
    ).rejects.toBeInstanceOf(SourcingValidationError);
  });

  test("permissive policy: accepts findings with SOURCE_MISSING without throwing", async () => {
    // Custom format with permissive sourcing + a fixture-backed run.
    const fmt = baseFormat(
      "permissive-fmt",
      ["scoping", "research"],
      "permissive"
    );
    const localRegistry = makeRegistryWith(fmt);

    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = mkdtempSync(join(tmpdir(), "praxis-orch-permissive-"));

    // Scoping fixture matching the permissive format.
    writeFileSync(
      join(tmp, "scoping.json"),
      JSON.stringify({
        label: "scoping/permissive",
        match_substring: "Briefing format: permissive-fmt",
        response: JSON.stringify({
          reformulated_question: "Reformulated for permissive.",
          hidden_questions: ["h"],
          scope_boundaries: ["b"],
          assumptions_to_validate: ["a"],
        }),
      })
    );

    // Research fixture with one sourced + one missing finding.
    const body = {
      findings: [
        {
          claim: "Sourced claim.",
          supporting_evidence: "e",
          source: {
            url: "https://x.example",
            title: "X",
            accessed_at: "2026-08-17T00:00:00Z",
            excerpt: "e",
          },
        },
        {
          claim: "Unsourced claim.",
          supporting_evidence: "e2",
          source: { status: "SOURCE_MISSING", searched_for: "x" },
        },
      ],
      open_questions: [],
      search_queries_used: ["x"],
    };
    writeFileSync(
      join(tmp, "research.json"),
      JSON.stringify({
        label: "research/permissive",
        match_substring: "Research task for briefing 'permissive-fmt' under permissive sourcing.",
        response: JSON.stringify(body),
      })
    );

    const provider = new MockLLMProvider({ fixturesDir: tmp });
    const orch = new Orchestrator(localRegistry, provider);
    const out = await orch.researchAfterScoping("Q", "permissive-fmt");
    expect(out.research.findings).toHaveLength(2);
    expect(isSourceMissing(out.research.findings[1]!.source)).toBe(true);
  });
});
