import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    sourcing: { total_items: 44, counts: { ok: 9, untrusted: 24, missing: 11 }, insufficiently_sourced: true },
  });
  write(`benchmarks/outputs/live/05-x/${RUN}/brief.md`, "# b\n");
  write("benchmarks/outputs/live/02-y/error-2026-11-04T12-56-19-900Z.json", {
    failed_at: "2026-11-04T12:56:19.900Z",
    format: "executive-pre-read",
    error_type: "InvalidAgentOutputError",
    usage: { total: { cost_usd: 2.327 } },
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const scores = (n: number) => Object.fromEntries(SCORING_CRITERIA.map((k) => [k, { score: n, example: "e", improvement: "i" }]));
const judgment = (n: number) => ({
  judge_model: "claude-opus-5",
  judged_at: "2026-11-05T00:00:00Z",
  payload: {
    briefing_id: "05-x", provider: "anthropic", format_id: "f", scores: scores(n), total: n * 7,
    weakest_aspect: "w", strongest_aspect: "s", comparative_note: "c",
  },
});

describe("renderResults", () => {
  test("every completed run and every recorded failure, with n", () => {
    const md = renderResults(root);
    expect(md).toContain("1 live briefing completed and 1 attempt failed with a record");
    expect(md).toContain(`| 05-x | ${RUN} | mckinsey-style-note | yes | $3.51 | 3.0 min | 44 | 9 | 24 | 11 | yes |`);
    expect(md).toContain("| 02-y | 2026-11-04T12:56:19.900Z | executive-pre-read | `InvalidAgentOutputError` | $2.33 |");
    expect(md).toContain("q05 used for development after step 0; no longer held-out");
  });

  test("no judgment committed: no score", () => {
    expect(renderResults(root)).toContain("No score is published: no live briefing has been judged");
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
});

describe("checkResults", () => {
  test("null when RESULTS.md is what the artefacts give, a message otherwise", () => {
    write("benchmarks/RESULTS.md", renderResults(root));
    expect(checkResults(root)).toBeNull();
    write("benchmarks/RESULTS.md", "# edited by hand\n");
    expect(checkResults(root)).toContain("bun run results");
  });

  test("the committed RESULTS.md is the generator's", () => {
    expect(readFileSync("benchmarks/RESULTS.md", "utf-8")).toBe(renderResults("."));
  });
});
