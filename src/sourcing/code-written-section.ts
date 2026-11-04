/**
 * Sections code appends to a briefing after the model's ("Requester-provided,
 * not sourceable", "Insufficiently sourced"). Their text is code's, but the
 * items they list quote model output.
 */

import type { SynthesizedSection } from "../agents/types.ts";
import { countWords } from "../agents/synthesis.ts";

/**
 * Model text as one line of a list: a newline in it would let the model open
 * a heading or a list of its own inside a section that code vouches for.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function codeWrittenSection(section_id: string, title: string, content_markdown: string): SynthesizedSection {
  return {
    section_id,
    title,
    content_markdown,
    word_count: countWords(content_markdown),
    sources_cited: [],
    validation_issues: [],
    editorial_attempts: [],
    final_attempt_number: 1,
  };
}
