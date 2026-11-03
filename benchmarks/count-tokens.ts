#!/usr/bin/env bun
/**
 * Measures how many tokens each request of a briefing's prompts takes, with
 * Anthropic's count_tokens endpoint, which generates nothing and is free. The
 * prompts are those of the mock run of the question (fixture upstream
 * outputs), so the count is of the rendered templates and fixtures, not of a
 * live run. count_tokens refuses `web_search`, so tools are left out.
 *
 *   bun run benchmarks/count-tokens.ts -- --ids 05-supply-chain-acquisition
 *
 * Writes `benchmarks/token-counts/<id>.json`. Needs ANTHROPIC_API_KEY; only
 * the count_tokens URL is ever fetched.
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { FetchLike } from "../src/llm/anthropic-provider.ts";
import { MockLLMProvider } from "../src/llm/mock-provider.ts";
import type { LLMProvider } from "../src/llm/provider.ts";
import { UsageLedger } from "../src/orchestrator/ledger.ts";
import { Orchestrator } from "../src/orchestrator/orchestrator.ts";
import { FormatRegistry } from "../src/registry/registry.ts";
import { FIXTURE_CLOCK } from "../tests/fixtures/clock.ts";
import { loadManifest } from "./manifest.ts";

export const COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";

export interface CountedRequest {
  stage: string;
  model: string;
  chars: number;
  tokens: number;
}

interface Rendered {
  stage: string;
  model: string;
  system: string;
  user: string;
}

/** Every request of the question's mock briefing, as rendered. */
async function renderedRequests(root: string, question: string, format: string): Promise<Rendered[]> {
  const mock = new MockLLMProvider({ fixturesDir: join(root, "tests", "fixtures", "mock-llm") });
  const seen: Rendered[] = [];
  const ledger = new UsageLedger({ simulated: true });
  const recorder: LLMProvider = {
    name: "mock",
    acceptsSystemPrompt: true,
    complete: (p, o) => mock.complete(p, o),
    completeWithTools: async (prompt, tools, options) => {
      seen.push({ stage: "", model: options?.model ?? "", system: options?.system ?? "", user: prompt });
      return mock.completeWithTools(prompt, tools, options);
    },
  };
  const registry = new FormatRegistry();
  registry.loadDirectory(join(root, "formats"));
  await new Orchestrator(registry, recorder).briefWithCritiqueAndRerun(question, format, {
    now: new Date(FIXTURE_CLOCK),
    onSourcingFailure: "degrade",
    ledger,
  });
  // The ledger records calls under their stage in call order; replay it.
  const order: string[] = [];
  for (const [stage, usage] of Object.entries(ledger.summary(false).stages)) {
    for (let i = 0; i < usage.calls; i++) order.push(stage);
  }
  if (order.length !== seen.length) throw new Error(`recorded ${seen.length} requests, ledger counted ${order.length}`);
  return seen.map((r, i) => ({ ...r, stage: order[i] as string }));
}

/** Counts each request's system and user text on its own model. */
export async function countTokens(
  root: string,
  id: string,
  apiKey: string,
  fetchFn: FetchLike = fetch
): Promise<CountedRequest[]> {
  const entry = loadManifest(join(root, "benchmarks", "questions.yaml")).benchmarks.find((b) => b.id === id);
  if (entry === undefined) throw new Error(`no question '${id}' in benchmarks/questions.yaml`);
  const out: CountedRequest[] = [];
  for (const r of await renderedRequests(root, entry.question, entry.format)) {
    const body: Record<string, unknown> = { model: r.model, messages: [{ role: "user", content: r.user }] };
    if (r.system.length > 0) body["system"] = r.system;
    const res = await fetchFn(COUNT_TOKENS_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2026-10-21", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`count_tokens answered ${res.status}: ${text.slice(0, 200)}`);
    const tokens = (JSON.parse(text) as { input_tokens?: unknown }).input_tokens;
    if (typeof tokens !== "number" || !(tokens > 0)) throw new Error(`count_tokens returned no input_tokens: ${text.slice(0, 200)}`);
    out.push({ stage: r.stage, model: r.model, chars: r.system.length + r.user.length, tokens });
  }
  return out;
}

if (import.meta.main) {
  const at = process.argv.indexOf("--ids");
  const ids = at === -1 ? [] : (process.argv[at + 1] ?? "").split(",").filter((s) => s.length > 0);
  const key = process.env["ANTHROPIC_API_KEY"];
  if (ids.length === 0 || key === undefined || key.length === 0) {
    process.stderr.write("usage: ANTHROPIC_API_KEY=… bun run benchmarks/count-tokens.ts --ids <id,…>\n");
    process.exit(2);
  }
  const root = resolve(import.meta.dir, "..");
  for (const id of ids) {
    const requests = await countTokens(root, id, key);
    const record = {
      question: id,
      measured_at: new Date().toISOString().slice(0, 10),
      endpoint: "POST /v1/messages/count_tokens (free; system and user text, no tools)",
      source: "the mock run's rendered prompts (bun run benchmarks/count-tokens.ts)",
      requests,
    };
    writeFileSync(join(root, "benchmarks", "token-counts", `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    process.stdout.write(`${id}: ${requests.length} requests counted\n`);
  }
}
