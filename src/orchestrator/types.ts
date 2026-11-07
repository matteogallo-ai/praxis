/**
 * The options and results of the `Orchestrator`'s entry points, part of the
 * library's public types (re-exported by `src/index.ts`).
 */
import type {
  AdversarialCritiqueResult,
  OptionsGenerationResult,
  ResearchResult,
  RiskAnalysisResult,
  ScopingResult,
  StakeholderMapResult,
  SynthesisResult,
} from "../agents/types.ts";
import type { SourcingReport } from "../sourcing/types.ts";
import type { CheckpointStore } from "./checkpoint.ts";
import type { UsageLedger } from "./ledger.ts";

export interface ScopeOptions {
  /** Overrides the scoping prompt file path — used in tests. */
  scopingPromptPath?: string;
  /**
   * Records every model call's tokens and cost under its stage, and
   * enforces the ledger's budget cap before each call.
   */
  ledger?: UsageLedger;
  /**
   * Saves each stage's output once accepted and, on a later call with the
   * same store, reuses it instead of running the stage again (`--resume`).
   */
  checkpoints?: CheckpointStore;
  /**
   * Attempts per stage on recoverable errors (see `src/agents/retry.ts`).
   * Default 2; `1` turns retry off (docs/SEMVER-CONTRACT.md).
   */
  stageAttempts?: number;
}

export interface ResearchAfterScopingOptions extends ScopeOptions {
  /**
   * What a strict sourcing failure does. `"abort"` (default) throws the
   * `SourcingValidationError`. `"degrade"` records it, carries on, flags the
   * report `insufficiently_sourced` and adds an "Insufficiently sourced"
   * section to the briefing; the run still aborts when no research finding
   * has a source at all, since nothing would support the analysis.
   * See docs/adr/0002-degrade-on-insufficient-sourcing.md.
   */
  onSourcingFailure?: "abort" | "degrade";
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
  /** Aggregated cross-agent sourcing report. */
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
 * Payload returned by `Orchestrator.briefWithCritiqueAndRerun()`.
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
  /**
   * Set when the adversarial review asked for a rerun that did not run
   * because the cost cap was reached: the brief returned is the pre-rerun
   * one, already paid for.
   */
  rerun_skipped?: string;
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
