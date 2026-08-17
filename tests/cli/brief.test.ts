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
    expect(out).toContain("v0.6+");
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
