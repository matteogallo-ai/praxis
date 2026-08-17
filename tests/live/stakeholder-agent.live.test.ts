/**
 * Live integration test for the Stakeholder Mapping agent end-to-end
 * against the real Anthropic API.
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set.
 */

import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { executeStakeholderMapping } from "../../src/agents/stakeholder.ts";
import { isSourceMissing } from "../../src/sourcing/types.ts";
import type { StakeholderContext } from "../../src/agents/types.ts";
import type { Format } from "../../src/registry/schema.ts";

const hasKey =
  typeof process.env["ANTHROPIC_API_KEY"] === "string" &&
  process.env["ANTHROPIC_API_KEY"]!.length > 0;

const FMT: Format = {
  id: "executive-pre-read",
  name: "Executive Pre-Read",
  version: "1.0.0",
  metadata: {
    author: "Live",
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
  sourcing_policy: "permissive",
  style_guide: { voice: "neutral", sentence_structure: "short", forbidden_terms: [] },
  output_targets: ["md"],
};

const CTX: StakeholderContext = {
  scoping: {
    reformulated_question:
      "What are the top two policy trends in EU AI regulation as of 2026?",
    hidden_questions: ["Which regulators drive the trend?"],
    scope_boundaries: ["EU only; 2025-2026 horizon"],
    assumptions_to_validate: ["EU AI Act remains in force"],
  },
  research: {
    findings: [
      {
        claim: "The EU AI Act's General Purpose AI obligations took effect in 2026.",
        supporting_evidence: "Public EU Commission communication.",
        source: {
          url: "https://digital-strategy.ec.europa.eu/en/policies/ai-act",
          title: "EU AI Act — Policy Overview",
          accessed_at: "2026-08-17T00:00:00Z",
          excerpt: "General Purpose AI obligations applied progressively.",
        },
      },
    ],
    open_questions: [],
    search_queries_used: ["EU AI Act GPAI obligations 2026"],
  },
  format: FMT,
};

describe.skipIf(!hasKey)("Stakeholder Mapping agent (live)", () => {
  test("returns at least three well-formed stakeholders on a live API run", async () => {
    const llm = new AnthropicLLMProvider();
    const result = await executeStakeholderMapping(CTX, llm, {
      maxToolRounds: 4,
    });
    expect(result.stakeholders.length).toBeGreaterThanOrEqual(3);
    expect(result.stakeholders.length).toBeLessThanOrEqual(20);
    for (const s of result.stakeholders) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.interest.length).toBeGreaterThan(0);
    }
    // At least one stakeholder should carry a real source (otherwise the
    // web_search integration is not being exercised).
    const sourced = result.stakeholders.filter(
      (s) => !isSourceMissing(s.position_evidence)
    );
    expect(sourced.length).toBeGreaterThanOrEqual(1);
    expect(result.key_dynamics.length).toBeGreaterThanOrEqual(1);
  }, 240_000);
});
