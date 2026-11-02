/**
 * On-disk checkpoints: each stage's output is written once it is accepted,
 * so a failed briefing resumes from the first stage that has none.
 *
 * Layout: `<runsDir>/<run-id>/run.json` (question, format, start time) and
 * one `<stage>.json` per finished stage. A file is written to a temporary
 * name and renamed, so a crash mid-write leaves no half checkpoint behind.
 * The start time is reused on resume as the freshness clock, so a resumed
 * run judges sources exactly as the first attempt did.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OrchestrationError } from "./errors.ts";

export interface RunManifest {
  run_id: string;
  question: string;
  format_id: string;
  started_at: string;
  /**
   * What else the stage outputs depend on (provider, sourcing mode, prompt
   * and format fingerprints). A resume must present the same values, so a
   * mock run cannot be finished live, nor stale outputs reused after a
   * prompt changed.
   */
  settings: Record<string, string>;
}

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function writeAtomically(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export class CheckpointStore {
  readonly dir: string;
  readonly manifest: RunManifest;

  private constructor(dir: string, manifest: RunManifest) {
    this.dir = dir;
    this.manifest = manifest;
  }

  /** Starts a new run directory under `runsDir`. */
  static create(
    runsDir: string,
    question: string,
    formatId: string,
    now: Date = new Date(),
    settings: Record<string, string> = {}
  ): CheckpointStore {
    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const runId = `${stamp}-${randomBytes(3).toString("hex")}`;
    const dir = join(runsDir, runId);
    mkdirSync(dir, { recursive: true });
    const manifest: RunManifest = {
      run_id: runId,
      question,
      format_id: formatId,
      started_at: now.toISOString(),
      settings,
    };
    writeAtomically(join(dir, "run.json"), manifest);
    return new CheckpointStore(dir, manifest);
  }

  /**
   * Opens an existing run. The id must be a plain name, so `--resume` cannot
   * be pointed outside `runsDir`.
   */
  static open(runsDir: string, runId: string): CheckpointStore {
    if (!RUN_ID.test(runId)) {
      throw new OrchestrationError(`'${runId}' is not a run id (letters, digits, '-' and '_' only).`);
    }
    const dir = join(runsDir, runId);
    const manifestPath = join(dir, "run.json");
    if (!existsSync(manifestPath)) {
      throw new OrchestrationError(`No run '${runId}' under ${runsDir}.`);
    }
    const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as Partial<RunManifest>;
    if (
      typeof raw.question !== "string" ||
      typeof raw.format_id !== "string" ||
      typeof raw.started_at !== "string" ||
      Number.isNaN(Date.parse(raw.started_at))
    ) {
      throw new OrchestrationError(`Run '${runId}' has a malformed run.json.`);
    }
    return new CheckpointStore(dir, {
      run_id: runId,
      question: raw.question,
      format_id: raw.format_id,
      started_at: raw.started_at,
      settings: typeof raw.settings === "object" && raw.settings !== null ? raw.settings : {},
    });
  }

  /** Throws `OrchestrationError` naming every setting that differs from the run's. */
  assertSameSettings(settings: Record<string, string>): void {
    const recorded = this.manifest.settings;
    const differ = Object.keys({ ...recorded, ...settings }).filter((k) => recorded[k] !== settings[k]);
    if (differ.length > 0) {
      throw new OrchestrationError(
        `Run '${this.manifest.run_id}' cannot be resumed: ${differ
          .map((k) => `${k} was '${recorded[k] ?? "(unset)"}', now '${settings[k] ?? "(unset)"}'`)
          .join("; ")}. Start a new run instead.`
      );
    }
  }

  get startedAt(): Date {
    return new Date(this.manifest.started_at);
  }

  /**
   * The saved output of `stage`, or `undefined` when it has not finished.
   * `validate` receives the file's text and returns the typed value or
   * throws; a file it rejects (truncated, hand-edited, written by another
   * version) is refused with `OrchestrationError` rather than fed to the
   * next stage.
   */
  load<T>(stage: string, validate: (stored: string) => T): T | undefined {
    const path = join(this.dir, `${stage}.json`);
    if (!existsSync(path)) return undefined;
    const text = readFileSync(path, "utf-8");
    try {
      return validate(text);
    } catch (err) {
      // Any rejection — a JSON syntax error or a validator's typed error —
      // means the same thing here; it is kept as the cause.
      const reason = err instanceof Error ? err.message : String(err);
      throw new OrchestrationError(
        `Checkpoint '${stage}' of run '${this.manifest.run_id}' is invalid: ${reason}. Delete ${path} to run that stage again, or start a new run.`,
        { cause: err }
      );
    }
  }

  save(stage: string, value: unknown): void {
    writeAtomically(join(this.dir, `${stage}.json`), value);
  }

  /** Writes a non-stage file of the run (e.g. `metadata.json`). */
  write(name: string, value: unknown): void {
    writeAtomically(join(this.dir, name), value);
  }
}
