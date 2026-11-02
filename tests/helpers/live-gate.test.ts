import { describe, expect, test } from "bun:test";

import { liveTestsEnabled } from "./live-gate.ts";

describe("liveTestsEnabled", () => {
  test("a key alone does not enable paid live tests", () => {
    // Bun loads .env automatically, so a developer's key is always present
    // under `bun test`; the key must not be the opt-in.
    expect(liveTestsEnabled({ ANTHROPIC_API_KEY: "sk-ant-test" })).toBe(false);
  });

  test("the explicit opt-in without a key does not enable them", () => {
    expect(liveTestsEnabled({ PRAXIS_LIVE_TESTS: "1" })).toBe(false);
    expect(liveTestsEnabled({ PRAXIS_LIVE_TESTS: "1", ANTHROPIC_API_KEY: "" })).toBe(false);
  });

  test("the opt-in plus a key enables them", () => {
    expect(
      liveTestsEnabled({ PRAXIS_LIVE_TESTS: "1", ANTHROPIC_API_KEY: "sk-ant-test" })
    ).toBe(true);
  });

  test("any opt-in value other than 1 is refused", () => {
    expect(
      liveTestsEnabled({ PRAXIS_LIVE_TESTS: "true", ANTHROPIC_API_KEY: "sk-ant-test" })
    ).toBe(false);
  });
});
