# Praxis SemVer contract (v1.0+)

Praxis 1.0 freezes the public API. This document is the
contract; every future release respects it.

## What is public

Everything named in `src/index.ts`. That includes:

- **Registry** — `FormatRegistry`, `validateFormat`,
  `loadFormatFile`, `loadFormatFromSource`, `loadRegistry`, and
  every schema type / helper (`Format`, `SourcingRules`,
  `EditorialRules`, `isKebabCase`, `isValidSemver`, …).
- **LLM providers** — `LLMProvider` interface,
  `MockLLMProvider`, `AnthropicLLMProvider`, and their option
  types.
- **Sourcing** — `SourceReference`, `SourceMissing`,
  `SourcingReport`, `isSourceMissing`, and the three
  `validate*Sourcing` primitives.
- **Agent RESULT types** — `ScopingResult`, `ResearchResult`,
  `StakeholderMapResult`, `RiskAnalysisResult`,
  `OptionsGenerationResult`, `SynthesisResult`,
  `AdversarialCritiqueResult`. Plus every enum union and
  constant they reference.
- **Orchestrator** — the class and every options / result type
  (`ScopeOptions` through `BriefWithCritiqueAndRerunResult`).
  `computeReSynthesisDeviations` as a public helper.
- **Renderers** — `render`, `resolveTarget`,
  `normaliseRenderTarget`, three renderer instances,
  `RENDER_TARGETS`, `RENDER_THEMES`, `hasCritique`, `Renderer`,
  `RenderOptions`, `RenderTarget`, `RenderTheme`.
- **Error taxonomy** — every class re-exported from
  `src/errors/public.ts`, all inheriting from `PraxisError`.

The `executeScoping`, `executeResearch`, and
`executeStakeholderMapping` functions are ALSO public for
v0.2/v0.3/v0.4 compat.

## What is internal

- `executeRiskAnalysis`, `executeOptionsGeneration`,
  `executeSynthesis`, `executeAdversarialCritique` — reachable
  only through the Orchestrator. The library owns their
  sequencing, retry semantics under `strict_editorial`, and
  cross-artefact validation.
- The DOCX renderer's XML / ZIP builders under
  `src/renderers/docx-internals/`.
- The PromptLang parser + `.prompt` loader helpers.
- The mock-provider fixture matcher and cache internals.
- Every `*.internal.ts` file.

Internal exports may be renamed, removed, or changed in any
release without notice.

## What triggers a MAJOR bump (breaking)

- Removing a named export from `src/index.ts`.
- Renaming a named export from `src/index.ts`.
- Changing the signature of a public method or function
  (parameter type, return type, throwing behaviour).
- Changing the inheritance chain of a public error class
  (e.g. `EditorialFailureError` ceasing to extend
  `SynthesisError`).
- Removing a field from a public result type.
- Tightening a public field's type (e.g. widening the union of
  allowed values on a field).
- Changing the wire shape of a `Format` YAML that would reject
  a valid v1.x file.

## What is acceptable in a MINOR bump

- New named exports (types, classes, functions, constants).
- New OPTIONAL fields on existing result types.
- New OPTIONAL parameters on existing methods (default-valued,
  never required).
- New methods on public classes.
- New agents, formats, renderers, providers — all additive.
- New error subclasses under existing public parents.

## What is acceptable in a PATCH bump

- Bug fixes that preserve exact behaviour on the golden path.
- Performance improvements with no observable API change.
- Internal refactors that do not touch `src/index.ts`.
- Documentation, examples, benchmarks, tests.
- Dependency version bumps of `pdfkit` within its own patch
  range (major/minor bumps of `pdfkit` are their own MINOR
  release of Praxis).

## Enforcement

The `tests/library/public-api.test.ts` and
`tests/library/errors-public-api.test.ts` suites pin the
public surface by NAME. Any PR that changes them must ship the
corresponding version bump — the tests are the machine-readable
contract.

Any doubt → default to the LARGER version bump. The cost of
over-tagging is minor; the cost of a silent break is trust.
