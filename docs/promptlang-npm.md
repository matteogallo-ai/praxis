# PromptLang from npm

Praxis reads its `.prompt` files with `@promptlang/core`, pinned to `3.0.0`
in `package.json`, with its integrity hash in `bun.lock`. Until the first
published version, `2.0.0` (2026-11-03, 11:21 UTC, with an SLSA provenance
attestation, from `github.com/matteogallo-ai/promptlang`), it imported
PromptLang's sources through `tsconfig.json` `paths` to a sibling
`../promptlang` checkout, and CI checked that repository out next to it.

`3.0.0` breaks code generation (`compile`), `analyze --strict` and
`RoutingClient`; Praxis uses none of them, only `tokenize`, `parse`, the AST
types and the `semver-check` CLI. Under `2.0.0` and `3.0.0` the seven files
in `prompts/` parse to identical ASTs (SHA-256 of each file's JSON AST),
and `semver-check` passes.

## What the switch changed

| Item | Now | Checked by |
| --- | --- | --- |
| The dependency (item B1 of the Part B remediation) | `tokenize`, `parse` and the AST types imported from `@promptlang/core`; no `paths`, no `baseUrl` | `tests/ci/clean-clone.test.ts` |
| DoD D5 | CI job `clean clone · install, test, brief (mock)`: install, `bun test` and a mock brief in a clone with nothing beside it. Listed in `.github/settings/ruleset-main.json`; required once the maintainer applies that file to the ruleset | the job itself |
| CLAIMS C19 | shipped | `bun run check:claims` |
| `prompt semver-check` job | runs the package's own CLI, `bun run promptlang semver-check prompts/ --base "$BASE"` | the job itself |
| Mutation testing | Stryker mutates a sandbox copy (`inPlace` removed); ranges pinned to declaration boundaries | `tests/ci/stryker-ranges.test.ts` |
| Supply chain | PromptLang is in `bun.lock` and covered by OSV-Scanner like every other dependency | the OSV-Scanner jobs |

Equivalence with the `v1.2.0` tag CI built against before: the seven files
in `prompts/` parse to byte-identical ASTs (JSON comparison, one file at a
time), and `semver-check` is unchanged between the commit CI pinned and
`v2.0.0`.

## Left

- **TypeScript 7.** Pull request #14 (Dependabot, `typescript` 5.9.3 →
  7.0.2) failed on TS5102: TypeScript 7 removed `baseUrl`, which the `paths`
  hack needed. On this branch TypeScript 7.0.2 typechecks with exit 0 and
  the suite passes; #14 needs `@dependabot rebase` once this is on `main`.
- `@promptlang/yaml-parser` is still declared `^1.0.0` (the lockfile pins
  it); `@promptlang/core` is exact.
