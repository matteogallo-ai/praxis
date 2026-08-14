import { describe, expect, test } from "bun:test";

import {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
} from "../../src/agents/errors.ts";
import { PraxisError } from "../../src/registry/errors.ts";

describe("AgentExecutionError", () => {
  test("extends PraxisError and carries agentId", () => {
    const err = new AgentExecutionError("scoping", "network dead");
    expect(err).toBeInstanceOf(PraxisError);
    expect(err.agentId).toBe("scoping");
    expect(err.name).toBe("AgentExecutionError");
    expect(err.message).toContain("scoping");
    expect(err.message).toContain("network dead");
  });
});

describe("InvalidAgentOutputError", () => {
  test("preserves reason and raw output", () => {
    const err = new InvalidAgentOutputError("scoping", "not JSON", "<garbage>");
    expect(err).toBeInstanceOf(AgentExecutionError);
    expect(err.reason).toBe("not JSON");
    expect(err.rawOutput).toBe("<garbage>");
    expect(err.name).toBe("InvalidAgentOutputError");
    expect(err.message).toContain("not JSON");
  });
});

describe("PromptFileError", () => {
  test("preserves path and reason", () => {
    const err = new PromptFileError("scoping", "prompts/x.prompt", "parse failed");
    expect(err).toBeInstanceOf(AgentExecutionError);
    expect(err.path).toBe("prompts/x.prompt");
    expect(err.message).toContain("prompts/x.prompt");
    expect(err.message).toContain("parse failed");
    expect(err.name).toBe("PromptFileError");
  });
});
