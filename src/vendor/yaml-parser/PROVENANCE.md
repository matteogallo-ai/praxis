# Vendored YAML Parser — Provenance

## Origin

Copied verbatim from **PromptLang** — a sibling open-source project by
Matteo Gallo — at:

    ~/dev/promptlang/src/config/yaml-parser.ts

## PromptLang version at copy time

- Repository: https://github.com/matteogallo-ai/promptlang
- Approximate PromptLang release: v0.6.0-alpha.0
- File author: Matteo Gallo (MIT-licensed)

## Copy date

- **2026-08-14**

## Why vendored (and not depended on)

Praxis v0.1 has a hard constraint: **zero external npm dependencies.** The
Format Registry needs a small, deterministic YAML parser and PromptLang
already ships one that:

- has no dependencies,
- covers exactly the YAML subset Praxis formats use (mappings, sequences,
  quoted/unquoted scalars, comments — no anchors, no block scalars),
- fails loudly with `line`-aware errors on unsupported constructs.

Adding `js-yaml` or `yaml` would break the zero-dep rule and bring in
features Praxis does not want to accept (anchors, flow-style, tags).

## Known limitations of this parser

See the module header of `yaml-parser.ts` for the exhaustive list. In
short: only 2-space indented block-style mappings and sequences, and a
narrow set of scalars. Any anchor, alias, block scalar (`|`, `>`), tag
(`!!`), or flow-style collection (`{...}`, `[...]`) is rejected with a
`ConfigParseError`.

## Planned extraction — MUST happen before Praxis v0.2

Before Praxis v0.2 ("Agent Scoping") ships, this vendored copy MUST be
removed and replaced by a proper npm package extracted from PromptLang:

    @promptlang/yaml-parser

The extraction plan:

1. Move `yaml-parser.ts` (and its test file) out of PromptLang's `src/config/`
   into a new PromptLang workspace package `packages/yaml-parser/`.
2. Publish it as `@promptlang/yaml-parser` on the npm registry.
3. In Praxis: `bun add @promptlang/yaml-parser`, delete `src/vendor/yaml-parser/`,
   swap the import in `src/registry/loader.ts`.
4. Update `CHANGELOG.md` under v0.2 with: "Removed vendored YAML parser;
   now depending on @promptlang/yaml-parser."

This is tracked as **the single explicit tech debt** carried by v0.1.

## Do NOT modify this vendored copy

Bug fixes and features belong upstream in PromptLang so both projects
benefit. If a fix is urgent in Praxis before extraction, cherry-pick it
here AND open the corresponding PR against PromptLang in the same commit
message so the two stay in sync.
