/**
 * How a cited source's dates read in every rendered briefing. The
 * publication date is what freshness is judged on; when the source did not
 * state one, the briefing says so rather than leaving the retrieval date to
 * be read as the page's age.
 */
export function sourceDates(s: { accessed_at: string; published_at?: string }): string {
  const published = s.published_at === undefined ? "publication date unknown" : `published ${s.published_at}`;
  return `${published}, accessed ${s.accessed_at}`;
}

/**
 * The sourcing reports' lines for what the five categories leave out: sources
 * without a publication date, and facts only the requester can supply. Each
 * is absent when the run did not count it.
 */
export function uncategorisedLines(report: { freshness_unknown?: number; requester_provided?: number }): string[] {
  const lines: string[] = [];
  if (report.freshness_unknown !== undefined) {
    lines.push(`Freshness unknown (no publication date): ${report.freshness_unknown}`);
  }
  if (report.requester_provided !== undefined) {
    lines.push(`Requester-provided, not sourceable: ${report.requester_provided}`);
  }
  return lines;
}
