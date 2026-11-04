/**
 * Sourcing validators — unified dispatcher (v0.5).
 *
 * v0.4 shipped two agent-specific validators (`validateSourcing` for
 * Research findings, `validateStakeholderSourcing` for Stakeholder
 * positions) that only knew about `strict|permissive` policy.
 *
 * v0.5 keeps both entry points (source-compatible with v0.4) and adds
 * a third (`validateRiskSourcing`) for Risk evidence. Under the hood
 * they all funnel through a common pipeline that also runs the new
 * hardened rules (freshness, domain trust, cross-agent dedupe) when
 * the format declares a `sourcing_rules` block.
 *
 * Failure mode:
 *   - `strict`     the first blocking condition (missing source,
 *                  stale-past-max, untrusted domain) raises a typed
 *                  subclass of `SourcingValidationError`. Duplicates
 *                  are non-blocking by default; they surface as
 *                  warnings in the returned report.
 *   - `permissive` everything is collected into the returned
 *                  `SourcingReport`; no exception is raised.
 *
 * A `SourcingAccumulator` may be threaded across calls to enable
 * cross-agent dedupe. Callers that do not need dedupe can pass a
 * `NoopSourcingAccumulator` or omit the argument — the validator
 * builds its own local no-op instance in that case.
 */

import type {
  ResearchResult,
  StakeholderMapResult,
  RiskAnalysisResult,
} from "../agents/types.ts";
import type {
  FirstPartySource,
  SourceStatus,
  SourcingAccumulator,
  SourcingAgentOrigin,
  SourcingPolicy,
  SourcingReport,
  SourcingRules,
  SourcingWarning,
} from "./types.ts";
import { isSourceMissing } from "./types.ts";
import {
  SourcingValidationError,
  StaleSourceError,
  UntrustedDomainError,
  isBlockingUnderStrict,
} from "./errors.ts";
import { classifyFreshness } from "./freshness.ts";
import { evaluateDomainTrust } from "./domain-trust.ts";
import { firstPartyOrganisation } from "./first-party.ts";
import { NoopSourcingAccumulator } from "./dedupe.ts";
import { buildReport } from "./report.ts";

// ---------------------------------------------------------------------------
// Public entry points (source-compatible with v0.4).
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** v0.5 rules — freshness/trust/dedupe. Absent → legacy v0.4 behaviour. */
  rules?: SourcingRules;
  /** Optional cross-agent accumulator. Defaults to a per-call no-op. */
  accumulator?: SourcingAccumulator;
  /** Clock injection point (tests). Defaults to `new Date()`. */
  now?: Date;
}

export function validateSourcing(
  result: ResearchResult,
  policy: SourcingPolicy,
  options: ValidateOptions = {}
): SourcingReport {
  const warnings: SourcingWarning[] = [];
  const rules = options.rules;
  const accumulator = options.accumulator ?? new NoopSourcingAccumulator();
  const now = options.now ?? new Date();
  const rulesInfo: RulesInfo = { rules, accumulator, now, unknownFreshness: 0, firstParty: [] };

  for (const [i, finding] of result.findings.entries()) {
    inspectSource(
      finding.source,
      i,
      "research",
      { finding_index: i, missing_searched_for: null },
      { subject: finding.claim, label: `finding ${i + 1}`, claim: finding.claim },
      rulesInfo,
      warnings
    );
  }

  return finalize(policy, result.findings.length, warnings, rulesInfo);
}

export function validateStakeholderSourcing(
  result: StakeholderMapResult,
  policy: SourcingPolicy,
  options: ValidateOptions = {}
): SourcingReport {
  const warnings: SourcingWarning[] = [];
  const rules = options.rules;
  const accumulator = options.accumulator ?? new NoopSourcingAccumulator();
  const now = options.now ?? new Date();
  const rulesInfo: RulesInfo = { rules, accumulator, now, unknownFreshness: 0, firstParty: [] };

  for (const [i, stakeholder] of result.stakeholders.entries()) {
    inspectSource(
      stakeholder.position_evidence,
      i,
      "stakeholder",
      {
        stakeholder_index: i,
        stakeholder_name: stakeholder.name,
      },
      { subject: stakeholder.name, label: stakeholder.name, claim: `position: ${stakeholder.position}. ${stakeholder.interest}` },
      rulesInfo,
      warnings
    );
  }

  return finalize(policy, result.stakeholders.length, warnings, rulesInfo);
}

/**
 * Validate the sourcing of every `likelihood_evidence` and
 * `impact_evidence` field on the risks in a `RiskAnalysisResult`.
 * Each risk contributes TWO inspected items (likelihood + impact) to
 * the report totals.
 */
export function validateRiskSourcing(
  result: RiskAnalysisResult,
  policy: SourcingPolicy,
  options: ValidateOptions = {}
): SourcingReport {
  const warnings: SourcingWarning[] = [];
  const rules = options.rules;
  const accumulator = options.accumulator ?? new NoopSourcingAccumulator();
  const now = options.now ?? new Date();
  const rulesInfo: RulesInfo = { rules, accumulator, now, unknownFreshness: 0, firstParty: [] };

  let itemIndex = 0;
  for (const [i, risk] of result.risks.entries()) {
    inspectSource(
      risk.likelihood_evidence,
      itemIndex,
      "risk",
      {
        risk_index: i,
        risk_id: risk.id,
        evidence_field: "likelihood_evidence" as const,
      },
      { subject: risk.description, label: `${risk.id} likelihood`, claim: risk.description },
      rulesInfo,
      warnings
    );
    itemIndex += 1;
    inspectSource(
      risk.impact_evidence,
      itemIndex,
      "risk",
      {
        risk_index: i,
        risk_id: risk.id,
        evidence_field: "impact_evidence" as const,
      },
      { subject: risk.description, label: `${risk.id} impact`, claim: risk.description },
      rulesInfo,
      warnings
    );
    itemIndex += 1;
  }

  return finalize(policy, result.risks.length * 2, warnings, rulesInfo);
}

// ---------------------------------------------------------------------------
// Internal — inspect a single SourceStatus and emit warnings.
// ---------------------------------------------------------------------------

interface ResearchLocator {
  finding_index: number;
  missing_searched_for: null;
}
interface StakeholderLocator {
  stakeholder_index: number;
  stakeholder_name: string;
}
interface RiskLocator {
  risk_index: number;
  risk_id: string;
  evidence_field: "likelihood_evidence" | "impact_evidence";
}
type Locator = ResearchLocator | StakeholderLocator | RiskLocator;

interface RulesInfo {
  rules: SourcingRules | undefined;
  accumulator: SourcingAccumulator;
  now: Date;
  /** Sources inspected under a freshness rule with no known publication date. */
  unknownFreshness: number;
  /** Sources the first-party rule accepted on an untrusted host. */
  firstParty: FirstPartySource[];
}

/** The item's own text, which must name a first-party source's organisation. */
interface ItemText {
  subject: string;
  label: string;
  /** What the source is cited for, shown beside an accepted first-party source. */
  claim: string;
}

/**
 * Inspect a single source and push zero or more warnings. Never
 * throws — the caller decides whether to throw at finalisation time.
 */
function inspectSource(
  source: SourceStatus,
  itemIndex: number,
  agent: SourcingAgentOrigin,
  locator: Locator,
  item: ItemText,
  info: RulesInfo,
  warnings: SourcingWarning[]
): void {
  if (isSourceMissing(source)) {
    warnings.push(buildMissingWarning(agent, locator, source.searched_for));
    return;
  }

  const { rules, accumulator, now } = info;

  if (rules?.freshness !== undefined) {
    const result = classifyFreshness(source.published_at, rules.freshness, now);
    if (result.classification === "unknown") info.unknownFreshness += 1;
    else if (result.classification === "stale" || result.classification === "warn") {
      warnings.push({
        kind: "stale_source",
        agent,
        item_index: itemIndex,
        url: source.url,
        accessed_at: source.accessed_at,
        ...(source.published_at === undefined ? {} : { published_at: source.published_at }),
        age_days: result.age_days ?? 0,
        exceeds_max: result.classification === "stale",
      });
    }
  }

  if (rules?.domain_trust !== undefined) {
    const trust = evaluateDomainTrust(source.url, rules.domain_trust);
    const organisation = trust.classification === "untrusted" ? firstPartyOrganisation(source, item.subject) : null;
    if (organisation !== null) {
      info.firstParty.push({ stage: agent, item: item.label, organisation, url: source.url, claim: item.claim });
    } else if (trust.classification === "untrusted") {
      warnings.push({
        kind: "untrusted_domain",
        agent,
        item_index: itemIndex,
        url: source.url,
        reason: trust.reason,
      });
    }
  }

  if (rules?.dedupe?.cross_agent === true) {
    const previous = accumulator.record(source.url, agent, itemIndex);
    if (previous !== null) {
      warnings.push({
        kind: "duplicate_source",
        agent,
        item_index: itemIndex,
        url: source.url,
        previous_agent: previous.agent,
        previous_item_index: previous.item_index,
        previous_url: previous.url,
      });
    }
  } else if (accumulator instanceof NoopSourcingAccumulator === false) {
    accumulator.record(source.url, agent, itemIndex);
  }
}

function buildMissingWarning(
  agent: SourcingAgentOrigin,
  locator: Locator,
  searchedFor: string
): SourcingWarning {
  if (agent === "research") {
    const l = locator as ResearchLocator;
    return {
      kind: "missing_source",
      finding_index: l.finding_index,
      searched_for: searchedFor,
    };
  }
  if (agent === "stakeholder") {
    const l = locator as StakeholderLocator;
    return {
      kind: "missing_stakeholder_evidence",
      stakeholder_index: l.stakeholder_index,
      stakeholder_name: l.stakeholder_name,
      searched_for: searchedFor,
    };
  }
  const l = locator as RiskLocator;
  return {
    kind: "missing_risk_evidence",
    risk_index: l.risk_index,
    risk_id: l.risk_id,
    evidence_field: l.evidence_field,
    searched_for: searchedFor,
  };
}

// ---------------------------------------------------------------------------
// Finalisers.
// ---------------------------------------------------------------------------

function finalize(
  policy: SourcingPolicy,
  totalItems: number,
  warnings: readonly SourcingWarning[],
  info: RulesInfo
): SourcingReport {
  const { rules } = info;
  const report = buildReport(policy, totalItems, warnings);
  // Set before any throw: a strict failure carries this report too.
  if (rules?.freshness !== undefined) report.freshness_unknown = info.unknownFreshness;
  if (info.firstParty.length > 0) report.first_party_sources = info.firstParty;
  if (policy !== "strict") return report;

  // Under strict, pick the first blocking warning (in emission order)
  // and raise the most specific typed error we can build for it.
  for (const w of warnings) {
    if (!isBlockingUnderStrict(w)) continue;
    if (w.kind === "stale_source" && rules?.freshness !== undefined) {
      throw new StaleSourceError(
        report,
        w.url,
        w.age_days,
        rules.freshness.max_source_age_days
      );
    }
    if (w.kind === "untrusted_domain") {
      throw new UntrustedDomainError(report, w.url, w.reason);
    }
    // Missing-source variants collapse to the base error, matching v0.4.
    throw new SourcingValidationError(report);
  }
  return report;
}
