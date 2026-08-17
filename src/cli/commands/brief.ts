/**
 * `praxis brief "<question>" --format <id> [flags]` — CLI entry point.
 *
 * v0.3 modes:
 *   default          — runs Scoping only and prints the JSON.
 *   --with-research  — runs Scoping then Research; prints both.
 *
 * Providers:
 *   --provider mock       (default) reads pre-scripted fixtures under
 *                         `tests/fixtures/mock-llm/`.
 *   --provider anthropic  live provider. Requires `ANTHROPIC_API_KEY`
 *                         in the environment. Enables `--with-research`
 *                         against the real web_search tool.
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
import { c, renderScopingResult, renderResearchResult } from "../output.ts";
import type { LLMProvider } from "../../llm/provider.ts";
import type { ScopingResult, ResearchResult } from "../../agents/types.ts";

export interface BriefCommandOptions {
  question: string;
  formatId: string;
  provider: string;
  json: boolean;
  withResearch: boolean;
  formatsDir: string;
  fixturesDir: string;
}

export interface ParsedBriefArgs {
  question: string;
  formatId: string;
  provider: string;
  json: boolean;
  withResearch: boolean;
  error?: string;
}

/**
 * Parses the `brief` argument tail: exactly one positional (the
 * question) plus `--format`, optional `--provider`, `--json`,
 * `--with-research`.
 */
export function parseBriefArgs(args: readonly string[]): ParsedBriefArgs {
  const positional: string[] = [];
  let formatId: string | null = null;
  let provider = "mock";
  let json = false;
  let withResearch = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--format") {
      const next = args[i + 1];
      if (next === undefined) {
        return {
          question: "",
          formatId: "",
          provider,
          json,
          withResearch,
          error: "--format expects an id (e.g. --format executive-pre-read)",
        };
      }
      formatId = next;
      i++;
    } else if (a.startsWith("--format=")) {
      formatId = a.slice("--format=".length);
    } else if (a === "--provider") {
      const next = args[i + 1];
      if (next === undefined) {
        return {
          question: "",
          formatId: "",
          provider,
          json,
          withResearch,
          error: "--provider expects a name (e.g. --provider mock)",
        };
      }
      provider = next;
      i++;
    } else if (a.startsWith("--provider=")) {
      provider = a.slice("--provider=".length);
    } else if (a === "--json") {
      json = true;
    } else if (a === "--with-research") {
      withResearch = true;
    } else {
      positional.push(a);
    }
  }

  if (positional.length === 0) {
    return {
      question: "",
      formatId: "",
      provider,
      json,
      withResearch,
      error: "missing question. Usage: praxis brief \"<question>\" --format <id>",
    };
  }
  if (positional.length > 1) {
    return {
      question: "",
      formatId: "",
      provider,
      json,
      withResearch,
      error: "expected exactly one question. Wrap multi-word questions in quotes.",
    };
  }
  if (formatId === null) {
    return {
      question: positional[0]!,
      formatId: "",
      provider,
      json,
      withResearch,
      error: "--format is required. Usage: praxis brief \"<question>\" --format <id>",
    };
  }

  return { question: positional[0]!, formatId, provider, json, withResearch };
}

export async function briefCommand(opts: BriefCommandOptions): Promise<number> {
  const llm = selectProvider(opts.provider, opts.fixturesDir);
  const registry = new FormatRegistry();
  registry.loadDirectory(opts.formatsDir);
  const orchestrator = new Orchestrator(registry, llm);

  if (opts.withResearch) {
    const result = await orchestrator.researchAfterScoping(
      opts.question,
      opts.formatId
    );
    printCombined(result.scoping, result.research, opts.json);
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

function printCombined(
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
    `\n${c.dim("Next: synthesis, editorial, formatting land from v0.6+.")}\n`
  );
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
