/**
 * Reads the committed live run records: an error-*.json per failed briefing,
 * a run-<start>/metadata.json per completed one. A stop at the operator's own
 * cap is not a failure of the service (docs/SLO.md, "What counts"), so it is
 * left out.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { completedLiveRuns } from "../../benchmarks/provenance.ts";

const LIVE = "benchmarks/outputs/live";

/** Five live attempts failed in 1.2.1, before run records were written. */
export const UNRECORDED_FAILURES = 5;

interface Completion {
  at: string;
  cost_usd: number;
  stages_ms: number;
}

export function liveRecords(): { failures: { type: string; at: string }[]; completions: Completion[] } {
  const dirs = readdirSync(LIVE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(LIVE, d.name));
  const failures = dirs
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => /^error-.*\.json$/.test(f))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as { error_type: string; failed_at: string })
    )
    .filter((r) => r.error_type !== "BudgetExceededError")
    .map((r) => ({ type: r.error_type, at: r.failed_at }));
  const completions = dirs.flatMap(completedLiveRuns).map((run) => {
    const meta = JSON.parse(readFileSync(join(run, "metadata.json"), "utf-8")) as {
      generated_at: string;
      usage: { total: { cost_usd: number }; stages: Record<string, { duration_ms: number }> };
    };
    return {
      at: meta.generated_at,
      cost_usd: meta.usage.total.cost_usd,
      // docs/SLO.md measures latency as the sum of the stages' wall time.
      stages_ms: Object.values(meta.usage.stages).reduce((a, s) => a + s.duration_ms, 0),
    };
  });
  return { failures, completions };
}

/** "3 Nov 2026"; several distinct days are joined with commas. */
export function days(records: readonly { at: string }[]): string {
  const fmt = (at: string) =>
    new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return [...new Set(records.map((r) => fmt(r.at)))].join(", ");
}

/** Wilson score interval at 95%, in whole percent. */
export function wilson(successes: number, n: number): string {
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const pct = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
  return `${pct(centre - half)}–${pct(centre + half)}`;
}
