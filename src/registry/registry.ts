/**
 * `FormatRegistry` — in-memory catalogue of validated `Format`s.
 *
 * The registry is the single lookup point used by every downstream layer
 * (CLI in v0.1, agents in v0.2+). It enforces one global invariant on top
 * of per-file validation: **format ids are unique**.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { loadFormatFile } from "./loader.ts";
import type { Format, OrganizationStyle } from "./schema.ts";
import { DuplicateFormatError, FormatNotFoundError, PraxisError } from "./errors.ts";

export interface RegistryEntry {
  readonly format: Format;
  readonly sourcePath: string;
}

export interface LoadDirectoryOptions {
  /**
   * If `true`, any error while loading a single file is collected and
   * thrown as a single aggregated PraxisError AFTER all files were tried.
   * If `false` (default), the first error aborts.
   */
  readonly continueOnError?: boolean;
}

export class FormatRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  /**
   * Register a pre-loaded format. Throws `DuplicateFormatError` if `id`
   * is already known.
   */
  register(format: Format, sourcePath: string): void {
    const existing = this.entries.get(format.id);
    if (existing !== undefined) {
      throw new DuplicateFormatError(format.id, existing.sourcePath, sourcePath);
    }
    this.entries.set(format.id, { format, sourcePath });
  }

  /**
   * Loads every `.yaml`/`.yml` file directly inside `dir` (non-recursive
   * — nested subdirectories are ignored) and registers them.
   */
  loadDirectory(dir: string, options: LoadDirectoryOptions = {}): void {
    const files = listYamlFiles(dir);
    const errors: PraxisError[] = [];
    for (const path of files) {
      try {
        const format = loadFormatFile(path);
        this.register(format, path);
      } catch (err) {
        if (options.continueOnError && err instanceof PraxisError) {
          errors.push(err);
          continue;
        }
        throw err;
      }
    }
    if (errors.length > 0) {
      const body = errors.map((e) => `- ${e.message}`).join("\n");
      throw new PraxisError(`Registry load completed with ${errors.length} error(s):\n${body}`);
    }
  }

  /** Returns the format registered under `id`, or throws `FormatNotFoundError`. */
  get(id: string): Format {
    const entry = this.entries.get(id);
    if (entry === undefined) throw new FormatNotFoundError(id);
    return entry.format;
  }

  /** Returns the full entry (format + source path), or `undefined`. */
  find(id: string): RegistryEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** All formats, sorted by id for stable output. */
  list(): readonly Format[] {
    return [...this.entries.values()]
      .map((e) => e.format)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** All entries (format + source path), sorted by id. */
  listEntries(): readonly RegistryEntry[] {
    return [...this.entries.values()].sort((a, b) => a.format.id.localeCompare(b.format.id));
  }

  /** Filter by `metadata.organization_style`. Sorted by id. */
  filterByOrgStyle(style: OrganizationStyle): readonly Format[] {
    return this.list().filter((f) => f.metadata.organization_style === style);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Convenience: create a fresh registry and load `dir` in one call.
 */
export function loadRegistry(dir: string, options: LoadDirectoryOptions = {}): FormatRegistry {
  const registry = new FormatRegistry();
  registry.loadDirectory(dir, options);
  return registry;
}

function listYamlFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];
  for (const name of entries) {
    const path = join(dir, name);
    const st = statSync(path);
    if (!st.isFile()) continue;
    if (name.endsWith(".yaml") || name.endsWith(".yml")) out.push(path);
  }
  return out.sort();
}
