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

/**
 * Text as one Markdown code span, so that a viewer shows it as written: a
 * URL or a `www.` host in a span is not turned into a link. The fence is a
 * backtick run of a length the text does not contain (CommonMark).
 */
export function codeSpan(text: string): string {
  const line = oneLine(text);
  const runs = new Set((line.match(/`+/g) ?? []).map((r) => r.length));
  let n = 1;
  while (runs.has(n)) n++;
  const fence = "`".repeat(n);
  const pad = line.startsWith("`") || line.endsWith("`") ? " " : "";
  return `${fence}${pad}${line}${pad}${fence}`;
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
