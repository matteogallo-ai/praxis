/**
 * The human review of question 10's first-party sources, as published in
 * benchmarks/outputs/live/README.md: every row is the record's, and the
 * verdicts are the reviewer's, pinned here so the counts cannot drift.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const RECORD = "benchmarks/outputs/live/10-esg-position/run-2026-11-04T13-04-11-831Z/metadata.json";
// The reviewer's verdicts, in the record's order (4 Nov 2026).
const VERDICTS = ["accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "refused", "refused"];

const doc = readFileSync("benchmarks/outputs/live/README.md", "utf-8");
const flat = doc.replace(/\s+/g, " ");
const sources = (JSON.parse(readFileSync(RECORD, "utf-8")) as {
  sourcing: { first_party_sources: { stage: string; item: string; organisation: string }[] };
}).sourcing.first_party_sources;

describe("question 10's first-party review", () => {
  test("one row per recorded source, in the record's order, with its verdict", () => {
    expect(sources).toHaveLength(VERDICTS.length);
    sources.forEach((f, i) => {
      expect(doc).toContain(`| ${i + 1} | ${f.stage} | ${f.item} | ${f.organisation} | ${VERDICTS[i]} |`);
    });
  });

  test("the counts and the refused items' reason", () => {
    const refused = VERDICTS.filter((v) => v === "refused").length;
    expect(flat).toContain(`${VERDICTS.length} reviewed, ${VERDICTS.length - refused} accepted, ${refused} refused.`);
    expect(flat).toContain(`A human review accepted ${VERDICTS.length - refused} of the ${VERDICTS.length} and refused ${refused}`);
    // Both refusals are the risk stage's: the rule's amendment rests on that.
    expect(sources.filter((_, i) => VERDICTS[i] === "refused").map((f) => f.stage)).toEqual(["risk", "risk"]);
  });
});
