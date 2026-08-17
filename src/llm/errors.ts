/**
 * Error hierarchy for the LLM provider layer.
 *
 * All errors extend `PraxisError` so the CLI dispatch keeps a single
 * catch clause and can render human-readable messages consistently.
 */

import { PraxisError } from "../registry/errors.ts";

export class LLMError extends PraxisError {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

/**
 * Raised when the requested provider name is not recognised by the CLI.
 * v0.3 supports `mock` and `anthropic`.
 */
export class ProviderNotSupportedError extends LLMError {
  readonly provider: string;

  constructor(provider: string) {
    super(
      `Provider '${provider}' not supported. Available providers: 'mock', 'anthropic'.`
    );
    this.name = "ProviderNotSupportedError";
    this.provider = provider;
  }
}

/**
 * Raised when the mock provider cannot find a fixture matching the
 * prompt it was called with — i.e. the caller changed the prompt in a
 * way that invalidates the pre-scripted mapping.
 */
export class MockFixtureNotFoundError extends LLMError {
  readonly promptHash: string;
  readonly fixturesDir: string;

  constructor(promptHash: string, fixturesDir: string) {
    super(
      `MockLLMProvider: no fixture matches prompt hash '${promptHash}' in ${fixturesDir}. Either the prompt changed or the fixture is missing.`
    );
    this.name = "MockFixtureNotFoundError";
    this.promptHash = promptHash;
    this.fixturesDir = fixturesDir;
  }
}

/**
 * Raised when the provider is asked to run tool use but does not
 * implement `completeWithTools`.
 */
export class ToolUseNotSupportedError extends LLMError {
  readonly provider: string;

  constructor(provider: string) {
    super(
      `Provider '${provider}' does not support tool use (completeWithTools). Use a provider that does, e.g. 'anthropic'.`
    );
    this.name = "ToolUseNotSupportedError";
    this.provider = provider;
  }
}

/**
 * Raised at Anthropic provider instantiation when the API key is
 * missing from the environment.
 */
export class AnthropicAuthenticationError extends LLMError {
  constructor() {
    super(
      "ANTHROPIC_API_KEY environment variable not set. See CONTRIBUTING.md for setup."
    );
    this.name = "AnthropicAuthenticationError";
  }
}

/**
 * Raised on non-retriable 4xx errors from the Anthropic API (excluding
 * 429 which has its own class) and on malformed responses that cannot
 * be parsed.
 */
export class AnthropicAPIError extends LLMError {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Anthropic API error (status ${status}): ${truncate(body, 400)}`);
    this.name = "AnthropicAPIError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Raised when the Anthropic API returns 429 after all configured
 * retries have been exhausted. Includes the last response body for
 * diagnosis.
 */
export class AnthropicRateLimitError extends LLMError {
  readonly attempts: number;
  readonly body: string;

  constructor(attempts: number, body: string) {
    super(
      `Anthropic API rate limit hit after ${attempts} attempts. Body: ${truncate(body, 400)}`
    );
    this.name = "AnthropicRateLimitError";
    this.attempts = attempts;
    this.body = body;
  }
}

/**
 * Raised when a single request to the Anthropic API takes longer than
 * the configured timeout.
 */
export class AnthropicTimeoutError extends LLMError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Anthropic API request timed out after ${timeoutMs}ms.`);
    this.name = "AnthropicTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
