/**
 * Where a live test leaves its output for a human to read.
 *
 * A fixed or predictable name under the shared temp directory lets another
 * local user plant a file or symlink there first; mkdtemp creates a fresh
 * directory only this user can write to (mode 0700).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function liveOutputDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `praxis-live-${name}-`));
  process.stderr.write(`live output: ${dir}\n`);
  return dir;
}
