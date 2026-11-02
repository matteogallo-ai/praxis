# `prompts/`

One [PromptLang](https://github.com/matteogallo-ai/promptlang) `.prompt` file
per pipeline stage. The stage ids are `AGENT_IDS` in `src/registry/schema.ts`:

| Stage | File | Module |
| --- | --- | --- |
| `scoping` | `scoping.prompt` | `src/agents/scoping.ts` |
| `research` | `research.prompt` | `src/agents/research.ts` |
| `stakeholder` | `stakeholder.prompt` | `src/agents/stakeholder.ts` |
| `risk` | `risk.prompt` | `src/agents/risk.ts` |
| `options` | `options.prompt` | `src/agents/options.ts` |
| `synthesis` | `synthesis.prompt` | `src/agents/synthesis.ts` |
| `adversarial` | `adversarial.prompt` | `src/agents/adversarial.ts` |

A format's `required_agents` may name only these ids.

## Structure

Every prompt file:

1. Declares `@version`, `@model` and `@description`.
2. Declares the output type and exactly one `prompt`, named after the stage.
3. Has `system`, `user` and `output` sections in the `prompt` body.
4. Tells the model, in `system`, to return JSON only.

`{{name}}` placeholders in `system` and `user` are filled from the stage's
input. Every placeholder must be a declared parameter and every parameter must
be used; the agent module checks both when it loads the file.

## How a prompt is executed

The agent module parses the file with PromptLang's lexer and parser and renders
the `system` and `user` sections. `callModel` (`src/agents/prompt-runtime.ts`)
sends the `system` text in the Messages API `system` field, the `user` text as
the user message, and the file's `@model` as the model. A provider that does
not declare `acceptsSystemPrompt` receives both joined by a `---` line, as
before. A model pinned on `AnthropicLLMProvider` (constructor `model` or
`ANTHROPIC_MODEL`) overrides every `@model`.

Earlier stages' output (`{{*_json}}`) and the critique text of a synthesis
rerun reach the prompt inside `<untrusted_data source="…">` blocks, with every
`<` in the content escaped so it cannot close the block. Every stage's system
text ends with `UNTRUSTED_CONTENT_RULE`, which tells the model that those
blocks and every web_search result are data, never instructions. Code then
checks the answer: `callModel` rejects one that repeats twelve consecutive
words of the system text, and each stage's validator rejects references to
options, risks or stakeholders that do not exist.

Changing any line inside a `prompt` body changes what the model receives:
bump `@version`. CI runs `promptlang semver-check` against `main`; a changed
`@model` needs a major bump.

## Stage models

Prices are Anthropic first-party rates per million tokens (input / output):
Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10; each `web_search` call adds $0.01.

| Stage | `@model` | Why |
| --- | --- | --- |
| `scoping` | `claude-opus-5-5` | One short call (about 1k tokens in, 0.5k out), so the model costs cents at most; its framing feeds all six later stages, so quality wins. |
| `research` | `claude-sonnet-5-5` | Search results arrive as input tokens and dominate the bill; the task is reading results and copying source fields, where Sonnet halves input cost. |
| `stakeholder` | `claude-sonnet-5-5` | Same shape as research: search-heavy extraction. |
| `risk` | `claude-sonnet-5-5` | Same shape as research; scoring rules are checked in code (`src/agents/risk.ts`), not left to the model. |
| `options` | `claude-opus-5-5` | The recommendation is the decision the briefing exists for; input is the four upstream JSON documents, not raw search results. |
| `synthesis` | `claude-sonnet-5-5` | One call per format section, each resending all upstream JSON, so input volume scales with section count; the task is writing to a given structure. |
| `adversarial` | `claude-opus-5-5` | A critic weaker than the author of the brief misses what it should catch. |

No live run has measured these trade-offs.

## Authoring guide

[`docs/writing-a-prompt.md`](../docs/writing-a-prompt.md) covers the Praxis-side
conventions. For the DSL itself see PromptLang's
[`docs/syntax-reference.md`](https://github.com/matteogallo-ai/promptlang/blob/main/docs/syntax-reference.md).
