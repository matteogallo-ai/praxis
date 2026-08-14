# Contributing to Praxis

Thanks for wanting to contribute. This document covers the v0.2
development setup and the mechanical rules for landing a change.
Architectural context lives in
[`docs/architecture.md`](docs/architecture.md).

---

## Prerequisites

- [Bun](https://bun.sh) **1.3+** — Praxis is Bun-native. Node.js is not
  supported.
- macOS or Linux. Windows via WSL2 should work but is not part of the
  test matrix.
- Git.

---

## Repository layout (sibling checkouts required)

v0.2 depends on the [PromptLang](https://github.com/matteogallo-ai/promptlang)
runtime, and the dependency is wired as a file path. Both repositories
must live side by side under the same parent directory:

```
~/dev/
├── praxis/        ← this repo
└── promptlang/    ← must exist at this exact relative location
```

If you clone them under different names or paths, `bun install` and the
TypeScript path mapping will both fail. Fix:

```bash
git clone https://github.com/matteogallo-ai/promptlang.git ~/dev/promptlang
git clone https://github.com/matteogallo-ai/praxis.git ~/dev/praxis
```

This constraint is temporary. Once PromptLang is published to npm,
Praxis will switch to `"promptlang": "^1.x"` in `dependencies` and
delete the `paths` entries in `tsconfig.json`.

---

## First run

```bash
cd ~/dev/praxis
bun install
bun test                 # 219 tests, all should pass
bunx tsc --noEmit        # zero errors
bun run cli version      # praxis v0.2.0
```

If any of those fail, stop and file an issue with the output — do not
try to work around it.

---

## Making a change

1. Branch: `git checkout -b feat/short-description` (or `fix/…`,
   `docs/…`, `chore/…`).
2. Write the test first when the change is a bug fix or a new behaviour.
   Refactors don't need new tests but must not lose coverage.
3. Keep commits small and self-consistent — a reader should be able to
   review each commit in isolation.
4. Every commit must leave the repo in a green state
   (`bun test && bunx tsc --noEmit`). No red commits on merged branches.
5. Follow [Conventional Commits](https://www.conventionalcommits.org):
   `feat(scope): …`, `fix(scope): …`, `refactor(scope): …`,
   `test(scope): …`, `docs: …`, `chore: …`.

---

## Coding rules

- **TypeScript strict.** All `noImplicit*` and `strict*` flags are on;
  do not relax them. `any` is forbidden in `src/`. Tests may use `any`
  when strictly necessary, with a comment justifying the escape hatch.
- **No new npm dependencies.** Praxis is a zero-external-dependency
  library plus the workspace-linked `@promptlang/yaml-parser`. If you
  think a dependency is truly required, open an issue first — the bar
  is high.
- **No LLM calls in tests.** The test suite is deterministic and offline.
  Use `MockLLMProvider` or a custom in-memory `LLMProvider`.
- **No `.env`, no secrets.** Provider credentials arrive in v0.3 via a
  clearly-scoped adapter; until then no environment variable is read
  from `src/`.

---

## Adding a new agent

The scoping agent is the reference template. To add another:

1. Author the prompt in `prompts/<agent-id>.prompt` (PromptLang). See
   [`docs/writing-a-prompt.md`](docs/writing-a-prompt.md).
2. Add the fixture(s) under `tests/fixtures/mock-llm/` — one per format
   the agent is exercised against.
3. Create `src/agents/<agent-id>.ts` following `src/agents/scoping.ts`.
4. Wire it into the `Orchestrator` alongside `scope()`.
5. Add unit tests under `tests/agents/` and update the orchestrator
   tests. Add a CLI command only if the agent is user-callable.

---

## Reporting bugs

Please include: your Bun version, the exact `git rev-parse HEAD` of
Praxis and PromptLang, and the failing command's full output (with
`NO_COLOR=1` for readability).
