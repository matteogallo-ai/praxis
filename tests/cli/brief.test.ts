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
});

afterEach(() => {
  process.stdout.write = originalStdout;
  process.stderr.write = originalStderr;
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

describe("runBriefCli — nominal", () => {
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

describe("runBriefCli — error paths", () => {
  test("unknown format id exits 1 with FormatNotFoundError message", async () => {
    const code = await runBriefCli(
      ["Q", "--format", "nonexistent-format"],
      CTX
    );
    expect(code).toBe(1);
    expect(stderr()).toContain("No format registered");
  });

  test("unsupported provider exits 1 with ProviderNotSupportedError message", async () => {
    const code = await runBriefCli(
      ["Q", "--format", "executive-pre-read", "--provider", "openai"],
      CTX
    );
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("openai");
    expect(err).toContain("v0.2");
    expect(err).toContain("mock");
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
