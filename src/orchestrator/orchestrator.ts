/**
 * `Orchestrator` — the Praxis pipeline coordinator.
 *
 * Partial runs: `scope()`, `researchAfterScoping()`,
 * `mapStakeholdersAfterResearch()`, `assessRisksAfterStakeholders()`.
 *
 * `brief()` is the full six-agent pipeline that produces a complete, formatted briefing (Scoping → Research
 * → Stakeholders → Risks → Options → Synthesis) with the aggregated
 * cross-agent sourcing report attached.
 */

import type { FormatRegistry } from "../registry/registry.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type {
  AdversarialCritiqueResult,
  OptionsGenerationResult,
  ResearchResult,
  RevisionContext,
  RiskAnalysisResult,
  ScopingResult,
  StakeholderMapResult,
  SynthesisResult,
} from "../agents/types.ts";
import type { Format } from "../registry/schema.ts";
import type {
  DomainTrustRule,
  SourcingReport,
  SourcingWarning,
} from "../sourcing/types.ts";
import { isSourceMissing } from "../sourcing/types.ts";
import { executeScoping, parseScopingResult } from "../agents/scoping.ts";
import { executeResearch, parseResearchResult } from "../agents/research.ts";
import { executeStakeholderMapping, parseStakeholderMapResult } from "../agents/stakeholder.ts";
import { executeRiskAnalysis, parseRiskAnalysisResult } from "../agents/risk.ts";
import { executeOptionsGeneration, parseOptionsGenerationResult } from "../agents/options.ts";
import { executeSynthesis, parseStoredSynthesis } from "../agents/synthesis.ts";
import { executeAdversarialCritique, parseAdversarialCritiqueResult } from "../agents/adversarial.ts";
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
import { optionsCitationReport, untrustedCitations } from "../sourcing/citations.ts";
import { buildRequesterProvidedSection } from "../sourcing/requester.ts";
import { SourcingValidationError } from "../sourcing/errors.ts";
import {
  buildInsufficientlySourcedSection,
  type SourcedArtefacts,
} from "../sourcing/insufficient.ts";
import { BudgetExceededError } from "../llm/errors.ts";
import { OrchestrationError } from "./errors.ts";
import { meter } from "./ledger.ts";
import { withRetry } from "../agents/retry.ts";
import { buildRerunReason, computeReSynthesisDeviations } from "./rerun.ts";
import type {
  AssessRisksAfterStakeholdersOptions,
  AssessRisksAfterStakeholdersResult,
  BriefOptions,
  BriefResult,
  BriefWithCritiqueAndRerunResult,
  BriefWithCritiqueOptions,
  BriefWithCritiqueResult,
  MapStakeholdersAfterResearchOptions,
  MapStakeholdersAfterResearchResult,
  ResearchAfterScopingOptions,
  ResearchAfterScopingResult,
  ScopeOptions,
} from "./types.ts";

// Importers of this module keep their paths: the types and the rerun heuristic are re-exported.
export type * from "./types.ts";
export { computeReSynthesisDeviations, isSubstantiallyChanged } from "./rerun.ts";

const NOTHING_TO_DO = {
  research: "nothing to research",
  stakeholder: "nothing to map",
  risk: "nothing to assess",
  options: "nothing to weigh",
  synthesis: "nothing to write",
} as const;

/** Stage outputs of one pipeline run, filled in as stages complete. */
interface PipelineRun {
  scoping: ScopingResult;
  research?: ResearchResult;
  stakeholders?: StakeholderMapResult;
  risks?: RiskAnalysisResult;
  options?: OptionsGenerationResult;
  synthesis?: SynthesisResult;
  generatedAt: string;
  /** Merged report of every sourcing validation run so far. */
  sourcingReport: () => SourcingReport;
}

/** A stage output the pipeline has produced by the time it is read. */
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new OrchestrationError("internal: a stage output was read before the stage ran");
  }
  return value;
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
    return this.stage("scoping", options, () => this.doScoping(question, format, options), parseScopingResult);
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
    const run = await this.runPipeline(question, formatId, options, "research");
    return { scoping: run.scoping, research: required(run.research) };
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
    const run = await this.runPipeline(question, formatId, options, "stakeholder");
    return {
      scoping: run.scoping,
      research: required(run.research),
      stakeholders: required(run.stakeholders),
    };
  }

  /**
   * Runs Scoping → Research → Stakeholder Mapping → Risk Analysis and
   * enforces the format's sourcing policy AND the hardened sourcing
   * rules (freshness, domain trust, cross-agent dedupe) end to end.
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
    const run = await this.runPipeline(question, formatId, options, "risk");
    return {
      scoping: run.scoping,
      research: required(run.research),
      stakeholders: required(run.stakeholders),
      risks: required(run.risks),
      sourcing_report: run.sourcingReport(),
    };
  }

  /**
   * Runs the full briefing pipeline end to end:
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
    const run = await this.runPipeline(question, formatId, options, "synthesis");
    return {
      scoping: run.scoping,
      research: required(run.research),
      stakeholders: required(run.stakeholders),
      risks: required(run.risks),
      options: required(run.options),
      synthesis: required(run.synthesis),
      sourcing_report: run.sourcingReport(),
      generated_at: run.generatedAt,
      format_id: formatId,
      question,
      provider_name: options.providerName ?? this.llm.name,
    };
  }

  /**
   * The one implementation behind the four staged entry points: runs the
   * stages in order up to and including `last`, validating sourcing after
   * each sourced stage. Up to `stakeholder` the format's `sourcing_rules`
   * are not applied, as those two entry points have always behaved.
   */
  private async runPipeline(
    question: string,
    formatId: string,
    options: BriefOptions,
    last: "research" | "stakeholder" | "risk" | "synthesis"
  ): Promise<PipelineRun> {
    const format = this.prepareForScoping(question, formatId);
    const order = ["research", "stakeholder", "risk", "options", "synthesis"] as const;
    const needed = order.slice(0, order.indexOf(last) + 1);
    for (const agent of needed) {
      if (!formatRequiresAgent(format, agent)) {
        throw new OrchestrationError(
          last === "synthesis"
            ? `Format '${formatId}' does not list '${agent}' in any section's required_agents; the full brief pipeline requires it.`
            : `Format '${formatId}' does not list '${agent}' in any section's required_agents; ${NOTHING_TO_DO[agent]}.`
        );
      }
    }

    const now = options.now ?? options.checkpoints?.startedAt ?? new Date();
    const hardened = last === "risk" || last === "synthesis";
    const validateOpts: Parameters<typeof validateSourcing>[2] = {};
    if (hardened) {
      const rules = format.sourcing_rules;
      validateOpts.accumulator =
        rules?.dedupe?.cross_agent === true
          ? new InMemorySourcingAccumulator(rules.dedupe)
          : new NoopSourcingAccumulator();
      validateOpts.now = now;
      if (rules !== undefined) validateOpts.rules = rules;
    }
    const policy = format.sourcing_policy;
    const reports: SourcingReport[] = [];
    let degraded = false;
    const check = (validate: () => SourcingReport): void => {
      try {
        reports.push(validate());
      } catch (err) {
        if (options.onSourcingFailure !== "degrade" || !(err instanceof SourcingValidationError)) {
          throw err;
        }
        reports.push(err.report);
        degraded = true;
      }
    };
    const scoping = await this.stage(
      "scoping",
      options,
      () => this.doScoping(question, format, options),
      parseScopingResult
    );
    if (scoping.requester_provided !== undefined) {
      reports.push({ ...buildReport(policy, 0, []), requester_provided: scoping.requester_provided.length });
    }
    const run: PipelineRun = {
      scoping,
      generatedAt: now.toISOString(),
      sourcingReport: () => {
        const merged = mergeReports(policy, reports);
        if (degraded) merged.insufficiently_sourced = true;
        return merged;
      },
    };

    run.research = await this.stage(
      "research",
      options,
      () => this.doResearch(scoping, format, options),
      parseResearchResult
    );
    const research = run.research;
    check(() => validateSourcing(research, policy, validateOpts));
    if (degraded && research.findings.every((f) => isSourceMissing(f.source))) {
      throw new SourcingValidationError(
        run.sourcingReport(),
        "Sourcing validation failed under 'strict' policy: no research finding has a source, so there is nothing to base the briefing on."
      );
    }
    if (last === "research") return run;

    run.stakeholders = await this.stage(
      "stakeholder",
      options,
      () => this.doMapStakeholders(scoping, research, format, options),
      parseStakeholderMapResult
    );
    const stakeholders = run.stakeholders;
    check(() => validateStakeholderSourcing(stakeholders, policy, validateOpts));
    if (last === "stakeholder") return run;

    run.risks = await this.stage(
      "risk",
      options,
      () => this.doAssessRisks(scoping, research, stakeholders, format, options),
      (stored) => parseRiskAnalysisResult(stored, stakeholders)
    );
    const risks = run.risks;
    check(() => validateRiskSourcing(risks, policy, validateOpts));
    if (last === "risk") return run;

    const optionsResult = await this.stage(
      "options",
      options,
      () => this.doGenerateOptions(scoping, research, stakeholders, risks, format, options),
      (stored) => parseOptionsGenerationResult(stored, stakeholders, risks)
    );
    run.options = optionsResult;
    const trust = format.sourcing_rules?.domain_trust;
    if (trust !== undefined) {
      check(() => optionsCitationReport(optionsResult.options, policy, trust));
    }
    // Synthesis retries per section (see doSynthesize), not as a whole.
    run.synthesis = await this.stage(
      "synthesis",
      options,
      () => this.doSynthesize(scoping, research, stakeholders, risks, optionsResult, format, options),
      (stored) =>
        parseStoredSynthesis(stored, format, { scoping, research, stakeholders, risks, options: optionsResult }),
      1
    );
    run.synthesis = withCodeWrittenSections(run.synthesis, run.sourcingReport(), run);
    return run;
  }

  /**
   * Runs the six-agent `brief()` pipeline, then feeds the
   * complete `BriefResult` to the Adversarial Critique agent
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
   * `brief()` does not run the critique.
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

    const adversarial = await this.stage(
      "adversarial",
      options,
      () => this.doAdversarial(brief, format, options),
      (stored) => parseAdversarialCritiqueResult(stored, adversarialContext(brief, format))
    );

    const sourcing_report = withCritiqueSources(
      brief.sourcing_report,
      adversarial,
      format.sourcing_rules?.domain_trust
    );

    return { ...brief, adversarial, sourcing_report };
  }

  /**
   * Runs `briefWithCritique()`. If the critique output signals
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

    let rerunSynthesis: SynthesisResult;
    try {
      rerunSynthesis = await this.stage("synthesis-rerun", options, () =>
      this.doSynthesize(
        initial.scoping,
        initial.research,
        initial.stakeholders,
        initial.risks,
        initial.options,
        format,
        options,
        revisionContext
      ),
      (stored) => parseStoredSynthesis(stored, format, initial),
      1
    );
    } catch (err) {
      // The rerun is an improvement on a complete, paid brief. A budget stop
      // there keeps that brief instead of discarding it with the run.
      if (!(err instanceof BudgetExceededError)) throw err;
      return {
        ...initial,
        rerun_performed: false,
        rerun_reason: null,
        original_synthesis: null,
        rerun_metadata: null,
        rerun_skipped: `budget: ${err.message}`,
      };
    }

    const rerunWithSection = withCodeWrittenSections(rerunSynthesis, initial.sourcing_report, initial);

    const deviations = computeReSynthesisDeviations(
      initial.synthesis,
      rerunWithSection
    );

    const rerunReason = buildRerunReason(
      initial.adversarial,
      critiquesToAddress
    );

    return {
      ...initial,
      synthesis: rerunWithSection,
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

  /**
   * Runs one stage: reuses its checkpoint when there is one, after `validate`
   * (the stage's own output validator) accepts it; otherwise runs it with
   * bounded retry, records its wall time, and checkpoints the output.
   */
  private async stage<T>(
    name: string,
    options: ScopeOptions,
    run: () => Promise<T>,
    validate: (stored: string) => T,
    attempts = options.stageAttempts ?? 2
  ): Promise<T> {
    const saved = options.checkpoints?.load(name, validate);
    if (saved !== undefined) return saved;
    const started = Date.now();
    const value = await withRetry(run, attempts);
    options.ledger?.recordDuration(name, Date.now() - started);
    options.checkpoints?.save(name, value);
    return value;
  }

  /** The provider for one stage: metered under that stage when a ledger is set. */
  private llmFor(stage: string, options: ScopeOptions): LLMProvider {
    return options.ledger === undefined ? this.llm : meter(this.llm, options.ledger, stage);
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
      ? executeScoping(ctx, this.llmFor("scoping", options))
      : executeScoping(ctx, this.llmFor("scoping", options), { promptPath: options.scopingPromptPath });
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
      ...(format.sourcing_rules === undefined ? {} : { sourcingRules: format.sourcing_rules }),
    };
    const execOpts: Parameters<typeof executeResearch>[2] = {};
    if (options.researchPromptPath !== undefined) {
      execOpts.promptPath = options.researchPromptPath;
    }
    if (options.researchMaxToolRounds !== undefined) {
      execOpts.maxToolRounds = options.researchMaxToolRounds;
    }
    return executeResearch(ctx, this.llmFor("research", options), execOpts);
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
    return executeStakeholderMapping(ctx, this.llmFor("stakeholder", options), execOpts);
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
    return executeRiskAnalysis(ctx, this.llmFor("risk", options), execOpts);
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
    return executeOptionsGeneration(ctx, this.llmFor("options", options), execOpts);
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
    const execOpts: Parameters<typeof executeSynthesis>[2] = {
      attempts: options.stageAttempts ?? 2,
    };
    if (options.synthesisPromptPath !== undefined) {
      execOpts.promptPath = options.synthesisPromptPath;
    }
    return executeSynthesis(ctx, this.llmFor(revisionContext === undefined ? "synthesis" : "synthesis-rerun", options), execOpts);
  }

  private doAdversarial(
    brief: BriefResult,
    format: Format,
    options: BriefWithCritiqueOptions
  ): Promise<AdversarialCritiqueResult> {
    const ctx = adversarialContext(brief, format);
    const execOpts: Parameters<typeof executeAdversarialCritique>[2] = {};
    if (options.adversarialPromptPath !== undefined) {
      execOpts.promptPath = options.adversarialPromptPath;
    }
    if (options.adversarialMaxToolRounds !== undefined) {
      execOpts.maxToolRounds = options.adversarialMaxToolRounds;
    }
    return executeAdversarialCritique(ctx, this.llmFor("adversarial", options), execOpts);
  }
}

/** What the adversarial agent, and its checkpoint validator, read. */
function adversarialContext(brief: BriefResult, format: Format) {
  return {
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
}

/**
 * Appends the sections code writes after the model's: the requester-provided
 * facts, then the "Insufficiently sourced" items. Both the first synthesis
 * and the critique's rerun go through here, so neither can drop them.
 */
function withCodeWrittenSections(
  synthesis: SynthesisResult,
  report: SourcingReport,
  artefacts: SourcedArtefacts & { scoping: ScopingResult }
): SynthesisResult {
  const facts = artefacts.scoping.requester_provided ?? [];
  const sections = [...synthesis.sections];
  if (facts.length > 0) sections.push(buildRequesterProvidedSection(facts));
  if (report.insufficiently_sourced === true) sections.push(buildInsufficientlySourcedSection(report, artefacts));
  return { ...synthesis, sections };
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
  adversarial: AdversarialCritiqueResult,
  trust: DomainTrustRule | undefined
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
  const critiqueReport: SourcingReport = buildReport(
    baseReport.policy,
    adversarial.critiques.length,
    additionalWarnings
  );
  // Reported, never blocking: like a missing counter-evidence, a weak one
  // weakens the critique, not the briefing it criticises. Never first-party:
  // a steelmanned position is an argument (ADR 0003, amendment of 4 Nov 2026).
  if (trust !== undefined) {
    critiqueReport.untrusted_citations = untrustedCitations(
      "adversarial",
      adversarial.critiques.map((c) => ({ id: c.id, evidence: c.counter_evidence })),
      trust
    );
  }
  return mergeReports(baseReport.policy, [baseReport, critiqueReport]);
}

function formatRequiresAgent(format: Format, agentId: string): boolean {
  return format.sections.some((s) =>
    (s.required_agents as readonly string[]).includes(agentId)
  );
}
