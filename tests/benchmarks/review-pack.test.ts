/**
 * The blind review pack: both arms in one layout, nothing that names an arm.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { assignment, blindBriefing, blindSection, PACK } from "../../benchmarks/review-pack.ts";

describe("review pack", () => {
  test("Praxis citations and the baseline's inline links come out the same", () => {
    const praxis = blindSection(
      "Answer",
      "Plants cost $1bn ([source](https://a.example/x)).\n\n**Sources:**\n\n- [A title](https://a.example/x)\n- [Other](https://b.example/y)\n\n<!-- Validation issues:\n  - note\n-->\n"
    );
    const baseline = blindSection("Answer", "Plants cost $1bn ([A title](https://a.example/x)).\n");
    expect(praxis).toBe("## Answer\n\nPlants cost $1bn [1].\n\nSources:\n\n1. https://a.example/x\n2. https://b.example/y\n");
    expect(baseline).toBe("## Answer\n\nPlants cost $1bn [1].\n\nSources:\n\n1. https://a.example/x\n");
    expect(blindSection("Answer", "It [is not law](https://a.example/x).")).toContain("It is not law [1].");
    expect(praxis).not.toContain("Validation");
  });

  test("keeps the format's sections in order, drops the rest, marks a missing one", () => {
    const md = "---\nprovider: x\n---\n## Table of Contents\n\n- a\n\n## So What\n\nB.\n\n## Situation\n\nA.\n\n## Insufficiently sourced\n\nlist\n";
    const out = blindBriefing(md, ["Situation", "Answer", "So What"]);
    expect(out.match(/^## .*/gm)).toEqual(["## Situation", "## Answer", "## So What"]);
    expect(out).toContain("## Answer\n\n(missing)");
    expect(out).not.toMatch(/Insufficiently|Table of Contents|provider/);
  });

  test("the assignment is a function of the two inputs", () => {
    expect(assignment("p", "b")).toEqual(assignment("p", "b"));
    const { A, B } = assignment("p", "b");
    expect(new Set([A, B])).toEqual(new Set(["praxis", "baseline"]));
  });

  test("the committed pack is what the script builds from the committed briefings", () => {
    const praxis = readFileSync(PACK.praxis, "utf-8");
    const baseline = readFileSync(PACK.baseline, "utf-8");
    const key = JSON.parse(readFileSync(`${PACK.out}/key.json`, "utf-8")) as { A: string; B: string };
    expect(key).toMatchObject(assignment(praxis, baseline));
    const by = { praxis, baseline } as Record<string, string>;
    for (const label of ["A", "B"] as const) {
      const pack = readFileSync(`${PACK.out}/${label}.md`, "utf-8");
      expect(pack).toBe(`# Briefing ${label}: ${PACK.question}\n\n${blindBriefing(by[key[label]] as string, PACK.titles)}`);
      expect(pack).not.toMatch(/praxis|baseline|mock|OPT-[A-D]|RISK-\d|CRIT-\d|Validation issues/i);
    }
  });
});
