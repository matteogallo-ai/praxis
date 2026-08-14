# Changelog

All notable changes to Praxis are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and Praxis adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-08-14

Initial release. The **Format Registry** — the declarative foundation
every future release depends on.

### Added

- **Format schema** (`src/registry/schema.ts`): typed contract for a
  briefing format, including seven `organization_style` values, three
  `language` values, two `sourcing_policy` values, seven canonical
  `agent` ids, and three `output_target` values.
- **Strict validator** (`src/registry/validator.ts`): accumulates all
  structural issues before throwing, rejects unknown top-level keys,
  validates SemVer, ISO dates, kebab-case, positive integers, section id
  uniqueness, and agent-id whitelist.
- **YAML loader** (`src/registry/loader.ts`): reads a `.yaml` file,
  parses it, validates it, and surfaces errors as typed subclasses of
  `PraxisError`.
- **In-memory registry** (`src/registry/registry.ts`): `FormatRegistry`
  class with `register`, `get`, `find`, `has`, `list`,
  `filterByOrgStyle`, `listEntries`, plus `loadDirectory` and
  `loadRegistry` convenience helpers.
- **CLI** (`src/cli/index.ts`): four commands — `version`,
  `formats list [--org-style]`, `formats inspect <id>`,
  `formats validate <path>`. Native ANSI colour, `NO_COLOR` support,
  fixed-width table renderer with zero dependencies.
- **Three production-ready formats** (`formats/`):
  - `executive-pre-read.yaml` — universal 2-page briefing (generic org
    style, 800-word target).
  - `position-paper-corporate.yaml` — corporate affairs 4-page paper
    (1600-word target) with rebuttal discipline.
  - `mckinsey-style-note.yaml` — Barbara Minto pyramid-principle
    3-page note (1200-word target).
- **146 tests** across schema, validator, loader, registry, CLI, and
  format integrity. Zero skips.
- **Documentation**: `README.md`, `ROADMAP.md`, `docs/format-schema.md`,
  `docs/creating-a-format.md`.

### Technical debt (carried into v0.2)

- **Vendored YAML parser** at `src/vendor/yaml-parser/`. Copied verbatim
  from PromptLang to preserve the "zero external dependencies" rule of
  v0.1. **Must** be extracted as an npm package
  (`@promptlang/yaml-parser`) before v0.2 ships. The extraction plan is
  documented in `src/vendor/yaml-parser/PROVENANCE.md`.

### Next

- **v0.2 — Agent Scoping.** Ship the first PromptLang-authored agent
  (`scoping`) and the orchestrator scaffold that will read the Format
  Registry to decide which agents to invoke per section. See
  `ROADMAP.md` for the full ten-step plan.

[0.1.0]: https://github.com/matteogallo-ai/praxis/releases/tag/v0.1.0
