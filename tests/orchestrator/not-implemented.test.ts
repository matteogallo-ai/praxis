import { describe, expect, test } from "bun:test";

import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { NotImplementedError } from "../../src/orchestrator/errors.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { PraxisError } from "../../src/registry/errors.ts";

describe("Orchestrator.brief — deferred to v0.6+", () => {
  test("throws NotImplementedError explicitly (never a silent no-op)", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const orch = new Orchestrator(
      registry,
      new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" })
    );

    let caught: unknown;
    try {
      await orch.brief("Anything", "executive-pre-read");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    expect(caught).toBeInstanceOf(PraxisError);
    const e = caught as NotImplementedError;
    expect(e.feature).toContain("brief");
    expect(e.plannedRelease).toContain("v0.6");
    expect(e.message).toContain("ROADMAP");
  });
});

describe("NotImplementedError", () => {
  test("standalone constructor stores feature and plannedRelease", () => {
    const err = new NotImplementedError("some feature", "v0.9");
    expect(err.feature).toBe("some feature");
    expect(err.plannedRelease).toBe("v0.9");
    expect(err.message).toContain("some feature");
    expect(err.message).toContain("v0.9");
    expect(err.name).toBe("NotImplementedError");
  });
});
