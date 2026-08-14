import { loadFormatFile } from "../../registry/loader.ts";
import {
  FileNotFoundError,
  ValidationError,
  YamlSyntaxError,
} from "../../registry/errors.ts";
import { c } from "../output.ts";

export interface ValidateArgs {
  filePath: string;
}

/**
 * Validates a YAML file. On success prints a green confirmation and
 * returns exit code 0. On any known error prints a structured, colourised
 * report and returns exit code 1.
 */
export function validateCommand(args: ValidateArgs): number {
  try {
    const format = loadFormatFile(args.filePath);
    process.stdout.write(
      `${c.green("✓")} Valid format: ${c.bold(format.id)} (v${format.version})\n`
    );
    return 0;
  } catch (err) {
    if (err instanceof ValidationError) {
      process.stderr.write(
        `${c.red("✗")} ${c.bold("Validation failed")} for ${args.filePath}\n`
      );
      for (const issue of err.issues) {
        process.stderr.write(`  ${c.red("-")} ${c.bold(issue.path)}: ${issue.message}\n`);
      }
      process.stderr.write(
        c.dim(`\n${err.issues.length} issue${err.issues.length === 1 ? "" : "s"} found.\n`)
      );
      return 1;
    }
    if (err instanceof YamlSyntaxError) {
      process.stderr.write(
        `${c.red("✗")} ${c.bold("YAML syntax error")} at line ${err.line}: ${err.message
          .replace(/^YAML syntax error [^:]+: /, "")}\n`
      );
      return 1;
    }
    if (err instanceof FileNotFoundError) {
      process.stderr.write(`${c.red("✗")} ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}
