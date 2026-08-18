/**
 * DOCX renderer tests (v0.7).
 *
 * The tests build a DOCX buffer from a synthetic brief and then
 * unzip it in-memory using a minimal ZIP reader (below) so we can
 * inspect every part's XML content. Word/LibreOffice are still the
 * ground truth for renderability — these tests validate structural
 * correctness at the OOXML level (right parts exist, headings
 * appear, tables materialise).
 */

import { describe, expect, test } from "bun:test";
import { inflateRawSync } from "node:zlib";

import { docxRenderer, buildDocxParts } from "../../src/renderers/docx.ts";
import { computeCrc32 } from "../../src/renderers/docx-internals/zip-builder.ts";
import type {
  BriefResult,
  BriefWithCritiqueResult,
} from "../../src/orchestrator/orchestrator.ts";

// ---------------------------------------------------------------------------
// Test-only minimal ZIP reader
// ---------------------------------------------------------------------------

interface ExtractedEntry {
  name: string;
  content: string;
}

/**
 * Parse a PKZIP archive by scanning end-of-central-directory,
 * walking central directory records, then reading each local file
 * header and inflating (or copying) the payload.
 */
function unzip(buf: Buffer): ExtractedEntry[] {
  const SIG_EOCD = 0x06054b50;
  // Find EOCD from the tail (up to 65 KiB back per spec).
  let eocdOffset = -1;
  const minStart = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("EOCD not found");

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralSize = buf.readUInt32LE(eocdOffset + 12);
  const centralStart = buf.readUInt32LE(eocdOffset + 16);
  void centralSize;

  const out: ExtractedEntry[] = [];
  let cursor = centralStart;
  for (let i = 0; i < totalEntries; i++) {
    const sig = buf.readUInt32LE(cursor);
    if (sig !== 0x02014b50) throw new Error("bad central directory signature");
    const compressionMethod = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.slice(cursor + 46, cursor + 46 + nameLen).toString("utf-8");

    // Read local file header to find where the payload starts.
    const localSig = buf.readUInt32LE(localOffset);
    if (localSig !== 0x04034b50) throw new Error("bad local header signature");
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    const raw = buf.slice(dataStart, dataEnd);
    let inflated: Buffer;
    if (compressionMethod === 0) {
      inflated = raw;
    } else if (compressionMethod === 8) {
      inflated = inflateRawSync(raw);
    } else {
      throw new Error(`unsupported compression method ${compressionMethod}`);
    }
    if (inflated.length !== uncompressedSize) {
      throw new Error(
        `uncompressed length mismatch for '${name}': expected ${uncompressedSize}, got ${inflated.length}`
      );
    }

    out.push({ name, content: inflated.toString("utf-8") });

    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SRC = {
  url: "https://reuters.com/x",
  title: "Reuters piece",
  accessed_at: "2026-08-15T00:00:00Z",
  excerpt: "…",
};

function makeBrief(): BriefResult {
  return {
    scoping: {
      reformulated_question: "R?",
      hidden_questions: [],
      scope_boundaries: [],
      assumptions_to_validate: [],
    },
    research: {
      findings: [{ claim: "c", supporting_evidence: "e", source: SRC }],
      open_questions: [],
      search_queries_used: [],
    },
    stakeholders: {
      stakeholders: [
        {
          name: "Alpha",
          category: "decision-maker",
          interest: "…",
          position: "supportive",
          position_evidence: SRC,
          power: "high",
          priority: "critical",
          engagement_notes: "…",
        },
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    },
    risks: {
      risks: [
        {
          id: "RISK-001",
          category: "strategic",
          description: "…",
          likelihood: "medium",
          impact: "moderate",
          likelihood_evidence: SRC,
          impact_evidence: SRC,
          affected_stakeholders: ["Alpha"],
          timeframe: "short-term",
          mitigations: ["Do X"],
          residual_risk_after_mitigation: "low",
        },
      ],
      aggregated_risk_score: {
        overall: "medium",
        by_category: { strategic: "medium" },
      },
      top_3_priorities: ["RISK-001"],
      unresolved_uncertainties: [],
    },
    options: {
      options: [
        {
          id: "OPT-A",
          title: "Do it",
          summary: "…",
          tradeoffs: [
            { dimension: "cost", assessment: "low" },
            { dimension: "time-to-market", assessment: "fast" },
            { dimension: "regulatory-exposure", assessment: "low" },
          ],
          stakeholder_impact: [
            { stakeholder_name: "Alpha", predicted_reaction: "supportive", impact_description: "…" },
          ],
          risks_mitigated: ["RISK-001"],
          risks_introduced: [],
          dependencies: [],
          time_horizon: "short-term",
          recommendation_level: "recommended",
          supporting_evidence: SRC,
        },
      ],
      recommended_option_id: "OPT-A",
      rationale_for_recommendation: "…",
      counter_arguments_considered: [],
      unresolved_uncertainties: [],
    },
    synthesis: {
      sections: [
        {
          section_id: "intro",
          title: "Intro",
          content_markdown: "The intro text with content.",
          word_count: 6,
          sources_cited: [SRC],
          validation_issues: [],
        },
        {
          section_id: "body",
          title: "Body",
          content_markdown: "First paragraph body.\n\nSecond paragraph body.",
          word_count: 6,
          sources_cited: [],
          validation_issues: [],
        },
      ],
      total_word_count: 12,
      format_conformance: {
        target_words: 800,
        actual_words: 12,
        deviation_pct: -98.5,
        sections_over_length: [],
        forbidden_terms_found: [],
        failed_validation_rules: [],
      },
    },
    sourcing_report: {
      policy: "strict",
      total_items: 5,
      counts: { ok: 5, stale: 0, untrusted: 0, duplicated: 0, missing: 0 },
      warnings: [],
      missing_sources_count: 0,
    },
    generated_at: "2026-08-18T12:00:00.000Z",
    format_id: "test-format",
    question: "Should we do the thing?",
    provider_name: "mock",
  };
}

function makeBriefWithCritique(): BriefWithCritiqueResult {
  return {
    ...makeBrief(),
    adversarial: {
      critiques: [
        {
          id: "CRIT-001",
          category: "hidden-assumption",
          severity: "critical",
          target: { section_id: "intro" },
          steelmanned_position:
            "A steelmanned position with enough words to pass the minimum length threshold enforced by the adversarial parser at execution time.",
          counter_evidence: SRC,
          implication_if_true: "Something would flip.",
          suggested_revision: "Do X.",
        },
      ],
      critical_count: 1,
      material_count: 0,
      minor_count: 0,
      recommendation_robustness: "medium",
      revised_recommendation_needed: true,
      steelmanned_alternative: "Consider alternative Y.",
    },
  };
}

// ---------------------------------------------------------------------------
// buildDocxParts (pure XML inspection)
// ---------------------------------------------------------------------------

describe("buildDocxParts — required parts", () => {
  test("emits exactly the five OPC parts, in required order", () => {
    const parts = buildDocxParts(makeBrief());
    expect(parts.map((p) => p.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml",
      "word/_rels/document.xml.rels",
    ]);
  });

  test("[Content_Types].xml declares document + styles types", () => {
    const parts = buildDocxParts(makeBrief());
    const ct = parts[0]!.content;
    expect(ct).toContain("wordprocessingml.document.main+xml");
    expect(ct).toContain("wordprocessingml.styles+xml");
  });

  test("_rels/.rels points at word/document.xml", () => {
    const parts = buildDocxParts(makeBrief());
    expect(parts[1]!.content).toContain(`Target="word/document.xml"`);
  });

  test("word/_rels/document.xml.rels points at styles.xml", () => {
    const parts = buildDocxParts(makeBrief());
    expect(parts[4]!.content).toContain(`Target="styles.xml"`);
  });

  test("word/styles.xml declares Heading1/2/3, Normal, PraxisTable", () => {
    const parts = buildDocxParts(makeBrief());
    const s = parts[3]!.content;
    expect(s).toContain(`w:styleId="Normal"`);
    expect(s).toContain(`w:styleId="Heading1"`);
    expect(s).toContain(`w:styleId="Heading2"`);
    expect(s).toContain(`w:styleId="Heading3"`);
    expect(s).toContain(`w:styleId="PraxisTable"`);
  });
});

describe("buildDocxParts — document.xml content", () => {
  test("body includes question as Heading1", () => {
    const parts = buildDocxParts(makeBrief());
    const doc = parts[2]!.content;
    expect(doc).toContain(`<w:pStyle w:val="Heading1"/>`);
    expect(doc).toContain("Should we do the thing?");
  });

  test("every synthesis section renders as Heading2", () => {
    const parts = buildDocxParts(makeBrief());
    const doc = parts[2]!.content;
    expect(doc).toContain("Intro</w:t>");
    expect(doc).toContain("Body</w:t>");
    const h2Count = doc.match(/<w:pStyle w:val="Heading2"\/>/g) ?? [];
    // At minimum: 2 synthesis sections + 3 fixed tables (Options / Risks / Stakeholders) + Sources footer.
    expect(h2Count.length).toBeGreaterThanOrEqual(6);
  });

  test("body includes Options / Risks / Stakeholders / Sources tables and headings", () => {
    const parts = buildDocxParts(makeBrief());
    const doc = parts[2]!.content;
    expect(doc).toContain("Options</w:t>");
    expect(doc).toContain("Risks</w:t>");
    expect(doc).toContain("Stakeholders</w:t>");
    expect(doc).toContain("Sources</w:t>");
    expect(doc).toContain("PraxisTable");
    // Risks table row has our RISK-001 id.
    expect(doc).toContain("RISK-001</w:t>");
    expect(doc).toContain("OPT-A</w:t>");
    expect(doc).toContain("Alpha</w:t>");
  });

  test("XML escaping — angle brackets and ampersands survive", () => {
    const brief = makeBrief();
    brief.question = `A "quoted" & <bracketed> question`;
    const parts = buildDocxParts(brief);
    const doc = parts[2]!.content;
    expect(doc).toContain("&amp;");
    expect(doc).toContain("&lt;bracketed&gt;");
    expect(doc).toContain("&quot;quoted&quot;");
  });

  test("include_critique=true and briefWithCritique adds the critique section", () => {
    const parts = buildDocxParts(makeBriefWithCritique(), { include_critique: true });
    const doc = parts[2]!.content;
    expect(doc).toContain("Adversarial Critique</w:t>");
    expect(doc).toContain("CRIT-001");
    expect(doc).toContain("Steelmanned alternative");
  });

  test("include_appendices=true adds all three appendices", () => {
    const parts = buildDocxParts(makeBrief(), { include_appendices: true });
    const doc = parts[2]!.content;
    expect(doc).toContain("Appendix A");
    expect(doc).toContain("Appendix B");
    expect(doc).toContain("Appendix C");
  });

  test("include_toc=true adds a TOC section", () => {
    const parts = buildDocxParts(makeBrief(), { include_toc: true });
    const doc = parts[2]!.content;
    expect(doc).toContain("Table of Contents</w:t>");
  });

  test("include_sourcing_report=true adds Sourcing Report block", () => {
    const parts = buildDocxParts(makeBrief(), { include_sourcing_report: true });
    const doc = parts[2]!.content;
    expect(doc).toContain("Sourcing Report</w:t>");
    expect(doc).toContain("Policy: strict");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: build + unzip roundtrip
// ---------------------------------------------------------------------------

describe("docxRenderer.render — ZIP roundtrip", () => {
  test("returns a Buffer > 1 KiB starting with the local file header signature (PK\\x03\\x04)", async () => {
    const buf = await docxRenderer.render(makeBrief());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1024);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  test("archive contains exactly the five OPC parts and each roundtrips through unzip", async () => {
    const buf = await docxRenderer.render(makeBrief());
    const parts = unzip(buf);
    expect(parts.map((p) => p.name).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/styles.xml",
      ].sort()
    );
    // Every part is non-empty valid text.
    for (const p of parts) {
      expect(p.content.length).toBeGreaterThan(20);
      expect(p.content).toContain("<");
    }
  });

  test("unzipped document.xml contains the question and section headings", async () => {
    const buf = await docxRenderer.render(makeBrief());
    const parts = unzip(buf);
    const doc = parts.find((p) => p.name === "word/document.xml")!;
    expect(doc.content).toContain("Should we do the thing?");
    expect(doc.content).toContain("Intro");
    expect(doc.content).toContain("Body");
  });

  test("computeCrc32 matches CRC of known payload (regression against 'hello world')", () => {
    // Reference: crc32('hello world\n') = 0xaf083b2d (per rfc-1952 test vectors).
    // Our input has no trailing newline; use crc32('hello world') = 0x0d4a1185.
    const crc = computeCrc32(Buffer.from("hello world", "utf-8"));
    expect(crc.toString(16)).toBe("d4a1185");
  });
});
