# Format Schema Reference

A **Format** is a declarative description of an analytical briefing:
what sections it contains, how long each section may be, which agents
must contribute to it, the voice it uses, and what it forbids. Formats
live as YAML files in `formats/` and are loaded into a `FormatRegistry`
at start-up.

This document is the human-readable specification. The machine-readable
source of truth is [`src/registry/schema.ts`](../src/registry/schema.ts).

---

## Top-level structure

Every format YAML file MUST declare exactly the following top-level
keys. Unknown keys are rejected (strict-by-default).

| Key | Type | Notes |
| --- | --- | --- |
| `id` | string | kebab-case, unique across the registry |
| `name` | string | human-readable title |
| `version` | string | valid SemVer 2.0.0 (`MAJOR.MINOR.PATCH`, optional pre-release/build) |
| `metadata` | mapping | see below |
| `target_length` | mapping | overall document budget |
| `sections` | sequence | ordered list of sections |
| `sourcing_policy` | enum | `strict` or `permissive` |
| `style_guide` | mapping | voice + forbidden terms |
| `output_targets` | sequence | non-empty subset of `pdf`, `docx`, `md` |

## `metadata`

| Key | Type | Notes |
| --- | --- | --- |
| `author` | string | human maintainer of this format |
| `organization_style` | enum | one of `pwc`, `mckinsey`, `bcg`, `family-office`, `corporate-affairs`, `government`, `generic` |
| `language` | enum | one of `en`, `fr`, `multi` |
| `last_reviewed` | string | ISO date `YYYY-MM-DD`, must be a real calendar date |

## `target_length`

| Key | Type | Notes |
| --- | --- | --- |
| `pages` | integer | strictly > 0 |
| `words` | integer | strictly > 0. The sum of `sections[].max_length.words` should stay ≤ this budget. |

## `sections`

Non-empty sequence. Each entry MUST declare:

| Key | Type | Notes |
| --- | --- | --- |
| `id` | string | kebab-case, unique within this format |
| `title` | string | rendered heading |
| `purpose` | string | 1-2 sentence intent, read by the agents at runtime |
| `max_length` | mapping | `{ words: <integer > 0> }` |
| `required_agents` | sequence | at least one of `scoping`, `research`, `stakeholder`, `risk`, `options`, `adversarial`, `synthesis`; no duplicates |
| `tone_directives` | string | free-form guidance for the writing agent |
| `validation_rules` | sequence | optional; each entry is a `key: value` declarative string |

`validation_rules` entries look like:

```yaml
validation_rules:
  - "must_contain_recommendation: true"
  - "max_sentences_per_paragraph: 3"
  - "no_bullet_lists: true"
```

They are declarative in v0.1 — future releases will interpret them
during the style-guide enforcement pass (v0.8).

## `style_guide`

| Key | Type | Notes |
| --- | --- | --- |
| `voice` | string | e.g. "authoritative, third-person, no hedging" |
| `sentence_structure` | string | e.g. "short declarative, active voice, max 20 words" |
| `forbidden_terms` | sequence | list of non-empty strings; the linter (v0.8) will reject any briefing containing them |

## `output_targets`

Non-empty sequence, each entry ∈ `{ pdf, docx, md }`, no duplicates.

---

## YAML subset

Praxis v0.1 uses a **minimal YAML parser** (vendored from PromptLang).
It supports:

- 2-space indented block-style mappings and sequences,
- unquoted scalars, double-quoted (with `\n`, `\t`, `\r`, `\"`, `\\`
  escapes) and single-quoted strings (with `''` escape),
- integers, floats, booleans (`true`/`false`), null (`~` or `null`),
- `#` comments.

It does **not** support flow-style `[a, b]` / `{k: v}`, anchors, aliases,
block scalars (`|`, `>`), or type tags. Empty lists MUST be written by
omitting the key entirely (when optional) — flow `[]` will trigger a
`YamlSyntaxError`.

---

## Annotated example

```yaml
# Every field below is required unless marked optional.

id: executive-pre-read                        # kebab-case, globally unique
name: Executive Pre-Read
version: 1.0.0                                # SemVer

metadata:
  author: Matteo Gallo
  organization_style: generic                 # enum, see list above
  language: en                                # en | fr | multi
  last_reviewed: 2026-08-14                   # ISO date

target_length:
  pages: 2
  words: 800                                  # budget for the whole document

sections:
  - id: context                               # kebab-case, unique in this format
    title: Context
    purpose: >-
      (single-line here — do not use YAML block scalars in v0.1)
      Establish the situation and why it demands attention now.
    max_length:
      words: 100                              # ≤ target_length.words when summed
    required_agents:
      - scoping                               # ≥ 1 from the whitelist
      - research
    tone_directives: neutral, factual, third-person
    validation_rules:                         # optional
      - "must_contain_trigger_event: true"
      - "max_sentences_per_paragraph: 3"

  - id: recommendation
    title: Recommendation
    purpose: State the single recommended action.
    max_length:
      words: 150
    required_agents:
      - synthesis
    tone_directives: authoritative, imperative

sourcing_policy: strict                       # strict | permissive

style_guide:
  voice: authoritative, third-person, no hedging language
  sentence_structure: short declarative, active voice, max 20 words
  forbidden_terms:
    - it seems
    - perhaps
    - we think

output_targets:
  - md
  - pdf
```

---

## Validation errors — cheat sheet

| Error path | Meaning |
| --- | --- |
| `id: is required` | top-level `id` missing |
| `version: must be valid SemVer 2.0.0` | e.g. wrote `1.0`, need `1.0.0` |
| `metadata.organization_style: must be one of [...]` | typo in the enum value |
| `metadata.last_reviewed: must be a valid ISO date` | wrong shape or non-existent date |
| `target_length.pages: must be strictly greater than 0` | wrote `0` or negative |
| `sections[i].id: must be kebab-case` | uppercase, underscore, or leading/trailing hyphen |
| `sections[i].id: duplicate section id 'X' (first seen at sections[j])` | two sections share an id |
| `sections[i].required_agents[j]: must be one of [...]` | unknown agent id |
| `sections[i].validation_rules[j]: must be 'key: value' shape` | free-form string, must look like `snake_key: value` |
| `<field>: unknown key (allowed: ...)` | top-level or nested typo — strict-by-default |
