# `prompts/`

Praxis agent prompts, authored in [PromptLang](https://github.com/matteogallo-ai/promptlang).
Each file corresponds to exactly one agent.

## File extension

We use PromptLang's official extension, **`.prompt`**. Older Praxis planning
docs mention `.pl` — PromptLang's convention won.

## Naming convention

`<agent-id>.prompt`, where `<agent-id>` is one of the canonical agent ids
declared in `src/registry/schema.ts` (currently: `scoping`, `research`,
`counter`, `synthesis`, `editorial`, `style`, `formatter`).

## Structure

Every prompt file must:

1. Declare `@version` — the semver of the prompt contract. Bump on any
   input-schema or output-schema change.
2. Declare `@model` and `@description`.
3. Declare a `type` `struct` describing the agent's JSON output.
4. Declare exactly one `prompt` whose name matches the agent id and
   whose return type is that struct.
5. Have three sections inside the `prompt` body: `system`, `user`,
   `output`.
6. In `system`, instruct the model to return valid JSON only — no
   markdown fences, no prose commentary.

## Template variables

The Praxis runtime interpolates `{{name}}` placeholders in `system` and
`user` sections with values from `AgentContext.input`. Every `{{name}}`
must correspond to a declared parameter of the `prompt`. Unused
parameters and orphan placeholders are both errors.

## Where the prompts are executed

`src/agents/<agent-id>.ts` loads its `.prompt` at construction time,
parses it via PromptLang, renders `system` and `user`, concatenates
them into a single prompt string, and passes it to the injected
`LLMProvider`.

## v0.3 scope

`scoping.prompt` (v0.2) and `research.prompt` (v0.3) exist. The
Research prompt is the reference for tool-using agents — it declares
`web_search` behaviour and the anti-hallucination sourcing contract
Praxis enforces at the parse step.

`stakeholder`, `risk`, `options`, `adversarial`, `synthesis`,
`editorial`, `style`, and `formatter` are still on the ROADMAP.

## Authoring guide

See [`docs/writing-a-prompt.md`](../docs/writing-a-prompt.md) for the
full Praxis-side conventions and a step-by-step walkthrough. For DSL
syntax refer to PromptLang's [`docs/syntax-reference.md`](https://github.com/matteogallo-ai/promptlang/blob/main/docs/syntax-reference.md).
