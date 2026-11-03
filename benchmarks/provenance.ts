/**
 * What a live benchmark artefact must record to be a run of record: the
 * commit it ran from, and each prompt's version, model and content hash.
 * Mock artefacts leave it out: a commit hash changes on every commit and
 * would break the byte-for-byte reproducibility of `bench:mock`.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

/**
 * Refuses to run a question whose live directory already holds a completed
 * run: live artefacts are the record and are never overwritten.
 */
export function assertNoLiveRecord(outDir: string): void {
  if (existsSync(join(outDir, "metadata.json"))) {
    throw new Error(`${outDir} already holds a completed live run; live artefacts are never overwritten`);
  }
}

/**
 * Records a failed live briefing next to where its artefacts would be, under
 * a name stamped with the failure time, so each failure of a question is
 * kept and committed with its cause. The file is committed, so it goes
 * through the same redaction as the CLI's stderr (a provider error can echo
 * request headers).
 */
export function recordLiveFailure(outDir: string, failedAt: Date, record: Record<string, unknown>): string {
  const path = join(outDir, `error-${failedAt.toISOString().replace(/[:.]/g, "-")}.json`);
  const tmp = `${path}.tmp`;
  const text = JSON.stringify({ failed_at: failedAt.toISOString(), ...record }, null, 2);
  writeFileSync(tmp, `${redactSecrets(text)}\n`);
  renameSync(tmp, path);
  return path;
}
