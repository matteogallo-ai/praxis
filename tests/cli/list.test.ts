import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listCommand, parseOrgStyleFlag } from "../../src/cli/commands/list.ts";
import { setColorEnabled } from "../../src/cli/output.ts";

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

describe("praxis formats list", () => {
  test("prints a table with all shipped formats", () => {
    const code = listCommand({ formatsDir: FORMATS });
    expect(code).toBe(0);
    const out = output();
    expect(out).toContain("executive-pre-read");
    expect(out).toContain("mckinsey-style-note");
    expect(out).toContain("position-paper-corporate");
    expect(out).toContain("family-office-memo");
    expect(out).toContain("4 formats registered");
  });

  test("table header lists the six expected columns", () => {
    listCommand({ formatsDir: FORMATS });
    const out = output();
    for (const col of ["ID", "Name", "Org Style", "Language", "Pages", "Version"]) {
      expect(out).toContain(col);
    }
  });

  test("filters by --org-style mckinsey", () => {
    const code = listCommand({ formatsDir: FORMATS, orgStyle: "mckinsey" });
    expect(code).toBe(0);
    const out = output();
    expect(out).toContain("mckinsey-style-note");
    expect(out).not.toContain("executive-pre-read");
    expect(out).toContain("1 format registered");
  });

  test("prints a helpful message when the filter matches nothing", () => {
    const code = listCommand({ formatsDir: FORMATS, orgStyle: "bcg" });
    expect(code).toBe(0);
    expect(output()).toContain("No formats registered");
  });

  test("prints a helpful message when the directory is empty", () => {
    const empty = mkdtempSync(join(tmpdir(), "praxis-empty-"));
    try {
      const code = listCommand({ formatsDir: empty });
      expect(code).toBe(0);
      expect(output()).toContain("No formats registered");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("parseOrgStyleFlag", () => {
  test("returns null when --org-style is absent", () => {
    expect(parseOrgStyleFlag([])).toBeNull();
    expect(parseOrgStyleFlag(["--other", "x"])).toBeNull();
  });

  test("extracts a valid org style value", () => {
    expect(parseOrgStyleFlag(["--org-style", "mckinsey"])).toBe("mckinsey");
  });

  test("throws when value is missing", () => {
    expect(() => parseOrgStyleFlag(["--org-style"])).toThrow(/requires a value/);
  });

  test("throws when value is unknown", () => {
    expect(() => parseOrgStyleFlag(["--org-style", "deloitte"])).toThrow(
      /must be one of/
    );
  });
});
