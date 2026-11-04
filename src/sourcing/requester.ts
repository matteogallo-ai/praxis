/**
 * The "Requester-provided, not sourceable" section: facts the scoping stage
 * found to concern only the requester, which no public source can establish.
 * Code writes it from the scoping result, so a reader sees what the briefing
 * takes on the requester's word, and no model can present it as sourced.
 */

import type { SynthesizedSection } from "../agents/types.ts";
import { countWords } from "../agents/synthesis.ts";

export const REQUESTER_PROVIDED_SECTION_ID = "requester-provided";

export function buildRequesterProvidedSection(facts: readonly string[]): SynthesizedSection {
  const content_markdown = [
    "The facts below concern only the requester. No public source can establish them,",
    "so this briefing counts none of them as sourced; the requester supplies them, and",
    "every statement that rests on them is as reliable as that information.",
    "",
    ...facts.map((f) => `- ${f}`),
    "",
  ].join("\n");
  return {
    section_id: REQUESTER_PROVIDED_SECTION_ID,
    title: "Requester-provided, not sourceable",
    content_markdown,
    word_count: countWords(content_markdown),
    sources_cited: [],
    validation_issues: [],
    editorial_attempts: [],
    final_attempt_number: 1,
  };
}
