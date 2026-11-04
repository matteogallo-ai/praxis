/**
 * The human-review export (`benchmarks/export-annotation.ts`): live
 * briefings only, blind (nothing the judge wrote), the seven criteria to
 * fill, one JSON object per line.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { annotationRecords, toJsonl } from "../../benchmarks/export-annotation.ts";
import { SCORING_CRITERIA } from "../../benchmarks/score-all.ts";

function root(withLive: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-annot-"));
  mkdirSync(join(dir, "benchmarks"));
  cpSync("benchmarks/questions.yaml", join(dir, "benchmarks", "questions.yaml"));
  for (const id of withLive) {
    const out = join(dir, "benchmarks", "outputs", "live", id, "run-2026-11-04T08-33-09-131Z");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "brief.md"), `# Brief ${id}\n\nText.\n`);
    writeFileSync(join(out, "metadata.json"), "{}");
    writeFileSync(join(out, "scores.json"), JSON.stringify({ total: 31, weakest_aspect: "judge-sentinel" }));
  }
  return dir;
}

describe("annotationRecords", () => {
  test("one record per live briefing, with its question and seven empty criteria", () => {
    const r = annotationRecords(root(["05-supply-chain-acquisition"]), ["05-supply-chain-acquisition"]);
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe("05-supply-chain-acquisition");
    expect(r[0]?.format).toBe("mckinsey-style-note");
    expect(r[0]?.question.length).toBeGreaterThan(10);
    expect(r[0]?.brief_markdown).toContain("# Brief 05");
    expect(r[0]?.criteria.map((c) => c.key)).toEqual([...SCORING_CRITERIA]);
    for (const c of r[0]?.criteria ?? []) {
      expect(c.score).toBeNull();
      expect(c.definition.length).toBeGreaterThan(10);
    }
  });

  test("blind: nothing but the brief's own text leaves the run directory", () => {
    const line = toJsonl(annotationRecords(root(["05-supply-chain-acquisition"]), ["05-supply-chain-acquisition"]));
    expect(line).not.toContain("judge-sentinel");
    expect(line).not.toContain('"total"');
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim().split("\n")).toHaveLength(1);
  });

  test("refuses a question with no live briefing: mock text is not reviewed for quality", () => {
    expect(() => annotationRecords(root([]), ["05-supply-chain-acquisition"])).toThrow(/no live briefing/);
  });

  test("exports the latest completed run of a question", () => {
    const dir = root(["05-supply-chain-acquisition"]);
    const later = join(dir, "benchmarks", "outputs", "live", "05-supply-chain-acquisition", "run-2026-11-05T10-00-00-000Z");
    mkdirSync(later);
    writeFileSync(join(later, "brief.md"), "# Second run\n");
    writeFileSync(join(later, "metadata.json"), "{}");
    const [r] = annotationRecords(dir, ["05-supply-chain-acquisition"]);
    expect(r?.brief_markdown).toBe("# Second run\n");
    expect(r?.run).toBe("run-2026-11-05T10-00-00-000Z");
  });

  test("refuses an id named twice", () => {
    const dir = root(["05-supply-chain-acquisition"]);
    expect(() => annotationRecords(dir, ["05-supply-chain-acquisition", "05-supply-chain-acquisition"])).toThrow(/twice/);
  });

  test("refuses an id not in questions.yaml", () => {
    expect(() => annotationRecords(root([]), ["99-nope"])).toThrow(/99-nope/);
  });
});
