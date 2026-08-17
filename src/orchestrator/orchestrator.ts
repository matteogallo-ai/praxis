/**
 * `Orchestrator` — the Praxis pipeline coordinator.
 *
 * v0.2 shipped `scope()`. v0.3 adds `researchAfterScoping()`: chains
 * the Scoping and Research agents in a single call, then enforces the
 * format's sourcing policy on the research output.
 *
 * `brief()` remains stubbed as `NotImplementedError` — the full
 * agent pipeline (synthesis, editorial, formatter) still lands from
 * v0.6 onward.
 */

import type { FormatRegistry } from "../registry/registry.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { ScopingResult, ResearchResult } from "../agents/types.ts";
import type { Format } from "../registry/schema.ts";
import { executeScoping } from "../agents/scoping.ts";
import { executeResearch } from "../agents/research.ts";
import { validateSourcing } from "../sourcing/validator.ts";
import { NotImplementedError, OrchestrationError } from "./errors.ts";

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

export interface ResearchAfterScopingResult {
  scoping: ScopingResult;
  research: ResearchResult;
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
   * policy. Returns both structured outputs.
   *
   * Throws:
   *   - `OrchestrationError` if the format does not require both
   *     `scoping` and `research` in any of its sections.
   *   - `SourcingValidationError` (from the sourcing layer) when
   *     `sourcing_policy === "strict"` and one or more findings are
   *     marked `SOURCE_MISSING`.
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
   * Runs the full briefing pipeline. Not implemented in v0.3 — the
   * remaining agents (synthesis, editorial, style, formatter) land
   * progressively from v0.6.
   */
  async brief(_question: string, _formatId: string): Promise<never> {
    throw new NotImplementedError(
      "Orchestrator.brief() — full briefing generation",
      "v0.6+"
    );
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
}

function formatRequiresAgent(format: Format, agentId: string): boolean {
  return format.sections.some((s) =>
    (s.required_agents as readonly string[]).includes(agentId)
  );
}
