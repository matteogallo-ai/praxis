/**
 * `Orchestrator` — the Praxis pipeline coordinator.
 *
 * v0.2 shipped `scope()`. v0.3 added `researchAfterScoping()`.
 * v0.4 added `mapStakeholdersAfterResearch()`. v0.5 added
 * `assessRisksAfterStakeholders()` and the hardened sourcing
 * pipeline.
 *
 * v0.6 finally implements `brief()` — the full six-agent pipeline
 * that produces a complete, formatted briefing (Scoping → Research
 * → Stakeholders → Risks → Options → Synthesis) with the aggregated
 * cross-agent sourcing report attached.
 */

import type { FormatRegistry } from "../registry/registry.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type {
  OptionsGenerationResult,
  ResearchResult,
  RiskAnalysisResult,
  ScopingResult,
  StakeholderMapResult,
  SynthesisResult,
} from "../agents/types.ts";
import type { Format } from "../registry/schema.ts";
import type {
  SourcingAccumulator,
  SourcingReport,
} from "../sourcing/types.ts";
import { executeScoping } from "../agents/scoping.ts";
import { executeResearch } from "../agents/research.ts";
import { executeStakeholderMapping } from "../agents/stakeholder.ts";
import { executeRiskAnalysis } from "../agents/risk.ts";
import { executeOptionsGeneration } from "../agents/options.ts";
import { executeSynthesis } from "../agents/synthesis.ts";
import {
  validateRiskSourcing,
  validateSourcing,
  validateStakeholderSourcing,
} from "../sourcing/validator.ts";
import {
  InMemorySourcingAccumulator,
  NoopSourcingAccumulator,
} from "../sourcing/dedupe.ts";
import { mergeReports } from "../sourcing/report.ts";
import { OrchestrationError } from "./errors.ts";

export interface ScopeOptions {
  /** Overrides the scoping prompt file path — used in tests. */
  scopingPromptPath?: string;
}

export interface ResearchAfterScopingOptions extends ScopeOptions {
  /** Overrides the research prompt file path — used in tests. */
  researchPromptPath?: string;
  /** Hard cap on tool-use rounds for the Research agent. */
  researchMaxToolRounds?: number;
}

export interface MapStakeholdersAfterResearchOptions
  extends ResearchAfterScopingOptions {
  /** Overrides the stakeholder prompt file path — used in tests. */
  stakeholderPromptPath?: string;
  /** Hard cap on tool-use rounds for the Stakeholder Mapping agent. */
  stakeholderMaxToolRounds?: number;
}

export interface AssessRisksAfterStakeholdersOptions
  extends MapStakeholdersAfterResearchOptions {
  /** Overrides the risk prompt file path — used in tests. */
  riskPromptPath?: string;
  /** Hard cap on tool-use rounds for the Risk Analysis agent. */
  riskMaxToolRounds?: number;
  /**
   * Injectable clock for freshness validation (tests). Defaults to
   * `new Date()` at pipeline start.
   */
  now?: Date;
}

export interface BriefOptions extends AssessRisksAfterStakeholdersOptions {
  /** Overrides the options prompt file path — used in tests. */
  optionsPromptPath?: string;
  /** Hard cap on tool-use rounds for the Options agent. */
  optionsMaxToolRounds?: number;
  /** Overrides the synthesis prompt file path — used in tests. */
  synthesisPromptPath?: string;
  /**
   * Provider name to attach to the returned `BriefResult` (audit
   * trail). Defaults to the LLM provider's `name` field.
   */
  providerName?: string;
}

export interface ResearchAfterScopingResult {
  scoping: ScopingResult;
  research: ResearchResult;
}

export interface MapStakeholdersAfterResearchResult {
  scoping: ScopingResult;
  research: ResearchResult;
  stakeholders: StakeholderMapResult;
}

export interface AssessRisksAfterStakeholdersResult {
  scoping: ScopingResult;
  research: ResearchResult;
  stakeholders: StakeholderMapResult;
  risks: RiskAnalysisResult;
  /** Aggregated cross-agent sourcing report (v0.5). */
  sourcing_report: SourcingReport;
}

/**
 * Full briefing payload returned by `Orchestrator.brief()` — the
 * complete pipeline output plus the audit metadata a downstream
 * consumer (CLI, report renderer, human reviewer) needs to reason
 * about the run.
 */
export interface BriefResult {
  scoping: ScopingResult;
  research: ResearchResult;
  stakeholders: StakeholderMapResult;
  risks: RiskAnalysisResult;
  options: OptionsGenerationResult;
  synthesis: SynthesisResult;
  sourcing_report: SourcingReport;
  /** ISO 8601 UTC timestamp of pipeline start. */
  generated_at: string;
  format_id: string;
  question: string;
  provider_name: string;
}

export class Orchestrator {
  private readonly registry: FormatRegistry;
  private readonly llm: LLMProvider;

  constructor(registry: FormatRegistry, llm: LLMProvider) {
    this.registry = registry;
    this.llm = llm;
  }

  /**
   * Runs the Scoping agent for `question` under the selected format.
   *
   * Throws `OrchestrationError` if the format does not require the
   * `scoping` agent in any of its sections — a briefing whose format
   * ignores scoping should not silently run scoping anyway.
   */
  async scope(
    question: string,
    formatId: string,
    options: ScopeOptions = {}
  ): Promise<ScopingResult> {
    const format = this.prepareForScoping(question, formatId);
    return this.doScoping(question, format, options);
  }

  /**
   * Runs Scoping, then Research, and enforces the format's sourcing
   * policy on the research findings. Returns both structured outputs.
   *
   * Throws:
   *   - `OrchestrationError` if the format does not require both
   *     `scoping` and `research` in any of its sections.
   *   - `SourcingValidationError` when `sourcing_policy === "strict"`
   *     and one or more findings are marked `SOURCE_MISSING`.
   *   - Any typed error surfaced by the underlying agents / LLM.
   */
  async researchAfterScoping(
    question: string,
    formatId: string,
    options: ResearchAfterScopingOptions = {}
  ): Promise<ResearchAfterScopingResult> {
    const format = this.prepareForScoping(question, formatId);
    if (!formatRequiresAgent(format, "research")) {
      throw new OrchestrationError(
        `Format '${formatId}' does not list 'research' in any section's required_agents; nothing to research.`
      );
    }

    const scoping = await this.doScoping(question, format, options);
    const research = await this.doResearch(scoping, format, options);
    validateSourcing(research, format.sourcing_policy);
    return { scoping, research };
  }

  /**
   * Runs Scoping → Research → Stakeholder Mapping and enforces the
   * format's sourcing policy on BOTH research findings and stakeholder
   * position evidence. Returns the three structured outputs.
   *
   * Throws:
   *   - `OrchestrationError` if the format does not require `scoping`,
   *     `research`, AND `stakeholder` in its sections.
   *   - `SourcingValidationError` when `sourcing_policy === "strict"`
   *     and one or more research findings OR stakeholder positions
   *     lack a source.
   *   - Any typed error surfaced by the underlying agents / LLM.
   */
  async mapStakeholdersAfterResearch(
    question: string,
    formatId: string,
    options: MapStakeholdersAfterResearchOptions = {}
  ): Promise<MapStakeholdersAfterResearchResult> {
    const format = this.prepareForScoping(question, formatId);
    if (!formatRequiresAgent(format, "research")) {
      throw new OrchestrationError(
        `Format '${formatId}' does not list 'research' in any section's required_agents; nothing to research.`
      );
    }
    if (!formatRequiresAgent(format, "stakeholder")) {
      throw new OrchestrationError(
        `Format '${formatId}' does not list 'stakeholder' in any section's required_agents; nothing to map.`
      );
    }

    const scoping = await this.doScoping(question, format, options);
    const research = await this.doResearch(scoping, format, options);
    validateSourcing(research, format.sourcing_policy);

    const stakeholders = await this.doMapStakeholders(
      scoping,
      research,
      format,
      options
    );
    validateStakeholderSourcing(stakeholders, format.sourcing_policy);

    return { scoping, research, stakeholders };
  }

  /**
   * Runs Scoping → Research → Stakeholder Mapping → Risk Analysis and
   * enforces the format's sourcing policy AND the v0.5 hardened
   * sourcing rules (freshness, domain trust, cross-agent dedupe) end
   * to end.
   *
   * Returns the four structured outputs plus an aggregated
   * `sourcing_report` covering the whole pipeline run.
   *
   * Throws:
   *   - `OrchestrationError` if the format does not require `scoping`,
   *     `research`, `stakeholder`, AND `risk` in its sections.
   *   - Any typed subclass of `SourcingValidationError` (`StaleSource…`,
   *     `UntrustedDomain…`) when strict policy is violated by any
   *     inspected source across the pipeline.
   *   - `RiskAnalysisError` / `InvalidRiskStakeholderReference` /
   *     `RiskInflationError` from the Risk agent.
   */
  async assessRisksAfterStakeholders(
    question: string,
    formatId: string,
    options: AssessRisksAfterStakeholdersOptions = {}
  ): Promise<AssessRisksAfterStakeholdersResult> {
    const format = this.prepareForScoping(question, formatId);
    if (!formatRequiresAgent(format, "research")) {
      throw new OrchestrationError(
        `Format '${formatId}' does not list 'research' in any section's required_agents; nothing to research.`
      );
    }
    if (!formatRequiresAgent(format, "stakeholder")) {
      throw new OrchestrationError(
        `Format '${formatId}' does not list 'stakeholder' in any section's required_agents; nothing to map.`
      );
    }
    if (!formatRequiresAgent(format, "risk")) {
      throw new OrchestrationError(
        `Format '${formatId}' does not list 'risk' in any section's required_agents; nothing to assess.`
      );
    }

    const rules = format.sourcing_rules;
    const accumulator: SourcingAccumulator =
      rules?.dedupe?.cross_agent === true
        ? new InMemorySourcingAccumulator(rules.dedupe)
        : new NoopSourcingAccumulator();
    const now = options.now ?? new Date();
    const validateOpts: Parameters<typeof validateSourcing>[2] = {
      accumulator,
      now,
    };
    if (rules !== undefined) validateOpts.rules = rules;

    const scoping = await this.doScoping(question, format, options);
    const research = await this.doResearch(scoping, format, options);
    const researchReport = validateSourcing(
      research,
      format.sourcing_policy,
      validateOpts
    );

    const stakeholders = await this.doMapStakeholders(
      scoping,
      research,
      format,
      options
    );
    const stakeholderReport = validateStakeholderSourcing(
      stakeholders,
      format.sourcing_policy,
      validateOpts
    );

    const risks = await this.doAssessRisks(
      scoping,
      research,
      stakeholders,
      format,
      options
    );
    const riskReport = validateRiskSourcing(
      risks,
      format.sourcing_policy,
      validateOpts
    );

    const sourcing_report = mergeReports(format.sourcing_policy, [
      researchReport,
      stakeholderReport,
      riskReport,
    ]);

    return { scoping, research, stakeholders, risks, sourcing_report };
  }

  /**
   * Runs the full v0.6 briefing pipeline end to end:
   *
   *   Scoping → Research → Stakeholders → Risks → Options → Synthesis
   *
   * A single `SourcingAccumulator` is threaded through every
   * sourcing validation so cross-agent dedupe and freshness/trust
   * rules apply consistently across the run. The returned payload
   * carries all six structured artefacts, the aggregated
   * `sourcing_report`, and audit metadata (generated_at, format_id,
   * question, provider_name).
   *
   * Throws:
   *   - `OrchestrationError` if the format does not require every
   *     agent from `scoping` through `synthesis` in its sections'
   *     `required_agents`.
   *   - Any typed subclass of `SourcingValidationError` under strict
   *     policy when a source fails validation.
   *   - Any typed agent error (`RiskAnalysisError`,
   *     `OptionsGenerationError`, `SynthesisError`, etc.) from the
   *     underlying execution.
   */
  async brief(
    question: string,
    formatId: string,
    options: BriefOptions = {}
  ): Promise<BriefResult> {
    const format = this.prepareForScoping(question, formatId);
    for (const agent of ["research", "stakeholder", "risk", "options", "synthesis"] as const) {
      if (!formatRequiresAgent(format, agent)) {
        throw new OrchestrationError(
          `Format '${formatId}' does not list '${agent}' in any section's required_agents; the full brief pipeline requires it.`
        );
      }
    }

    const generated_at = (options.now ?? new Date()).toISOString();
    const providerName = options.providerName ?? this.llm.name;

    const rules = format.sourcing_rules;
    const accumulator: SourcingAccumulator =
      rules?.dedupe?.cross_agent === true
        ? new InMemorySourcingAccumulator(rules.dedupe)
        : new NoopSourcingAccumulator();
    const now = options.now ?? new Date();
    const validateOpts: Parameters<typeof validateSourcing>[2] = {
      accumulator,
      now,
    };
    if (rules !== undefined) validateOpts.rules = rules;

    const scoping = await this.doScoping(question, format, options);
    const research = await this.doResearch(scoping, format, options);
    const researchReport = validateSourcing(
      research,
      format.sourcing_policy,
      validateOpts
    );

    const stakeholders = await this.doMapStakeholders(
      scoping,
      research,
      format,
      options
    );
    const stakeholderReport = validateStakeholderSourcing(
      stakeholders,
      format.sourcing_policy,
      validateOpts
    );

    const risks = await this.doAssessRisks(
      scoping,
      research,
      stakeholders,
      format,
      options
    );
    const riskReport = validateRiskSourcing(
      risks,
      format.sourcing_policy,
      validateOpts
    );

    const optionsResult = await this.doGenerateOptions(
      scoping,
      research,
      stakeholders,
      risks,
      format,
      options
    );

    const synthesis = await this.doSynthesize(
      scoping,
      research,
      stakeholders,
      risks,
      optionsResult,
      format,
      options
    );

    const sourcing_report = mergeReports(format.sourcing_policy, [
      researchReport,
      stakeholderReport,
      riskReport,
    ]);

    return {
      scoping,
      research,
      stakeholders,
      risks,
      options: optionsResult,
      synthesis,
      sourcing_report,
      generated_at,
      format_id: formatId,
      question,
      provider_name: providerName,
    };
  }

  private prepareForScoping(question: string, formatId: string): Format {
    if (question.trim().length === 0) {
      throw new OrchestrationError("Question is empty. Provide a non-blank briefing question.");
    }
    const format = this.registry.get(formatId);
    if (!formatRequiresAgent(format, "scoping")) {
      throw new OrchestrationError(
        `Format '${formatId}' does not list 'scoping' in any section's required_agents; nothing to do.`
      );
    }
    return format;
  }

  private doScoping(
    question: string,
    format: Format,
    options: ScopeOptions
  ): Promise<ScopingResult> {
    const ctx = {
      question,
      formatId: format.id,
      targetWords: format.target_length.words,
    };
    return options.scopingPromptPath === undefined
      ? executeScoping(ctx, this.llm)
      : executeScoping(ctx, this.llm, { promptPath: options.scopingPromptPath });
  }

  private doResearch(
    scoping: ScopingResult,
    format: Format,
    options: ResearchAfterScopingOptions
  ): Promise<ResearchResult> {
    const ctx = {
      scoping,
      formatId: format.id,
      sourcingPolicy: format.sourcing_policy,
      targetWords: format.target_length.words,
    };
    const execOpts: Parameters<typeof executeResearch>[2] = {};
    if (options.researchPromptPath !== undefined) {
      execOpts.promptPath = options.researchPromptPath;
    }
    if (options.researchMaxToolRounds !== undefined) {
      execOpts.maxToolRounds = options.researchMaxToolRounds;
    }
    return executeResearch(ctx, this.llm, execOpts);
  }

  private doMapStakeholders(
    scoping: ScopingResult,
    research: ResearchResult,
    format: Format,
    options: MapStakeholdersAfterResearchOptions
  ): Promise<StakeholderMapResult> {
    const ctx = { scoping, research, format };
    const execOpts: Parameters<typeof executeStakeholderMapping>[2] = {};
    if (options.stakeholderPromptPath !== undefined) {
      execOpts.promptPath = options.stakeholderPromptPath;
    }
    if (options.stakeholderMaxToolRounds !== undefined) {
      execOpts.maxToolRounds = options.stakeholderMaxToolRounds;
    }
    return executeStakeholderMapping(ctx, this.llm, execOpts);
  }

  private doAssessRisks(
    scoping: ScopingResult,
    research: ResearchResult,
    stakeholders: StakeholderMapResult,
    format: Format,
    options: AssessRisksAfterStakeholdersOptions
  ): Promise<RiskAnalysisResult> {
    const ctx = { scoping, research, stakeholders, format };
    const execOpts: Parameters<typeof executeRiskAnalysis>[2] = {};
    if (options.riskPromptPath !== undefined) {
      execOpts.promptPath = options.riskPromptPath;
    }
    if (options.riskMaxToolRounds !== undefined) {
      execOpts.maxToolRounds = options.riskMaxToolRounds;
    }
    return executeRiskAnalysis(ctx, this.llm, execOpts);
  }

  private doGenerateOptions(
    scoping: ScopingResult,
    research: ResearchResult,
    stakeholders: StakeholderMapResult,
    risks: RiskAnalysisResult,
    format: Format,
    options: BriefOptions
  ): Promise<OptionsGenerationResult> {
    const ctx = { scoping, research, stakeholders, risks, format };
    const execOpts: Parameters<typeof executeOptionsGeneration>[2] = {};
    if (options.optionsPromptPath !== undefined) {
      execOpts.promptPath = options.optionsPromptPath;
    }
    if (options.optionsMaxToolRounds !== undefined) {
      execOpts.maxToolRounds = options.optionsMaxToolRounds;
    }
    return executeOptionsGeneration(ctx, this.llm, execOpts);
  }

  private doSynthesize(
    scoping: ScopingResult,
    research: ResearchResult,
    stakeholders: StakeholderMapResult,
    risks: RiskAnalysisResult,
    optionsResult: OptionsGenerationResult,
    format: Format,
    options: BriefOptions
  ): Promise<SynthesisResult> {
    const ctx = {
      scoping,
      research,
      stakeholders,
      risks,
      options: optionsResult,
      format,
    };
    const execOpts: Parameters<typeof executeSynthesis>[2] = {};
    if (options.synthesisPromptPath !== undefined) {
      execOpts.promptPath = options.synthesisPromptPath;
    }
    return executeSynthesis(ctx, this.llm, execOpts);
  }
}

function formatRequiresAgent(format: Format, agentId: string): boolean {
  return format.sections.some((s) =>
    (s.required_agents as readonly string[]).includes(agentId)
  );
}
