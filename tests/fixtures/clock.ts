/**
 * When the mock fixtures' sources were read. Their `accessed_at` values are
 * fresh against this date whatever the real one, so the CLI tests
 * (`tests/helpers/preload.ts`) and `bench:mock` (`benchmarks/run-all.ts`) run
 * at it and keep their verdicts and committed outputs stable.
 */
export const FIXTURE_CLOCK = "2026-08-20T00:00:00.000Z";
