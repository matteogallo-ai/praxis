import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeStakeholderMapping } from "../../src/agents/stakeholder.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
  MaxToolRoundsExceededError,
  StakeholderMappingError,
} from "../../src/agents/errors.ts";
import { ToolUseNotSupportedError } from "../../src/llm/errors.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { CompletionResult, Tool } from "../../src/llm/types.ts";
import type {
  StakeholderContext,
  Stakeholder,
} from "../../src/agents/types.ts";
import { isSourceMissing } from "../../src/sourcing/types.ts";
import type { Format } from "../../src/registry/schema.ts";

function baseFormat(sourcing_policy: "strict" | "permissive" = "strict"): Format {
  return {
    id: "executive-pre-read",
    name: "Test",
    version: "1.0.0",
    metadata: {
      author: "T",
      organization_style: "generic",
      language: "en",
      last_reviewed: "2026-08-17",
    },
    target_length: { pages: 2, words: 800 },
    sections: [
      {
        id: "context",
        title: "Context",
        purpose: "p",
        max_length: { words: 100 },
        required_agents: ["scoping", "research", "stakeholder"] as Format["sections"][number]["required_agents"],
        tone_directives: "n/a",
      },
    ],
    sourcing_policy,
    style_guide: { voice: "n", sentence_structure: "s", forbidden_terms: [] },
    output_targets: ["md"],
  };
}

const CTX: StakeholderContext = {
  scoping: {
    reformulated_question: "Should we enter Germany?",
    hidden_questions: ["at what cost?"],
    scope_boundaries: ["Germany only"],
    assumptions_to_validate: ["unit economics survive"],
  },
  research: {
    findings: [
      {
        claim: "German SaaS grew 12% CAGR.",
        supporting_evidence: "Bitkom 2026.",
        source: {
          url: "https://bitkom.example",
          title: "Bitkom",
          accessed_at: "2026-08-17T00:00:00Z",
          excerpt: "...",
        },
      },
    ],
    open_questions: [],
    search_queries_used: ["german saas cagr"],
  },
  format: baseFormat(),
};

function stakeholder(overrides: Partial<Stakeholder> = {}): Stakeholder {
  return {
    name: "Actor",
    category: "influencer",
    interest: "Owns downstream signal.",
    position: "neutral",
    position_evidence: {
      url: "https://example.com/a",
      title: "A",
      accessed_at: "2026-08-17T09:00:00Z",
      excerpt: "…",
    },
    power: "medium",
    priority: "important",
    engagement_notes: "Handle carefully.",
    ...overrides,
  };
}

function buildResponse(count: number): string {
  const stakeholders = Array.from({ length: count }, (_, i) =>
    stakeholder({ name: `Actor ${i + 1}` })
  );
  return JSON.stringify({
    stakeholders,
    key_dynamics: ["Dynamic 1", "Dynamic 2", "Dynamic 3"],
    blind_spots: [],
    coverage_confidence: "medium",
  });
}

const VALID_RESPONSE = buildResponse(5);

function fixedToolsProvider(overrides: Partial<CompletionResult> = {}): LLMProvider {
  const completion: CompletionResult = {
    text: overrides.text ?? VALID_RESPONSE,
    tool_calls: overrides.tool_calls ?? [],
    rounds: overrides.rounds ?? 1,
    stop_reason: overrides.stop_reason ?? "end_turn",
  };
  return {
    name: "fixed-tools",
    async complete(_p: string): Promise<string> {
      return completion.text;
    },
    async completeWithTools(_p: string, _t: Tool[]): Promise<CompletionResult> {
      return completion;
    },
  };
}

function capturingToolsProvider(text: string): {
  provider: LLMProvider;
  seen: { prompt: string | null; tools: Tool[] | null };
} {
  const seen: { prompt: string | null; tools: Tool[] | null } = {
    prompt: null,
    tools: null,
  };
  const provider: LLMProvider = {
    name: "capturing",
    async complete(_p: string): Promise<string> {
      return text;
    },
    async completeWithTools(prompt: string, tools: Tool[]): Promise<CompletionResult> {
      seen.prompt = prompt;
      seen.tools = tools;
      return { text, tool_calls: [], rounds: 1, stop_reason: "end_turn" };
    },
  };
  return { provider, seen };
}

describe("executeStakeholderMapping — nominal flow", () => {
  test("returns a StakeholderMapResult when the LLM answers valid JSON", async () => {
    const result = await executeStakeholderMapping(CTX, fixedToolsProvider());
    expect(result.stakeholders).toHaveLength(5);
    expect(result.stakeholders[0]!.name).toBe("Actor 1");
    expect(result.coverage_confidence).toBe("medium");
    expect(result.key_dynamics).toHaveLength(3);
  });

  test("interpolates scoping_json, research_json, format_id, sourcing_policy", async () => {
    const { provider, seen } = capturingToolsProvider(VALID_RESPONSE);
    await executeStakeholderMapping(CTX, provider);
    const p = seen.prompt!;
    expect(p).toContain("executive-pre-read");
    expect(p).toContain("strict");
    expect(p).toContain("Should we enter Germany?");
    expect(p).toContain("German SaaS grew 12% CAGR.");
    expect(p).not.toContain("{{scoping_json}}");
    expect(p).not.toContain("{{research_json}}");
    expect(p).not.toContain("{{format_id}}");
    expect(p).not.toContain("{{sourcing_policy}}");
  });

  test("passes the web_search tool to the LLM", async () => {
    const { provider, seen } = capturingToolsProvider(VALID_RESPONSE);
    await executeStakeholderMapping(CTX, provider);
    expect(seen.tools).toEqual([{ type: "web_search", name: "web_search" }]);
  });

  test("tolerates fenced ```json``` responses", async () => {
    const fenced = "```json\n" + VALID_RESPONSE + "\n```";
    const result = await executeStakeholderMapping(
      CTX,
      fixedToolsProvider({ text: fenced })
    );
    expect(result.stakeholders).toHaveLength(5);
  });

  test("parses SOURCE_MISSING position_evidence verbatim (no fabrication)", async () => {
    const body = JSON.stringify({
      stakeholders: [
        stakeholder({
          name: "Actor 1",
          position_evidence: { status: "SOURCE_MISSING", searched_for: "obscure post" },
        }),
        stakeholder({ name: "Actor 2" }),
        stakeholder({ name: "Actor 3" }),
      ],
      key_dynamics: ["d1", "d2", "d3"],
      blind_spots: [],
      coverage_confidence: "low",
    });
    const result = await executeStakeholderMapping(
      CTX,
      fixedToolsProvider({ text: body })
    );
    expect(isSourceMissing(result.stakeholders[0]!.position_evidence)).toBe(true);
  });

  test("integrates end-to-end with MockLLMProvider and the shipped fixture", async () => {
    const provider = new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });
    const result = await executeStakeholderMapping(CTX, provider);
    expect(result.stakeholders.length).toBeGreaterThanOrEqual(5);
    for (const s of result.stakeholders) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(["decision-maker", "influencer", "gatekeeper", "affected-party", "external-observer"]).toContain(s.category);
    }
    expect(result.key_dynamics.length).toBeGreaterThanOrEqual(3);
  });
});

describe("executeStakeholderMapping — provider capability", () => {
  test("throws ToolUseNotSupportedError when the provider lacks completeWithTools", async () => {
    const badProvider: LLMProvider = {
      name: "text-only",
      async complete(_p: string): Promise<string> {
        return VALID_RESPONSE;
      },
    };
    await expect(executeStakeholderMapping(CTX, badProvider)).rejects.toBeInstanceOf(
      ToolUseNotSupportedError
    );
  });
});

describe("executeStakeholderMapping — tool-use loop", () => {
  test("throws MaxToolRoundsExceededError when the provider pauses at the cap", async () => {
    const provider: LLMProvider = {
      name: "always-pauses",
      async complete(_p: string): Promise<string> {
        return VALID_RESPONSE;
      },
      async completeWithTools(): Promise<CompletionResult> {
        return {
          text: "",
          tool_calls: [{ id: "1", name: "web_search", input: { q: "x" } }],
          rounds: 5,
          stop_reason: "pause_turn",
        };
      },
    };
    await expect(
      executeStakeholderMapping(CTX, provider, { maxToolRounds: 5 })
    ).rejects.toBeInstanceOf(MaxToolRoundsExceededError);
  });
});

describe("executeStakeholderMapping — count enforcement", () => {
  test("throws StakeholderMappingError when fewer than MIN_STAKEHOLDERS (3)", async () => {
    const body = buildResponse(2);
    let caught: unknown;
    try {
      await executeStakeholderMapping(CTX, fixedToolsProvider({ text: body }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StakeholderMappingError);
    expect((caught as StakeholderMappingError).message).toContain("2");
    expect((caught as StakeholderMappingError).message).toContain("3");
  });

  test("throws StakeholderMappingError when more than MAX_STAKEHOLDERS (20)", async () => {
    const body = buildResponse(21);
    let caught: unknown;
    try {
      await executeStakeholderMapping(CTX, fixedToolsProvider({ text: body }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StakeholderMappingError);
    expect((caught as StakeholderMappingError).message).toContain("21");
    expect((caught as StakeholderMappingError).message).toContain("20");
  });

  test("accepts exactly MIN_STAKEHOLDERS (3)", async () => {
    const body = buildResponse(3);
    const result = await executeStakeholderMapping(
      CTX,
      fixedToolsProvider({ text: body })
    );
    expect(result.stakeholders).toHaveLength(3);
  });

  test("accepts exactly MAX_STAKEHOLDERS (20)", async () => {
    const body = buildResponse(20);
    const result = await executeStakeholderMapping(
      CTX,
      fixedToolsProvider({ text: body })
    );
    expect(result.stakeholders).toHaveLength(20);
  });
});

describe("executeStakeholderMapping — LLM output errors", () => {
  test("throws InvalidAgentOutputError on non-JSON output", async () => {
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: "not json" }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when top-level JSON is an array", async () => {
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: "[]" }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when stakeholders is missing", async () => {
    const bad = JSON.stringify({
      key_dynamics: ["d"],
      blind_spots: [],
      coverage_confidence: "high",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when a stakeholder category is invalid", async () => {
    const bad = JSON.stringify({
      stakeholders: [
        stakeholder({ category: "villain" as Stakeholder["category"] }),
        stakeholder(),
        stakeholder(),
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when a stakeholder position is invalid", async () => {
    const bad = JSON.stringify({
      stakeholders: [
        stakeholder({ position: "hostile" as Stakeholder["position"] }),
        stakeholder(),
        stakeholder(),
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when a stakeholder power is invalid", async () => {
    const bad = JSON.stringify({
      stakeholders: [
        stakeholder({ power: "godlike" as Stakeholder["power"] }),
        stakeholder(),
        stakeholder(),
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when a stakeholder priority is invalid", async () => {
    const bad = JSON.stringify({
      stakeholders: [
        stakeholder({ priority: "urgent" as Stakeholder["priority"] }),
        stakeholder(),
        stakeholder(),
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when a stakeholder name is empty", async () => {
    const bad = JSON.stringify({
      stakeholders: [
        stakeholder({ name: "" }),
        stakeholder(),
        stakeholder(),
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when a position_evidence url is missing and status is not SOURCE_MISSING", async () => {
    const bad = JSON.stringify({
      stakeholders: [
        stakeholder({
          position_evidence: {
            title: "T",
            accessed_at: "2026-08-17T00:00:00Z",
            excerpt: "e",
          } as unknown as Stakeholder["position_evidence"],
        }),
        stakeholder(),
        stakeholder(),
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when SOURCE_MISSING lacks searched_for", async () => {
    const bad = JSON.stringify({
      stakeholders: [
        stakeholder({
          position_evidence: { status: "SOURCE_MISSING" } as unknown as Stakeholder["position_evidence"],
        }),
        stakeholder(),
        stakeholder(),
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when excerpt exceeds 500 characters", async () => {
    const longExcerpt = "x".repeat(501);
    const bad = JSON.stringify({
      stakeholders: [
        stakeholder({
          position_evidence: {
            url: "https://x",
            title: "T",
            accessed_at: "2026-08-17T00:00:00Z",
            excerpt: longExcerpt,
          },
        }),
        stakeholder(),
        stakeholder(),
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when coverage_confidence is invalid", async () => {
    const bad = JSON.stringify({
      stakeholders: [stakeholder(), stakeholder(), stakeholder()],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "moderate",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when key_dynamics is empty", async () => {
    const bad = JSON.stringify({
      stakeholders: [stakeholder(), stakeholder(), stakeholder()],
      key_dynamics: [],
      blind_spots: [],
      coverage_confidence: "medium",
    });
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("accepts blind_spots as empty array", async () => {
    const body = JSON.stringify({
      stakeholders: [stakeholder(), stakeholder(), stakeholder()],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "high",
    });
    const result = await executeStakeholderMapping(
      CTX,
      fixedToolsProvider({ text: body })
    );
    expect(result.blind_spots).toEqual([]);
  });

  test("wraps LLM provider errors as AgentExecutionError", async () => {
    const badProvider: LLMProvider = {
      name: "boom",
      async complete(_p: string): Promise<string> {
        throw new Error("network");
      },
      async completeWithTools(): Promise<CompletionResult> {
        throw new Error("network unreachable");
      },
    };
    let caught: unknown;
    try {
      await executeStakeholderMapping(CTX, badProvider);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgentExecutionError);
    expect((caught as AgentExecutionError).message).toContain("network unreachable");
  });
});

describe("executeStakeholderMapping — prompt file errors", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "praxis-stakeholder-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("PromptFileError when the prompt file is absent", async () => {
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider(), {
        promptPath: join(tmp, "missing.prompt"),
      })
    ).rejects.toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the file lacks a 'stakeholder' prompt", async () => {
    const p = join(tmp, "wrong-name.prompt");
    writeFileSync(
      p,
      `@version "1.0.0"\n` +
        `prompt other(x: string) -> string {\n` +
        `  system: "s"\n` +
        `  user: "u {{x}}"\n` +
        `  output: string\n` +
        `}\n`
    );
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider(), { promptPath: p })
    ).rejects.toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the prompt lacks required parameters", async () => {
    const p = join(tmp, "missing-params.prompt");
    writeFileSync(
      p,
      `@version "1.0.0"\n` +
        `prompt stakeholder(format_id: string) -> string {\n` +
        `  system: "s"\n` +
        `  user: "u {{format_id}}"\n` +
        `  output: string\n` +
        `}\n`
    );
    await expect(
      executeStakeholderMapping(CTX, fixedToolsProvider(), { promptPath: p })
    ).rejects.toBeInstanceOf(PromptFileError);
  });
});
