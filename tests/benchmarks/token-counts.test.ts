/**
 * The token counts measured with Anthropic's count_tokens endpoint
 * (`benchmarks/token-counts/`) set how the estimate and the cap turn
 * characters into tokens.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  estimateBriefing,
  type MockMetadata,
  measuredCharsPerToken,
  MOCK_CHARS_PER_TOKEN,
  SCENARIOS,
} from "../../benchmarks/estimate-cost.ts";
import { CHARS_PER_TOKEN_FLOOR } from "../../src/llm/pricing.ts";

interface Measured {
  requests: { stage: string; model: string; chars: number; tokens: number }[];
}
const measured = JSON.parse(
  readFileSync("benchmarks/token-counts/05-supply-chain-acquisition.json", "utf-8")
) as Measured;
const all = readdirSync("benchmarks/token-counts")
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => (JSON.parse(readFileSync(`benchmarks/token-counts/${f}`, "utf-8")) as Measured).requests);

describe("measured token counts", () => {
  test("every measured request is at least the cap's floor of characters per token", () => {
    const lowest = Math.min(...all.map((r) => r.chars / r.tokens));
    expect(lowest).toBeGreaterThanOrEqual(CHARS_PER_TOKEN_FLOOR);
  });

  test("the estimate's ratio is the measured characters over the measured tokens", () => {
    const chars = all.reduce((a, r) => a + r.chars, 0);
    const tokens = all.reduce((a, r) => a + r.tokens, 0);
    expect(measuredCharsPerToken(".")).toBeCloseTo(chars / tokens, 12);
  });

  test("the estimate reads mock prompts at that ratio, not the mock's 4 characters per token", () => {
    const meta = JSON.parse(
      readFileSync("benchmarks/outputs/mock/05-supply-chain-acquisition/metadata.json", "utf-8")
    ) as MockMetadata;
    const low = SCENARIOS.find((s) => s.name === "low") as (typeof SCENARIOS)[number];
    const ratio = measuredCharsPerToken(".");
    // Scaling the prompt by 4 / ratio is the same as growing it by that factor.
    const rescaled = { ...low, upstreamGrowth: (low.upstreamGrowth * MOCK_CHARS_PER_TOKEN) / ratio };
    expect(estimateBriefing(meta, false, low).total).toBeCloseTo(
      estimateBriefing(meta, false, rescaled, undefined, MOCK_CHARS_PER_TOKEN).total,
      10
    );
  });
});

describe("measuredCharsPerToken refuses a measurement it cannot read", () => {
  const withFile = (content: string | null, run: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), "praxis-counts-"));
    try {
      if (content !== null) {
        mkdirSync(join(root, "benchmarks", "token-counts"), { recursive: true });
        writeFileSync(join(root, "benchmarks", "token-counts", "q.json"), content);
      }
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  test.each([
    ["no directory", null, /is missing/],
    ["malformed JSON", "{", /not JSON/],
    ["no requests array", "{}", /'requests'/],
    ["zero tokens", '{"requests":[{"chars":10,"tokens":0}]}', /positive/],
    ["a missing count", '{"requests":[{"tokens":4}]}', /positive/],
    ["no request at all", '{"requests":[]}', /no measured token counts/],
  ])("%s", (_name, content, error) => {
    withFile(content, (root) => expect(() => measuredCharsPerToken(root)).toThrow(error));
  });
});

describe("benchmarks/count-tokens.ts", () => {
  test("re-renders the committed measurement's requests and fetches only count_tokens", async () => {
    const { countTokens, COUNT_TOKENS_URL } = await import("../../benchmarks/count-tokens.ts");
    const urls: string[] = [];
    const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input));
      const body = JSON.parse(String(init?.body)) as { system?: string; messages: { content: string }[] };
      const chars = (body.system ?? "").length + (body.messages[0]?.content ?? "").length;
      return new Response(JSON.stringify({ input_tokens: Math.ceil(chars / 2.7) }), { status: 200 });
    };
    const counted = await countTokens(".", "05-supply-chain-acquisition", "sk-test", fetchFn);
    expect(new Set(urls)).toEqual(new Set([COUNT_TOKENS_URL]));
    expect(counted.map(({ stage, model, chars }) => ({ stage, model, chars }))).toEqual(
      measured.requests.map(({ stage, model, chars }) => ({ stage, model, chars }))
    );
  });

  test("a refused key stops the measurement with the status", async () => {
    const { countTokens } = await import("../../benchmarks/count-tokens.ts");
    const fetchFn = async () => new Response('{"error":{"type":"authentication_error"}}', { status: 401 });
    await expect(countTokens(".", "05-supply-chain-acquisition", "sk-bad", fetchFn)).rejects.toThrow(/answered 401/);
  });
});
