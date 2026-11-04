# Praxis SemVer contract (v1.0+)

Praxis 1.0 freezes the public API. This document is the
contract that every 1.x release is held to.

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
- A behaviour change that is documented in the CHANGELOG and can be
  turned off through a public option, restoring the earlier behaviour.

### Recorded minor behaviour changes

- **Stage retry.** The `Orchestrator` methods retry a stage once (two
  attempts) on a recoverable error: a request timeout, a rate limit or a
  5xx left after the provider's own backoff, or malformed JSON
  (`src/agents/retry.ts`). Synthesis retries per section. A failing stage
  can therefore cost two calls. This is the default of the official
  Anthropic SDKs and is kept; `stageAttempts: 1` in the method options
  restores the single-attempt behaviour. The error a caller finally
  receives is unchanged in type.
- **Truncated answers (a bug fix).** A stage whose answer stopped at
  `max_tokens` now fails with `TruncatedOutputError`, a new export and a
  subclass of `InvalidAgentOutputError`, so existing handlers for either
  class still catch it. Before, such an answer was passed on cut when its
  first object happened to be complete, or failed as invalid output and was
  retried once. It is no longer retried. There is no switch: passing a cut
  answer on is the defect fixed. Only providers that implement
  `completeWithTools` report a stop reason (both shipped providers do); a
  `complete()`-only provider's answer is read as finished.
- **Budget cap as a limit (a bug fix).** With `maxCostUsd` set, each
  request now reserves its worst case before it is sent, and a request
  that fails or reports no usage stays charged at it (`unreported_usd`, a
  new optional field of `StageUsage`). Before, the cap was checked against
  the recorded spend only, so a briefing could end above it by the requests
  in flight, and a timed-out request was not counted at all. A capped run
  can therefore be refused earlier than before, and a request without
  `max_tokens`, or with a web search without `max_uses`, is refused under a
  cap. There is no switch: spending past the cap is the defect fixed.
  A capped call whose model is not named in its options is refused too,
  since its worst case cannot be priced before it is sent. Without a cap
  nothing changes. `UsageLedger` gains `capped`,
  `worstCaseUsd`, `reserve`, `release`, `refusal` and `chargeUnreported`.
- **Freshness on the publication date (a bug fix).** Freshness rules now
  read `SourceReference.published_at`, a new optional field, instead of
  `accessed_at`, the retrieval time, which made every live source fresh. A
  source without a readable `published_at` gets no `stale_source` warning
  and is counted in `SourcingReport.freshness_unknown`, a new optional
  field set when the format has a freshness rule; a malformed date was
  stale before. The `stale_source` warning gains an optional
  `published_at`. A briefing whose sources carry no publication date can
  therefore pass a strict freshness rule it failed before on malformed
  timestamps, and is never reported as fresh. There is no switch:
  judging age by the retrieval time is the defect fixed.
- **Domain trust on options and critique citations (a bug fix).** Under a
  format's `domain_trust` rule, an option citing an untrusted domain now
  fails a strict briefing with `UntrustedDomainError` (or degrades it under
  `onSourcingFailure: "degrade"`); before, options' citations were not
  checked. Critiques' citations are reported, never blocking. Both are
  listed in `SourcingReport.untrusted_citations`, a new optional field of
  the new exported type `UntrustedCitation`; `counts` and `warnings` are
  unchanged. There is no switch: a strict policy that let an untrusted
  citation through is the defect fixed.

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
