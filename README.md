# Praxis

**Praxis** is an open-source multi-agent system that produces analytical
briefings — executive pre-reads, position papers, McKinsey-style notes,
family-office memos — in the exact codes of the target organization. The
differentiator is not "we use multiple agents" but the **format
discipline enforced upstream**: the briefing arrives already shaped like
the organization's own analysts wrote it, with rigorous sourcing and a
consistent voice. That is 80% of what a senior reader values.

The current release, **v0.3 — Research agent + real Anthropic
provider**, adds the second Praxis agent, the first live LLM backend,
and the embryonic Sourcing & Verification layer.

Highlights:

- Everything from v0.1 (Format Registry) and v0.2 (Scoping agent,
  Orchestrator, MockLLMProvider, `praxis brief` CLI).
- **Real Anthropic provider** — `AnthropicLLMProvider` talks to
  `POST /v1/messages` via Bun's native `fetch`, with retries,
  timeout, and server-side tool use. Zero npm dependencies added.
- **Research agent** — reads Scoping output, calls Anthropic's
  `web_search` tool, returns evidence-backed `findings` each carrying
  either a real `SourceReference` (URL, title, excerpt) or an explicit
  `SOURCE_MISSING` marker. Fabricated sources are structurally
  prohibited. Prompt: [`prompts/research.prompt`](prompts/research.prompt).
- **Sourcing & Verification Layer** — `validateSourcing(result, policy)`
  enforces `strict` (throws on any missing source) or `permissive`
  (accepts with warnings). Wired in by the Orchestrator.
- **CLI extension** —
  `praxis brief "<question>" --format <id> --with-research
   [--provider mock|anthropic] [--json]` runs both agents end-to-end.

The test suite still runs offline by default (`MockLLMProvider`); live
integration tests live under [`tests/live/`](tests/live/README.md) and
run only when `ANTHROPIC_API_KEY` is set.

---

## Install

Praxis runs on [Bun](https://bun.sh) 1.3+.

```bash
git clone https://github.com/matteogallo-ai/praxis.git
cd praxis
bun install
```

**Development setup.** Praxis depends on the sibling PromptLang checkout.
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
praxis v0.3.0
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

### `praxis brief "<question>" --format <id>`

Runs the Scoping agent for the given question under the selected format
and prints its JSON output. In v0.3, add `--with-research` to chain
Scoping and Research and print both.

```
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --with-research
```

Flags:

- `--format <id>` — required. Format id from the registry.
- `--with-research` — optional. Runs Scoping + Research; prints both.
  Enforces the format's `sourcing_policy` on the research findings.
- `--provider <name>` — optional. Values: `mock` (default, fixture-driven)
  and `anthropic` (live API; requires `ANTHROPIC_API_KEY`).
- `--json` — optional. Prints raw JSON only, for piping. Under
  `--with-research`, emits `{ scoping, research }`.

---

## Configuring providers

Praxis ships two providers:

| Provider | When to use | Requires |
| --- | --- | --- |
| `mock` (default) | tests, offline runs, deterministic demos | fixtures under `tests/fixtures/mock-llm/` |
| `anthropic` | live briefings, real web search | `ANTHROPIC_API_KEY` env var; optional `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`) |

Copy the example env file and fill in your key:

```bash
cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is git-ignored; **never commit a real key.** Praxis reads
`ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) via
`process.env` at provider construction time.

Selecting the live provider from the CLI:

```bash
bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --with-research \
    --provider anthropic
```

Cost model, retry policy, and the "add-a-provider" walkthrough live in
[`docs/providers.md`](docs/providers.md).

### Testing

`bun test` runs the full offline suite (fixture-driven, no network,
zero cost). Live integration tests are opt-in:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun test tests/live/
```

Live tests self-skip when `ANTHROPIC_API_KEY` is unset. See
[`tests/live/README.md`](tests/live/README.md).

---

## Architecture

v0.3 adds a second agent, a live provider, and the sourcing layer on
top of the v0.2 pipeline:

```
                      ┌─────────────────────────┐
                      │  Format Registry (v0.1) │
                      └───────────┬─────────────┘
                                  │
                      ┌───────────▼─────────────┐
                      │      Orchestrator       │
                      │  scope() / brief() /    │
                      │  researchAfterScoping() │
                      └───────────┬─────────────┘
                                  │
                       ┌──────────┼──────────┐
                       ▼          ▼          ▼
                ┌──────────┐ ┌─────────┐ ┌──────────────┐
                │  Scoping │ │Research │ │   Sourcing   │
                │   Agent  │→│  Agent  │→│  Validator   │
                └────┬─────┘ └────┬────┘ └──────────────┘
                     │            │
                     ▼            ▼
                ┌───────────────────────────────┐
                │         LLMProvider           │
                │   MockLLMProvider (offline)   │
                │   AnthropicLLMProvider (live) │
                │   .completeWithTools()        │
                └───────────────────────────────┘
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
| v0.2 | Agent scoping — first PromptLang-authored agent + orchestrator scaffold |
| **v0.3** | Research agent + real Anthropic provider + sourcing layer (this release) |
| v0.4 | Stakeholder Mapping agent |
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
