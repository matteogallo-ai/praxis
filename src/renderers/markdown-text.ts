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
import { isMockProvider, MOCK_BANNER, MOCK_NOTICE, shownCounts } from "./mock.ts";
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
 * Text misread as code would be left live; code misread as text only shows
 * a backslash. So a span is kept only where the viewer must see one: a pair
 * on one line, in a block where no earlier backtick went unpaired and no
 * line is a table row (GFM splits cells before it looks for spans). From
 * the first doubt to the next blank line, backticks are text. Every
 * backslash outside a span is escaped, so no backtick is escaped either.
 */
export function plainText(v: string): string {
  let sure = true;
  return v
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      // CommonMark's blank line: spaces and tabs only (trim() would count a no-break space).
      if (/^[ \t]*$/.test(line)) sure = true;
      if (!sure || line.includes("|")) {
        sure = sure && !/[|`]/.test(line);
        return escapeLinks(line);
      }
      const { text, paired } = lineSpans(line);
      sure = paired;
      return text;
    })
    .join("\n");
}

/** One line: its spans kept, the rest escaped; `paired` is false from the first unpaired run on. */
function lineSpans(line: string): { text: string; paired: boolean } {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf("`", i);
    if (open === -1) return { text: out + escapeLinks(line.slice(i)), paired: true };
    out += escapeLinks(line.slice(i, open));
    const fence = /^`+/.exec(line.slice(open))?.[0] ?? "`";
    const close = closingFence(line, open + fence.length, fence.length);
    if (close === -1) return { text: out + escapeLinks(line.slice(open)), paired: false };
    out += line.slice(open, close + fence.length);
    i = close + fence.length;
  }
  return { text: out, paired: true };
}

/** The start of the next run of exactly `n` backticks in `line` from `from`, or -1. */
function closingFence(line: string, from: number, n: number): number {
  for (const m of line.slice(from).matchAll(/`+/g)) if (m[0].length === n) return from + m.index;
  return -1;
}

function escapeLinks(v: string): string {
  return v
    .replace(/[\\[\]@]/g, "\\$&")
    .replace(/(www)\./gi, "$1\\.")
    .replace(/:\/\//g, "\\://");
}

/** One model field, inert and plain: for text written outside a block `inert` already covers. */
export function modelText(v: string): string {
  return inert(plainText(v));
}

/** A URL as one Markdown link destination: `(`, `)`, `<`, `>` and whitespace would end it early. */
export function linkTarget(url: string): string {
  return url.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/**
 * The front-matter `sourcing_summary` line, shared by both Markdown outputs.
 * A mock run's fixture sources are counted as `unverified`, never as `ok`.
 */
export function sourcingSummary(report: SourcingReport, providerName: string): string {
  const { ok, unverified } = shownCounts(report, providerName);
  const lead = unverified === null ? "" : "mock, not verified: ";
  const fixtures = unverified === null ? "" : ` unverified=${unverified}`;
  const unknown =
    report.freshness_unknown === undefined ? "" : ` freshness_unknown=${report.freshness_unknown}`;
  const requester =
    report.requester_provided === undefined ? "" : ` requester_provided=${report.requester_provided}`;
  const cited =
    report.untrusted_citations === undefined ? "" : ` untrusted_citations=${report.untrusted_citations.length}`;
  const firstParty =
    report.first_party_sources === undefined ? "" : ` first_party=${report.first_party_sources.length}`;
  return (
    `sourcing_summary: "${lead}total=${report.total_items} ok=${ok}${fixtures} ` +
    `stale=${report.counts.stale} untrusted=${report.counts.untrusted} ` +
    `duplicated=${report.counts.duplicated} missing=${report.counts.missing}${unknown}${cited}${requester}${firstParty}"\n`
  );
}

/** The banner a mock briefing opens with, as a Markdown block quote; empty for a real provider. */
export function mockBannerMarkdown(providerName: string): string {
  return isMockProvider(providerName) ? `> **${MOCK_BANNER}** ${MOCK_NOTICE}\n\n` : "";
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
