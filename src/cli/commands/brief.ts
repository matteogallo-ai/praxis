/**
 * `praxis brief "<question>" --format <id>` — v0.2 mode: scoping only.
 *
 * The command runs the Orchestrator up to the Scoping agent and prints
 * the resulting JSON. Full-briefing generation lands in v0.6+; when
 * asked to run past scoping, the orchestrator itself throws
 * `NotImplementedError` — this command does not simulate progress.
 *
 * Flags:
 *   --format <id>      required. Format id from the registry.
 *   --provider <name>  optional. Only 'mock' is supported in v0.2.
 *   --json             optional. Prints raw JSON only (no headings) for piping.
 */

import { FormatRegistry } from "../../registry/registry.ts";
import { Orchestrator } from "../../orchestrator/orchestrator.ts";
import { MockLLMProvider } from "../../llm/mock-provider.ts";
import { ProviderNotSupportedError } from "../../llm/errors.ts";
import { PraxisError } from "../../registry/errors.ts";
import { c } from "../output.ts";
import type { LLMProvider } from "../../llm/provider.ts";
import type { ScopingResult } from "../../agents/types.ts";

export interface BriefCommandOptions {
  question: string;
  formatId: string;
  provider: string;
  json: boolean;
  formatsDir: string;
  fixturesDir: string;
}

export interface ParsedBriefArgs {
  question: string;
  formatId: string;
  provider: string;
  json: boolean;
  error?: string;
}

/**
 * Parses the `brief` argument tail: exactly one positional (the
 * question) plus `--format`, optional `--provider`, `--json`.
 */
export function parseBriefArgs(args: readonly string[]): ParsedBriefArgs {
  const positional: string[] = [];
  let formatId: string | null = null;
  let provider = "mock";
  let json = false;

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
          error: "--provider expects a name (e.g. --provider mock)",
        };
      }
      provider = next;
      i++;
    } else if (a.startsWith("--provider=")) {
      provider = a.slice("--provider=".length);
    } else if (a === "--json") {
      json = true;
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
      error: "missing question. Usage: praxis brief \"<question>\" --format <id>",
    };
  }
  if (positional.length > 1) {
    return {
      question: "",
      formatId: "",
      provider,
      json,
      error: "expected exactly one question. Wrap multi-word questions in quotes.",
    };
  }
  if (formatId === null) {
    return {
      question: positional[0]!,
      formatId: "",
      provider,
      json,
      error: "--format is required. Usage: praxis brief \"<question>\" --format <id>",
    };
  }

  return { question: positional[0]!, formatId, provider, json };
}

export async function briefCommand(opts: BriefCommandOptions): Promise<number> {
  const llm = selectProvider(opts.provider, opts.fixturesDir);
  const registry = new FormatRegistry();
  registry.loadDirectory(opts.formatsDir);
  const orchestrator = new Orchestrator(registry, llm);

  const result = await orchestrator.scope(opts.question, opts.formatId);
  printScopingResult(result, opts.json);
  return 0;
}

function selectProvider(name: string, fixturesDir: string): LLMProvider {
  if (name === "mock") {
    return new MockLLMProvider({ fixturesDir });
  }
  throw new ProviderNotSupportedError(name);
}

function printScopingResult(result: ScopingResult, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write(`\n${c.bold(c.cyan("Scoping agent output"))}\n`);
  process.stdout.write(`${c.dim("=".repeat(20))}\n`);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(
    `\n${c.dim("Next: full briefing generation coming in v0.6+.")}\n`
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
      formatsDir: ctx.formatsDir,
      fixturesDir: ctx.fixturesDir,
    });
  } catch (err) {
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
