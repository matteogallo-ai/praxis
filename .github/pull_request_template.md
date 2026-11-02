## What and why

<!-- What changes, and the problem it solves. Link the issue. -->

## Trade-offs

<!-- What you chose, what you rejected, why. -->

## What was AI-generated and what I changed

<!-- Which parts a coding agent drafted; what you rewrote, removed or verified by hand. -->

## Walkthrough

<!-- Per changed module: what it does, why this design, how it is verified, how it fails. -->

## Evidence

<!-- Commands run and their output: typecheck, tests, lint, knip, check:claims, bench:mock; live artefact if behaviour changed. -->

## Checklist (docs/ENGINEERING_STANDARDS.md)

- [ ] 1. Every public claim touched is in `docs/CLAIMS.md` with a passing test, or is under Roadmap.
- [ ] 2. No sprint ids, future tense or untracked TODOs (`check:stale-narrative` passes); version read from `package.json` only.
- [ ] 3. No score computed on mock output is presented as a quality metric; behaviour changes to the pipeline have a live artefact under `benchmarks/outputs/live/`.
- [ ] 4. Every number states its `n` and denominator; methodology matches the code; generated numbers pass `--check`.
- [ ] 5. Untrusted content (web search results, earlier stages' output) is delimited and labelled in prompts; `SECURITY.md` is accurate.
- [ ] 6. Provider calls have timeouts and bounded retries; errors are mapped by type; an infrastructure failure is never reported as a model decision.
- [ ] 7. A fresh clone works with the documented commands.
- [ ] 8. Conventional Commits; one logical change per commit, about 400 changed lines or fewer (lockfiles and generated files excluded).
- [ ] 9. `bun run lint` and `bun run knip` pass; no duplicated helper.
- [ ] 10. I can explain every changed module (what, why, verification, failure); architectural changes have an ADR.
- [ ] 11. No paid call ran without a cost estimate and approval. If this PR prepares a release: CI and `claims` green, CHANGELOG entry, docs in sync, live artefact if behaviour changed, `SECURITY.md` reviewed.
