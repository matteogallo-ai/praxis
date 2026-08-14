/**
 * `Orchestrator` — the v0.2 pipeline coordinator.
 *
 * v0.2 scope is deliberately narrow: only `scope()` is implemented.
 * `brief()` is stubbed to throw `NotImplementedError` so the CLI can
 * render a helpful "coming in v0.6+" message rather than a silent
 * success. Later releases will add per-section agent dispatch,
 * synthesis, editorial, and formatting.
 */

import type { FormatRegistry } from "../registry/registry.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { ScopingResult } from "../agents/types.ts";
import { executeScoping } from "../agents/scoping.ts";
import { NotImplementedError, OrchestrationError } from "./errors.ts";

export interface ScopeOptions {
  /** Overrides the scoping prompt file path — used in tests. */
  scopingPromptPath?: string;
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
    if (question.trim().length === 0) {
      throw new OrchestrationError("Question is empty. Provide a non-blank briefing question.");
    }
    const format = this.registry.get(formatId);

    const requiresScoping = format.sections.some((s) =>
      s.required_agents.includes("scoping")
    );
    if (!requiresScoping) {
      throw new OrchestrationError(
        `Format '${formatId}' does not list 'scoping' in any section's required_agents; nothing to do.`
      );
    }

    const ctx = {
      question,
      formatId,
      targetWords: format.target_length.words,
    };
    return options.scopingPromptPath === undefined
      ? executeScoping(ctx, this.llm)
      : executeScoping(ctx, this.llm, { promptPath: options.scopingPromptPath });
  }

  /**
   * Runs the full briefing pipeline. Not implemented in v0.2 — the
   * remaining agents (research, counter, synthesis, editorial, style,
   * formatter) land progressively from v0.3 to v0.6.
   */
  async brief(_question: string, _formatId: string): Promise<never> {
    throw new NotImplementedError(
      "Orchestrator.brief() — full briefing generation",
      "v0.6+"
    );
  }
}
