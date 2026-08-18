/**
 * `PraxisError` — the single root of every error class an embedder
 * of Praxis can meaningfully catch on.
 *
 * The class has existed since v0.1 at `src/registry/errors.ts` (the
 * validator's home) — this file re-exports it from a canonical
 * location so that v0.8+ code can use `../errors/base.ts` without
 * ambiguity about "why is the base error class inside registry?".
 *
 * The v0.7 location is preserved for backward compatibility: every
 * subclass still imports from `registry/errors.ts`; internal call
 * sites are unchanged. New code SHOULD import from `errors/base.ts`.
 *
 * Do NOT define new abstract error classes here. This file is the
 * SINGLE anchor for the public error taxonomy.
 */

export { PraxisError } from "../registry/errors.ts";
