/**
 * What every output says when the briefing came from the mock provider.
 *
 * Mock text is fixture text chosen by format: its figures, organisations
 * and URLs are invented, and no search returned its sources. The sourcing
 * rules still accept many of them (the fixture domains are on trusted
 * lists), so printed as-is the counts would call fixture sources "ok". The
 * outputs print them as unverified instead, and open with a banner, so a
 * mock briefing copied out of context does not pass for a real one.
 */
import type { SourcingReport } from "../sourcing/types.ts";

export const MOCK_BANNER = "DONNÉES FICTIVES — mode mock";

export const MOCK_NOTICE =
  "Fictitious data: fixture text from the mock provider. Its figures, organisations and URLs are invented, and no search verified its sources.";

export function isMockProvider(providerName: string): boolean {
  return providerName === "mock";
}

/** The `ok` count as printed, and the fixture sources set apart from it. */
export function shownCounts(report: SourcingReport, providerName: string): { ok: number; unverified: number | null } {
  return isMockProvider(providerName)
    ? { ok: 0, unverified: report.counts.ok }
    : { ok: report.counts.ok, unverified: null };
}
