/**
 * The rule that marks a rerun section as changed in `rerun_metadata`: more
 * than 20% change in word count, or more than 0.3 of the longer text in edits.
 */
import { describe, expect, test } from "bun:test";

import type { SynthesizedSection } from "../../src/agents/types.ts";
import { isSubstantiallyChanged } from "../../src/orchestrator/orchestrator.ts";

function section(content_markdown: string, word_count: number): SynthesizedSection {
  return {
    section_id: "s",
    title: "S",
    content_markdown,
    word_count,
    sources_cited: [],
    validation_issues: [],
    editorial_attempts: [],
    final_attempt_number: 1,
  };
}

describe("isSubstantiallyChanged", () => {
  test.each([
    [100, 120, false],
    [100, 121, true],
    [100, 80, false],
    [100, 79, true],
    [0, 0, false],
    [0, 1, true],
  ])("word count %d → %d, same text: %p", (from, to, changed) => {
    expect(isSubstantiallyChanged(section("same text", from), section("same text", to))).toBe(changed);
  });

  test.each([
    ["aaaaaaaaaa", "aaaaaaaaaa", false],
    ["aaaaaaaaaa", "bbbaaaaaaa", false],
    ["aaaaaaaaaa", "bbbbaaaaaa", true],
    ["aaaaaaaaaa", "aaaaaaa", false],
    ["aaaaaaaaaa", "aaaaaa", true],
    ["", "", false],
    ["", "a", true],
  ])("text %p → %p, same word count: %p", (from, to, changed) => {
    expect(isSubstantiallyChanged(section(from, 10), section(to, 10))).toBe(changed);
  });
});
