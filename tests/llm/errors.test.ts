import { describe, expect, test } from "bun:test";

import {
  LLMError,
  ProviderNotSupportedError,
  MockFixtureNotFoundError,
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
  test("mentions the offending provider name", () => {
    const err = new ProviderNotSupportedError("openai");
    expect(err.provider).toBe("openai");
    expect(err.message).toContain("openai");
    expect(err.message).toContain("v0.2");
    expect(err.message).toContain("mock");
    expect(err.message).toContain("ROADMAP");
  });

  test("is a subclass of LLMError and PraxisError", () => {
    const err = new ProviderNotSupportedError("anthropic");
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
