/**
 * v0.8 — Orchestrator.briefWithCritiqueAndRerun() end-to-end tests.
 *
 * The editorial re-run loop is capped at ONE iteration. These tests
 * verify:
 *
 *   1. When the critique carries `revised_recommendation_needed: true`
 *      AND a `steelmanned_alternative`, the Synthesis agent is
 *      re-invoked exactly once, with REVISION MODE in its prompt.
 *   2. When the critique carries `revised_recommendation_needed: false`
 *      OR `steelmanned_alternative: null`, no rerun fires — the
 *      returned payload has `rerun_performed: false` and all rerun
 *      metadata cleared.
 *   3. `original_synthesis` preserves the pre-rerun output for audit.
 *   4. `sourcing_report.edited_after_critique` flips to `true`.
 *   5. Hard cap 1 iteration: the method never triggers a 2nd rerun.
 *   6. `computeReSynthesisDeviations()` correctly surfaces sections
 *      that changed substantially (word-count delta or Levenshtein).
 */
import { describe, expect, test } from "bun:test";

import {
  Orchestrator,
  computeReSynthesisDeviations,
} from "../../src/orchestrator/orchestrator.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { CompletionResult, Tool } from "../../src/llm/types.ts";
import type { SynthesisResult, SynthesizedSection } from "../../src/agents/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockProvider(): MockLLMProvider {
  return new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });
}

/**
 * Wraps a delegate LLMProvider and intercepts adversarial prompts to
 * substitute a `revised_recommendation_needed: false` response. Used to
 * simulate the no-rerun code path without needing new fixtures.
 */
function noRevisionProvider(delegate: LLMProvider): LLMProvider {
  const minorCritique = (i: number) => ({
    id: `CRIT-00${i}`,
    category: "hidden-assumption",
    severity: "minor",
    target: { section_id: "context" },
    steelmanned_position:
      "A benign critique that legitimately raises a small point but does not shift the recommendation the brief already lands on. Number " +
      String(i) +
      " here.",
    counter_evidence: {
      status: "SOURCE_MISSING",
      searched_for: `n/a #${i}`,
    },
    implication_if_true: "No material shift; noted as a hedge.",
    suggested_revision: "Add a one-line acknowledgement.",
  });
  const NO_REV = JSON.stringify({
    critiques: [minorCritique(1), minorCritique(2), minorCritique(3)],
    critical_count: 0,
    material_count: 0,
    minor_count: 3,
    recommendation_robustness: "high",
    revised_recommendation_needed: false,
    steelmanned_alternative: null,
  });

  return {
    name: delegate.name,
    async complete(prompt: string): Promise<string> {
      if (prompt.includes("Adversarial critique task")) return NO_REV;
      return delegate.complete!(prompt);
    },
    async completeWithTools(prompt: string, tools: Tool[]): Promise<CompletionResult> {
      if (prompt.includes("Adversarial critique task")) {
        return { text: NO_REV, tool_calls: [], rounds: 1, stop_reason: "end_turn" };
      }
      return delegate.completeWithTools!(prompt, tools);
    },
  };
}

/**
 * Counts LLM prompts by agent kind (based on prompt substring
 * fingerprints) so tests can assert on the exact call topology.
 */
function countingProvider(delegate: LLMProvider): LLMProvider & {
  counts: { synthesis: number; adversarial: number; other: number };
} {
  const counts = { synthesis: 0, adversarial: 0, other: 0 };
  const bump = (p: string): void => {
    if (p.includes("Synthesize section")) counts.synthesis += 1;
    else if (p.includes("Adversarial critique task")) counts.adversarial += 1;
    else counts.other += 1;
  };
  return {
    name: delegate.name,
    async complete(prompt: string): Promise<string> {
      bump(prompt);
      return delegate.complete!(prompt);
    },
    async completeWithTools(prompt: string, tools: Tool[]): Promise<CompletionResult> {
      bump(prompt);
      return delegate.completeWithTools!(prompt, tools);
    },
    counts,
  };
}

// ---------------------------------------------------------------------------
// Rerun triggers on shipped fixtures (all three formats trigger revision)
// ---------------------------------------------------------------------------

describe("Orchestrator.briefWithCritiqueAndRerun() — rerun triggered", () => {
  test("shipped exec-pre-read fixture triggers rerun and preserves original_synthesis", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const orch = new Orchestrator(registry, makeMockProvider());
    const out = await orch.briefWithCritiqueAndRerun(
      "Should we enter the German market?",
      "executive-pre-read",
      { now: new Date("2026-08-18T00:00:00Z") }
    );
    expect(out.rerun_performed).toBe(true);
    expect(out.rerun_reason).not.toBeNull();
    expect(out.rerun_reason).toContain("REVISION MODE");
    expect(out.original_synthesis).not.toBeNull();
    expect(out.rerun_metadata).not.toBeNull();
    expect(out.rerun_metadata!.critiques_addressed.length).toBeGreaterThan(0);
    expect(out.rerun_metadata!.steelmanned_alternative_used).not.toBeNull();
    expect(out.sourcing_report.edited_after_critique).toBe(true);
    // The current synthesis is the POST-rerun one. Its structure matches the format.
    expect(out.synthesis.sections.length).toBe(6);
  });

  test("mckinsey-style-note fixture triggers rerun too", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const orch = new Orchestrator(registry, makeMockProvider());
    const out = await orch.briefWithCritiqueAndRerun(
      "Should we enter Germany?",
      "mckinsey-style-note",
      { now: new Date("2026-08-18T00:00:00Z") }
    );
    expect(out.rerun_performed).toBe(true);
  });

  test("position-paper-corporate fixture triggers rerun too", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const orch = new Orchestrator(registry, makeMockProvider());
    const out = await orch.briefWithCritiqueAndRerun(
      "Should we enter the German market?",
      "position-paper-corporate",
      { now: new Date("2026-08-18T00:00:00Z") }
    );
    expect(out.rerun_performed).toBe(true);
  });

  test("HARD CAP 1: exactly one adversarial call, two synthesis calls (initial + rerun)", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const provider = countingProvider(makeMockProvider());
    const orch = new Orchestrator(registry, provider);
    await orch.briefWithCritiqueAndRerun(
      "Should we enter the German market?",
      "executive-pre-read",
      { now: new Date("2026-08-18T00:00:00Z") }
    );
    // exec-pre-read has 6 sections → 6 synthesis calls per pass, x 2 passes.
    expect(provider.counts.synthesis).toBe(12);
    // The critique agent runs ONCE — no 2nd critique on the reran brief.
    expect(provider.counts.adversarial).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// No-rerun paths
// ---------------------------------------------------------------------------

describe("Orchestrator.briefWithCritiqueAndRerun() — no rerun", () => {
  test("critique with revised_recommendation_needed:false → rerun_performed:false", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const provider = noRevisionProvider(makeMockProvider());
    const orch = new Orchestrator(registry, provider);
    const out = await orch.briefWithCritiqueAndRerun(
      "Should we enter the German market?",
      "executive-pre-read",
      { now: new Date("2026-08-18T00:00:00Z") }
    );
    expect(out.rerun_performed).toBe(false);
    expect(out.rerun_reason).toBeNull();
    expect(out.original_synthesis).toBeNull();
    expect(out.rerun_metadata).toBeNull();
    // sourcing_report edited flag: NOT set when no rerun fired.
    expect(out.sourcing_report.edited_after_critique).toBeUndefined();
  });

  test("no rerun means synthesis agent is called ONCE per section (no 2nd pass)", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const provider = countingProvider(noRevisionProvider(makeMockProvider()));
    const orch = new Orchestrator(registry, provider);
    await orch.briefWithCritiqueAndRerun(
      "Should we enter the German market?",
      "executive-pre-read",
      { now: new Date("2026-08-18T00:00:00Z") }
    );
    // exec-pre-read has 6 sections × 1 pass = 6 synthesis calls.
    expect(provider.counts.synthesis).toBe(6);
    expect(provider.counts.adversarial).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeReSynthesisDeviations — unit tests
// ---------------------------------------------------------------------------

function sec(id: string, content: string, wordCount: number): SynthesizedSection {
  return {
    section_id: id,
    title: id,
    content_markdown: content,
    word_count: wordCount,
    sources_cited: [],
    validation_issues: [],
    editorial_attempts: [],
    final_attempt_number: 1,
  };
}

function synth(sections: SynthesizedSection[]): SynthesisResult {
  return {
    sections,
    total_word_count: sections.reduce((a, s) => a + s.word_count, 0),
    format_conformance: {
      target_words: 100,
      actual_words: sections.reduce((a, s) => a + s.word_count, 0),
      deviation_pct: 0,
      sections_over_length: [],
      forbidden_terms_found: [],
      failed_validation_rules: [],
    },
  };
}

describe("computeReSynthesisDeviations", () => {
  test("identical synthesis → no deviations", () => {
    const a = synth([sec("intro", "the quick brown fox", 4)]);
    const b = synth([sec("intro", "the quick brown fox", 4)]);
    expect(computeReSynthesisDeviations(a, b)).toEqual([]);
  });

  test("word-count delta > 20% → section flagged", () => {
    const a = synth([sec("intro", "one two three four five", 5)]);
    // 5 → 8 words = 60% delta > 20%.
    const b = synth([sec("intro", "one two three four five six seven eight", 8)]);
    expect(computeReSynthesisDeviations(a, b)).toEqual(["intro"]);
  });

  test("word-count delta 10% → no flag from that axis", () => {
    // 10 → 11 words = 10% delta. Content is IDENTICAL prefix so
    // Levenshtein is small too.
    const a = synth([sec("intro", "a b c d e f g h i j", 10)]);
    const b = synth([sec("intro", "a b c d e f g h i j k", 11)]);
    expect(computeReSynthesisDeviations(a, b)).toEqual([]);
  });

  test("Levenshtein > 0.30 with same word count → section flagged", () => {
    const a = synth([sec("intro", "aaaaaaaaaaaa", 1)]);
    const b = synth([sec("intro", "zzzzzzzzzzzz", 1)]);
    expect(computeReSynthesisDeviations(a, b)).toEqual(["intro"]);
  });

  test("removed section → flagged as deviation", () => {
    const a = synth([
      sec("intro", "a b c d e", 5),
      sec("body", "f g h i j", 5),
    ]);
    const b = synth([sec("intro", "a b c d e", 5)]);
    expect(computeReSynthesisDeviations(a, b)).toEqual(["body"]);
  });

  test("new section → flagged as deviation", () => {
    const a = synth([sec("intro", "a b c d e", 5)]);
    const b = synth([
      sec("intro", "a b c d e", 5),
      sec("body", "f g h i j", 5),
    ]);
    expect(computeReSynthesisDeviations(a, b)).toEqual(["body"]);
  });

  test("multi-section: only the changed one is flagged", () => {
    const a = synth([
      sec("intro", "a b c d e", 5),
      sec("body", "f g h i j", 5),
    ]);
    // intro identical; body rewritten completely.
    const b = synth([
      sec("intro", "a b c d e", 5),
      sec("body", "z z z z z", 5),
    ]);
    expect(computeReSynthesisDeviations(a, b)).toEqual(["body"]);
  });
});

describe("Orchestrator.briefWithCritiqueAndRerun() — what the rerun addresses", () => {
  test("it addresses exactly the critical and material critiques, and its reason names them", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const out = await new Orchestrator(registry, makeMockProvider()).briefWithCritiqueAndRerun(
      "Should we enter the German market?",
      "executive-pre-read",
      { now: new Date("2026-08-18T00:00:00Z") }
    );
    const blocking = out.adversarial.critiques.filter((c) => c.severity === "critical" || c.severity === "material");
    expect(out.adversarial.critiques.length).toBeGreaterThan(blocking.length);
    expect(out.rerun_metadata?.critiques_addressed).toEqual(blocking.map((c) => c.id));
    const trigger =
      out.adversarial.critical_count >= 1
        ? `${out.adversarial.critical_count} critical critique(s)`
        : `${out.adversarial.material_count} material critique(s)`;
    expect(out.rerun_reason).toBe(
      `${trigger} triggered a Synthesis rerun in REVISION MODE addressing critique IDs: ${blocking.map((c) => c.id).join(", ")}.`
    );
  });

  test("a critique without counter-evidence is reported as a missing source after the brief's own items", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const orch = new Orchestrator(registry, noRevisionProvider(makeMockProvider()));
    const now = new Date("2026-08-18T00:00:00Z");
    const brief = await orch.brief("Should we enter the German market?", "executive-pre-read", { now });
    const out = await orch.briefWithCritique("Should we enter the German market?", "executive-pre-read", { now });
    const added = out.sourcing_report.warnings.slice(brief.sourcing_report.warnings.length);
    expect(added).toEqual([1, 2, 3].map((n) => ({
      kind: "missing_source",
      finding_index: brief.sourcing_report.total_items + n - 1,
      searched_for: `[CRIT-00${n}] n/a #${n}`,
    })));
  });
});

describe("Orchestrator.briefWithCritique() — sourced critiques", () => {
  test("only critiques without counter-evidence add a missing-source warning", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const orch = new Orchestrator(registry, makeMockProvider());
    const now = new Date("2026-08-18T00:00:00Z");
    const brief = await orch.brief("Should we enter the German market?", "executive-pre-read", { now });
    const out = await orch.briefWithCritique("Should we enter the German market?", "executive-pre-read", { now });
    const unsourced = out.adversarial.critiques.filter((c) => "status" in c.counter_evidence);
    expect(unsourced.length).toBeLessThan(out.adversarial.critiques.length);
    expect(out.sourcing_report.warnings.length - brief.sourcing_report.warnings.length).toBe(unsourced.length);
  });
});

describe("Orchestrator.briefWithCritiqueAndRerun() — the rerun prompt", () => {
  test("only the rerun's synthesis prompts carry REVISION MODE and the revision instruction", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const mock = makeMockProvider();
    const synthesisPrompts: string[] = [];
    const recording: LLMProvider = {
      name: mock.name,
      async complete(prompt: string): Promise<string> {
        if (prompt.includes("Synthesize section")) synthesisPrompts.push(prompt);
        return mock.complete(prompt);
      },
      async completeWithTools(prompt: string, tools: Tool[]): Promise<CompletionResult> {
        if (prompt.includes("Synthesize section")) synthesisPrompts.push(prompt);
        return mock.completeWithTools(prompt, tools);
      },
    };
    const out = await new Orchestrator(registry, recording).briefWithCritiqueAndRerun(
      "Should we enter the German market?",
      "executive-pre-read",
      { now: new Date("2026-08-18T00:00:00Z") }
    );
    const sections = out.synthesis.sections.length;
    expect(synthesisPrompts).toHaveLength(2 * sections);
    const revised = synthesisPrompts.filter((p) => p.includes("REVISION MODE"));
    expect(revised).toEqual(synthesisPrompts.slice(sections));
    for (const p of revised) {
      expect(p).toContain("revise sections and align recommendation with the steelmanned alternative");
    }
  });
});

describe("Orchestrator.briefWithCritiqueAndRerun() — budget reached during the rerun", () => {
  test("the paid pre-rerun brief is returned, the skip recorded, nothing rerun", async () => {
    const { BudgetExceededError } = await import("../../src/llm/errors.ts");
    const inner = makeMockProvider();
    const capped: LLMProvider = {
      name: inner.name,
      ...(inner.acceptsSystemPrompt === undefined ? {} : { acceptsSystemPrompt: inner.acceptsSystemPrompt }),
      complete: (p, o) => inner.complete(p, o),
      completeWithTools: (p: string, tools: Tool[], o) => {
        if (`${o?.system ?? ""}\n${p}`.includes("REVISION MODE")) {
          return Promise.reject(new BudgetExceededError(8.2, 8, "synthesis-rerun"));
        }
        return inner.completeWithTools?.(p, tools, o) as Promise<CompletionResult>;
      },
    };
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const out = await new Orchestrator(registry, capped).briefWithCritiqueAndRerun(
      "Should we enter the German market?",
      "executive-pre-read",
      { now: new Date("2026-08-18T00:00:00Z") }
    );
    expect(out.rerun_performed).toBe(false);
    expect(out.rerun_skipped).toMatch(/budget/i);
    expect(out.original_synthesis).toBeNull();
    expect(out.synthesis.sections.length).toBe(6);
  });
});
