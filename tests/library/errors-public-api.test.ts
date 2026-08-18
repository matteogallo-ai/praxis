/**
 * v0.8 — Public error taxonomy contract.
 *
 * Every error class re-exported from `src/index.ts` MUST inherit
 * from `PraxisError`. This test enforces that discipline so an
 * embedder can write ONE `catch (e instanceof PraxisError)` and be
 * confident every typed failure is caught.
 *
 * A future release adding a new public error class MUST also add it
 * here; forgetting is treated as a regression.
 */
import { describe, expect, test } from "bun:test";

import * as PraxisAPI from "../../src/index.ts";
import { PraxisError } from "../../src/registry/errors.ts";

// ---------------------------------------------------------------------------
// Names of every public error class the barrel promises.
// ---------------------------------------------------------------------------

const PUBLIC_ERROR_NAMES = [
  // Root.
  "PraxisError",
  // Registry / validation.
  "ValidationError",
  "YamlSyntaxError",
  "FileNotFoundError",
  "DuplicateFormatError",
  "FormatNotFoundError",
  // Orchestrator.
  "OrchestrationError",
  "NotImplementedError",
  // LLM.
  "LLMError",
  "ProviderNotSupportedError",
  "MockFixtureNotFoundError",
  "ToolUseNotSupportedError",
  "AnthropicAuthenticationError",
  "AnthropicAPIError",
  "AnthropicRateLimitError",
  "AnthropicTimeoutError",
  // Agents.
  "AgentExecutionError",
  "InvalidAgentOutputError",
  "PromptFileError",
  "ResearchAgentError",
  "MaxToolRoundsExceededError",
  "StakeholderMappingError",
  "RiskAnalysisError",
  "InvalidRiskStakeholderReference",
  "RiskInflationError",
  "OptionsGenerationError",
  "InvalidOptionStakeholderReference",
  "InvalidOptionRiskReference",
  "SynthesisError",
  "SynthesisValidationError",
  "AdversarialCritiqueError",
  "InvalidCritiqueTargetError",
  "MissingAlternativeError",
  "EditorialFailureError",
  // Sourcing.
  "SourcingValidationError",
  "StaleSourceError",
  "UntrustedDomainError",
  "DuplicateSourceError",
  // Renderers.
  "RenderError",
  "UnsupportedRenderTargetError",
] as const;

describe("Public error taxonomy — every class extends PraxisError", () => {
  for (const name of PUBLIC_ERROR_NAMES) {
    test(`'${name}' extends PraxisError`, () => {
      const ctor = (PraxisAPI as Record<string, unknown>)[name];
      expect(ctor).toBeDefined();
      // Prototype-chain check without instantiating (some constructors
      // require domain-specific arguments).
      if (name === "PraxisError") {
        expect(ctor).toBe(PraxisError);
        return;
      }
      const proto = (ctor as new (...args: unknown[]) => unknown).prototype;
      const chain: string[] = [];
      let current: unknown = proto;
      while (current !== null && current !== undefined) {
        const c = (current as { constructor?: { name?: string } }).constructor;
        if (c?.name !== undefined) chain.push(c.name);
        current = Object.getPrototypeOf(current);
      }
      expect(chain).toContain("PraxisError");
    });
  }
});

// ---------------------------------------------------------------------------
// Spot-checks: a caught PraxisError from one subsystem is
// discriminable via `instanceof` against every ancestor.
// ---------------------------------------------------------------------------

describe("Public error taxonomy — instanceof discipline", () => {
  test("EditorialFailureError is-a SynthesisError is-a AgentExecutionError is-a PraxisError", () => {
    const err = new PraxisAPI.EditorialFailureError(
      "intro",
      "forbidden_terms",
      [
        {
          attempt_number: 1,
          reason: "forbidden_terms",
          details: "found 'obviously'",
          accepted: false,
        },
      ]
    );
    expect(err).toBeInstanceOf(PraxisAPI.EditorialFailureError);
    expect(err).toBeInstanceOf(PraxisAPI.SynthesisError);
    expect(err).toBeInstanceOf(PraxisAPI.AgentExecutionError);
    expect(err).toBeInstanceOf(PraxisAPI.PraxisError);
  });

  test("InvalidCritiqueTargetError chain: → AdversarialCritiqueError → AgentExecutionError → PraxisError", () => {
    const err = new PraxisAPI.InvalidCritiqueTargetError(
      "CRIT-042",
      "unknown option_id 'OPT-Z'"
    );
    expect(err).toBeInstanceOf(PraxisAPI.InvalidCritiqueTargetError);
    expect(err).toBeInstanceOf(PraxisAPI.AdversarialCritiqueError);
    expect(err).toBeInstanceOf(PraxisAPI.AgentExecutionError);
    expect(err).toBeInstanceOf(PraxisAPI.PraxisError);
  });

  test("UnsupportedRenderTargetError chain: → RenderError → PraxisError", () => {
    const err = new PraxisAPI.UnsupportedRenderTargetError(
      "epub",
      "test-format",
      ["md", "pdf"]
    );
    expect(err).toBeInstanceOf(PraxisAPI.UnsupportedRenderTargetError);
    expect(err).toBeInstanceOf(PraxisAPI.RenderError);
    expect(err).toBeInstanceOf(PraxisAPI.PraxisError);
  });

  test("StaleSourceError chain: → SourcingValidationError → PraxisError", () => {
    const stubReport: PraxisAPI.SourcingReport = {
      policy: "strict",
      total_items: 1,
      counts: { ok: 0, stale: 1, untrusted: 0, duplicated: 0, missing: 0 },
      warnings: [],
      missing_sources_count: 0,
    };
    const err = new PraxisAPI.StaleSourceError(
      stubReport,
      "https://example.com/x",
      900,
      180
    );
    expect(err).toBeInstanceOf(PraxisAPI.StaleSourceError);
    expect(err).toBeInstanceOf(PraxisAPI.SourcingValidationError);
    expect(err).toBeInstanceOf(PraxisAPI.PraxisError);
  });
});
