/**
 * v0.9 — Unit tests for the new src/cli/output.ts helpers:
 * `symbols`, `styledSymbols`, `log`, `progress`, and
 * `errorWithContext`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  errorWithContext,
  getVerbosity,
  log,
  progress,
  setColorEnabled,
  setVerbosity,
  styledSymbols,
  symbols,
} from "../../src/cli/output.ts";

let stderrBuf: string[];
let originalStderr: typeof process.stderr.write;

beforeEach(() => {
  setColorEnabled(false);
  setVerbosity("normal");
  stderrBuf = [];
  originalStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown): boolean => {
    stderrBuf.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = originalStderr;
  setVerbosity("normal");
});

const stderr = (): string => stderrBuf.join("");

// ---------------------------------------------------------------------------
// symbols / styledSymbols
// ---------------------------------------------------------------------------

describe("symbols + styledSymbols", () => {
  test("symbols exposes the expected glyph set", () => {
    expect(symbols.success).toBe("✓");
    expect(symbols.error).toBe("✗");
    expect(symbols.warn).toBe("⚠");
    expect(symbols.info).toBe("ℹ");
    expect(symbols.bullet).toBe("•");
    expect(symbols.arrow).toBe("→");
  });

  test("styledSymbols returns the same glyph (colours off)", () => {
    // colours disabled in beforeEach → wrappers return raw glyph.
    expect(styledSymbols.success()).toBe("✓");
    expect(styledSymbols.error()).toBe("✗");
    expect(styledSymbols.warn()).toBe("⚠");
    expect(styledSymbols.info()).toBe("ℹ");
  });
});

// ---------------------------------------------------------------------------
// setVerbosity / getVerbosity
// ---------------------------------------------------------------------------

describe("setVerbosity / getVerbosity", () => {
  test("defaults to normal", () => {
    setVerbosity("normal");
    expect(getVerbosity()).toBe("normal");
  });

  test("switches to quiet and verbose", () => {
    setVerbosity("quiet");
    expect(getVerbosity()).toBe("quiet");
    setVerbosity("verbose");
    expect(getVerbosity()).toBe("verbose");
  });
});

// ---------------------------------------------------------------------------
// log()
// ---------------------------------------------------------------------------

describe("log", () => {
  test("info/success emit under normal verbosity", () => {
    setVerbosity("normal");
    log("info", "hello");
    log("success", "done");
    const out = stderr();
    expect(out).toContain("ℹ hello");
    expect(out).toContain("✓ done");
  });

  test("quiet suppresses info/success but keeps warn/error", () => {
    setVerbosity("quiet");
    log("info", "swallowed-info");
    log("success", "swallowed-success");
    log("warn", "kept-warn");
    log("error", "kept-error");
    const out = stderr();
    expect(out).not.toContain("swallowed-info");
    expect(out).not.toContain("swallowed-success");
    expect(out).toContain("⚠ kept-warn");
    expect(out).toContain("✗ kept-error");
  });

  test("verbose messages are gated on --verbose", () => {
    setVerbosity("normal");
    log("verbose", "hidden");
    expect(stderr()).not.toContain("hidden");

    stderrBuf.length = 0;
    setVerbosity("verbose");
    log("verbose", "surfaced");
    expect(stderr()).toContain("surfaced");
  });

  test("errors emit even under quiet", () => {
    setVerbosity("quiet");
    log("error", "boom");
    expect(stderr()).toContain("✗ boom");
  });
});

// ---------------------------------------------------------------------------
// progress()
// ---------------------------------------------------------------------------

describe("progress", () => {
  test("emits a step marker under normal verbosity", () => {
    setVerbosity("normal");
    progress("loading formats");
    const out = stderr();
    expect(out).toContain("loading formats");
    expect(out).toContain("→");
  });

  test("optional detail is rendered in parens", () => {
    setVerbosity("normal");
    progress("running pipeline", "format=x");
    expect(stderr()).toContain("(format=x)");
  });

  test("--quiet suppresses progress markers", () => {
    setVerbosity("quiet");
    progress("swallowed");
    expect(stderr()).toBe("");
  });

  test("--verbose keeps progress markers on", () => {
    setVerbosity("verbose");
    progress("loud step");
    expect(stderr()).toContain("loud step");
  });
});

// ---------------------------------------------------------------------------
// errorWithContext()
// ---------------------------------------------------------------------------

describe("errorWithContext", () => {
  test("renders every field on separate lines", () => {
    const out = errorWithContext({
      what: "Format 'foo' not found",
      cause: "The format id is not registered.",
      suggestion: "Run praxis formats list.",
      see: "docs/getting-started.md",
    });
    expect(out).toContain("✗");
    expect(out).toContain("Format 'foo' not found");
    expect(out).toContain("cause:");
    expect(out).toContain("The format id is not registered.");
    expect(out).toContain("suggestion:");
    expect(out).toContain("Run praxis formats list.");
    expect(out).toContain("see:");
    expect(out).toContain("docs/getting-started.md");
    // Must be a compact multi-line block, not one wall-of-text.
    expect(out.split("\n").length).toBeGreaterThanOrEqual(4);
  });

  test("omits missing optional fields cleanly", () => {
    const out = errorWithContext({ what: "Boom" });
    expect(out).toContain("Boom");
    expect(out).not.toContain("cause:");
    expect(out).not.toContain("suggestion:");
    expect(out).not.toContain("see:");
  });

  test("returned string ends with a single trailing newline", () => {
    const out = errorWithContext({ what: "x" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
