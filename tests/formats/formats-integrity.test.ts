import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { loadFormatFile } from "../../src/registry/loader.ts";
import { loadRegistry } from "../../src/registry/registry.ts";

const FORMATS = resolve(import.meta.dir, "..", "..", "formats");

describe("shipped formats — file-level integrity", () => {
  test("executive-pre-read.yaml loads and validates", () => {
    const f = loadFormatFile(resolve(FORMATS, "executive-pre-read.yaml"));
    expect(f.id).toBe("executive-pre-read");
    expect(f.metadata.organization_style).toBe("generic");
    expect(f.metadata.language).toBe("en");
    expect(f.target_length).toEqual({ pages: 2, words: 800 });
    expect(f.sections.map((s) => s.id)).toEqual([
      "context",
      "key-question",
      "recommendation",
      "supporting-evidence",
      "risks-and-mitigations",
      "next-steps",
    ]);
  });

  test("position-paper-corporate.yaml loads and validates", () => {
    const f = loadFormatFile(resolve(FORMATS, "position-paper-corporate.yaml"));
    expect(f.id).toBe("position-paper-corporate");
    expect(f.metadata.organization_style).toBe("corporate-affairs");
    expect(f.target_length).toEqual({ pages: 4, words: 1600 });
    expect(f.sections.map((s) => s.id)).toEqual([
      "issue-framing",
      "stakeholder-landscape",
      "our-position",
      "rationale",
      "counter-arguments-addressed",
      "recommended-actions",
    ]);
    const ourPosition = f.sections.find((s) => s.id === "our-position");
    expect(ourPosition?.validation_rules).toBeDefined();
    expect(ourPosition?.validation_rules).toContain("must_state_position_explicitly: true");
  });

  test("mckinsey-style-note.yaml loads and validates", () => {
    const f = loadFormatFile(resolve(FORMATS, "mckinsey-style-note.yaml"));
    expect(f.id).toBe("mckinsey-style-note");
    expect(f.metadata.organization_style).toBe("mckinsey");
    expect(f.target_length).toEqual({ pages: 3, words: 1200 });
    expect(f.sections.map((s) => s.id)).toEqual([
      "situation",
      "complication",
      "key-question",
      "answer",
      "supporting-arguments",
      "so-what",
    ]);
    expect(f.style_guide.forbidden_terms).toContain("synergy");
    expect(f.style_guide.forbidden_terms).toContain("to leverage");
  });
});

describe("shipped formats — structural invariants", () => {
  const registry = loadRegistry(FORMATS);
  const all = registry.list();

  test("every shipped format has a strict sourcing_policy (v0.1 baseline)", () => {
    for (const f of all) {
      expect(f.sourcing_policy).toBe("strict");
    }
  });

  test("every section names a non-empty required_agents list", () => {
    for (const f of all) {
      for (const s of f.sections) {
        expect(s.required_agents.length).toBeGreaterThan(0);
      }
    }
  });

  test("cumulative section word budget stays within target_length.words", () => {
    for (const f of all) {
      const cumulative = f.sections.reduce((acc, s) => acc + s.max_length.words, 0);
      expect(cumulative).toBeLessThanOrEqual(f.target_length.words);
    }
  });

  test("every format id equals the basename of its source file (stem)", () => {
    for (const entry of registry.listEntries()) {
      const stem = entry.sourcePath.split("/").pop()!.replace(/\.yaml$/, "");
      expect(entry.format.id).toBe(stem);
    }
  });

  test("registry contains exactly the three shipped v0.1 formats", () => {
    expect(all.map((f) => f.id).sort()).toEqual([
      "executive-pre-read",
      "mckinsey-style-note",
      "position-paper-corporate",
    ]);
  });

  test("every format targets at least one output medium", () => {
    for (const f of all) {
      expect(f.output_targets.length).toBeGreaterThan(0);
    }
  });

  test("last_reviewed dates are not in the future relative to build date", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const f of all) {
      expect(f.metadata.last_reviewed <= today).toBe(true);
    }
  });
});
