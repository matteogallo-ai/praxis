/**
 * docs/SLO.md holds targets set from intended use. Met or not met is
 * published only from live measurements; an estimate is shown, never a status.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { estimateRun } from "../../benchmarks/estimate-cost.ts";
import { stageLimits } from "../../src/agents/stage-limits.ts";
import { DEFAULT_PRICE_TABLE } from "../../src/llm/pricing.ts";
import { byCommit, countWord, days, liveRecords, questionsOf } from "./live-records.ts";
import { protocolParts } from "../benchmarks/protocol-plan.ts";

const doc = readFileSync("docs/SLO.md", "utf-8");
const flat = doc.replace(/\s+/g, " ");
const usd = (n: number) => `$${n.toFixed(2)}`;
/**
 * The cost target is set from intended use. It is written here as well as in
 * the doc so that raising it to fit the estimate takes a visible test change.
 */
const COST_TARGET_USD = 10;
const ANALYST_USD_PER_HOUR = 60;
const FIVE = [
  "02-cfo-buyback-briefing",
  "05-supply-chain-acquisition",
  "08-ai-regulation-position",
  "11-family-office-co-investment",
  "12-sodium-ion-plant-morocco",
];

describe("docs/SLO.md", () => {
  const [q05] = estimateRun(".", ["05-supply-chain-acquisition"]).rows;
  const five = estimateRun(".", FIVE).rows;

  describe("measurements, from the committed live run records", () => {
    const { failures, completions } = liveRecords();
    const listed = (f: (c: (typeof completions)[number]) => string) => {
      const all = completions.map(f);
      return all.length < 2 ? all.join("") : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
    };
    const nSmall = `on n = ${completions.length} (${days(completions)}); n too small, no status`;
    const count = countWord(completions.length);

    // Too few runs for a p95: each measurement is listed. At 20 this fails,
    // and the rows must state a p95 over n instead.
    test("the completed briefings are named, and too few for a p95", () => {
      expect(completions.length).toBeLessThan(20);
      const capital = count.charAt(0).toUpperCase() + count.slice(1);
      expect(flat).toContain(`**${capital} live briefings have completed** (${questionsOf(completions)}, ${days(completions)};`);
    });

    test("cost: the measurements, no status, the estimate beside them", () => {
      expect(doc).toContain(
        `| Cost | p95 ≤ ${usd(COST_TARGET_USD)} per briefing | ${listed((c) => usd(c.cost_usd))} ${nSmall}; estimate for question 05, not a status: ${usd(q05?.low ?? 0)} low, ${usd(q05?.central ?? 0)} central, ${usd(q05?.high ?? 0)} high |`
      );
      expect(flat).not.toMatch(/\| Cost \|[^|]*\|[^|]*\b(not met|met)\b/i);
    });

    test("latency: the measurements, no status", () => {
      expect(doc).toContain(
        `| Latency | p95 ≤ 10 minutes per briefing | ${listed((c) => (c.stages_ms / 60_000).toFixed(1))} min ${nSmall} |`
      );
    });

    test("error rate: failures by commit of the code, never pooled across commits", () => {
      const rows = byCommit()
        .map((g) => `${g.sha} ${g.attempts - g.completed} of ${g.attempts}`)
        .join(", ");
      expect(doc).toContain(
        `| Error rate | ≤ 10% of started briefings end in an error | errors by commit, failed of started: ${rows} (failed ${days(failures)}: ${failures.map((f) => f.type).join(", ")}); the five aborted runs of 1.2.1 predate the records; n too small, no status |`
      );
      expect(doc).not.toContain("since run records began");
    });
  });

  test("grounds the cost target in the analyst time a briefing replaces", () => {
    expect(flat).toContain("must cost less than 10 minutes of the time of the analyst it replaces");
    expect(COST_TARGET_USD * 6).toBe(ANALYST_USD_PER_HOUR);
    expect(flat).toContain(`priced at $${ANALYST_USD_PER_HOUR} an hour`);
    expect(flat).toContain(`${usd(COST_TARGET_USD)} for 10 minutes is ${usd(ANALYST_USD_PER_HOUR)} an hour`);
  });

  test("states the central range of the five protocol questions", () => {
    const c = five.map((r) => r.central);
    expect(flat).toContain(`the five protocol questions range from ${usd(Math.min(...c))} to ${usd(Math.max(...c))} central`);
  });

  test("its per-run caps are the protocol's, and none is below a central estimate", () => {
    // The plan's caps; an amendment adds questions under the same caps.
    const caps = [...protocolParts().plan.matchAll(/bun run bench:live -- --max-cost-usd (\d+)/g)].map((m) => Number(m[1]));
    expect(caps.length).toBe(2);
    expect(flat).toContain(`$${caps[0]} for the first live briefing, $${caps[1]} for each of the next four`);
    for (const cap of caps) expect(cap).toBeGreaterThanOrEqual(Math.max(...five.map((r) => r.central)));
  });

  describe("its ceilings are computed from the stage limits", () => {
    const model = (stage: string) =>
      readFileSync(`prompts/${stage}.prompt`, "utf-8").match(/^@model\s+(\S+)/m)?.[1] as string;
    const outputUsd = (stage: string) =>
      (stageLimits(stage).maxTokens * (DEFAULT_PRICE_TABLE.models[model(stage)]?.output ?? Number.NaN)) / 1e6;
    const minutes = (stage: string) => stageLimits(stage).timeoutMs / 60_000;
    const search = ["research", "stakeholder", "risk", "options"];
    const SECTIONS = 6;

    test("output", () => {
      const once = outputUsd("scoping") + search.reduce((a, s) => a + outputUsd(s), 0) + SECTIONS * outputUsd("synthesis");
      const five = outputUsd("scoping") + 5 * search.reduce((a, s) => a + outputUsd(s), 0) + SECTIONS * outputUsd("synthesis");
      expect(flat).toContain(`one round per stage costs at most ${usd(once)}`);
      expect(flat).toContain(`the ceiling is ${usd(five)}`);
      const searchFive = (5 * search.length * 5 * DEFAULT_PRICE_TABLE.web_search_per_1000) / 1000;
      expect(flat).toContain(`and 100 with five (${usd(searchFive)})`);
      expect(flat).toContain(`the output and search ceilings add up to ${usd(five + searchFive)}, under the target`);
    });

    test("latency", () => {
      const once = minutes("scoping") + search.reduce((a, s) => a + minutes(s), 0) + minutes("synthesis");
      const five = minutes("scoping") + 5 * search.reduce((a, s) => a + minutes(s), 0) + minutes("synthesis");
      expect(flat).toContain(`the request timeouts add up to ${once} minutes with one round per stage, ${five} minutes with five`);
    });
  });
});
