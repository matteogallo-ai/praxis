/**
 * The judge's Message Batches path. Every request goes to a fake fetch; no
 * test reaches the network.
 */
import { describe, expect, test } from "bun:test";

import {
  BATCH_PRICE_SHARE,
  batchWorstCaseUsd,
  JUDGE_EFFORT,
  JUDGE_MAX_TOKENS,
  type JudgeRequest,
  judgeParams,
} from "../../benchmarks/judge-batch.ts";
import { CHARS_PER_TOKEN_FLOOR, DEFAULT_PRICE_TABLE } from "../../src/llm/pricing.ts";

const MODEL = "claude-opus-5";
const opus5 = DEFAULT_PRICE_TABLE.models[MODEL] as { input: number; output: number };
const REQUESTS: JudgeRequest[] = [
  { custom_id: "live-05-supply-chain-acquisition", prompt: "a".repeat(40_000) },
  { custom_id: "live-11-family-office-co-investment", prompt: "b".repeat(30_000) },
];
/** Each prompt at the floor's characters per token, plus all of max_tokens, at half price. */
const WORST =
  (REQUESTS.reduce(
    (a, r) => a + Math.ceil(r.prompt.length / CHARS_PER_TOKEN_FLOOR) * opus5.input + JUDGE_MAX_TOKENS * opus5.output,
    0
  ) /
    1e6) *
  BATCH_PRICE_SHARE;

describe("judge requests", () => {
  test("cap the output, set the effort and carry the prompt as the only user turn", () => {
    expect(judgeParams(MODEL, "grade this")).toEqual({
      model: MODEL,
      max_tokens: JUDGE_MAX_TOKENS,
      output_config: { effort: JUDGE_EFFORT },
      messages: [{ role: "user", content: "grade this" }],
    });
  });

  test("the worst case is every prompt at the floor ratio plus all of max_tokens, at batch prices", () => {
    expect(batchWorstCaseUsd(REQUESTS, MODEL, DEFAULT_PRICE_TABLE)).toBeCloseTo(WORST, 12);
    expect(BATCH_PRICE_SHARE).toBe(0.5);
  });

  test("an unpriced model cannot be sized", () => {
    expect(() => batchWorstCaseUsd(REQUESTS, "claude-unknown", DEFAULT_PRICE_TABLE)).toThrow(/no price/);
  });
});
