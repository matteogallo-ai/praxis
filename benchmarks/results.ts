#!/usr/bin/env bun
/**
 * Writes benchmarks/RESULTS.md from committed artefacts only: the live run
 * records under benchmarks/outputs/live/ and the judgments under
 * benchmarks/judgments/ (methodology point 4). CI runs `--check`, so the page
 * cannot drift from the data. A score is labelled indicative only when the
 * committed human review agrees with the judge at the protocol's threshold.
 *
 *   bun run results            # rewrite RESULTS.md
 *   bun run results -- --check # exit 1 if RESULTS.md is not what the artefacts give
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { agreement, pairsFromFiles, renderAgreement } from "./agreement.ts";
import { completedLiveRuns } from "./provenance.ts";
import { CRITERION_LABELS, parseScoringPayload, SCORING_CRITERIA } from "./score-all.ts";

interface RunMetadata {
  format: string;
  usage: { total: { cost_usd: number }; stages: Record<string, { duration_ms?: number }> };
  sourcing?: {
    total_items: number;
    counts: { ok: number; untrusted: number; missing: number; stale: number; duplicated: number };
    insufficiently_sourced: boolean;
  };
}
interface FailureRecord {
  failed_at: string;
  format: string;
  error_type: string;
  usage: { total: { cost_usd: number } };
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf-8")) as T;

/**
 * The test list of split.yaml as `bun run bench:split` writes it. Whether the
 * split is current against the manifest is `loadSplit`'s check and has its
 * own test; this page reports membership only, and refuses a file it cannot
 * read rather than marking every run "no".
 */
function testSplit(root: string): Set<string> {
  const path = join(root, "benchmarks", "split.yaml");
  if (!existsSync(path)) throw new Error(`${path}: missing; run \`bun run bench:split\``);
  const block = /^test:\r?\n((?:[ \t]+-.*\r?\n?)+)/m.exec(readFileSync(path, "utf-8"))?.[1];
  if (block === undefined) throw new Error(`${path}: no test list`);
  return new Set([...block.matchAll(/-\s*"?([^"\r\n]+?)"?\s*$/gm)].map((m) => m[1] as string));
}

// The maintainer's decision, recorded in docs/live-proof-protocol.md, not in
// any artefact: split.yaml still lists q05 under test, and the page must not
// let that column read as held-out.
const USED_FOR_DEVELOPMENT = "05-supply-chain-acquisition";

function liveSection(root: string): string[] {
  const live = join(root, "benchmarks", "outputs", "live");
  const questions = existsSync(live)
    ? readdirSync(live, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];
  const runs = questions.flatMap((id) => completedLiveRuns(join(live, id)).map((dir) => ({ id, dir })));
  const failures = questions.flatMap((id) =>
    readdirSync(join(live, id))
      .filter((f) => /^error-.*\.json$/.test(f))
      .sort()
      .map((f) => ({ id, record: readJson<FailureRecord>(join(live, id, f)) }))
  );
  const held = testSplit(root);
  const lines = [
    "## Live briefings",
    "",
    `${plural(runs.length, "live briefing", "live briefings")} completed and ${plural(failures.length, "attempt", "attempts")} failed with a record (\`benchmarks/outputs/live/\`). The five attempts of v1.2.1 (August 2026) aborted before any record was written; their causes are in the CHANGELOG under 1.2.1. Status: q05 used for development after step 0; no longer held-out.`,
    "",
    "| Question | Run | Format | Test split | Cost | Stages' time | Items | `ok` | Untrusted | Missing | Stale | Duplicated | Flagged insufficiently sourced |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const { id, dir } of runs) {
    const m = readJson<RunMetadata>(join(dir, "metadata.json"));
    const minutes = Object.values(m.usage.stages).reduce((a, s) => a + (s.duration_ms ?? 0), 0) / 60_000;
    const s = m.sourcing;
    const sourcing =
      s === undefined
        ? ["—", "—", "—", "—", "—", "—", "—"]
        : [s.total_items, s.counts.ok, s.counts.untrusted, s.counts.missing, s.counts.stale, s.counts.duplicated, s.insufficiently_sourced ? "yes" : "no"];
    const split = !held.has(id) ? "no" : id === USED_FOR_DEVELOPMENT ? "yes, used for development" : "yes";
    const cells = [id, basename(dir), m.format, split, usd(m.usage.total.cost_usd), `${minutes.toFixed(1)} min`, ...sourcing];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  if (failures.length > 0) {
    lines.push("", "| Question | Failed at | Format | Cause | Spent |", "| --- | --- | --- | --- | ---: |");
    for (const { id, record: r } of failures) {
      lines.push(`| ${id} | ${r.failed_at} | ${r.format} | \`${r.error_type}\` | ${usd(r.usage.total.cost_usd)} |`);
    }
  }
  lines.push(
    "",
    "Cost is the tokens and searches the API reported, at the price table in `src/llm/pricing.ts`; it is not an invoice. Stages' time is the sum of the stages' durations. An item counts under one status (`ok`, untrusted, missing, stale, duplicated), so the five add up to Items."
  );
  return lines;
}

function scoreSection(root: string): string[] {
  const dir = join(root, "benchmarks", "judgments");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^.+-run-.+-live\.json$/.test(f)).sort() : [];
  if (files.length === 0) {
    return [
      "## Scores",
      "",
      "No judge score is published: no live briefing has been judged by a model. One human blind comparison exists, on question 12 against a single model call: [`review/q12/grades.md`](review/q12/grades.md), verdict in [`docs/SYSTEM_CARD.md`](../docs/SYSTEM_CARD.md). The judge (`bun run score:live`, paid, run only on approval) writes each judgment to `benchmarks/judgments/`; this page publishes them once they are committed.",
    ];
  }
  const human = join(dir, "human-review.jsonl");
  const agreed = existsSync(human) ? agreement(pairsFromFiles(human, dir).map((p) => [p.human, p.judge] as const)) : null;
  const lines = [
    `## Scores (${agreed?.meets_threshold ? "indicative" : "unvalidated"})`,
    "",
    `n = ${plural(files.length, "judged briefing", "judged briefings")}, one judgment each: the judge's own variance is not measured, so a one-point gap between two briefings is not a difference.`,
    "",
    `| Briefing | Run | ${SCORING_CRITERIA.map((c) => CRITERION_LABELS[c]).join(" | ")} | Total /35 |`,
    `| --- | --- | ${SCORING_CRITERIA.map(() => "---:").join(" | ")} | ---: |`,
  ];
  for (const f of files) {
    const at = f.indexOf("-run-");
    const payload = parseScoringPayload(readJson<{ payload: unknown }>(join(dir, f)).payload);
    const scores = SCORING_CRITERIA.map((c) => payload.scores[c].score);
    lines.push(`| ${f.slice(0, at)} | ${f.slice(at + 1, -"-live.json".length)} | ${scores.join(" | ")} | ${payload.total} |`);
  }
  lines.push(
    "",
    agreed === null
      ? "No human review is committed (`benchmarks/judgments/human-review.jsonl`), so the judge's agreement with a human is not measured and the scores are unvalidated (methodology point 3)."
      : renderAgreement(agreed).trim()
  );
  return lines;
}

const STATIC = `## Renderer smoke test (no model involved)

\`bun run bench:mock\` runs the 12 entries of \`questions.yaml\` through the full
pipeline on the mock provider and writes \`brief.md\`, \`brief.pdf\`,
\`brief.docx\` and \`metadata.json\` for each under \`benchmarks/outputs/mock/\`.
It proves that every stage, the sourcing checks and the three renderers are
wired together, and that the output is reproducible byte for byte
([\`docs/CLAIMS.md\`](../docs/CLAIMS.md) C03, C08, C12).

It is not a quality measure: the mock provider replays hand-written fixtures
chosen by format, not by question, so a score on its output grades the
fixtures and not a model.

## Withdrawn

The "AI-assisted qualitative scoring" published here on 2026-08-20 scored the
11 mock briefings of that date with a Claude model. For the reason just given it
measured the fixtures, and it is withdrawn; \`benchmarks/score-all.ts\` now
refuses mock briefings. The scoring method for live briefings is described in
[\`docs/benchmarking-methodology.md\`](../docs/benchmarking-methodology.md).
`;

export function renderResults(root: string): string {
  return [
    "# Benchmark results",
    "",
    "<!-- Generated by `bun run results` from the committed artefacts; CI runs `bun run results -- --check`. Do not edit by hand. -->",
    "",
    ...liveSection(root),
    "",
    ...scoreSection(root),
    "",
    STATIC,
  ].join("\n");
}

/** Null when RESULTS.md is what the artefacts give; otherwise what to run. */
export function checkResults(root: string): string | null {
  const path = join(root, "benchmarks", "RESULTS.md");
  const current = existsSync(path) ? readFileSync(path, "utf-8") : "";
  return current === renderResults(root)
    ? null
    : "benchmarks/RESULTS.md is not what the artefacts give: run `bun run results` and commit it.";
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  if (process.argv.includes("--check")) {
    const problem = checkResults(root);
    if (problem !== null) {
      process.stderr.write(`${problem}\n`);
      process.exit(1);
    }
    process.stdout.write("results: RESULTS.md matches the artefacts\n");
  } else {
    writeFileSync(join(root, "benchmarks", "RESULTS.md"), renderResults(root));
    process.stdout.write("wrote benchmarks/RESULTS.md\n");
  }
}
