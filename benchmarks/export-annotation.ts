#!/usr/bin/env bun
/**
 * Exports live briefings for the maintainer's blind review: one JSON object
 * per line with the question, the format, the brief's Markdown and the
 * seven rubric criteria to score 1–5 (`docs/benchmarking-methodology.md`).
 * Nothing the judge wrote is read, so the reviewer cannot anchor on it.
 * Only live briefings: mock text is fixture output and is never reviewed for
 * quality.
 *
 *   bun run export:annotation -- --ids 05-supply-chain-acquisition,02-cfo-buyback-briefing > review.jsonl
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadManifest } from "./manifest.ts";
import { SCORING_CRITERIA, type ScoringCriterion } from "./score-all.ts";

const DEFINITIONS: Record<ScoringCriterion, string> = {
  framing_clarity: "Is the question stated, and the reader oriented, in the first paragraph?",
  non_hedging: 'Does the brief commit, or hedge with "may", "could", "arguably"?',
  decisive_recommendation: "Is there a clear call to action?",
  concrete_tradeoffs: "Are cost, time and exposure dimensioned?",
  perceived_sourcing: "Do the citations look credible to a senior reader?",
  adversarial_usefulness: "Does the critique steelman real objections?",
  format_fidelity: "Does it read like the target format?",
};

export interface AnnotationRecord {
  id: string;
  question: string;
  format: string;
  brief_markdown: string;
  scale: "1-5";
  criteria: { key: ScoringCriterion; definition: string; score: null; note: string }[];
}

export function annotationRecords(root: string, ids: readonly string[]): AnnotationRecord[] {
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repeated.length > 0) throw new Error(`--ids names ${repeated.join(", ")} twice`);
  const manifest = loadManifest(join(root, "benchmarks", "questions.yaml"));
  return ids.map((id) => {
    const entry = manifest.benchmarks.find((b) => b.id === id);
    if (entry === undefined) throw new Error(`${id}: not in questions.yaml`);
    const brief = join(root, "benchmarks", "outputs", "live", id, "brief.md");
    if (!existsSync(brief)) throw new Error(`${id}: no live briefing at ${brief}`);
    return {
      id,
      question: entry.question,
      format: entry.format,
      brief_markdown: readFileSync(brief, "utf-8"),
      scale: "1-5",
      criteria: SCORING_CRITERIA.map((key) => ({ key, definition: DEFINITIONS[key], score: null, note: "" })),
    };
  });
}

export function toJsonl(records: readonly AnnotationRecord[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join("");
}

if (import.meta.main) {
  const at = process.argv.indexOf("--ids");
  const list = at === -1 ? undefined : process.argv[at + 1];
  if (list === undefined || list.length === 0) {
    process.stderr.write("usage: bun run export:annotation -- --ids <id,id> > review.jsonl\n");
    process.exit(2);
  }
  process.stdout.write(toJsonl(annotationRecords(resolve(import.meta.dir, ".."), list.split(","))));
}
