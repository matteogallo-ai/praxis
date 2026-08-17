import { describe, expect, test } from "bun:test";

import {
  LLMError,
  ProviderNotSupportedError,
  MockFixtureNotFoundError,
  ToolUseNotSupportedError,
  AnthropicAuthenticationError,
  AnthropicAPIError,
  AnthropicRateLimitError,
  AnthropicTimeoutError,
} from "../../src/llm/errors.ts";
import { PraxisError } from "../../src/registry/errors.ts";

describe("LLMError", () => {
  test("extends PraxisError", () => {
    const err = new LLMError("boom");
    expect(err).toBeInstanceOf(PraxisError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("LLMError");
    expect(err.message).toBe("boom");
  });
});

describe("ProviderNotSupportedError", () => {
  test("mentions the offending provider name and the supported alternatives", () => {
    const err = new ProviderNotSupportedError("openai");
    expect(err.provider).toBe("openai");
    expect(err.message).toContain("openai");
    expect(err.message).toContain("mock");
    expect(err.message).toContain("anthropic");
  });

  test("is a subclass of LLMError and PraxisError", () => {
    const err = new ProviderNotSupportedError("weird");
    expect(err).toBeInstanceOf(LLMError);
    expect(err).toBeInstanceOf(PraxisError);
    expect(err.name).toBe("ProviderNotSupportedError");
  });
});

describe("MockFixtureNotFoundError", () => {
  test("carries the prompt hash and fixtures dir", () => {
    const err = new MockFixtureNotFoundError("abc123", "/tmp/fixtures");
    expect(err.promptHash).toBe("abc123");
    expect(err.fixturesDir).toBe("/tmp/fixtures");
    expect(err.message).toContain("abc123");
    expect(err.message).toContain("/tmp/fixtures");
    expect(err.name).toBe("MockFixtureNotFoundError");
  });

  test("is a subclass of LLMError", () => {
    const err = new MockFixtureNotFoundError("x", "y");
    expect(err).toBeInstanceOf(LLMError);
  });
});

describe("ToolUseNotSupportedError", () => {
  test("mentions the offending provider and the fix", () => {
    const err = new ToolUseNotSupportedError("mock");
    expect(err.provider).toBe("mock");
    expect(err.message).toContain("mock");
    expect(err.message).toContain("completeWithTools");
    expect(err.message).toContain("anthropic");
    expect(err).toBeInstanceOf(LLMError);
    expect(err.name).toBe("ToolUseNotSupportedError");
  });
});

describe("AnthropicAuthenticationError", () => {
  test("names the missing env var and points at CONTRIBUTING.md", () => {
    const err = new AnthropicAuthenticationError();
    expect(err.message).toContain("ANTHROPIC_API_KEY");
    expect(err.message).toContain("CONTRIBUTING.md");
    expect(err).toBeInstanceOf(LLMError);
    expect(err.name).toBe("AnthropicAuthenticationError");
  });
});

describe("AnthropicAPIError", () => {
  test("carries the HTTP status and truncates the body", () => {
    const bigBody = "x".repeat(1000);
    const err = new AnthropicAPIError(400, bigBody);
    expect(err.status).toBe(400);
    expect(err.body).toBe(bigBody);
    expect(err.message).toContain("400");
    expect(err.message.length).toBeLessThan(bigBody.length);
    expect(err.name).toBe("AnthropicAPIError");
    expect(err).toBeInstanceOf(LLMError);
  });

  test("preserves short bodies verbatim in the message", () => {
    const err = new AnthropicAPIError(500, "internal");
    expect(err.message).toContain("internal");
  });
});

describe("AnthropicRateLimitError", () => {
  test("names the attempt count and includes the last body", () => {
    const err = new AnthropicRateLimitError(3, "rate limit exceeded");
    expect(err.attempts).toBe(3);
    expect(err.body).toBe("rate limit exceeded");
    expect(err.message).toContain("3");
    expect(err.message).toContain("rate limit exceeded");
    expect(err.name).toBe("AnthropicRateLimitError");
    expect(err).toBeInstanceOf(LLMError);
  });
});

describe("AnthropicTimeoutError", () => {
  test("names the timeout in ms", () => {
    const err = new AnthropicTimeoutError(60000);
    expect(err.timeoutMs).toBe(60000);
    expect(err.message).toContain("60000");
    expect(err.name).toBe("AnthropicTimeoutError");
    expect(err).toBeInstanceOf(LLMError);
  });
});
