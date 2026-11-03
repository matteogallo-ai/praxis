# Waiting on `@promptlang/core` from npm

Praxis reads its `.prompt` files with PromptLang's lexer and parser, imported
as `promptlang/*` through `tsconfig.json` `paths` → `../promptlang/src`. A
clone therefore needs a sibling checkout of PromptLang; CI checks out tag
`v1.2.0` in five jobs and a `main` commit in a sixth. Everything below is
blocked by that, and is unblocked once Praxis depends on the published
package instead.

## Where it stands

Since the pull request that added `tests/ci/clean-clone.test.ts`, Praxis
depends on `@promptlang/core` 2.0.0 from npm. Done there: the dependency,
DoD D5 (CI job `clean-clone`, a required check), CLAIMS C19, the
`semver-check` job on the package's CLI, Stryker without `inPlace`, the
lockfile and OSV-Scanner coverage, and the docs below. Left: TypeScript 7
(#14), its own pull request.

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
| **The dependency** (item B1 of the Part B remediation, not DoD line B1) | `"@promptlang/core": "2.0.0"` (exact) in `dependencies`; `promptlang/lexer`, `promptlang/parser`, `promptlang/ast` imports become `@promptlang/core`; all seven `promptlang*` entries of `paths`, and `baseUrl`, leave `tsconfig.json`; the sibling checkouts and `PROMPTLANG_REF` leave `.github/workflows/ci.yml`. Part B also asks to choose library (build, types, exports) or CLI only, with the reason. | The DoD D5 job below runs those three commands (`bun install --frozen-lockfile`, `bun test`, `bun run cli brief "…" --format auto --full` on the mock provider) in a clone with no `../promptlang`, and is green. |
| **DoD D5** | A CI job that does exactly that from a fresh clone, with the one command documented in the README. | That job is green and required on `main` (`.github/settings/ruleset-main.json`). |
| **TypeScript 7** | Pull request #14 (Dependabot, `typescript` 5.9.3 → 7.0.2) is open and red on `typecheck · test`: TypeScript 7 removed `baseUrl`, which the `paths` hack needs (TS5102). Majors now come in their own Dependabot pull requests (#12), so #14 is the one to rebase after the dependency change. | #14 green after `@dependabot rebase`, merged on its own. |
| **CLAIMS C19** | "Installable from a clean clone" moves from roadmap to shipped, with the D5 job as its test; README line in Roadmap moves to Features. | `bun run check:claims` green. |
| **`prompt semver-check` job** | Runs the CLI of the pinned package instead of a pinned PromptLang `main` commit. | The job keeps its name (it is a required check) and no step of it checks out or runs `../promptlang`. |
| **Mutation testing** | `stryker.config.json` drops `inPlace: true`, which exists only because a sandbox copy breaks `../promptlang`; `bun run mutation` no longer needs its dirty-`src/` guard for that reason. | `bun run mutation` passes in a sandbox, score unchanged. |
| **Supply chain** | PromptLang enters `bun.lock` with its integrity hash instead of a git checkout outside the lockfile (`docs/THREAT_MODEL.md` LLM03), and OSV-Scanner covers it. | OSV-Scanner green on the new lockfile. |
| **Docs that name the hack** | `README.md` (install, lines 64–72; the C19 roadmap line, 110), `CONTRIBUTING.md` (layout heading and setup, 23–44), `CLAUDE.md` (layout), `docs/getting-started.md` (19–24), `docs/architecture.md` (131–132), `docs/SYSTEM_CARD.md`, `docs/THREAT_MODEL.md` (LLM03), `docs/supply-chain.md`, `docs/mutation-testing.md`, `docs/adr/README.md` lesson 4, the comment above `PROMPTLANG_REF` in `.github/workflows/ci.yml` (18–21), the `_comment` of `stryker.config.json`, the bug-report template's "PromptLang checkout tag" field. Left as they are: history (`CHANGELOG.md`, `ROADMAP.md`, the audit paragraph of `README.md`) and the rule in `docs/ENGINEERING_STANDARDS.md` that uses `../promptlang` as its example of a failure. | `bun run check:stale-narrative` green, and `grep -rn -e '\.\./promptlang' -e 'sibling' --exclude=CHANGELOG.md --exclude=ROADMAP.md --exclude=ENGINEERING_STANDARDS.md --exclude=promptlang-npm.md .` finds only the README audit paragraph. |

## Risks to check during the change

- CI builds against `v1.2.0`, local development against PromptLang `main`;
  `2.0.0` is a major version over the tag CI uses. The full suite on `2.0.0`
  is the check, not the AST comparison above.
- The package declares `bun >= 1.2.20`; CI uses Bun 1.3.14.
