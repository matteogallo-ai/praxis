import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { completedLiveRuns } from "../../benchmarks/provenance.ts";
import { checkResults, renderResults } from "../../benchmarks/results.ts";
import { SCORING_CRITERIA } from "../../benchmarks/score-all.ts";

let root: string;
const RUN = "run-2026-11-04T08-33-09-131Z";

function write(path: string, body: unknown) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), typeof body === "string" ? body : JSON.stringify(body));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "results-"));
  write("benchmarks/split.yaml", "dev:\n  - 01-a\ntest:\n  - 05-x\n");
  write(`benchmarks/outputs/live/05-x/${RUN}/metadata.json`, {
    format: "mckinsey-style-note",
    usage: { total: { cost_usd: 3.512 }, stages: { scoping: { duration_ms: 60_000 }, research: { duration_ms: 120_000 } } },
    sourcing: { total_items: 44, counts: { ok: 9, untrusted: 24, missing: 11, stale: 0, duplicated: 0 }, insufficiently_sourced: true },
  });
  write(`benchmarks/outputs/live/05-x/${RUN}/brief.md`, "# b\n");
  // A run in the dev split, and one recorded before the metadata had a sourcing block.
  write("benchmarks/outputs/live/01-a/run-2026-11-05T00-00-00-000Z/metadata.json", {
    format: "f",
    usage: { total: { cost_usd: 1 }, stages: {} },
    sourcing: { total_items: 10, counts: { ok: 2, untrusted: 3, missing: 1, stale: 3, duplicated: 1 }, insufficiently_sourced: false },
  });
  write("benchmarks/outputs/live/01-a/run-2026-11-06T00-00-00-000Z/metadata.json", { format: "f", usage: { total: { cost_usd: 1 }, stages: {} } });
  write("benchmarks/outputs/live/02-y/error-2026-11-04T12-56-19-900Z.json", {
    failed_at: "2026-11-04T12:56:19.900Z",
    format: "executive-pre-read",
    error_type: "InvalidAgentOutputError",
    usage: { total: { cost_usd: 2.327 } },
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const scores = (n: number | number[]) =>
  Object.fromEntries(SCORING_CRITERIA.map((k, i) => [k, { score: typeof n === "number" ? n : n[i], example: "e", improvement: "i" }]));
const judgment = (n: number | number[]) => ({
  judge_model: "claude-opus-5",
  judged_at: "2026-11-05T00:00:00Z",
  payload: {
    briefing_id: "05-x", provider: "anthropic", format_id: "f", scores: scores(n), total: typeof n === "number" ? n * 7 : n.reduce((a, b) => a + b, 0),
    weakest_aspect: "w", strongest_aspect: "s", comparative_note: "c",
  },
});

describe("renderResults", () => {
  test("every completed run and every recorded failure, with n", () => {
    const md = renderResults(root);
    expect(md).toContain("3 live briefings completed and 1 attempt failed with a record");
    expect(md).toContain(`| 05-x | ${RUN} | mckinsey-style-note | yes | $3.51 | 3.0 min | 44 | 9 | 24 | 11 | 0 | 0 | yes |`);
    expect(md).toContain("| 01-a | run-2026-11-05T00-00-00-000Z | f | no | $1.00 | 0.0 min | 10 | 2 | 3 | 1 | 3 | 1 | no |");
    expect(md).toContain("| 01-a | run-2026-11-06T00-00-00-000Z | f | no | $1.00 | 0.0 min | — | — | — | — | — | — | — |");
    expect(md).toContain("| 02-y | 2026-11-04T12:56:19.900Z | executive-pre-read | `InvalidAgentOutputError` | $2.33 |");
    expect(md).toContain("q05 used for development after step 0; no longer held-out");
  });

  test("no judgment committed: no score", () => {
    const md = renderResults(root);
    expect(md).toContain("No judge score is published: no live briefing has been judged by a model.");
    // The human blind comparison is a different measure; this page points to it rather than hide it.
    expect(md).toContain("[`review/q12/grades.md`](review/q12/grades.md)");
  });

  test("judgments without a human review: scores labelled unvalidated", () => {
    write(`benchmarks/judgments/05-x-${RUN}-live.json`, judgment(4));
    const md = renderResults(root);
    expect(md).toContain("## Scores (unvalidated)");
    expect(md).toContain(`| 05-x | ${RUN} | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 28 |`);
    expect(md).toContain("n = 1 judged briefing, one judgment each");
    expect(md).toContain("No human review is committed");
  });

  test("with the human review committed, the agreement decides the label", () => {
    write(`benchmarks/judgments/05-x-${RUN}-live.json`, judgment(4));
    const review = { id: "05-x", run: RUN, criteria: SCORING_CRITERIA.map((key, i) => ({ key, score: i % 2 === 0 ? 4 : 5, note: "" })) };
    write("benchmarks/judgments/human-review.jsonl", `${JSON.stringify(review)}\n`);
    const md = renderResults(root);
    expect(md).toContain("Judge–human agreement, n = 7 criterion pairs");
    expect(md).toContain("## Scores (unvalidated)");
  });

  test("a human review that agrees at the threshold makes the scores indicative", () => {
    const spread = [1, 2, 3, 4, 5, 4, 3];
    write(`benchmarks/judgments/05-x-${RUN}-live.json`, judgment(spread));
    const review = { id: "05-x", run: RUN, criteria: SCORING_CRITERIA.map((key, i) => ({ key, score: spread[i], note: "" })) };
    write("benchmarks/judgments/human-review.jsonl", `${JSON.stringify(review)}\n`);
    const md = renderResults(root);
    expect(md).toContain("## Scores (indicative)");
    expect(md).toContain("quadratic-weighted kappa 1.00, threshold 0.6: met");
  });

  test("a missing split or test list is refused, not read as 'no'", () => {
    unlinkSync(join(root, "benchmarks", "split.yaml"));
    expect(() => renderResults(root)).toThrow("split.yaml");
    write("benchmarks/split.yaml", "dev:\n  - 01-a\n");
    expect(() => renderResults(root)).toThrow("no test list");
  });
});

// The page says the five statuses add up to Items; each committed record must agree.
test("on every committed live run, the five statuses add up to the items", () => {
  const live = "benchmarks/outputs/live";
  for (const id of readdirSync(live, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    for (const dir of completedLiveRuns(join(live, id))) {
      const s = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8")).sourcing;
      if (s === undefined) continue;
      const c = s.counts;
      expect(c.ok + c.untrusted + c.missing + c.stale + c.duplicated).toBe(s.total_items);
    }
  }
});

describe("checkResults", () => {
  test("null when RESULTS.md is what the artefacts give, a message otherwise", () => {
    write("benchmarks/RESULTS.md", renderResults(root));
    expect(checkResults(root)).toBeNull();
    write("benchmarks/RESULTS.md", "# edited by hand\n");
    expect(checkResults(root)).toContain("bun run results");
  });

  test("the committed RESULTS.md is the generator's", () => {
    const committed = readFileSync("benchmarks/RESULTS.md", "utf-8");
    expect(committed).toBe(renderResults("."));
    expect(committed).toContain("| 05-supply-chain-acquisition | run-2026-11-04T08-33-09-131Z | mckinsey-style-note | yes, used for development |");
  });
});
