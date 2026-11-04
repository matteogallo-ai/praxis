/**
 * Writing model text into Markdown, shared by the two Markdown outputs: the
 * `--full` default (`renderFullBrief`, src/cli/output.ts) and `--render
 * md-enhanced` (src/renderers/markdown-enhanced.ts).
 *
 * Model text, and the web pages behind it, is data here, never markup
 * (OWASP LLM05): a raw `<img>` or a Markdown image would be fetched when the
 * briefing is opened, an address the model wrote would be a link, `-->`
 * would close the comment it sits in, and a URL with a parenthesis would end
 * its link early.
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

/**
 * Model text a GFM viewer shows as written: outside code spans, no link,
 * image, reference definition or autolink (`www.`, `scheme://`, e-mail), so
 * nothing the model wrote is fetched or clickable when the briefing is
 * opened. Emphasis, lists and headings stay Markdown.
 *
 * A code span is found as CommonMark finds it, but only on one line: text
 * misread as code would be left live, while code misread as text only shows
 * a backslash. Every backslash outside a span is escaped first, so no
 * backtick is escaped and the spans seen here are the viewer's.
 */
export function plainText(v: string): string {
  let out = "";
  let i = 0;
  while (i < v.length) {
    const open = v.indexOf("`", i);
    if (open === -1) return out + escapeLinks(v.slice(i));
    out += escapeLinks(v.slice(i, open));
    const fence = /^`+/.exec(v.slice(open))?.[0] ?? "`";
    const close = closingFence(v, open + fence.length, fence.length);
    const end = close === -1 ? open + fence.length : close + fence.length;
    out += v.slice(open, end);
    i = end;
  }
  return out;
}

/** One model field, inert and plain: for text written outside a block `inert` already covers. */
export function modelText(v: string): string {
  return inert(plainText(v));
}

/** The start of the next run of exactly `n` backticks on the same line, or -1. */
function closingFence(v: string, from: number, n: number): number {
  const lineEnd = v.indexOf("\n", from);
  const line = v.slice(from, lineEnd === -1 ? v.length : lineEnd);
  for (const m of line.matchAll(/`+/g)) if (m[0].length === n) return from + m.index;
  return -1;
}

function escapeLinks(v: string): string {
  return v
    .replace(/[\\[\]@]/g, "\\$&")
    .replace(/(www)\./gi, "$1\\.")
    .replace(/:\/\//g, "\\://");
}

/** A URL as one Markdown link destination: `(`, `)`, `<`, `>` and whitespace would end it early. */
export function linkTarget(url: string): string {
  return url.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/** The front-matter `sourcing_summary` line, shared by both Markdown outputs. */
export function sourcingSummary(report: SourcingReport): string {
  const unknown =
    report.freshness_unknown === undefined ? "" : ` freshness_unknown=${report.freshness_unknown}`;
  const requester =
    report.requester_provided === undefined ? "" : ` requester_provided=${report.requester_provided}`;
  const cited =
    report.untrusted_citations === undefined ? "" : ` untrusted_citations=${report.untrusted_citations.length}`;
  const firstParty =
    report.first_party_sources === undefined ? "" : ` first_party=${report.first_party_sources.length}`;
  return (
    `sourcing_summary: "total=${report.total_items} ok=${report.counts.ok} ` +
    `stale=${report.counts.stale} untrusted=${report.counts.untrusted} ` +
    `duplicated=${report.counts.duplicated} missing=${report.counts.missing}${unknown}${cited}${requester}${firstParty}"\n`
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
    parts.push(`## ${inert(plainText(escapeMarkdownHeading(section.title)))}\n\n`);
    parts.push(`${inert(plainText(section.content_markdown.trim()))}\n\n`);
    if (section.sources_cited.length > 0) {
      parts.push("**Sources:**\n\n");
      // Numbered as the prose's markers [n] cite them.
      for (const [i, s] of section.sources_cited.entries()) {
        parts.push(`- [${i + 1}] [${inert(escapeMarkdownLinkText(s.title))}](${linkTarget(s.url)})\n`);
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
