/**
 * Fails when shipped code or docs talk about sprints, the future, or untracked
 * TODOs (rule 2 of docs/ENGINEERING_STANDARDS.md). Such text goes stale the
 * moment it is merged, and readers take it as a statement about the code.
 *
 * Scanned: src/, prompts/, docs/, formats/, README.md, benchmarks/RESULTS.md.
 * Excluded: docs/ENGINEERING_STANDARDS.md (quotes the patterns as examples) and
 * CHANGELOG.md (history is its job).
 *
 * Code comments in every .ts file under src/, tests/, benchmarks/ and
 * scripts/ are also checked for release numbers ("added in v0.8"): a comment
 * says why, never when (CLAUDE.md rule 6), and git log holds the history.
 * Only that rule applies to tests/, benchmarks/ and scripts/, whose string
 * fixtures quote stale prose on purpose.
 *
 * What it does NOT check: future tense phrased in ways no pattern covers,
 * version numbers hard-coded in prose, or whether a statement is true. Those
 * stay with human review (rule 10).
 *
 * Usage: bun run scripts/check-stale-narrative.ts [--root <path>]
 * Output: one `file:line: kind: excerpt` per finding; exit 1 when any exist.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export type FindingKind = "future" | "sprint" | "todo-without-issue" | "version-history";

export interface Finding {
  file: string;
  line: number;
  kind: FindingKind;
  excerpt: string;
}

const VERSION = String.raw`v?\d+(?:\.(?:\d+|x))*\+?`;

const PATTERNS: ReadonlyArray<{ kind: FindingKind; regex: RegExp }> = [
  { kind: "future", regex: /\bimplementations? (?:is |are )?coming\b/i },
  {
    kind: "future",
    regex: new RegExp(
      String.raw`\b(?:coming|lands?|landing|planned|scheduled|deferred|due|ships?|shipping)\s+(?:in|to|for)\s+(?:a\s+)?(?:post-)?(?:${VERSION}|S\d)`,
      "i"
    ),
  },
  { kind: "future", regex: /\bpost-v\d+(?:\.\d+)*/i },
  {
    kind: "future",
    regex: /\bwill be (?:published|added|implemented|released|supported|available)\b/i,
  },
  // Only verbs about the project's own future: "the call will fail" describes
  // runtime behaviour and is not stale.
  {
    kind: "future",
    regex: /\bwill (?:add|support|ship|implement|introduce|provide|allow|enable)\b/i,
  },
  { kind: "future", regex: /\bcoming soon\b|\bplanned for\b/i },
  { kind: "future", regex: /\bstill on the roadmap\b/i },
  { kind: "future", regex: /\bfuture releases?\b|\b(?:a|the) later release\b/i },
  { kind: "future", regex: /\blater \w+(?: \w+)? (?:pass|release|version) will\b/i },
  { kind: "future", regex: /\bwe will\b/i },
  { kind: "future", regex: /\bv\d+(?:\.\d+)*\b[^.]*\bwill\b/ },
  { kind: "sprint", regex: /\bsprints?\b/i },
  { kind: "sprint", regex: /(?<![\w/.])S[0-7]\.\d+\b/ },
  // "RISK-XXX" in a prompt is an id placeholder, not a marker.
  { kind: "todo-without-issue", regex: /(?<!-)\b(?:TODO|FIXME|XXX)\b(?!\s*\(#\d+\))/ },
];

// A line that is a comment, or ends in one. `//` must follow whitespace or
// start the line, so a URL's `https://` does not open a comment.
const COMMENT = /^\s*(?:\/\/|\/\*|\*)|(?:^|\s)\/\/\s/;
const RELEASE_NUMBER = /\bv\d+\.\d+/;

function isVersionHistory(file: string, line: string): boolean {
  if (!file.endsWith(".ts") || !COMMENT.test(line)) return false;
  return RELEASE_NUMBER.test(line.replace(/https?:\/\/\S+/g, ""));
}

/**
 * Scans one file's text. Reports at most one finding per line, using the first
 * matching pattern, so one stale sentence yields one actionable line of output.
 */
export function scanText(file: string, text: string, { prose = true }: { prose?: boolean } = {}): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = prose ? PATTERNS.find(({ regex }) => regex.test(line)) : undefined;
    const kind = match?.kind ?? (isVersionHistory(file, line) ? "version-history" : undefined);
    if (kind) findings.push({ file, line: i + 1, kind, excerpt: line.trim() });
  }
  return findings;
}

const ROOTS = ["src", "prompts", "docs", "formats", "README.md", "benchmarks/RESULTS.md"];
const CODE_ROOTS = ["src", "tests", "benchmarks", "scripts"];
const EXCLUDED = new Set(["docs/ENGINEERING_STANDARDS.md", "CHANGELOG.md"]);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* walk(path);
    } else {
      yield path;
    }
  }
}

async function listTargets(repoRoot: string, roots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    const abs = join(repoRoot, root);
    const info = await stat(abs).catch(() => null);
    if (info === null) continue;
    if (info.isDirectory()) {
      for await (const f of walk(abs)) files.push(f);
    } else {
      files.push(abs);
    }
  }
  return files
    .map((f) => relative(repoRoot, f).split(sep).join("/"))
    .filter((f) => !EXCLUDED.has(f))
    .sort();
}

/** Scans the repository and returns every finding, sorted by path. */
export async function scanRepository(repoRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const proseFiles = await listTargets(repoRoot, ROOTS);
  for (const file of proseFiles) {
    findings.push(...scanText(file, await readFile(join(repoRoot, file), "utf8")));
  }
  const prose = new Set(proseFiles);
  for (const file of await listTargets(repoRoot, CODE_ROOTS)) {
    if (prose.has(file) || !file.endsWith(".ts")) continue;
    findings.push(...scanText(file, await readFile(join(repoRoot, file), "utf8"), { prose: false }));
  }
  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}

if (import.meta.main) {
  const rootFlag = process.argv.indexOf("--root");
  const root =
    rootFlag === -1
      ? join(import.meta.dir, "..")
      : resolve(process.argv[rootFlag + 1] ?? ".");
  const findings = await scanRepository(root);
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.kind}: ${f.excerpt}`);
  if (findings.length > 0) {
    console.error(`\n${findings.length} stale-narrative finding(s).`);
    process.exit(1);
  }
  console.log("stale-narrative: clean");
}
