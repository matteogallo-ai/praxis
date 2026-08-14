import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { loadFormatFile, loadFormatFromSource } from "../../src/registry/loader.ts";
import {
  FileNotFoundError,
  ValidationError,
  YamlSyntaxError,
} from "../../src/registry/errors.ts";

const FIXTURES = resolve(import.meta.dir, "..", "fixtures");
const FORMATS = resolve(import.meta.dir, "..", "..", "formats");

describe("loadFormatFile", () => {
  test("loads and validates a real production format", () => {
    const format = loadFormatFile(resolve(FORMATS, "executive-pre-read.yaml"));
    expect(format.id).toBe("executive-pre-read");
    expect(format.metadata.organization_style).toBe("generic");
  });

  test("loads the valid fixture", () => {
    const format = loadFormatFile(resolve(FIXTURES, "valid-format.yaml"));
    expect(format.id).toBe("sample-format");
    expect(format.sections.map((s) => s.id)).toEqual(["context", "recommendation"]);
  });

  test("throws FileNotFoundError for a missing path", () => {
    expect(() => loadFormatFile(resolve(FIXTURES, "does-not-exist.yaml"))).toThrow(
      FileNotFoundError
    );
  });

  test("wraps YAML syntax errors as YamlSyntaxError", () => {
    // Anchors are unsupported by the vendored parser.
    const bad = "id: &anchor sample\nname: Sample\n";
    expect(() => loadFormatFromSource(bad, "inline.yaml")).toThrow(YamlSyntaxError);
  });

  test("YamlSyntaxError carries the line number and label", () => {
    const bad = "id: sample\n  bad_indent: 1\n";
    let caught: unknown;
    try {
      loadFormatFromSource(bad, "inline.yaml");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(YamlSyntaxError);
    const err = caught as YamlSyntaxError;
    expect(err.line).toBeGreaterThan(0);
    expect(err.source).toBe("inline.yaml");
  });

  test("throws ValidationError for the missing-field fixture", () => {
    expect(() => loadFormatFile(resolve(FIXTURES, "invalid-missing-field.yaml"))).toThrow(
      ValidationError
    );
  });

  test("throws ValidationError for the bad-enum fixture", () => {
    expect(() => loadFormatFile(resolve(FIXTURES, "invalid-bad-enum.yaml"))).toThrow(
      ValidationError
    );
  });

  test("throws ValidationError for the duplicate-section-id fixture", () => {
    let caught: unknown;
    try {
      loadFormatFile(resolve(FIXTURES, "invalid-duplicate-section-id.yaml"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const err = caught as ValidationError;
    expect(err.issues.some((i) => i.message.includes("duplicate"))).toBe(true);
  });

  test("throws ValidationError for the bad-semver fixture", () => {
    let caught: unknown;
    try {
      loadFormatFile(resolve(FIXTURES, "invalid-bad-semver.yaml"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).issues.some((i) => i.path === "version")).toBe(true);
  });

  test("throws ValidationError for the bad-date fixture", () => {
    let caught: unknown;
    try {
      loadFormatFile(resolve(FIXTURES, "invalid-bad-date.yaml"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(
      (caught as ValidationError).issues.some((i) => i.path === "metadata.last_reviewed")
    ).toBe(true);
  });

  test("throws ValidationError for an unknown top-level key (strict-by-default)", () => {
    let caught: unknown;
    try {
      loadFormatFile(resolve(FIXTURES, "invalid-extra-key.yaml"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(
      (caught as ValidationError).issues.some((i) => i.message.includes("unknown key"))
    ).toBe(true);
  });

  test("throws ValidationError for non-positive integers", () => {
    let caught: unknown;
    try {
      loadFormatFile(resolve(FIXTURES, "invalid-non-positive-int.yaml"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const issues = (caught as ValidationError).issues;
    expect(issues.some((i) => i.path === "target_length.pages")).toBe(true);
    expect(issues.some((i) => i.path === "target_length.words")).toBe(true);
  });

  test("throws ValidationError for a non-kebab-case id", () => {
    let caught: unknown;
    try {
      loadFormatFile(resolve(FIXTURES, "invalid-not-kebab-case.yaml"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const issues = (caught as ValidationError).issues;
    expect(issues.some((i) => i.path === "id" && i.message.includes("kebab-case"))).toBe(true);
    expect(
      issues.some((i) => i.path === "sections[0].id" && i.message.includes("kebab-case"))
    ).toBe(true);
  });
});
