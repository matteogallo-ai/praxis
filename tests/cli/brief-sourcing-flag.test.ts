import { describe, expect, test } from "bun:test";

import { parseBriefArgs } from "../../src/cli/commands/brief.ts";

describe("praxis brief --on-sourcing-failure", () => {
  test("defaults to degrade", () => {
    expect(parseBriefArgs(["Q", "--format", "executive-pre-read"]).onSourcingFailure).toBe(
      "degrade"
    );
  });

  test("accepts abort, in both spellings", () => {
    expect(
      parseBriefArgs(["Q", "--format", "x", "--on-sourcing-failure", "abort"]).onSourcingFailure
    ).toBe("abort");
    expect(
      parseBriefArgs(["Q", "--format", "x", "--on-sourcing-failure=abort"]).onSourcingFailure
    ).toBe("abort");
  });

  test("rejects anything else", () => {
    expect(parseBriefArgs(["Q", "--format", "x", "--on-sourcing-failure", "skip"]).error).toBe(
      "--on-sourcing-failure expects 'abort' or 'degrade'"
    );
  });
});
