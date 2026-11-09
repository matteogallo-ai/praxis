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
type Key = Record<"A" | "B", Arm>;
interface Verdict {
  preferred: Arm | "tie";
  unsupported: Record<Arm, number>;
  checked: Record<Arm, number>;
}

/** Every claim row is counted or refused: a grade the rule cannot read must not vanish from the counts. */
function verdict(grades: string, key: Key): Verdict {
  const choice = /^## Preference\s+(\S+)/m.exec(grades)?.[1] ?? "";
  if (choice !== "A" && choice !== "B" && !/^tie$/i.test(choice)) throw new Error(`unreadable preference: ${choice}`);
  const unsupported = { praxis: 0, baseline: 0 };
  const checked = { praxis: 0, baseline: 0 };
  for (const row of grades.matchAll(/^\| ([AB]) \|.*$/gm)) {
    const cells = row[0].split(/(?<!\\)\|/).map((c) => c.trim());
    const [source = "", grade = ""] = cells.slice(-3, -1);
    if (source === "—") continue;
    const arm = key[row[1] as "A" | "B"];
    if (/^Supported\b/.test(grade)) checked[arm]++;
    else if (/^Not\b/.test(grade)) {
      checked[arm]++;
      unsupported[arm]++;
    } else throw new Error(`claim row without a grade the rule reads: ${row[0]}`);
  }
  return { preferred: choice === "A" || choice === "B" ? key[choice] : "tie", unsupported, checked };
}

function verdictSentence(v: Verdict, usd: Record<Arm, string>, link: (p: string) => string): string {
  if (v.preferred === "praxis") throw new Error("the rule's other branch: the sentence below does not apply");
  const call = `one model call given the same format and search tool, with fewer searches, at ${usd.baseline}`;
  const pipeline = `the pipeline's briefing at ${usd.praxis}`;
  const outcome = v.preferred === "tie" ? `called it a tie between ${call} and ${pipeline}` : `preferred ${call} to ${pipeline}`;
  return (
    `On question 12, a blind review (8 Nov 2026, by Praxis's author; [grades](${link("grades.md")}), [key](${link("key.json")})) ${outcome}. ` +
    `Of one sourced claim checked per section, ${v.unsupported.praxis} of ${v.checked.praxis} in the pipeline's briefing and ` +
    `${v.unsupported.baseline} of ${v.checked.baseline} in the single call's were not supported by their source. ` +
    "Praxis's value over a single call is not demonstrated: n = 1 question, 1 reviewer who wrote Praxis, one run per arm, " +
    "the two runs three days apart on a changing web. " +
    "Next step: more questions, and an ablation of the pipeline's stages."
  );
}

function committed(): { v: Verdict; usd: Record<Arm, string> } {
  const key = JSON.parse(readFileSync(`${DIR}/key.json`, "utf-8")) as Key & { inputs: Record<Arm, string> };
  const cost = (brief: string) => {
    const meta = JSON.parse(readFileSync(brief.replace(/brief\.md$/, "metadata.json"), "utf-8")) as { usage: { total: { cost_usd: number } } };
    return `$${meta.usage.total.cost_usd.toFixed(2)}`;
  };
  return {
    v: verdict(readFileSync(`${DIR}/grades.md`, "utf-8"), key),
    usd: { praxis: cost(key.inputs.praxis), baseline: cost(key.inputs.baseline) },
  };
}

describe("single-call baseline verdict", () => {
  test("the grades and key give the reviewer's preference and claim counts", () => {
    const { v } = committed();
    expect(v.preferred).toBe("baseline");
    expect(v.unsupported).toEqual({ praxis: 3, baseline: 2 });
    expect(v.checked).toEqual({ praxis: 4, baseline: 4 });
  });

  test("a grade the rule cannot read is refused, not dropped", () => {
    const grades = "| A | S | c | [1] | Unavailable — paywall. |\n\n## Preference\n\nB\n";
    expect(() => verdict(grades, { A: "praxis", B: "baseline" })).toThrow(/without a grade/);
  });

  test("a tie names both arms and keeps the same conclusion", () => {
    const v = verdict("| A | S | c | [1] | Not. |\n| B | S | c | — | No claim. |\n\n## Preference\n\ntie\n", { A: "praxis", B: "baseline" });
    expect(v).toEqual({ preferred: "tie", unsupported: { praxis: 1, baseline: 0 }, checked: { praxis: 1, baseline: 0 } });
    const s = verdictSentence(v, { praxis: "$4.75", baseline: "$0.48" }, (f) => f);
    expect(s).toContain("called it a tie between one model call");
    expect(s).toContain("and the pipeline's briefing at $4.75.");
    expect(s).toContain("Praxis's value over a single call is not demonstrated");
  });

  for (const [path, prefix] of [
    ["README.md", "benchmarks/review/q12/"],
    ["docs/SYSTEM_CARD.md", "../benchmarks/review/q12/"],
  ] as const) {
    test(`${path} states the verdict the pre-registered rule gives`, () => {
      const { v, usd } = committed();
      expect(flat(path)).toContain(verdictSentence(v, usd, (f) => `${prefix}${f}`));
      expect(flat(path)).not.toMatch(/blind comparison of the two is prepared|which is better is not reviewed|they are empty or failing/);
    });
  }

  test("README's Status section opens with the verdict and the claim counts", () => {
    const { v } = committed();
    const status = /^## Status\n\n([\s\S]*?)\n## /m.exec(readFileSync("README.md", "utf-8"))?.[1] ?? "";
    const first = status.replace(/\s+/g, " ").split(/(?<=\.) /)[0] ?? "";
    expect(first).toContain("Praxis's value over a single model call is not demonstrated");
    expect(v.preferred).toBe("baseline");
    expect(first).toContain("preferred the single call");
    expect(first).toContain(`${v.unsupported.praxis} of ${v.checked.praxis}`);
    expect(first).toContain(`${v.unsupported.baseline} of ${v.checked.baseline}`);
  });

  for (const path of ["README.md", "docs/SYSTEM_CARD.md"]) {
    test(`${path} names who held the key and which way the bias ran`, () => {
      expect(flat(path)).toContain("key generated and committed by the reviewer the day before grading");
      expect(flat(path)).toContain("blinding is self-enforced");
      expect(flat(path)).toContain("The bias would have favoured Praxis; the result went against it.");
    });
  }

  test("the defence sheet no longer says quality is unreviewed, and gives the verdict", () => {
    const sheet = flat("docs/defense/FICHE_DEFENSE.md");
    expect(sheet).not.toMatch(/Qualité des notes : \*\*non évaluée\*\*|leur qualité n'a pas été évaluée/);
    expect(sheet).toContain("la valeur de Praxis face à un appel unique n'est pas démontrée");
  });
});
