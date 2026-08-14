/**
 * Typed error hierarchy used across the Format Registry.
 *
 * All errors thrown by the loader/validator/registry are instances of
 * `PraxisError`. The CLI dispatch uses `instanceof` to render a
 * human-readable message and pick an exit code.
 */

export class PraxisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PraxisError";
  }
}

/**
 * A single field-level validation problem. `path` is a dotted / bracketed
 * JSON-pointer-lite location, e.g. `metadata.language` or `sections[2].id`.
 */
export interface ValidationIssue {
  path: string;
  message: string;
}

export class ValidationError extends PraxisError {
  readonly issues: readonly ValidationIssue[];
  readonly source?: string;

  constructor(issues: readonly ValidationIssue[], source?: string) {
    const header = source
      ? `Format validation failed for '${source}' (${issues.length} issue${
          issues.length === 1 ? "" : "s"
        })`
      : `Format validation failed (${issues.length} issue${
          issues.length === 1 ? "" : "s"
        })`;
    const body = issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    super(`${header}\n${body}`);
    this.name = "ValidationError";
    this.issues = issues;
    if (source !== undefined) {
      this.source = source;
    }
  }
}

/** Wraps a YAML parse error so callers only need to catch PraxisError. */
export class YamlSyntaxError extends PraxisError {
  readonly line: number;
  readonly source?: string;

  constructor(message: string, line: number, source?: string) {
    super(
      source
        ? `YAML syntax error in '${source}' at line ${line}: ${message}`
        : `YAML syntax error at line ${line}: ${message}`
    );
    this.name = "YamlSyntaxError";
    this.line = line;
    if (source !== undefined) {
      this.source = source;
    }
  }
}

export class FileNotFoundError extends PraxisError {
  readonly path: string;

  constructor(path: string) {
    super(`Format file not found: ${path}`);
    this.name = "FileNotFoundError";
    this.path = path;
  }
}

export class DuplicateFormatError extends PraxisError {
  readonly id: string;
  readonly firstSource: string;
  readonly secondSource: string;

  constructor(id: string, firstSource: string, secondSource: string) {
    super(
      `Duplicate format id '${id}' — first defined in '${firstSource}', duplicated in '${secondSource}'`
    );
    this.name = "DuplicateFormatError";
    this.id = id;
    this.firstSource = firstSource;
    this.secondSource = secondSource;
  }
}

export class FormatNotFoundError extends PraxisError {
  readonly id: string;

  constructor(id: string) {
    super(`No format registered with id '${id}'`);
    this.name = "FormatNotFoundError";
    this.id = id;
  }
}
