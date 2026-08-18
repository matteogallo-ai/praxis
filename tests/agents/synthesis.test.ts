import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  executeSynthesis,
  countWords,
} from "../../src/agents/synthesis.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
  SynthesisError,
} from "../../src/agents/errors.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { CompletionResult, Tool } from "../../src/llm/types.ts";
import type {
  OptionsGenerationResult,
  RiskAnalysisResult,
  StakeholderMapResult,
  SynthesisContext,
} from "../../src/agents/types.ts";
import type { Format } from "../../src/registry/schema.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function knownUrl(u: string): string {
  return u;
}

const SOURCE_A = {
  url: knownUrl("https://reuters.com/precedent-a"),
  title: "Precedent A",
  accessed_at: "2026-08-15T00:00:00Z",
  excerpt: "…",
};
const SOURCE_B = {
  url: knownUrl("https://reuters.com/precedent-b"),
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
        title: "Do the thing",
        summary: "A summary of the recommended option.",
        tradeoffs: [
          { dimension: "cost", assessment: "low" },
          { dimension: "time-to-market", assessment: "fast" },
          { dimension: "regulatory-exposure", assessment: "contained" },
        ],
        stakeholder_impact: [
          {
            stakeholder_name: "Board",
            predicted_reaction: "supportive",
            impact_description: "…",
          },
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
        title: "Do the other thing",
        summary: "Alternative summary.",
        tradeoffs: [
          { dimension: "cost", assessment: "high" },
          { dimension: "time-to-market", assessment: "slow" },
          { dimension: "regulatory-exposure", assessment: "moderate" },
        ],
        stakeholder_impact: [
          {
            stakeholder_name: "Board",
            predicted_reaction: "resistant",
            impact_description: "…",
          },
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
    rationale_for_recommendation: "OPT-A wins on cost and time.",
    counter_arguments_considered: ["OPT-B was set aside on cost."],
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
        max_length: { words: 100 },
        required_agents: ["scoping", "research"] as Format["sections"][number]["required_agents"],
        tone_directives: "neutral, third-person",
      },
      {
        id: "body",
        title: "Body",
        purpose: "Argue the recommendation.",
        max_length: { words: 200 },
        required_agents: ["options", "risk"] as Format["sections"][number]["required_agents"],
        tone_directives: "authoritative, imperative",
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
// Programmable per-section LLM provider (returns different responses
// based on the section id in the prompt).
// ---------------------------------------------------------------------------

interface SectionResponseSpec {
  content_markdown: string;
  sources_cited?: unknown[];
  validation_issues?: string[];
}

function fakeLLM(bySection: Record<string, SectionResponseSpec>): LLMProvider {
  return {
    name: "fake",
    async complete(prompt: string): Promise<string> {
      const found = Object.entries(bySection).find(([sid]) =>
        prompt.includes(`Synthesize section '${sid}'`)
      );
      if (!found) {
        throw new Error(
          `fakeLLM: no scripted response for the prompt (sections: ${Object.keys(bySection).join(", ")})`
        );
      }
      const spec = found[1];
      return JSON.stringify({
        content_markdown: spec.content_markdown,
        sources_cited: spec.sources_cited ?? [],
        validation_issues: spec.validation_issues ?? [],
      });
    },
    async completeWithTools(
      prompt: string,
      _tools: Tool[]
    ): Promise<CompletionResult> {
      return {
        text: await this.complete!(prompt),
        tool_calls: [],
        rounds: 1,
        stop_reason: "end_turn",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// countWords helper
// ---------------------------------------------------------------------------

describe("countWords", () => {
  test("counts words in a plain paragraph", () => {
    expect(countWords("one two three four five")).toBe(5);
  });

  test("strips markdown code fences from the count", () => {
    const md = "prose here\n```ts\nconst x = 1;\n```\nmore prose";
    expect(countWords(md)).toBe(4);
  });

  test("strips inline backticks", () => {
    expect(countWords("call `foo()` on the object")).toBe(4);
  });

  test("returns 0 for an empty string", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n   ")).toBe(0);
  });

  test("strips markdown bullets and heading markers before counting", () => {
    expect(countWords("- alpha\n- beta\n- gamma")).toBe(3);
    expect(countWords("# heading with words")).toBe(3);
  });

  test("collapses multiple spaces and tabs", () => {
    expect(countWords("one   two\t\tthree")).toBe(3);
  });

  test("counts words spanning newlines", () => {
    expect(countWords("line one\nline two\nline three")).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// executeSynthesis — happy path
// ---------------------------------------------------------------------------

describe("executeSynthesis — happy path", () => {
  test("produces one SynthesizedSection per format section in declared order", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider = fakeLLM({
      intro: { content_markdown: "The intro paragraph." },
      body: { content_markdown: "The body paragraph." },
    });
    const result = await executeSynthesis(ctx, provider);
    expect(result.sections.map((s) => s.section_id)).toEqual(["intro", "body"]);
    expect(result.sections[0]!.title).toBe("Intro");
    expect(result.sections[1]!.title).toBe("Body");
    expect(result.sections[0]!.content_markdown).toBe("The intro paragraph.");
    expect(result.total_word_count).toBe(
      result.sections[0]!.word_count + result.sections[1]!.word_count
    );
  });

  test("carries sources_cited from the LLM response", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider = fakeLLM({
      intro: {
        content_markdown: "Sourced claim.",
        sources_cited: [SOURCE_A],
      },
      body: {
        content_markdown: "Another sourced claim.",
        sources_cited: [SOURCE_B, SOURCE_A],
      },
    });
    const result = await executeSynthesis(ctx, provider);
    expect(result.sections[0]!.sources_cited).toEqual([SOURCE_A]);
    expect(result.sections[1]!.sources_cited).toEqual([SOURCE_B, SOURCE_A]);
  });

  test("format_conformance reconciles totals", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider = fakeLLM({
      intro: { content_markdown: "One two three." },
      body: { content_markdown: "One two three four." },
    });
    const result = await executeSynthesis(ctx, provider);
    expect(result.format_conformance.target_words).toBe(300);
    expect(result.format_conformance.actual_words).toBe(result.total_word_count);
    expect(result.format_conformance.sections_over_length).toEqual([]);
    expect(result.format_conformance.forbidden_terms_found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// executeSynthesis — no-invention rule
// ---------------------------------------------------------------------------

describe("executeSynthesis — no-invention rule", () => {
  test("rejects a cited source whose url is not in any upstream artefact", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const fakeSource = {
      url: "https://never-cited.example",
      title: "Nope",
      accessed_at: "2026-08-15T00:00:00Z",
      excerpt: "…",
    };
    const provider = fakeLLM({
      intro: {
        content_markdown: "Claim with a fake source.",
        sources_cited: [fakeSource],
      },
      body: { content_markdown: "Body." },
    });
    let caught: unknown;
    try {
      await executeSynthesis(ctx, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SynthesisError);
    if (caught instanceof SynthesisError) {
      expect(caught.message).toContain("never-cited.example");
      expect(caught.message).toContain("not present");
    }
  });
});

// ---------------------------------------------------------------------------
// executeSynthesis — format conformance (forbidden_terms, over_length)
// ---------------------------------------------------------------------------

describe("executeSynthesis — format conformance", () => {
  test("flags forbidden_terms as validation_issues + conformance report", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider = fakeLLM({
      intro: {
        content_markdown: "Obviously this is short. Clearly a warning is due.",
      },
      body: { content_markdown: "Body without issues." },
    });
    const result = await executeSynthesis(ctx, provider);
    const introIssues = result.sections[0]!.validation_issues;
    expect(introIssues.some((i) => i.includes("obviously"))).toBe(true);
    expect(introIssues.some((i) => i.includes("clearly"))).toBe(true);

    const hits = result.format_conformance.forbidden_terms_found;
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const introHits = hits.filter((h) => h.section_id === "intro");
    expect(introHits.length).toBe(2);
  });

  test("flags sections over max_length", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    // intro's max_length is 100; produce > 110 words to exceed tolerance.
    const longIntro = Array(130).fill("word").join(" ");
    const provider = fakeLLM({
      intro: { content_markdown: longIntro },
      body: { content_markdown: "Body." },
    });
    const result = await executeSynthesis(ctx, provider);
    expect(result.format_conformance.sections_over_length).toContain("intro");
    expect(result.sections[0]!.validation_issues.some((i) => i.includes("exceeds"))).toBe(true);
  });

  test("preserves the LLM's own validation_issues alongside post-validation ones", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider = fakeLLM({
      intro: {
        content_markdown: "Obviously the intro.",
        validation_issues: ["couldn't find a specific date"],
      },
      body: { content_markdown: "Body." },
    });
    const result = await executeSynthesis(ctx, provider);
    const issues = result.sections[0]!.validation_issues;
    expect(issues[0]).toBe("couldn't find a specific date");
    expect(issues.some((i) => i.includes("obviously"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// executeSynthesis — structural errors
// ---------------------------------------------------------------------------

describe("executeSynthesis — parse errors per section", () => {
  test("rejects a response missing content_markdown", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider: LLMProvider = {
      name: "bad",
      async complete() {
        return JSON.stringify({ sources_cited: [], validation_issues: [] });
      },
    };
    let caught: unknown;
    try {
      await executeSynthesis(ctx, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAgentOutputError);
  });

  test("rejects a malformed source in sources_cited", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider: LLMProvider = {
      name: "bad",
      async complete() {
        return JSON.stringify({
          content_markdown: "prose",
          sources_cited: [{ url: SOURCE_A.url, title: "" }],
          validation_issues: [],
        });
      },
    };
    let caught: unknown;
    try {
      await executeSynthesis(ctx, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAgentOutputError);
  });

  test("wraps provider errors as AgentExecutionError", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider: LLMProvider = {
      name: "boom",
      async complete() {
        throw new Error("provider down");
      },
    };
    let caught: unknown;
    try {
      await executeSynthesis(ctx, provider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AgentExecutionError);
  });
});

// ---------------------------------------------------------------------------
// executeSynthesis — prompt file errors
// ---------------------------------------------------------------------------

describe("executeSynthesis — prompt file errors", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "praxis-syn-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("PromptFileError when the file is missing", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider: LLMProvider = { name: "x", async complete() { return "{}"; } };
    let caught: unknown;
    try {
      await executeSynthesis(ctx, provider, {
        promptPath: join(tmp, "no.prompt"),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the prompt lacks the 'synthesis' declaration", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const p = join(tmp, "wrong.prompt");
    writeFileSync(
      p,
      `@version "1.0.0"\n@model claude-sonnet-4-5\n@description "not synthesis"\n\nprompt other() -> string {\n  system: """s"""\n  user: """u"""\n  output: string\n}\n`
    );
    const provider: LLMProvider = { name: "x", async complete() { return "{}"; } };
    let caught: unknown;
    try {
      await executeSynthesis(ctx, provider, { promptPath: p });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PromptFileError);
  });
});

// ---------------------------------------------------------------------------
// executeSynthesis — failure fixtures (via MockLLMProvider)
// ---------------------------------------------------------------------------

describe("executeSynthesis — format_conformance report shape", () => {
  test("deviation_pct is signed positive when actual > target", async () => {
    const format = makeFormat({ target_length: { pages: 1, words: 4 } });
    const ctx: SynthesisContext = { ...CTX_BASE, format };
    const provider = fakeLLM({
      intro: { content_markdown: "one two three four five six seven eight nine ten" },
      body: { content_markdown: "eleven twelve thirteen fourteen" },
    });
    const result = await executeSynthesis(ctx, provider);
    expect(result.format_conformance.deviation_pct).toBeGreaterThan(0);
  });

  test("deviation_pct is signed negative when actual < target", async () => {
    const format = makeFormat({ target_length: { pages: 1, words: 500 } });
    const ctx: SynthesisContext = { ...CTX_BASE, format };
    const provider = fakeLLM({
      intro: { content_markdown: "one two three" },
      body: { content_markdown: "four five" },
    });
    const result = await executeSynthesis(ctx, provider);
    expect(result.format_conformance.deviation_pct).toBeLessThan(0);
  });

  test("failed_validation_rules is empty when all rules are silently satisfied", async () => {
    const format = makeFormat();
    const ctx: SynthesisContext = { ...CTX_BASE, format };
    const provider = fakeLLM({
      intro: { content_markdown: "The intro paragraph." },
      body: { content_markdown: "The body paragraph." },
    });
    const result = await executeSynthesis(ctx, provider);
    expect(result.format_conformance.failed_validation_rules).toEqual([]);
  });

  test("sources_cited from multiple sections aggregate into total_word_count and per-section arrays", async () => {
    const ctx: SynthesisContext = { ...CTX_BASE, format: makeFormat() };
    const provider = fakeLLM({
      intro: {
        content_markdown: "with a source",
        sources_cited: [SOURCE_A],
      },
      body: {
        content_markdown: "with another source",
        sources_cited: [SOURCE_B],
      },
    });
    const result = await executeSynthesis(ctx, provider);
    expect(result.sections[0]!.sources_cited).toEqual([SOURCE_A]);
    expect(result.sections[1]!.sources_cited).toEqual([SOURCE_B]);
    const totalSources =
      result.sections[0]!.sources_cited.length +
      result.sections[1]!.sources_cited.length;
    expect(totalSources).toBe(2);
  });
});

describe("executeSynthesis — failure fixtures via MockLLMProvider", () => {
  test("forbidden-terms fixture flags every occurrence", async () => {
    const format = makeFormat({
      id: "test-forbidden-terms",
      sections: [
        {
          id: "test-section",
          title: "Test",
          purpose: "…",
          max_length: { words: 1000 },
          required_agents: ["synthesis"] as Format["sections"][number]["required_agents"],
          tone_directives: "n/a",
        },
      ],
      style_guide: {
        voice: "n",
        sentence_structure: "s",
        forbidden_terms: ["obviously", "clearly", "it goes without saying"],
      },
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format };
    const provider = new MockLLMProvider({
      fixturesDir: "tests/fixtures/mock-llm",
    });
    const result = await executeSynthesis(ctx, provider);
    const hits = result.format_conformance.forbidden_terms_found;
    const terms = hits.map((h) => h.term);
    expect(terms).toContain("obviously");
    expect(terms).toContain("clearly");
    expect(terms).toContain("it goes without saying");
  });

  test("over-length fixture flags the section", async () => {
    const format = makeFormat({
      id: "test-over-length",
      sections: [
        {
          id: "test-section",
          title: "Test",
          purpose: "…",
          max_length: { words: 20 },
          required_agents: ["synthesis"] as Format["sections"][number]["required_agents"],
          tone_directives: "n/a",
        },
      ],
    });
    const ctx: SynthesisContext = { ...CTX_BASE, format };
    const provider = new MockLLMProvider({
      fixturesDir: "tests/fixtures/mock-llm",
    });
    const result = await executeSynthesis(ctx, provider);
    expect(result.format_conformance.sections_over_length).toContain("test-section");
  });
});
