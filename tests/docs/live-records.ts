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
  id: string;
  at: string;
  /** The commit the run executed, abbreviated. */
  sha: string;
  cost_usd: number;
  stages_ms: number;
  searches: number;
  adversarial: { critical_count: number; material_count: number; minor_count: number };
  sourcing: { total_items: number; counts: { missing: number; untrusted: number }; insufficiently_sourced: boolean };
}

export function liveRecords(): { failures: { type: string; at: string; sha: string }[]; completions: Completion[] } {
  const dirs = readdirSync(LIVE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(LIVE, d.name));
  const failures = dirs
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => /^error-.*\.json$/.test(f))
        .map(
          (f) =>
            JSON.parse(readFileSync(join(dir, f), "utf-8")) as {
              error_type: string;
              failed_at: string;
              provenance: { git_sha: string };
            }
        )
    )
    .filter((r) => r.error_type !== "BudgetExceededError")
    .map((r) => ({ type: r.error_type, at: r.failed_at, sha: r.provenance.git_sha.slice(0, 7) }));
  const completions = dirs.flatMap(completedLiveRuns).map((run) => {
    const meta = JSON.parse(readFileSync(join(run, "metadata.json"), "utf-8")) as {
      id: string;
      generated_at: string;
      usage: { total: { cost_usd: number; web_search_requests: number }; stages: Record<string, { duration_ms: number }> };
      adversarial: Completion["adversarial"];
      sourcing: Completion["sourcing"];
      provenance: { git_sha: string };
    };
    return {
      id: meta.id,
      at: meta.generated_at,
      sha: meta.provenance.git_sha.slice(0, 7),
      searches: meta.usage.total.web_search_requests,
      adversarial: meta.adversarial,
      sourcing: meta.sourcing,
      cost_usd: meta.usage.total.cost_usd,
      // docs/SLO.md measures latency as the sum of the stages' wall time.
      stages_ms: Object.values(meta.usage.stages).reduce((a, s) => a + s.duration_ms, 0),
    };
  });
  // Oldest first, both: directory order differs between filesystems, and
  // step 0 is the first completion wherever it is described.
  failures.sort((a, b) => a.at.localeCompare(b.at));
  completions.sort((a, b) => a.at.localeCompare(b.at));
  return { failures, completions };
}

/**
 * Attempts grouped by the commit they ran on, oldest first. Each commit is
 * a different version of the pipeline, so a completion rate pooled across
 * them would describe no version.
 */
export function byCommit(): { sha: string; completed: number; attempts: number; at: string }[] {
  const { failures, completions } = liveRecords();
  const groups = new Map<string, { sha: string; completed: number; attempts: number; at: string }>();
  const all = [...failures.map((f) => ({ ...f, ok: false })), ...completions.map((c) => ({ ...c, ok: true }))];
  for (const a of all.sort((x, y) => x.at.localeCompare(y.at))) {
    const g = groups.get(a.sha) ?? { sha: a.sha, completed: 0, attempts: 0, at: a.at };
    g.attempts += 1;
    if (a.ok) g.completed += 1;
    groups.set(a.sha, g);
  }
  return [...groups.values()];
}

/** The sentence README and the system card use for the attempts, by commit. */
export function attemptsSentence(): string {
  const { failures, completions } = liveRecords();
  const rows = byCommit()
    .map((g) => `${g.sha} ${g.completed} of ${g.attempts}`)
    .join(", ");
  return `Live attempts by commit, completed of attempted: ${rows} (${days([...failures, ...completions])}); ${UNRECORDED_FAILURES} earlier attempts, in 1.2.1, failed and left no record`;
}

/** "two", for the sentences that say how many briefings completed. */
export function countWord(n: number): string {
  return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? String(n);
}

/** "question 05", or "questions 05, 08 and 10": the questions the records cover, by number. */
export function questionsOf(records: readonly { id: string }[]): string {
  const n = [...new Set(records.map((r) => r.id.slice(0, 2)))].sort();
  if (n.length === 1) return `question ${n[0]}`;
  return `questions ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** "3 Nov 2026"; several distinct days read "3 Nov 2026 and 4 Nov 2026". */
export function days(records: readonly { at: string }[]): string {
  const fmt = (at: string) =>
    new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const all = [...new Set(records.map((r) => fmt(r.at)))];
  return all.length < 2 ? all.join("") : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

/** How a completed briefing's sourcing flag reads wherever it is reported. */
export function sourcingFlag(c: Completion): string {
  const { total_items, counts, insufficiently_sourced } = c.sourcing;
  return `${insufficiently_sourced ? "flagged insufficiently sourced" : "sourced"}: ${counts.missing} of ${total_items} items without a source, ${counts.untrusted} from untrusted domains`;
}
