/**
 * v0.9 — Structured error context tests.
 *
 * Verifies that the top-level catch in `runBriefCli` upgrades the
 * three highest-frequency actionable failures into structured
 * `errorWithContext` blocks (cause / suggestion / see):
 *
 *   1. AnthropicAuthenticationError → suggests `--provider mock`.
 *   2. FormatNotFoundError          → suggests `praxis formats list`.
 *   3. UnsupportedRenderTargetError → suggests a supported target.
 *
 * These are the failures a first-time user hits most often; the
 * structured messages exist so the operator can fix the problem
 * without opening the source.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { runBriefCli } from "../../src/cli/commands/brief.ts";
import { setColorEnabled, setVerbosity } from "../../src/cli/output.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  setVerbosity("normal");
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
  setVerbosity("normal");
});

const stderr = (): string => stderrBuf.join("");

// ---------------------------------------------------------------------------
// FormatNotFoundError — v0.9 upgrades this to a structured block.
// ---------------------------------------------------------------------------

describe("runBriefCli — FormatNotFoundError becomes structured error", () => {
  test("unknown --format id → cause + suggestion + see", async () => {
    const code = await runBriefCli(
      ["Q", "--format", "nonexistent-format"],
      CTX
    );
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("nonexistent-format");
    expect(err).toContain("cause:");
    expect(err).toContain("not registered");
    expect(err).toContain("suggestion:");
    expect(err).toContain("praxis formats list");
    expect(err).toContain("see:");
  });
});

// ---------------------------------------------------------------------------
// AnthropicAuthenticationError — v0.9 upgrades this to a structured block.
// ---------------------------------------------------------------------------

describe("runBriefCli — AnthropicAuthenticationError becomes structured error", () => {
  test("--provider anthropic without ANTHROPIC_API_KEY → guidance", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const code = await runBriefCli(
      ["Q", "--format", "executive-pre-read", "--provider", "anthropic"],
      CTX
    );
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("cause:");
    expect(err).toContain("API key");
    expect(err).toContain("suggestion:");
    expect(err).toContain("--provider mock");
  });
});

// ---------------------------------------------------------------------------
// UnsupportedRenderTargetError — v0.9 upgrades this to a structured block.
// ---------------------------------------------------------------------------

describe("runBriefCli — UnsupportedRenderTargetError becomes structured error", () => {
  test("unknown --render target → cause + suggestion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-v09-err-"));
    const path = join(dir, "brief.html");
    try {
      const code = await runBriefCli(
        [
          "Q",
          "--format",
          "executive-pre-read",
          "--full",
          "--render",
          "html",
          "--output",
          path,
        ],
        CTX
      );
      expect(code).toBe(1);
      const err = stderr();
      expect(err).toContain("cause:");
      expect(err).toContain("suggestion:");
      expect(err).toContain("Pick a supported target");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
