#!/usr/bin/env bun
/**
 * `praxis` CLI entrypoint.
 *
 * Usage:
 *   praxis version
 *   praxis formats list [--org-style <style>]
 *   praxis formats inspect <format-id>
 *   praxis formats validate <path/to/file.yaml>
 *   praxis brief "<question>" --format <id>
 *                             [--provider mock|anthropic]
 *                             [--with-research]
 *                             [--with-stakeholders]
 *                             [--json]
 */

import { resolve } from "node:path";

import { versionCommand } from "./commands/version.ts";
import { listCommand, parseOrgStyleFlag } from "./commands/list.ts";
import { inspectCommand } from "./commands/inspect.ts";
import { validateCommand } from "./commands/validate.ts";
import { runBriefCli } from "./commands/brief.ts";
import { c, setVerbosity, type Verbosity } from "./output.ts";
import { PRAXIS_VERSION } from "./version-constant.ts";
import { PraxisError } from "../registry/errors.ts";

/**
 * Strip global verbosity flags (--verbose / -v / --quiet / -q) from the
 * argument list and apply them via `setVerbosity()`. The residual
 * `argv` (order preserved) is returned so downstream parsers do not
 * see the flags. Later flags win — `--quiet --verbose` yields verbose.
 */
export function stripVerbosityFlags(argv: readonly string[]): string[] {
  let v: Verbosity = "normal";
  const rest: string[] = [];
  for (const a of argv) {
    if (a === "--verbose") {
      v = "verbose";
    } else if (a === "--quiet") {
      v = "quiet";
    } else {
      rest.push(a);
    }
  }
  setVerbosity(v);
  return rest;
}

/**
 * Formats directory used by `formats list`, `formats inspect`, and `brief`.
 */
const DEFAULT_FORMATS_DIR = resolve(import.meta.dir, "..", "..", "formats");

/**
 * Default fixtures directory for the v0.2 MockLLMProvider. Real
 * providers arrive in v0.3+ and will not need this path.
 */
const DEFAULT_MOCK_FIXTURES_DIR = resolve(
  import.meta.dir,
  "..",
  "..",
  "tests",
  "fixtures",
  "mock-llm"
);

export async function run(argv: readonly string[]): Promise<number> {
  // Global flags (--verbose, --quiet) can appear anywhere on the
  // command line. Strip them first so downstream parsers stay simple.
  const args = stripVerbosityFlags(argv);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return 0;
  }

  const command = args.shift()!;

  if (command === "version" || command === "--version" || command === "-v") {
    return versionCommand();
  }

  if (command === "formats") {
    const sub = args.shift();
    if (sub === undefined) {
      printFormatsHelp();
      return 1;
    }
    return dispatchFormats(sub, args);
  }

  if (command === "brief") {
    return runBriefCli(args, {
      formatsDir: DEFAULT_FORMATS_DIR,
      fixturesDir: DEFAULT_MOCK_FIXTURES_DIR,
    });
  }

  process.stderr.write(`${c.red("Unknown command:")} ${command}\n\n`);
  printHelp();
  return 1;
}

function dispatchFormats(sub: string, rest: string[]): number {
  try {
    switch (sub) {
      case "list": {
        const orgStyle = parseOrgStyleFlag(rest);
        const listArgs: Parameters<typeof listCommand>[0] = {
          formatsDir: DEFAULT_FORMATS_DIR,
        };
        if (orgStyle !== null) listArgs.orgStyle = orgStyle;
        return listCommand(listArgs);
      }
      case "inspect": {
        const id = rest[0];
        if (id === undefined) {
          process.stderr.write(
            `${c.red("Missing argument:")} 'praxis formats inspect' requires a format id\n`
          );
          return 1;
        }
        return inspectCommand({ formatsDir: DEFAULT_FORMATS_DIR, id });
      }
      case "validate": {
        const path = rest[0];
        if (path === undefined) {
          process.stderr.write(
            `${c.red("Missing argument:")} 'praxis formats validate' requires a file path\n`
          );
          return 1;
        }
        return validateCommand({ filePath: path });
      }
      default:
        process.stderr.write(`${c.red("Unknown formats subcommand:")} ${sub}\n\n`);
        printFormatsHelp();
        return 1;
    }
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

function printHelp(): void {
  process.stdout.write(
    `praxis v${PRAXIS_VERSION} — Format Registry + seven-agent pipeline with PDF/DOCX/MD renderers\n\n` +
      `Usage:\n` +
      `  praxis version\n` +
      `  praxis formats list [--org-style <style>]\n` +
      `  praxis formats inspect <format-id>\n` +
      `  praxis formats validate <path/to/file.yaml>\n` +
      `  praxis brief "<question>" --format <id>\n` +
      `                            [--provider mock|anthropic]\n` +
      `                            [--with-research]\n` +
      `                            [--with-stakeholders]\n` +
      `                            [--with-risks]\n` +
      `                            [--sourcing-report]\n` +
      `                            [--full]\n` +
      `                            [--critique]\n` +
      `                            [--with-rerun]\n` +
      `                            [--render md-enhanced|docx|pdf]\n` +
      `                            [--output <path>]\n` +
      `                            [--theme professional|government|consulting]\n` +
      `                            [--include-toc]\n` +
      `                            [--include-appendices]\n` +
      `                            [--with-sourcing-report]\n` +
      `                            [--json]\n\n` +
      `Global flags:\n` +
      `  --verbose            log every pipeline step to stderr\n` +
      `  --quiet              suppress progress logs; keep final output\n\n` +
      `Format helpers:\n` +
      `  --format auto        pick a shipped format from question keywords\n\n` +
      `In v0.7, 'brief' runs the seven-agent pipeline. --full runs the six-agent\n` +
      `pipeline (Scoping → Research → Stakeholders → Risks → Options → Synthesis) and\n` +
      `prints the Markdown briefing. --critique adds the Adversarial Critique agent\n` +
      `(seventh) and appends its output. --render dispatches to one of three\n` +
      `output formats (Markdown-enhanced with TOC and sources, DOCX from-scratch, or\n` +
      `PDF via pdfkit); --render requires --output <path>. --theme picks the PDF\n` +
      `look. --include-toc and --include-appendices control optional renderer\n` +
      `sections. --with-rerun (v0.8) enables the editorial re-run loop —\n` +
      `implies --critique, requires --full, and re-invokes Synthesis in REVISION\n` +
      `MODE if the critique flags a revised recommendation. Hard cap: one rerun.\n`
  );
}

function printFormatsHelp(): void {
  process.stderr.write(
    `Usage:\n` +
      `  praxis formats list [--org-style <style>]\n` +
      `  praxis formats inspect <format-id>\n` +
      `  praxis formats validate <path/to/file.yaml>\n`
  );
}

// Only run when this file is invoked directly (not when imported by tests).
if (import.meta.main) {
  const exitCode = await run(process.argv.slice(2));
  process.exit(exitCode);
}
