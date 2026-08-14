# Praxis Architecture — v0.2

This document maps the layers introduced by v0.2 (Agent Scoping) on top
of the v0.1 Format Registry, and explains the responsibilities and
boundaries between them.

---

## 1. Layer map

Praxis is organised into four layers, each with a single responsibility.
No layer reaches past its immediate neighbour.

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLI                                                                │
│  src/cli/index.ts, src/cli/commands/*.ts                            │
│  parse argv → dispatch to command → render output                   │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Orchestrator                                    src/orchestrator/  │
│  reads a Format from the Registry, decides which agents to run,     │
│  currently: scope() is implemented, brief() throws NotImplemented   │
└─────────┬────────────────────────────────────────┬──────────────────┘
          │                                        │
          ▼                                        ▼
┌────────────────────────────┐        ┌──────────────────────────────┐
│  Agents                    │        │  Format Registry (v0.1)      │
│  src/agents/*.ts           │        │  src/registry/*.ts           │
│  load prompt → render →    │        │  YAML load, validate,        │
│  call LLM → parse+validate │        │  lookup, filter              │
└────────────┬───────────────┘        └──────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LLM Provider                                          src/llm/     │
│  LLMProvider interface + MockLLMProvider (v0.2)                     │
│  Real providers (Anthropic, OpenAI, ...) land in v0.3+              │
└─────────────────────────────────────────────────────────────────────┘
```

External dependency (workspace-linked, sibling checkout of PromptLang):

```
┌─────────────────────────────────────────────────────────────────────┐
│  PromptLang                                    ~/dev/promptlang/    │
│  used by:                                                           │
│    - src/registry/loader.ts  → parseYaml    (@promptlang/yaml-parser)│
│    - src/agents/scoping.ts   → lexer, parser, AST (promptlang/*)    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. End-to-end flow: `praxis brief`

```
$ praxis brief "Should we enter Germany?" --format executive-pre-read
```

Step-by-step:

```
argv
  │
  ▼
[1] CLI dispatcher (src/cli/index.ts)
     matches "brief" → forwards to runBriefCli
  │
  ▼
[2] Brief command (src/cli/commands/brief.ts)
     parses flags (--format, --provider, --json)
     selects LLM provider (mock in v0.2)
     builds FormatRegistry, loads formats/
     constructs Orchestrator(registry, provider)
  │
  ▼
[3] Orchestrator.scope(question, formatId)
     registry.get(formatId)                → typed Format
     checks any section requires "scoping"
     executeScoping({ question, formatId, targetWords }, llm)
  │
  ▼
[4] Scoping agent (src/agents/scoping.ts)
     reads prompts/scoping.prompt
     tokenize + parse via PromptLang
     validates parameter coverage
     interpolates {{question}} / {{format_id}} / {{target_words}}
     concatenates: system + "\n\n---\n\n" + user
  │
  ▼
[5] LLMProvider.complete(prompt)
     MockLLMProvider: scan tests/fixtures/mock-llm/*.json
                       return response whose match_substring appears
                       throw MockFixtureNotFoundError otherwise
  │
  ▼
[6] Scoping agent — output validation
     strip optional ```json fence
     JSON.parse → assert 4 fields, all strings/arrays of strings
     return ScopingResult
  │
  ▼
[7] Brief command — render
     default:  pretty JSON with header + trailer
     --json:   raw JSON (no header, no trailer) — piping-safe
  │
  ▼
stdout, exit 0
```

Any failure surfaces as a typed subclass of `PraxisError` (see §4),
which the CLI catches and renders with a `✗` marker and exit 1.

---

## 3. Boundaries and invariants

- **Agents do not know about the Format Registry.** They receive an
  `AgentContext` — a plain object — from the Orchestrator. This keeps
  agents composable and unit-testable in isolation.
- **The Orchestrator does not touch the LLM directly.** It hands the
  provider to the agent and lets the agent decide how to use it. This
  keeps the Orchestrator provider-agnostic and prompt-agnostic.
- **The LLM provider does not know about prompts, agents, or formats.**
  It takes a string and returns a string. Everything above is Praxis's
  concern; everything below is the model's.
- **The CLI is a thin dispatcher.** Command modules are pure functions
  over their inputs; nothing about `process.argv`, `stdout`, or
  formatting leaks upward.

---

## 4. Error hierarchy

```
Error
└── PraxisError                              (src/registry/errors.ts)
    ├── ValidationError                      (registry — v0.1)
    ├── YamlSyntaxError                      (registry — v0.1)
    ├── FileNotFoundError                    (registry — v0.1)
    ├── DuplicateFormatError                 (registry — v0.1)
    ├── FormatNotFoundError                  (registry — v0.1)
    │
    ├── LLMError                             (src/llm/errors.ts)
    │   ├── ProviderNotSupportedError
    │   └── MockFixtureNotFoundError
    │
    ├── AgentExecutionError                  (src/agents/errors.ts)
    │   ├── InvalidAgentOutputError
    │   └── PromptFileError
    │
    ├── NotImplementedError                  (src/orchestrator/errors.ts)
    └── OrchestrationError                   (src/orchestrator/errors.ts)
```

Everything a user might see routes through this tree. The CLI has a
single `catch (err instanceof PraxisError)` per command, so adding a
new subclass automatically gets a clean stderr rendering.

---

## 5. What is deliberately absent in v0.2

- **Parallel agent execution.** The Orchestrator runs one agent at a
  time; scoping is the only one that runs. Parallelism will be added
  only if profiling shows it's worth the coordination cost.
- **Prompt-level caching.** The MockLLMProvider is fast; no need. Real
  providers may need caching in v0.3+.
- **Streaming.** `LLMProvider.complete` returns the whole string. When
  we add Anthropic (v0.3), we may add an optional streaming variant.
- **Chained agent calls.** No agent calls another agent. Coordination
  is exclusively the Orchestrator's job.

These will each earn their place when they earn their place.

---

## 6. See also

- [`docs/writing-a-prompt.md`](writing-a-prompt.md) — how to author a
  new `.prompt` file for a Praxis agent.
- [`docs/format-schema.md`](format-schema.md) — the Format YAML
  contract.
- [`docs/creating-a-format.md`](creating-a-format.md) — walkthrough for
  adding a new briefing format.
- [PromptLang syntax reference](https://github.com/matteogallo-ai/promptlang/blob/main/docs/syntax-reference.md)
  — the DSL used by every Praxis prompt.
