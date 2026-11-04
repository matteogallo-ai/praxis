/**
 * Counts the committed live run records. Each started live briefing leaves
 * metadata.json (completed) or an error-*.json (failed) under
 * benchmarks/outputs/live/<id>/. A stop at the operator's own cap is not a
 * failure of the service (docs/SLO.md, "What counts"), so it is left out.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

const LIVE = "benchmarks/outputs/live";

export function liveRecords(): { failures: string[]; completed: number } {
  const dirs = readdirSync(LIVE, { withFileTypes: true }).filter((d) => d.isDirectory());
  const failures = dirs
    .flatMap((d) =>
      readdirSync(`${LIVE}/${d.name}`)
        .filter((f) => /^error-.*\.json$/.test(f))
        .map((f) => (JSON.parse(readFileSync(`${LIVE}/${d.name}/${f}`, "utf-8")) as { error_type: string }).error_type)
    )
    .filter((t) => t !== "BudgetExceededError");
  const completed = dirs.filter((d) => existsSync(`${LIVE}/${d.name}/metadata.json`)).length;
  return { failures, completed };
}
