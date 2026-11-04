/**
 * The run record names the sections over their length cap, not only how many
 * there are: a reviewer checking format conformance needs to know which.
 */
import { describe, expect, test } from "bun:test";

import { buildMetadata } from "../../benchmarks/run-all.ts";

describe("buildMetadata", () => {
  test("records which sections are over length, beside their count", () => {
    const result = {
      generated_at: "2026-11-04T08:33:09.131Z",
      provider_name: "anthropic",
      synthesis: {
        total_word_count: 954,
        format_conformance: {
          target_words: 1200,
          deviation_pct: -20.5,
          sections_over_length: ["situation", "so-what"],
          forbidden_terms_found: [],
        },
      },
      adversarial: { critical_count: 0, material_count: 0, minor_count: 0, revised_recommendation_needed: false },
      rerun_performed: false,
      sourcing_report: { total_items: 0, counts: {}, edited_after_critique: false, insufficiently_sourced: false },
    };
    const meta = buildMetadata(
      { id: "05-x", question: "Q?", format: "mckinsey-style-note", tags: [] } as never,
      "live",
      result as never,
      1
    ) as { synthesis: { sections_over_length: number; sections_over_length_ids: string[] } };
    expect(meta.synthesis.sections_over_length).toBe(2);
    expect(meta.synthesis.sections_over_length_ids).toEqual(["situation", "so-what"]);
  });
});
