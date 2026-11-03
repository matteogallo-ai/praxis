/**
 * Test preload: CLI runs write checkpoints under a temporary directory, never
 * under the repository's `.praxis/runs`.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env["PRAXIS_RUNS_DIR"] ??= mkdtempSync(join(tmpdir(), "praxis-test-runs-"));
