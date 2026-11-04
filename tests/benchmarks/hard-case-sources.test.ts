import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chemistry, checkBrief, renderCheck } from "../../benchmarks/hard-case-sources.ts";
import { completedLiveRuns } from "../../benchmarks/provenance.ts";

describe("chemistry", () => {
  test.each([
    ["Sodium-ion cells reach 175 Wh/kg", "sodium-ion"],
    ["CATL Naxtra Na-ion pack", "sodium-ion"],
    ["LFP vs sodium-ion: the crossover", "sodium-ion"],
    ["Gotion's LFP gigafactory in Kenitra", "other"],
    ["Lithium prices retreat", "other"],
    ["Li-ion cell costs", "other"],
    ["EU Batteries Regulation: where are we now?", "none"],
  ] as const)("%s → %s", (text, expected) => {
    expect(chemistry(text)).toBe(expected);
  });
});

const BRIEF = `# Q

## Situation

Sodium-ion cells cost more than LFP today ([source](https://a.example/lfp-vs-sodium-ion)). Sodium-ion demand in Europe is thin ([x](https://b.example/lithium-prices)). The EU rules apply to every chemistry ([y](https://c.example/regulation)).

**Sources:**

- [LFP vs sodium-ion 2026](https://a.example/lfp-vs-sodium-ion)
- [Lithium prices retreat](https://b.example/lithium-prices)
- [EU Batteries Regulation](https://c.example/regulation)

## Appendix A — Findings

### Finding 1

**Claim:** Sodium-ion plants in Europe are delayed.

**Evidence:** e

**Source:** [Battery plant news](https://d.example/news)

### Finding 2

**Claim:** No sodium-ion offtake was found.

**Evidence:** e

**Source:** _SOURCE_MISSING_ — searched for: \`q\`

## Appendix B — Stakeholders
`;

describe("checkBrief", () => {
  const rows = checkBrief(BRIEF);
  test("every sodium-ion claim is paired with each source it cites, titled from the brief", () => {
    expect(rows.map((r) => [r.where, r.verdict])).toEqual([
      ["Situation", "on sodium-ion"],
      ["Situation", "another chemistry"],
      ["Finding 1", "unclear: read the page"],
      ["Finding 2", "no source"],
    ]);
    expect(rows[1]?.source_title).toBe("Lithium prices retreat");
  });
  test("a claim about no chemistry in particular is not listed", () => {
    expect(rows.some((r) => r.claim.includes("EU rules"))).toBe(false);
  });
  test("the summary counts each verdict and says what the check reads", () => {
    const text = renderCheck("12-x", "run-1", rows);
    expect(text).toContain("4 sodium-ion claim–source pairs: 1 on sodium-ion, 1 another chemistry, 1 unclear, 1 no source");
    expect(text).toContain("from each source's title and URL, not its page");
    expect(text).toContain("| Situation | Sodium-ion demand in Europe is thin. | Lithium prices retreat | another chemistry |");
  });
});

// The CHANGELOG states the counts on the committed record; they must be the check's.
test("the counts the CHANGELOG gives are the check's on question 12's record", () => {
  const run = completedLiveRuns("benchmarks/outputs/live/12-sodium-ion-plant-morocco").at(-1) as string;
  const rows = checkBrief(readFileSync(join(run, "brief.md"), "utf-8"));
  const n = (v: string) => rows.filter((r) => r.verdict === v).length;
  const sentence =
    `${rows.length} pairs, ${n("on sodium-ion")} on sodium-ion, ${n("another chemistry")} on another chemistry, ` +
    `${n("unclear: read the page")} unclear, ${n("no source")} without a source`;
  expect(readFileSync("CHANGELOG.md", "utf-8").replace(/\s+/g, " ")).toContain(sentence);
});
