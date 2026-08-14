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
 * Raised when the requested provider is not implemented in the current
 * Praxis release. v0.2 only ships `mock`; real providers land in v0.3+.
 */
export class ProviderNotSupportedError extends LLMError {
  readonly provider: string;

  constructor(provider: string) {
    super(
      `Provider '${provider}' not supported in v0.2. Only 'mock' is available. See ROADMAP.md for provider timeline.`
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
