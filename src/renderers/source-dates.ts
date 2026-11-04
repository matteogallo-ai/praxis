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

/** The longest claim a first-party line quotes, before its ellipsis. */
export const CLAIM_MAX = 160;

/**
 * One line per first-party source, the same in every sourcing report, with
 * the claim it was accepted for: whether that claim states the
 * organisation's own fact is a human's call (ADR 0003). The label and the
 * claim can be model text, so they are kept on one line; `link` lets the
 * Markdown brief write the URL as a safe autolink, and `text` makes model
 * text inert there.
 */
export function describeFirstParty(
  f: FirstPartySource,
  link: (url: string) => string = (u) => u,
  text: (s: string) => string = (s) => s
): string {
  const claim = f.claim === undefined ? " — claim not recorded" : ` — claim: “${text(cut(oneLine(f.claim)))}”`;
  return `[${f.stage}] ${text(oneLine(f.item))} — ${f.organisation}'s own site, for its own facts: ${link(f.url)}${claim}`;
}

/** Cut at the last word boundary within the limit, or inside a word longer than it. */
function cut(s: string): string {
  if (s.length <= CLAIM_MAX) return s;
  const space = s.lastIndexOf(" ", CLAIM_MAX);
  return `${(space > 0 ? s.slice(0, space) : s.slice(0, CLAIM_MAX)).replace(/[\s.,;:]+$/, "")}…`;
}
