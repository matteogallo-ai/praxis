/**
 * `PraxisError` — the single root of every error class an embedder
 * of Praxis can meaningfully catch on.
 *
 * The class is defined in `src/registry/errors.ts` (the validator's
 * home); this file re-exports it from a canonical location, so code
 * outside the registry can import `../errors/base.ts` without asking
 * why the base error class lives inside registry.
 *
 * Existing subclasses import from `registry/errors.ts`; both paths
 * name the same class. New code SHOULD import from `errors/base.ts`.
 *
 * Do NOT define new abstract error classes here. This file is the
 * SINGLE anchor for the public error taxonomy.
 */

export { PraxisError } from "../registry/errors.ts";
