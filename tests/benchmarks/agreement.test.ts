import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agreement, KAPPA_THRESHOLD, pairsFromFiles, quadraticKappa, renderAgreement } from "../../benchmarks/agreement.ts";
import { SCORING_CRITERIA } from "../../benchmarks/score-all.ts";

describe("quadraticKappa (1–5 scale)", () => {
  test("identical ratings with spread: 1", () => {
    expect(quadraticKappa([[1, 1], [3, 3], [5, 5]])).toBe(1);
  });
  test("opposite ends: -1", () => {
    expect(quadraticKappa([[1, 5], [5, 1]])).toBe(-1);
  });
  test("worked by hand: (1,1) and (2,3) give 2/3", () => {
    // Weights (i-j)²/16. Observed: 1/16. Expected from the margins: ½·(4+1+1)/16 = 3/16.
    expect(quadraticKappa([[1, 1], [2, 3]])).toBeCloseTo(2 / 3, 12);
  });
  test("no spread on either side: undefined, not a number", () => {
    expect(quadraticKappa([[4, 4], [4, 4]])).toBeNull();
  });
  test("a rating outside 1–5 is refused", () => {
    expect(() => quadraticKappa([[0, 1]])).toThrow("1–5");
  });
});

describe("agreement", () => {
  test("exact and within-one shares, and the threshold", () => {
    const a = agreement([[1, 1], [2, 3], [3, 5], [4, 4]]);
    expect(a).toMatchObject({ n: 4, exact: 2, within_one: 3 });
    expect(a.meets_threshold).toBe((a.kappa ?? -2) >= KAPPA_THRESHOLD);
  });
  test("an undefined kappa does not meet the threshold", () => {
    expect(agreement([[4, 4]]).meets_threshold).toBe(false);
  });
  test("a kappa of exactly the threshold meets it; just below does not", () => {
    // (1,2) and (4,3): observed 2/16 per 2 pairs, expected 10/16 per 2 → 1 - 2/10 = 0.6 exactly.
    expect(quadraticKappa([[1, 2], [4, 3]])).toBe(KAPPA_THRESHOLD);
    expect(agreement([[1, 2], [4, 3]]).meets_threshold).toBe(true);
    const below = agreement([[1, 2], [4, 3], [3, 4]]);
    expect(below.kappa).toBeLessThan(KAPPA_THRESHOLD);
    expect(below.meets_threshold).toBe(false);
  });
  test("no pair is refused, not a NaN kappa", () => {
    expect(() => agreement([])).toThrow("no criterion pair");
  });
});

describe("pairsFromFiles", () => {
  const scores = (n: number) => Object.fromEntries(SCORING_CRITERIA.map((k) => [k, { score: n, example: "e", improvement: "i" }]));
  const human = (id: string, n: number | null, run = "run-a") =>
    JSON.stringify({ id, run, criteria: SCORING_CRITERIA.map((key) => ({ key, score: n, note: "" })) });
  const judge = (id: string, n: number) =>
    JSON.stringify({
      cached_at: "2026-11-05T00:00:00Z",
      payload: {
        briefing_id: id, provider: "anthropic", format_id: "f", scores: scores(n), total: n * 7,
        weakest_aspect: "w", strongest_aspect: "s", comparative_note: "c",
      },
    });
  function setup(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "agreement-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  }

  test("pairs each criterion of each reviewed briefing with the judge's", () => {
    const dir = setup({
      "review.jsonl": `${human("05-x", 3, "run-2026-11-04T08-33-09-131Z")}\n${human("02-y", 4, "run-b")}\n`,
      "05-x-run-2026-11-04T08-33-09-131Z-live.json": judge("05-x", 4),
      "05-x-run-2026-11-04T10-52-05-822Z-live.json": judge("05-x", 1),
      "02-y-run-b-live.json": judge("02-y", 4),
    });
    try {
      const pairs = pairsFromFiles(join(dir, "review.jsonl"), dir);
      expect(pairs).toHaveLength(14);
      expect(pairs[0]).toEqual({ id: "05-x", criterion: SCORING_CRITERIA[0], human: 3, judge: 4 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a bad score, a missing or mismatched judgment, a repeated or malformed record, or no record is refused", () => {
    const ok = judge("05-x", 4);
    const cases: [Record<string, string>, string][] = [
      [{ "review.jsonl": human("05-x", null), "05-x-run-a-live.json": ok }, "05-x: framing_clarity has no score 1–5"],
      [{ "review.jsonl": human("05-x", 0), "05-x-run-a-live.json": ok }, "05-x: framing_clarity has no score 1–5"],
      [{ "review.jsonl": human("05-x", 6), "05-x-run-a-live.json": ok }, "05-x: framing_clarity has no score 1–5"],
      [{ "review.jsonl": human("05-x", 4.5), "05-x-run-a-live.json": ok }, "05-x: framing_clarity has no score 1–5"],
      [{ "review.jsonl": human("05-x", 3) }, "05-x: no judgment of run-a"],
      // Only the reviewed run's judgment counts, and an id that extends another is a different briefing.
      [{ "review.jsonl": human("05-x", 3), "05-x-run-b-live.json": ok, "05-x-extra-run-a-live.json": judge("05-x-extra", 4) }, "05-x: no judgment of run-a"],
      [{ "review.jsonl": human("05-x", 3), "05-x-run-a-live.json": judge("02-y", 4) }, "05-x-run-a-live.json judges 02-y"],
      [{ "review.jsonl": `${human("05-x", 3)}\n${human("05-x", 3)}\n`, "05-x-run-a-live.json": ok }, "05-x: reviewed twice"],
      [{ "review.jsonl": '{"id":"05-x"}\n', "05-x-run-a-live.json": ok }, "line 1: not an annotation record"],
      [{ "review.jsonl": "\n" }, "no review in"],
    ];
    for (const [files, message] of cases) {
      const dir = setup(files);
      try {
        expect(() => pairsFromFiles(join(dir, "review.jsonl"), dir)).toThrow(message);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe("renderAgreement", () => {
  test("states n, the shares, kappa and what the scores may be called", () => {
    const text = renderAgreement(agreement([[1, 1], [2, 3]]));
    expect(text).toContain("n = 2 criterion pairs");
    expect(text).toContain("exact 1/2, within one point 2/2");
    expect(text).toContain("quadratic-weighted kappa 0.67, threshold 0.6: met");
    expect(text).toContain("the judge's scores are indicative");
    expect(renderAgreement(agreement([[4, 4]]))).toContain("kappa undefined (no spread), threshold 0.6: not met; the judge's scores are unvalidated");
  });
});
