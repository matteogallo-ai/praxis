/**
 * What a call costs, from its token usage and a price table.
 *
 * The default table is Anthropic's list price on 2026-11-02 (models overview
 * and pricing pages; Fable 5.1 read on 2026-11-03): USD per million tokens,
 * and per 1000 web searches.
 * Prices change; `loadPriceTable` reads an override file so a run can be
 * costed without a code change. A model missing from the table has no cost
 * (`null`), never a guessed one.
 */
import { readFileSync } from "node:fs";

import type { TokenUsage } from "./types.ts";
import { PriceTableError } from "./errors.ts";

interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens (thinking included). */
  output: number;
  /** USD per million tokens written to the prompt cache (5-minute TTL). */
  cache_write: number;
  /** USD per million tokens read from the prompt cache. */
  cache_read: number;
}

export interface PriceTable {
  models: Record<string, ModelPrice>;
  /** USD per 1000 server-side web searches. */
  web_search_per_1000: number;
}

/** Cache writes bill at 1.25× input and reads at 0.1× input. */
function price(input: number, output: number): ModelPrice {
  return { input, output, cache_write: input * 1.25, cache_read: input * 0.1 };
}

export const DEFAULT_PRICE_TABLE: PriceTable = {
  models: {
    "claude-fable-5-1": price(10, 50),
    "claude-opus-5-5": price(4, 20),
    "claude-sonnet-5-5": price(2, 10),
    "claude-haiku-5-5": price(0.1, 0.5),
  },
  web_search_per_1000: 10,
};

/**
 * Reads a JSON price table shaped like `DEFAULT_PRICE_TABLE`. Every price
 * must be a finite non-negative number; a model's `cache_write` and
 * `cache_read` default to the 1.25× and 0.1× multiples of its input price.
 */
export function loadPriceTable(path: string): PriceTable {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new PriceTableError(path, err instanceof Error ? err.message : String(err));
  }
  if (typeof raw !== "object" || raw === null) throw new PriceTableError(path, "not an object");
  const obj = raw as Record<string, unknown>;
  const isPrice = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!isPrice(obj["web_search_per_1000"])) {
    throw new PriceTableError(path, "'web_search_per_1000' must be a non-negative number");
  }
  const modelsRaw = obj["models"];
  if (typeof modelsRaw !== "object" || modelsRaw === null || Array.isArray(modelsRaw)) {
    throw new PriceTableError(path, "'models' must be an object keyed by model id");
  }
  const models: Record<string, ModelPrice> = {};
  for (const [model, entry] of Object.entries(modelsRaw)) {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (!isPrice(e["input"]) || !isPrice(e["output"])) {
      throw new PriceTableError(path, `'${model}' needs non-negative 'input' and 'output'`);
    }
    const base = price(e["input"], e["output"]);
    for (const key of ["cache_write", "cache_read"] as const) {
      if (e[key] === undefined) continue;
      if (!isPrice(e[key])) throw new PriceTableError(path, `'${model}.${key}' must be a non-negative number`);
      base[key] = e[key];
    }
    models[model] = base;
  }
  return { models, web_search_per_1000: obj["web_search_per_1000"] };
}

/**
 * Context tokens one web search is assumed to add, at most. No API parameter
 * bounds what a search returns, so this is an allowance, not a guarantee: the
 * cost estimate's high scenario and the budget cap's worst case both use it.
 */
export const TOKENS_PER_SEARCH_CEILING = 15_000;

/** One request as the estimate and the cap size it. */
export interface RequestShape {
  /** Tokens of the prompt as sent (system, messages, a re-sent turn). */
  promptTokens: number;
  /** Output tokens, thinking included. */
  outputTokens: number;
  /** Web searches the request runs. */
  searches: number;
  /** Context tokens each search adds. */
  tokensPerSearch: number;
}

/**
 * USD for one request, or `null` when `model` is not in the table. A
 * web-searching request re-reads its context after each search, so with `s`
 * searches of `r` tokens, prompt `P` and output `O` spread over the `s+1`
 * rounds, its input is (s+1)·P + r·s(s+1)/2 + O·s/2.
 */
export function requestCostUsd(shape: RequestShape, model: string, table: PriceTable): number | null {
  const { promptTokens: p, outputTokens: o, searches: s, tokensPerSearch: r } = shape;
  const input = (s + 1) * p + (r * s * (s + 1)) / 2 + (o * s) / 2;
  return costOf(
    {
      input_tokens: Math.round(input),
      output_tokens: Math.round(o),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      web_search_requests: s,
    },
    model,
    table
  );
}

/** USD for one call, or `null` when `model` is not in the table. */
export function costOf(usage: TokenUsage, model: string, table: PriceTable): number | null {
  // The API may answer with a dated id (`claude-opus-5-5-20261001`) for an alias.
  const p = table.models[model] ?? table.models[model.replace(/-\d{8}$/, "")];
  if (p === undefined) return null;
  const perToken =
    usage.input_tokens * p.input +
    usage.output_tokens * p.output +
    usage.cache_creation_input_tokens * p.cache_write +
    usage.cache_read_input_tokens * p.cache_read;
  return perToken / 1_000_000 + (usage.web_search_requests * table.web_search_per_1000) / 1000;
}
