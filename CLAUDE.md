# CLAUDE.md — Praxis

Read this first. `docs/ENGINEERING_STANDARDS.md` is the full standard;
`docs/CLAIMS.md` lists what the README promises and the tests behind it.
`docs/DEFINITION_OF_DONE.md` is the checklist a repo must pass before it is called done.

## What Praxis is

1. A 7-stage LLM pipeline that turns a business question into an analytical briefing.
2. The briefing follows a format declared in YAML (`formats/`): sections, lengths, tone, sourcing policy.
3. Each stage is a PromptLang `.prompt` file (`prompts/`) plus a TypeScript module that renders it, calls the provider and validates the JSON answer.
4. Output: Markdown, PDF (pdfkit) and DOCX; surfaces: the `praxis` CLI and a library entry point (`src/index.ts`).
5. Status: the mock provider path is tested end to end; six briefings have completed against a real model
   (questions 05, 08, 10, 11 and 12, 4 Nov 2026, `benchmarks/outputs/live/`); question 02 failed in synthesis.
   A human review (4 Nov 2026) covered only question 10's eight first-party
   sources, the ones the rule accepted: the reviewer accepted 6 and refused 2
   ([review](benchmarks/outputs/live/README.md#question-10-human-review-of-its-first-party-sources)).
   The quality of the briefings themselves is reviewed for question 12 only, in one blind comparison with a single model call.

## Pipeline

Stages run one after another; each reads the typed output of the earlier ones
(risks cite stakeholder names, options cite risk ids). Only the synthesis
sections are independent of each other, so they run concurrently. Each stage is
checkpointed and retried once on a recoverable error.

```
1 scoping      ← question, format
2 research     ← 1                (web_search)  → sourcing check
3 stakeholder  ← 1, 2             (web_search)  → sourcing check
4 risk         ← 1, 2, 3          (web_search)  → sourcing check
5 options      ← 1–4              (web_search)
6 synthesis    ← 1–5, one call per format section, sections in parallel
7 adversarial  ← assembled brief  (web_search)  → may trigger one synthesis rerun
```

## Layout

```
src/
  cli/            argv, commands (brief, formats list/inspect/validate, version), output
  orchestrator/   Orchestrator: stage order, sourcing checks, adversarial review, rerun
  agents/         one module per stage + shared types and errors
  sourcing/       SOURCE_MISSING, freshness, domain trust, dedupe; strict / permissive
  registry/       format schema, YAML loader, validator, registry
  renderers/      markdown-enhanced, pdf, docx (+ docx-internals/)
  llm/            LLMProvider, MockLLMProvider (fixtures), AnthropicLLMProvider
  errors/         public error hierarchy
  index.ts        library entry point
prompts/          *.prompt, one per stage
formats/          the four shipped formats
benchmarks/       questions.yaml, run-all.ts, score-all.ts, RESULTS.md, outputs/{mock,live}/
scripts/          check-claims, check-stale-narrative, check-commits (+ their tests)
tests/            unit, integration (mock provider), live/ (paid, opt-in), fixtures/
.claude/          Claude Code permission settings for this repo
```

PromptLang's lexer, parser and AST types come from `@promptlang/core`, pinned
exactly in `package.json`; its CLI runs the `prompt semver-check` CI job
(`bun run promptlang semver-check prompts/`). The repository needs nothing
next to it: the CI job `clean-clone` proves it.

## Commands

```bash
bun install --frozen-lockfile                 # install
bun run typecheck                             # tsc --noEmit, strict
bun test                                      # all tests; tests/live/ skip unless PRAXIS_LIVE_TESTS=1
bun run lint                                  # Biome lint; any warning fails (tests may use `!`)
bun run knip                                  # unused files, exports, dependencies
bun run check:claims                          # docs/CLAIMS.md ≡ passing tests ≡ README Features/Roadmap
bun run check:claims -- --no-run              # same, without running the tests
bun run check:stale-narrative                 # no future tense, sprint ids or bare TODOs in shipped text
bun run check:commits main..HEAD              # Conventional Commits on the branch
bun run cli brief "Should we enter the German market?" --format auto --full   # brief, mock provider
bun run cli brief --resume <run-id>           # continue a failed --full run from its checkpoints
bun run bench:mock                            # renderer smoke test; must leave git status clean
bun run fuzz -- --seconds 600                 # JSON-extraction fuzzer, fresh seed (a short run is in bun test)
bun run estimate:cost -- --ids <id,…> --cap-usd <n> # free: estimated live cost (low/central/high) and ceiling
bun run benchmarks/count-tokens.ts --ids <id,…>  # free (count_tokens) but needs the key; rerun after a prompt changes
bun run bench:live -- --max-cost-usd 8 --ids … # PAID — live run, capped per briefing; approval required
PRAXIS_LIVE_TESTS=1 bun test tests/live/      # PAID — live tests; approval required
bun run score:live -- --max-cost-usd <n>      # PAID — one capped Batch on Opus 5; approval required
```

## Repo-specific rules

- Nothing paid runs without a cost estimate (tokens × price per model × briefings,
  web search included) and Matteo's explicit approval. Bun loads `.env`
  automatically; the live tests also need `PRAXIS_LIVE_TESTS=1` so that a key on
  disk never means spending.
- Mock output is fixture text chosen by format, not by question. It proves wiring;
  never score it or present it as quality (`score-all.ts` refuses it).
- Changing a line inside a `prompt` body in `prompts/` changes model behaviour; bump
  that file's `@version`.
- `benchmarks/outputs/mock/` is regenerated by `bench:mock` and must not drift; commit
  regenerated artefacts in their own `chore(bench)` commit.
- A new README feature needs a `docs/CLAIMS.md` row with passing tests in the same PR.
- Removing or changing a named export of `src/index.ts` is a major change
  (`docs/SEMVER-CONTRACT.md`).

## Appendix A — How coding agents must work in my repos

Every repo's `CLAUDE.md` reproduces this appendix verbatim, below a short repo-specific
section (what it is, layout, exact commands). Its purpose: make the agent engineer, not
generate.

### Engineer, don't generate
1. **Read before you write.** Find the existing module, contract and test for what you are
   changing. Extend it; never create a parallel version.
2. **Smallest change that meets the acceptance criteria.** No speculative abstractions, no
   "for future use" parameters, no options nobody asked for.
3. **Second copy = extract.** About to paste a helper? Move it to a shared module and test it once.
4. **Failing test first** for every bug: show it red, then fix, then show it green.
5. **Name the failure modes** of what you write (timeout, empty input, malformed model output,
   provider down, oversized input, hostile content) and test the ones that matter.
6. **Comments explain why — never what, never when.** No sprint IDs, no "will be added later",
   no restating the code.
7. **Deterministic code over model calls** whenever the answer is computable. The model
   proposes; code validates.
8. **Never report success without the command output that proves it.**
9. **Challenge with evidence.** If an instruction, finding or ADR looks wrong, say so with file,
   line and output — do not comply silently, do not "fix" something that is not broken.
10. **Explain trade-offs** in the PR: what you chose, what you rejected, why.
11. **Independent review before handing back**: a fresh-context reviewer subagent checks the
    diff against these standards; report what it found, what you fixed, what you rejected and why.

### Forbidden
- Claiming in README/docs a feature that has no passing test listed in `docs/CLAIMS.md`.
- Future tense or sprint references in source code or docs.
- Presenting any score computed on a stub, mock or fixture as a quality measure.
- Concatenating untrusted content (retrieved, ingested, scraped, tool output) into a prompt
  without delimiters and an explicit untrusted-content instruction.
- Catch-all exception handlers without a justifying comment and a typed re-raise or log.
- Secrets held in plain strings where the framework offers a secret type
  (e.g. pydantic `SecretStr`).
- Any paid model call without a cost estimate and explicit approval.
- Commits over ~400 changed lines (lockfiles and generated artefacts excluded).
- Pushing to main, force-pushing, tagging or publishing: the human does that. Pushing a work
  branch and opening a PR is allowed; GitHub rulesets protect main and release tags.

### Report format (end of every work unit, in French for Matteo)
1. What changed, point by point. 2. Evidence: commands + outputs. 3. Audit findings disproved,
with proof. 4. Reviewer findings: fixed / rejected + why. 5. Open items. 6. Walkthrough per
changed module — what it does, why this design, how it is verified, how it breaks — written
for someone who pilots agents well but did not hand-write the code. 7. Five comprehension
questions Matteo must answer before merging (expected answers folded at the end).
