/**
 * Sizes the judge's requests for one Message Batch under a cost cap.
 *
 * The whole batch's worst case is reserved before it is submitted, as the
 * pipeline's ledger does per request: each prompt at the cap's floor of
 * characters per token, plus all of `max_tokens` (thinking included), at
 * batch prices. A batch whose worst case exceeds the cap is never sent.
 *
 * Billing (Message Batches docs, read 2026-11-03): all usage at 50% of the
 * standard price; errored, canceled and expired requests are not billed.
 */
import { CHARS_PER_TOKEN_FLOOR, type PriceTable, requestCostUsd } from "../src/llm/pricing.ts";

/** Batch usage is billed at this share of the standard price. */
export const BATCH_PRICE_SHARE = 0.5;
/**
 * Thinking and the JSON score share this ceiling. The protocol's cost table
 * sizes a judgment at 8 000 output tokens; an answer that reaches it stops
 * with `max_tokens` and fails its briefing rather than costing more.
 */
export const JUDGE_MAX_TOKENS = 8_000;
/** `medium`: in Anthropic's knowledge-work runs it matched `high` for less. */
export const JUDGE_EFFORT = "medium";

export interface JudgeRequest {
  custom_id: string;
  prompt: string;
}

export function judgeParams(model: string, prompt: string): Record<string, unknown> {
  return {
    model,
    max_tokens: JUDGE_MAX_TOKENS,
    output_config: { effort: JUDGE_EFFORT },
    messages: [{ role: "user", content: prompt }],
  };
}

function worstCaseUsd(request: JudgeRequest, model: string, table: PriceTable): number {
  const usd = requestCostUsd(
    {
      promptTokens: Math.ceil(request.prompt.length / CHARS_PER_TOKEN_FLOOR),
      outputTokens: JUDGE_MAX_TOKENS,
      searches: 0,
      tokensPerSearch: 0,
      outputRereadShare: 0,
    },
    model,
    table
  );
  if (usd === null) throw new Error(`judge model '${model}' has no price, so its batch cannot be sized`);
  return usd * BATCH_PRICE_SHARE;
}

export function batchWorstCaseUsd(requests: readonly JudgeRequest[], model: string, table: PriceTable): number {
  return requests.reduce((a, r) => a + worstCaseUsd(r, model, table), 0);
}
