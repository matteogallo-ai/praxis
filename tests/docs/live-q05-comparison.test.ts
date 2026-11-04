/**
 * The step 0 / rerun table in benchmarks/outputs/live/README.md is read from
 * the two records, so a figure in it cannot drift from what was measured.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const DIR = "benchmarks/outputs/live/05-supply-chain-acquisition";
const doc = readFileSync("benchmarks/outputs/live/README.md", "utf-8");

interface Sourcing {
  total_items: number;
  counts: { ok: number; untrusted: number; missing: number; duplicated: number; stale: number };
  insufficiently_sourced: boolean;
  freshness_unknown?: number;
  requester_provided?: number;
  untrusted_citations?: { stage: string }[];
}
interface Meta {
  sourcing: Sourcing;
  usage: { total: { cost_usd: number }; stages: Record<string, { duration_ms: number }> };
}
const meta = (run: string) => JSON.parse(readFileSync(`${DIR}/${run}/metadata.json`, "utf-8")) as Meta;
const step0 = meta("run-2026-11-04T08-33-09-131Z");
const rerun = meta("run-2026-11-04T10-52-05-822Z");
const row = (label: string, a: string | number, b: string | number) => `| ${label} | ${a} | ${b} |`;
const minutes = (m: Meta) => `${(Object.values(m.usage.stages).reduce((s, x) => s + x.duration_ms, 0) / 60_000).toFixed(1)} min`;

describe("question 05: step 0 and its rerun", () => {
  test("the counts are the records'", () => {
    const [a, b] = [step0.sourcing, rerun.sourcing];
    expect(doc).toContain(row("Items", a.total_items, b.total_items));
    expect(doc).toContain(row("Sourced from a trusted domain (`ok`)", a.counts.ok, b.counts.ok));
    expect(doc).toContain(row("From an untrusted domain", a.counts.untrusted, b.counts.untrusted));
    expect(doc).toContain(row("Without a source (`missing`)", a.counts.missing, b.counts.missing));
    expect(doc).toContain(row("Duplicated", a.counts.duplicated, b.counts.duplicated));
    expect(doc).toContain(`| Stale or aging (\`stale\`) | ${a.counts.stale}, not measured (see Errata) | ${b.counts.stale}:`);
    expect(doc).toContain(row("Freshness unknown (no publication date)", "not recorded", b.freshness_unknown ?? -1));
    expect(doc).toContain(row("Requester-provided, not sourceable", "not recorded", b.requester_provided ?? -1));
    const by = (stage: string) => (b.untrusted_citations ?? []).filter((c) => c.stage === stage).length;
    expect(doc).toContain(
      row("Options' and critique's untrusted citations", "not checked", `${by("options")} options, ${by("adversarial")} critique`)
    );
    expect([a.insufficiently_sourced, b.insufficiently_sourced]).toEqual([true, true]);
  });

  test("cost and time are the records'", () => {
    const usd = (m: Meta) => `$${m.usage.total.cost_usd.toFixed(2)}`;
    expect(doc).toContain(row("Cost", usd(step0), usd(rerun)));
    expect(doc).toContain(row("Stages' wall time", minutes(step0), minutes(rerun)));
  });

  test("step 0 recorded none of the fields the fixes added", () => {
    expect(step0.sourcing.freshness_unknown).toBeUndefined();
    expect(step0.sourcing.requester_provided).toBeUndefined();
    expect(step0.sourcing.untrusted_citations).toBeUndefined();
  });
});
