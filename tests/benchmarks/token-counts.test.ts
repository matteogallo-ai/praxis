/**
 * The token counts measured with Anthropic's count_tokens endpoint
 * (`benchmarks/token-counts/`) set how the estimate and the cap turn
 * characters into tokens.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";


interface Measured {
  requests: { stage: string; model: string; chars: number; tokens: number }[];
}
const measured = JSON.parse(
  readFileSync("benchmarks/token-counts/05-supply-chain-acquisition.json", "utf-8")
) as Measured;

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
