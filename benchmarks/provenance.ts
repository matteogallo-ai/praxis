/**
 * What a live benchmark artefact must record to be a run of record: the
 * commit it ran from, and each prompt's version, model and content hash.
 * Mock artefacts leave it out: a commit hash changes on every commit and
 * would break the byte-for-byte reproducibility of `bench:mock`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse, tokenize } from "@promptlang/core";

import { promptMetadata } from "../src/agents/prompt-runtime.ts";
import { redactSecrets } from "../src/cli/redact.ts";

export interface PromptProvenance {
  version: string | null;
  model: string | null;
  sha256: string;
}

export interface Provenance {
  git_sha: string;
  /** Tracked files modified, or untracked prompts or formats, at run time; a live run refuses to start then. */
  git_dirty: boolean;
  prompts: Record<string, PromptProvenance>;
}

function git(root: string, args: string[]): string {
  const out = Bun.spawnSync(["git", "-C", root, ...args]);
  if (out.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString().trim()}`);
  }
  return out.stdout.toString().trim();
}

export function provenance(root: string): Provenance {
  const dir = join(root, "prompts");
  const prompts: Record<string, PromptProvenance> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".prompt")).sort()) {
    const source = readFileSync(join(dir, file), "utf-8");
    const meta = promptMetadata(parse(tokenize(source)));
    prompts[file] = {
      version: meta.version ?? null,
      model: meta.model ?? null,
      sha256: createHash("sha256").update(source).digest("hex"),
    };
  }
  return {
    git_sha: git(root, ["rev-parse", "HEAD"]),
    // Untracked files count only where the pipeline reads them: a new
    // prompt or format changes the run without changing the commit.
    git_dirty:
      git(root, ["status", "--porcelain", "--untracked-files=no"]).length > 0 ||
      git(root, ["status", "--porcelain", "--untracked-files=all", "--", "prompts", "formats"]).length > 0,
    prompts,
  };
}

const stamp = (at: Date) => at.toISOString().replace(/[:.]/g, "-");
const RUN_DIR = /^run-\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

/**
 * Where a live briefing renders before it is complete. Staging keeps a run
 * that fails mid-render from looking like a completed one.
 */
export function stageLiveRun(questionDir: string, startedAt: Date): string {
  const staged = join(questionDir, `run-${stamp(startedAt)}.staging`);
  mkdirSync(staged, { recursive: true });
  return staged;
}

/**
 * Turns a staged run into the record of a completed one, named by its start
 * time so that a question run again keeps every completed run.
 */
export function commitLiveRun(staged: string, questionDir: string, startedAt: Date): string {
  const run = join(questionDir, `run-${stamp(startedAt)}`);
  if (existsSync(run)) throw new Error(`${run} already holds a completed live run; live artefacts are never overwritten`);
  renameSync(staged, run);
  return run;
}

/** The completed runs of one question, oldest first. */
export function completedLiveRuns(questionDir: string): string[] {
  if (!existsSync(questionDir)) return [];
  return readdirSync(questionDir)
    .filter((name) => RUN_DIR.test(name) && existsSync(join(questionDir, name, "metadata.json")))
    .sort()
    .map((name) => join(questionDir, name));
}

/**
 * Records a failed live briefing next to where its artefacts would be, under
 * a name stamped with the failure time, so each failure of a question is
 * kept and committed with its cause. The file is committed, so it goes
 * through the same redaction as the CLI's stderr (a provider error can echo
 * request headers).
 */
export function recordLiveFailure(outDir: string, failedAt: Date, record: Record<string, unknown>): string {
  const path = join(outDir, `error-${stamp(failedAt)}.json`);
  const tmp = `${path}.tmp`;
  const text = JSON.stringify({ failed_at: failedAt.toISOString(), ...record }, null, 2);
  writeFileSync(tmp, `${redactSecrets(text)}\n`);
  renameSync(tmp, path);
  return path;
}
