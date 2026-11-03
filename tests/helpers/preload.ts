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
 * (CI runs the suite at later dates); spawned CLIs keep the real wall clock
 * and are pinned by `PRAXIS_NOW` alone.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIXTURE_CLOCK } from "../fixtures/clock.ts";
import { restoreSystemTime } from "./clock.ts";

process.env["PRAXIS_RUNS_DIR"] ??= mkdtempSync(join(tmpdir(), "praxis-test-runs-"));

process.env["PRAXIS_NOW"] = FIXTURE_CLOCK;
restoreSystemTime();
