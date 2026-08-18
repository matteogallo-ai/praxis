/**
 * `praxis brief "<question>" --format <id> [flags]` — CLI entry point.
 *
 * v0.5 modes:
 *   default              Scoping only.
 *   --with-research      Scoping → Research.
 *   --with-stakeholders  Scoping → Research → Stakeholder Mapping.
 *                        Implies --with-research; a note is emitted
 *                        to stdout if used alone.
 *   --with-risks         Scoping → Research → Stakeholders → Risks.
 *                        Implies --with-stakeholders (and therefore
 *                        --with-research); notes emitted to stdout if
 *                        used alone.
 *   --sourcing-report    Prints ONLY the aggregated cross-agent
 *                        sourcing report (useful for audit). Implies
 *                        --with-risks (the full pipeline is what
 *                        produces the report).
 *
 * Providers:
 *   --provider mock       (default) reads pre-scripted fixtures under
 *                         `tests/fixtures/mock-llm/`.
 *   --provider anthropic  live provider. Requires `ANTHROPIC_API_KEY`
 *                         in the environment. Enables tool-using
 *                         agents against the real web_search tool.
 *
 * Full-briefing generation still throws `NotImplementedError` at the
 * Orchestrator; that pipeline lands in v0.6+.
 */

import { FormatRegistry } from "../../registry/registry.ts";
import { Orchestrator } from "../../orchestrator/orchestrator.ts";
import { MockLLMProvider } from "../../llm/mock-provider.ts";
import { AnthropicLLMProvider } from "../../llm/anthropic-provider.ts";
import {
  ProviderNotSupportedError,
  AnthropicAuthenticationError,
} from "../../llm/errors.ts";
import { PraxisError } from "../../registry/errors.ts";
import {
  c,
  renderScopingResult,
  renderResearchResult,
  renderStakeholders,
  renderRisks,
  renderSourcingReport,
} from "../output.ts";
import type { LLMProvider } from "../../llm/provider.ts";
import type {
  ScopingResult,
  ResearchResult,
  StakeholderMapResult,
  RiskAnalysisResult,
} from "../../agents/types.ts";
import type { SourcingReport } from "../../sourcing/types.ts";

export interface BriefCommandOptions {
  question: string;
  formatId: string;
  provider: string;
  json: boolean;
  withResearch: boolean;
  withStakeholders: boolean;
  withRisks: boolean;
  sourcingReport: boolean;
  formatsDir: string;
  fixturesDir: string;
}

export interface ParsedBriefArgs {
  question: string;
  formatId: string;
  provider: string;
  json: boolean;
  withResearch: boolean;
  withStakeholders: boolean;
  withRisks: boolean;
  sourcingReport: boolean;
  error?: string;
}

/**
 * Parses the `brief` argument tail: exactly one positional (the
 * question) plus `--format`, optional `--provider`, `--json`,
 * `--with-research`, `--with-stakeholders`.
 */
export function parseBriefArgs(args: readonly string[]): ParsedBriefArgs {
  const positional: string[] = [];
  let formatId: string | null = null;
  let provider = "mock";
  let json = false;
  let withResearch = false;
  let withStakeholders = false;
  let withRisks = false;
  let sourcingReport = false;

  const errorReturn = (error: string): ParsedBriefArgs => ({
    question: "",
    formatId: "",
    provider,
    json,
    withResearch,
    withStakeholders,
    withRisks,
    sourcingReport,
    error,
  });

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--format") {
      const next = args[i + 1];
      if (next === undefined) {
        return errorReturn(
          "--format expects an id (e.g. --format executive-pre-read)"
        );
      }
      formatId = next;
      i++;
    } else if (a.startsWith("--format=")) {
      formatId = a.slice("--format=".length);
    } else if (a === "--provider") {
      const next = args[i + 1];
      if (next === undefined) {
        return errorReturn("--provider expects a name (e.g. --provider mock)");
      }
      provider = next;
      i++;
    } else if (a.startsWith("--provider=")) {
      provider = a.slice("--provider=".length);
    } else if (a === "--json") {
      json = true;
    } else if (a === "--with-research") {
      withResearch = true;
    } else if (a === "--with-stakeholders") {
      withStakeholders = true;
    } else if (a === "--with-risks") {
      withRisks = true;
    } else if (a === "--sourcing-report") {
      sourcingReport = true;
    } else {
      positional.push(a);
    }
  }

  if (positional.length === 0) {
    return errorReturn(
      "missing question. Usage: praxis brief \"<question>\" --format <id>"
    );
  }
  if (positional.length > 1) {
    return errorReturn(
      "expected exactly one question. Wrap multi-word questions in quotes."
    );
  }
  if (formatId === null) {
    return {
      question: positional[0]!,
      formatId: "",
      provider,
      json,
      withResearch,
      withStakeholders,
      withRisks,
      sourcingReport,
      error: "--format is required. Usage: praxis brief \"<question>\" --format <id>",
    };
  }

  return {
    question: positional[0]!,
    formatId,
    provider,
    json,
    withResearch,
    withStakeholders,
    withRisks,
    sourcingReport,
  };
}

export async function briefCommand(opts: BriefCommandOptions): Promise<number> {
  const llm = selectProvider(opts.provider, opts.fixturesDir);
  const registry = new FormatRegistry();
  registry.loadDirectory(opts.formatsDir);
  const orchestrator = new Orchestrator(registry, llm);

  // --sourcing-report implies --with-risks (the full pipeline is what
  // produces the aggregated report).
  const wantsRisks = opts.withRisks || opts.sourcingReport;

  if (wantsRisks) {
    if (!opts.withStakeholders && !opts.json) {
      process.stdout.write(
        `${c.dim("note:")} --with-risks implies --with-stakeholders (and --with-research); running the full pipeline.\n`
      );
    }
    const result = await orchestrator.assessRisksAfterStakeholders(
      opts.question,
      opts.formatId
    );
    if (opts.sourcingReport && !opts.withRisks && !opts.json) {
      process.stdout.write(
        `${c.dim("note:")} --sourcing-report implies --with-risks; running the full pipeline.\n`
      );
    }
    if (opts.sourcingReport && !opts.withRisks) {
      printSourcingReportOnly(result.sourcing_report, opts.json);
    } else {
      printFullPipelineWithRisks(
        result.scoping,
        result.research,
        result.stakeholders,
        result.risks,
        result.sourcing_report,
        opts.json
      );
    }
    return 0;
  }

  if (opts.withStakeholders) {
    // --with-stakeholders implies --with-research. When used alone, emit
    // a stdout note so users understand what's about to happen.
    if (!opts.withResearch && !opts.json) {
      process.stdout.write(
        `${c.dim("note:")} --with-stakeholders implies --with-research; running the full pipeline.\n`
      );
    }
    const result = await orchestrator.mapStakeholdersAfterResearch(
      opts.question,
      opts.formatId
    );
    printFullPipeline(result.scoping, result.research, result.stakeholders, opts.json);
    return 0;
  }

  if (opts.withResearch) {
    const result = await orchestrator.researchAfterScoping(
      opts.question,
      opts.formatId
    );
    printScopingPlusResearch(result.scoping, result.research, opts.json);
    return 0;
  }

  const scoping = await orchestrator.scope(opts.question, opts.formatId);
  printScopingOnly(scoping, opts.json);
  return 0;
}

function selectProvider(name: string, fixturesDir: string): LLMProvider {
  if (name === "mock") {
    return new MockLLMProvider({ fixturesDir });
  }
  if (name === "anthropic") {
    return new AnthropicLLMProvider();
  }
  throw new ProviderNotSupportedError(name);
}

function printScopingOnly(result: ScopingResult, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderScopingResult(result));
  process.stdout.write(
    `\n${c.dim("Next: full briefing generation coming in v0.6+.")}\n`
  );
}

function printScopingPlusResearch(
  scoping: ScopingResult,
  research: ResearchResult,
  json: boolean
): void {
  if (json) {
    process.stdout.write(JSON.stringify({ scoping, research }, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderScopingResult(scoping));
  process.stdout.write(renderResearchResult(research));
  process.stdout.write(
    `\n${c.dim("Next: stakeholder mapping (--with-stakeholders), synthesis, editorial land from v0.4+.")}\n`
  );
}

function printFullPipeline(
  scoping: ScopingResult,
  research: ResearchResult,
  stakeholders: StakeholderMapResult,
  json: boolean
): void {
  if (json) {
    process.stdout.write(
      JSON.stringify({ scoping, research, stakeholders }, null, 2) + "\n"
    );
    return;
  }
  process.stdout.write(renderScopingResult(scoping));
  process.stdout.write(renderResearchResult(research));
  process.stdout.write(renderStakeholders(stakeholders));
  process.stdout.write(
    `\n${c.dim("Next: risk analysis (--with-risks), synthesis, editorial land from v0.5+.")}\n`
  );
}

function printFullPipelineWithRisks(
  scoping: ScopingResult,
  research: ResearchResult,
  stakeholders: StakeholderMapResult,
  risks: RiskAnalysisResult,
  sourcing_report: SourcingReport,
  json: boolean
): void {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        { scoping, research, stakeholders, risks, sourcing_report },
        null,
        2
      ) + "\n"
    );
    return;
  }
  process.stdout.write(renderScopingResult(scoping));
  process.stdout.write(renderResearchResult(research));
  process.stdout.write(renderStakeholders(stakeholders));
  process.stdout.write(renderRisks(risks));
  process.stdout.write(renderSourcingReport(sourcing_report));
  process.stdout.write(
    `\n${c.dim("Next: options generation lands in v0.6; synthesis and editorial follow.")}\n`
  );
}

function printSourcingReportOnly(report: SourcingReport, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderSourcingReport(report));
}

/**
 * CLI-level dispatch wrapper that funnels PraxisErrors through a single
 * red-marker exit-code-1 path. Kept out of `briefCommand` itself so
 * that programmatic callers (tests, embedded runtimes) can catch the
 * typed error rather than always exit 1.
 */
export async function runBriefCli(
  args: readonly string[],
  ctx: { formatsDir: string; fixturesDir: string }
): Promise<number> {
  const parsed = parseBriefArgs(args);
  if (parsed.error !== undefined) {
    process.stderr.write(`${c.red("✗")} ${parsed.error}\n`);
    return 1;
  }
  try {
    return await briefCommand({
      question: parsed.question,
      formatId: parsed.formatId,
      provider: parsed.provider,
      json: parsed.json,
      withResearch: parsed.withResearch,
      withStakeholders: parsed.withStakeholders,
      withRisks: parsed.withRisks,
      sourcingReport: parsed.sourcingReport,
      formatsDir: ctx.formatsDir,
      fixturesDir: ctx.fixturesDir,
    });
  } catch (err) {
    if (err instanceof AnthropicAuthenticationError) {
      process.stderr.write(`${c.red("✗")} ${err.message}\n`);
      return 1;
    }
    if (err instanceof PraxisError) {
      process.stderr.write(`${c.red("✗")} ${err.message}\n`);
      return 1;
    }
    if (err instanceof Error) {
      process.stderr.write(`${c.red("✗")} ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}
