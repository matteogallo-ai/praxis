# Embedding Praxis as a library (v0.8)

Praxis is designed to be embedded. `src/index.ts` is the stable
v1.0 API surface: every export named there is covered by the
SemVer contract, and every typed failure inherits from
`PraxisError` so a single top-level `catch` is enough.

This document walks through the four things an embedder needs to
know: how to construct a runtime, how to run a brief, how to
handle errors, and what to keep OUTSIDE your catch blocks.

## Constructing a runtime

Praxis has three moving parts an embedder wires together:

1. A **FormatRegistry** — loaded from YAML files on disk.
2. An **LLMProvider** — one of `MockLLMProvider`,
   `AnthropicLLMProvider`, or your own implementation of the
   `LLMProvider` interface.
3. An **Orchestrator** — the pipeline coordinator.

```ts
import {
  FormatRegistry,
  AnthropicLLMProvider,
  Orchestrator,
} from "@praxis/praxis"; // hypothetical package name

const registry = new FormatRegistry();
registry.loadDirectory("formats");

const llm = new AnthropicLLMProvider(); // reads ANTHROPIC_API_KEY

const orch = new Orchestrator(registry, llm);
```

That's it. The registry is a plain in-memory data structure, the
provider is a plain fetch-based HTTP client, the orchestrator
carries no hidden state. Every call is idempotent given the same
inputs and provider seed.

## Running a brief

Six entry points, ordered by scope:

| Method                                          | Runs                              | Returns                             |
| ----------------------------------------------- | --------------------------------- | ----------------------------------- |
| `orch.scope(q, fmtId)`                          | Scoping                           | `ScopingResult`                     |
| `orch.researchAfterScoping(q, fmtId)`           | Scoping → Research                | `ResearchAfterScopingResult`        |
| `orch.mapStakeholdersAfterResearch(q, fmtId)`   | + Stakeholder Mapping             | `MapStakeholdersAfterResearchResult`|
| `orch.assessRisksAfterStakeholders(q, fmtId)`   | + Risk Analysis                   | `AssessRisksAfterStakeholdersResult`|
| `orch.brief(q, fmtId)`                          | Full six-agent pipeline           | `BriefResult`                       |
| `orch.briefWithCritique(q, fmtId)`              | + Adversarial Critique            | `BriefWithCritiqueResult`           |
| `orch.briefWithCritiqueAndRerun(q, fmtId)`      | + editorial re-run loop (v0.8)    | `BriefWithCritiqueAndRerunResult`   |

Every method takes an optional third argument for prompt-path
overrides and tool-round caps. Every method throws `PraxisError`
(or a subclass) on typed failure. Every method's return type is a
plain data record — pure JSON, safe to serialise, log, or diff.

### The v0.8 rerun entry point

`briefWithCritiqueAndRerun()` is the v0.8 addition. It runs the
full seven-agent pipeline and — iff the critique flags the
recommendation for revision — invokes Synthesis a second time in
REVISION MODE. Hard cap: one rerun per call. See
`docs/editorial-loop.md` for the loop mechanics.

```ts
const out = await orch.briefWithCritiqueAndRerun(
  "Should we enter the German market?",
  "executive-pre-read"
);

if (out.rerun_performed) {
  console.log("Rerun fired:", out.rerun_reason);
  console.log("Critiques addressed:", out.rerun_metadata.critiques_addressed);
  console.log("Sections rewritten:", out.rerun_metadata.re_synthesis_deviations);
  console.log("Original synthesis available at:", out.original_synthesis);
} else {
  console.log("No rerun — critique did not require revision.");
}
```

## Rendering the brief

`src/renderers/` ships three renderers: enhanced Markdown, DOCX,
and PDF. All three consume `BriefResult` (or the critique/rerun
supersets) and produce a `Buffer`.

```ts
import { render, hasCritique } from "@praxis/praxis";

const format = registry.get("executive-pre-read");
const buf = await render(out, "pdf", format, {
  include_toc: true,
  include_appendices: true,
  include_critique: hasCritique(out),
  theme: "professional",
});

await Bun.write("brief.pdf", buf);
```

The dispatcher validates that the target is declared in the
format's `output_targets[]` — the failure mode is a typed
`UnsupportedRenderTargetError`.

## Handling errors

Every typed failure inherits from `PraxisError`. Start with the
root class and narrow on demand:

```ts
import { PraxisError, EditorialFailureError, SourcingValidationError } from "@praxis/praxis";

try {
  const out = await orch.briefWithCritiqueAndRerun(question, formatId);
  // ...
} catch (e) {
  if (e instanceof EditorialFailureError) {
    // A section under strict_editorial exhausted its retries.
    console.error(`Section ${e.sectionId} failed: ${e.reason}`);
    for (const attempt of e.attempts) {
      console.error(`  attempt ${attempt.attempt_number}: ${attempt.details}`);
    }
    return;
  }
  if (e instanceof SourcingValidationError) {
    // A source failed the format's sourcing_rules (freshness, trust, dedupe).
    // Under 'strict' policy, this stops the pipeline; under 'permissive'
    // it surfaces as a warning in sourcing_report.
    return;
  }
  if (e instanceof PraxisError) {
    console.error(e.name, e.message);
    return;
  }
  throw e; // untyped — re-throw for the top-level handler.
}
```

The full error taxonomy is enumerated in `src/errors/public.ts`.
Every re-exported class extends `PraxisError`; a new v0.8 or v0.9
error will land there before it appears anywhere else in the API.

## What's public, what's internal

- **Public:** the FormatRegistry, the Orchestrator, every agent
  RESULT type, LLM provider types, sourcing types, renderer
  dispatcher, the full `PraxisError` taxonomy.
- **Internal:** the per-agent `executeXxx()` implementations for
  Risks, Options, Synthesis, and Adversarial. These are reachable
  ONLY through the Orchestrator on purpose — the library owns
  their sequencing (input marshalling, retry semantics under
  strict_editorial, cross-artefact validation).

The Scoping / Research / Stakeholder `executeXxx()` functions ARE
public for v0.2/v0.3/v0.4 backwards-compat, but embedders are
encouraged to use the Orchestrator for consistency.

## SemVer contract

Every named export in `src/index.ts` is covered by the SemVer
contract:

- **Patch** (0.x.PATCH): bug fixes that preserve exact behaviour
  and the public shape.
- **Minor** (0.MINOR.0): additive changes only — new exports, new
  optional fields on existing types, new methods.
- **Major** (MAJOR.0.0): removing an export, renaming an export,
  changing a method signature or return shape, changing an error
  class's inheritance chain.

`tests/library/public-api.test.ts` and
`tests/library/errors-public-api.test.ts` pin the surface. A PR
that changes them must ship the corresponding version bump.
