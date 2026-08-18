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
