/**
 * Decides whether the paid tests under tests/live/ run. Bun loads `.env`
 * automatically, so a key on disk is not consent to spend money: the run also
 * needs `PRAXIS_LIVE_TESTS=1` in the environment.
 */
export function liveTestsEnabled(env: Record<string, string | undefined>): boolean {
  const key = env["ANTHROPIC_API_KEY"];
  return env["PRAXIS_LIVE_TESTS"] === "1" && typeof key === "string" && key.length > 0;
}
