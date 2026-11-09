/**
 * The first lines a visitor reads (README opening, Roadmap, ROADMAP.md's
 * status) agree with docs/CLAIMS.md and use plain English, so a page linked
 * from outside does not contradict the status the repository states.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf-8");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("README opening", () => {
  test("its first sentence says what Praxis does in at most 20 words", () => {
    const body = readme.split("\n").filter((l) => l.trim() !== "" && !/^#|^\[!\[/.test(l));
    const first = flat(body.join(" ")).split(/(?<=\.) /)[0] ?? "";
    expect(first.split(" ").length).toBeLessThanOrEqual(20);
    expect(first).toContain("briefing");
  });
});

describe("README Roadmap", () => {
  test("the live-briefing bullet names what is still missing, as CLAIMS C14 does", () => {
    const c14 = readFileSync("docs/CLAIMS.md", "utf-8").split("\n").find((l) => l.startsWith("| C14 |")) ?? "";
    expect(c14).toContain("question 02 failed in synthesis (4 Nov 2026)");
    const bullet = readme.split("\n").find((l) => l.startsWith("- ") && l.includes("(C14)")) ?? "";
    expect(bullet).toContain("All five protocol questions completing live");
    expect(bullet).toContain("02 failed in synthesis, 4 Nov 2026");
    expect(bullet).not.toMatch(/Live briefings that complete/);
  });
});

describe("ROADMAP.md status", () => {
  test("points to the maintained status instead of restating a dated one", () => {
    const status = /^## Project status[^\n]*\n([\s\S]*?)\n## /m.exec(readFileSync("ROADMAP.md", "utf-8"))?.[0] ?? "";
    expect(status).toContain("README.md#status");
    expect(status).toContain("docs/SYSTEM_CARD.md");
    expect(status).not.toMatch(/under repair|has never completed|had never completed a briefing against a real model:/);
  });
});

describe("plain English", () => {
  const FILES = [
    "README.md",
    "docs/CLAIMS.md",
    "docs/SYSTEM_CARD.md",
    "docs/adr/0003-source-trust-criteria.md",
    "docs/live-proof-protocol.md",
    "benchmarks/outputs/live/README.md",
  ];
  for (const file of FILES) {
    test(`${file} has no French calque for "separately"`, () => {
      expect(flat(readFileSync(file, "utf-8"))).not.toMatch(/\b(?:counted|listed|lists them|counts them|fixed) apart\b/);
    });
  }
});
