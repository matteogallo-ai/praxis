/**
 * The pre-registered decision rule of docs/preregistration/single-call-baseline.md,
 * applied from the committed grades, key and run records: README and the
 * system card state the verdict the rule gives, so neither can report a
 * preference, a claim count or a cost the files do not hold.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const DIR = "benchmarks/review/q12";
const flat = (p: string) => readFileSync(p, "utf-8").replace(/\s+/g, " ");

type Arm = "praxis" | "baseline";

function verdict(): { preferred: Arm | "tie"; unsupported: Record<Arm, number>; checked: Record<Arm, number>; usd: Record<Arm, string> } {
  const grades = readFileSync(`${DIR}/grades.md`, "utf-8");
  const key = JSON.parse(readFileSync(`${DIR}/key.json`, "utf-8")) as Record<"A" | "B", Arm> & { inputs: Record<Arm, string> };
  const choice = /^## Preference\s+(\S+)/m.exec(grades)?.[1] ?? "";
  if (choice !== "A" && choice !== "B" && !/^tie$/i.test(choice)) throw new Error(`unreadable preference: ${choice}`);
  const unsupported = { praxis: 0, baseline: 0 };
  const checked = { praxis: 0, baseline: 0 };
  for (const row of grades.matchAll(/^\| ([AB]) \| [^|]+\| [^|]+\| \[\d+\] \| (Supported|Not)\b/gm)) {
    const arm = key[row[1] as "A" | "B"];
    checked[arm]++;
    if (row[2] === "Not") unsupported[arm]++;
  }
  const cost = (brief: string) => {
    const meta = JSON.parse(readFileSync(brief.replace(/brief\.md$/, "metadata.json"), "utf-8")) as { usage: { total: { cost_usd: number } } };
    return `$${meta.usage.total.cost_usd.toFixed(2)}`;
  };
  return {
    preferred: choice === "A" || choice === "B" ? key[choice] : "tie",
    unsupported,
    checked,
    usd: { praxis: cost(key.inputs.praxis), baseline: cost(key.inputs.baseline) },
  };
}

function verdictSentence(link: (p: string) => string): string {
  const v = verdict();
  if (v.preferred === "praxis") throw new Error("the rule's other branch: the sentence below does not apply");
  const call = `one model call given the same format and search tool, with fewer searches, at ${v.usd.baseline}`;
  const pipeline = `the pipeline's briefing at ${v.usd.praxis}`;
  const outcome = v.preferred === "tie" ? `called it a tie between ${call} and ${pipeline}` : `preferred ${call} to ${pipeline}`;
  return (
    `On question 12, a blind review (8 Nov 2026, one reviewer; [grades](${link("grades.md")}), [key](${link("key.json")})) ${outcome}. ` +
    `Of the sourced claims checked, ${v.unsupported.praxis} of ${v.checked.praxis} in the pipeline's briefing and ` +
    `${v.unsupported.baseline} of ${v.checked.baseline} in the single call's were not supported by their source. ` +
    "Praxis's value over a single call is not demonstrated: n = 1 question, 1 reviewer, one run per arm. " +
    "Next step: more questions, and an ablation of the pipeline's stages."
  );
}

describe("single-call baseline verdict", () => {
  test("the grades and key give the reviewer's preference and claim counts", () => {
    const v = verdict();
    expect(v.preferred).toBe("baseline");
    expect(v.unsupported).toEqual({ praxis: 3, baseline: 2 });
    expect(v.checked).toEqual({ praxis: 4, baseline: 4 });
  });

  for (const [path, prefix] of [
    ["README.md", "benchmarks/review/q12/"],
    ["docs/SYSTEM_CARD.md", "../benchmarks/review/q12/"],
  ] as const) {
    test(`${path} states the verdict the pre-registered rule gives`, () => {
      expect(flat(path)).toContain(verdictSentence((f) => `${prefix}${f}`));
      expect(flat(path)).not.toMatch(/blind comparison of the two is prepared|which is better is not reviewed/);
    });
  }
});
