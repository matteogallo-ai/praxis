/**
 * Sourcing report aggregation.
 *
 * The unified validator emits a stream of `SourcingWarning`s while it
 * walks the items. The report builder converts that stream (plus the
 * inspected-item count) into a `SourcingReport` with per-category
 * totals: `ok`, `stale`, `untrusted`, `duplicated`, `missing`.
 *
 * Categorisation rule (most severe wins):
 *
 *   missing > untrusted > stale > duplicated > ok
 *
 * so the categories reconcile with `total_items`.
 */

import type {
  SourcingCategoryCounts,
  SourcingItemCategory,
  SourcingPolicy,
  SourcingReport,
  SourcingWarning,
} from "./types.ts";

/**
 * Book-keeping used during aggregation. Maps a `(agent, item_index)`
 * tuple to its most-severe category so late-arriving warnings can
 * upgrade an item's classification without inflating the totals.
 */
export interface ItemKey {
  agent: "research" | "stakeholder" | "risk";
  item_index: number;
}

const SEVERITY: Record<SourcingItemCategory, number> = {
  ok: 0,
  duplicated: 1,
  stale: 2,
  untrusted: 3,
  missing: 4,
};

/**
 * Convert a `SourcingWarning` into (a) the item key it refers to, if
 * any, and (b) the category it upgrades that item to.
 */
export function warningToCategory(w: SourcingWarning): {
  key: ItemKey | null;
  category: SourcingItemCategory;
} {
  switch (w.kind) {
    case "missing_source":
      return {
        key: { agent: "research", item_index: w.finding_index },
        category: "missing",
      };
    case "missing_stakeholder_evidence":
      return {
        key: { agent: "stakeholder", item_index: w.stakeholder_index },
        category: "missing",
      };
    case "missing_risk_evidence":
      // A risk contributes two independent evidence slots (likelihood +
      // impact); the report should count each missing slot separately.
      // Encode the field into the index space (even = likelihood, odd = impact).
      return {
        key: {
          agent: "risk",
          item_index:
            w.risk_index * 2 + (w.evidence_field === "impact_evidence" ? 1 : 0),
        },
        category: "missing",
      };
    case "stale_source":
      return {
        key: { agent: w.agent, item_index: w.item_index },
        category: "stale",
      };
    case "untrusted_domain":
      return {
        key: { agent: w.agent, item_index: w.item_index },
        category: "untrusted",
      };
    case "duplicate_source":
      return {
        key: { agent: w.agent, item_index: w.item_index },
        category: "duplicated",
      };
  }
}

/**
 * Aggregate a stream of warnings + a total item count into a `SourcingReport`.
 *
 * `totalItems` is the number of items the caller inspected (findings +
 * stakeholders + risk-evidence slots). Every item starts as `ok`; a
 * warning can only upgrade its category to a more severe one.
 */
export function buildReport(
  policy: SourcingPolicy,
  totalItems: number,
  warnings: readonly SourcingWarning[]
): SourcingReport {
  const perItem = new Map<string, SourcingItemCategory>();
  for (const w of warnings) {
    const { key, category } = warningToCategory(w);
    if (key === null) continue;
    const tag = `${key.agent}#${key.item_index}`;
    const current = perItem.get(tag) ?? "ok";
    if (SEVERITY[category] > SEVERITY[current]) {
      perItem.set(tag, category);
    }
  }

  const counts: SourcingCategoryCounts = {
    ok: 0,
    stale: 0,
    untrusted: 0,
    duplicated: 0,
    missing: 0,
  };
  for (const cat of perItem.values()) counts[cat] += 1;
  const categorized = perItem.size;
  counts.ok = Math.max(0, totalItems - categorized);

  let missingSourcesCount = 0;
  for (const w of warnings) {
    if (
      w.kind === "missing_source" ||
      w.kind === "missing_stakeholder_evidence" ||
      w.kind === "missing_risk_evidence"
    ) {
      missingSourcesCount += 1;
    }
  }

  return {
    policy,
    total_items: totalItems,
    counts,
    warnings: [...warnings],
    missing_sources_count: missingSourcesCount,
  };
}

/**
 * Merge two reports into one — used by the Orchestrator to combine the
 * research/stakeholder/risk sub-reports at the end of the pipeline.
 * Warnings are concatenated (order preserved); item counts summed;
 * category totals recomputed from the merged warnings.
 */
export function mergeReports(
  policy: SourcingPolicy,
  reports: readonly SourcingReport[]
): SourcingReport {
  const totalItems = reports.reduce((acc, r) => acc + r.total_items, 0);
  const allWarnings: SourcingWarning[] = [];
  for (const r of reports) allWarnings.push(...r.warnings);
  return buildReport(policy, totalItems, allWarnings);
}
