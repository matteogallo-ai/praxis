#!/usr/bin/env bun
/**
 * The single-call baseline of docs/preregistration/single-call-baseline.md:
 * one model call, given the question, the format's YAML file and the web
 * search tool, writes the whole briefing. It is the arm Praxis's seven
 * stages have to beat.
 *
 * Usage:
 *   bun run benchmarks/single-call-baseline.ts --estimate          free: worst-case cost, no call
 *   bun run benchmarks/single-call-baseline.ts --live --max-cost-usd 5   PAID: one call, capped
 *
 * Output (live): benchmarks/outputs/baseline/<question id>/run-<start>/
 * {brief.md, metadata.json}, or error-<time>.json when the call fails or
 * stops at the cap. A failure is a result too and is committed as one.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { UNTRUSTED_CONTENT_RULE } from "../src/agents/prompt-runtime.ts";
import { AnthropicLLMProvider } from "../src/llm/anthropic-provider.ts";
import type { LLMProvider } from "../src/llm/provider.ts";
import { TOKENS_PER_SEARCH_CEILING } from "../src/llm/pricing.ts";
import type { Tool } from "../src/llm/types.ts";
import { meter, UsageLedger } from "../src/orchestrator/ledger.ts";
import { provenance } from "./provenance.ts";

export const BASELINE = {
  questionId: "12-sodium-ion-plant-morocco",
  question: "Should we build a sodium-ion battery cell plant in Morocco to supply European carmakers?",
  formatId: "mckinsey-style-note",
  model: "claude-opus-5-5",
  maxTokens: 8_000,
  maxSearches: 5,
  maxToolRounds: 2,
  capUsd: 5,
} as const;

const STAGE = "single-call-baseline";

export function baselinePrompt(question: string, formatYaml: string): { system: string; user: string } {
  const system = [
    "You are an analyst. Write the briefing the format below declares, for the question below, in one answer.",
    "Use web_search to find sources. Every factual claim carries the URL of the page that states it, inline as a Markdown link.",
    "A claim you cannot source is written as such, followed by \"(not sourced)\"; never invent a figure, an organisation or a URL.",
    "Answer in Markdown: one level-2 heading per section of the format, with the section's title, in the format's order, nothing before the first heading.",
    "",
    UNTRUSTED_CONTENT_RULE,
  ].join("\n");
  const user = [`Question: ${question}`, "", "Format declaration (YAML):", "", formatYaml].join("\n");
  return { system, user };
}

/** The ledger's worst case for every round the call may take, the cap the run must fit under. */
export function estimateUsd(prompt: { system: string; user: string }): number {
  const ledger = new UsageLedger({ maxCostUsd: BASELINE.capUsd });
  const promptChars = prompt.system.length + prompt.user.length;
  let total = 0;
  let resent = 0;
  for (let round = 0; round < BASELINE.maxToolRounds; round++) {
    const usd = ledger.worstCaseUsd(BASELINE.model, {
      promptChars,
      maxTokens: BASELINE.maxTokens,
      maxSearches: BASELINE.maxSearches,
      resentTokens: resent,
    });
    if (usd === undefined) throw new Error(`no price for ${BASELINE.model}`);
    total += usd;
    // A continued round resends what the earlier rounds produced.
    resent += BASELINE.maxTokens + BASELINE.maxSearches * TOKENS_PER_SEARCH_CEILING;
  }
  return total;
}

export interface BaselineRun {
  text: string;
  usage: ReturnType<UsageLedger["summary"]>;
  rounds: number;
  stop_reason: string;
}

/** One capped call. Throws whatever the provider or the ledger throws. */
export async function runBaseline(provider: LLMProvider, ledger: UsageLedger, prompt: { system: string; user: string }): Promise<BaselineRun> {
  const metered = meter(provider, ledger, STAGE);
  if (metered.completeWithTools === undefined) throw new Error(`provider '${provider.name}' has no tool use`);
  const tools: Tool[] = [{ type: "web_search", name: "web_search", max_uses: BASELINE.maxSearches }];
  const started = Date.now();
  try {
    const result = await metered.completeWithTools(prompt.user, tools, {
      model: BASELINE.model,
      system: prompt.system,
      max_tokens: BASELINE.maxTokens,
      max_tool_rounds: BASELINE.maxToolRounds,
    });
    return { text: result.text, usage: ledger.summary(), rounds: result.rounds, stop_reason: result.stop_reason };
  } finally {
    ledger.recordDuration(STAGE, Date.now() - started);
  }
}

/** Counts code can take from a briefing: words, cited URLs, per section. Not a quality measure. */
export function countBriefing(markdown: string): { sections: { title: string; words: number; links: number }[]; distinct_urls: number } {
  const sections: { title: string; words: number; links: number }[] = [];
  const urls = new Set<string>();
  for (const part of markdown.split(/^## /m).slice(1)) {
    const [title = "", ...rest] = part.split("\n");
    const body = rest.join("\n");
    const links = [...body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1] as string);
    for (const u of links) urls.add(u);
    const words = body.replace(/\]\([^)]*\)/g, "]").split(/\s+/).filter((w) => /\w/.test(w)).length;
    sections.push({ title: title.trim(), words, links: links.length });
  }
  return { sections, distinct_urls: urls.size };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const formatYaml = readFileSync(join(root, "formats", `${BASELINE.formatId}.yaml`), "utf-8");
  const prompt = baselinePrompt(BASELINE.question, formatYaml);
  const worst = estimateUsd(prompt);
  console.log(`worst case, ${BASELINE.maxToolRounds} rounds of ${BASELINE.model}: $${worst.toFixed(2)} (cap $${BASELINE.capUsd})`);
  if (process.argv.includes("--live")) {
    const flag = process.argv.indexOf("--max-cost-usd");
    const cap = Number(process.argv[flag + 1]);
    if (flag === -1 || !(cap > 0) || cap > BASELINE.capUsd) {
      console.error(`--live needs --max-cost-usd <n>, at most the registered $${BASELINE.capUsd}`);
      process.exit(2);
    }
    const ledger = new UsageLedger({ maxCostUsd: cap });
    const started = new Date();
    const stamp = started.toISOString().replace(/[:.]/g, "-");
    const outDir = join(root, "benchmarks", "outputs", "baseline", BASELINE.questionId);
    mkdirSync(outDir, { recursive: true });
    const base = { question: BASELINE.question, format: BASELINE.formatId, model: BASELINE.model, started_at: started.toISOString(), provenance: provenance(root) };
    try {
      const run = await runBaseline(new AnthropicLLMProvider(), ledger, prompt);
      const dir = join(outDir, `run-${stamp}`);
      mkdirSync(dir);
      writeFileSync(join(dir, "brief.md"), run.text);
      const meta = { ...base, finished_at: new Date().toISOString(), rounds: run.rounds, stop_reason: run.stop_reason, usage: run.usage, counts: countBriefing(run.text) };
      writeFileSync(join(dir, "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
      console.log(`wrote ${dir}: $${run.usage.total.cost_usd?.toFixed(4)} , ${run.rounds} round(s), stop ${run.stop_reason}`);
    } catch (err) {
      // Recorded, not swallowed: the failure is the run's result, and the process exits 1.
      const record = { ...base, failed_at: new Date().toISOString(), error_type: err instanceof Error ? err.name : "unknown", message: err instanceof Error ? err.message : String(err), usage: ledger.summary() };
      writeFileSync(join(outDir, `error-${stamp}.json`), `${JSON.stringify(record, null, 2)}\n`);
      console.error(`failed: ${record.error_type}: ${record.message}`);
      process.exit(1);
    }
  }
}
