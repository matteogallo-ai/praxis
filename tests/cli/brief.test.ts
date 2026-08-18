import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { parseBriefArgs, runBriefCli } from "../../src/cli/commands/brief.ts";
import { setColorEnabled } from "../../src/cli/output.ts";

const CTX = {
  formatsDir: "formats",
  fixturesDir: "tests/fixtures/mock-llm",
};

let stdoutBuf: string[];
let stderrBuf: string[];
let originalStdout: typeof process.stdout.write;
let originalStderr: typeof process.stderr.write;
let savedApiKey: string | undefined;

beforeEach(() => {
  setColorEnabled(false);
  stdoutBuf = [];
  stderrBuf = [];
  originalStdout = process.stdout.write.bind(process.stdout);
  originalStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown): boolean => {
    stdoutBuf.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderrBuf.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  savedApiKey = process.env["ANTHROPIC_API_KEY"];
});

afterEach(() => {
  process.stdout.write = originalStdout;
  process.stderr.write = originalStderr;
  if (savedApiKey === undefined) {
    delete process.env["ANTHROPIC_API_KEY"];
  } else {
    process.env["ANTHROPIC_API_KEY"] = savedApiKey;
  }
});

const stdout = () => stdoutBuf.join("");
const stderr = () => stderrBuf.join("");

describe("parseBriefArgs", () => {
  test("parses positional question and --format id", () => {
    const p = parseBriefArgs(["Should we enter Germany?", "--format", "executive-pre-read"]);
    expect(p.error).toBeUndefined();
    expect(p.question).toBe("Should we enter Germany?");
    expect(p.formatId).toBe("executive-pre-read");
    expect(p.provider).toBe("mock");
    expect(p.json).toBe(false);
    expect(p.withResearch).toBe(false);
    expect(p.withStakeholders).toBe(false);
  });

  test("supports --format=<id> equals form", () => {
    const p = parseBriefArgs(["Q", "--format=mckinsey-style-note"]);
    expect(p.error).toBeUndefined();
    expect(p.formatId).toBe("mckinsey-style-note");
  });

  test("parses --provider and --json", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--provider",
      "mock",
      "--json",
    ]);
    expect(p.provider).toBe("mock");
    expect(p.json).toBe(true);
  });

  test("parses --with-research", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--with-research",
    ]);
    expect(p.withResearch).toBe(true);
  });

  test("parses --with-stakeholders", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--with-stakeholders",
    ]);
    expect(p.withStakeholders).toBe(true);
    // Semantic implication (--with-research) is applied by the runner,
    // not the parser — the parser preserves the flags as written.
    expect(p.withResearch).toBe(false);
  });

  test("parses --with-research --with-stakeholders together", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--with-research",
      "--with-stakeholders",
    ]);
    expect(p.withResearch).toBe(true);
    expect(p.withStakeholders).toBe(true);
  });

  test("parses --provider anthropic", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--provider",
      "anthropic",
    ]);
    expect(p.provider).toBe("anthropic");
  });

  test("errors when question is missing", () => {
    const p = parseBriefArgs(["--format", "executive-pre-read"]);
    expect(p.error).toContain("missing question");
  });

  test("errors when --format is missing", () => {
    const p = parseBriefArgs(["Q"]);
    expect(p.error).toContain("--format is required");
  });

  test("errors when --format has no value", () => {
    const p = parseBriefArgs(["Q", "--format"]);
    expect(p.error).toContain("--format");
  });

  test("errors when --provider has no value", () => {
    const p = parseBriefArgs(["Q", "--format", "x", "--provider"]);
    expect(p.error).toContain("--provider");
  });

  test("errors when more than one positional is supplied", () => {
    const p = parseBriefArgs(["Q1", "Q2", "--format", "x"]);
    expect(p.error).toContain("exactly one question");
  });
});

describe("runBriefCli — nominal (scoping only, mock provider)", () => {
  test("prints all four ScopingResult fields as pretty JSON", async () => {
    const code = await runBriefCli(
      ["Should we enter the German market?", "--format", "executive-pre-read"],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("Scoping agent output");
    expect(out).toContain("reformulated_question");
    expect(out).toContain("hidden_questions");
    expect(out).toContain("scope_boundaries");
    expect(out).toContain("assumptions_to_validate");
    // v0.6: the trailer now points at --full instead of "coming in v0.6+".
    expect(out).toContain("--full");
  });

  test("--json emits raw JSON only (no headings, no trailer)", async () => {
    const code = await runBriefCli(
      ["Should we enter the German market?", "--format", "executive-pre-read", "--json"],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout().trim();
    expect(out.startsWith("{")).toBe(true);
    expect(out.endsWith("}")).toBe(true);
    expect(out).not.toContain("Scoping agent output");
    expect(out).not.toContain("v0.6");
    const parsed = JSON.parse(out);
    expect(typeof parsed.reformulated_question).toBe("string");
    expect(Array.isArray(parsed.hidden_questions)).toBe(true);
  });

  test("works with mckinsey-style-note", async () => {
    const code = await runBriefCli(
      ["Should we enter Germany?", "--format", "mckinsey-style-note", "--json"],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.reformulated_question).toContain("Minto");
  });
});

describe("runBriefCli — --with-research (mock provider)", () => {
  test("prints both scoping and research sections", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--with-research",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("Scoping agent output");
    expect(out).toContain("Research agent output");
    expect(out).toContain("Findings:");
    expect(out).toContain("Evidence:");
    expect(out).toContain("Source:");
  });

  test("--with-research --json emits a combined { scoping, research } object", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--with-research",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(typeof parsed.scoping.reformulated_question).toBe("string");
    expect(Array.isArray(parsed.research.findings)).toBe(true);
    expect(parsed.research.findings.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(parsed.research.search_queries_used)).toBe(true);
  });

  test("--with-research works with mckinsey-style-note", async () => {
    const code = await runBriefCli(
      [
        "Should we enter Germany?",
        "--format",
        "mckinsey-style-note",
        "--with-research",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.research.findings.length).toBeGreaterThanOrEqual(3);
  });

  test("--with-research works with position-paper-corporate", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "position-paper-corporate",
        "--with-research",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.research.findings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("runBriefCli — --with-stakeholders (mock provider)", () => {
  test("prints all three agent sections and the stakeholder table", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--with-research",
        "--with-stakeholders",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("Scoping agent output");
    expect(out).toContain("Research agent output");
    expect(out).toContain("Stakeholder mapping output");
    // Table header row is present.
    expect(out).toContain("Name");
    expect(out).toContain("Category");
    expect(out).toContain("Position");
    expect(out).toContain("Power");
    expect(out).toContain("Priority");
    // Should NOT contain the implication note when --with-research is
    // explicitly passed.
    expect(out).not.toContain("--with-stakeholders implies --with-research");
    expect(out).toContain("Key dynamics");
    expect(out).toContain("Blind spots");
  });

  test("--with-stakeholders alone emits the implication note and runs the full pipeline", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--with-stakeholders",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("--with-stakeholders implies --with-research");
    expect(out).toContain("Scoping agent output");
    expect(out).toContain("Research agent output");
    expect(out).toContain("Stakeholder mapping output");
  });

  test("--with-stakeholders --json emits a combined { scoping, research, stakeholders } object", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--with-stakeholders",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(typeof parsed.scoping.reformulated_question).toBe("string");
    expect(Array.isArray(parsed.research.findings)).toBe(true);
    expect(Array.isArray(parsed.stakeholders.stakeholders)).toBe(true);
    expect(parsed.stakeholders.stakeholders.length).toBeGreaterThanOrEqual(5);
    // strict-policy shipped fixture: every position_evidence must be sourced.
    for (const s of parsed.stakeholders.stakeholders) {
      expect(s.position_evidence.status).not.toBe("SOURCE_MISSING");
      expect(typeof s.position_evidence.url).toBe("string");
    }
    // Implication note is written to stdout as prose; --json path suppresses
    // it so the piped stream stays valid JSON.
    const raw = stdout().trim();
    expect(raw.startsWith("{")).toBe(true);
    expect(raw.endsWith("}")).toBe(true);
  });

  test("--with-stakeholders works with position-paper-corporate", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "position-paper-corporate",
        "--with-research",
        "--with-stakeholders",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.stakeholders.stakeholders.length).toBeGreaterThanOrEqual(5);
  });

  test("--with-stakeholders --provider anthropic without ANTHROPIC_API_KEY exits 1 with clear error", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const code = await runBriefCli(
      [
        "Q",
        "--format",
        "executive-pre-read",
        "--with-stakeholders",
        "--provider",
        "anthropic",
      ],
      CTX
    );
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("ANTHROPIC_API_KEY");
    expect(err).toContain("CONTRIBUTING.md");
  });
});

describe("runBriefCli — error paths", () => {
  test("unknown format id exits 1 with FormatNotFoundError message", async () => {
    const code = await runBriefCli(
      ["Q", "--format", "nonexistent-format"],
      CTX
    );
    expect(code).toBe(1);
    expect(stderr()).toContain("No format registered");
  });

  test("unsupported provider exits 1 with helpful error message", async () => {
    const code = await runBriefCli(
      ["Q", "--format", "executive-pre-read", "--provider", "openai"],
      CTX
    );
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("openai");
    expect(err).toContain("mock");
    expect(err).toContain("anthropic");
  });

  test("--provider anthropic without ANTHROPIC_API_KEY exits 1 with clear error", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const code = await runBriefCli(
      [
        "Q",
        "--format",
        "executive-pre-read",
        "--with-research",
        "--provider",
        "anthropic",
      ],
      CTX
    );
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("ANTHROPIC_API_KEY");
    expect(err).toContain("CONTRIBUTING.md");
  });

  test("blank question exits 1 with OrchestrationError message", async () => {
    const code = await runBriefCli(
      ["   ", "--format", "executive-pre-read"],
      CTX
    );
    expect(code).toBe(1);
    expect(stderr()).toContain("empty");
  });

  test("missing --format exits 1 with usage hint", async () => {
    const code = await runBriefCli(["Q"], CTX);
    expect(code).toBe(1);
    expect(stderr()).toContain("--format is required");
  });

  test("missing question exits 1", async () => {
    const code = await runBriefCli(["--format", "executive-pre-read"], CTX);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing question");
  });
});

// ---------------------------------------------------------------------------
// v0.5 — --with-risks and --sourcing-report
// ---------------------------------------------------------------------------

describe("parseBriefArgs — v0.5 flags", () => {
  test("parses --with-risks alone", () => {
    const p = parseBriefArgs(["Q", "--format", "executive-pre-read", "--with-risks"]);
    expect(p.error).toBeUndefined();
    expect(p.withRisks).toBe(true);
    expect(p.sourcingReport).toBe(false);
  });

  test("parses --sourcing-report alone", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--sourcing-report",
    ]);
    expect(p.error).toBeUndefined();
    expect(p.sourcingReport).toBe(true);
    expect(p.withRisks).toBe(false);
  });

  test("parses --with-research --with-stakeholders --with-risks together", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--with-research",
      "--with-stakeholders",
      "--with-risks",
    ]);
    expect(p.error).toBeUndefined();
    expect(p.withRisks).toBe(true);
    expect(p.withStakeholders).toBe(true);
    expect(p.withResearch).toBe(true);
  });
});

describe("briefCommand — --with-risks (v0.5)", () => {
  test("runs the full pipeline and prints all four agent sections plus the sourcing report", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--with-research",
        "--with-stakeholders",
        "--with-risks",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("Scoping agent output");
    expect(out).toContain("Research agent output");
    expect(out).toContain("Stakeholder mapping output");
    expect(out).toContain("Risk analysis output");
    expect(out).toContain("Sourcing report");
    // Risk table headers.
    expect(out).toContain("Likelihood");
    expect(out).toContain("Impact");
    expect(out).toContain("Timeframe");
    // Aggregated score + top-3 sections rendered.
    expect(out).toContain("Aggregated risk score");
    expect(out).toContain("Top-3 priorities");
  });

  test("--with-risks alone implies the earlier stages and emits a stdout note", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--with-risks",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain(
      "--with-risks implies --with-stakeholders (and --with-research)"
    );
    expect(out).toContain("Risk analysis output");
  });

  test("--with-risks --json emits a combined JSON object with all agents and the report", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--with-risks",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.scoping).toBeDefined();
    expect(parsed.research).toBeDefined();
    expect(parsed.stakeholders).toBeDefined();
    expect(parsed.risks).toBeDefined();
    expect(parsed.sourcing_report).toBeDefined();
    expect(Array.isArray(parsed.risks.risks)).toBe(true);
    expect(parsed.risks.top_3_priorities).toHaveLength(3);
    expect(parsed.sourcing_report.total_items).toBeGreaterThan(0);
    expect(parsed.sourcing_report.counts.ok).toBeGreaterThan(0);
  });

  test("--with-risks works with mckinsey-style-note", async () => {
    const code = await runBriefCli(
      [
        "Should we enter Germany?",
        "--format",
        "mckinsey-style-note",
        "--with-risks",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.risks.risks.length).toBeGreaterThanOrEqual(5);
  });

  test("--with-risks works with position-paper-corporate", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "position-paper-corporate",
        "--with-risks",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.risks.risks.length).toBeGreaterThanOrEqual(5);
  });
});

describe("briefCommand — --sourcing-report (v0.5)", () => {
  test("--sourcing-report alone prints ONLY the sourcing report (no agent output)", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--sourcing-report",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("Sourcing report");
    expect(out).not.toContain("Risk analysis output");
    expect(out).not.toContain("Stakeholder mapping output");
    expect(out).toContain(
      "--sourcing-report implies --with-risks"
    );
  });

  test("--sourcing-report --json emits the report as JSON", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--sourcing-report",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.policy).toBe("strict");
    expect(parsed.counts).toBeDefined();
    expect(parsed.total_items).toBeGreaterThan(0);
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });

  test("--with-risks --sourcing-report prints both agent sections AND the report", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--with-risks",
        "--sourcing-report",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("Risk analysis output");
    expect(out).toContain("Sourcing report");
  });
});

// ---------------------------------------------------------------------------
// v0.6 — --full, --output, --with-sourcing-report
// ---------------------------------------------------------------------------

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("parseBriefArgs — v0.6 flags", () => {
  test("parses --full alone", () => {
    const p = parseBriefArgs(["Q", "--format", "executive-pre-read", "--full"]);
    expect(p.error).toBeUndefined();
    expect(p.full).toBe(true);
    expect(p.outputPath).toBeNull();
  });

  test("parses --output <path> with --full", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--full",
      "--output",
      "/tmp/x.md",
    ]);
    expect(p.error).toBeUndefined();
    expect(p.outputPath).toBe("/tmp/x.md");
  });

  test("supports --output=<path> equals form", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--full",
      "--output=/tmp/y.md",
    ]);
    expect(p.error).toBeUndefined();
    expect(p.outputPath).toBe("/tmp/y.md");
  });

  test("--output without --full is a parse error", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--output",
      "/tmp/x.md",
    ]);
    expect(p.error).toContain("--output requires --full");
  });

  test("--with-sourcing-report parses as a sourcing_report request", () => {
    const p = parseBriefArgs([
      "Q",
      "--format",
      "executive-pre-read",
      "--full",
      "--with-sourcing-report",
    ]);
    expect(p.error).toBeUndefined();
    expect(p.sourcingReport).toBe(true);
    expect(p.full).toBe(true);
  });
});

describe("briefCommand — --full (v0.6, mock provider)", () => {
  test("prints a full Markdown briefing with YAML front-matter and every section", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--full",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    // YAML header markers
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("question: ");
    expect(out).toContain("format: \"executive-pre-read\"");
    expect(out).toContain("provider: \"mock\"");
    expect(out).toContain("recommended_option: \"OPT-A\"");
    // Question as H1
    expect(out).toContain("# Should we enter the German market?");
    // Every section heading in order
    const headings = [
      "## Context",
      "## Key Question",
      "## Recommendation",
      "## Supporting Evidence",
      "## Risks and Mitigations",
      "## Next Steps",
    ];
    let cursor = 0;
    for (const h of headings) {
      const idx = out.indexOf(h, cursor);
      expect(idx).toBeGreaterThanOrEqual(cursor);
      cursor = idx + h.length;
    }
    // At least one Sources block
    expect(out).toContain("**Sources:**");
  });

  test("--full --json emits a parseable BriefResult", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--full",
        "--json",
      ],
      CTX
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim());
    expect(parsed.scoping).toBeDefined();
    expect(parsed.research).toBeDefined();
    expect(parsed.stakeholders).toBeDefined();
    expect(parsed.risks).toBeDefined();
    expect(parsed.options).toBeDefined();
    expect(parsed.synthesis).toBeDefined();
    expect(parsed.sourcing_report).toBeDefined();
    expect(parsed.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.format_id).toBe("executive-pre-read");
    expect(parsed.provider_name).toBe("mock");
    expect(parsed.synthesis.sections).toHaveLength(6);
  });

  test("--full --output <path> writes to a file and prints a stderr confirmation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-brief-out-"));
    const path = join(dir, "brief.md");
    try {
      const code = await runBriefCli(
        [
          "Should we enter the German market?",
          "--format",
          "executive-pre-read",
          "--full",
          "--output",
          path,
        ],
        CTX
      );
      expect(code).toBe(0);
      // stdout should be empty (or just the stderr confirmation isn't there).
      expect(stdout()).toBe("");
      expect(stderr()).toContain(path);
      const content = readFileSync(path, "utf-8");
      expect(content.startsWith("---\n")).toBe(true);
      expect(content).toContain("# Should we enter the German market?");
      expect(content).toContain("## Context");
      expect(content).toContain("## Next Steps");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--full --with-sourcing-report appends the report under the briefing", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--full",
        "--with-sourcing-report",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    // The briefing appears first, then the sourcing report.
    const briefIdx = out.indexOf("# Should we enter");
    const reportIdx = out.indexOf("# Sourcing Report");
    expect(briefIdx).toBeGreaterThanOrEqual(0);
    expect(reportIdx).toBeGreaterThan(briefIdx);
    expect(out).toContain("**Policy:** strict");
    expect(out).toContain("**Total items:**");
  });

  test("--full works with mckinsey-style-note", async () => {
    const code = await runBriefCli(
      [
        "Should we enter Germany?",
        "--format",
        "mckinsey-style-note",
        "--full",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("## Situation");
    expect(out).toContain("## Answer");
    expect(out).toContain("## So What");
  });

  test("--full works with position-paper-corporate", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "position-paper-corporate",
        "--full",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("## Issue Framing");
    expect(out).toContain("## Our Position");
    expect(out).toContain("## Recommended Actions");
  });

  test("--full without --format exits 1 with usage hint", async () => {
    const code = await runBriefCli(["Q", "--full"], CTX);
    expect(code).toBe(1);
    expect(stderr()).toContain("--format is required");
  });

  test("--full --provider anthropic without ANTHROPIC_API_KEY exits 1 with clear error", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const code = await runBriefCli(
      [
        "Q",
        "--format",
        "executive-pre-read",
        "--full",
        "--provider",
        "anthropic",
      ],
      CTX
    );
    expect(code).toBe(1);
    expect(stderr()).toContain("ANTHROPIC_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// v0.7 — --critique, --render, --theme, --include-toc, --include-appendices
// ---------------------------------------------------------------------------

import { readFileSync as readFileSync_v07, rmSync as rmSync_v07 } from "node:fs";
import { mkdtempSync as mkdtempSync_v07 } from "node:fs";
import { tmpdir as tmpdir_v07 } from "node:os";
import { join as join_v07 } from "node:path";

describe("parseBriefArgs — v0.7 flags", () => {
  test("parses --critique alone", () => {
    const p = parseBriefArgs(["Q", "--format", "executive-pre-read", "--full", "--critique"]);
    expect(p.error).toBeUndefined();
    expect(p.critique).toBe(true);
  });

  test("parses --render pdf with --output", () => {
    const p = parseBriefArgs([
      "Q", "--format", "executive-pre-read", "--full",
      "--render", "pdf", "--output", "/tmp/x.pdf",
    ]);
    expect(p.error).toBeUndefined();
    expect(p.renderTarget).toBe("pdf");
    expect(p.outputPath).toBe("/tmp/x.pdf");
  });

  test("supports --render=<target> equals form", () => {
    const p = parseBriefArgs([
      "Q", "--format", "executive-pre-read", "--full",
      "--render=docx", "--output=/tmp/y.docx",
    ]);
    expect(p.error).toBeUndefined();
    expect(p.renderTarget).toBe("docx");
    expect(p.outputPath).toBe("/tmp/y.docx");
  });

  test("--render without --output is a parse error", () => {
    const p = parseBriefArgs([
      "Q", "--format", "executive-pre-read", "--full", "--render", "pdf",
    ]);
    expect(p.error).toContain("--render requires --output");
  });

  test("--render without --full is a parse error", () => {
    const p = parseBriefArgs([
      "Q", "--format", "executive-pre-read",
      "--render", "pdf", "--output", "/tmp/x.pdf",
    ]);
    expect(p.error).toContain("--render requires --full");
  });

  test("--theme + --include-toc + --include-appendices parse", () => {
    const p = parseBriefArgs([
      "Q", "--format", "executive-pre-read", "--full", "--render", "pdf",
      "--output", "/tmp/x.pdf", "--theme", "consulting",
      "--include-toc", "--include-appendices",
    ]);
    expect(p.error).toBeUndefined();
    expect(p.theme).toBe("consulting");
    expect(p.includeToc).toBe(true);
    expect(p.includeAppendices).toBe(true);
  });
});

describe("briefCommand — v0.7 --critique", () => {
  test("--full --critique appends the inline critique to stdout", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--full",
        "--critique",
      ],
      CTX
    );
    expect(code).toBe(0);
    const out = stdout();
    // The Markdown briefing still lands on stdout.
    expect(out).toContain("# Should we enter the German market?");
    // And the inline critique is appended.
    expect(out).toContain("Adversarial Critique");
    expect(out).toContain("Robustness:");
    expect(out).toContain("CRIT-001");
  });
});

describe("briefCommand — v0.7 --render", () => {
  test("--full --render md-enhanced --output writes an enhanced Markdown file", async () => {
    const dir = mkdtempSync_v07(join_v07(tmpdir_v07(), "praxis-v07-md-"));
    const path = join_v07(dir, "brief.md");
    try {
      const code = await runBriefCli(
        [
          "Should we enter the German market?",
          "--format", "executive-pre-read",
          "--full", "--render", "md-enhanced",
          "--output", path,
        ],
        CTX
      );
      expect(code).toBe(0);
      // stdout empty (v0.7 --render writes stderr confirmation).
      expect(stdout()).toBe("");
      expect(stderr()).toContain(path);
      const md = readFileSync_v07(path, "utf-8");
      expect(md.startsWith("---\n")).toBe(true);
      expect(md).toContain("## Sources");
    } finally {
      rmSync_v07(dir, { recursive: true, force: true });
    }
  });

  test("--full --render pdf --output writes a PDF file (%PDF-… magic)", async () => {
    const dir = mkdtempSync_v07(join_v07(tmpdir_v07(), "praxis-v07-pdf-"));
    const path = join_v07(dir, "brief.pdf");
    try {
      const code = await runBriefCli(
        [
          "Should we enter the German market?",
          "--format", "executive-pre-read",
          "--full", "--render", "pdf",
          "--output", path,
        ],
        CTX
      );
      expect(code).toBe(0);
      const buf = readFileSync_v07(path);
      expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(1024);
    } finally {
      rmSync_v07(dir, { recursive: true, force: true });
    }
  });

  test("--full --render docx --output writes a DOCX file (PK magic)", async () => {
    const dir = mkdtempSync_v07(join_v07(tmpdir_v07(), "praxis-v07-docx-"));
    const path = join_v07(dir, "brief.docx");
    try {
      const code = await runBriefCli(
        [
          "Should we enter Germany?",
          "--format", "mckinsey-style-note",
          "--full", "--render", "docx",
          "--output", path,
        ],
        CTX
      );
      expect(code).toBe(0);
      const buf = readFileSync_v07(path);
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
    } finally {
      rmSync_v07(dir, { recursive: true, force: true });
    }
  });

  test("--full --critique --render pdf includes the critique in the PDF", async () => {
    const dir = mkdtempSync_v07(join_v07(tmpdir_v07(), "praxis-v07-full-"));
    const path = join_v07(dir, "brief.pdf");
    try {
      const code = await runBriefCli(
        [
          "Should we enter the German market?",
          "--format", "executive-pre-read",
          "--full", "--critique", "--render", "pdf",
          "--include-toc", "--include-appendices",
          "--theme", "consulting",
          "--output", path,
        ],
        CTX
      );
      expect(code).toBe(0);
      const buf = readFileSync_v07(path);
      expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
      // A --critique --render PDF is materially larger than a plain
      // one because the critique adds pages.
      expect(buf.length).toBeGreaterThan(10 * 1024);
    } finally {
      rmSync_v07(dir, { recursive: true, force: true });
    }
  });

  test("--full --render pdf without --output is a parse error", async () => {
    const code = await runBriefCli(
      [
        "Q", "--format", "executive-pre-read",
        "--full", "--render", "pdf",
      ],
      CTX
    );
    expect(code).toBe(1);
    expect(stderr()).toContain("--render requires --output");
  });

  test("--full --render docx --output on a format that doesn't allow docx exits 1", async () => {
    const dir = mkdtempSync_v07(join_v07(tmpdir_v07(), "praxis-v07-err-"));
    const path = join_v07(dir, "x.docx");
    try {
      const code = await runBriefCli(
        [
          "Q", "--format", "executive-pre-read",
          "--full", "--render", "docx",
          "--output", path,
        ],
        CTX
      );
      expect(code).toBe(1);
      expect(stderr()).toContain("does not declare 'docx'");
    } finally {
      rmSync_v07(dir, { recursive: true, force: true });
    }
  });

  test("--full --render unknown-target --output exits 1", async () => {
    const dir = mkdtempSync_v07(join_v07(tmpdir_v07(), "praxis-v07-unk-"));
    const path = join_v07(dir, "x.epub");
    try {
      const code = await runBriefCli(
        [
          "Q", "--format", "executive-pre-read",
          "--full", "--render", "epub",
          "--output", path,
        ],
        CTX
      );
      expect(code).toBe(1);
      expect(stderr()).toContain("does not declare 'epub'");
    } finally {
      rmSync_v07(dir, { recursive: true, force: true });
    }
  });

  test("--theme with an unknown value exits 1", async () => {
    const dir = mkdtempSync_v07(join_v07(tmpdir_v07(), "praxis-v07-theme-"));
    const path = join_v07(dir, "x.pdf");
    try {
      const code = await runBriefCli(
        [
          "Q", "--format", "executive-pre-read",
          "--full", "--render", "pdf",
          "--output", path, "--theme", "corporate",
        ],
        CTX
      );
      expect(code).toBe(1);
      expect(stderr()).toContain("--theme 'corporate' is not one of");
    } finally {
      rmSync_v07(dir, { recursive: true, force: true });
    }
  });
});
