import { setSystemTime } from "bun:test";

/**
 * Puts the wall clock back where the preload set it. A bare `setSystemTime()`
 * returns to the real date for every test file that runs afterwards, which
 * would silently end a run at another date (`PRAXIS_TEST_SYSTEM_TIME`).
 */
export function restoreSystemTime(): void {
  const at = process.env["PRAXIS_TEST_SYSTEM_TIME"];
  setSystemTime(at !== undefined && at.length > 0 ? new Date(at) : undefined);
}
