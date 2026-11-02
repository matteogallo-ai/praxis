/**
 * `NotImplementedError` is deprecated but still public (docs/SEMVER-CONTRACT.md);
 * these tests keep its 1.x behaviour stable until it is removed.
 */

import { describe, expect, test } from "bun:test";

import { NotImplementedError } from "../../src/orchestrator/errors.ts";
import { PraxisError } from "../../src/registry/errors.ts";

describe("NotImplementedError", () => {
  test("stores feature and plannedRelease", () => {
    const err = new NotImplementedError("some feature", "v0.9");
    expect(err.feature).toBe("some feature");
    expect(err.plannedRelease).toBe("v0.9");
    expect(err.message).toContain("some feature");
    expect(err.message).toContain("v0.9");
    expect(err.name).toBe("NotImplementedError");
  });

  test("extends PraxisError", () => {
    const err = new NotImplementedError("f", "vX");
    expect(err).toBeInstanceOf(PraxisError);
  });

  test("message mentions the ROADMAP for discoverability", () => {
    const err = new NotImplementedError("some feature", "v1.0");
    expect(err.message).toContain("ROADMAP");
  });
});
