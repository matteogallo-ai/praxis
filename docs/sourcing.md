# Sourcing & Verification

Praxis treats sourcing as a first-class, structural concern. Every
factual claim a briefing makes must be traceable to a real source, or
be explicitly marked as unsourced. **Fabricated sources are worse
than missing ones** — the whole architecture is designed to make that
distinction impossible to blur.

This document covers the v0.3 embryonic sourcing layer, the types
involved, and the policies formats can declare.

---

## The two states of a source

Every `Finding` produced by the Research agent carries exactly one of
these two shapes in its `source` field:

### `SourceReference` — real, verifiable source

```ts
{
  url: string;                // https://…
  title: string;              // human-readable title of the page/document
  accessed_at: string;        // ISO 8601 UTC datetime (e.g. 2026-08-17T14:32:00Z)
  excerpt: string;            // ≤500-char passage that supports the claim
}
```

### `SourceMissing` — explicit acknowledgement

```ts
{
  status: "SOURCE_MISSING";
  searched_for: string;       // what the agent tried, in its own words
}
```

The `searched_for` field is not a query string per se — it is a
one-line human-readable description of the intent (`"effect size of X
on Y"`, `"median deal size for German mid-market SaaS"`). Future
releases will use these strings to drive automated retries and to
surface residual research debt in the final briefing.

---

## The agent contract

The Research prompt (`prompts/research.prompt`) instructs the model in
plain terms:

> For every finding you produce, the `source` field must be EITHER a
> real, verifiable source with all four fields, OR an explicit
> missing-source marker with `status: "SOURCE_MISSING"` and a
> `searched_for` string.
>
> NEVER fabricate a URL, title, or excerpt. If web_search returns no
> usable result for a claim, mark the finding SOURCE_MISSING and
> move on. Missing sources are a legitimate research outcome;
> fabricated sources are misconduct.

The Praxis-side parser (`src/agents/research.ts`) refuses to accept
any other shape — a source without a URL that is *not* explicitly
marked `SOURCE_MISSING` triggers `InvalidAgentOutputError`. The
distinction is enforced by the runtime, not just the prompt.

---

## Sourcing policy

Every format declares a `sourcing_policy` (see
`src/registry/schema.ts`):

- **`strict`** — the Orchestrator's `validateSourcing` throws
  `SourcingValidationError` on any finding whose `source` is
  `SOURCE_MISSING`. The CLI exits 1 with a message naming the
  policy and the missing-source count.
- **`permissive`** — missing sources are counted and returned as
  warnings inside a `SourcingReport`. No exception is thrown; later
  stages of the pipeline can decide what to do (surface the gap
  in-briefing, retry the search, etc.).

The three shipped formats (`executive-pre-read`,
`mckinsey-style-note`, `position-paper-corporate`) all declare
`strict`. Custom formats intended for exploratory research may pick
`permissive` when the gain from partial evidence outweighs the risk
of publishing unverified claims.

---

## The `SourcingReport`

`validateSourcing` always returns a report, regardless of policy:

```ts
{
  policy: "strict" | "permissive";
  total_findings: number;
  missing_sources_count: number;
  warnings: SourcingWarning[];  // one per SOURCE_MISSING finding
}
```

Under `strict`, the report is bundled into `SourcingValidationError.report`.
Under `permissive`, the caller receives the report directly. In both
cases the shape is stable across policies, so downstream consumers
can render the same UI.

---

## What v0.3 does *not* do (yet)

The layer is called *embryonic* on purpose. What later releases will
add:

- **Freshness gates** — reject sources older than a per-format
  threshold, or downweight them in synthesis.
- **Cross-agent dedupe** — collapse the same URL cited by multiple
  findings into a single citation number.
- **Retrieval retry** — feed `searched_for` strings back to the
  Research agent for a second pass under a stricter policy.
- **Domain trust bands** — allow formats to declare preferred /
  disallowed source domains (e.g. `.gov` preferred for policy
  briefings; social-media platforms disallowed for corporate
  affairs).
- **Editorial surfacing** — when a briefing goes to print with
  residual missing sources under `permissive`, the Editorial agent
  will render them as visible footnotes rather than hiding them.

The v0.3 types (`SourceReference`, `SourceMissing`, `SourcingReport`,
`SourcingWarning`) are the anchor points those extensions will build
on — changes should preserve the shape.

---

## Why this matters

Consulting-grade briefings live and die by trust in their evidence.
An LLM that silently fabricates a URL — even a plausible-looking one
— corrupts the reader's ability to verify any claim in the document,
including the ones that were correctly sourced. That is a
non-recoverable failure mode: the reader cannot un-see a fake
citation.

The sourcing layer's job is to make sure Praxis never puts the reader
in that position, at any point in the pipeline. Missing sources are
loud. Fabricated sources are impossible.
