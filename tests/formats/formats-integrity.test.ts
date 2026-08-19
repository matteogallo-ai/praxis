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

  test("family-office-memo.yaml loads and validates", () => {
    const f = loadFormatFile(resolve(FORMATS, "family-office-memo.yaml"));
    expect(f.id).toBe("family-office-memo");
    expect(f.metadata.organization_style).toBe("family-office");
    expect(f.target_length).toEqual({ pages: 3, words: 1200 });
    expect(f.sections.map((s) => s.id)).toEqual([
      "principal-summary",
      "context-and-heritage",
      "stakeholders-and-alignment",
      "options-and-tradeoffs",
      "risks-and-preservation",
      "recommended-next-step",
    ]);
    // Tone directives across the memo enforce a third-person institutional voice.
    const principalSummary = f.sections.find((s) => s.id === "principal-summary");
    expect(principalSummary?.tone_directives.toLowerCase()).toContain("third-person");
    // The forbidden-terms list explicitly bans "the family" so the memo
    // stays inside the roles vocabulary (Principal, Council, Successor
    // Generation, External Trustee, ...).
    expect(f.style_guide.forbidden_terms).toContain("the family");
    // The format is strict-by-design: strict_editorial is on and every
    // rejection axis is set to "reject" (not the default "warn").
    const editorial = f.sourcing_rules?.editorial;
    expect(editorial?.strict_editorial).toBe(true);
    expect(editorial?.forbidden_terms_action).toBe("reject");
    expect(editorial?.over_length_action).toBe("reject");
    expect(editorial?.validation_rules_action).toBe("reject");
    // The recommended-next-step section carries the explicit-decision rule.
    const recommended = f.sections.find((s) => s.id === "recommended-next-step");
    expect(recommended?.validation_rules).toContain("must_state_recommendation_explicitly: true");
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

  test("registry contains exactly the shipped formats", () => {
    expect(all.map((f) => f.id).sort()).toEqual([
      "executive-pre-read",
      "family-office-memo",
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

  // -------------------------------------------------------------------------
  // v0.5 — every shipped format now declares a sourcing_rules block that
  // covers freshness, domain trust, and dedupe. This locks the format
  // authoring convention in place: any new shipped format must repeat it.
  // -------------------------------------------------------------------------

  test("every shipped format declares a sourcing_rules block (v0.5 baseline)", () => {
    for (const f of all) {
      expect(f.sourcing_rules).toBeDefined();
    }
  });

  test("every sourcing_rules block covers freshness, domain_trust, and dedupe", () => {
    for (const f of all) {
      expect(f.sourcing_rules?.freshness).toBeDefined();
      expect(f.sourcing_rules?.domain_trust).toBeDefined();
      expect(f.sourcing_rules?.dedupe).toBeDefined();
    }
  });

  test("freshness thresholds satisfy warn_after_days ≤ max_source_age_days", () => {
    for (const f of all) {
      const fr = f.sourcing_rules?.freshness;
      expect(fr).toBeDefined();
      if (fr) {
        expect(fr.warn_after_days).toBeLessThanOrEqual(fr.max_source_age_days);
        expect(fr.max_source_age_days).toBeGreaterThan(0);
      }
    }
  });

  test("dedupe.cross_agent is enabled by default in every shipped format", () => {
    for (const f of all) {
      expect(f.sourcing_rules?.dedupe?.cross_agent).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // v0.6 — every shipped format must support the six-agent pipeline
  // (Scoping, Research, Stakeholder, Risk, Options, Synthesis). This is
  // the pre-flight check for `Orchestrator.brief()`.
  // -------------------------------------------------------------------------

  const SIX_AGENT_PIPELINE = [
    "scoping",
    "research",
    "stakeholder",
    "risk",
    "options",
    "synthesis",
  ] as const;

  test("every shipped format lists every six-agent-pipeline agent in some section", () => {
    for (const f of all) {
      const agentsUsed = new Set<string>();
      for (const s of f.sections) {
        for (const a of s.required_agents) agentsUsed.add(a);
      }
      for (const requiredAgent of SIX_AGENT_PIPELINE) {
        expect(agentsUsed.has(requiredAgent)).toBe(true);
      }
    }
  });

  test("every shipped format's synthesis section appears at least once", () => {
    for (const f of all) {
      const hasSynthesis = f.sections.some((s) =>
        (s.required_agents as readonly string[]).includes("synthesis")
      );
      expect(hasSynthesis).toBe(true);
    }
  });

  test("every shipped format's options section appears at least once", () => {
    for (const f of all) {
      const hasOptions = f.sections.some((s) =>
        (s.required_agents as readonly string[]).includes("options")
      );
      expect(hasOptions).toBe(true);
    }
  });

  // v0.8: every shipped format declares an editorial block explicitly.
  // The default `strict_editorial: false` opts into warn-only behaviour;
  // v1.2 introduces family-office-memo with `strict_editorial: true`
  // (patrimonial memos reject-and-regenerate on rule violations rather
  // than surfacing warnings). Both postures remain valid — the invariant
  // is that the block is declared, not the value it carries.
  test("every shipped format declares an editorial block", () => {
    for (const f of all) {
      const ed = f.sourcing_rules?.editorial;
      expect(ed).toBeDefined();
      expect(typeof ed!.strict_editorial).toBe("boolean");
    }
  });

  test("every editorial block picks a valid max_regeneration_attempts (1-3)", () => {
    for (const f of all) {
      const attempts = f.sourcing_rules?.editorial?.max_regeneration_attempts;
      expect(attempts).toBeGreaterThanOrEqual(1);
      expect(attempts).toBeLessThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// v1.2 — family-office-memo — dedicated integrity assertions.
//
// Locks the discretion protocols, sourcing tiers, and mock-fixture
// coverage that make the format usable end-to-end. Any regression on
// these axes would surface here before shipping.
// ---------------------------------------------------------------------------

import { existsSync as _existsSync } from "node:fs";
const FAMILY_OFFICE = loadFormatFile(resolve(FORMATS, "family-office-memo.yaml"));
const FIXTURES_DIR = resolve(import.meta.dir, "..", "fixtures", "mock-llm");

describe("family-office-memo — format spec integrity", () => {
  test("declares six sections in the canonical memo order", () => {
    expect(FAMILY_OFFICE.sections).toHaveLength(6);
    expect(FAMILY_OFFICE.sections.map((s) => s.id)).toEqual([
      "principal-summary",
      "context-and-heritage",
      "stakeholders-and-alignment",
      "options-and-tradeoffs",
      "risks-and-preservation",
      "recommended-next-step",
    ]);
  });

  test("every section names required_agents that always include synthesis", () => {
    for (const s of FAMILY_OFFICE.sections) {
      expect(s.required_agents.length).toBeGreaterThan(0);
      expect(s.required_agents).toContain("synthesis");
    }
  });

  test("cumulative section budget matches the 1200-word target", () => {
    const cumulative = FAMILY_OFFICE.sections.reduce(
      (acc, s) => acc + s.max_length.words,
      0
    );
    expect(cumulative).toBeLessThanOrEqual(FAMILY_OFFICE.target_length.words);
  });

  test("principal-summary tone_directives forbids second-person address", () => {
    const s = FAMILY_OFFICE.sections.find((x) => x.id === "principal-summary");
    expect(s?.tone_directives.toLowerCase()).toContain("never as \"you\"");
  });

  test("forbidden_terms enforces the discretion vocabulary", () => {
    const terms = FAMILY_OFFICE.style_guide.forbidden_terms;
    expect(terms).toContain("the family");
    expect(terms).toContain("leverage");
    expect(terms).toContain("synergy");
    expect(terms).toContain("obviously");
    expect(terms).toContain("clearly");
  });

  test("output_targets ships all three renderers (md, docx, pdf)", () => {
    expect(FAMILY_OFFICE.output_targets).toContain("md");
    expect(FAMILY_OFFICE.output_targets).toContain("docx");
    expect(FAMILY_OFFICE.output_targets).toContain("pdf");
  });

  test("sourcing_rules.freshness is 5 years max, 3 years warn (patrimonial horizon)", () => {
    const fr = FAMILY_OFFICE.sourcing_rules?.freshness;
    expect(fr?.max_source_age_days).toBe(1825);
    expect(fr?.warn_after_days).toBe(1095);
  });

  test("sourcing_rules.domain_trust uses reputation-only with min_tier 2 (excludes Wikipedia)", () => {
    const dt = FAMILY_OFFICE.sourcing_rules?.domain_trust;
    expect(dt?.mode).toBe("reputation-only");
    expect(dt?.reputation_tiers?.min_tier).toBe(2);
    expect(dt?.reputation_tiers?.tier_3).toContain("wikipedia.org");
  });

  test("tier_1 sources include institutional patrimonial anchors", () => {
    const t1 = FAMILY_OFFICE.sourcing_rules?.domain_trust?.reputation_tiers?.tier_1 ?? [];
    expect(t1).toContain("campdenfb.com");
    expect(t1).toContain("*.finma.ch");
    expect(t1).toContain("*.oecd.org");
    expect(t1).toContain("*.bis.org");
  });

  test("tier_2 sources include the STEP practice-note domain", () => {
    const t2 = FAMILY_OFFICE.sourcing_rules?.domain_trust?.reputation_tiers?.tier_2 ?? [];
    expect(t2).toContain("step.org");
    expect(t2).toContain("wealthbriefing.com");
  });

  test("recommended-next-step section fits within 80 words and names the decision explicitly", () => {
    const s = FAMILY_OFFICE.sections.find((x) => x.id === "recommended-next-step");
    expect(s?.max_length.words).toBe(80);
    expect(s?.validation_rules).toContain("must_state_recommendation_explicitly: true");
  });
});

describe("family-office-memo — mock-llm fixture coverage", () => {
  const REQUIRED_FIXTURES = [
    "scoping-family-office-memo.json",
    "research-family-office-memo.json",
    "stakeholders-family-office-memo.json",
    "risks-family-office-memo.json",
    "options-family-office-memo.json",
    "adversarial-family-office-memo.json",
    "synthesis-family-office-memo-principal-summary.json",
    "synthesis-family-office-memo-context-and-heritage.json",
    "synthesis-family-office-memo-stakeholders-and-alignment.json",
    "synthesis-family-office-memo-options-and-tradeoffs.json",
    "synthesis-family-office-memo-risks-and-preservation.json",
    "synthesis-family-office-memo-recommended-next-step.json",
  ] as const;

  for (const fname of REQUIRED_FIXTURES) {
    test(`fixture ${fname} exists`, () => {
      expect(_existsSync(resolve(FIXTURES_DIR, fname))).toBe(true);
    });
  }
});
