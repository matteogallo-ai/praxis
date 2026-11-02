/**
 * v0.8 — Public API surface guard.
 *
 * These tests pin the exports of `src/index.ts` so that a v1.0
 * SemVer commitment can be maintained: adding a public export is
 * a MINOR bump, removing/renaming one is a MAJOR bump. The list
 * below is the CONTRACT; every new export lands here.
 *
 * NB: this is not a smoke test — the assertions are deliberately
 * name-by-name. If a rename or deletion breaks this file, that is
 * the point: the failure surfaces the SemVer question BEFORE the
 * change ships.
 */
import { describe, expect, test } from "bun:test";

import * as PraxisAPI from "../../src/index.ts";

// ---------------------------------------------------------------------------
// Classes / functions expected in the public surface.
// ---------------------------------------------------------------------------

const EXPECTED_VALUE_EXPORTS = [
  // Registry.
  "FormatRegistry",
  "validateFormat",
  "loadFormatFile",
  "loadFormatFromSource",
  "loadRegistry",
  // Registry schema helpers / constants.
  "ORGANIZATION_STYLES",
  "LANGUAGES",
  "SOURCING_POLICIES",
  "AGENT_IDS",
  "OUTPUT_TARGETS",
  "isOrganizationStyle",
  "isLanguage",
  "isSourcingPolicy",
  "isAgentId",
  "isOutputTarget",
  "isKebabCase",
  "isValidSemver",
  "isValidIsoDate",
  // v0.5 sourcing rule schema helpers.
  "DOMAIN_TRUST_MODES",
  "isDomainTrustMode",
  // v0.8 editorial rules.
  "EDITORIAL_ACTIONS",
  "DEFAULT_MAX_REGENERATION_ATTEMPTS",
  "MAX_REGENERATION_ATTEMPTS_CEILING",
  "isEditorialAction",
  // LLM providers.
  "MockLLMProvider",
  "AnthropicLLMProvider",
  // Sourcing.
  "isSourceMissing",
  "validateSourcing",
  "validateStakeholderSourcing",
  "validateRiskSourcing",
  // Agents that stayed public (Scoping / Research / Stakeholder).
  "executeScoping",
  "executeResearch",
  "executeStakeholderMapping",
  "MIN_STAKEHOLDERS",
  "MAX_STAKEHOLDERS",
  // Agent enum constants.
  "RISK_CATEGORIES",
  "RISK_LIKELIHOODS",
  "RISK_IMPACTS",
  "RISK_TIMEFRAMES",
  "AGGREGATED_RISK_LEVELS",
  "OPTION_RECOMMENDATION_LEVELS",
  "CRITIQUE_CATEGORIES",
  "CRITIQUE_SEVERITIES",
  // Orchestrator.
  "Orchestrator",
  "computeReSynthesisDeviations",
  // Renderers dispatcher.
  "render",
  "normaliseRenderTarget",
  "resolveTarget",
  "markdownEnhancedRenderer",
  "docxRenderer",
  "pdfRenderer",
  "RENDER_TARGETS",
  "RENDER_THEMES",
  "hasCritique",
  // Errors (from errors/public.ts barrel).
  "PraxisError",
  "ValidationError",
  "YamlSyntaxError",
  "FileNotFoundError",
  "DuplicateFormatError",
  "FormatNotFoundError",
  "OrchestrationError",
  "NotImplementedError",
  "LLMError",
  "ProviderNotSupportedError",
  "MockFixtureNotFoundError",
  "ToolUseNotSupportedError",
  "AnthropicAuthenticationError",
  "AnthropicAPIError",
  "AnthropicRateLimitError",
  "AnthropicTimeoutError",
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
  "SourcingValidationError",
  "StaleSourceError",
  "UntrustedDomainError",
  "DuplicateSourceError",
  "RenderError",
  "UnsupportedRenderTargetError",
] as const;

describe("Public API — v0.8 value exports", () => {
  for (const name of EXPECTED_VALUE_EXPORTS) {
    test(`exports '${name}'`, () => {
      expect((PraxisAPI as Record<string, unknown>)[name]).toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// The Orchestrator methods v0.8 promises.
// ---------------------------------------------------------------------------

describe("Public API — Orchestrator methods", () => {
  test("Orchestrator prototype has every v0.2 → v0.8 method", () => {
    const proto = PraxisAPI.Orchestrator.prototype as unknown as Record<
      string,
      unknown
    >;
    // Enumerated with the pipeline version each ships in.
    expect(typeof proto["scope"]).toBe("function"); // v0.2
    expect(typeof proto["researchAfterScoping"]).toBe("function"); // v0.3
    expect(typeof proto["mapStakeholdersAfterResearch"]).toBe("function"); // v0.4
    expect(typeof proto["assessRisksAfterStakeholders"]).toBe("function"); // v0.5
    expect(typeof proto["brief"]).toBe("function"); // v0.6
    expect(typeof proto["briefWithCritique"]).toBe("function"); // v0.7
    expect(typeof proto["briefWithCritiqueAndRerun"]).toBe("function"); // v0.8
  });
});

// ---------------------------------------------------------------------------
// Sanity: the executeXxx() functions for v0.5+ agents are NOT public.
// The Orchestrator owns their sequencing.
// ---------------------------------------------------------------------------

describe("Public API — internal executeXxx() implementations are hidden", () => {
  test("executeRiskAnalysis / executeOptionsGeneration / executeSynthesis / executeAdversarialCritique are NOT re-exported", () => {
    const api = PraxisAPI as Record<string, unknown>;
    expect(api["executeRiskAnalysis"]).toBeUndefined();
    expect(api["executeOptionsGeneration"]).toBeUndefined();
    expect(api["executeSynthesis"]).toBeUndefined();
    expect(api["executeAdversarialCritique"]).toBeUndefined();
  });
});
