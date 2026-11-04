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

/** The sourcing reports' line for sources without a publication date; absent when the format has no freshness rule. */
export function freshnessUnknownLine(report: { freshness_unknown?: number }): string | undefined {
  return report.freshness_unknown === undefined
    ? undefined
    : `Freshness unknown (no publication date): ${report.freshness_unknown}`;
}
