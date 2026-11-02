/**
 * Bounded retry of one stage on errors a second attempt can fix.
 *
 * Recoverable: a request timeout, a rate limit or a 5xx left after the
 * provider's own backoff, and an answer that was not the JSON the stage
 * asked for (a fresh sample often is). Everything else — authentication,
 * a 4xx, a prompt file error, a budget stop, a sourcing failure, a
 * cross-reference the model got wrong — fails at once,
 * because repeating the call repeats the cost and the outcome.
 */
import { AgentExecutionError, InvalidAgentOutputError } from "../agents/errors.ts";
import {
  AnthropicAPIError,
  AnthropicRateLimitError,
  AnthropicTimeoutError,
} from "../llm/errors.ts";

export function isRecoverable(err: unknown): boolean {
  if (err instanceof InvalidAgentOutputError) return true;
  const inner = err instanceof AgentExecutionError && err.cause !== undefined ? err.cause : err;
  if (inner instanceof AnthropicTimeoutError || inner instanceof AnthropicRateLimitError) return true;
  return inner instanceof AnthropicAPIError && inner.status >= 500;
}

/** Runs `fn` up to `attempts` times, retrying only recoverable errors. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  onRetry: (err: unknown, attempt: number) => void = () => {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isRecoverable(err)) throw err;
      onRetry(err, attempt);
    }
  }
}
