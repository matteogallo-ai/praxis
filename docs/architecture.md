# Praxis Architecture — v0.4

This document maps the layers of Praxis as of v0.4, and explains the
responsibilities and boundaries between them. v0.1 shipped the Format
Registry, v0.2 added the LLM abstraction and the Scoping agent, v0.3
added a real Anthropic provider, the Research agent, and the
embryonic Sourcing & Verification layer. v0.4 adds the Stakeholder
Mapping agent — the first agent whose input includes both prior
outputs — and extends the sourcing layer to a second agent.

---

## 1. Layer map

Praxis is organised into five layers, each with a single
responsibility. No layer reaches past its immediate neighbours.

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
│  reads a Format from the Registry, decides which agents to run     │
│  v0.4:  scope() + researchAfterScoping() +                          │
│         mapStakeholdersAfterResearch() are implemented              │
│         brief() throws NotImplementedError (v0.6+)                  │
└─────────┬────────────────────────┬───────────────┬──────────────────┘
          │                        │               │
          ▼                        ▼               ▼
┌────────────────────┐   ┌──────────────────┐  ┌──────────────────────┐
│  Agents            │   │ Sourcing Layer   │  │ Format Registry (v0.1)│
│  src/agents/*.ts   │   │ src/sourcing/    │  │ src/registry/*.ts     │
│  scoping,          │   │ validateSourcing │  │ YAML load, validate,  │
│  research (v0.3),  │   │ + validateStake- │  │ lookup, filter        │
│  stakeholder (v0.4)│   │ holderSourcing   │  │                       │
│                    │   │ (v0.4)           │  │                       │
└────────┬───────────┘   └──────────────────┘  └──────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LLM Provider                                          src/llm/     │
│  LLMProvider interface + optional completeWithTools()               │
│  MockLLMProvider (offline)  +  AnthropicLLMProvider (v0.3, live)    │
└─────────────────────────────────────────────────────────────────────┘
```

External dependency (workspace-linked, sibling checkout of PromptLang):

```
┌─────────────────────────────────────────────────────────────────────┐
│  PromptLang                                    ~/dev/promptlang/    │
│  used by:                                                           │
│    - src/registry/loader.ts  → parseYaml    (@promptlang/yaml-parser)│
│    - src/agents/scoping.ts     → lexer, parser, AST (promptlang/*)  │
│    - src/agents/research.ts    → lexer, parser, AST (promptlang/*)  │
│    - src/agents/stakeholder.ts → lexer, parser, AST (promptlang/*)  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. End-to-end flow: `praxis brief --with-stakeholders`

The v0.4 pipeline extends the v0.3 flow with a third agent stage and a
second sourcing check. The Orchestrator method is
`mapStakeholdersAfterResearch`, and the CLI trigger is
`--with-stakeholders`. All prior modes (`--with-research`, default
scoping-only) remain unchanged.

The three-agent flow, in condensed form:

```
argv → CLI dispatch → briefCommand → Orchestrator.mapStakeholdersAfterResearch
  ├─ doScoping()  → ScopingResult
  ├─ doResearch(scoping, format)  → ResearchResult
  ├─ validateSourcing(research, format.sourcing_policy)
  ├─ doMapStakeholders(scoping, research, format)  → StakeholderMapResult
  │      (input includes BOTH prior outputs — first agent to do so)
  ├─ validateStakeholderSourcing(stakeholders, format.sourcing_policy)
  └─ return { scoping, research, stakeholders }
```

Under strict sourcing, either validator can throw
`SourcingValidationError` and abort the pipeline. Under permissive
sourcing, both return `SourcingReport`s with warnings that later
releases will surface in the final briefing.

### v0.3 end-to-end flow: `praxis brief --with-research`

```
$ praxis brief "Should we enter Germany?" \
    --format executive-pre-read --with-research
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
     parses flags (--format, --provider, --json, --with-research)
     selects LLM provider (mock default, or anthropic if requested)
     builds FormatRegistry, loads formats/
     constructs Orchestrator(registry, provider)
     branches on --with-research
  │
  ▼
[3] Orchestrator.researchAfterScoping(question, formatId)
     prepareForScoping: check format has scoping agent required
     check format has research agent required
     doScoping(...)  → ScopingResult
     doResearch(scoping, format)  → ResearchResult
     validateSourcing(research, format.sourcing_policy)
     return { scoping, research }
  │
  ├─ (a) Scoping ─────────────────────────────────────────────────┐
  │      executeScoping loads prompts/scoping.prompt              │
  │      renders {{question}}/{{format_id}}/{{target_words}}      │
  │      llm.complete(prompt)  → JSON string                      │
  │      parse+validate → ScopingResult                           │
  │                                                                │
  ├─ (b) Research ────────────────────────────────────────────────┤
  │      executeResearch loads prompts/research.prompt            │
  │      renders {{scoping_json}}/{{format_id}}/{{sourcing_policy}}/│
  │              {{target_words}}                                  │
  │      llm.completeWithTools(prompt, [web_search])              │
  │        provider handles multi-round tool loop (up to 5)       │
  │        collects text + tool_calls[]                            │
  │      parse+validate → ResearchResult (findings, opens, queries)│
  │                                                                │
  └─ (c) Sourcing ────────────────────────────────────────────────┘
         validateSourcing(result, "strict")
           iterate findings, flag SOURCE_MISSING
           strict → throw SourcingValidationError if any missing
           permissive → return SourcingReport with warnings
  │
  ▼
[4] Brief command — render
     default: two sections (Scoping JSON + Research findings with sources)
     --json:  combined { scoping, research } object
  │
  ▼
stdout, exit 0
```

Any failure surfaces as a typed subclass of `PraxisError` (see §4),
which the CLI catches and renders with a `✗` marker and exit 1.

---

## 3. Boundaries and invariants

- **Agents do not know about the Format Registry.** They receive an
  `AgentContext` / `ResearchContext` — plain objects — from the
  Orchestrator. This keeps agents composable and unit-testable in
  isolation.
- **The Orchestrator does not touch the LLM directly.** It hands the
  provider to the agent and lets the agent decide how to use it. This
  keeps the Orchestrator provider-agnostic and prompt-agnostic.
- **The LLM provider does not know about prompts, agents, or formats.**
  It takes a string (and optional tools) and returns a string (or a
  `CompletionResult`). Everything above is Praxis's concern; everything
  below is the model's.
- **Agents do not know about the Sourcing Layer.** They emit findings
  with typed sources. The Orchestrator is the one who calls
  `validateSourcing` — sourcing enforcement is a policy decision the
  Orchestrator owns.
- **The CLI is a thin dispatcher.** Command modules are pure functions
  over their inputs; nothing about `process.argv`, `stdout`, or
  formatting leaks upward.
- **Tool identifiers are vendor-neutral.** Agents pass Praxis-side
  names (`web_search`); providers map them to versioned API strings
  (`web_search_20250305`). Swapping tool backends does not require
  touching agent code.

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
    │   ├── MockFixtureNotFoundError
    │   ├── ToolUseNotSupportedError          (v0.3)
    │   ├── AnthropicAuthenticationError      (v0.3)
    │   ├── AnthropicAPIError                 (v0.3)
    │   ├── AnthropicRateLimitError           (v0.3)
    │   └── AnthropicTimeoutError             (v0.3)
    │
    ├── AgentExecutionError                  (src/agents/errors.ts)
    │   ├── InvalidAgentOutputError
    │   ├── PromptFileError
    │   ├── StakeholderMappingError           (v0.4)
    │   └── ResearchAgentError                (v0.3)
    │        └── MaxToolRoundsExceededError   (v0.3)
    │
    ├── SourcingValidationError              (src/sourcing/errors.ts, v0.3)
    │
    ├── NotImplementedError                  (src/orchestrator/errors.ts)
    └── OrchestrationError                   (src/orchestrator/errors.ts)
```

Everything a user might see routes through this tree. The CLI has a
single `catch (err instanceof PraxisError)` per command, so adding a
new subclass automatically gets a clean stderr rendering.

---

## 5. What is deliberately absent in v0.3

- **Parallel agent execution.** The Orchestrator runs one agent at a
  time. Parallelism will be added only if profiling shows it worth the
  coordination cost.
- **Prompt-level caching.** No caching yet. Anthropic supports prompt
  caching server-side, which we may opt into in a later release for
  large system prompts.
- **Streaming.** `LLMProvider.complete` / `completeWithTools` return
  the whole payload. A streaming variant will land when at least one
  agent's UX depends on it.
- **Chained agent calls.** No agent calls another agent. Coordination
  is exclusively the Orchestrator's job.
- **Sourcing beyond `strict` / `permissive`.** Freshness gates,
  domain-trust bands, dedupe, and retrieval retry are noted in
  [`docs/sourcing.md`](sourcing.md) as follow-on work.

These will each earn their place when they earn their place.

---

## 6. See also

- [`docs/providers.md`](providers.md) — provider interface,
  configuration, cost model, how to add a new provider.
- [`docs/sourcing.md`](sourcing.md) — sourcing philosophy, source
  types, policy semantics.
- [`docs/writing-a-prompt.md`](writing-a-prompt.md) — how to author a
  new `.prompt` file for a Praxis agent.
- [`docs/format-schema.md`](format-schema.md) — the Format YAML
  contract.
- [`docs/creating-a-format.md`](creating-a-format.md) — walkthrough for
  adding a new briefing format.
- [PromptLang syntax reference](https://github.com/matteogallo-ai/promptlang/blob/main/docs/syntax-reference.md)
  — the DSL used by every Praxis prompt.
