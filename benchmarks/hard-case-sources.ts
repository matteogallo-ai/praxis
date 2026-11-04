#!/usr/bin/env bun
/**
 * The hard case's per-source check (question 12, `intent` in
 * questions.yaml): does each sodium-ion claim cite a source about
 * sodium-ion, or one about another chemistry (the trap: Morocco has much on
 * lithium-ion and little on sodium-ion)? It reads the latest completed live
 * brief: each sentence of the model's sections that cites a source, and
 * each research finding. A source's chemistry is read from its title and
 * URL, not from its page, so "unclear" rows are for a human to open. Free:
 * it reads files only, and reports; it fails nothing.
 *
 *   bun run hard-case:sources [-- --id 12-sodium-ion-plant-morocco]
 */
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { completedLiveRuns } from "./provenance.ts";

export type Chemistry = "sodium-ion" | "other" | "none";
export type Verdict = "on sodium-ion" | "another chemistry" | "unclear: read the page" | "no source";

const SODIUM = /sodium|\bna[- ]?ion\b|naxtra/i;
const OTHER = /lithium|\bli[- ]?ion\b|\blfp\b|\bnmc\b|\blifepo4\b|solid[- ]state/i;

/** Sodium-ion wins: a page comparing LFP with sodium-ion is about sodium-ion too. */
export function chemistry(text: string): Chemistry {
  if (SODIUM.test(text)) return "sodium-ion";
  return OTHER.test(text) ? "other" : "none";
}

export interface Row {
  where: string;
  claim: string;
  source_title: string | null;
  url: string | null;
  verdict: Verdict;
}

const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
/** Sections after these are written by code or list sources, not the model's argument. */
const NOT_PROSE = /^(Table of Contents|Requester-provided|Insufficiently sourced|Adversarial Critique|Appendix [B-Z]|Sources|First-party sources)/;

function verdictFor(title: string | null, url: string | null): Verdict {
  if (url === null) return "no source";
  const c = chemistry(`${title ?? ""} ${url}`);
  return c === "sodium-ion" ? "on sodium-ion" : c === "other" ? "another chemistry" : "unclear: read the page";
}

/** The sentence as a reader sees it: a "([source](url))" aside dropped, other links as their text. */
function plain(sentence: string): string {
  return sentence.replace(/\s*\(\[[^\]]*\]\([^)\s]+\)\)/g, "").replace(LINK, "$1").trim();
}

export function checkBrief(markdown: string): Row[] {
  const titles = new Map<string, string>();
  for (const m of markdown.matchAll(/^(?:- |\*\*Source:\*\* )\[([^\]]*)\]\(([^)\s]+)\)/gm)) titles.set(m[2] as string, m[1] as string);
  const rows: Row[] = [];
  const add = (where: string, claim: string, url: string | null) => {
    if (chemistry(claim) !== "sodium-ion") return;
    const source_title = url === null ? null : (titles.get(url) ?? null);
    rows.push({ where, claim, source_title, url, verdict: verdictFor(source_title, url) });
  };

  let section = "";
  let finding = "";
  let claim = "";
  let inComment = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("<!--")) inComment = true;
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    const h2 = /^## (.*)$/.exec(line);
    if (h2) {
      section = h2[1] as string;
      continue;
    }
    const h3 = /^### (Finding \d+)/.exec(line);
    if (h3) {
      finding = h3[1] as string;
      continue;
    }
    if (section.startsWith("Appendix A")) {
      const c = /^\*\*Claim:\*\* (.*)$/.exec(line);
      if (c) claim = c[1] as string;
      const s = /^\*\*Source:\*\* (.*)$/.exec(line);
      if (s) add(finding, claim, [...(s[1] as string).matchAll(LINK)][0]?.[2] ?? null);
      continue;
    }
    if (section === "" || NOT_PROSE.test(section) || line.startsWith("- [") || line.startsWith("**Sources:**")) continue;
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      const urls = [...new Set([...sentence.matchAll(LINK)].map((m) => m[2] as string))];
      for (const url of urls) add(section, plain(sentence), url);
    }
  }
  return rows;
}

const VERDICTS: readonly Verdict[] = ["on sodium-ion", "another chemistry", "unclear: read the page", "no source"];
const SHORT: Record<Verdict, string> = {
  "on sodium-ion": "on sodium-ion",
  "another chemistry": "another chemistry",
  "unclear: read the page": "unclear",
  "no source": "no source",
};

const cell = (s: string, max = 140) => {
  const one = s.replace(/\s+/g, " ").replace(/\|/g, "\\|");
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

export function renderCheck(id: string, run: string, rows: readonly Row[]): string {
  const counts = VERDICTS.map((v) => `${rows.filter((r) => r.verdict === v).length} ${SHORT[v]}`).join(", ");
  const lines = [
    `# ${id}, ${run}: sodium-ion claims and their sources`,
    "",
    `${rows.length} sodium-ion claim–source pairs: ${counts}. A source's chemistry is read from each source's title and URL, not its page: open every "unclear" and "another chemistry" row before calling it a failure of the hard case.`,
    "",
    "| Where | Claim | Source | Verdict |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.where} | ${cell(r.claim)} | ${cell(r.source_title ?? r.url ?? "—", 90)} | ${r.verdict} |`),
    "",
  ];
  return lines.join("\n");
}

if (import.meta.main) {
  const at = process.argv.indexOf("--id");
  const id = at === -1 ? "12-sodium-ion-plant-morocco" : (process.argv[at + 1] ?? "");
  const run = completedLiveRuns(join(resolve(import.meta.dir), "outputs", "live", id)).at(-1);
  if (run === undefined) {
    process.stderr.write(`${id}: no completed live briefing\n`);
    process.exit(2);
  }
  process.stdout.write(renderCheck(id, basename(run), checkBrief(readFileSync(join(run, "brief.md"), "utf-8"))));
}
