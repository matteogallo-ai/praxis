/**
 * docs/THREAT_MODEL.md proves each mitigation with a test. Every test file
 * it names must exist, and every quoted name under a "Tests:" heading must be
 * the title (or part of the title) of a test or describe block in the file
 * cited in the same bullet.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const doc = readFileSync("docs/THREAT_MODEL.md", "utf-8");

function titlesIn(file: string): string[] {
  return [...readFileSync(file, "utf-8").matchAll(/(?:test|describe)(?:\.each\([^)]*\))?\(\s*"([^"]+)"/g)].map(
    (m) => m[1] ?? ""
  );
}

const fileIn = (text: string) => text.match(/`(tests\/[\w/.-]+\.test\.ts)`/)?.[1];

/**
 * Each bullet of a "Tests:" paragraph: its test file and the names quoted
 * after it, wrapped lines joined. A file on the "Tests:" line itself applies
 * to the bullets that name none.
 */
const citations = doc
  .split(/^Tests:/m)
  .slice(1)
  .flatMap((block) => {
    const [head = "", ...bullets] = (block.split(/^Remaining:/m)[0] ?? "").split(/^- /m);
    return bullets.map((raw) => {
      const bullet = raw.replace(/\s*\n\s*/g, " ");
      return {
        file: fileIn(bullet) ?? fileIn(head) ?? "",
        names: [...bullet.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? ""),
      };
    });
  });

describe("docs/THREAT_MODEL.md", () => {
  test("cites tests by name", () => {
    expect(citations.flatMap((c) => c.names).length).toBeGreaterThan(20);
  });

  test("every cited test file exists", () => {
    const paths = [...doc.matchAll(/`(tests\/[\w/.-]+\.test\.ts)`/g)].map((m) => m[1] ?? "");
    expect(paths.filter((p) => !existsSync(p))).toEqual([]);
  });

  test("every bullet that quotes test names says which file holds them", () => {
    expect(citations.filter((c) => c.file === "" && c.names.length > 0).map((c) => c.names)).toEqual([]);
  });

  test("every cited name is a test or describe title in the file cited with it", () => {
    const missing = citations.flatMap(({ file, names }) => {
      const titles = existsSync(file) ? titlesIn(file) : [];
      return names.filter((name) => !titles.some((t) => t.includes(name))).map((name) => `${file}: ${name}`);
    });
    expect(missing).toEqual([]);
  });
});
