/**
 * Properties of the CLI's argument boundary: `stripVerbosityFlags`,
 * `extractRunArgs` (the run-control flags), `parseBriefArgs` (the briefing
 * flags) and `resumeArgs` (what a resumed run is parsed from). Any argument
 * list must parse or come back as an error message; none may throw.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";

import { parseBriefArgs } from "../../src/cli/commands/brief.ts";
import { stripVerbosityFlags } from "../../src/cli/index.ts";
import { getVerbosity } from "../../src/cli/output.ts";
import { extractRunArgs, resumeArgs } from "../../src/cli/run-args.ts";
import { CheckpointStore } from "../../src/orchestrator/checkpoint.ts";

const RUN_FLAGS = ["--resume", "--runs-dir", "--max-cost-usd", "--price-table"];
const BRIEF_VALUE_FLAGS = ["--format", "--provider", "--output", "--render", "--theme"];
const BRIEF_BOOLEAN_FLAGS = [
  "--json",
  "--with-research",
  "--with-stakeholders",
  "--with-risks",
  "--sourcing-report",
  "--full",
  "--critique",
  "--with-rerun",
  "--include-toc",
  "--include-appendices",
  "--with-sourcing-report",
];

/** A value a user may type after a flag: anything but another flag. */
const value = fc.string({ minLength: 1 }).filter((s) => !s.startsWith("--"));

/** An argument list mixing known flags, their values and free words. */
const argv = fc.array(
  fc.oneof(
    fc.constantFrom(
      ...RUN_FLAGS,
      ...BRIEF_VALUE_FLAGS,
      ...BRIEF_BOOLEAN_FLAGS,
      "--on-sourcing-failure",
      "--verbose",
      "--quiet",
      "-v",
      "-q",
      "abort",
      "degrade"
    ),
    fc.constantFrom("--on-sourcing-failure=abort", "--on-sourcing-failure=degrade", "--on-sourcing-failure=x"),
    fc.string(),
    fc.tuple(fc.constantFrom(...RUN_FLAGS, ...BRIEF_VALUE_FLAGS), fc.string()).map(([f, v]) => `${f}=${v}`)
  ),
  { maxLength: 12 }
);

const root = mkdtempSync(join(tmpdir(), "praxis-cli-prop-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("stripVerbosityFlags — properties", () => {
  test("only --verbose and --quiet are verbosity flags, and the last one given wins", () => {
    fc.assert(
      fc.property(argv, (args) => {
        const rest = stripVerbosityFlags(args);
        expect(rest).toEqual(args.filter((a) => a !== "--verbose" && a !== "--quiet"));
        const last = [...args].reverse().find((a) => a === "--verbose" || a === "--quiet");
        expect(getVerbosity()).toBe(last === undefined ? "normal" : last === "--verbose" ? "verbose" : "quiet");
      })
    );
    stripVerbosityFlags([]);
  });
});

describe("extractRunArgs — properties", () => {
  test("never throws, and what it leaves holds no run flag", () => {
    fc.assert(
      fc.property(argv, (args) => {
        const out = extractRunArgs(args);
        if ("rest" in out) {
          expect(out.rest.some((a) => RUN_FLAGS.some((f) => a === f || a.startsWith(`${f}=`)))).toBe(false);
        } else {
          expect(out.error.length).toBeGreaterThan(0);
        }
      })
    );
  });

  test("words that are not run flags pass through in order", () => {
    const word = fc.string().filter((s) => !RUN_FLAGS.some((f) => s === f || s.startsWith(`${f}=`)));
    fc.assert(
      fc.property(fc.array(word, { maxLength: 8 }), (args) => {
        const out = extractRunArgs(args);
        expect("rest" in out && out.rest).toEqual(args);
      })
    );
  });

  test("--max-cost-usd is accepted exactly when it is a positive plain decimal, in either spelling", () => {
    const amount = fc.oneof(
      fc.double({ noNaN: false }).map(String),
      fc.string({ minLength: 1 }),
      fc.stringMatching(/^\d{1,4}(\.\d{1,3})?$/),
      fc.constantFrom("0", "-1", "Infinity", "1e400", "0x10", "1e3", "0.01", "5")
    );
    fc.assert(
      fc.property(amount, fc.boolean(), (v, joined) => {
        const out = extractRunArgs(joined ? [`--max-cost-usd=${v}`] : ["--max-cost-usd", v]);
        const n = Number(v);
        const valid = /^\d+(\.\d+)?$/.test(v) && Number.isFinite(n) && n > 0;
        expect("run" in out ? out.run.maxCostUsd : null).toBe(valid ? n : null);
      })
    );
  });
});

describe("parseBriefArgs — properties", () => {
  test("never throws: a result has an error or exactly one question", () => {
    fc.assert(
      fc.property(argv, (args) => {
        const out = parseBriefArgs(args);
        if (out.error === undefined) {
          const words = args.filter((a) => a === out.question);
          expect(words.length).toBeGreaterThan(0);
        } else {
          expect(out.error.length).toBeGreaterThan(0);
        }
      })
    );
  });

  test("--flag=value and --flag value mean the same", () => {
    fc.assert(
      fc.property(value, fc.constantFrom(...BRIEF_VALUE_FLAGS), value, (question, flag, v) => {
        const spaced = parseBriefArgs([question, "--format", "f", flag, v]);
        const joined = parseBriefArgs([question, "--format", "f", `${flag}=${v}`]);
        expect(joined).toEqual(spaced);
      })
    );
  });

  test("the order of flags does not matter", () => {
    const flags = fc.uniqueArray(
      fc.oneof(
        fc.constantFrom(...BRIEF_BOOLEAN_FLAGS).map((f) => [f]),
        fc.tuple(fc.constantFrom(...BRIEF_VALUE_FLAGS), value).map(([f, v]) => [f, v])
      ),
      { selector: (pair) => pair[0], maxLength: 8 }
    );
    const reordered = flags.chain((pairs) =>
      fc
        .shuffledSubarray(pairs, { minLength: pairs.length, maxLength: pairs.length })
        .map((shuffled) => ({ pairs, shuffled }))
    );
    fc.assert(
      fc.property(value, reordered, (question, { pairs, shuffled }) => {
        expect(parseBriefArgs([...shuffled.flat(), question])).toEqual(parseBriefArgs([question, ...pairs.flat()]));
      })
    );
  });
});

describe("resumeArgs — properties", () => {
  test("a resumed run parses to the recorded question and format, with --full", () => {
    fc.assert(
      fc.property(
        value,
        value.filter((s) => !s.includes("=")),
        fc.subarray(BRIEF_BOOLEAN_FLAGS),
        (question, formatId, extra) => {
          const store = CheckpointStore.create(join(root, "runs"), question, formatId, new Date(0));
          const args = resumeArgs(extra, store);
          expect(Array.isArray(args)).toBe(true);
          const parsed = parseBriefArgs(args as string[]);
          expect(parsed.error).toBeUndefined();
          expect(parsed.question).toBe(question);
          expect(parsed.formatId).toBe(formatId);
          expect(parsed.full).toBe(true);
        }
      )
    );
  });

  test("a different question or format given again is refused", () => {
    fc.assert(
      fc.property(value, value, value, (question, other, formatId) => {
        fc.pre(other !== question);
        const store = CheckpointStore.create(join(root, "runs"), question, formatId, new Date(0));
        expect(resumeArgs([other], store)).toHaveProperty("error");
        expect(resumeArgs(["--format", `${formatId}x`], store)).toHaveProperty("error");
      })
    );
  });
});

describe("resumeArgs — a format id containing '='", () => {
  test("--format=<id> is compared whole", () => {
    const store = CheckpointStore.create(join(root, "runs"), "q", "a=b", new Date(0));
    expect(resumeArgs(["--format=a=b"], store)).toEqual(["q", "--format=a=b", "--full"]);
  });
});
