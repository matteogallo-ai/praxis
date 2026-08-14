# Praxis

**Praxis** is an open-source multi-agent system that produces analytical
briefings — executive pre-reads, position papers, McKinsey-style notes,
family-office memos — in the exact codes of the target organization. The
differentiator is not "we use multiple agents" but the **format
discipline enforced upstream**: the briefing arrives already shaped like
the organization's own analysts wrote it, with rigorous sourcing and a
consistent voice. That is 80% of what a senior reader values.

This release, **v0.1 — Format Registry**, is the declarative foundation.
It ships:

- a canonical schema for a briefing format,
- a strict YAML loader and validator,
- an in-memory `FormatRegistry` with lookup and filtering,
- a CLI to list, inspect, and validate formats,
- three production-ready formats shipped in `formats/`.

**Zero LLM calls in v0.1.** No agents. No network. Everything is
declarative and testable.

---

## Install

Praxis runs on [Bun](https://bun.sh) 1.3+.

```bash
git clone https://github.com/matteogallo-ai/praxis.git
cd praxis
bun install
```

There are no runtime npm dependencies. `bun install` only pulls the
TypeScript dev toolchain (`@types/bun`, `typescript`).

---

## CLI usage

### `praxis version`

```
$ bun run cli version
praxis v0.1.0
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

```
$ bun run cli formats inspect mckinsey-style-note
McKinsey-Style Note  (mckinsey-style-note v1.0.0)

Metadata
========
  author              Matteo Gallo
  organization_style  mckinsey
  ...
```

### `praxis formats validate <path/to/file.yaml>`

Parses and validates any YAML file against the Format schema. Exit code 0
on success, 1 on failure with every issue listed:

```
$ bun run cli formats validate formats/executive-pre-read.yaml
✓ Valid format: executive-pre-read (v1.0.0)

$ bun run cli formats validate tests/fixtures/invalid-missing-field.yaml
✗ Validation failed for tests/fixtures/invalid-missing-field.yaml
  - sections[0].max_length: is required

1 issue found.
```

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
    max_length: { words: 100 }    # (note: v0.1 YAML parser does not accept
                                  # flow-style; use the block form below)
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

> **YAML subset.** v0.1 uses a minimal YAML parser (block-style
> mappings/sequences only — no flow-style `[..]`/`{..}`, anchors, or
> block scalars). Every existing format uses the block form. See
> `src/vendor/yaml-parser/PROVENANCE.md`.

---

## Roadmap

Praxis targets a v1.0 release in ten steps.

| Release | Focus |
| --- | --- |
| **v0.1** | Format Registry (this release) |
| v0.2 | Agent scoping — first PromptLang-authored agent + orchestrator scaffold |
| v0.3 | Research agent — retrieval, citations, sourcing policy enforcement |
| v0.4 | Stakeholder + Risk agents |
| v0.5 | Options + Adversarial agents (red-team pass) |
| v0.6 | Synthesis agent + full 7-agent pipeline |
| v0.7 | Output targets — PDF/DOCX/MD renderers |
| v0.8 | Style guide enforcement (forbidden terms, sentence caps, MECE checks) |
| v0.9 | End-to-end demos on the three shipped formats |
| **v1.0** | Documentation, CI matrix, external contributor onboarding |

Full detail: [`ROADMAP.md`](ROADMAP.md).

---

## Technical debt (planned)

Exactly one piece of tech debt is carried by v0.1:

**Vendored YAML parser.** `src/vendor/yaml-parser/` is a verbatim copy of
PromptLang's minimal YAML parser. It **must** be extracted into a
standalone package (`@promptlang/yaml-parser`) and consumed via
`bun add` before Praxis v0.2 ships. See
[`src/vendor/yaml-parser/PROVENANCE.md`](src/vendor/yaml-parser/PROVENANCE.md)
for the extraction plan.

---

## License

MIT — © 2026 Matteo Gallo. See [`LICENSE`](LICENSE).
