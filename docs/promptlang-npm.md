# Waiting on `@promptlang/core` from npm

Praxis reads its `.prompt` files with PromptLang's lexer and parser, imported
as `promptlang/*` through `tsconfig.json` `paths` → `../promptlang/src`. A
clone therefore needs a sibling checkout of PromptLang; CI checks out tag
`v1.2.0` in five jobs and a `main` commit in a sixth. Everything below is
blocked by that, and is unblocked once Praxis depends on the published
package instead.

## Status of the package

Checked 2026-11-03 (`npm view @promptlang/core`):

- **`2.0.0` is published** (11:21 UTC, dist-tag `latest`), from
  `github.com/matteogallo-ai/promptlang`, with an SLSA provenance
  attestation; GitHub release `v2.0.0` was published at 11:19 UTC.
- Its root export carries what Praxis uses: `tokenize`, `parse` and the AST
  types. Its CLI (`dist/cli/cli.js`) includes `semver-check`.
- Parsed with the published `2.0.0`, the seven files in `prompts/` give the
  same AST as the local sibling checkout (JSON comparison, one file at a
  time).
- The registry also lists `0.0.0-stage` (11:18 UTC), not deprecated.

## What it unblocks

| Item | What changes | Done when |
| --- | --- | --- |
| **Part B, B1: the dependency** | `"@promptlang/core": "2.0.0"` (exact) in `dependencies`; `promptlang/lexer`, `promptlang/parser`, `promptlang/ast` imports become `@promptlang/core`; `paths` and `baseUrl` leave `tsconfig.json`; the sibling checkouts and `PROMPTLANG_REF` leave `.github/workflows/ci.yml`. Part B also asks to choose library (build, types, exports) or CLI only, with the reason. | The repository alone, copied into an empty directory, installs, passes `bun test` and runs `bun run cli brief "…" --format auto --full` on the mock provider. |
| **DoD D5** | A CI job that does exactly that from a fresh clone, with the one command documented in the README. | That job is green and required on `main` (`.github/settings/ruleset-main.json`). |
| **TypeScript 7** | Dependabot's TypeScript 7 bump (#8) failed with TS5102: TypeScript 7 removed `baseUrl`, which the `paths` hack needs. With the hack gone, the next Dependabot major bump can pass. | That pull request is green, merged on its own. |
| **CLAIMS C19** | "Installable from a clean clone" moves from roadmap to shipped, with the D5 job as its test; README line in Roadmap moves to Features. | `bun run check:claims` green. |
| **`prompt semver-check` job** | Runs the CLI of the pinned package instead of a pinned PromptLang `main` commit. | The job keeps its name (it is a required check). |
| **Mutation testing** | `stryker.config.json` drops `inPlace: true`, which exists only because a sandbox copy breaks `../promptlang`; `bun run mutation` no longer needs its dirty-`src/` guard for that reason. | `bun run mutation` passes in a sandbox, score unchanged. |
| **Supply chain** | PromptLang enters `bun.lock` with its integrity hash instead of a git checkout outside the lockfile (`docs/THREAT_MODEL.md` LLM03), and OSV-Scanner covers it. | OSV-Scanner green on the new lockfile. |
| **Docs that name the hack** | `CLAUDE.md` (layout), `docs/SYSTEM_CARD.md`, `docs/THREAT_MODEL.md`, `docs/supply-chain.md`, `docs/mutation-testing.md`, `docs/adr/README.md` lesson 4, the bug-report template's "PromptLang checkout tag" field. | `bun run check:stale-narrative` and a grep for `../promptlang` find nothing. |

## Risks to check during the change

- CI builds against `v1.2.0`, local development against PromptLang `main`;
  `2.0.0` is a major version over the tag CI uses. The full suite on `2.0.0`
  is the check, not the AST comparison above.
- The package declares `bun >= 1.2.20`; CI uses Bun 1.3.14.
