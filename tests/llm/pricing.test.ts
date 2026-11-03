/**
 * Pricing: list prices, cache multiples, unknown models, and override files.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { costOf, DEFAULT_PRICE_TABLE, loadPriceTable } from "../../src/llm/pricing.ts";
import { PriceTableError } from "../../src/llm/errors.ts";
import type { TokenUsage } from "../../src/llm/types.ts";

function usage(partial: Partial<TokenUsage>): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: 0,
    ...partial,
  };
}

describe("costOf", () => {
  test("tokens and searches at list price", () => {
    const u = usage({ input_tokens: 1_000_000, output_tokens: 100_000, web_search_requests: 3 });
    // Sonnet 5.5: $2 in + $10 × 0.1 out + 3 searches × $0.01.
    expect(costOf(u, "claude-sonnet-5-5", DEFAULT_PRICE_TABLE)).toBeCloseTo(3.03, 10);
  });

  test("cache reads and writes bill at 0.1× and 1.25× input", () => {
    const u = usage({ cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 });
    expect(costOf(u, "claude-opus-5-5", DEFAULT_PRICE_TABLE)).toBeCloseTo(0.4 + 5, 10);
  });

  test("a model missing from the table has no cost, not a guessed one", () => {
    expect(costOf(usage({ input_tokens: 10 }), "claude-unknown-9", DEFAULT_PRICE_TABLE)).toBeNull();
  });
});

describe("loadPriceTable", () => {
  const write = (body: unknown): string => {
    const path = join(mkdtempSync(join(tmpdir(), "praxis-prices-")), "prices.json");
    writeFileSync(path, JSON.stringify(body));
    return path;
  };

  test("reads a table and fills the cache multiples", () => {
    const table = loadPriceTable(write({ models: { m: { input: 8, output: 40 } }, web_search_per_1000: 12 }));
    expect(table.models["m"]).toEqual({ input: 8, output: 40, cache_write: 10, cache_read: 0.8 });
    expect(table.web_search_per_1000).toBe(12);
  });

  test("a negative or missing price is rejected", () => {
    expect(() => loadPriceTable(write({ models: { m: { input: -1, output: 1 } }, web_search_per_1000: 10 }))).toThrow(PriceTableError);
    expect(() => loadPriceTable(write({ models: {} }))).toThrow(PriceTableError);
    expect(() => loadPriceTable("/nonexistent/prices.json")).toThrow(PriceTableError);
  });
});

