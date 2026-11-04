/**
 * How a cited source's dates read in every rendered briefing. The
 * publication date is what freshness is judged on; when the source did not
 * state one, the briefing says so rather than leaving the retrieval date to
 * be read as the page's age.
 */
import { oneLine } from "../sourcing/code-written-section.ts";
import type { FirstPartySource } from "../sourcing/types.ts";

export function sourceDates(s: { accessed_at: string; published_at?: string }): string {
  const published = s.published_at === undefined ? "publication date unknown" : `published ${s.published_at}`;
  return `${published}, accessed ${s.accessed_at}`;
}

/**
 * The sourcing reports' lines for what the five categories leave out: sources
 * without a publication date, and facts only the requester can supply. Each
 * is absent when the run did not count it.
 */
export function uncategorisedLines(report: {
  freshness_unknown?: number;
  requester_provided?: number;
  first_party_sources?: readonly FirstPartySource[];
}): string[] {
  const lines: string[] = [];
  if (report.freshness_unknown !== undefined) {
    lines.push(`Freshness unknown (no publication date): ${report.freshness_unknown}`);
  }
  if (report.requester_provided !== undefined) {
    lines.push(`Requester-provided, not sourceable: ${report.requester_provided}`);
  }
  if (report.first_party_sources !== undefined) {
    lines.push(`First-party (an organisation's own site, for its own facts): ${report.first_party_sources.length}`);
  }
  return lines;
}

/**
 * One line per first-party source, the same in every sourcing report. The
 * item label can be model text (a stakeholder's name), so it is kept on one
 * line; `link` lets the Markdown brief write the URL as a safe autolink.
 */
export function describeFirstParty(f: FirstPartySource, link: (url: string) => string = (u) => u): string {
  return `[${f.stage}] ${oneLine(f.item)} — ${f.organisation}'s own site, for its own facts: ${link(f.url)}`;
}
