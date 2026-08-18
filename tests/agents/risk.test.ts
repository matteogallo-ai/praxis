import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  executeRiskAnalysis,
  parseRiskAnalysisResult,
  MAX_RISKS,
} from "../../src/agents/risk.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  InvalidRiskStakeholderReference,
  MaxToolRoundsExceededError,
  PromptFileError,
  RiskAnalysisError,
  RiskInflationError,
} from "../../src/agents/errors.ts";
import { ToolUseNotSupportedError } from "../../src/llm/errors.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { CompletionResult, Tool } from "../../src/llm/types.ts";
import type {
  Risk,
  RiskContext,
  StakeholderMapResult,
} from "../../src/agents/types.ts";
import type { Format } from "../../src/registry/schema.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseFormat(): Format {
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
        id: "risks",
        title: "Risks",
        purpose: "p",
        max_length: { words: 200 },
        required_agents: ["risk"] as Format["sections"][number]["required_agents"],
        tone_directives: "n/a",
      },
    ],
    sourcing_policy: "strict",
    style_guide: { voice: "n", sentence_structure: "s", forbidden_terms: [] },
    output_targets: ["md"],
  };
}

function baseStakeholders(): StakeholderMapResult {
  return {
    stakeholders: [
      {
        name: "Board",
        category: "decision-maker",
        interest: "…",
        position: "neutral",
        position_evidence: {
          url: "https://reuters.com/board",
          title: "T",
          accessed_at: "2026-08-15T00:00:00Z",
          excerpt: "…",
        },
        power: "high",
        priority: "critical",
        engagement_notes: "…",
      },
      {
        name: "CFO",
        category: "gatekeeper",
        interest: "…",
        position: "neutral",
        position_evidence: {
          url: "https://reuters.com/cfo",
          title: "T",
          accessed_at: "2026-08-15T00:00:00Z",
          excerpt: "…",
        },
        power: "high",
        priority: "critical",
        engagement_notes: "…",
      },
    ],
    key_dynamics: ["a", "b", "c"],
    blind_spots: [],
    coverage_confidence: "medium",
  };
}

const CTX: RiskContext = {
  scoping: {
    reformulated_question: "Q?",
    hidden_questions: ["h?"],
    scope_boundaries: ["b"],
    assumptions_to_validate: ["a"],
  },
  research: {
    findings: [
      {
        claim: "c",
        supporting_evidence: "e",
        source: {
          url: "https://reuters.com/r",
          title: "T",
          accessed_at: "2026-08-15T00:00:00Z",
          excerpt: "…",
        },
      },
    ],
    open_questions: [],
    search_queries_used: ["q"],
  },
  stakeholders: baseStakeholders(),
  format: baseFormat(),
};

function riskOk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: "RISK-001",
    category: "strategic",
    description: "A risk.",
    likelihood: "medium",
    impact: "moderate",
    likelihood_evidence: {
      url: "https://reuters.com/l",
      title: "L",
      accessed_at: "2026-08-15T00:00:00Z",
      excerpt: "…",
    },
    impact_evidence: {
      url: "https://reuters.com/i",
      title: "I",
      accessed_at: "2026-08-15T00:00:00Z",
      excerpt: "…",
    },
    affected_stakeholders: ["Board"],
    timeframe: "short-term",
    mitigations: ["Establish a monthly review of X with owner Y."],
    residual_risk_after_mitigation: "low",
    ...overrides,
  };
}

function goodResult(riskCount = 5): {
  risks: Risk[];
  aggregated_risk_score: { overall: string; by_category: Record<string, string> };
  top_3_priorities: string[];
  unresolved_uncertainties: string[];
} {
  const risks: Risk[] = [];
  for (let i = 0; i < riskCount; i++) {
    risks.push(
      riskOk({
        id: `RISK-${String(i + 1).padStart(3, "0")}`,
        category: "strategic",
      })
    );
  }
  return {
    risks,
    aggregated_risk_score: {
      overall: "medium",
      by_category: { strategic: "medium" },
    },
    top_3_priorities: risks.slice(0, 3).map((r) => r.id),
    unresolved_uncertainties: [],
  };
}

// ---------------------------------------------------------------------------
// Fake LLM provider — programmable per-test.
// ---------------------------------------------------------------------------

interface FakeProviderOptions {
  text: string;
  rounds?: number;
  stop_reason?: string;
  throwErr?: Error;
}

function fakeLLM(opts: FakeProviderOptions): LLMProvider {
  return {
    name: "fake",
    async complete() {
      return opts.text;
    },
    async completeWithTools(
      _prompt: string,
      _tools: Tool[]
    ): Promise<CompletionResult> {
      if (opts.throwErr !== undefined) throw opts.throwErr;
      return {
        text: opts.text,
        tool_calls: [],
        rounds: opts.rounds ?? 1,
        stop_reason: opts.stop_reason ?? "end_turn",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// executeRiskAnalysis — orchestration + tool-use loop cap
// ---------------------------------------------------------------------------

describe("executeRiskAnalysis — provider surface", () => {
  test("throws ToolUseNotSupportedError when the provider has no completeWithTools", async () => {
    const provider: LLMProvider = { name: "no-tools", async complete() { return ""; } };
    let caught: unknown;
    try {
      await executeRiskAnalysis(CTX, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolUseNotSupportedError);
  });

  test("throws MaxToolRoundsExceededError when the loop caps out mid-tool-use", async () => {
    const provider = fakeLLM({
      text: JSON.stringify(goodResult(5)),
      rounds: 5,
      stop_reason: "pause_turn",
    });
    let caught: unknown;
    try {
      await executeRiskAnalysis(CTX, provider, { maxToolRounds: 5 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MaxToolRoundsExceededError);
  });

  test("wraps provider errors as AgentExecutionError", async () => {
    const provider = fakeLLM({
      text: "",
      throwErr: new Error("provider unreachable"),
    });
    let caught: unknown;
    try {
      await executeRiskAnalysis(CTX, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AgentExecutionError);
  });

  test("succeeds on a well-formed response and returns a typed result", async () => {
    const provider = fakeLLM({ text: JSON.stringify(goodResult(5)) });
    const result = await executeRiskAnalysis(CTX, provider);
    expect(result.risks).toHaveLength(5);
    expect(result.top_3_priorities).toHaveLength(3);
    expect(result.aggregated_risk_score.overall).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// prompt file loading errors
// ---------------------------------------------------------------------------

describe("executeRiskAnalysis — prompt file errors", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "praxis-risk-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("PromptFileError when the file is missing", async () => {
    let caught: unknown;
    try {
      await executeRiskAnalysis(CTX, fakeLLM({ text: "{}" }), {
        promptPath: join(tmp, "does-not-exist.prompt"),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the prompt lacks the 'risk' declaration", async () => {
    const p = join(tmp, "wrong.prompt");
    writeFileSync(
      p,
      `@version "1.0.0"\n@model claude-sonnet-4-5\n@description "not risk"\n\nprompt other() -> string {\n  system: """s"""\n  user: """u"""\n  output: string\n}\n`
    );
    let caught: unknown;
    try {
      await executeRiskAnalysis(CTX, fakeLLM({ text: "{}" }), { promptPath: p });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptFileError);
    if (caught instanceof PromptFileError) {
      expect(caught.message).toContain("missing prompt declaration");
    }
  });
});

// ---------------------------------------------------------------------------
// parseRiskAnalysisResult — happy path and every branch of failure
// ---------------------------------------------------------------------------

describe("parseRiskAnalysisResult — happy path", () => {
  test("parses a 5-risk analysis with valid cross-references", () => {
    const parsed = parseRiskAnalysisResult(
      JSON.stringify(goodResult(5)),
      baseStakeholders()
    );
    expect(parsed.risks).toHaveLength(5);
    expect(parsed.risks[0]!.id).toBe("RISK-001");
    expect(parsed.risks[4]!.id).toBe("RISK-005");
    expect(parsed.top_3_priorities).toEqual(["RISK-001", "RISK-002", "RISK-003"]);
  });

  test("accepts SOURCE_MISSING on likelihood_evidence", () => {
    const g = goodResult(5);
    g.risks[0]!.likelihood_evidence = {
      status: "SOURCE_MISSING",
      searched_for: "…",
    };
    const parsed = parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders());
    expect(parsed.risks[0]!.likelihood_evidence).toEqual({
      status: "SOURCE_MISSING",
      searched_for: "…",
    });
  });

  test("accepts fewer than 3 risks with a top_3_priorities of exactly N", () => {
    const g = goodResult(2);
    g.top_3_priorities = ["RISK-001", "RISK-002"];
    const parsed = parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders());
    expect(parsed.risks).toHaveLength(2);
    expect(parsed.top_3_priorities).toEqual(["RISK-001", "RISK-002"]);
  });

  test("strips JSON code fences", () => {
    const g = goodResult(5);
    const raw = "```json\n" + JSON.stringify(g) + "\n```";
    const parsed = parseRiskAnalysisResult(raw, baseStakeholders());
    expect(parsed.risks).toHaveLength(5);
  });
});

describe("parseRiskAnalysisResult — structural failures", () => {
  test("empty response", () => {
    expect(() =>
      parseRiskAnalysisResult("", baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("invalid JSON", () => {
    expect(() =>
      parseRiskAnalysisResult("not json", baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("top-level array (not object) rejected", () => {
    expect(() =>
      parseRiskAnalysisResult("[]", baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("missing 'risks' array", () => {
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify({ aggregated_risk_score: {} }), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("empty risks list is rejected", () => {
    const g = { ...goodResult(1), risks: [] };
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(RiskAnalysisError);
  });
});

describe("parseRiskAnalysisResult — risk-level shape", () => {
  test("unknown category is rejected", () => {
    const g = goodResult(5);
    (g.risks[0] as { category: string }).category = "existential";
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("unknown likelihood value is rejected", () => {
    const g = goodResult(5);
    (g.risks[0] as { likelihood: string }).likelihood = "certain";
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("unknown impact value is rejected", () => {
    const g = goodResult(5);
    (g.risks[0] as { impact: string }).impact = "cosmic";
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("missing likelihood_evidence.url is rejected", () => {
    const g = goodResult(5);
    (g.risks[0]!.likelihood_evidence as { url: unknown }).url = "";
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("vague mitigation is rejected", () => {
    const g = goodResult(5);
    g.risks[0]!.mitigations = ["monitor closely"];
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(RiskAnalysisError);
  });

  test("empty mitigations array is rejected", () => {
    const g = goodResult(5);
    g.risks[0]!.mitigations = [];
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("too many mitigations rejected", () => {
    const g = goodResult(5);
    g.risks[0]!.mitigations = ["A", "B", "C", "D"];
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });
});

describe("parseRiskAnalysisResult — id enforcement", () => {
  test("non-sequential ids are rejected", () => {
    const g = goodResult(3);
    g.risks[1]!.id = "RISK-005";
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(RiskAnalysisError);
  });

  test("duplicate ids are rejected", () => {
    const g = goodResult(3);
    g.risks[1]!.id = "RISK-001";
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(RiskAnalysisError);
  });
});

describe("parseRiskAnalysisResult — cross-stakeholder validation", () => {
  test("unknown stakeholder reference is rejected", () => {
    const g = goodResult(5);
    g.risks[0]!.affected_stakeholders = ["Made-Up Actor"];
    let caught: unknown;
    try {
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidRiskStakeholderReference);
    if (caught instanceof InvalidRiskStakeholderReference) {
      expect(caught.unknownStakeholder).toBe("Made-Up Actor");
      expect(caught.riskId).toBe("RISK-001");
    }
  });

  test("empty affected_stakeholders is rejected", () => {
    const g = goodResult(5);
    g.risks[0]!.affected_stakeholders = [];
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("multiple valid stakeholder references pass", () => {
    const g = goodResult(5);
    g.risks[0]!.affected_stakeholders = ["Board", "CFO"];
    const parsed = parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders());
    expect(parsed.risks[0]!.affected_stakeholders).toEqual(["Board", "CFO"]);
  });
});

describe("parseRiskAnalysisResult — aggregated_risk_score", () => {
  test("missing overall is rejected", () => {
    const g = goodResult(5);
    (g.aggregated_risk_score as { overall: unknown }).overall = "extreme";
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("by_category with a non-category key is rejected", () => {
    const g = goodResult(5);
    g.aggregated_risk_score.by_category = { existential: "high" };
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(InvalidAgentOutputError);
  });

  test("by_category missing a category that has risks is rejected", () => {
    const g = goodResult(5);
    g.risks[0]!.category = "regulatory";
    // by_category only names 'strategic', not 'regulatory'.
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(RiskAnalysisError);
  });
});

describe("parseRiskAnalysisResult — top_3_priorities", () => {
  test("top_3_priorities referencing an unknown risk is rejected", () => {
    const g = goodResult(5);
    g.top_3_priorities = ["RISK-999", "RISK-001", "RISK-002"];
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(RiskAnalysisError);
  });

  test("duplicate entry in top_3_priorities is rejected", () => {
    const g = goodResult(5);
    g.top_3_priorities = ["RISK-001", "RISK-001", "RISK-002"];
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(RiskAnalysisError);
  });

  test("wrong number of entries is rejected", () => {
    const g = goodResult(5);
    g.top_3_priorities = ["RISK-001", "RISK-002"];
    expect(() =>
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders())
    ).toThrow(RiskAnalysisError);
  });
});

describe("parseRiskAnalysisResult — hard cap", () => {
  test("more than MAX_RISKS risks throws RiskInflationError", () => {
    const g = goodResult(MAX_RISKS + 1);
    let caught: unknown;
    try {
      parseRiskAnalysisResult(JSON.stringify(g), baseStakeholders());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RiskInflationError);
    if (caught instanceof RiskInflationError) {
      expect(caught.count).toBe(MAX_RISKS + 1);
      expect(caught.max).toBe(MAX_RISKS);
    }
  });

  test("MAX_RISKS risks exactly is accepted", () => {
    const g = goodResult(MAX_RISKS);
    const parsed = parseRiskAnalysisResult(
      JSON.stringify(g),
      baseStakeholders()
    );
    expect(parsed.risks).toHaveLength(MAX_RISKS);
  });
});
