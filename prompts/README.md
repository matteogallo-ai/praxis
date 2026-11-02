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

The agent module parses the file with PromptLang's lexer and parser, renders
the `system` and `user` sections, joins them into one string (`system`, a `---`
line, `user`) and passes that string to the `LLMProvider`, which sends it as a
single user message. The `@model` line is not read: the provider's default
model runs every stage. Both are known weaknesses listed in
[`docs/architecture.md`](../docs/architecture.md).

Changing any line inside a `prompt` body changes what the model receives.

## Authoring guide

[`docs/writing-a-prompt.md`](../docs/writing-a-prompt.md) covers the Praxis-side
conventions. For the DSL itself see PromptLang's
[`docs/syntax-reference.md`](https://github.com/matteogallo-ai/promptlang/blob/main/docs/syntax-reference.md).
