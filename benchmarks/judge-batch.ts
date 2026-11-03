/**
 * Sends the judge's requests as one Message Batch under a cost cap.
 *
 * The whole batch's worst case is reserved before it is submitted, as the
 * pipeline's ledger does per request: each prompt at the cap's floor of
 * characters per token, plus all of `max_tokens` (thinking included), at
 * batch prices. A batch whose worst case exceeds the cap is never sent. The
 * floor is an allowance: text that tokenizes below it costs more.
 *
 * A pending-batch file is written before the submission and kept until the
 * caller has stored the results, so a rerun polls the batch it already paid
 * for instead of submitting a second one. If the submission's answer is lost,
 * the file has no batch id and every rerun is refused until a person checks
 * the Console: the batch may exist and be billed.
 *
 * Billing (Message Batches docs, read 2026-11-03): all usage at 50% of the
 * standard price; errored, canceled and expired requests are not billed.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ANTHROPIC_VERSION, type FetchLike } from "../src/llm/anthropic-provider.ts";
import { AnthropicAPIError, BudgetExceededError } from "../src/llm/errors.ts";
import { CHARS_PER_TOKEN_FLOOR, costOf, type PriceTable, requestCostUsd } from "../src/llm/pricing.ts";

export const BATCHES_URL = "https://api.anthropic.com/v1/messages/batches";
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
const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;
/** Each call reads or sends a small JSON body; longer is a hung connection. */
const CALL_TIMEOUT_MS = 120_000;

export interface JudgeRequest {
  custom_id: string;
  prompt: string;
}

export interface JudgeOutcome {
  custom_id: string;
  /** The answer's text when it ended normally, otherwise null. */
  text: string | null;
  error: string | null;
  cost_usd: number;
}

export interface JudgeBatchRun {
  batch_id: string;
  reserved_usd: number;
  spent_usd: number;
  /** In the order of the requests. */
  outcomes: JudgeOutcome[];
}

export interface JudgeBatchOptions {
  model: string;
  apiKey: string;
  capUsd: number;
  table: PriceTable;
  /** The pending-batch file. */
  statePath: string;
  fetchFn: FetchLike;
  sleepFn: (ms: number) => Promise<void>;
  pollMs: number;
  /** Polls before the run stops and leaves the batch to a rerun. */
  maxPolls: number;
}

interface PendingBatch {
  batch_id: string | null;
  model: string;
  reserved_usd: number;
  custom_ids: string[];
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

/** Deletes the pending-batch file once the caller has stored the results. */
export function clearPendingBatch(statePath: string): void {
  rmSync(statePath, { force: true });
}

function readPending(statePath: string): PendingBatch | null {
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, "utf-8")) as PendingBatch;
}

async function call(opts: JudgeBatchOptions, url: string, init: { method: string; body?: string }): Promise<Response> {
  return opts.fetchFn(url, {
    method: init.method,
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!res.ok) throw new AnthropicAPIError(res.status, text);
  return JSON.parse(text) as Record<string, unknown>;
}

async function submit(requests: readonly JudgeRequest[], opts: JudgeBatchOptions): Promise<PendingBatch> {
  for (const r of requests) {
    if (!CUSTOM_ID.test(r.custom_id)) throw new Error(`custom_id '${r.custom_id}' does not match ${CUSTOM_ID}`);
  }
  const reserved = batchWorstCaseUsd(requests, opts.model, opts.table);
  if (reserved > opts.capUsd + 1e-12) {
    throw new BudgetExceededError(
      0,
      opts.capUsd,
      "judge",
      `the batch's worst case is $${reserved.toFixed(4)} for ${requests.length} request(s)`
    );
  }
  const pending: PendingBatch = {
    batch_id: null,
    model: opts.model,
    reserved_usd: reserved,
    custom_ids: requests.map((r) => r.custom_id),
  };
  writeFileSync(opts.statePath, `${JSON.stringify(pending, null, 2)}\n`);
  // If this throws, there was no answer and the batch may exist: the file
  // stays without a batch id, so no rerun submits a second one.
  const res = await call(opts, BATCHES_URL, {
    method: "POST",
    body: JSON.stringify({
      requests: requests.map((r) => ({ custom_id: r.custom_id, params: judgeParams(opts.model, r.prompt) })),
    }),
  });
  if (!res.ok) {
    // A 4xx refuses the batch: nothing was created, nothing is billed. A 5xx
    // does not prove that, so the file stays without a batch id.
    if (res.status < 500) clearPendingBatch(opts.statePath);
    throw new AnthropicAPIError(res.status, await res.text());
  }
  const id = (await json(res))["id"];
  if (typeof id !== "string") throw new Error("batch create answered without an id");
  pending.batch_id = id;
  writeFileSync(opts.statePath, `${JSON.stringify(pending, null, 2)}\n`);
  return pending;
}

async function resultsUrl(batchId: string, opts: JudgeBatchOptions): Promise<string> {
  for (let i = 0; i < opts.maxPolls; i++) {
    const batch = await json(await call(opts, `${BATCHES_URL}/${batchId}`, { method: "GET" }));
    if (batch["processing_status"] === "ended") {
      const url = batch["results_url"];
      // The key goes with the request: only to the API's own host.
      if (typeof url !== "string" || !url.startsWith(`${BATCHES_URL}/`)) {
        throw new Error(`batch ${batchId} gave a results_url off ${BATCHES_URL}: ${String(url)}`);
      }
      return url;
    }
    if (i < opts.maxPolls - 1) await opts.sleepFn(opts.pollMs);
  }
  throw new Error(`batch ${batchId} is still processing after ${opts.maxPolls} polls; rerun to resume it`);
}

interface ResultLine {
  custom_id?: unknown;
  result?: {
    type?: unknown;
    error?: { error?: { type?: unknown } };
    message?: { stop_reason?: unknown; content?: unknown; usage?: Record<string, unknown> };
  };
}

function outcomeOf(line: ResultLine, request: JudgeRequest, opts: JudgeBatchOptions): JudgeOutcome {
  const id = request.custom_id;
  const result = line.result ?? {};
  if (result.type !== "succeeded") {
    // Errored, canceled and expired requests are not billed.
    const why = result.type === "errored" ? `errored: ${String(result.error?.error?.type ?? "unknown")}` : String(result.type);
    return { custom_id: id, text: null, error: why, cost_usd: 0 };
  }
  const message = result.message ?? {};
  const u = message.usage;
  const n = (k: string) => (typeof u?.[k] === "number" ? (u[k] as number) : 0);
  const cost =
    u === undefined
      ? worstCaseUsd(request, opts.model, opts.table)
      : (costOf(
          {
            input_tokens: n("input_tokens"),
            output_tokens: n("output_tokens"),
            cache_creation_input_tokens: n("cache_creation_input_tokens"),
            cache_read_input_tokens: n("cache_read_input_tokens"),
            web_search_requests: 0,
          },
          opts.model,
          opts.table
        ) ?? 0) * BATCH_PRICE_SHARE;
  if (message.stop_reason !== "end_turn") {
    return { custom_id: id, text: null, error: `stopped: ${String(message.stop_reason)}`, cost_usd: cost };
  }
  const blocks = Array.isArray(message.content) ? (message.content as { type?: unknown; text?: unknown }[]) : [];
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  return { custom_id: id, text, error: null, cost_usd: cost };
}

/**
 * Submits `requests` as one batch, or resumes the pending one, and returns
 * each request's outcome. The pending-batch file is left for the caller to
 * clear with `clearPendingBatch` once the results are stored.
 */
export async function runJudgeBatch(requests: readonly JudgeRequest[], opts: JudgeBatchOptions): Promise<JudgeBatchRun> {
  const prior = readPending(opts.statePath);
  if (prior !== null && prior.batch_id === null) {
    throw new Error(
      `an earlier batch submission may have reached the API without its answer: find it in the Console (or GET ${BATCHES_URL}), then delete ${opts.statePath}`
    );
  }
  if (prior !== null && prior.model !== opts.model) {
    throw new Error(
      `the pending batch (${prior.batch_id}) runs on ${prior.model}, not ${opts.model}: rerun on ${prior.model}, or delete ${opts.statePath} after checking it in the Console`
    );
  }
  if (prior !== null && prior.custom_ids.join("\n") !== requests.map((r) => r.custom_id).join("\n")) {
    throw new Error(
      `a pending batch (${prior.batch_id}) covers other requests: rerun with the same briefings, or delete ${opts.statePath} after checking it in the Console`
    );
  }
  const pending = prior ?? (await submit(requests, opts));
  const batchId = pending.batch_id as string;
  const url = await resultsUrl(batchId, opts);
  const res = await call(opts, url, { method: "GET" });
  const body = await res.text();
  if (!res.ok) throw new AnthropicAPIError(res.status, body);
  // Billed answers survive a parse failure here or in the caller.
  writeFileSync(join(dirname(opts.statePath), `batch-${batchId}.jsonl`), body);
  const stuck = `; the batch stays pending: check it in the Console, then delete ${opts.statePath}`;

  const byId = new Map(requests.map((r) => [r.custom_id, r]));
  const found = new Map<string, JudgeOutcome>();
  for (const raw of body.split("\n")) {
    if (raw.trim() === "") continue;
    let line: ResultLine;
    try {
      line = JSON.parse(raw) as ResultLine;
    } catch {
      throw new Error(`batch ${batchId} results: a line is not JSON: ${raw.slice(0, 120)}${stuck}`);
    }
    const request = byId.get(String(line.custom_id));
    if (request === undefined) {
      throw new Error(`batch ${batchId} results: unknown custom_id ${String(line.custom_id)}${stuck}`);
    }
    found.set(request.custom_id, outcomeOf(line, request, opts));
  }
  const outcomes = requests.map(
    (r) => found.get(r.custom_id) ?? { custom_id: r.custom_id, text: null, error: "no result", cost_usd: 0 }
  );
  return {
    batch_id: batchId,
    reserved_usd: pending.reserved_usd,
    spent_usd: outcomes.reduce((a, o) => a + o.cost_usd, 0),
    outcomes,
  };
}
