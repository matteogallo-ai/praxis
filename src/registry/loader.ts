/**
 * Loads a `.yaml` format file from disk, parses it, and validates it
 * against the Format schema.
 *
 * All disk / parse / validation errors are surfaced as subclasses of
 * `PraxisError` so callers only need one catch clause.
 */

import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

import { parseYaml, ConfigParseError } from "@promptlang/yaml-parser";
import { validateFormat } from "./validator.ts";
import type { Format } from "./schema.ts";
import { FileNotFoundError, YamlSyntaxError } from "./errors.ts";

/**
 * Reads `path`, parses it as YAML, and validates the result. Returns the
 * strongly-typed `Format` on success.
 */
export function loadFormatFile(path: string): Format {
  if (!existsSync(path)) {
    throw new FileNotFoundError(path);
  }
  const source = readFileSync(path, "utf-8");
  return loadFormatFromSource(source, path);
}

/**
 * Loads a format from an in-memory YAML source. `source` labels the input
 * in error messages (usually the file path or a fixture name).
 */
export function loadFormatFromSource(source: string, label: string): Format {
  let parsed;
  try {
    parsed = parseYaml(source);
  } catch (err) {
    if (err instanceof ConfigParseError) {
      throw new YamlSyntaxError(err.message.replace(/ \(line \d+\)$/, ""), err.line, label);
    }
    throw err;
  }
  return validateFormat(parsed, basename(label));
}
