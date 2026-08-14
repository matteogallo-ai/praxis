# Praxis

**Praxis** is an open-source multi-agent system that produces analytical
briefings — executive pre-reads, position papers, McKinsey-style notes,
family-office memos — in the exact codes of the target organization. The
differentiator is not "we use multiple agents" but the **format
discipline enforced upstream**: the briefing arrives already shaped like
the organization's own analysts wrote it, with rigorous sourcing and a
consistent voice. That is 80% of what a senior reader values.

The current release, **v0.2 — Agent Scoping**, ships the first agent
and the orchestrator scaffold on top of the v0.1 Format Registry.

Highlights:

- Everything from v0.1: the canonical Format schema, strict YAML
  loader/validator, in-memory `FormatRegistry`, three production-ready
  formats, and the `praxis formats *` CLI subcommands.
- A minimal `LLMProvider` interface with a deterministic
  `MockLLMProvider` for offline runs and tests.
- The **Scoping** agent — its prompt lives at
  [`prompts/scoping.prompt`](prompts/scoping.prompt) and is written in
  [PromptLang](https://github.com/matteogallo-ai/promptlang).
- An `Orchestrator` that reads a Format from the registry, dispatches
  the scoping agent, and returns a typed `ScopingResult`.
- A new CLI command:
  `praxis brief "<question>" --format <id> [--provider mock] [--json]`.

**No real LLM calls in v0.2.** The CLI is wired to the
`MockLLMProvider` and the whole test suite is deterministic. Real
providers (starting with Anthropic) land in v0.3.

---

## Install

Praxis runs on [Bun](https://bun.sh) 1.3+.

```bash
git clone https://github.com/matteogallo-ai/praxis.git
cd praxis
bun install
```

**Development setup.** v0.2 depends on the sibling PromptLang checkout.
Before `bun install`, clone PromptLang next to Praxis:

```
~/dev/
├── praxis/        ← this repo
└── promptlang/    ← must exist at this exact relative location
```

`package.json` declares
`"@promptlang/yaml-parser": "file:../promptlang/packages/yaml-parser"`
and `tsconfig.json` maps the `promptlang/*` import prefix to
`../promptlang/src/*`. Both paths resolve against the sibling checkout.
See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contributor
walkthrough. This constraint disappears once PromptLang publishes to
npm — Praxis will switch to `"promptlang": "^1.x"` in `dependencies`.

---

## CLI usage

### `praxis version`

```
$ bun run cli version
praxis v0.2.0
```

### `praxis formats list`

Prints every registered format as a table. Add `--org-style <style>` to
filter (values: `pwc`, `mckinsey`, `bcg`, `family-office`,
`corporate-affairs`, `government`, `generic`).

```
$ bun run cli formats list
ID                        Name                              Org Style          Language  Pages  Version
------------------------  --------------------------------  -----------------  --------  -----  -------
executive-pre-read        Executive Pre-Read                generic            en        2      1.0.0
mckinsey-style-note       McKinsey-Style Note               mckinsey           en        3      1.0.0
position-paper-corporate  Corporate Affairs Position Paper  corporate-affairs  en        4      1.0.0

3 formats registered.
```

### `praxis formats inspect <format-id>`

Renders the full format tree — metadata, sections, style guide, sourcing
policy, output targets.

### `praxis formats validate <path/to/file.yaml>`

Parses and validates any YAML file against the Format schema. Exit code 0
on success, 1 on failure with every issue listed.

### `praxis brief "<question>" --format <id>`  *(new in v0.2)*

Runs the Scoping agent for the given question under the selected format
and prints its JSON output.

```
$ bun run cli brief "Should we enter the German market?" --format executive-pre-read

Scoping agent output
====================
{
  "reformulated_question": "Should our company enter the German market ...",
  "hidden_questions": [
    "What is the minimum viable capital commitment ...",
    "Which German customer segments are most economically addressable ...",
    ...
  ],
  "scope_boundaries": [ ... ],
  "assumptions_to_validate": [ ... ]
}

Next: full briefing generation coming in v0.6+.
```

Flags:

- `--format <id>` — required. Format id from the registry.
- `--provider <name>` — optional. Only `mock` is supported in v0.2;
  passing any other value exits 1 with a clear message. Real providers
  arrive in v0.3.
- `--json` — optional. Prints raw JSON only, for piping.

---

## Architecture

v0.2 introduces three new layers on top of the v0.1 Format Registry:

```
                      ┌─────────────────────────┐
                      │  Format Registry (v0.1) │
                      └───────────┬─────────────┘
                                  │
                      ┌───────────▼─────────────┐
                      │      Orchestrator       │
                      │  scope() / brief()      │
                      └───────────┬─────────────┘
                                  │
                      ┌───────────▼─────────────┐
                      │     Scoping Agent       │
                      │ (prompts/scoping.prompt)│
                      └───────────┬─────────────┘
                                  │  render + concat
                                  │  system + user
                                  ▼
                      ┌───────────────────────────┐
                      │       LLMProvider         │
                      │  MockLLMProvider (v0.2)   │
                      │  AnthropicProvider (v0.3) │
                      └───────────────────────────┘
```

Full detail and design rationale: [`docs/architecture.md`](docs/architecture.md).
For authoring a new agent prompt: [`docs/writing-a-prompt.md`](docs/writing-a-prompt.md).

---

## Format schema — quick reference

A format YAML declares a briefing's structure and stylistic contract:

```yaml
id: executive-pre-read           # kebab-case, unique
name: Executive Pre-Read
version: 1.0.0                   # SemVer
metadata:
  author: ...
  organization_style: generic    # pwc | mckinsey | bcg | family-office
                                 # | corporate-affairs | government | generic
  language: en                   # en | fr | multi
  last_reviewed: 2026-08-14      # ISO date
target_length:
  pages: 2
  words: 800
sections:
  - id: context
    title: Context
    purpose: ...
    max_length:
      words: 100
    required_agents: [scoping, research]
    tone_directives: ...
    validation_rules:
      - "must_contain_recommendation: true"
sourcing_policy: strict          # strict | permissive
style_guide:
  voice: ...
  sentence_structure: ...
  forbidden_terms: [...]
output_targets: [md, pdf]        # pdf | docx | md
```

The full schema and an annotated example live in
[`docs/format-schema.md`](docs/format-schema.md). A step-by-step guide
for contributing a new format is in
[`docs/creating-a-format.md`](docs/creating-a-format.md).

> **YAML subset.** Praxis parses YAML with `@promptlang/yaml-parser` — a
> minimal block-style parser (no flow-style `[..]`/`{..}`, no anchors,
> no block scalars). Every shipped format uses the block form.

---

## Roadmap

Praxis targets a v1.0 release in ten steps.

| Release | Focus |
| --- | --- |
| v0.1 | Format Registry |
| **v0.2** | Agent scoping — first PromptLang-authored agent + orchestrator scaffold (this release) |
| v0.3 | Research agent + real Anthropic provider |
| v0.4 | Stakeholder + Risk agents |
| v0.5 | Options + Adversarial agents (red-team pass) |
| v0.6 | Synthesis agent + full 7-agent pipeline |
| v0.7 | Output targets — PDF/DOCX/MD renderers |
| v0.8 | Style guide enforcement (forbidden terms, sentence caps, MECE checks) |
| v0.9 | End-to-end demos on the three shipped formats |
| v1.0 | Documentation, CI matrix, external contributor onboarding |

Full detail: [`ROADMAP.md`](ROADMAP.md).

---

## License

MIT — © 2026 Matteo Gallo. See [`LICENSE`](LICENSE).
