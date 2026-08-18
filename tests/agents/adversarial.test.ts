import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  executeAdversarialCritique,
  parseAdversarialCritiqueResult,
  MAX_CRITIQUES,
  MIN_CRITIQUES,
  MIN_STEELMAN_WORDS,
} from "../../src/agents/adversarial.ts";
import {
  AdversarialCritiqueError,
  AgentExecutionError,
  InvalidAgentOutputError,
  InvalidCritiqueTargetError,
  MaxToolRoundsExceededError,
  MissingAlternativeError,
  PromptFileError,
} from "../../src/agents/errors.ts";
import { ToolUseNotSupportedError } from "../../src/llm/errors.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { CompletionResult, Tool } from "../../src/llm/types.ts";
import type {
  AdversarialContext,
  Critique,
  CritiqueSeverity,
  OptionsGenerationResult,
  ResearchResult,
  RiskAnalysisResult,
  StakeholderMapResult,
  SynthesisResult,
  ScopingResult,
} from "../../src/agents/types.ts";
import type { Format } from "../../src/registry/schema.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseFormat(): Format {
  return {
    id: "test-fmt",
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
        id: "intro",
        title: "Intro",
        purpose: "…",
        max_length: { words: 200 },
        required_agents: ["scoping"] as Format["sections"][number]["required_agents"],
        tone_directives: "n/a",
      },
      {
        id: "body",
        title: "Body",
        purpose: "…",
        max_length: { words: 400 },
        required_agents: ["synthesis"] as Format["sections"][number]["required_agents"],
        tone_directives: "n/a",
      },
    ],
    sourcing_policy: "strict",
    style_guide: { voice: "n", sentence_structure: "s", forbidden_terms: [] },
    output_targets: ["md"],
  };
}

const SRC = {
  url: "https://reuters.com/x",
  title: "T",
  accessed_at: "2026-08-15T00:00:00Z",
  excerpt: "…",
};

function stakeholders(): StakeholderMapResult {
  return {
    stakeholders: [
      {
        name: "Alpha",
        category: "decision-maker",
        interest: "…",
        position: "neutral",
        position_evidence: SRC,
        power: "high",
        priority: "critical",
        engagement_notes: "…",
      },
      {
        name: "Beta",
        category: "influencer",
        interest: "…",
        position: "neutral",
        position_evidence: SRC,
        power: "medium",
        priority: "important",
        engagement_notes: "…",
      },
    ],
    key_dynamics: ["a", "b", "c"],
    blind_spots: [],
    coverage_confidence: "medium",
  };
}

function risks(): RiskAnalysisResult {
  return {
    risks: [
      {
        id: "RISK-001",
        category: "strategic",
        description: "…",
        likelihood: "medium",
        impact: "moderate",
        likelihood_evidence: SRC,
        impact_evidence: SRC,
        affected_stakeholders: ["Alpha"],
        timeframe: "short-term",
        mitigations: ["Establish X"],
        residual_risk_after_mitigation: "low",
      },
    ],
    aggregated_risk_score: { overall: "medium", by_category: { strategic: "medium" } },
    top_3_priorities: ["RISK-001"],
    unresolved_uncertainties: [],
  };
}

function options(): OptionsGenerationResult {
  return {
    options: [
      {
        id: "OPT-A",
        title: "Do X",
        summary: "…",
        tradeoffs: [
          { dimension: "cost", assessment: "low" },
          { dimension: "time-to-market", assessment: "fast" },
          { dimension: "regulatory-exposure", assessment: "contained" },
        ],
        stakeholder_impact: [
          { stakeholder_name: "Alpha", predicted_reaction: "supportive", impact_description: "…" },
        ],
        risks_mitigated: ["RISK-001"],
        risks_introduced: [],
        dependencies: [],
        time_horizon: "short-term",
        recommendation_level: "recommended",
        supporting_evidence: SRC,
      },
      {
        id: "OPT-B",
        title: "Do Y",
        summary: "…",
        tradeoffs: [
          { dimension: "cost", assessment: "high" },
          { dimension: "time-to-market", assessment: "slow" },
          { dimension: "reversibility", assessment: "high" },
        ],
        stakeholder_impact: [
          { stakeholder_name: "Beta", predicted_reaction: "resistant", impact_description: "…" },
        ],
        risks_mitigated: [],
        risks_introduced: ["RISK-001"],
        dependencies: [],
        time_horizon: "medium-term",
        recommendation_level: "acceptable",
        supporting_evidence: SRC,
      },
    ],
    recommended_option_id: "OPT-A",
    rationale_for_recommendation: "OPT-A wins on cost and speed.",
    counter_arguments_considered: ["OPT-B set aside on cost."],
    unresolved_uncertainties: [],
  };
}

function synthesis(): SynthesisResult {
  return {
    sections: [
      {
        section_id: "intro",
        title: "Intro",
        content_markdown: "Intro text.",
        word_count: 2,
        sources_cited: [SRC],
        validation_issues: [],
      },
      {
        section_id: "body",
        title: "Body",
        content_markdown: "Body text.",
        word_count: 2,
        sources_cited: [],
        validation_issues: [],
      },
    ],
    total_word_count: 4,
    format_conformance: {
      target_words: 800,
      actual_words: 4,
      deviation_pct: -99.5,
      sections_over_length: [],
      forbidden_terms_found: [],
      failed_validation_rules: [],
    },
  };
}

function scoping(): ScopingResult {
  return {
    reformulated_question: "R?",
    hidden_questions: [],
    scope_boundaries: [],
    assumptions_to_validate: [],
  };
}

function research(): ResearchResult {
  return {
    findings: [
      { claim: "c1", supporting_evidence: "e1", source: SRC },
      { claim: "c2", supporting_evidence: "e2", source: SRC },
      { claim: "c3", supporting_evidence: "e3", source: SRC },
    ],
    open_questions: [],
    search_queries_used: [],
  };
}

const CTX_BASE: AdversarialContext = {
  brief_result: {
    scoping: scoping(),
    research: research(),
    stakeholders: stakeholders(),
    risks: risks(),
    options: options(),
    synthesis: synthesis(),
    format_id: "test-fmt",
    question: "Should we do the thing?",
  },
  format: baseFormat(),
};

// ---------------------------------------------------------------------------
// Fake LLM provider
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
    async complete() { return opts.text; },
    async completeWithTools(_prompt: string, _tools: Tool[]): Promise<CompletionResult> {
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

function makeCritique(overrides: Partial<Critique> = {}): Critique {
  return {
    id: "CRIT-001",
    category: "hidden-assumption",
    severity: "minor",
    target: { section_id: "intro" },
    steelmanned_position:
      "This is a steelmanned position with enough words to pass the minimum word count check that the parser enforces for every critique output.",
    counter_evidence: SRC,
    implication_if_true: "Something would change.",
    suggested_revision: "Adjust the section.",
    ...overrides,
  };
}

function makeResult(critiques: Critique[], alt: string | null = null): {
  critiques: Critique[];
  critical_count: number;
  material_count: number;
  minor_count: number;
  recommendation_robustness: "high" | "medium" | "low";
  revised_recommendation_needed: boolean;
  steelmanned_alternative: string | null;
} {
  const critical = critiques.filter((c) => c.severity === "critical").length;
  const material = critiques.filter((c) => c.severity === "material").length;
  const minor = critiques.filter((c) => c.severity === "minor").length;
  const revised = critical >= 1 || material >= 3;
  const robust: "high" | "medium" | "low" =
    critical >= 2 || material >= 4 ? "low" :
    critical >= 1 || material >= 2 ? "medium" : "high";
  return {
    critiques,
    critical_count: critical,
    material_count: material,
    minor_count: minor,
    recommendation_robustness: robust,
    revised_recommendation_needed: revised,
    steelmanned_alternative: revised ? (alt ?? "An alternative to consider.") : alt,
  };
}

function seq(count: number, overrideBySeverity?: CritiqueSeverity | ((i: number) => Partial<Critique>)): Critique[] {
  const out: Critique[] = [];
  for (let i = 0; i < count; i++) {
    const idPart = `CRIT-${String(i + 1).padStart(3, "0")}`;
    let overrides: Partial<Critique> = { id: idPart };
    if (typeof overrideBySeverity === "string") {
      overrides.severity = overrideBySeverity;
    } else if (typeof overrideBySeverity === "function") {
      overrides = { ...overrides, ...overrideBySeverity(i) };
    }
    out.push(makeCritique(overrides));
  }
  return out;
}

// ---------------------------------------------------------------------------
// executeAdversarialCritique — orchestration
// ---------------------------------------------------------------------------

describe("executeAdversarialCritique — provider surface", () => {
  test("throws ToolUseNotSupportedError when provider lacks completeWithTools", async () => {
    const provider: LLMProvider = { name: "no-tools", async complete() { return ""; } };
    let caught: unknown;
    try {
      await executeAdversarialCritique(CTX_BASE, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolUseNotSupportedError);
  });

  test("throws MaxToolRoundsExceededError when the loop caps out", async () => {
    const provider = fakeLLM({
      text: JSON.stringify(makeResult(seq(3, "minor"))),
      rounds: 5,
      stop_reason: "pause_turn",
    });
    let caught: unknown;
    try {
      await executeAdversarialCritique(CTX_BASE, provider, { maxToolRounds: 5 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MaxToolRoundsExceededError);
  });

  test("wraps provider errors as AgentExecutionError", async () => {
    const provider = fakeLLM({ text: "", throwErr: new Error("boom") });
    let caught: unknown;
    try {
      await executeAdversarialCritique(CTX_BASE, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AgentExecutionError);
  });

  test("succeeds on a well-formed 3-critique response", async () => {
    const provider = fakeLLM({ text: JSON.stringify(makeResult(seq(3, "minor"))) });
    const result = await executeAdversarialCritique(CTX_BASE, provider);
    expect(result.critiques).toHaveLength(3);
    expect(result.minor_count).toBe(3);
    expect(result.recommendation_robustness).toBe("high");
    expect(result.revised_recommendation_needed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt file errors
// ---------------------------------------------------------------------------

describe("executeAdversarialCritique — prompt file errors", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "praxis-adv-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test("PromptFileError when the file is missing", async () => {
    let caught: unknown;
    try {
      await executeAdversarialCritique(CTX_BASE, fakeLLM({ text: "{}" }), {
        promptPath: join(tmp, "nope.prompt"),
      });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the prompt lacks the 'adversarial' declaration", async () => {
    const p = join(tmp, "wrong.prompt");
    writeFileSync(p, `@version "1.0.0"\n@model claude-sonnet-4-5\n@description "not adversarial"\n\nprompt other() -> string {\n  system: """s"""\n  user: """u"""\n  output: string\n}\n`);
    let caught: unknown;
    try {
      await executeAdversarialCritique(CTX_BASE, fakeLLM({ text: "{}" }), { promptPath: p });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PromptFileError);
  });
});

// ---------------------------------------------------------------------------
// parseAdversarialCritiqueResult — happy path
// ---------------------------------------------------------------------------

describe("parseAdversarialCritiqueResult — happy path", () => {
  test("parses a clean 3-minor result", () => {
    const parsed = parseAdversarialCritiqueResult(
      JSON.stringify(makeResult(seq(3, "minor"))),
      CTX_BASE
    );
    expect(parsed.critiques).toHaveLength(3);
    expect(parsed.critical_count).toBe(0);
    expect(parsed.material_count).toBe(0);
    expect(parsed.minor_count).toBe(3);
    expect(parsed.recommendation_robustness).toBe("high");
    expect(parsed.revised_recommendation_needed).toBe(false);
    expect(parsed.steelmanned_alternative).toBeNull();
  });

  test("accepts up to MAX_CRITIQUES critiques", () => {
    const parsed = parseAdversarialCritiqueResult(
      JSON.stringify(makeResult(seq(MAX_CRITIQUES, "minor"))),
      CTX_BASE
    );
    expect(parsed.critiques).toHaveLength(MAX_CRITIQUES);
  });

  test("accepts SOURCE_MISSING as counter_evidence", () => {
    const c = seq(3, "minor");
    c[0]!.counter_evidence = { status: "SOURCE_MISSING", searched_for: "no evidence found" };
    const parsed = parseAdversarialCritiqueResult(
      JSON.stringify(makeResult(c)),
      CTX_BASE
    );
    expect(parsed.critiques[0]!.counter_evidence).toEqual({
      status: "SOURCE_MISSING",
      searched_for: "no evidence found",
    });
  });

  test("strips JSON code fences", () => {
    const raw = "```json\n" + JSON.stringify(makeResult(seq(3, "minor"))) + "\n```";
    const parsed = parseAdversarialCritiqueResult(raw, CTX_BASE);
    expect(parsed.critiques).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Count bounds
// ---------------------------------------------------------------------------

describe("parseAdversarialCritiqueResult — count bounds", () => {
  test("fewer than MIN_CRITIQUES is rejected", () => {
    expect(MIN_CRITIQUES).toBe(3);
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(seq(2, "minor"))), CTX_BASE)
    ).toThrow(AdversarialCritiqueError);
  });

  test("more than MAX_CRITIQUES is rejected", () => {
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(seq(MAX_CRITIQUES + 1, "minor"))), CTX_BASE)
    ).toThrow(AdversarialCritiqueError);
  });
});

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

describe("parseAdversarialCritiqueResult — id discipline", () => {
  test("non-sequential ids rejected", () => {
    const c = seq(3, "minor");
    c[1]!.id = "CRIT-005";
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(AdversarialCritiqueError);
  });

  test("duplicate ids rejected", () => {
    const c = seq(3, "minor");
    c[1]!.id = "CRIT-001";
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(AdversarialCritiqueError);
  });
});

// ---------------------------------------------------------------------------
// Steelman word count
// ---------------------------------------------------------------------------

describe("parseAdversarialCritiqueResult — steelman word count", () => {
  test("steelmanned_position under MIN_STEELMAN_WORDS is rejected", () => {
    const c = seq(3, "minor");
    c[0]!.steelmanned_position = "Too short.";
    let caught: unknown;
    try {
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE);
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(AdversarialCritiqueError);
    if (caught instanceof AdversarialCritiqueError) {
      expect(caught.message).toContain("words");
    }
  });

  test("MIN_STEELMAN_WORDS is 20", () => {
    expect(MIN_STEELMAN_WORDS).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

describe("parseAdversarialCritiqueResult — target validation", () => {
  test("empty target rejected", () => {
    const c = seq(3, "minor");
    c[0]!.target = {};
    let caught: unknown;
    try {
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE);
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(InvalidCritiqueTargetError);
    if (caught instanceof InvalidCritiqueTargetError) {
      expect(caught.reason).toContain("empty");
    }
  });

  test("unknown section_id rejected", () => {
    const c = seq(3, "minor");
    c[0]!.target = { section_id: "does-not-exist" };
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(InvalidCritiqueTargetError);
  });

  test("unknown option_id rejected", () => {
    const c = seq(3, "minor");
    c[0]!.target = { option_id: "OPT-Z" };
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(InvalidCritiqueTargetError);
  });

  test("unknown risk_id rejected", () => {
    const c = seq(3, "minor");
    c[0]!.target = { risk_id: "RISK-999" };
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(InvalidCritiqueTargetError);
  });

  test("unknown stakeholder_name rejected", () => {
    const c = seq(3, "minor");
    c[0]!.target = { stakeholder_name: "Ghost" };
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(InvalidCritiqueTargetError);
  });

  test("out-of-range finding_index rejected", () => {
    const c = seq(3, "minor");
    c[0]!.target = { finding_index: 99 };
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(InvalidCritiqueTargetError);
  });

  test("multiple valid target fields are accepted", () => {
    const c = seq(3, "minor");
    c[0]!.target = { section_id: "intro", option_id: "OPT-A", risk_id: "RISK-001" };
    const parsed = parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE);
    expect(parsed.critiques[0]!.target.section_id).toBe("intro");
    expect(parsed.critiques[0]!.target.option_id).toBe("OPT-A");
    expect(parsed.critiques[0]!.target.risk_id).toBe("RISK-001");
  });
});

// ---------------------------------------------------------------------------
// Severity aggregation + revision derivation
// ---------------------------------------------------------------------------

describe("parseAdversarialCritiqueResult — severity aggregation", () => {
  test("one critical → revised_recommendation_needed=true", () => {
    const c = seq(3, (i) => (i === 0 ? { severity: "critical" as const } : { severity: "minor" as const }));
    const parsed = parseAdversarialCritiqueResult(
      JSON.stringify(makeResult(c, "The alternative.")),
      CTX_BASE
    );
    expect(parsed.critical_count).toBe(1);
    expect(parsed.revised_recommendation_needed).toBe(true);
    expect(parsed.steelmanned_alternative).toBe("The alternative.");
  });

  test("three material → revised_recommendation_needed=true", () => {
    const c = seq(3, "material");
    const parsed = parseAdversarialCritiqueResult(
      JSON.stringify(makeResult(c, "The alternative.")),
      CTX_BASE
    );
    expect(parsed.material_count).toBe(3);
    expect(parsed.revised_recommendation_needed).toBe(true);
  });

  test("two material + zero critical → revised NOT needed", () => {
    const c = seq(3, (i) => (i < 2 ? { severity: "material" as const } : { severity: "minor" as const }));
    const parsed = parseAdversarialCritiqueResult(
      JSON.stringify(makeResult(c)),
      CTX_BASE
    );
    expect(parsed.revised_recommendation_needed).toBe(false);
  });

  test("robustness=low when 2 critical", () => {
    const c = seq(3, (i) => (i < 2 ? { severity: "critical" as const } : { severity: "minor" as const }));
    const parsed = parseAdversarialCritiqueResult(
      JSON.stringify(makeResult(c, "alt")),
      CTX_BASE
    );
    expect(parsed.recommendation_robustness).toBe("low");
  });

  test("robustness=medium when 1 critical", () => {
    const c = seq(3, (i) => (i === 0 ? { severity: "critical" as const } : { severity: "minor" as const }));
    const parsed = parseAdversarialCritiqueResult(
      JSON.stringify(makeResult(c, "alt")),
      CTX_BASE
    );
    expect(parsed.recommendation_robustness).toBe("medium");
  });

  test("revision needed but missing alternative → MissingAlternativeError", () => {
    const c = seq(3, (i) => (i === 0 ? { severity: "critical" as const } : { severity: "minor" as const }));
    const bad = makeResult(c);
    bad.steelmanned_alternative = null;
    let caught: unknown;
    try {
      parseAdversarialCritiqueResult(JSON.stringify(bad), CTX_BASE);
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(MissingAlternativeError);
  });

  test("model reports wrong critical_count → error", () => {
    const c = seq(3, "minor");
    const bad = makeResult(c);
    bad.critical_count = 5;
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(bad), CTX_BASE)
    ).toThrow(AdversarialCritiqueError);
  });

  test("model reports wrong revised_recommendation_needed → error", () => {
    const c = seq(3, "minor");
    const bad = makeResult(c);
    bad.revised_recommendation_needed = true;
    bad.steelmanned_alternative = "wrong signal";
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(bad), CTX_BASE)
    ).toThrow(AdversarialCritiqueError);
  });
});

// ---------------------------------------------------------------------------
// Structural errors
// ---------------------------------------------------------------------------

describe("parseAdversarialCritiqueResult — structural errors", () => {
  test("empty response rejected", () => {
    expect(() => parseAdversarialCritiqueResult("", CTX_BASE)).toThrow(InvalidAgentOutputError);
  });

  test("invalid JSON rejected", () => {
    expect(() => parseAdversarialCritiqueResult("not json", CTX_BASE)).toThrow(InvalidAgentOutputError);
  });

  test("top-level array rejected", () => {
    expect(() => parseAdversarialCritiqueResult("[]", CTX_BASE)).toThrow(InvalidAgentOutputError);
  });

  test("missing critiques array rejected", () => {
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify({ revised_recommendation_needed: false }), CTX_BASE)
    ).toThrow(InvalidAgentOutputError);
  });

  test("missing revised_recommendation_needed rejected", () => {
    const bad = makeResult(seq(3, "minor")) as unknown as Record<string, unknown>;
    delete bad.revised_recommendation_needed;
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(bad), CTX_BASE)
    ).toThrow(InvalidAgentOutputError);
  });

  test("unknown category rejected", () => {
    const c = seq(3, "minor");
    (c[0] as { category: string }).category = "existential-dread";
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(InvalidAgentOutputError);
  });

  test("unknown severity rejected", () => {
    const c = seq(3, "minor");
    (c[0] as { severity: string }).severity = "catastrophic";
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(InvalidAgentOutputError);
  });

  test("counter_evidence with empty url and no SOURCE_MISSING marker rejected", () => {
    const c = seq(3, "minor");
    (c[0]!.counter_evidence as { url: string }).url = "";
    expect(() =>
      parseAdversarialCritiqueResult(JSON.stringify(makeResult(c)), CTX_BASE)
    ).toThrow(InvalidAgentOutputError);
  });
});
