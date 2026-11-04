/**
 * Writing model text into Markdown, shared by the two Markdown outputs: the
 * `--full` default (`renderFullBrief`, src/cli/output.ts) and `--render
 * md-enhanced` (src/renderers/markdown-enhanced.ts).
 *
 * Model text, and the web pages behind it, is data here, never markup
 * (OWASP LLM05): a raw `<img>` or a Markdown image would be fetched when the
 * briefing is opened, `-->` would close the comment it sits in, and a URL
 * with a parenthesis would end its link early.
 */
import type { SynthesizedSection } from "../agents/types.ts";
import type { SourcingReport } from "../sourcing/types.ts";

/**
 * Model text made inert: `<` as `&lt;`, `-->` and `--!>` (both end an HTML
 * comment) with `&gt;`, `![` as `!\[`.
 * The cost: a literal `<` or `![` inside a code span shows escaped.
 */
export function inert(v: string): string {
  return v.replace(/</g, "&lt;").replace(/--(!?)>/g, "--$1&gt;").replace(/!\[/g, "!\\[");
}

/** A URL as one Markdown link destination: `(`, `)`, `<`, `>` and whitespace would end it early. */
export function linkTarget(url: string): string {
  return url.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/** The front-matter `sourcing_summary` line, shared by both Markdown outputs. */
export function sourcingSummary(report: SourcingReport): string {
  const unknown =
    report.freshness_unknown === undefined ? "" : ` freshness_unknown=${report.freshness_unknown}`;
  return (
    `sourcing_summary: "total=${report.total_items} ok=${report.counts.ok} ` +
    `stale=${report.counts.stale} untrusted=${report.counts.untrusted} ` +
    `duplicated=${report.counts.duplicated} missing=${report.counts.missing}${unknown}"\n`
  );
}

/** A YAML double-quoted scalar: escapes backslashes and quotes. */
export function yamlString(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function escapeMarkdownHeading(v: string): string {
  return v.replace(/[\r\n]+/g, " ");
}

/** Link text: brackets and backslashes escaped, or a trailing backslash would escape the closing `]`. */
export function escapeMarkdownLinkText(v: string): string {
  return v.replace(/[\\[\]]/g, (c) => `\\${c}`);
}

/** Each synthesis section: heading, prose, its sources, and its validation issues in a comment. */
export function renderSynthesisSections(sections: readonly SynthesizedSection[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    parts.push(`## ${inert(escapeMarkdownHeading(section.title))}\n\n`);
    parts.push(`${inert(section.content_markdown.trim())}\n\n`);
    if (section.sources_cited.length > 0) {
      parts.push("**Sources:**\n\n");
      for (const s of section.sources_cited) {
        parts.push(`- [${inert(escapeMarkdownLinkText(s.title))}](${linkTarget(s.url)})\n`);
      }
      parts.push("\n");
    }
    if (section.validation_issues.length > 0) {
      parts.push("<!-- Validation issues:\n");
      for (const issue of section.validation_issues) parts.push(`  - ${inert(issue)}\n`);
      parts.push("-->\n\n");
    }
  }
  return parts.join("");
}
