import { describe, expect, test } from "bun:test";

import {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
  ResearchAgentError,
  MaxToolRoundsExceededError,
  StakeholderMappingError,
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

describe("ResearchAgentError", () => {
  test("carries the research agent id", () => {
    const err = new ResearchAgentError("something broke");
    expect(err).toBeInstanceOf(AgentExecutionError);
    expect(err.agentId).toBe("research");
    expect(err.name).toBe("ResearchAgentError");
    expect(err.message).toContain("something broke");
    expect(err.message).toContain("research");
  });
});

describe("MaxToolRoundsExceededError", () => {
  test("names the cap and extends ResearchAgentError", () => {
    const err = new MaxToolRoundsExceededError(5);
    expect(err).toBeInstanceOf(ResearchAgentError);
    expect(err.maxRounds).toBe(5);
    expect(err.message).toContain("5");
    expect(err.message).toContain("max_tool_rounds");
    expect(err.name).toBe("MaxToolRoundsExceededError");
  });
});

describe("StakeholderMappingError", () => {
  test("carries the stakeholder agent id and message", () => {
    const err = new StakeholderMappingError("count 2 below min 3");
    expect(err).toBeInstanceOf(AgentExecutionError);
    expect(err.agentId).toBe("stakeholder");
    expect(err.name).toBe("StakeholderMappingError");
    expect(err.message).toContain("count 2 below min 3");
    expect(err.message).toContain("stakeholder");
  });
});
