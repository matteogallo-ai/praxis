/**
 * docs/THREAT_MODEL.md proves each mitigation with a test. Every test file
 * it names must exist, and every quoted name under a "Tests:" heading must be
 * the title (or part of the title) of a test or describe block.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const doc = readFileSync("docs/THREAT_MODEL.md", "utf-8");

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? testFiles(join(dir, e.name)) : e.name.endsWith(".test.ts") ? [join(dir, e.name)] : []
  );
}

const titles = testFiles("tests").flatMap((f) =>
  [...readFileSync(f, "utf-8").matchAll(/(?:test|describe)(?:\.each\([^)]*\))?\(\s*"([^"]+)"/g)].map((m) => m[1] ?? "")
);

/** Quoted names in the "Tests:" paragraphs, with wrapped lines joined. */
const cited = doc
  .split(/^Tests:/m)
  .slice(1)
  .map((block) => (block.split(/^Remaining:/m)[0] ?? "").replace(/\s*\n\s*/g, " "))
  .flatMap((block) => [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? ""));

describe("docs/THREAT_MODEL.md", () => {
  test("cites tests by name", () => {
    expect(cited.length).toBeGreaterThan(20);
  });

  test("every cited test file exists", () => {
    const paths = [...doc.matchAll(/`(tests\/[\w/.-]+\.test\.ts)`/g)].map((m) => m[1] ?? "");
    expect(paths.filter((p) => !existsSync(p))).toEqual([]);
  });

  test("every cited test name is a real test or describe title", () => {
    expect(cited.filter((name) => !titles.some((t) => t.includes(name)))).toEqual([]);
  });
});
