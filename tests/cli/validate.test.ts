import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { validateCommand } from "../../src/cli/commands/validate.ts";
import { setColorEnabled } from "../../src/cli/output.ts";

const FIXTURES = resolve(import.meta.dir, "..", "fixtures");
const FORMATS = resolve(import.meta.dir, "..", "..", "formats");

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

describe("praxis formats validate — success cases", () => {
  test("returns 0 and reports success for a valid production format", () => {
    const code = validateCommand({
      filePath: resolve(FORMATS, "executive-pre-read.yaml"),
    });
    expect(code).toBe(0);
    expect(stdout()).toContain("Valid format: executive-pre-read");
    expect(stdout()).toContain("v1.0.0");
    expect(stderr()).toBe("");
  });

  test("returns 0 for the mckinsey format", () => {
    const code = validateCommand({
      filePath: resolve(FORMATS, "mckinsey-style-note.yaml"),
    });
    expect(code).toBe(0);
    expect(stdout()).toContain("mckinsey-style-note");
  });

  test("returns 0 for the position paper format", () => {
    const code = validateCommand({
      filePath: resolve(FORMATS, "position-paper-corporate.yaml"),
    });
    expect(code).toBe(0);
    expect(stdout()).toContain("position-paper-corporate");
  });

  test("returns 0 for the valid fixture", () => {
    const code = validateCommand({
      filePath: resolve(FIXTURES, "valid-format.yaml"),
    });
    expect(code).toBe(0);
    expect(stdout()).toContain("Valid format: sample-format");
  });
});

describe("praxis formats validate — failure cases", () => {
  test("returns 1 and lists issues for invalid-missing-field.yaml", () => {
    const code = validateCommand({
      filePath: resolve(FIXTURES, "invalid-missing-field.yaml"),
    });
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("Validation failed");
    expect(err).toContain("sections[0].max_length");
    expect(err).toContain("is required");
  });

  test("returns 1 for invalid-bad-enum.yaml with multiple issues", () => {
    const code = validateCommand({
      filePath: resolve(FIXTURES, "invalid-bad-enum.yaml"),
    });
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("metadata.organization_style");
    expect(err).toContain("sourcing_policy");
    expect(err).toContain("output_targets[0]");
  });

  test("returns 1 for a missing file", () => {
    const code = validateCommand({
      filePath: resolve(FIXTURES, "does-not-exist.yaml"),
    });
    expect(code).toBe(1);
    expect(stderr()).toContain("not found");
  });

  test("returns 1 for a YAML syntax error", () => {
    const tmp = require("node:os").tmpdir();
    const path = require("node:path").join(tmp, "praxis-syntax.yaml");
    require("node:fs").writeFileSync(path, "id: sample\n  bad_indent: 1\n");
    try {
      const code = validateCommand({ filePath: path });
      expect(code).toBe(1);
      expect(stderr()).toContain("YAML syntax error");
    } finally {
      require("node:fs").rmSync(path, { force: true });
    }
  });

  test("returns 1 for invalid-bad-semver.yaml", () => {
    const code = validateCommand({
      filePath: resolve(FIXTURES, "invalid-bad-semver.yaml"),
    });
    expect(code).toBe(1);
    expect(stderr()).toContain("version");
    expect(stderr()).toContain("SemVer");
  });

  test("returns 1 for invalid-duplicate-section-id.yaml", () => {
    const code = validateCommand({
      filePath: resolve(FIXTURES, "invalid-duplicate-section-id.yaml"),
    });
    expect(code).toBe(1);
    expect(stderr()).toContain("duplicate");
  });
});
