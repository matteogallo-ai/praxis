# ADR 0002 — Degrade instead of aborting on insufficient sourcing

Status: accepted, 2026-11-02.

## Context

The first live run (CHANGELOG 1.2.1) aborted 3 of 5 briefings with
`SourcingValidationError: strict policy, 7-8 of 8 items lack a source`. Under
`strict`, one unsourced item anywhere threw away every stage before it.

No raw transcript of that run was kept, so the cause below is read from the
prompt and the code, not observed:

1. The research prompt demanded an ISO 8601 `accessed_at` under a rule that
   called any fabricated field misconduct. The model has no clock; the only
   compliant answer was `SOURCE_MISSING`.
2. The freshness check reads `accessed_at`, so a guessed or malformed date also
   blocks under strict (`src/sourcing/freshness.ts`).
3. The prompt reached the model as a user message, with no system prompt
   (fixed with ADR 0001's change set).

Praxis now stamps `accessed_at` itself and prompts allow `SOURCE_MISSING` only
when no search result supports an item. That removes the likely cause; it does
not guarantee every item gets a source.

## Decision

`Orchestrator` takes `onSourcingFailure: "abort" | "degrade"`.

- `"abort"` keeps the 1.x behaviour and stays the library default, because the
  SemVer contract (`docs/SEMVER-CONTRACT.md`) counts a change in what a public
  method throws as breaking.
- `"degrade"` is the CLI and benchmark default. A strict failure is recorded,
  the run continues, the report is flagged `insufficiently_sourced: true`, and
  code appends an **Insufficiently sourced** section listing every blocking item
  (claim, stakeholder or risk, and what was searched for). Code writes it from
  the sourcing report, so no model can soften it, and every renderer prints it
  like any other section.
- Even when degrading, the run aborts if no research finding has a source:
  there would be nothing to base the analysis on.

## Rejected

- **Dropping unsourced items before later stages.** Risks reference
  stakeholders and options reference risks by id; removing one breaks those
  references and the validators that check them.
- **Switching the shipped formats to `permissive`.** It hides the failure from
  the reader instead of telling them which statements are unverified.

## Consequences

- A degraded briefing is complete but says, in its own text, what it could not
  source. The sourcing report (`--json`, benchmark `metadata.json`) carries the
  flag.
- Freshness still reads `accessed_at`, which is now the retrieval time; the
  page's own age (`page_age` in web search results) is not used yet.
  (Superseded on this point: freshness reads the publication date,
  `published_at`, and a source without one is counted as freshness unknown;
  see `docs/sourcing.md`.)
