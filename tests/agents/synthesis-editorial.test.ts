/**
 * v0.8 — Synthesis strict_editorial retry loop + revision mode tests.
 *
 * These exercise the two new Phase 4 capabilities in isolation from
 * the orchestrator:
 *
 *   1. strict_editorial: false → v0.7 behaviour verbatim (one attempt,
 *      empty attempt history, final_attempt_number: 1).
 *   2. strict_editorial: true → per-axis reject/warn actions, up to
 *      `max_regeneration_attempts` total LLM calls per section, with
 *      EditorialAttempt entries populated. EditorialFailureError on
 *      exhaustion.
 *   3. revision_context → REVISION MODE prompt block is present when
 *      the SynthesisContext carries one, absent otherwise.
 */
import { describe, expect, test } from "bun:test";

import { executeSynthesis } from "../../src/agents/synthesis.ts";
import { EditorialFailureError } from "../../src/agents/errors.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { CompletionResult, Tool } from "../../src/llm/types.ts";
import type {
  AdversarialCritiqueResult,
  Critique,
  OptionsGenerationResult,
  RiskAnalysisResult,
  StakeholderMapResult,
  SynthesisContext,
  SynthesisResult,
} from "../../src/agents/types.ts";
import type { Format } from "../../src/registry/schema.ts";

// ---------------------------------------------------------------------------
// Common fixtures (kept small — only what the editorial gate needs).
// ---------------------------------------------------------------------------

const SOURCE_A = {
  url: "https://reuters.com/precedent-a",
  title: "Precedent A",
  accessed_at: "2026-08-15T00:00:00Z",
  excerpt: "…",
};
const SOURCE_B = {
  url: "https://reuters.com/precedent-b",
  title: "Precedent B",
  accessed_at: "2026-08-15T00:00:00Z",
  excerpt: "…",
};

function baseStakeholders(): StakeholderMapResult {
  return {
    stakeholders: [
      {
        name: "Board",
        category: "decision-maker",
        interest: "…",
        position: "neutral",
        position_evidence: SOURCE_A,
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
        description: "A risk.",
        likelihood: "medium",
        impact: "moderate",
        likelihood_evidence: SOURCE_B,
        impact_evidence: SOURCE_A,
        affected_stakeholders: ["Board"],
        timeframe: "short-term",
        mitigations: ["Do X"],
        residual_risk_after_mitigation: "low",
      },
    ],
    aggregated_risk_score: {
      overall: "medium",
      by_category: { strategic: "medium" },
    },
    top_3_priorities: ["RISK-001"],
    unresolved_uncertainties: [],
  };
}

function baseOptions(): OptionsGenerationResult {
  return {
    options: [
      {
        id: "OPT-A",
        title: "Do it",
        summary: "A summary.",
        tradeoffs: [
          { dimension: "cost", assessment: "low" },
          { dimension: "time-to-market", assessment: "fast" },
          { dimension: "regulatory-exposure", assessment: "contained" },
        ],
        stakeholder_impact: [
          { stakeholder_name: "Board", predicted_reaction: "supportive", impact_description: "…" },
        ],
        risks_mitigated: ["RISK-001"],
        risks_introduced: [],
        dependencies: [],
        time_horizon: "short-term",
        recommendation_level: "recommended",
        supporting_evidence: SOURCE_A,
      },
      {
        id: "OPT-B",
        title: "Alt",
        summary: "…",
        tradeoffs: [
          { dimension: "cost", assessment: "high" },
          { dimension: "time-to-market", assessment: "slow" },
          { dimension: "regulatory-exposure", assessment: "moderate" },
        ],
        stakeholder_impact: [
          { stakeholder_name: "Board", predicted_reaction: "resistant", impact_description: "…" },
        ],
        risks_mitigated: [],
        risks_introduced: ["RISK-001"],
        dependencies: [],
        time_horizon: "medium-term",
        recommendation_level: "acceptable",
        supporting_evidence: SOURCE_B,
      },
    ],
    recommended_option_id: "OPT-A",
    rationale_for_recommendation: "…",
    counter_arguments_considered: ["OPT-B set aside on cost"],
    unresolved_uncertainties: [],
  };
}

function makeFormat(overrides: Partial<Format> = {}): Format {
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
    target_length: { pages: 1, words: 300 },
    sections: [
      {
        id: "intro",
        title: "Intro",
        purpose: "Set the stage.",
        max_length: { words: 40 },
        required_agents: ["scoping", "research"] as Format["sections"][number]["required_agents"],
        tone_directives: "neutral",
      },
    ],
    sourcing_policy: "strict",
    style_guide: {
      voice: "authoritative",
      sentence_structure: "short declarative",
      forbidden_terms: ["obviously", "clearly"],
    },
    output_targets: ["md"],
    ...overrides,
  };
}

const CTX_BASE: Omit<SynthesisContext, "format"> = {
  scoping: {
    reformulated_question: "Q?",
    hidden_questions: [],
    scope_boundaries: [],
    assumptions_to_validate: [],
  },
  research: {
    findings: [
      { claim: "c", supporting_evidence: "e", source: SOURCE_A },
      { claim: "c2", supporting_evidence: "e2", source: SOURCE_B },
    ],
    open_questions: [],
    search_queries_used: [],
  },
  stakeholders: baseStakeholders(),
  risks: baseRisks(),
  options: baseOptions(),
};

// ---------------------------------------------------------------------------
// Programmable LLM with attempt tracking. Returns different responses on
// successive calls for the same section, and captures prompts for later
// assertions.
// ---------------------------------------------------------------------------

interface AttemptSpec {
  content_markdown: string;
  sources_cited?: unknown[];
  validation_issues?: string[];
}

interface SequencedLLM extends LLMProvider {
  readonly prompts: string[];
  readonly callCounts: Record<string, number>;
}

function sequencedLLM(perSection: Record<string, AttemptSpec[]>): SequencedLLM {
  const prompts: string[] = [];
  const callCounts: Record<string, number> = {};

  const complete = async (prompt: string): Promise<string> => {
    prompts.push(prompt);
    const entry = Object.entries(perSection).find(([sid]) =>
      prompt.includes(`Synthesize section '${sid}'`)
    );
    if (entry === undefined) {
      throw new Error(
        `sequencedLLM: no scripted responses for the prompt (sections: ${Object.keys(perSection).join(", ")})`
      );
    }
    const [sid, attempts] = entry;
    const idx = callCounts[sid] ?? 0;
    callCounts[sid] = idx + 1;
    if (idx >= attempts.length) {
      throw new Error(
        `sequencedLLM: section '${sid}' called ${idx + 1} times, only ${attempts.length} responses scripted`
      );
    }
    const spec = attempts[idx]!;
    return JSON.stringify({
      content_markdown: spec.content_markdown,
      sources_cited: spec.sources_cited ?? [],
      validation_issues: spec.validation_issues ?? [],
    });
  };

  return {
    name: "sequenced",
    complete,
    async completeWithTools(prompt: string, _tools: Tool[]): Promise<CompletionResult> {
      return {
        text: await complete(prompt),
        tool_calls: [],
        rounds: 1,
        stop_reason: "end_turn",
      };
    },
    prompts,
    callCounts,
  };
}

// ---------------------------------------------------------------------------
// strict_editorial: false → v0.7 behaviour preserved.
// ---------------------------------------------------------------------------

describe("executeSynthesis — strict_editorial: false (default v0.7 behaviour)", () => {
  test("no editorial block → 1 attempt, empty attempts array, final=1", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const llm = sequencedLLM({
      intro: [{ content_markdown: "Obviously a warning-only run." }],
    });
    const result = await executeSynthesis(ctx, llm);
    expect(llm.callCounts["intro"]).toBe(1);
    const sec = result.sections[0]!;
    expect(sec.editorial_attempts).toEqual([]);
    expect(sec.final_attempt_number).toBe(1);
    // Forbidden term still surfaces as validation_issues (soft warning).
    expect(sec.validation_issues.some((i) => i.includes("obviously"))).toBe(true);
  });

  test("strict_editorial: false collapses reject actions to warn", async () => {
    const fmt = makeFormat({
      sourcing_rules: {
        editorial: {
          strict_editorial: false,
          forbidden_terms_action: "reject", // ignored — master switch off
          max_regeneration_attempts: 3,
        },
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format: fmt };
    const llm = sequencedLLM({
      intro: [{ content_markdown: "Obviously bad." }],
    });
    const result = await executeSynthesis(ctx, llm);
    // Single attempt — reject action was overridden by master-switch off.
    expect(llm.callCounts["intro"]).toBe(1);
    expect(result.sections[0]!.editorial_attempts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// strict_editorial: true + forbidden_terms_action: reject
// ---------------------------------------------------------------------------

describe("executeSynthesis — strict_editorial forbidden_terms retry", () => {
  test("first attempt clean → accepted immediately with attempts=[accepted]", async () => {
    const fmt = makeFormat({
      sourcing_rules: {
        editorial: {
          strict_editorial: true,
          forbidden_terms_action: "reject",
          max_regeneration_attempts: 2,
        },
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format: fmt };
    const llm = sequencedLLM({
      intro: [{ content_markdown: "A clean, terse intro." }],
    });
    const result = await executeSynthesis(ctx, llm);
    const sec = result.sections[0]!;
    expect(llm.callCounts["intro"]).toBe(1);
    expect(sec.editorial_attempts).toHaveLength(1);
    expect(sec.editorial_attempts[0]!.accepted).toBe(true);
    expect(sec.editorial_attempts[0]!.reason).toBe("accepted");
    expect(sec.final_attempt_number).toBe(1);
  });

  test("first attempt fails, retry succeeds → attempts=[reject, accepted], final=2", async () => {
    const fmt = makeFormat({
      sourcing_rules: {
        editorial: {
          strict_editorial: true,
          forbidden_terms_action: "reject",
          max_regeneration_attempts: 2,
        },
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format: fmt };
    const llm = sequencedLLM({
      intro: [
        { content_markdown: "Obviously bad first attempt." },
        { content_markdown: "A clean second attempt." },
      ],
    });
    const result = await executeSynthesis(ctx, llm);
    const sec = result.sections[0]!;
    expect(llm.callCounts["intro"]).toBe(2);
    expect(sec.editorial_attempts).toHaveLength(2);
    expect(sec.editorial_attempts[0]!.accepted).toBe(false);
    expect(sec.editorial_attempts[0]!.reason).toBe("forbidden_terms");
    expect(sec.editorial_attempts[0]!.details).toContain("obviously");
    expect(sec.editorial_attempts[1]!.accepted).toBe(true);
    expect(sec.final_attempt_number).toBe(2);
    expect(sec.content_markdown).toBe("A clean second attempt.");
  });

  test("all attempts fail → EditorialFailureError with full history", async () => {
    const fmt = makeFormat({
      sourcing_rules: {
        editorial: {
          strict_editorial: true,
          forbidden_terms_action: "reject",
          max_regeneration_attempts: 2,
        },
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format: fmt };
    const llm = sequencedLLM({
      intro: [
        { content_markdown: "Obviously bad first." },
        { content_markdown: "Clearly bad second." },
      ],
    });
    let caught: unknown;
    try {
      await executeSynthesis(ctx, llm);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EditorialFailureError);
    if (caught instanceof EditorialFailureError) {
      expect(caught.sectionId).toBe("intro");
      expect(caught.reason).toBe("forbidden_terms");
      expect(caught.attempts).toHaveLength(2);
      expect(caught.attempts[0]!.accepted).toBe(false);
      expect(caught.attempts[1]!.accepted).toBe(false);
      expect(caught.attempts[0]!.details).toContain("obviously");
      expect(caught.attempts[1]!.details).toContain("clearly");
    }
    expect(llm.callCounts["intro"]).toBe(2);
  });

  test("second attempt prompt contains STRICT EDITORIAL RETRY block", async () => {
    const fmt = makeFormat({
      sourcing_rules: {
        editorial: {
          strict_editorial: true,
          forbidden_terms_action: "reject",
          max_regeneration_attempts: 2,
        },
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format: fmt };
    const llm = sequencedLLM({
      intro: [
        { content_markdown: "Obviously bad first." },
        { content_markdown: "A clean second attempt." },
      ],
    });
    await executeSynthesis(ctx, llm);
    expect(llm.prompts).toHaveLength(2);
    // The FIRST attempt has no retry block.
    expect(llm.prompts[0]!).not.toContain("STRICT EDITORIAL RETRY");
    // The SECOND attempt embeds the retry block naming the reason + details.
    expect(llm.prompts[1]!).toContain("STRICT EDITORIAL RETRY");
    expect(llm.prompts[1]!).toContain("forbidden_terms");
    expect(llm.prompts[1]!).toContain("obviously");
  });
});

// ---------------------------------------------------------------------------
// strict_editorial: over_length_action: reject
// ---------------------------------------------------------------------------

describe("executeSynthesis — strict_editorial over_length retry", () => {
  test("over-length section is rejected then retried within cap", async () => {
    const fmt = makeFormat({
      sections: [
        {
          id: "intro",
          title: "Intro",
          purpose: "…",
          max_length: { words: 10 }, // cap: 10, with 10% tolerance → 11 words hard.
          required_agents: ["scoping"] as Format["sections"][number]["required_agents"],
          tone_directives: "…",
        },
      ],
      sourcing_rules: {
        editorial: {
          strict_editorial: true,
          over_length_action: "reject",
          max_regeneration_attempts: 2,
        },
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format: fmt };
    const llm = sequencedLLM({
      intro: [
        // 20 words — over the 10-word cap.
        {
          content_markdown:
            "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty",
        },
        // 6 words — under.
        { content_markdown: "six words fit under the cap" },
      ],
    });
    const result = await executeSynthesis(ctx, llm);
    const sec = result.sections[0]!;
    expect(llm.callCounts["intro"]).toBe(2);
    expect(sec.editorial_attempts).toHaveLength(2);
    expect(sec.editorial_attempts[0]!.reason).toBe("over_length");
    expect(sec.editorial_attempts[0]!.details).toContain("20 words");
    expect(sec.editorial_attempts[1]!.accepted).toBe(true);
    expect(sec.final_attempt_number).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// strict_editorial: validation_rules_action: reject
// ---------------------------------------------------------------------------

describe("executeSynthesis — strict_editorial validation_rules retry", () => {
  test("agent-acknowledged unmet rule → reject → retry", async () => {
    const fmt = makeFormat({
      sections: [
        {
          id: "intro",
          title: "Intro",
          purpose: "…",
          max_length: { words: 40 },
          required_agents: ["scoping"] as Format["sections"][number]["required_agents"],
          tone_directives: "…",
          validation_rules: ["must_name_owner: true"],
        },
      ],
      sourcing_rules: {
        editorial: {
          strict_editorial: true,
          validation_rules_action: "reject",
          max_regeneration_attempts: 2,
        },
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format: fmt };
    const llm = sequencedLLM({
      intro: [
        {
          content_markdown: "An intro with no explicit owner.",
          validation_issues: ["must_name_owner: no owner named in evidence"],
        },
        {
          content_markdown: "An intro naming the Board as owner.",
          validation_issues: [],
        },
      ],
    });
    const result = await executeSynthesis(ctx, llm);
    const sec = result.sections[0]!;
    expect(llm.callCounts["intro"]).toBe(2);
    expect(sec.editorial_attempts[0]!.reason).toBe("validation_rule");
    expect(sec.editorial_attempts[0]!.details).toContain("must_name_owner");
    expect(sec.editorial_attempts[1]!.accepted).toBe(true);
    expect(sec.final_attempt_number).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Order of rejection reasons — forbidden_terms wins over over_length.
// ---------------------------------------------------------------------------

describe("executeSynthesis — strict_editorial reason precedence", () => {
  test("both forbidden AND over-length failing → forbidden_terms reported first", async () => {
    const fmt = makeFormat({
      sections: [
        {
          id: "intro",
          title: "Intro",
          purpose: "…",
          max_length: { words: 5 },
          required_agents: ["scoping"] as Format["sections"][number]["required_agents"],
          tone_directives: "…",
        },
      ],
      sourcing_rules: {
        editorial: {
          strict_editorial: true,
          forbidden_terms_action: "reject",
          over_length_action: "reject",
          max_regeneration_attempts: 1,
        },
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format: fmt };
    const llm = sequencedLLM({
      intro: [
        {
          content_markdown:
            "Obviously this is going way over the five word cap.",
        },
      ],
    });
    let caught: unknown;
    try {
      await executeSynthesis(ctx, llm);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EditorialFailureError);
    if (caught instanceof EditorialFailureError) {
      expect(caught.reason).toBe("forbidden_terms");
      expect(caught.attempts).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// max_regeneration_attempts = 1 → single attempt, no retries.
// ---------------------------------------------------------------------------

describe("executeSynthesis — max_regeneration_attempts=1 short-circuit", () => {
  test("single attempt only; failure → EditorialFailureError immediately", async () => {
    const fmt = makeFormat({
      sourcing_rules: {
        editorial: {
          strict_editorial: true,
          forbidden_terms_action: "reject",
          max_regeneration_attempts: 1,
        },
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format: fmt };
    const llm = sequencedLLM({
      intro: [{ content_markdown: "Obviously." }],
    });
    let caught: unknown;
    try {
      await executeSynthesis(ctx, llm);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EditorialFailureError);
    expect(llm.callCounts["intro"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Revision mode — SynthesisContext.revision_context propagates into prompt.
// ---------------------------------------------------------------------------

function makeAdversarial(): AdversarialCritiqueResult {
  const critique: Critique = {
    id: "CRIT-001",
    category: "hidden-assumption",
    severity: "critical",
    target: { section_id: "intro" },
    steelmanned_position:
      "A well-reasoned counter-argument long enough to pass the 20-word threshold enforced by the adversarial parser.",
    counter_evidence: SOURCE_A,
    implication_if_true: "Recommendation should shift.",
    suggested_revision: "Add a hedge in the intro.",
  };
  return {
    critiques: [critique],
    critical_count: 1,
    material_count: 0,
    minor_count: 0,
    recommendation_robustness: "medium",
    revised_recommendation_needed: true,
    steelmanned_alternative: "Consider alternative Y.",
  };
}

function makeSynthesis(): SynthesisResult {
  return {
    sections: [
      {
        section_id: "intro",
        title: "Intro",
        content_markdown: "old intro",
        word_count: 2,
        sources_cited: [],
        validation_issues: [],
        editorial_attempts: [],
        final_attempt_number: 1,
      },
    ],
    total_word_count: 2,
    format_conformance: {
      target_words: 300,
      actual_words: 2,
      deviation_pct: 0,
      sections_over_length: [],
      forbidden_terms_found: [],
      failed_validation_rules: [],
    },
  };
}

describe("executeSynthesis — revision mode", () => {
  test("no revision_context → prompt has no REVISION MODE block", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const llm = sequencedLLM({
      intro: [{ content_markdown: "Some intro text." }],
    });
    await executeSynthesis(ctx, llm);
    expect(llm.prompts[0]!).not.toContain("REVISION MODE");
  });

  test("revision_context set → prompt contains REVISION MODE + critique text", async () => {
    const adversarial = makeAdversarial();
    const ctx: SynthesisContext = {
      ...CTX_BASE,
      format: makeFormat(),
      revision_context: {
        original_synthesis: makeSynthesis(),
        adversarial,
        critiques_to_address: adversarial.critiques,
        steelmanned_alternative: adversarial.steelmanned_alternative,
        instruction: "revise sections and align recommendation",
      },
    };
    const llm = sequencedLLM({
      intro: [{ content_markdown: "A revised intro." }],
    });
    await executeSynthesis(ctx, llm);
    const p = llm.prompts[0]!;
    expect(p).toContain("REVISION MODE");
    expect(p).toContain("CRIT-001");
    expect(p).toContain("Consider alternative Y.");
    expect(p).toContain("revise sections and align recommendation");
    expect(p).toContain("suggested_revision: Add a hedge in the intro.");
  });

  test("revision_context with critique targeting a DIFFERENT section shows the align-only message", async () => {
    const adversarial = makeAdversarial();
    // Rewrite the critique to target a section that isn't in this format.
    adversarial.critiques[0]!.target = { section_id: "recommendation" };
    const fmt = makeFormat();
    const ctx: SynthesisContext = {
      ...CTX_BASE,
      format: fmt,
      revision_context: {
        original_synthesis: makeSynthesis(),
        adversarial,
        critiques_to_address: adversarial.critiques,
        steelmanned_alternative: adversarial.steelmanned_alternative,
        instruction: "revise",
      },
    };
    const llm = sequencedLLM({
      intro: [{ content_markdown: "A revised intro." }],
    });
    await executeSynthesis(ctx, llm);
    const p = llm.prompts[0]!;
    expect(p).toContain("REVISION MODE");
    expect(p).toContain("no critiques targeted at this section");
    // The CRIT-001 line MUST NOT appear (it targets a different section).
    expect(p).not.toContain("CRIT-001");
  });

  test("revision_context with unscoped critique (no target.section_id) applies to every section", async () => {
    const adversarial = makeAdversarial();
    adversarial.critiques[0]!.target = { option_id: "OPT-A" }; // no section_id set
    const ctx: SynthesisContext = {
      ...CTX_BASE,
      format: makeFormat(),
      revision_context: {
        original_synthesis: makeSynthesis(),
        adversarial,
        critiques_to_address: adversarial.critiques,
        steelmanned_alternative: adversarial.steelmanned_alternative,
        instruction: "revise",
      },
    };
    const llm = sequencedLLM({
      intro: [{ content_markdown: "A revised intro." }],
    });
    await executeSynthesis(ctx, llm);
    expect(llm.prompts[0]!).toContain("CRIT-001");
  });
});
