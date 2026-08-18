/**
 * v0.9 — Verbosity dispatcher tests.
 *
 * Verifies:
 *   - `stripVerbosityFlags` extracts --verbose / --quiet regardless of position.
 *   - `praxis <cmd> --verbose` sets the verbosity to "verbose".
 *   - `praxis <cmd> --quiet` sets it to "quiet".
 *   - Trailing flag wins on repeated flags.
 *   - The residual argv (positional order preserved) is unchanged.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { run, stripVerbosityFlags } from "../../src/cli/index.ts";
import { getVerbosity, setColorEnabled, setVerbosity } from "../../src/cli/output.ts";

let stdoutBuf: string[];
let stderrBuf: string[];
let originalStdout: typeof process.stdout.write;
let originalStderr: typeof process.stderr.write;

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
});

afterEach(() => {
  process.stdout.write = originalStdout;
  process.stderr.write = originalStderr;
  setVerbosity("normal");
});

const stderr = (): string => stderrBuf.join("");

// ---------------------------------------------------------------------------
// stripVerbosityFlags — pure function
// ---------------------------------------------------------------------------

describe("stripVerbosityFlags", () => {
  test("no verbosity flag → defaults to normal, argv unchanged", () => {
    const rest = stripVerbosityFlags(["brief", "Q", "--format", "x"]);
    expect(rest).toEqual(["brief", "Q", "--format", "x"]);
    expect(getVerbosity()).toBe("normal");
  });

  test("--verbose anywhere → verbose", () => {
    const rest = stripVerbosityFlags(["brief", "Q", "--verbose", "--format", "x"]);
    expect(rest).toEqual(["brief", "Q", "--format", "x"]);
    expect(getVerbosity()).toBe("verbose");
  });

  test("--quiet anywhere → quiet", () => {
    const rest = stripVerbosityFlags(["brief", "--quiet", "Q", "--format", "x"]);
    expect(rest).toEqual(["brief", "Q", "--format", "x"]);
    expect(getVerbosity()).toBe("quiet");
  });

  test("later flag wins: --quiet then --verbose → verbose", () => {
    stripVerbosityFlags(["--quiet", "brief", "--verbose"]);
    expect(getVerbosity()).toBe("verbose");
  });

  test("later flag wins: --verbose then --quiet → quiet", () => {
    stripVerbosityFlags(["--verbose", "brief", "--quiet"]);
    expect(getVerbosity()).toBe("quiet");
  });
});

// ---------------------------------------------------------------------------
// run() dispatcher — verbosity is applied before the command runs
// ---------------------------------------------------------------------------

describe("run — verbosity is honoured across the dispatch", () => {
  test("`praxis --verbose brief ... --full` prints progress markers", async () => {
    const code = await run([
      "--verbose",
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
    ]);
    expect(code).toBe(0);
    const err = stderr();
    // Progress markers land on stderr.
    expect(err).toContain("running full pipeline");
    expect(err).toContain("pipeline complete");
  });

  test("`praxis --quiet brief ... --full` suppresses progress markers", async () => {
    const code = await run([
      "--quiet",
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
    ]);
    expect(code).toBe(0);
    const err = stderr();
    expect(err).not.toContain("running full pipeline");
    expect(err).not.toContain("pipeline complete");
  });
});
