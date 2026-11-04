#!/usr/bin/env bun
/**
 * Judge–human agreement (docs/live-proof-protocol.md, check 3): the
 * maintainer's blind scores, read back from the annotation file
 * `export:annotation` wrote, against the judge's for the same briefings.
 * Exact and within-one agreement and quadratic-weighted Cohen's kappa over
 * the criterion pairs; kappa ≥ 0.6 makes the judge's scores *indicative*,
 * otherwise they are *unvalidated*. The pairs come from one rater and are
 * not independent, so no interval is given. Free: it reads files only.
 *
 *   bun run agreement -- --human review.jsonl --judge benchmarks/.scoring-cache
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseScoringPayload, SCORING_CRITERIA, type ScoringCriterion } from "./score-all.ts";

export const KAPPA_THRESHOLD = 0.6;
const LEVELS = 5;

type Pair = readonly [human: number, judge: number];

function level(x: number): number {
  if (!Number.isInteger(x) || x < 1 || x > LEVELS) throw new Error(`a rating must be an integer 1–5, got ${x}`);
  return x - 1;
}

/** Quadratic-weighted Cohen's kappa; null when the expected disagreement is 0 (no spread). */
export function quadraticKappa(pairs: readonly Pair[]): number | null {
  const a = new Array<number>(LEVELS).fill(0);
  const b = new Array<number>(LEVELS).fill(0);
  let observed = 0;
  const weight = (i: number, j: number) => ((i - j) / (LEVELS - 1)) ** 2;
  for (const [h, j] of pairs) {
    const [x, y] = [level(h), level(j)];
    a[x] = (a[x] ?? 0) + 1;
    b[y] = (b[y] ?? 0) + 1;
    observed += weight(x, y);
  }
  let expected = 0;
  for (let i = 0; i < LEVELS; i++) for (let j = 0; j < LEVELS; j++) expected += (weight(i, j) * (a[i] ?? 0) * (b[j] ?? 0)) / pairs.length;
  return expected === 0 ? null : 1 - observed / expected;
}

export interface Agreement {
  n: number;
  exact: number;
  within_one: number;
  kappa: number | null;
  meets_threshold: boolean;
}

export function agreement(pairs: readonly Pair[]): Agreement {
  if (pairs.length === 0) throw new Error("no criterion pair to compare");
  const kappa = quadraticKappa(pairs);
  return {
    n: pairs.length,
    exact: pairs.filter(([h, j]) => h === j).length,
    within_one: pairs.filter(([h, j]) => Math.abs(h - j) <= 1).length,
    kappa,
    meets_threshold: kappa !== null && kappa >= KAPPA_THRESHOLD,
  };
}

export interface ScorePair {
  id: string;
  criterion: ScoringCriterion;
  human: number;
  judge: number;
}

interface HumanRecord {
  id: string;
  run: string;
  criteria: { key: string; score: unknown }[];
}

function isHumanRecord(x: unknown): x is HumanRecord {
  const r = x as Partial<HumanRecord> | null;
  return typeof r?.id === "string" && typeof r.run === "string" && Array.isArray(r.criteria);
}

/**
 * The maintainer's annotation file against the judge's scorings: one file per
 * briefing, named `<id>-<run>-live.json` by `score-all.ts`. Each record names
 * the run it reviewed, and only that run's judgment is paired with it: a
 * judgment of another run of the same question grades a different text.
 */
export function pairsFromFiles(humanPath: string, judgeDir: string): ScorePair[] {
  const pairs: ScorePair[] = [];
  const seen = new Set<string>();
  readFileSync(humanPath, "utf-8")
    .split("\n")
    .forEach((line, i) => {
      if (line.trim() === "") return;
      const record: unknown = JSON.parse(line);
      if (!isHumanRecord(record)) throw new Error(`line ${i + 1}: not an annotation record (id, run, criteria)`);
      if (seen.has(record.id)) throw new Error(`${record.id}: reviewed twice`);
      seen.add(record.id);
      pairs.push(...pairsOf(record, judgeDir));
    });
  if (pairs.length === 0) throw new Error(`no review in ${humanPath}`);
  return pairs;
}

function pairsOf(record: HumanRecord, judgeDir: string): ScorePair[] {
  const file = `${record.id}-${record.run}-live.json`;
  if (!existsSync(join(judgeDir, file))) throw new Error(`${record.id}: no judgment of ${record.run} in ${judgeDir}`);
  const cached = JSON.parse(readFileSync(join(judgeDir, file), "utf-8")) as { payload: unknown };
  const judge = parseScoringPayload(cached.payload);
  if (judge.briefing_id !== record.id) throw new Error(`${file} judges ${judge.briefing_id}, not ${record.id}`);
  return SCORING_CRITERIA.map((criterion) => {
    const score = record.criteria.find((c) => c.key === criterion)?.score;
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > LEVELS) {
      throw new Error(`${record.id}: ${criterion} has no score 1–5`);
    }
    return { id: record.id, criterion, human: score, judge: judge.scores[criterion].score };
  });
}

export function renderAgreement(a: Agreement): string {
  const kappa = a.kappa === null ? "kappa undefined (no spread)" : `quadratic-weighted kappa ${a.kappa.toFixed(2)}`;
  const verdict = a.meets_threshold ? "met; the judge's scores are indicative" : "not met; the judge's scores are unvalidated";
  return (
    `Judge–human agreement, n = ${a.n} criterion pairs (one rater, pairs not independent, no interval): ` +
    `exact ${a.exact}/${a.n}, within one point ${a.within_one}/${a.n}, ${kappa}, threshold ${KAPPA_THRESHOLD}: ${verdict}.\n`
  );
}

if (import.meta.main) {
  const arg = (name: string) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? undefined : process.argv[at + 1];
  };
  const human = arg("--human");
  const judge = arg("--judge");
  if (human === undefined || judge === undefined) {
    process.stderr.write("usage: bun run agreement -- --human review.jsonl --judge benchmarks/.scoring-cache\n");
    process.exit(2);
  }
  const pairs = pairsFromFiles(human, judge);
  process.stdout.write(renderAgreement(agreement(pairs.map((p) => [p.human, p.judge] as const))));
}
