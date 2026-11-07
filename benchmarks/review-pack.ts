#!/usr/bin/env bun
/**
 * Builds the blind review pack of docs/preregistration/single-call-baseline.md:
 * the Praxis briefing and the single-call baseline for question 12, reduced
 * to the format's sections in one layout, labelled A and B.
 *
 * What gives an arm away is removed: front matter, table of contents,
 * sections outside the format's six, HTML comments, and citation layout
 * (parenthesised links, link text, source lists): every link becomes a
 * numbered marker and every section ends with its numbered sources. Bold,
 * list markers and the order of day and month in dates are made uniform.
 * The wording stays: that limit is in the protocol.
 *
 * Which arm is A is decided by the parity of the first byte of SHA-256 over
 * both inputs, so the assignment is reproducible and fixed before anyone
 * reads the pack; key.json records it.
 *
 * Usage: bun run benchmarks/review-pack.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const PAREN_LINK = /\(\s*\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\s*\)/g;
const MONTH_FIRST = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\b/g;

/** Layout either arm may use, written one way: no bold, no list markers, "20 October 2026". */
function uniformLayout(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^(\s*)[-*] /, "$1")
    .replace(MONTH_FIRST, "$2 $1 $3");
}

/**
 * The body without HTML comments. One pass can leave a comment that the
 * removal itself assembled ("<!<!---->--"), and an unclosed one hides the
 * rest of the section in a viewer: both would show one arm's notes or hide
 * its text, so removal repeats until nothing changes and an open marker
 * drops what follows it.
 */
function withoutComments(body: string): string {
  let text = body;
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/<!--[\s\S]*?-->/g, "");
    const open = text.indexOf("<!--");
    if (open !== -1) text = text.slice(0, open);
    text = text.replace(/<!-|-->/g, "");
  }
  return text;
}

/** One section, blinded: prose with numbered markers, then its numbered sources. */
export function blindSection(title: string, body: string): string {
  const urls: string[] = [];
  const number = (url: string): number => {
    const i = urls.indexOf(url);
    if (i !== -1) return i + 1;
    urls.push(url);
    return urls.length;
  };
  const prose: string[] = [];
  for (const line of withoutComments(body).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "**Sources:**") continue;
    // A source list item: its URL is listed, the line is not prose.
    const listed = /^- \[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/.exec(trimmed);
    if (listed !== null) {
      number(listed[1] as string);
      continue;
    }
    // A link alone in parentheses is a citation whatever its text ("source",
    // a publisher's name): it becomes a bare marker. A link inside a sentence
    // keeps its words.
    prose.push(
      uniformLayout(line)
        .replace(PAREN_LINK, (_m, _text: string, url: string) => `[${number(url)}]`)
        .replace(LINK, (_m, text: string, url: string) => `${text} [${number(url)}]`)
    );
  }
  const text = prose.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const sources = urls.map((u, i) => `${i + 1}. ${u}`).join("\n");
  return `## ${title}\n\n${text}\n\nSources:\n\n${sources || "(none)"}\n`;
}

/** The format's sections, in its order, blinded; a section the briefing lacks reads "(missing)". */
export function blindBriefing(markdown: string, titles: readonly string[]): string {
  const bodies = new Map<string, string>();
  for (const part of markdown.split(/^## /m).slice(1)) {
    const [heading = "", ...rest] = part.split("\n");
    bodies.set(heading.trim(), rest.join("\n"));
  }
  return titles
    .map((t) => {
      const body = bodies.get(t);
      return body === undefined ? `## ${t}\n\n(missing)\n` : blindSection(t, body);
    })
    .join("\n");
}

export function assignment(praxis: string, baseline: string): { A: "praxis" | "baseline"; B: "praxis" | "baseline" } {
  const byte = createHash("sha256").update(praxis).update(baseline).digest()[0] ?? 0;
  return byte % 2 === 0 ? { A: "praxis", B: "baseline" } : { A: "baseline", B: "praxis" };
}

export const PACK = {
  question: "Should we build a sodium-ion battery cell plant in Morocco to supply European carmakers?",
  titles: ["Situation", "Complication", "Key Question", "Answer", "Supporting Arguments", "So What"],
  praxis: "benchmarks/outputs/live/12-sodium-ion-plant-morocco/run-2026-11-04T13-20-16-572Z/brief.md",
  baseline: "benchmarks/outputs/baseline/12-sodium-ion-plant-morocco/run-2026-11-07T11-28-59-229Z/brief.md",
  out: "benchmarks/review/q12",
} as const;

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const praxis = readFileSync(join(root, PACK.praxis), "utf-8");
  const baseline = readFileSync(join(root, PACK.baseline), "utf-8");
  const key = assignment(praxis, baseline);
  const out = join(root, PACK.out);
  mkdirSync(out, { recursive: true });
  const source = { praxis, baseline };
  for (const label of ["A", "B"] as const) {
    const doc = `# Briefing ${label}: ${PACK.question}\n\n${blindBriefing(source[key[label]], PACK.titles)}`;
    writeFileSync(join(out, `${label}.md`), doc);
  }
  writeFileSync(join(out, "key.json"), `${JSON.stringify({ ...key, inputs: { praxis: PACK.praxis, baseline: PACK.baseline } }, null, 2)}\n`);
  console.log(`wrote ${PACK.out}/A.md, B.md, key.json`);
}
