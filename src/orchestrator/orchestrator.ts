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
  AdversarialCritiqueResult,
  Critique,
  OptionsGenerationResult,
  ResearchResult,
  RevisionContext,
  RiskAnalysisResult,
  ScopingResult,
  StakeholderMapResult,
  SynthesisResult,
  SynthesizedSection,
} from "../agents/types.ts";
import type { Format } from "../registry/schema.ts";
import type {
  SourcingAccumulator,
  SourcingReport,
  SourcingWarning,
} from "../sourcing/types.ts";
import { isSourceMissing } from "../sourcing/types.ts";
import { executeScoping } from "../agents/scoping.ts";
import { executeResearch } from "../agents/research.ts";
import { executeStakeholderMapping } from "../agents/stakeholder.ts";
import { executeRiskAnalysis } from "../agents/risk.ts";
import { executeOptionsGeneration } from "../agents/options.ts";
import { executeSynthesis } from "../agents/synthesis.ts";
import { executeAdversarialCritique } from "../agents/adversarial.ts";
import {
  validateRiskSourcing,
  validateSourcing,
  validateStakeholderSourcing,
} from "../sourcing/validator.ts";
import {
  InMemorySourcingAccumulator,
  NoopSourcingAccumulator,
} from "../sourcing/dedupe.ts";
import { buildReport, mergeReports } from "../sourcing/report.ts";
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

/**
 * Options for `briefWithCritique()`. Superset of `BriefOptions`
 * plus the adversarial agent's own prompt-path and max-tool-rounds
 * overrides. Kept as its own interface so `brief()` consumers do not
 * accidentally trigger the critique step by supplying critique
 * options.
 */
export interface BriefWithCritiqueOptions extends BriefOptions {
  /** Overrides the default `prompts/adversarial.prompt` location — used in tests. */
  adversarialPromptPath?: string;
  /** Hard cap on tool-use rounds for the Adversarial Critique agent. */
  adversarialMaxToolRounds?: number;
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

/**
 * Superset of `BriefResult` returned by `Orchestrator.briefWithCritique()`.
 * Adds the adversarial critique output and re-aggregates the
 * sourcing report to include the critique's counter-evidence
 * sources. The `sourcing_report` field is REPLACED (not appended) so
 * consumers see one coherent report covering the whole run.
 */
export interface BriefWithCritiqueResult extends BriefResult {
  adversarial: AdversarialCritiqueResult;
}

/**
 * v0.8 payload returned by `Orchestrator.briefWithCritiqueAndRerun()`.
 * Superset of `BriefWithCritiqueResult` that records whether the
 * editorial re-run loop fired, which critiques triggered it, the
 * pre-rerun synthesis (audit trail), and which sections changed
 * substantially.
 *
 * When `rerun_performed === false`, `original_synthesis` is `null`,
 * `rerun_reason` is `null`, and `rerun_metadata` is `null`. When
 * `rerun_performed === true`, the current `synthesis` is the
 * post-rerun one and the `original_synthesis` is preserved.
 *
 * Hard cap: exactly ONE rerun. The method never re-iterates even
 * if the post-rerun brief would (hypothetically) trigger another.
 * See `docs/editorial-loop.md` for the safeguard rationale.
 */
export interface BriefWithCritiqueAndRerunResult extends BriefWithCritiqueResult {
  rerun_performed: boolean;
  /** Human-readable summary when `rerun_performed === true`; else null. */
  rerun_reason: string | null;
  /** Pre-rerun synthesis when the rerun fired; else null. */
  original_synthesis: SynthesisResult | null;
  rerun_metadata: RerunMetadata | null;
}

export interface RerunMetadata {
  /** critique.id values that triggered the rerun (critical + material). */
  critiques_addressed: string[];
  steelmanned_alternative_used: string | null;
  /**
   * section_id values whose content_markdown changed substantially
   * between the original and the post-rerun synthesis. "Substantial"
   * = word-count delta > 20% OR normalised Levenshtein distance
   * > 0.30.
   */
  re_synthesis_deviations: string[];
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

  /**
   * Runs the v0.6 six-agent `brief()` pipeline, then feeds the
   * complete `BriefResult` to the Adversarial Critique agent (v0.7)
   * for stress-testing. Returns the enriched payload.
   *
   * The pipeline is:
   *
   *   brief() [six agents] → executeAdversarialCritique() → merge sourcing
   *
   * The sourcing_report is REPLACED (not appended) so it now covers
   * the critique's counter_evidence sources as well as the six
   * upstream agents' sources.
   *
   * `brief()` itself is UNCHANGED — API-compatible with v0.6.
   * `briefWithCritique()` is the opt-in path.
   *
   * Throws:
   *   - Everything `brief()` throws.
   *   - Any typed adversarial error
   *     (`AdversarialCritiqueError`, `InvalidCritiqueTargetError`,
   *     `MissingAlternativeError`) from the critique step.
   */
  async briefWithCritique(
    question: string,
    formatId: string,
    options: BriefWithCritiqueOptions = {}
  ): Promise<BriefWithCritiqueResult> {
    const brief = await this.brief(question, formatId, options);
    const format = this.registry.get(formatId);

    const adversarial = await this.doAdversarial(brief, format, options);

    const sourcing_report = withCritiqueSources(
      brief.sourcing_report,
      adversarial
    );

    return { ...brief, adversarial, sourcing_report };
  }

  /**
   * v0.8 — Runs `briefWithCritique()`. If the critique output signals
   * `revised_recommendation_needed: true`, runs the Synthesis agent
   * ONE MORE TIME in REVISION MODE and returns the post-rerun brief;
   * otherwise returns the initial brief unchanged. Hard cap: exactly
   * one rerun per call, ever. There is no recursion — a critique that
   * would (hypothetically) fire on the post-rerun output is ignored;
   * downstream consumers can call this method again with the new
   * output if they want another pass, but the library never loops on
   * its own.
   *
   * When the rerun fires, the returned payload carries:
   *   - `rerun_performed: true`
   *   - `synthesis`             — the POST-rerun synthesis
   *   - `original_synthesis`    — the PRE-rerun synthesis (audit trail)
   *   - `rerun_metadata`        — critique IDs addressed, the
   *                               steelmanned alternative used, and
   *                               the list of sections whose text
   *                               changed substantially
   *   - `sourcing_report.edited_after_critique: true`
   *
   * When the rerun does NOT fire (no critique signal, or the signal
   * is present but no steelmanned alternative), the payload carries
   * `rerun_performed: false` with `original_synthesis` and
   * `rerun_metadata` set to `null`.
   *
   * Throws:
   *   - Everything `briefWithCritique()` throws.
   *   - Any typed synthesis error (`EditorialFailureError`, etc.)
   *     from the rerun step.
   */
  async briefWithCritiqueAndRerun(
    question: string,
    formatId: string,
    options: BriefWithCritiqueOptions = {}
  ): Promise<BriefWithCritiqueAndRerunResult> {
    const initial = await this.briefWithCritique(question, formatId, options);

    // No rerun needed — either no derived signal OR no landing pad
    // (steelmanned_alternative). The parser guarantees "signal true
    // → alternative non-null", but we defend against future drift.
    const needed = initial.adversarial.revised_recommendation_needed;
    const alt = initial.adversarial.steelmanned_alternative;
    if (!needed || alt === null) {
      return {
        ...initial,
        rerun_performed: false,
        rerun_reason: null,
        original_synthesis: null,
        rerun_metadata: null,
      };
    }

    const critiquesToAddress = initial.adversarial.critiques.filter(
      (c) => c.severity === "critical" || c.severity === "material"
    );

    const format = this.registry.get(formatId);
    const revisionContext: RevisionContext = {
      original_synthesis: initial.synthesis,
      adversarial: initial.adversarial,
      critiques_to_address: critiquesToAddress,
      steelmanned_alternative: alt,
      instruction:
        "revise sections and align recommendation with the steelmanned alternative",
    };

    const rerunSynthesis = await this.doSynthesize(
      initial.scoping,
      initial.research,
      initial.stakeholders,
      initial.risks,
      initial.options,
      format,
      options,
      revisionContext
    );

    const deviations = computeReSynthesisDeviations(
      initial.synthesis,
      rerunSynthesis
    );

    const rerunReason = buildRerunReason(
      initial.adversarial,
      critiquesToAddress
    );

    return {
      ...initial,
      synthesis: rerunSynthesis,
      sourcing_report: {
        ...initial.sourcing_report,
        edited_after_critique: true,
      },
      rerun_performed: true,
      rerun_reason: rerunReason,
      original_synthesis: initial.synthesis,
      rerun_metadata: {
        critiques_addressed: critiquesToAddress.map((c) => c.id),
        steelmanned_alternative_used: alt,
        re_synthesis_deviations: deviations,
      },
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
    options: BriefOptions,
    revisionContext?: RevisionContext
  ): Promise<SynthesisResult> {
    const ctx: Parameters<typeof executeSynthesis>[0] = {
      scoping,
      research,
      stakeholders,
      risks,
      options: optionsResult,
      format,
    };
    if (revisionContext !== undefined) {
      ctx.revision_context = revisionContext;
    }
    const execOpts: Parameters<typeof executeSynthesis>[2] = {};
    if (options.synthesisPromptPath !== undefined) {
      execOpts.promptPath = options.synthesisPromptPath;
    }
    return executeSynthesis(ctx, this.llm, execOpts);
  }

  private doAdversarial(
    brief: BriefResult,
    format: Format,
    options: BriefWithCritiqueOptions
  ): Promise<AdversarialCritiqueResult> {
    const ctx = {
      brief_result: {
        scoping: brief.scoping,
        research: brief.research,
        stakeholders: brief.stakeholders,
        risks: brief.risks,
        options: brief.options,
        synthesis: brief.synthesis,
        format_id: brief.format_id,
        question: brief.question,
      },
      format,
    };
    const execOpts: Parameters<typeof executeAdversarialCritique>[2] = {};
    if (options.adversarialPromptPath !== undefined) {
      execOpts.promptPath = options.adversarialPromptPath;
    }
    if (options.adversarialMaxToolRounds !== undefined) {
      execOpts.maxToolRounds = options.adversarialMaxToolRounds;
    }
    return executeAdversarialCritique(ctx, this.llm, execOpts);
  }
}

/**
 * Enrich the base `sourcing_report` with the critique's counter-
 * evidence sources so the caller sees ONE report covering the full
 * critique-augmented run.
 *
 * Each critique contributes ONE inspected item (the
 * `counter_evidence` slot). Missing counter-evidence surfaces as a
 * `missing_source` warning tagged to the corresponding critique
 * index — reusing the existing `missing_source` variant keeps the
 * report shape stable for consumers.
 */
function withCritiqueSources(
  baseReport: SourcingReport,
  adversarial: AdversarialCritiqueResult
): SourcingReport {
  const additionalWarnings: SourcingWarning[] = [];
  // A critique's counter_evidence lives in a "critique-N" slot; we
  // reuse the missing_source warning variant with finding_index set
  // to the critique index so the SourcingReport shape stays stable.
  for (const [i, c] of adversarial.critiques.entries()) {
    if (isSourceMissing(c.counter_evidence)) {
      additionalWarnings.push({
        kind: "missing_source",
        finding_index: baseReport.total_items + i,
        searched_for: `[${c.id}] ${c.counter_evidence.searched_for}`,
      });
    }
  }
  const critiqueReport = buildReport(
    baseReport.policy,
    adversarial.critiques.length,
    additionalWarnings
  );
  return mergeReports(baseReport.policy, [baseReport, critiqueReport]);
}

function formatRequiresAgent(format: Format, agentId: string): boolean {
  return format.sections.some((s) =>
    (s.required_agents as readonly string[]).includes(agentId)
  );
}

// ---------------------------------------------------------------------------
// v0.8 — rerun deviation heuristic + reason builder
// ---------------------------------------------------------------------------

/**
 * "Substantial change" between two versions of a section:
 *   - absolute word-count delta > 20% of the OLD count, OR
 *   - normalised Levenshtein distance > 0.30 on the content_markdown.
 *
 * Both signals capture ways the LLM might have re-written the section
 * — a paraphrase without changing word count still trips (2), while
 * a shortening without changing meaning trips (1). Sections missing
 * from either side are surfaced explicitly (new / removed IDs).
 */
export function computeReSynthesisDeviations(
  original: SynthesisResult,
  rerun: SynthesisResult
): string[] {
  const deviations: string[] = [];
  const origBySection = new Map<string, SynthesizedSection>(
    original.sections.map((s) => [s.section_id, s])
  );
  const rerunBySection = new Map<string, SynthesizedSection>(
    rerun.sections.map((s) => [s.section_id, s])
  );

  for (const [sid, rerunSec] of rerunBySection) {
    const origSec = origBySection.get(sid);
    if (origSec === undefined) {
      deviations.push(sid);
      continue;
    }
    if (isSubstantiallyChanged(origSec, rerunSec)) {
      deviations.push(sid);
    }
  }
  // Sections present in the original but removed on rerun — surface them too.
  for (const sid of origBySection.keys()) {
    if (!rerunBySection.has(sid)) deviations.push(sid);
  }
  return deviations;
}

function isSubstantiallyChanged(
  a: SynthesizedSection,
  b: SynthesizedSection
): boolean {
  const wordDelta =
    a.word_count === 0
      ? b.word_count > 0
        ? 1
      : 0
      : Math.abs(b.word_count - a.word_count) / a.word_count;
  if (wordDelta > 0.2) return true;
  const nlev = normalisedLevenshtein(a.content_markdown, b.content_markdown);
  return nlev > 0.3;
}

/** Iterative-DP Levenshtein, memory-bounded to O(min(m,n)). */
function normalisedLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return 1;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  const m = s.length;
  const n = t.length;
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = s.charCodeAt(i - 1) === t.charCodeAt(j - 1) ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1]! + 1,
        prev[i]! + 1,
        prev[i - 1]! + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m]! / Math.max(m, n);
}

function buildRerunReason(
  adv: AdversarialCritiqueResult,
  toAddress: readonly Critique[]
): string {
  const critical = adv.critical_count;
  const material = adv.material_count;
  const trigger =
    critical >= 1
      ? `${critical} critical critique(s)`
      : `${material} material critique(s)`;
  return `${trigger} triggered a Synthesis rerun in REVISION MODE addressing critique IDs: ${toAddress
    .map((c) => c.id)
    .join(", ")}.`;
}
