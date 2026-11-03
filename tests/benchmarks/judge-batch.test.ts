/**
 * The judge's Message Batches path. Every request goes to a fake fetch; no
 * test reaches the network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BATCH_PRICE_SHARE,
  BATCHES_URL,
  batchWorstCaseUsd,
  clearPendingBatch,
  JUDGE_EFFORT,
  JUDGE_MAX_TOKENS,
  type JudgeRequest,
  judgeParams,
  runJudgeBatch,
} from "../../benchmarks/judge-batch.ts";
import { BudgetExceededError } from "../../src/llm/errors.ts";
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

interface Call {
  url: string;
  method: string;
  body: unknown;
  key: string | null;
}

const SCORE_TEXT = '{"scores":"stand-in; score-all parses it"}';

function succeeded(id: string, usage: unknown, stop = "end_turn", text = SCORE_TEXT): string {
  return JSON.stringify({
    custom_id: id,
    result: {
      type: "succeeded",
      message: {
        model: MODEL,
        stop_reason: stop,
        content: [{ type: "thinking", thinking: "" }, { type: "text", text }],
        ...(usage === undefined ? {} : { usage }),
      },
    },
  });
}

/** A fake Batches API: create, then `pollsBeforeEnd` in_progress answers, then ended. */
function fakeApi(opts: {
  results: string[];
  pollsBeforeEnd?: number;
  createStatus?: number;
  resultsUrl?: string;
  pollStatus?: number;
  resultsStatus?: number;
  midStatus?: string;
}) {
  const calls: Call[] = [];
  let polls = 0;
  const batch = (status: string) => ({
    id: "msgbatch_test",
    type: "message_batch",
    processing_status: status,
    results_url: status === "ended" ? (opts.resultsUrl ?? `${BATCHES_URL}/msgbatch_test/results`) : null,
  });
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      key: headers.get("x-api-key"),
    });
    if (url === BATCHES_URL && init?.method === "POST") {
      const status = opts.createStatus ?? 200;
      return new Response(JSON.stringify(status === 200 ? batch("in_progress") : { error: {} }), { status });
    }
    if (url === `${BATCHES_URL}/msgbatch_test`) {
      polls++;
      if (opts.pollStatus !== undefined) return new Response("{}", { status: opts.pollStatus });
      const mid = opts.midStatus ?? "in_progress";
      return new Response(JSON.stringify(batch(polls > (opts.pollsBeforeEnd ?? 0) ? "ended" : mid)));
    }
    if (url.endsWith("/results")) return new Response(`${opts.results.join("\n")}\n`, { status: opts.resultsStatus ?? 200 });
    return new Response("unexpected", { status: 599 });
  };
  return { calls, fetchFn };
}

let dir: string;
let statePath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "praxis-judge-"));
  statePath = join(dir, "batch-pending.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sleeps: number[] = [];
const base = () => ({
  model: MODEL,
  apiKey: "sk-ant-test-not-a-real-key",
  table: DEFAULT_PRICE_TABLE,
  statePath,
  pollMs: 60_000,
  maxPolls: 5,
  sleepFn: async (ms: number) => {
    sleeps.push(ms);
  },
});

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

describe("runJudgeBatch — the cap", () => {
  test("a batch whose worst case exceeds the cap is refused before any request", async () => {
    const api = fakeApi({ results: [] });
    await expect(
      runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST - 0.001, fetchFn: api.fetchFn })
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(api.calls).toEqual([]);
    expect(existsSync(statePath)).toBe(false);
  });

  test("a batch that fits is submitted once, polled until it ends, and charged its usage at batch prices", async () => {
    const usage = { input_tokens: 12_000, output_tokens: 3_000 };
    const api = fakeApi({
      results: [succeeded(REQUESTS[1]?.custom_id as string, usage), succeeded(REQUESTS[0]?.custom_id as string, usage)],
      pollsBeforeEnd: 2,
    });
    sleeps.length = 0;
    const run = await runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn });
    expect(api.calls.filter((c) => c.method === "POST").length).toBe(1);
    expect(api.calls.map((c) => c.key)).toEqual(api.calls.map(() => "sk-ant-test-not-a-real-key"));
    expect(api.calls[0]?.body).toEqual({
      requests: REQUESTS.map((r) => ({ custom_id: r.custom_id, params: judgeParams(MODEL, r.prompt) })),
    });
    expect(sleeps).toEqual([60_000, 60_000]);
    const each = ((12_000 * opus5.input + 3_000 * opus5.output) / 1e6) * 0.5;
    expect(run.reserved_usd).toBeCloseTo(WORST, 12);
    expect(run.spent_usd).toBeCloseTo(2 * each, 12);
    expect(run.outcomes.map((o) => [o.custom_id, o.text])).toEqual(REQUESTS.map((r) => [r.custom_id, SCORE_TEXT]));
  });

  test("a succeeded answer without usage is charged its worst case", async () => {
    const [a, b] = REQUESTS as [JudgeRequest, JudgeRequest];
    const api = fakeApi({ results: [succeeded(a.custom_id, undefined), succeeded(b.custom_id, { input_tokens: 0, output_tokens: 0 })] });
    const run = await runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn });
    expect(run.spent_usd).toBeCloseTo(batchWorstCaseUsd([a], MODEL, DEFAULT_PRICE_TABLE), 12);
  });
});

describe("runJudgeBatch — results", () => {
  test("refusal and max_tokens answers fail their briefing and are still charged", async () => {
    const [a, b] = REQUESTS as [JudgeRequest, JudgeRequest];
    const usage = { input_tokens: 1_000, output_tokens: JUDGE_MAX_TOKENS };
    const api = fakeApi({ results: [succeeded(a.custom_id, usage, "refusal", ""), succeeded(b.custom_id, usage, "max_tokens", "{")] });
    const run = await runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn });
    expect(run.outcomes.map((o) => o.error)).toEqual(["stopped: refusal", "stopped: max_tokens"]);
    expect(run.outcomes.every((o) => o.text === null)).toBe(true);
    expect(run.spent_usd).toBeCloseTo(((2 * (1_000 * opus5.input + JUDGE_MAX_TOKENS * opus5.output)) / 1e6) * 0.5, 12);
  });

  test("errored, expired and missing requests fail and cost nothing", async () => {
    const [a] = REQUESTS as [JudgeRequest, JudgeRequest];
    const errored = JSON.stringify({
      custom_id: a.custom_id,
      result: { type: "errored", error: { type: "error", error: { type: "invalid_request_error", message: "bad" } } },
    });
    const api = fakeApi({ results: [errored] });
    const run = await runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn });
    expect(run.outcomes.map((o) => o.error)).toEqual(["errored: invalid_request_error", "no result"]);
    expect(run.spent_usd).toBe(0);
    clearPendingBatch(statePath);

    const [, b] = REQUESTS as [JudgeRequest, JudgeRequest];
    const expired = JSON.stringify({ custom_id: a.custom_id, result: { type: "expired" } });
    const canceled = JSON.stringify({ custom_id: b.custom_id, result: { type: "canceled" } });
    const api2 = fakeApi({ results: [expired, canceled] });
    const run2 = await runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api2.fetchFn });
    expect(run2.outcomes.map((o) => o.error)).toEqual(["expired", "canceled"]);
    expect(run2.spent_usd).toBe(0);
  });

  test("a results line that is not JSON, or names an unknown request, stops the run and keeps the batch to resume", async () => {
    for (const bad of ["not json", succeeded("live-unknown", { input_tokens: 1, output_tokens: 1 })]) {
      const api = fakeApi({ results: [bad] });
      await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn })).rejects.toThrow(
        /results.*Console.*delete/s
      );
      expect(JSON.parse(readFileSync(statePath, "utf-8")).batch_id).toBe("msgbatch_test");
      rmSync(statePath);
    }
  });

  test("the key is never sent to a results_url off the API host", async () => {
    const api = fakeApi({ results: [], resultsUrl: "https://elsewhere.example/results" });
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn })).rejects.toThrow(/results_url/);
    expect(api.calls.some((c) => c.url.includes("elsewhere"))).toBe(false);
  });
});

describe("runJudgeBatch — what was paid for is kept", () => {
  test("the raw results are written next to the pending file before they are read", async () => {
    const lines = REQUESTS.map((r) => succeeded(r.custom_id, { input_tokens: 1, output_tokens: 1 }, "end_turn", "not a score"));
    const api = fakeApi({ results: lines });
    await runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn });
    expect(readFileSync(join(dir, "batch-msgbatch_test.jsonl"), "utf-8")).toBe(`${lines.join("\n")}\n`);
  });
});

describe("runJudgeBatch — restart", () => {
  test("a batch already submitted is polled, not submitted again", async () => {
    const usage = { input_tokens: 10, output_tokens: 10 };
    const first = fakeApi({ results: [], pollsBeforeEnd: 99 });
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: first.fetchFn })).rejects.toThrow(/still processing/);
    const second = fakeApi({ results: REQUESTS.map((r) => succeeded(r.custom_id, usage)) });
    const run = await runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: second.fetchFn });
    expect(second.calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(run.batch_id).toBe("msgbatch_test");
    expect(run.outcomes.length).toBe(2);
  });

  test("a resumed batch must be the one asked for", async () => {
    const first = fakeApi({ results: [], pollsBeforeEnd: 99 });
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: first.fetchFn })).rejects.toThrow(/still processing/);
    const api = fakeApi({ results: [] });
    await expect(runJudgeBatch(REQUESTS.slice(0, 1), { ...base(), capUsd: WORST, fetchFn: api.fetchFn })).rejects.toThrow(
      /pending batch/
    );
    expect(api.calls).toEqual([]);
  });

  test("a submission whose answer was lost is not sent again", async () => {
    const lost = async () => {
      throw new TypeError("connection reset");
    };
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: lost })).rejects.toThrow(/connection reset/);
    const api = fakeApi({ results: [] });
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn })).rejects.toThrow(
      /may have reached the API/
    );
    expect(api.calls).toEqual([]);
  });

  test("a 5xx answer to the submission does not prove no batch was made: reruns stay blocked", async () => {
    const api = fakeApi({ results: [], createStatus: 529 });
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn })).rejects.toThrow(/529/);
    const again = fakeApi({ results: [] });
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: again.fetchFn })).rejects.toThrow(
      /may have reached the API/
    );
    expect(again.calls).toEqual([]);
  });

  test("a failed poll or results download keeps the batch to resume", async () => {
    for (const fail of [{ pollStatus: 500 }, { resultsStatus: 500 }]) {
      const api = fakeApi({ results: [], ...fail });
      await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn })).rejects.toThrow(/500/);
      expect(JSON.parse(readFileSync(statePath, "utf-8")).batch_id).toBe("msgbatch_test");
      rmSync(statePath);
    }
  });

  test("a resumed batch must be on the model asked for", async () => {
    const first = fakeApi({ results: [], pollsBeforeEnd: 99 });
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: first.fetchFn })).rejects.toThrow(/still processing/);
    const api = fakeApi({ results: [] });
    await expect(
      runJudgeBatch(REQUESTS, { ...base(), model: "claude-fable-5-1", capUsd: 100, fetchFn: api.fetchFn })
    ).rejects.toThrow(/claude-opus-5/);
    expect(api.calls).toEqual([]);
  });

  test("polling gives up after maxPolls without a last sleep, and waits through canceling", async () => {
    sleeps.length = 0;
    const api = fakeApi({ results: [], pollsBeforeEnd: 99, midStatus: "canceling" });
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn })).rejects.toThrow(/still processing/);
    expect(api.calls.filter((c) => c.method === "GET").length).toBe(5);
    expect(sleeps.length).toBe(4);
  });

  test("a submission the API refused is not billed and leaves nothing pending", async () => {
    const api = fakeApi({ results: [], createStatus: 400 });
    await expect(runJudgeBatch(REQUESTS, { ...base(), capUsd: WORST, fetchFn: api.fetchFn })).rejects.toThrow(/400/);
    expect(existsSync(statePath)).toBe(false);
  });

  test("custom ids the Batches API would reject are refused before any request", async () => {
    const api = fakeApi({ results: [] });
    await expect(
      runJudgeBatch([{ custom_id: "live/05", prompt: "x" }], { ...base(), capUsd: WORST, fetchFn: api.fetchFn })
    ).rejects.toThrow(/custom_id/);
    expect(api.calls).toEqual([]);
  });
});
