/**
 * The checks `.github/settings/ruleset-main.json` requires on `main` must be
 * jobs the workflows declare. A job renamed without the ruleset leaves every
 * pull request waiting for a check that never reports; a job missing from the
 * ruleset is not required.
 *
 * The workflows are read line by line (two-space YAML, as written here): the
 * repository's YAML parser has no flow sequences, which the matrices use.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

/** Every workflow a pull request triggers: their jobs are the checks a merge waits for. */
const WORKFLOWS = readdirSync(".github/workflows")
  .filter((f) => f.endsWith(".yml"))
  .map((f) => readFileSync(`.github/workflows/${f}`, "utf-8"))
  .filter((yaml) => /^ {2}pull_request:/m.test(yaml));

/** The check names a workflow reports: one per job, one per matrix value. */
function checkNames(yaml: string): string[] {
  const names: string[] = [];
  const jobs = yaml.split(/^jobs:\n/m)[1] ?? "";
  for (const block of jobs.split(/^(?= {2}[\w-]+:\n)/m)) {
    const id = /^ {2}([\w-]+):\n/.exec(block)?.[1];
    if (id === undefined) continue;
    // A job without a name reports under its id.
    const name = (/^ {4}name: (.+)$/m.exec(block)?.[1] ?? id).replace(/^(["'])(.*)\1$/, "$2");
    const variable = /\$\{\{ matrix\.(\w+) \}\}/.exec(name);
    if (variable === null) {
      names.push(name);
      continue;
    }
    const values = new RegExp(`^ +${variable[1]}: \\[(.*)\\]$`, "m").exec(block)?.[1] ?? "";
    for (const value of values.split(",")) {
      names.push(name.replace(variable[0], value.trim().replace(/^"|"$/g, "")));
    }
  }
  return names;
}

const declared = WORKFLOWS.flatMap(checkNames);
const ruleset = JSON.parse(readFileSync(".github/settings/ruleset-main.json", "utf-8")) as {
  rules: {
    type: string;
    parameters?: { required_status_checks?: { context: string; integration_id?: number }[] };
  }[];
};
const requiredChecks = ruleset.rules.flatMap((r) =>
  r.type === "required_status_checks" ? (r.parameters?.required_status_checks ?? []) : []
);

/**
 * GitHub code scanning (app 57789) reports one result check per tool, which
 * fails on a new alert while the job that uploaded the results still passes.
 * Each is required only if a pull-request workflow runs that tool.
 */
const CODE_SCANNING_APP = 57789;
const CODE_SCANNING_TOOLS: Record<string, RegExp> = {
  CodeQL: /uses: github\/codeql-action\/analyze@/,
  "osv-scanner": /uses: google\/osv-scanner-action\/\.github\/workflows\/osv-scanner-reusable\.yml@/,
};
const scanned = Object.keys(CODE_SCANNING_TOOLS).filter((tool) =>
  WORKFLOWS.some((yaml) => CODE_SCANNING_TOOLS[tool]?.test(yaml))
);
const required = requiredChecks.filter((c) => c.integration_id !== CODE_SCANNING_APP).map((c) => c.context);
const requiredScans = requiredChecks.filter((c) => c.integration_id === CODE_SCANNING_APP).map((c) => c.context);

describe("required checks on main", () => {
  test("the pull-request workflows are read", () => {
    expect(declared).toContain("typecheck · test");
    expect(declared).toContain("CodeQL (actions)");
    expect(declared).toContain("test · wall clock at 2040-06-01T00:00:00Z");
  });

  test("every required check is a declared job", () => {
    // A reusable workflow's check is "<caller job name> / <called job id>".
    const unknown = required.filter((c) => !declared.some((n) => c === n || c.startsWith(`${n} / `)));
    expect(unknown).toEqual([]);
  });

  test("every pull-request job is required", () => {
    const missing = declared.filter((n) => !required.some((c) => c === n || c.startsWith(`${n} / `)));
    expect(missing).toEqual([]);
  });

  test("the code-scanning result of every tool a pull request runs is required, and nothing else from that app", () => {
    expect(scanned).toEqual(["CodeQL", "osv-scanner"]);
    expect([...requiredScans].sort()).toEqual([...scanned].sort());
  });
});
