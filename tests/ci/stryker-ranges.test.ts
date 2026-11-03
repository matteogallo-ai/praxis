/**
 * `stryker.config.json` names line ranges, which drift as soon as code is
 * added above them: a range then mutates the tail of one function and stops
 * inside another, and the recorded score silently covers other code. Each
 * range must start a top-level declaration after a blank line and end on a
 * top-level closing brace.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("stryker.config.json", "utf-8")) as { mutate: string[] };

describe("stryker.config.json mutate ranges", () => {
  const ranged = config.mutate.filter((m) => /:\d+-\d+$/.test(m));

  test("there are ranges to check", () => {
    expect(ranged.length).toBeGreaterThan(0);
  });

  for (const entry of ranged) {
    test(`${entry} starts and ends on top-level boundaries`, () => {
      const [, file, from, to] = entry.match(/^(.+):(\d+)-(\d+)$/) as RegExpMatchArray;
      const lines = readFileSync(file as string, "utf-8").split("\n");
      const first = Number(from) - 1;
      const last = Number(to) - 1;
      expect(lines[first - 1]).toBe("");
      expect(lines[first]).toMatch(/^(\/\/|\/\*\*|const |function |export )/);
      expect(lines[last]).toBe("}");
    });
  }
});
