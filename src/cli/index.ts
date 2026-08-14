#!/usr/bin/env bun
/**
 * `praxis` CLI entrypoint.
 *
 * Usage:
 *   praxis version
 *   praxis formats list [--org-style <style>]
 *   praxis formats inspect <format-id>
 *   praxis formats validate <path/to/file.yaml>
 */

import { resolve } from "node:path";

import { versionCommand } from "./commands/version.ts";
import { listCommand, parseOrgStyleFlag } from "./commands/list.ts";
import { inspectCommand } from "./commands/inspect.ts";
import { validateCommand } from "./commands/validate.ts";
import { c } from "./output.ts";
import { PRAXIS_VERSION } from "./version-constant.ts";
import { PraxisError } from "../registry/errors.ts";

/**
 * Formats directory used by `formats list` and `formats inspect`.
 * v0.1: single, hard-coded, relative-to-repo-root path. v0.2 will
 * introduce a resolution algorithm (env var + config file).
 */
const DEFAULT_FORMATS_DIR = resolve(import.meta.dir, "..", "..", "formats");

export function run(argv: readonly string[]): number {
  const args = [...argv];

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
    `praxis v${PRAXIS_VERSION} — Format Registry for consultant-grade analytical briefings\n\n` +
      `Usage:\n` +
      `  praxis version\n` +
      `  praxis formats list [--org-style <style>]\n` +
      `  praxis formats inspect <format-id>\n` +
      `  praxis formats validate <path/to/file.yaml>\n\n` +
      `Run 'praxis formats list' to see the shipped v0.1 catalogue.\n`
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
  const exitCode = run(process.argv.slice(2));
  process.exit(exitCode);
}
