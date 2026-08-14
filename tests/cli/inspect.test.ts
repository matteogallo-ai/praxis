import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { inspectCommand } from "../../src/cli/commands/inspect.ts";
import { setColorEnabled } from "../../src/cli/output.ts";
import { FormatNotFoundError } from "../../src/registry/errors.ts";

const FORMATS = resolve(import.meta.dir, "..", "..", "formats");

let stdoutBuf: string[];
let originalWrite: typeof process.stdout.write;

beforeEach(() => {
  setColorEnabled(false);
  stdoutBuf = [];
  originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown): boolean => {
    stdoutBuf.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

function output(): string {
  return stdoutBuf.join("");
}

describe("praxis formats inspect", () => {
  test("prints the full format tree for executive-pre-read", () => {
    const code = inspectCommand({ formatsDir: FORMATS, id: "executive-pre-read" });
    expect(code).toBe(0);
    const out = output();
    expect(out).toContain("Executive Pre-Read");
    expect(out).toContain("executive-pre-read");
    expect(out).toContain("v1.0.0");
    expect(out).toContain("Metadata");
    expect(out).toContain("Target Length");
    expect(out).toContain("Sections");
    expect(out).toContain("Style Guide");
    expect(out).toContain("Sourcing & Output");
    expect(out).toContain("Recommendation");
    expect(out).toContain("must_state_recommendation_in_first_sentence");
  });

  test("prints the full format tree for position-paper-corporate", () => {
    const code = inspectCommand({
      formatsDir: FORMATS,
      id: "position-paper-corporate",
    });
    expect(code).toBe(0);
    const out = output();
    expect(out).toContain("Corporate Affairs Position Paper");
    expect(out).toContain("Issue Framing");
    expect(out).toContain("Our Position");
    expect(out).toContain("must_state_position_explicitly");
  });

  test("prints the full format tree for mckinsey-style-note", () => {
    const code = inspectCommand({
      formatsDir: FORMATS,
      id: "mckinsey-style-note",
    });
    expect(code).toBe(0);
    const out = output();
    expect(out).toContain("McKinsey-Style Note");
    expect(out).toContain("Situation");
    expect(out).toContain("Complication");
    expect(out).toContain("Supporting Arguments");
    expect(out).toContain("argument_count_exactly: 3");
    expect(out).toContain("synergy");
  });

  test("throws FormatNotFoundError for an unknown id", () => {
    expect(() =>
      inspectCommand({ formatsDir: FORMATS, id: "does-not-exist" })
    ).toThrow(FormatNotFoundError);
  });
});
