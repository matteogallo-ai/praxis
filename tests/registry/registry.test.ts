import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { FormatRegistry, loadRegistry } from "../../src/registry/registry.ts";
import {
  DuplicateFormatError,
  FormatNotFoundError,
  PraxisError,
  ValidationError,
} from "../../src/registry/errors.ts";
import type { Format } from "../../src/registry/schema.ts";

const FORMATS_DIR = resolve(import.meta.dir, "..", "..", "formats");
const FIXTURES_DIR = resolve(import.meta.dir, "..", "fixtures");

function makeFormat(id: string, overrides: Partial<Format> = {}): Format {
  const base: Format = {
    id,
    name: id,
    version: "1.0.0",
    metadata: {
      author: "Test",
      organization_style: "generic",
      language: "en",
      last_reviewed: "2026-08-14",
    },
    target_length: { pages: 1, words: 400 },
    sections: [
      {
        id: "only",
        title: "Only",
        purpose: "Only.",
        max_length: { words: 400 },
        required_agents: ["synthesis"],
        tone_directives: "neutral",
      },
    ],
    sourcing_policy: "strict",
    style_guide: {
      voice: "neutral",
      sentence_structure: "short",
      forbidden_terms: [],
    },
    output_targets: ["md"],
  };
  return { ...base, ...overrides };
}

let scratchDir: string;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "praxis-registry-"));
});

function cleanup() {
  rmSync(scratchDir, { recursive: true, force: true });
}

describe("FormatRegistry — register + get", () => {
  test("registers a format and retrieves it by id", () => {
    const r = new FormatRegistry();
    r.register(makeFormat("a"), "/tmp/a.yaml");
    expect(r.get("a").id).toBe("a");
    expect(r.has("a")).toBe(true);
    expect(r.size).toBe(1);
    cleanup();
  });

  test("get throws FormatNotFoundError for an unknown id", () => {
    const r = new FormatRegistry();
    expect(() => r.get("does-not-exist")).toThrow(FormatNotFoundError);
    cleanup();
  });

  test("find returns undefined for an unknown id", () => {
    const r = new FormatRegistry();
    expect(r.find("does-not-exist")).toBeUndefined();
    cleanup();
  });

  test("find returns entry with sourcePath for a known id", () => {
    const r = new FormatRegistry();
    r.register(makeFormat("a"), "/tmp/a.yaml");
    const entry = r.find("a");
    expect(entry).toBeDefined();
    expect(entry!.sourcePath).toBe("/tmp/a.yaml");
    cleanup();
  });

  test("register throws DuplicateFormatError on repeated id", () => {
    const r = new FormatRegistry();
    r.register(makeFormat("a"), "/tmp/a1.yaml");
    let caught: unknown;
    try {
      r.register(makeFormat("a"), "/tmp/a2.yaml");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DuplicateFormatError);
    expect((caught as DuplicateFormatError).firstSource).toBe("/tmp/a1.yaml");
    expect((caught as DuplicateFormatError).secondSource).toBe("/tmp/a2.yaml");
    cleanup();
  });
});

describe("FormatRegistry — list + filter", () => {
  test("list returns formats sorted by id", () => {
    const r = new FormatRegistry();
    r.register(makeFormat("zebra"), "/tmp/z.yaml");
    r.register(makeFormat("alpha"), "/tmp/a.yaml");
    r.register(makeFormat("mid"), "/tmp/m.yaml");
    expect(r.list().map((f) => f.id)).toEqual(["alpha", "mid", "zebra"]);
    cleanup();
  });

  test("filterByOrgStyle returns only matching formats", () => {
    const r = new FormatRegistry();
    r.register(
      makeFormat("m1", {
        metadata: {
          author: "T",
          organization_style: "mckinsey",
          language: "en",
          last_reviewed: "2026-08-14",
        },
      }),
      "/tmp/m1.yaml"
    );
    r.register(
      makeFormat("m2", {
        metadata: {
          author: "T",
          organization_style: "mckinsey",
          language: "en",
          last_reviewed: "2026-08-14",
        },
      }),
      "/tmp/m2.yaml"
    );
    r.register(makeFormat("g1"), "/tmp/g1.yaml");
    const matches = r.filterByOrgStyle("mckinsey");
    expect(matches.map((f) => f.id)).toEqual(["m1", "m2"]);
    cleanup();
  });

  test("filterByOrgStyle returns empty when nothing matches", () => {
    const r = new FormatRegistry();
    r.register(makeFormat("g1"), "/tmp/g1.yaml");
    expect(r.filterByOrgStyle("mckinsey")).toEqual([]);
    cleanup();
  });

  test("listEntries returns entries sorted by id with source path", () => {
    const r = new FormatRegistry();
    r.register(makeFormat("b"), "/tmp/b.yaml");
    r.register(makeFormat("a"), "/tmp/a.yaml");
    const entries = r.listEntries();
    expect(entries.map((e) => e.format.id)).toEqual(["a", "b"]);
    expect(entries[0]!.sourcePath).toBe("/tmp/a.yaml");
    cleanup();
  });
});

describe("FormatRegistry — loadDirectory", () => {
  test("loads the shipped formats/ directory", () => {
    const r = loadRegistry(FORMATS_DIR);
    const ids = r.list().map((f) => f.id);
    expect(ids).toContain("executive-pre-read");
    expect(ids).toContain("position-paper-corporate");
    expect(ids).toContain("mckinsey-style-note");
    cleanup();
  });

  test("loads a directory containing exactly one YAML", () => {
    writeFileSync(
      join(scratchDir, "one.yaml"),
      `id: one\nname: One\nversion: 1.0.0\nmetadata:\n  author: T\n  organization_style: generic\n  language: en\n  last_reviewed: 2026-08-14\ntarget_length:\n  pages: 1\n  words: 400\nsections:\n  - id: only\n    title: Only\n    purpose: Only.\n    max_length:\n      words: 400\n    required_agents:\n      - synthesis\n    tone_directives: neutral\nsourcing_policy: strict\nstyle_guide:\n  voice: v\n  sentence_structure: s\n  forbidden_terms:\n    - placeholder\noutput_targets:\n  - md\n`
    );
    const r = loadRegistry(scratchDir);
    expect(r.size).toBe(1);
    expect(r.get("one").id).toBe("one");
    cleanup();
  });

  test("loads an empty directory (size 0, list empty)", () => {
    const r = loadRegistry(scratchDir);
    expect(r.size).toBe(0);
    expect(r.list()).toEqual([]);
    cleanup();
  });

  test("ignores non-YAML files in the directory", () => {
    writeFileSync(join(scratchDir, "README.md"), "not yaml");
    writeFileSync(join(scratchDir, "notes.txt"), "not yaml either");
    const r = loadRegistry(scratchDir);
    expect(r.size).toBe(0);
    cleanup();
  });

  test("ignores nested subdirectories", () => {
    mkdirSync(join(scratchDir, "sub"));
    writeFileSync(join(scratchDir, "sub", "ignored.yaml"), "id: ignored\n");
    const r = loadRegistry(scratchDir);
    expect(r.size).toBe(0);
    cleanup();
  });

  test("aborts on first invalid file by default", () => {
    writeFileSync(
      join(scratchDir, "bad.yaml"),
      "id: bad\nname: Bad\nversion: not-semver\n"
    );
    expect(() => loadRegistry(scratchDir)).toThrow(ValidationError);
    cleanup();
  });

  test("continueOnError aggregates all failures into one PraxisError", () => {
    writeFileSync(
      join(scratchDir, "a-bad.yaml"),
      "id: a-bad\nname: A\nversion: not-semver\n"
    );
    writeFileSync(
      join(scratchDir, "b-bad.yaml"),
      "id: b-bad\nname: B\nversion: also-not-semver\n"
    );
    let caught: unknown;
    try {
      loadRegistry(scratchDir, { continueOnError: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PraxisError);
    expect((caught as PraxisError).message).toContain("2 error(s)");
    cleanup();
  });

  test("detects a duplicate format id across two files", () => {
    writeFileSync(
      join(scratchDir, "one.yaml"),
      `id: dup\nname: One\nversion: 1.0.0\nmetadata:\n  author: T\n  organization_style: generic\n  language: en\n  last_reviewed: 2026-08-14\ntarget_length:\n  pages: 1\n  words: 400\nsections:\n  - id: only\n    title: Only\n    purpose: Only.\n    max_length:\n      words: 400\n    required_agents:\n      - synthesis\n    tone_directives: neutral\nsourcing_policy: strict\nstyle_guide:\n  voice: v\n  sentence_structure: s\n  forbidden_terms:\n    - placeholder\noutput_targets:\n  - md\n`
    );
    writeFileSync(
      join(scratchDir, "two.yaml"),
      `id: dup\nname: Two\nversion: 1.0.0\nmetadata:\n  author: T\n  organization_style: generic\n  language: en\n  last_reviewed: 2026-08-14\ntarget_length:\n  pages: 1\n  words: 400\nsections:\n  - id: only\n    title: Only\n    purpose: Only.\n    max_length:\n      words: 400\n    required_agents:\n      - synthesis\n    tone_directives: neutral\nsourcing_policy: strict\nstyle_guide:\n  voice: v\n  sentence_structure: s\n  forbidden_terms:\n    - placeholder\noutput_targets:\n  - md\n`
    );
    expect(() => loadRegistry(scratchDir)).toThrow(DuplicateFormatError);
    cleanup();
  });

  test("fixtures dir loaded with continueOnError reports every failure", () => {
    let caught: unknown;
    try {
      loadRegistry(FIXTURES_DIR, { continueOnError: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PraxisError);
    // Only the valid fixture is registered; every "invalid-*" file fails.
    expect((caught as PraxisError).message).toMatch(/\d+ error\(s\)/);
    cleanup();
  });

  test("size increments as formats are registered", () => {
    const r = new FormatRegistry();
    expect(r.size).toBe(0);
    r.register(makeFormat("a"), "/tmp/a.yaml");
    expect(r.size).toBe(1);
    r.register(makeFormat("b"), "/tmp/b.yaml");
    expect(r.size).toBe(2);
    cleanup();
  });
});
