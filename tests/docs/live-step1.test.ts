/**
 * The step 1 table in benchmarks/outputs/live/README.md is read from the run
 * records and from the estimate frozen at the run's commit, so no figure in
 * it can drift from what was measured or estimated.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { estimateRun } from "../../benchmarks/estimate-cost.ts";
import { provenance } from "../../benchmarks/provenance.ts";
import { loadSplit } from "../../benchmarks/split.ts";
import { protocolParts } from "../benchmarks/protocol-plan.ts";

const LIVE = "benchmarks/outputs/live";
const doc = readFileSync(`${LIVE}/README.md`, "utf-8");
const flat = doc.replace(/\s+/g, " ");
const IDS = [
  "02-cfo-buyback-briefing",
  "08-ai-regulation-position",
  "10-esg-position",
  "11-family-office-co-investment",
  "12-sodium-ion-plant-morocco",
];

interface Sourcing {
  total_items: number;
  counts: { ok: number; untrusted: number; missing: number; duplicated: number; stale: number };
  insufficiently_sourced: boolean;
  freshness_unknown?: number;
  requester_provided?: number;
  first_party_sources?: unknown[];
  untrusted_citations?: { stage: string }[];
}
interface Record_ {
  format: string;
  sourcing?: Sourcing;
  error_type?: string;
  provenance: { git_sha: string; prompts: Record<string, { sha256: string }> };
  usage: { total: { cost_usd: number; duration_ms: number }; stages: Record<string, { duration_ms?: number; calls: number }> };
}

/** The question's step 1 record: its completed run, or its failure. */
function record(id: string): Record_ {
  const dir = join(LIVE, id);
  const name = readdirSync(dir)
    .filter((f) => f.startsWith("run-2026-11-04T1") || f.startsWith("error-2026-11-04T1"))
    .sort()[0] as string;
  const path = name.startsWith("run-") ? join(dir, name, "metadata.json") : join(dir, name);
  return JSON.parse(readFileSync(path, "utf-8")) as Record_;
}
const records = IDS.map(record);
const frozen = JSON.parse(readFileSync("benchmarks/estimates/step-1.json", "utf-8")) as {
  git_sha: string;
  rows: { id: string; low: number; central: number; high: number }[];
  total: { low: number; central: number; high: number };
};
const usd = (n: number) => `$${n.toFixed(2)}`;
const row = (label: string, cells: (string | number)[]) => `| ${label} | ${cells.join(" | ")} |`;
const each = (f: (s: Sourcing) => string | number) => records.map((r) => (r.sourcing === undefined ? "—" : f(r.sourcing)));

describe("step 1: the table is the records'", () => {
  test("every record ran on one commit, the one the frozen estimate names", () => {
    for (const r of records) expect(r.provenance.git_sha).toBe(frozen.git_sha);
    expect(doc).toContain(`all five at \`${frozen.git_sha.slice(0, 7)}\``);
  });

  test("the amendment's commit time precedes q10's run start by the seconds stated", () => {
    const run = readdirSync(join(LIVE, "10-esg-position")).find((f) => f.startsWith("run-2026-11-04T1")) ?? "";
    expect(run).toMatch(/^run-2026-11-04T\d\d-\d\d-\d\d-\d+Z$/);
    const started = Date.parse(run.slice(4).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, "T$1:$2:$3.$4Z"));
    const seconds = Math.floor((started - Date.parse("2026-11-04T13:02:53Z")) / 1000);
    expect(flat).toContain(`(commit 0417613, 13:02:53Z), ${seconds} s before q10 itself ran`);
  });

  test("outcome and sourcing counts", () => {
    expect(doc).toContain(row("Format", records.map((r) => `\`${r.format}\``)));
    expect(doc).toContain(row("Outcome", records.map((r) => (r.error_type === undefined ? "completed" : `failed: \`${r.error_type}\``))));
    expect(doc).toContain(row("Items", each((s) => s.total_items)));
    expect(doc).toContain(row("Sourced from a trusted domain (`ok`)", each((s) => s.counts.ok)));
    expect(doc).toContain(row("From an untrusted domain", each((s) => s.counts.untrusted)));
    expect(doc).toContain(row("Without a source (`missing`)", each((s) => s.counts.missing)));
    expect(doc).toContain(row("Duplicated", each((s) => s.counts.duplicated)));
    expect(doc).toContain(row("Stale or aging (`stale`)", each((s) => s.counts.stale)));
    expect(doc).toContain(row("Freshness unknown (no publication date)", each((s) => s.freshness_unknown ?? -1)));
    expect(doc).toContain(row("Requester-provided, not sourceable", each((s) => s.requester_provided ?? -1)));
    expect(doc).toContain(row("First-party sources (ADR 0003)", each((s) => (s.first_party_sources ?? []).length)));
    const by = (s: Sourcing, stage: string) => (s.untrusted_citations ?? []).filter((c) => c.stage === stage).length;
    expect(doc).toContain(
      row("Options' and critique's untrusted citations", each((s) => `${by(s, "options")} options, ${by(s, "adversarial")} critique`))
    );
    const test_ = new Set(loadSplit(".").test);
    expect(doc).toContain(row("Held-out (test split)", IDS.map((id) => (test_.has(id) ? "yes, spent by this run" : "no"))));
    expect(doc).toContain(row("Flagged insufficiently sourced", each((s) => (s.insufficiently_sourced ? "yes" : "no"))));
  });

  test("cost against the frozen estimate, and time", () => {
    const est = IDS.map((id) => frozen.rows.find((r) => r.id === id) as (typeof frozen.rows)[number]);
    expect(doc).toContain(row("Cost", records.map((r) => usd(r.usage.total.cost_usd))));
    expect(doc).toContain(row("Estimate: low / central / high", est.map((e) => `${usd(e.low)} / ${usd(e.central)} / ${usd(e.high)}`)));
    expect(doc).toContain(row("Cost / central estimate", records.map((r, i) => (r.usage.total.cost_usd / (est[i]?.central ?? 1)).toFixed(2))));
    // A failure record keeps no per-stage time, only the time to the failure.
    const minutes = (r: Record_) =>
      r.error_type === undefined
        ? `${(Object.values(r.usage.stages).reduce((a, s) => a + (s.duration_ms ?? 0), 0) / 60_000).toFixed(1)} min`
        : `${(r.usage.total.duration_ms / 60_000).toFixed(1)} min to the failure`;
    expect(doc).toContain(row("Stages' wall time", records.map(minutes)));
    const total = records.reduce((a, r) => a + r.usage.total.cost_usd, 0);
    const amended = protocolParts().amendments.match(/--max-cost-usd (\d+) --ids (\S+)/);
    const cap = Number(amended?.[1]);
    expect(amended?.[2]?.split(",").sort()).toEqual(IDS);
    expect(flat).toContain(`each capped at ${usd(cap).replace(".00", "")}`);
    const sentence = `Step 1 spent ${usd(total)} in all, against a central estimate of ${usd(frozen.total.central)} and a cap of ${usd(cap * IDS.length).replace(".00", "")}`;
    expect(flat).toContain(sentence);
    expect(readFileSync("CHANGELOG.md", "utf-8").replace(/\s+/g, " ")).toContain(
      `${usd(total)} spent against a ${usd(frozen.total.central)} central estimate`
    );
    const ratios = records.filter((r) => r.error_type === undefined).map((r) => r.usage.total.cost_usd / (est[records.indexOf(r)]?.central ?? 1));
    expect(flat).toContain(
      `cost between ${Math.min(...ratios).toFixed(2)} and ${Math.max(...ratios).toFixed(2)} of its central estimate`
    );
  });

  test("question 10's first-party sources, as the prose names them", () => {
    const fp = ((records[2] as Record_).sourcing?.first_party_sources ?? []) as { organisation: string }[];
    expect(flat).toContain(`cites ${["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][fp.length]} first-party sources`);
    expect([...new Set(fp.map((f) => f.organisation))].sort()).toEqual([
      "EFRAG",
      "Financial Conduct Authority",
      "GHG Protocol",
      "IFRS Foundation",
    ]);
    const unknown = records.flatMap((r) => (r.sourcing === undefined ? [] : [r.sourcing.freshness_unknown ?? 0]));
    expect(flat).toContain(`${Math.min(...unknown)} to ${Math.max(...unknown)} cited items per briefing have no publication date`);
  });

  // q02's format has no strict editorial pass, so a seventh call is the one
  // retry of a refused section; q11's format regenerates under strict editorial.
  test("question 02's synthesis calls: six sections and one retry", () => {
    const calls = (r: Record_) => r.usage.stages["synthesis"]?.calls ?? 0;
    const sections = (r: Record_) =>
      (readFileSync(`formats/${r.format}.yaml`, "utf-8").match(/^ {2}- id:/gm) ?? []).length;
    const strict = (r: Record_) => /^\s*strict_editorial:\s*true\b/m.test(readFileSync(`formats/${r.format}.yaml`, "utf-8"));
    const q02 = records[0] as Record_;
    expect(strict(q02)).toBe(false);
    expect(calls(q02)).toBe(sections(q02) + 1);
    const plain = records.slice(1).filter((r) => !strict(r));
    for (const r of plain) expect(calls(r)).toBe(sections(r));
    expect(flat).toContain(`${calls(q02)} synthesis calls for ${sections(q02)} sections`);
  });

  test("the slowest briefing is named against the latency target", () => {
    const done = records.map((r, i) => ({ id: IDS[i] as string, r })).filter((x) => x.r.error_type === undefined);
    const min = (r: Record_) => Object.values(r.usage.stages).reduce((a, s) => a + (s.duration_ms ?? 0), 0) / 60_000;
    const over = done.filter((x) => min(x.r) > 10);
    expect(over.map((x) => x.id)).toEqual(["12-sodium-ion-plant-morocco"]);
    const slow = over[0] as (typeof over)[number];
    expect(flat).toContain(`Question 12 took ${min(slow.r).toFixed(1)} min of stages, above the 10-minute latency target`);
    expect(readFileSync("docs/SLO.md", "utf-8").replace(/\s+/g, " ")).toContain(
      `question 12's ${min(slow.r).toFixed(1)} min of stages is above the latency target`
    );
  });

  // The record says #42 changed the quote; the code must hold that change.
  test("the whole-address quote it cites is in the code", () => {
    expect(flat).toContain("Since #42 the error quotes the whole address, cut at 200 characters");
    const code = readFileSync("src/agents/synthesis.ts", "utf-8");
    expect(code).toContain("const QUOTE_MAX = 200;");
    expect(code).not.toContain('[/\\bwww\\./i, "a www. address');
  });

  // While the prompts are the run's, the frozen file must be what estimate:cost
  // prints; once a prompt changes, the frozen file keeps the run-time estimate.
  test("the frozen estimate is estimate:cost's, while the prompts are the run's", () => {
    const now = provenance(".").prompts;
    const run = (records[1] as Record_).provenance.prompts;
    const same = Object.keys(run).every((k) => now[k]?.sha256 === run[k]?.sha256);
    // Never edit benchmarks/estimates/step-1.json to make this pass: it is the
    // estimate the run was approved on. If an input other than the prompts
    // changed (mock metadata, token counts, prices, stage limits), narrow
    // this guard to the prompts' run-time state instead.
    if (!same) return;
    const round = (n: number) => Math.round(n * 100) / 100;
    expect(estimateRun(".", IDS).rows.map((r) => ({ id: r.id, low: round(r.low), central: round(r.central), high: round(r.high) }))).toEqual(
      frozen.rows
    );
  });
});
