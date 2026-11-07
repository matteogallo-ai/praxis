/**
 * The live outputs' README presents an excerpt of question 12's live
 * briefing as "not edited": each block must be the brief's own lines, at the
 * line numbers it states, so a hand edit or a re-run of the record fails here.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

// The run id carries the date the excerpt states (4 Nov 2026).
const LIVE = "benchmarks/outputs/live";
const RUN_DIR = "12-sodium-ion-plant-morocco/run-2026-11-04T13-20-16-572Z";
const RUN = `${LIVE}/${RUN_DIR}`;
const brief = readFileSync(`${RUN}/brief.md`, "utf-8").split("\n");
const readme = readFileSync(`${LIVE}/README.md`, "utf-8");
const lines = (from: number, to: number) => brief.slice(from - 1, to).join("\n");

describe("live briefing excerpt", () => {
  test("is the brief's lines 90–100 and 173–179, verbatim", () => {
    expect(readme).toContain(`\`\`\`markdown\n${lines(90, 100)}\n\`\`\``);
    expect(readme).toContain(`\`\`\`markdown\n${lines(173, 179)}\n\`\`\``);
    expect(readme).toContain("Lines 90–100");
    expect(readme).toContain("Lines 101–172 are omitted. Lines 102–109 are a validation note");
    expect(readme).toContain("Lines 173–179");
  });

  test("the omitted note says what the excerpt says it does", () => {
    const note = lines(102, 109);
    expect(note.startsWith("<!-- Validation issues:")).toBe(true);
    expect(note).toContain("aligned to the steelmanned");
    expect(note).toContain("departs from the options artefact's recommended");
    expect(note).toContain("The toll-made sample route comes from the steelmanned alternative, not from a cited source.");
  });

  test("the flag's first item is the answer's first cited source", () => {
    const firstCited = /\]\((https:[^)]+)\)/.exec(lines(97, 100))?.[1];
    expect(firstCited).toBeDefined();
    expect(lines(179, 179)).toContain(`**research item 1**: ${firstCited} is not a trusted domain`);
  });

  test("says it is flagged, and the brief is", () => {
    expect(readme.replace(/\s+/g, " ")).toContain("Extract, not edited, from question 12's step 1 briefing (4 Nov 2026), which is flagged insufficiently sourced.");
    const meta = JSON.parse(readFileSync(`${RUN}/metadata.json`, "utf-8")) as { sourcing: { insufficiently_sourced: boolean } };
    expect(meta.sourcing.insufficiently_sourced).toBe(true);
  });

  test("the project README links the excerpt instead of repeating it", () => {
    expect(readFileSync("README.md", "utf-8")).toContain("(benchmarks/outputs/live/README.md#excerpt-question-12s-answer-and-its-sourcing-flag)");
    expect(readFileSync("README.md", "utf-8")).not.toContain("## Insufficiently sourced");
  });

  test("links the full brief and its PDF, which exist", () => {
    for (const f of ["brief.md", "brief.pdf"]) {
      expect(readme).toContain(`(${RUN_DIR}/${f})`);
      expect(existsSync(`${RUN}/${f}`)).toBe(true);
    }
  });
});
