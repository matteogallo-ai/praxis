/**
 * The benchmark manifest, `benchmarks/questions.yaml`: loaded and checked
 * field by field, so a malformed edit fails before any briefing runs.
 */

import { readFileSync } from "node:fs";

import { parseYaml } from "@promptlang/yaml-parser";

export interface BenchmarkEntry {
  id: string;
  question: string;
  format: string;
  tags: string[];
  intent: string;
}

export interface BenchmarkManifest {
  version: number;
  benchmarks: BenchmarkEntry[];
}

export function loadManifest(path: string): BenchmarkManifest {
  const raw = readFileSync(path, "utf-8");
  const parsed = parseYaml(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`benchmarks manifest at ${path} must be a mapping`);
  }
  const version = (parsed as { version: unknown }).version;
  if (typeof version !== "number") {
    throw new Error(`benchmarks manifest missing numeric 'version' field`);
  }
  const benchmarks = (parsed as { benchmarks: unknown }).benchmarks;
  if (!Array.isArray(benchmarks)) {
    throw new Error(`benchmarks manifest 'benchmarks' must be a list`);
  }
  const validated: BenchmarkEntry[] = [];
  for (const [i, b] of benchmarks.entries()) {
    if (b === null || typeof b !== "object" || Array.isArray(b)) {
      throw new Error(`benchmarks[${i}] must be a mapping`);
    }
    const entry = b as Record<string, unknown>;
    validated.push({
      id: requireString(entry, "id", i),
      question: requireString(entry, "question", i),
      format: requireString(entry, "format", i),
      tags: requireStringList(entry, "tags", i),
      intent: requireString(entry, "intent", i),
    });
  }
  return { version, benchmarks: validated };
}

function requireString(
  o: Record<string, unknown>,
  key: string,
  index: number
): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(
      `benchmarks[${index}]: '${key}' must be a non-empty string`
    );
  }
  return v;
}

function requireStringList(
  o: Record<string, unknown>,
  key: string,
  index: number
): string[] {
  const v = o[key];
  if (!Array.isArray(v)) {
    throw new Error(`benchmarks[${index}]: '${key}' must be a list`);
  }
  for (const [j, e] of v.entries()) {
    if (typeof e !== "string" || e.length === 0) {
      throw new Error(
        `benchmarks[${index}].${key}[${j}] must be a non-empty string`
      );
    }
  }
  return v as string[];
}
