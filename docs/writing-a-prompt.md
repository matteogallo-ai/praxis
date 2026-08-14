# Writing a Praxis Agent Prompt

Every Praxis agent is powered by a `.prompt` file authored in
[PromptLang](https://github.com/matteogallo-ai/promptlang). This guide
covers the Praxis-side conventions on top of PromptLang's own syntax
reference.

If you have not yet, read the
[PromptLang syntax reference](https://github.com/matteogallo-ai/promptlang/blob/main/docs/syntax-reference.md)
first — this document assumes you know the shape of a PromptLang file.

---

## 1. Location and naming

- Prompts live under `prompts/`.
- One file per agent, named `<agent-id>.prompt`, where `<agent-id>` is
  one of the canonical values in `AGENT_IDS`
  (`src/registry/schema.ts`).
- The `prompt` declaration inside the file must have the same name as
  the agent id (e.g. `scoping.prompt` declares `prompt scope(...)`).

The naming discipline lets `src/agents/<agent-id>.ts` find its prompt
file and declaration without any registry lookup.

---

## 2. Required file structure

Every Praxis prompt file must contain, in this order:

1. A file header comment explaining the agent's role in one paragraph.
2. `@version "x.y.z"` — bump on any input/output contract change.
3. `@model` and `@description` directives.
4. Exactly one `prompt` declaration.
5. Inside the prompt: exactly one `system:` section, exactly one
   `user:` section, one `output:` declaration.

Optional: a `type` declaration for the output struct. In v0.2 this is
mostly documentation because PromptLang v1.1 does not yet parse array
types inside struct fields — Praxis validates the JSON output on its
own side. When PromptLang ships array types, we will migrate output
types to proper structs.

---

## 3. Parameters and template variables

Prompt parameters map 1:1 to the fields of the agent's
`AgentContext`. The Praxis runtime asserts this mapping at execution
time:

- Every parameter declared in the `.prompt` **must** be supplied by
  the runtime.
- Every input supplied by the runtime **must** correspond to a
  declared parameter.
- Every `{{name}}` placeholder in `system:` or `user:` **must**
  reference a declared parameter.

Violations raise `PromptFileError`. This strictness catches renames
and stale prompts at load time rather than in production.

Supported parameter types today (via PromptLang v1.1): `string`,
`number`, `boolean`. Struct and enum parameters parse but do not
render meaningfully into `{{...}}` yet — pass primitives.

---

## 4. Output discipline

- The `system:` block must instruct the model to **return valid JSON
  only** — no prose, no markdown fences, no commentary. Praxis tolerates
  a single `\`\`\`json … \`\`\`` fence as a safety net but the fixture /
  real-provider output should be raw JSON.
- Document the full JSON schema inline in the `system:` block. Reader
  copy-paste is more reliable than a docs cross-reference the model
  will not follow.
- Praxis-side validation lives in the agent's TypeScript file
  (`src/agents/<agent-id>.ts`) — the `.prompt` cannot be the sole
  guarantee of the output shape.

---

## 5. Testing an agent

- Write at least one fixture per shipped format under
  `tests/fixtures/mock-llm/<agent-id>-<format-id>.json` with a
  discriminating `match_substring` that the rendered prompt will
  contain (typically the format id line).
- Add a unit test in `tests/agents/` covering: the nominal happy path,
  malformed JSON, each missing required field, and at least one LLM
  error.
- Add an end-to-end test in `tests/integration/` if the agent is
  reachable from the CLI.

Fixture JSON shape:

```json
{
  "label": "scoping/executive-pre-read",
  "match_substring": "Briefing format: executive-pre-read",
  "response": "{\"reformulated_question\": \"...\", ...}"
}
```

The `response` field is returned verbatim by
`MockLLMProvider.complete(...)`.

---

## 6. Worked example: `scoping.prompt`

See [`prompts/scoping.prompt`](../prompts/scoping.prompt) — it exercises
every convention in this document. Its agent implementation is
[`src/agents/scoping.ts`](../src/agents/scoping.ts). Its fixtures live
under [`tests/fixtures/mock-llm/`](../tests/fixtures/mock-llm/).

---

## 7. When PromptLang syntax and Praxis needs disagree

PromptLang is under active development. If a Praxis prompt hits a
missing feature (e.g. array types, block sections that don't yet parse):

1. First, check the [PromptLang roadmap](https://github.com/matteogallo-ai/promptlang/blob/main/docs/roadmap.md).
2. If the feature is planned, work around it inline (e.g. declare the
   opaque return type as `string` and validate structure Praxis-side)
   and **leave a comment** in the `.prompt` explaining the workaround
   and the PromptLang version that will remove it.
3. If the feature is missing entirely, open an issue in the PromptLang
   repo before shipping a Praxis workaround.

The workaround discipline exists because Praxis intends to migrate
prompts back to clean PromptLang syntax as soon as each feature ships.
Comments in the `.prompt` are the paper trail.
