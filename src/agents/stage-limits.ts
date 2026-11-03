/**
 * Per-stage request limits: output-token ceiling, request timeout, and the
 * cap on web searches one request may run.
 *
 * Why per stage. The 60 s provider default is shorter than a web-search
 * request: the server runs the search loop inside one HTTP request, and the
 * one recorded live timeout is the research stage at 60 000 ms (CHANGELOG
 * 1.2.1). A plain completion (scoping, one synthesis section) is shorter.
 *
 * How the numbers are derived. No live per-stage duration exists, so each
 * timeout is computed from its own ceiling, not guessed:
 *   timeout ≥ max_tokens / 40 tokens·s⁻¹ (a slow decode rate, thinking
 *             tokens included) + max_searches × 10 s (one search and fetch),
 * rounded up to the next minute. `metadata.json` records each stage's real
 * duration (`usage.stages.<stage>.duration_ms`), which is the measurement to
 * replace these ceilings with.
 *
 * The output ceilings leave room for adaptive thinking, which Opus 5.5 always
 * runs and which counts against `max_tokens`.
 */

export interface StageLimits {
  /** `max_tokens` for every request the stage sends. */
  maxTokens: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Web searches one request may run (`max_uses`); 0 for tool-less stages. */
  maxSearches: number;
}

const SECONDS_PER_SEARCH = 10;
const SLOW_TOKENS_PER_SECOND = 40;

function limits(maxTokens: number, maxSearches: number): StageLimits {
  const seconds = maxTokens / SLOW_TOKENS_PER_SECOND + maxSearches * SECONDS_PER_SEARCH;
  return { maxTokens, maxSearches, timeoutMs: Math.ceil(seconds / 60) * 60_000 };
}

const STAGE_LIMITS: Readonly<Record<string, StageLimits>> = {
  scoping: limits(8_000, 0),
  research: limits(16_000, 5),
  stakeholder: limits(16_000, 5),
  // The first live run cut risk's answer at 16 000 (step 0, 2026-11-03,
  // benchmarks/outputs/live/05-supply-chain-acquisition/): twice that.
  risk: limits(32_000, 5),
  options: limits(16_000, 5),
  synthesis: limits(8_000, 0),
  adversarial: limits(16_000, 5),
};

/** The limits for `agentId`; unknown ids get the most generous ones. */
export function stageLimits(agentId: string): StageLimits {
  return STAGE_LIMITS[agentId] ?? limits(16_000, 5);
}
