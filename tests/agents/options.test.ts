import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  executeOptionsGeneration,
  parseOptionsGenerationResult,
  MAX_OPTIONS,
  MIN_OPTIONS,
} from "../../src/agents/options.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  InvalidOptionRiskReference,
  InvalidOptionStakeholderReference,
  MaxToolRoundsExceededError,
  OptionsGenerationError,
  PromptFileError,
} from "../../src/agents/errors.ts";
import { ToolUseNotSupportedError } from "../../src/llm/errors.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { CompletionResult, Tool } from "../../src/llm/types.ts";
import type {
  Option,
  OptionsContext,
  RiskAnalysisResult,
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
        id: "options-section",
        title: "Options",
        purpose: "p",
        max_length: { words: 200 },
        required_agents: ["options"] as Format["sections"][number]["required_agents"],
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

function baseRisks(): RiskAnalysisResult {
  return {
    risks: [
      {
        id: "RISK-001",
        category: "strategic",
        description: "A strategic risk.",
        likelihood: "medium",
        impact: "moderate",
        likelihood_evidence: {
          url: "https://reuters.com/l1",
          title: "L1",
          accessed_at: "2026-08-15T00:00:00Z",
          excerpt: "…",
        },
        impact_evidence: {
          url: "https://reuters.com/i1",
          title: "I1",
          accessed_at: "2026-08-15T00:00:00Z",
          excerpt: "…",
        },
        affected_stakeholders: ["Board"],
        timeframe: "short-term",
        mitigations: ["Establish X"],
        residual_risk_after_mitigation: "low",
      },
      {
        id: "RISK-002",
        category: "financial",
        description: "A financial risk.",
        likelihood: "high",
        impact: "major",
        likelihood_evidence: {
          url: "https://reuters.com/l2",
          title: "L2",
          accessed_at: "2026-08-15T00:00:00Z",
          excerpt: "…",
        },
        impact_evidence: {
          url: "https://reuters.com/i2",
          title: "I2",
          accessed_at: "2026-08-15T00:00:00Z",
          excerpt: "…",
        },
        affected_stakeholders: ["CFO"],
        timeframe: "short-term",
        mitigations: ["Cap Y"],
        residual_risk_after_mitigation: "medium",
      },
    ],
    aggregated_risk_score: {
      overall: "medium",
      by_category: { strategic: "medium", financial: "high" },
    },
    top_3_priorities: ["RISK-002", "RISK-001"],
    unresolved_uncertainties: [],
  };
}

const CTX: OptionsContext = {
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
  risks: baseRisks(),
  format: baseFormat(),
};

function optionOk(overrides: Partial<Option> = {}): Option {
  return {
    id: "OPT-A",
    title: "Do the thing",
    summary: "A concrete option summary in two or three sentences that explains what will actually happen.",
    tradeoffs: [
      { dimension: "cost", assessment: "Bounded €5m envelope." },
      { dimension: "time-to-market", assessment: "9 months." },
      { dimension: "regulatory-exposure", assessment: "Contained via pre-filed DPIA." },
    ],
    stakeholder_impact: [
      {
        stakeholder_name: "Board",
        predicted_reaction: "supportive",
        impact_description: "Sits inside the board's stated envelope.",
      },
    ],
    risks_mitigated: ["RISK-001"],
    risks_introduced: [],
    dependencies: ["Board approval"],
    time_horizon: "short-term",
    recommendation_level: "recommended",
    supporting_evidence: {
      url: "https://reuters.com/precedent",
      title: "Precedent",
      accessed_at: "2026-08-15T00:00:00Z",
      excerpt: "…",
    },
    ...overrides,
  };
}

function goodResult(optionCount = 2): {
  options: Option[];
  recommended_option_id: string;
  rationale_for_recommendation: string;
  counter_arguments_considered: string[];
  unresolved_uncertainties: string[];
} {
  const ids = ["OPT-A", "OPT-B", "OPT-C", "OPT-D"];
  const opts: Option[] = [];
  for (let i = 0; i < optionCount; i++) {
    opts.push(
      optionOk({
        id: ids[i]!,
        recommendation_level: i === 0 ? "recommended" : "acceptable",
      })
    );
  }
  return {
    options: opts,
    recommended_option_id: "OPT-A",
    rationale_for_recommendation:
      "OPT-A wins on the CFO's payback discipline and the board's stated envelope while preserving reversibility.",
    counter_arguments_considered: opts
      .slice(1)
      .map((o) => `${o.id} was set aside on the merits.`),
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
// executeOptionsGeneration — orchestration + tool-use loop cap
// ---------------------------------------------------------------------------

describe("executeOptionsGeneration — provider surface", () => {
  test("throws ToolUseNotSupportedError when the provider has no completeWithTools", async () => {
    const provider: LLMProvider = { name: "no-tools", async complete() { return ""; } };
    let caught: unknown;
    try {
      await executeOptionsGeneration(CTX, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolUseNotSupportedError);
  });

  test("throws MaxToolRoundsExceededError when the loop caps out mid-tool-use", async () => {
    const provider = fakeLLM({
      text: JSON.stringify(goodResult(2)),
      rounds: 5,
      stop_reason: "pause_turn",
    });
    let caught: unknown;
    try {
      await executeOptionsGeneration(CTX, provider, { maxToolRounds: 5 });
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
      await executeOptionsGeneration(CTX, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AgentExecutionError);
  });

  test("succeeds on a well-formed response and returns a typed result", async () => {
    const provider = fakeLLM({ text: JSON.stringify(goodResult(3)) });
    const result = await executeOptionsGeneration(CTX, provider);
    expect(result.options).toHaveLength(3);
    expect(result.recommended_option_id).toBe("OPT-A");
    expect(result.rationale_for_recommendation.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Prompt file errors
// ---------------------------------------------------------------------------

describe("executeOptionsGeneration — prompt file errors", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "praxis-options-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("PromptFileError when the file is missing", async () => {
    let caught: unknown;
    try {
      await executeOptionsGeneration(CTX, fakeLLM({ text: "{}" }), {
        promptPath: join(tmp, "does-not-exist.prompt"),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the prompt lacks the 'options' declaration", async () => {
    const p = join(tmp, "wrong.prompt");
    writeFileSync(
      p,
      `@version "1.0.0"\n@model claude-sonnet-4-5\n@description "not options"\n\nprompt other() -> string {\n  system: """s"""\n  user: """u"""\n  output: string\n}\n`
    );
    let caught: unknown;
    try {
      await executeOptionsGeneration(CTX, fakeLLM({ text: "{}" }), {
        promptPath: p,
      });
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
// parseOptionsGenerationResult — happy path and every branch of failure
// ---------------------------------------------------------------------------

describe("parseOptionsGenerationResult — happy path", () => {
  test("parses a 2-option analysis with valid cross-references", () => {
    const parsed = parseOptionsGenerationResult(
      JSON.stringify(goodResult(2)),
      baseStakeholders(),
      baseRisks()
    );
    expect(parsed.options).toHaveLength(2);
    expect(parsed.recommended_option_id).toBe("OPT-A");
    expect(parsed.options[0]!.recommendation_level).toBe("recommended");
    expect(parsed.options[1]!.recommendation_level).toBe("acceptable");
  });

  test("accepts SOURCE_MISSING on supporting_evidence", () => {
    const g = goodResult(2);
    g.options[0]!.supporting_evidence = {
      status: "SOURCE_MISSING",
      searched_for: "precedent case for OPT-A",
    };
    const parsed = parseOptionsGenerationResult(
      JSON.stringify(g),
      baseStakeholders(),
      baseRisks()
    );
    expect(parsed.options[0]!.supporting_evidence).toEqual({
      status: "SOURCE_MISSING",
      searched_for: "precedent case for OPT-A",
    });
  });

  test("strips JSON code fences", () => {
    const raw = "```json\n" + JSON.stringify(goodResult(2)) + "\n```";
    const parsed = parseOptionsGenerationResult(
      raw,
      baseStakeholders(),
      baseRisks()
    );
    expect(parsed.options).toHaveLength(2);
  });

  test("accepts the maximum of 4 options", () => {
    const parsed = parseOptionsGenerationResult(
      JSON.stringify(goodResult(4)),
      baseStakeholders(),
      baseRisks()
    );
    expect(parsed.options).toHaveLength(4);
  });
});

describe("parseOptionsGenerationResult — structural failures", () => {
  test("empty response is rejected", () => {
    expect(() =>
      parseOptionsGenerationResult("", baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("invalid JSON is rejected", () => {
    expect(() =>
      parseOptionsGenerationResult("not json", baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("top-level array rejected", () => {
    expect(() =>
      parseOptionsGenerationResult("[]", baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("missing 'options' array", () => {
    expect(() =>
      parseOptionsGenerationResult(
        JSON.stringify({ recommended_option_id: "OPT-A" }),
        baseStakeholders(),
        baseRisks()
      )
    ).toThrow(InvalidAgentOutputError);
  });
});

describe("parseOptionsGenerationResult — count bounds", () => {
  test("fewer than MIN_OPTIONS is rejected", () => {
    const g = goodResult(1);
    expect(() =>
      parseOptionsGenerationResult(
        JSON.stringify(g),
        baseStakeholders(),
        baseRisks()
      )
    ).toThrow(OptionsGenerationError);
    // MIN_OPTIONS is 2
    expect(MIN_OPTIONS).toBe(2);
  });

  test("more than MAX_OPTIONS is rejected", () => {
    const g = goodResult(4);
    // Add a fifth entry by duplicating
    g.options.push({ ...g.options[0]!, id: "OPT-E", recommendation_level: "acceptable" });
    expect(() =>
      parseOptionsGenerationResult(
        JSON.stringify(g),
        baseStakeholders(),
        baseRisks()
      )
    ).toThrow(OptionsGenerationError);
    expect(MAX_OPTIONS).toBe(4);
  });
});

describe("parseOptionsGenerationResult — ID rules", () => {
  test("non-sequential ids rejected", () => {
    const g = goodResult(2);
    g.options[1]!.id = "OPT-D";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(OptionsGenerationError);
  });

  test("duplicate ids rejected", () => {
    const g = goodResult(2);
    g.options[1]!.id = "OPT-A";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(OptionsGenerationError);
  });
});

describe("parseOptionsGenerationResult — recommendation discipline", () => {
  test("no option marked recommended is rejected", () => {
    const g = goodResult(2);
    g.options[0]!.recommendation_level = "acceptable";
    let caught: unknown;
    try {
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OptionsGenerationError);
    if (caught instanceof OptionsGenerationError) {
      expect(caught.message).toContain("recommendation_level='recommended'");
    }
  });

  test("more than one recommended is rejected", () => {
    const g = goodResult(2);
    g.options[1]!.recommendation_level = "recommended";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(OptionsGenerationError);
  });

  test("recommended_option_id must match the recommended option", () => {
    const g = goodResult(2);
    g.recommended_option_id = "OPT-B";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(OptionsGenerationError);
  });

  test("recommended_option_id referencing an unknown id is rejected", () => {
    const g = goodResult(2);
    g.recommended_option_id = "OPT-Z";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(OptionsGenerationError);
  });
});

describe("parseOptionsGenerationResult — cross-artefact validation", () => {
  test("unknown stakeholder name in stakeholder_impact is rejected", () => {
    const g = goodResult(2);
    g.options[0]!.stakeholder_impact = [
      {
        stakeholder_name: "Ghost Actor",
        predicted_reaction: "supportive",
        impact_description: "…",
      },
    ];
    let caught: unknown;
    try {
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidOptionStakeholderReference);
  });

  test("unknown risk id in risks_mitigated is rejected", () => {
    const g = goodResult(2);
    g.options[0]!.risks_mitigated = ["RISK-999"];
    let caught: unknown;
    try {
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidOptionRiskReference);
    if (caught instanceof InvalidOptionRiskReference) {
      expect(caught.field).toBe("risks_mitigated");
    }
  });

  test("unknown risk id in risks_introduced is rejected", () => {
    const g = goodResult(2);
    g.options[0]!.risks_introduced = ["RISK-999"];
    let caught: unknown;
    try {
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidOptionRiskReference);
    if (caught instanceof InvalidOptionRiskReference) {
      expect(caught.field).toBe("risks_introduced");
    }
  });

  test("same risk in both mitigated and introduced is rejected", () => {
    const g = goodResult(2);
    g.options[0]!.risks_mitigated = ["RISK-001"];
    g.options[0]!.risks_introduced = ["RISK-001"];
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(OptionsGenerationError);
  });

  test("empty stakeholder_impact is rejected", () => {
    const g = goodResult(2);
    g.options[0]!.stakeholder_impact = [];
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });
});

describe("parseOptionsGenerationResult — tradeoff discipline", () => {
  test("vague tradeoff label 'pros' is rejected", () => {
    const g = goodResult(2);
    g.options[0]!.tradeoffs = [
      { dimension: "pros", assessment: "cheap and fast" },
      { dimension: "cost", assessment: "low" },
      { dimension: "time-to-market", assessment: "fast" },
    ];
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(OptionsGenerationError);
  });

  test("vague tradeoff label 'advantages' is rejected (case-insensitive)", () => {
    const g = goodResult(2);
    g.options[0]!.tradeoffs = [
      { dimension: "Advantages", assessment: "..." },
      { dimension: "cost", assessment: "low" },
      { dimension: "time-to-market", assessment: "fast" },
    ];
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(OptionsGenerationError);
  });

  test("duplicate tradeoff dimensions within one option are rejected", () => {
    const g = goodResult(2);
    g.options[0]!.tradeoffs = [
      { dimension: "cost", assessment: "low" },
      { dimension: "cost", assessment: "also low" },
      { dimension: "time-to-market", assessment: "fast" },
    ];
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(OptionsGenerationError);
  });

  test("fewer than 3 tradeoffs rejected", () => {
    const g = goodResult(2);
    g.options[0]!.tradeoffs = [
      { dimension: "cost", assessment: "low" },
      { dimension: "time-to-market", assessment: "fast" },
    ];
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("more than 6 tradeoffs rejected", () => {
    const g = goodResult(2);
    g.options[0]!.tradeoffs = [
      { dimension: "a", assessment: "..." },
      { dimension: "b", assessment: "..." },
      { dimension: "c", assessment: "..." },
      { dimension: "d", assessment: "..." },
      { dimension: "e", assessment: "..." },
      { dimension: "f", assessment: "..." },
      { dimension: "g", assessment: "..." },
    ];
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });
});

describe("parseOptionsGenerationResult — enum validation", () => {
  test("unknown time_horizon is rejected", () => {
    const g = goodResult(2);
    (g.options[0] as { time_horizon: string }).time_horizon = "eventually";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("unknown recommendation_level is rejected", () => {
    const g = goodResult(2);
    (g.options[0] as { recommendation_level: string }).recommendation_level = "maybe";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("unknown predicted_reaction in stakeholder_impact is rejected", () => {
    const g = goodResult(2);
    (g.options[0]!.stakeholder_impact[0] as { predicted_reaction: string }).predicted_reaction = "furious";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });
});

describe("parseOptionsGenerationResult — supporting_evidence", () => {
  test("missing supporting_evidence url without SOURCE_MISSING marker rejected", () => {
    const g = goodResult(2);
    (g.options[0]!.supporting_evidence as { url: unknown }).url = "";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("SOURCE_MISSING without searched_for is rejected", () => {
    const g = goodResult(2);
    g.options[0]!.supporting_evidence = {
      status: "SOURCE_MISSING",
      searched_for: "",
    } as never;
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("supporting_evidence excerpt over 500 chars is rejected", () => {
    const g = goodResult(2);
    g.options[0]!.supporting_evidence = {
      url: "https://reuters.com/x",
      title: "T",
      accessed_at: "2026-08-15T00:00:00Z",
      excerpt: "x".repeat(501),
    };
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });
});

describe("parseOptionsGenerationResult — rationale + counter_arguments", () => {
  test("empty rationale_for_recommendation is rejected", () => {
    const g = goodResult(2);
    g.rationale_for_recommendation = "";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("non-array counter_arguments_considered rejected", () => {
    const g = goodResult(2) as unknown as Record<string, unknown>;
    g.counter_arguments_considered = "single string";
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });

  test("non-array unresolved_uncertainties rejected", () => {
    const g = goodResult(2) as unknown as Record<string, unknown>;
    g.unresolved_uncertainties = null;
    expect(() =>
      parseOptionsGenerationResult(JSON.stringify(g), baseStakeholders(), baseRisks())
    ).toThrow(InvalidAgentOutputError);
  });
});
