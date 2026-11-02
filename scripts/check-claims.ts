/**
 * Checks docs/CLAIMS.md against the test suite and the README (rule 1 of
 * docs/ENGINEERING_STANDARDS.md).
 *
 * What it verifies:
 * 1. Every row of the claims table has a unique `C<nn>` id and a status of
 *    `shipped` or `roadmap`; every shipped claim lists at least one test.
 * 2. Every listed test file exists. A test is written `path` (the whole file)
 *    or `path::name` (the tests whose full name contains `name`).
 * 3. Unless `--no-run`: each listed test runs on its own and must report at
 *    least one pass and no failure. A skipped or unmatched test is not a pass.
 * 4. In README.md, every bullet of `## Features` cites at least one claim id
 *    and only shipped ones; every bullet of `## Roadmap` cites only roadmap
 *    ones; every claim is cited in the section its status calls for.
 *
 * What it does NOT verify: that a test exercises what its claim says (review
 * does), README text outside those two sections, or the Implementation column.
 *
 * Usage: bun run scripts/check-claims.ts [--no-run]
 * Exit 0 when every check passes, 1 otherwise, one problem per line.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Status = "shipped" | "roadmap";

export interface Claim {
  id: string;
  status: Status;
  tests: string[];
}

const ROW = /^\|\s*(C\d+)\s*\|/;
const TICKED = /`([^`]+)`/g;
const CLAIM_ID = /\bC\d+\b/g;
const BULLET = /^\s*[-*+]\s/;

/** Parses the claims table. Returns the claims and the structural problems. */
export function parseClaims(markdown: string): { claims: Claim[]; problems: string[] } {
  const claims: Claim[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  markdown.split("\n").forEach((line, index) => {
    if (!ROW.test(line)) return;
    const where = `CLAIMS.md:${index + 1}`;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length !== 5) {
      problems.push(`${where}: expected 5 columns, found ${cells.length}`);
      return;
    }
    const [id = "", , , testsCell = "", status = ""] = cells;
    if (seen.has(id)) problems.push(`${where}: duplicate claim id ${id}`);
    seen.add(id);
    if (status !== "shipped" && status !== "roadmap") {
      problems.push(`${where}: ${id} has status '${status}'`);
      return;
    }
    const tests = [...testsCell.matchAll(TICKED)].map((m) => m[1] ?? "");
    if (status === "shipped" && tests.length === 0) {
      problems.push(`${where}: shipped claim ${id} lists no test`);
    }
    claims.push({ id, status, tests });
  });
  if (claims.length === 0 && problems.length === 0) {
    problems.push("CLAIMS.md: no claims table rows found");
  }
  return { claims, problems };
}

/** Lines of the `## <heading>` section, up to the next `## ` heading. */
function section(readme: string, heading: string): string[] | null {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** Returns one message per disagreement between the README and the claims. */
export function checkReadme(readme: string, claims: Claim[]): string[] {
  const status = new Map(claims.map((c) => [c.id, c.status]));
  const problems: string[] = [];
  const cited: Record<Status, Set<string>> = { shipped: new Set(), roadmap: new Set() };
  for (const [heading, expected] of [
    ["Features", "shipped"],
    ["Roadmap", "roadmap"],
  ] as const) {
    const lines = section(readme, heading);
    if (lines === null) {
      problems.push(`README.md: missing '## ${heading}' section`);
      continue;
    }
    for (const line of lines.filter((l) => BULLET.test(l))) {
      const ids = line.match(CLAIM_ID) ?? [];
      if (ids.length === 0) {
        problems.push(`README.md ${heading}: bullet without a claim id: ${line.trim()}`);
      }
      for (const id of ids) {
        cited[expected].add(id);
        const actual = status.get(id);
        if (actual === undefined) problems.push(`README.md ${heading}: unknown claim ${id}`);
        else if (actual !== expected) {
          problems.push(`README.md ${heading}: ${id} is ${actual}, not ${expected}`);
        }
      }
    }
  }
  for (const claim of claims) {
    if (!cited[claim.status].has(claim.id)) {
      const heading = claim.status === "shipped" ? "Features" : "Roadmap";
      problems.push(`README.md ${heading}: ${claim.status} claim ${claim.id} not listed`);
    }
  }
  return problems;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Runs one listed test; it must pass, not merely exist or be skipped. */
async function runListedTest(repoRoot: string, test: string): Promise<string | null> {
  const [file = "", name] = test.split("::", 2);
  const args = [process.execPath, "test", `./${file}`];
  if (name !== undefined) args.push("--test-name-pattern", escapeRegex(name));
  // CI never sets the opt-in, and a claim must not depend on a paid call.
  const env = { ...process.env, PRAXIS_LIVE_TESTS: "" };
  const proc = Bun.spawn(args, { cwd: repoRoot, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = stdout + stderr;
  const passed = Number(/^\s*(\d+) pass/m.exec(output)?.[1] ?? 0);
  if (exitCode !== 0) return `${test}: failed or not found (exit ${exitCode})`;
  if (passed === 0) return `${test}: skipped or matched nothing`;
  return null;
}

export function checkTestFiles(repoRoot: string, claims: Claim[]): string[] {
  return claims.flatMap((claim) =>
    claim.tests
      .filter((t) => !existsSync(join(repoRoot, t.split("::", 1)[0] ?? "")))
      .map((t) => `${claim.id}: test file not found: ${t}`)
  );
}

if (import.meta.main) {
  const repoRoot = join(import.meta.dir, "..");
  const run = !process.argv.includes("--no-run");
  const { claims, problems } = parseClaims(
    await Bun.file(join(repoRoot, "docs", "CLAIMS.md")).text()
  );
  problems.push(...checkReadme(await Bun.file(join(repoRoot, "README.md")).text(), claims));
  problems.push(...checkTestFiles(repoRoot, claims));
  if (run && problems.length === 0) {
    for (const claim of claims.filter((c) => c.status === "shipped")) {
      for (const test of claim.tests) {
        const error = await runListedTest(repoRoot, test);
        console.log(`${error ? "FAIL" : "ok  "}  ${claim.id}  ${test}`);
        if (error) problems.push(`${claim.id}: ${error}`);
      }
    }
  }
  for (const problem of problems) console.error(problem);
  const shipped = claims.filter((c) => c.status === "shipped").length;
  console.log(
    `\n${claims.length} claims (${shipped} shipped, ${claims.length - shipped} roadmap), ` +
      `${problems.length} problem(s)`
  );
  process.exit(problems.length === 0 ? 0 : 1);
}
