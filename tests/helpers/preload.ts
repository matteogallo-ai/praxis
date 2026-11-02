/**
 * Test preload.
 *
 * CLI runs write checkpoints under a temporary directory, never under the
 * repository's `.praxis/runs`.
 *
 * The CLI clock is frozen at the date the mock fixtures' sources were read,
 * whatever the environment says, so no test changes verdict as time passes;
 * spawned CLIs inherit it through the environment. Library tests pass their
 * own `now`. `PRAXIS_TEST_SYSTEM_TIME` moves the wall clock of this process
 * (CI runs the suite at other dates to prove nothing else reads it).
 */
import { setSystemTime } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env["PRAXIS_RUNS_DIR"] ??= mkdtempSync(join(tmpdir(), "praxis-test-runs-"));

/** When the mock fixtures' sources were read; `benchmarks/run-all.ts` mocks at the same date. */
const FIXTURE_CLOCK = "2026-08-20T00:00:00Z";
process.env["PRAXIS_NOW"] = FIXTURE_CLOCK;

const systemTime = process.env["PRAXIS_TEST_SYSTEM_TIME"];
if (systemTime !== undefined && systemTime.length > 0) setSystemTime(new Date(systemTime));
