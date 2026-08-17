# Contributing to Praxis

Thanks for wanting to contribute. This document covers the v0.3
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
- (Optional) An [Anthropic API key](https://console.anthropic.com/settings/keys)
  — only required to run `--provider anthropic` from the CLI or the
  live tests under `tests/live/`.

---

## Repository layout (sibling checkouts required)

Praxis depends on the [PromptLang](https://github.com/matteogallo-ai/promptlang)
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

## Environment variables

Copy `.env.example` to `.env` and fill in the values you need:

```bash
cp .env.example .env
$EDITOR .env
```

- `ANTHROPIC_API_KEY` — required for `--provider anthropic` and the
  live tests. Never commit this file.
- `ANTHROPIC_MODEL` — optional. Defaults to `claude-sonnet-4-5`.

`.env` is git-ignored by default. The provider reads these variables
via `process.env` at construction time; nothing else in `src/` touches
the environment.

---

## First run

```bash
cd ~/dev/praxis
bun install
bun test                 # 309 tests, all should pass (3 live tests skipped)
bunx tsc --noEmit        # zero errors
bun run cli version      # praxis v0.3.0
```

If any of those fail, stop and file an issue with the output — do not
try to work around it.

To run the live integration tests (real Anthropic API):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun test tests/live/
```

Live tests self-skip when `ANTHROPIC_API_KEY` is unset. Costs are
minimal but real; do not run them from CI without explicit budget.

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
  is high. HTTP: use Bun's native `fetch`, not `axios`/`node-fetch`.
- **No real network calls in `bun test`.** The default test suite is
  deterministic and offline. Use `MockLLMProvider` or a custom
  in-memory `LLMProvider`. Real network tests belong under
  `tests/live/` and must skip themselves when the required env vars
  are absent.
- **No secrets in the repo.** `.env` is git-ignored; commit only
  `.env.example` with placeholders. Do not log or echo API keys.
- **Never fabricate a source in the Research agent.** If web_search
  returns nothing for a claim, mark it `SOURCE_MISSING` — the sourcing
  layer will surface it. Fabricated citations are misconduct.

---

## Adding a new agent

The Scoping and Research agents are the reference templates. To add
another:

1. Author the prompt in `prompts/<agent-id>.prompt` (PromptLang). See
   [`docs/writing-a-prompt.md`](docs/writing-a-prompt.md).
2. Add the fixture(s) under `tests/fixtures/mock-llm/` — one per format
   the agent is exercised against. If the agent uses tools, include
   `tool_calls`, `rounds`, and `stop_reason` in the fixture.
3. Create `src/agents/<agent-id>.ts` following `src/agents/scoping.ts`
   (text only) or `src/agents/research.ts` (with tool use).
4. Wire it into the `Orchestrator`. Prefer a new method
   (e.g. `mapStakeholdersAfterResearch`) over overloading `brief()`.
5. Add unit tests under `tests/agents/` and update the orchestrator
   tests. Add a CLI flag only if the agent is user-callable.

---

## Adding a new provider

The reference is `src/llm/anthropic-provider.ts`. Guidelines:

- Implement the `LLMProvider` interface. Implement `completeWithTools`
  only if the backend supports tool use.
- Read secrets from `process.env` at construction time; throw a typed
  auth error if the value is missing or empty.
- Retry only on transient / retriable statuses; never on 4xx client
  errors.
- Add unit tests with a fetch mock (see
  `tests/llm/anthropic-provider.test.ts` for the pattern). Do not add
  live tests unless you can guarantee they run only when the key is
  present.
- Register the provider name in `src/cli/commands/brief.ts`
  (`selectProvider`) and update the `ProviderNotSupportedError`
  message.

Full architectural notes: [`docs/providers.md`](docs/providers.md).

---

## Reporting bugs

Please include: your Bun version, the exact `git rev-parse HEAD` of
Praxis and PromptLang, and the failing command's full output (with
`NO_COLOR=1` for readability). If the bug involves the live provider,
scrub any API key from the output before sharing.
