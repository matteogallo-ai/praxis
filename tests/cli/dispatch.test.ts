import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { run } from "../../src/cli/index.ts";
import { setColorEnabled } from "../../src/cli/output.ts";

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

describe("praxis dispatch", () => {
  test("`praxis version` prints praxis v0.5.0 and returns 0", async () => {
    const code = await run(["version"]);
    expect(code).toBe(0);
    expect(stdout()).toBe("praxis v0.5.0\n");
  });

  test("`praxis --version` short-form works", async () => {
    const code = await run(["--version"]);
    expect(code).toBe(0);
    expect(stdout()).toContain("praxis v0.5.0");
  });

  test("no arguments prints help and returns 0", async () => {
    const code = await run([]);
    expect(code).toBe(0);
    expect(stdout()).toContain("Usage:");
    expect(stdout()).toContain("praxis formats list");
  });

  test("help mentions the new brief command", async () => {
    const code = await run(["help"]);
    expect(code).toBe(0);
    expect(stdout()).toContain("praxis brief");
    expect(stdout()).toContain("v0.6+");
  });

  test("`praxis help` prints help and returns 0", async () => {
    const code = await run(["help"]);
    expect(code).toBe(0);
    expect(stdout()).toContain("Usage:");
  });

  test("unknown top-level command returns 1", async () => {
    const code = await run(["do-something"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Unknown command");
  });

  test("`praxis formats` without subcommand returns 1", async () => {
    const code = await run(["formats"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Usage:");
  });

  test("unknown formats subcommand returns 1", async () => {
    const code = await run(["formats", "banana"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Unknown formats subcommand");
  });

  test("`praxis formats inspect` without id returns 1", async () => {
    const code = await run(["formats", "inspect"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Missing argument");
  });

  test("`praxis formats validate` without path returns 1", async () => {
    const code = await run(["formats", "validate"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Missing argument");
  });

  test("`praxis formats list` prints all shipped formats", async () => {
    const code = await run(["formats", "list"]);
    expect(code).toBe(0);
    expect(stdout()).toContain("executive-pre-read");
    expect(stdout()).toContain("position-paper-corporate");
    expect(stdout()).toContain("mckinsey-style-note");
  });

  test("`praxis formats list --org-style mckinsey` filters", async () => {
    const code = await run(["formats", "list", "--org-style", "mckinsey"]);
    expect(code).toBe(0);
    expect(stdout()).toContain("mckinsey-style-note");
    expect(stdout()).not.toContain("executive-pre-read");
  });

  test("`praxis formats list --org-style bogus` returns 1", async () => {
    const code = await run(["formats", "list", "--org-style", "deloitte"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("must be one of");
  });

  test("`praxis formats inspect <unknown>` returns 1", async () => {
    const code = await run(["formats", "inspect", "does-not-exist"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("No format registered");
  });

  test("`praxis brief` with no arguments returns 1", async () => {
    const code = await run(["brief"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing question");
  });
});
