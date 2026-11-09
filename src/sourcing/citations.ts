/**
 * Domain trust for the citations of the options and adversarial stages.
 *
 * Those stages cite sources after the research stages, so the per-item
 * validators never saw them. Their results are listed separately from the
 * warnings because a warning's `agent` names one of the three research
 * stages, and widening that public union would break consumers that
 * switch over it (docs/SEMVER-CONTRACT.md).
 */

import { evaluateDomainTrust } from "./domain-trust.ts";
import { UntrustedDomainError } from "./errors.ts";
import { buildReport } from "./report.ts";
import type {
  DomainTrustRule,
  SourceStatus,
  SourcingPolicy,
  SourcingReport,
  UntrustedCitation,
} from "./types.ts";
import { isSourceMissing } from "./types.ts";

/**
 * One line per untrusted citation, the same in every sourcing report.
 * `quote` wraps the URL and the reason: Markdown passes `codeSpan`, so that
 * a viewer does not turn the untrusted URL into a link.
 */
export function describeUntrustedCitation(c: UntrustedCitation, quote: (s: string) => string = (s) => s): string {
  return `[${c.stage}] ${c.id} cites an untrusted domain: ${quote(c.url)} — ${quote(c.reason)}`;
}

export function untrustedCitations(
  stage: UntrustedCitation["stage"],
  cited: readonly { id: string; evidence: SourceStatus }[],
  rule: DomainTrustRule
): UntrustedCitation[] {
  const out: UntrustedCitation[] = [];
  for (const { id, evidence } of cited) {
    if (isSourceMissing(evidence)) continue;
    const trust = evaluateDomainTrust(evidence.url, rule);
    if (trust.classification === "untrusted") {
      out.push({ stage, id, url: evidence.url, reason: trust.reason });
    }
  }
  return out;
}

/**
 * The options stage's citations as a report of no items: they join the
 * pipeline's report without changing its counts. Under `strict` an
 * untrusted citation fails the way an untrusted research source does,
 * with the report attached, so `onSourcingFailure: "degrade"` applies.
 */
export function optionsCitationReport(
  options: readonly { id: string; supporting_evidence: SourceStatus }[],
  policy: SourcingPolicy,
  rule: DomainTrustRule
): SourcingReport {
  const cited = options.map((o) => ({ id: o.id, evidence: o.supporting_evidence }));
  const report: SourcingReport = {
    ...buildReport(policy, 0, []),
    untrusted_citations: untrustedCitations("options", cited, rule),
  };
  const first = report.untrusted_citations?.[0];
  if (policy === "strict" && first !== undefined) {
    throw new UntrustedDomainError(report, first.url, first.reason);
  }
  return report;
}
