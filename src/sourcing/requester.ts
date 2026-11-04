/**
 * The "Requester-provided, not sourceable" section: facts the scoping stage
 * found to concern only the requester, which no public source can establish.
 * Code writes it from the scoping result, so a reader sees what the briefing
 * takes on the requester's word, and no model can present it as sourced.
 */

import type { SynthesizedSection } from "../agents/types.ts";
import { codeWrittenSection, oneLine } from "./code-written-section.ts";

export const REQUESTER_PROVIDED_SECTION_ID = "requester-provided";

export function buildRequesterProvidedSection(facts: readonly string[]): SynthesizedSection {
  const content_markdown = [
    "The facts below concern only the requester. No public source can establish them,",
    "so this briefing counts none of them as sourced; the requester supplies them, and",
    "every statement that rests on them is as reliable as that information.",
    "",
    ...facts.map((f) => `- ${oneLine(f)}`),
    "",
  ].join("\n");
  return codeWrittenSection(REQUESTER_PROVIDED_SECTION_ID, "Requester-provided, not sourceable", content_markdown);
}
