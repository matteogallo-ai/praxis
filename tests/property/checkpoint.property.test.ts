/**
 * Properties of the checkpoint store (`src/orchestrator/checkpoint.ts`), the
 * boundary where a run's files on disk come back into the pipeline: the run
 * id that `--resume` takes, the `run.json` manifest, and each stage file.
 * Whatever is on disk, a resume either gets well-typed values or a clear
 * `OrchestrationError`; never a raw parser or type error.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";

import { CheckpointStore } from "../../src/orchestrator/checkpoint.ts";
import { OrchestrationError } from "../../src/orchestrator/errors.ts";

const root = mkdtempSync(join(tmpdir(), "praxis-checkpoint-prop-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let dirCount = 0;
/** A fresh runs directory holding one run `r` whose run.json is `text`. */
function runWithManifest(text: string): string {
  const runsDir = join(root, `runs-${dirCount++}`);
  mkdirSync(join(runsDir, "r"), { recursive: true });
  writeFileSync(join(runsDir, "r", "run.json"), text);
  return runsDir;
}

/** The run-id rule, stated without the code's regex. */
function isRunId(id: string): boolean {
  const plain = (c: string) => /[A-Za-z0-9]/.test(c);
  return (
    id.length >= 1 &&
    id.length <= 64 &&
    plain(id[0] ?? "") &&
    [...id].every((c) => plain(c) || c === "-" || c === "_")
  );
}

const validManifest = {
  question: "Should we enter the German market?",
  format_id: "mckinsey-style-note",
  started_at: "2026-08-20T00:00:00.000Z",
  settings: { provider: "mock" },
};

/** Text a run.json may hold after a crash, a hand edit or another version. */
const manifestText = fc.oneof(
  fc.string(),
  fc.jsonValue().map((v) => JSON.stringify(v)),
  fc
    .record(
      {
        question: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        format_id: fc.oneof(fc.string(), fc.constant(null)),
        started_at: fc.oneof(fc.date({ noInvalidDate: true }).map((d) => d.toISOString()), fc.string()),
        settings: fc.oneof(
          fc.dictionary(fc.string(), fc.string()),
          fc.dictionary(fc.string(), fc.jsonValue()),
          fc.array(fc.string()),
          fc.constant(null)
        ),
      },
      { requiredKeys: [] }
    )
    .map((v) => JSON.stringify(v)),
  fc.nat({ max: 200 }).map((n) => JSON.stringify(validManifest).slice(0, n))
);

/** What a resume may rely on: every field typed, every setting a string. */
function isWellTyped(store: CheckpointStore): boolean {
  const m = store.manifest;
  return (
    typeof m.question === "string" &&
    typeof m.format_id === "string" &&
    !Number.isNaN(Date.parse(m.started_at)) &&
    typeof m.settings === "object" &&
    m.settings !== null &&
    !Array.isArray(m.settings) &&
    Object.values(m.settings).every((v) => typeof v === "string")
  );
}

describe("CheckpointStore.open — properties", () => {
  test("accepts a run id exactly when it is a plain name, so --resume cannot leave the runs directory", () => {
    const runsDir = runWithManifest(JSON.stringify(validManifest));
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.stringMatching(/^[A-Za-z0-9_./-]{0,70}$/), fc.constant("r")),
        (id) => {
          let error: unknown;
          try {
            CheckpointStore.open(runsDir, id);
          } catch (err) {
            error = err;
          }
          expect(error === undefined || error instanceof OrchestrationError).toBe(true);
          if (!isRunId(id)) {
            expect((error as Error).message).toContain("is not a run id");
          }
        }
      )
    );
  });

  test("whatever run.json holds, it opens well-typed or is refused with OrchestrationError", () => {
    fc.assert(
      fc.property(manifestText, (text) => {
        const runsDir = runWithManifest(text);
        try {
          expect(isWellTyped(CheckpointStore.open(runsDir, "r"))).toBe(true);
        } catch (err) {
          expect(err).toBeInstanceOf(OrchestrationError);
          expect((err as Error).message).toContain("run.json");
        }
      })
    );
  });
});

describe("CheckpointStore.save / load — properties", () => {
  test("a saved stage loads back as it was written", () => {
    const store = CheckpointStore.create(join(root, "roundtrip"), "q", "f", new Date(0));
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        store.save("stage", value);
        expect(store.load("stage", (text) => JSON.parse(text))).toEqual(JSON.parse(JSON.stringify(value)));
      })
    );
  });

  test("any rejection by the stage's validator becomes OrchestrationError, with the rejection as cause", () => {
    const store = CheckpointStore.create(join(root, "reject"), "q", "f", new Date(0));
    store.save("stage", {});
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string().map((m) => new Error(m)),
          fc.string().map((m) => new TypeError(m)),
          fc.string(),
          fc.constant(null)
        ),
        (thrown) => {
          let error: unknown;
          try {
            store.load("stage", () => {
              throw thrown;
            });
          } catch (err) {
            error = err;
          }
          expect(error).toBeInstanceOf(OrchestrationError);
          expect((error as Error).cause).toBe(thrown);
        }
      )
    );
  });
});

describe("CheckpointStore — unreadable files", () => {
  test("a stage file that cannot be read is refused with OrchestrationError, not a raw fs error", () => {
    const store = CheckpointStore.create(join(root, "unreadable"), "q", "f", new Date(0));
    mkdirSync(join(store.dir, "stage.json"));
    expect(() => store.load("stage", (t) => t)).toThrow(OrchestrationError);
    expect(() => store.load("stage", (t) => t)).toThrow(/cannot be read/);
  });

  test("a run.json that cannot be read says so, rather than calling it malformed", () => {
    const runsDir = join(root, `runs-${dirCount++}`);
    mkdirSync(join(runsDir, "r", "run.json"), { recursive: true });
    expect(() => CheckpointStore.open(runsDir, "r")).toThrow(OrchestrationError);
    expect(() => CheckpointStore.open(runsDir, "r")).toThrow(/cannot be read/);
  });
});
