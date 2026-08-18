import { describe, expect, test } from "bun:test";

import {
  AdversarialCritiqueError,
  AgentExecutionError,
  InvalidAgentOutputError,
  InvalidCritiqueTargetError,
  InvalidOptionRiskReference,
  InvalidOptionStakeholderReference,
  InvalidRiskStakeholderReference,
  MaxToolRoundsExceededError,
  MissingAlternativeError,
  OptionsGenerationError,
  PromptFileError,
  ResearchAgentError,
  RiskAnalysisError,
  RiskInflationError,
  StakeholderMappingError,
  SynthesisError,
  SynthesisValidationError,
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

describe("RiskAnalysisError", () => {
  test("carries the risk agent id and message", () => {
    const err = new RiskAnalysisError("duplicate id RISK-001");
    expect(err).toBeInstanceOf(AgentExecutionError);
    expect(err.agentId).toBe("risk");
    expect(err.name).toBe("RiskAnalysisError");
    expect(err.message).toContain("duplicate id RISK-001");
    expect(err.message).toContain("risk");
  });
});

describe("InvalidRiskStakeholderReference", () => {
  test("mentions the risk id, unknown name, and known set", () => {
    const err = new InvalidRiskStakeholderReference(
      "RISK-004",
      "Made Up",
      ["Alice", "Bob"]
    );
    expect(err).toBeInstanceOf(RiskAnalysisError);
    expect(err.riskId).toBe("RISK-004");
    expect(err.unknownStakeholder).toBe("Made Up");
    expect(err.message).toContain("RISK-004");
    expect(err.message).toContain("Made Up");
    expect(err.message).toContain("Alice");
    expect(err.message).toContain("Bob");
  });
});

describe("RiskInflationError", () => {
  test("names the count and the cap", () => {
    const err = new RiskInflationError(30, 25);
    expect(err).toBeInstanceOf(RiskAnalysisError);
    expect(err.count).toBe(30);
    expect(err.max).toBe(25);
    expect(err.message).toContain("30");
    expect(err.message).toContain("25");
  });
});

describe("OptionsGenerationError", () => {
  test("carries the options agent id and message", () => {
    const err = new OptionsGenerationError("no recommended option found");
    expect(err).toBeInstanceOf(AgentExecutionError);
    expect(err.agentId).toBe("options");
    expect(err.name).toBe("OptionsGenerationError");
    expect(err.message).toContain("no recommended option found");
    expect(err.message).toContain("options");
  });
});

describe("InvalidOptionStakeholderReference", () => {
  test("mentions the option id, unknown name, and known set", () => {
    const err = new InvalidOptionStakeholderReference(
      "OPT-B",
      "Ghost Actor",
      ["Alice", "Bob"]
    );
    expect(err).toBeInstanceOf(OptionsGenerationError);
    expect(err.optionId).toBe("OPT-B");
    expect(err.unknownStakeholder).toBe("Ghost Actor");
    expect(err.message).toContain("OPT-B");
    expect(err.message).toContain("Ghost Actor");
    expect(err.message).toContain("Alice");
    expect(err.message).toContain("Bob");
  });
});

describe("InvalidOptionRiskReference", () => {
  test("mentions the option id, unknown risk id, and field", () => {
    const err = new InvalidOptionRiskReference(
      "OPT-A",
      "RISK-999",
      "risks_mitigated",
      ["RISK-001", "RISK-002"]
    );
    expect(err).toBeInstanceOf(OptionsGenerationError);
    expect(err.optionId).toBe("OPT-A");
    expect(err.unknownRiskId).toBe("RISK-999");
    expect(err.field).toBe("risks_mitigated");
    expect(err.message).toContain("OPT-A");
    expect(err.message).toContain("RISK-999");
    expect(err.message).toContain("risks_mitigated");
    expect(err.message).toContain("RISK-001");
  });

  test("also works for risks_introduced field", () => {
    const err = new InvalidOptionRiskReference(
      "OPT-C",
      "RISK-042",
      "risks_introduced",
      []
    );
    expect(err.field).toBe("risks_introduced");
    expect(err.message).toContain("risks_introduced");
  });
});

describe("SynthesisError", () => {
  test("carries the synthesis agent id and message", () => {
    const err = new SynthesisError("missing section 'answer' in output");
    expect(err).toBeInstanceOf(AgentExecutionError);
    expect(err.agentId).toBe("synthesis");
    expect(err.name).toBe("SynthesisError");
    expect(err.message).toContain("missing section 'answer'");
    expect(err.message).toContain("synthesis");
  });
});

describe("SynthesisValidationError", () => {
  test("carries the issue list and extends SynthesisError", () => {
    const err = new SynthesisValidationError([
      "section 'recommendation' exceeds max_length",
      "forbidden term 'obviously' found 2 times in 'issue-framing'",
    ]);
    expect(err).toBeInstanceOf(SynthesisError);
    expect(err.name).toBe("SynthesisValidationError");
    expect(err.issues).toHaveLength(2);
    expect(err.message).toContain("2 issue");
    expect(err.message).toContain("recommendation");
  });

  test("handles the empty-issues case gracefully", () => {
    const err = new SynthesisValidationError([]);
    expect(err.issues).toEqual([]);
    expect(err.message).toContain("0 issue");
  });
});

describe("AdversarialCritiqueError", () => {
  test("carries the adversarial agent id and message", () => {
    const err = new AdversarialCritiqueError("steelman too short");
    expect(err).toBeInstanceOf(AgentExecutionError);
    expect(err.agentId).toBe("adversarial");
    expect(err.name).toBe("AdversarialCritiqueError");
    expect(err.message).toContain("adversarial");
    expect(err.message).toContain("steelman too short");
  });
});

describe("InvalidCritiqueTargetError", () => {
  test("mentions the critique id and the reason", () => {
    const err = new InvalidCritiqueTargetError(
      "CRIT-003",
      "unknown option_id 'OPT-Z'"
    );
    expect(err).toBeInstanceOf(AdversarialCritiqueError);
    expect(err.critiqueId).toBe("CRIT-003");
    expect(err.reason).toBe("unknown option_id 'OPT-Z'");
    expect(err.message).toContain("CRIT-003");
    expect(err.message).toContain("unknown option_id");
  });
});

describe("MissingAlternativeError", () => {
  test("has a fixed explanatory message", () => {
    const err = new MissingAlternativeError();
    expect(err).toBeInstanceOf(AdversarialCritiqueError);
    expect(err.name).toBe("MissingAlternativeError");
    expect(err.message).toContain("revised_recommendation_needed");
    expect(err.message).toContain("steelmanned_alternative");
  });
});
