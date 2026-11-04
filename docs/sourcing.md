# Sourcing & Verification

Praxis treats sourcing as a first-class, structural concern. Every
factual claim a briefing makes must be traceable to a real source, or
be explicitly marked as unsourced. **Fabricated sources are worse
than missing ones** — the whole architecture is designed to make that
distinction impossible to blur.

This document covers the v0.5 hardened Sourcing & Verification Layer.
It supersedes the v0.3-v0.4 description of the "embryonic" layer.

---

## The two states of a source

Every sourced field produced by any agent (Research findings,
Stakeholder positions, Risk likelihood + impact evidence) carries
exactly one of these two shapes:

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
on Y"`, `"median deal size for German mid-market SaaS"`). It is shown
to the reader next to the `SOURCE MISSING` marker in the CLI output and
in the sourcing warnings, so the gap stays visible.

---

## The agent contract

Each prompt (Research, Stakeholder, Risk) instructs the model:

> For every evidence field, use EITHER a real, verifiable source with
> all four fields, OR an explicit missing-source marker with
> `status: "SOURCE_MISSING"` and a `searched_for` string.
>
> NEVER fabricate a URL, title, or excerpt. Missing sources are a
> legitimate research outcome; fabricated sources are misconduct.

The Praxis-side parsers refuse any other shape — a source without a
URL that is *not* explicitly `SOURCE_MISSING` raises
`InvalidAgentOutputError`. The distinction is enforced by the
runtime, not just the prompt.

---

## Failure mode — `sourcing_policy`

Every format declares a `sourcing_policy` (see
`src/registry/schema.ts`):

- **`strict`** — the first blocking condition raises the most specific
  typed subclass of `SourcingValidationError` (see below). The CLI
  exits 1 with a message naming the policy, the URL, and the reason.
- **`permissive`** — everything is collected into the returned
  `SourcingReport`; no exception is thrown. Later stages of the
  pipeline decide what to do (surface the gap in-briefing, retry
  the search, etc.).

The three shipped formats declare `strict`.

---

## Hardened rules (v0.5) — `sourcing_rules`

Beyond policy, formats can declare an optional `sourcing_rules` block
that layers three additional checks on top of the SOURCE_MISSING
discipline. Absent block → v0.4 behaviour verbatim (SOURCE_MISSING
check only).

```yaml
sourcing_rules:
  freshness:
    max_source_age_days: 730     # sources older than this are stale
    warn_after_days: 365         # soft warning between warn and max
  domain_trust:
    mode: reputation-only        # allow-list | deny-list | reputation-only
    reputation_tiers:            # only used in reputation-only mode
      tier_1: ["reuters.com", "*.gov", "*.gov.uk", "*.bund.de"]
      tier_2: ["handelsblatt.com", "hbr.org", "bcg.com"]
      tier_3: ["wikipedia.org"]
      min_tier: 2                # min accepted tier; tier-3 hosts are rejected
  dedupe:
    cross_agent: true
    similarity_threshold: 0.85   # Levenshtein-based; 1.0 disables fuzzy
```

### Freshness

`FreshnessRule` classifies each source's publication date
(`published_at`, relative to the pipeline's `now`) as `fresh`, `warn`, or
`stale`:

- `age <= warn_after_days` → **fresh** (no warning)
- `warn_after_days < age <= max_source_age_days` → **warn** (soft
  warning, non-blocking under strict)
- `age > max_source_age_days` → **stale** (blocking under strict,
  raises `StaleSourceError`)

A source without `published_at` has an **unknown** freshness: it gets no
warning and is never called fresh; the report counts it in
`freshness_unknown`, outside the five categories (an `ok` source is not a
fresh one). The model's answer keeps `published_at` only when it starts
with a `YYYY-MM-DD` date that parses, cut to that day; anything else is
dropped, so the date is unknown rather than guessed. `accessed_at`, the
retrieval time, is not used for freshness: a page read today can be ten
years old. The
`warn_after_days <= max_source_age_days` invariant is validated at
format load time.

The pipeline's `now` is the library option `now`, else the run's start.
On the CLI it is the wall clock, or `PRAXIS_NOW` when that holds a UTC
date and time (`2026-08-20T00:00:00Z`): the same briefing then reaches the
same freshness verdicts whatever day it runs; the test suite runs with it
set (`bench:mock` passes the same date as the library option). A resumed
run keeps the date its first attempt started at. `PRAXIS_NOW` also stamps
the run id. It does not date retrieval: a source the model returns without
`accessed_at` is stamped with the real time it was read.

### What the search stages are told

The research, stakeholder and risk prompts receive a sourcing guide written
by code from the format's rules (`src/sourcing/guidance.ts`): the trusted
hosts by tier (or the allow- or deny-list), which tiers are accepted, the
freshness limit, and the request to give `published_at` only as the page
states it. It guides the search and filters nothing: web search gets no
`allowed_domains`, a relevant page outside the list is still cited and
reported as untrusted, and no list can name every company's own site
(ADR 0003).

### Domain trust

`DomainTrustRule` supports three modes:

- **`allow-list`**: the URL host must match some `allow_list` pattern.
  Position-paper-corporate uses this — a strict institutional
  whitelist.
- **`deny-list`**: the URL host must match no `deny_list` pattern.
  Useful when the concern is *avoiding* specific sources.
- **`reputation-only`**: hosts are matched against `reputation_tiers`
  (`tier_1` is the highest). A tier-N host is accepted iff
  `N <= min_tier`. Tier-1 hosts always pass.

**Wildcard patterns** supported by the matcher:

- `*.example.com` — any subdomain of `example.com` (but not
  `example.com` itself).
- `gov.*` — any single-label TLD after `gov` (matches `gov.uk`,
  `gov.fr`, but not `gov.uk.fake`).
- `*.gov.uk` — any subdomain of `gov.uk`.
- `reuters.com` — exact host match.

Host comparison is case-insensitive. Blocking rules raise
`UntrustedDomainError` under strict policy.

The rule also covers the citations of the two later stages, which the
per-item checks of stages 2–4 never see:

- **Options** (`supporting_evidence`): an untrusted citation fails the
  brief under strict like an untrusted research source
  (`UntrustedDomainError`, or the "Insufficiently sourced" section under
  `onSourcingFailure: "degrade"`), and is reported under permissive.
- **Adversarial critique** (`counter_evidence`): reported, never blocking.
  A weak counter-evidence weakens the critique, not the briefing it
  criticises; a missing one is handled the same way.

Both are listed in `SourcingReport.untrusted_citations` (stage, option or
critique id, URL, reason), outside `counts` and `warnings`: a warning's
`agent` names one of stages 2–4, and widening that public union would be a
breaking change (`docs/SEMVER-CONTRACT.md`). The front-matter
`sourcing_summary` shows their number (`untrusted_citations=N`), and every
sourcing report (terminal, Markdown appendix, PDF, DOCX) lists them. An option
citing the same untrusted page as a research finding appears in both places:
once as the finding's item, once as the option's citation.

### Cross-agent dedupe

`DedupeRule` (with `cross_agent: true`) enables a pipeline-scoped
`SourcingAccumulator` that:

1. Normalises every URL (lowercase scheme+host, strip tracking params
   like `utm_*`/`gclid`/`fbclid`, drop fragment, alphabetise
   remaining query params, drop trailing slash on path).
2. Records the normalised URL against its agent origin
   (`research | stakeholder | risk`) and item index.
3. When a later agent registers a URL that matches an earlier
   agent's URL (exact or Levenshtein similarity below
   `1 - similarity_threshold`), the accumulator returns the previous
   entry and the layer emits a `duplicate_source` warning.

**Duplicates are non-blocking by default** — two agents citing the
same URL is often legitimate (the CEO's remark appears in both
Research and Stakeholders). The warning surfaces so the reader can
audit.

---

## `SourcingReport` (v0.5 shape)

Every validator returns a report, regardless of policy:

```ts
{
  policy: "strict" | "permissive";
  total_items: number;                     // findings + stakeholders + 2×risks
  counts: {
    ok: number;
    stale: number;
    untrusted: number;
    duplicated: number;
    missing: number;
  };
  warnings: SourcingWarning[];
  missing_sources_count: number;           // convenience alias (v0.4 compat)
  freshness_unknown?: number;               // sources without a publication date; set when the format has a freshness rule
  requester_provided?: number;               // facts only the requester can supply (scoping); in no category, not in total_items
  untrusted_citations?: UntrustedCitation[]; // options and critique citations failing domain_trust; set when the format has that rule and one of those stages ran
}
```

Categorisation is "most severe wins": if an item is both stale AND
untrusted, it lands in the `untrusted` bucket. Category counts
reconcile with `total_items`.

Under `strict`, the report is bundled into
`SourcingValidationError.report` (or a typed subclass). Under
`permissive`, the caller receives the report directly.

### Requester-provided facts

Some facts a briefing needs concern only the requester: its own finances,
strategy, board, shareholders or customers. No public source can establish
them, and an anonymous question gives no company to search for. The scoping
stage lists them in `ScopingResult.requester_provided`, and code:

- appends a **Requester-provided, not sourceable** section to the briefing
  listing them, in every renderer, after the critique's rerun too;
- counts them in `SourcingReport.requester_provided`, in no category and
  not in `total_items`, so they never raise the share of sourced items.

The later stages see the list in the scoping output they receive. An item
of theirs that rests on such a fact and has no source is still a
`SOURCE_MISSING` item, counted as missing and blocking under `strict`: being
on the list does not excuse it, because the list is the model's and code
cannot tell a fact about the requester from one that could be researched.

A run resumed from a scoping checkpoint written before scoping prompt 2.1.0
has no such list: no section and no count, not a count of zero.

### Aggregating across agents

The Orchestrator's `assessRisksAfterStakeholders` runs three
validators (research, stakeholder, risk) with a shared accumulator
and merges the three sub-reports via `mergeReports(policy, [...])`.
The merged report is returned as `result.sourcing_report` and rendered
by `praxis brief --sourcing-report`.

---

## Error hierarchy

All hardened errors inherit from `SourcingValidationError`, so v0.4
catch-blocks keep working:

- `SourcingValidationError` — base class; raised for missing sources
  under strict.
- `StaleSourceError extends SourcingValidationError` — raised when a
  source's age exceeds `max_source_age_days` under strict. Carries
  `url`, `ageDays`, `maxAgeDays`.
- `UntrustedDomainError extends SourcingValidationError` — raised
  when a source's host fails the domain trust rule under strict.
  Carries `url`, `reason`.
- `DuplicateSourceError extends SourcingValidationError` — defined
  but not raised by default (duplicates are warning-only). Reserved
  for future opt-in strict-dedupe formats.

Typed catch-blocks can narrow to the specific subclass; generic
handlers still catch the parent type.

---

## Configuration recipes

### "Institutional / policy briefing"
```yaml
sourcing_policy: strict
sourcing_rules:
  freshness:
    max_source_age_days: 1095    # 3 years — policy positions age slowly
    warn_after_days: 730
  domain_trust:
    mode: allow-list
    allow_list: ["*.gov", "*.gov.uk", "*.europa.eu", "reuters.com"]
  dedupe:
    cross_agent: true
    similarity_threshold: 0.85
```

### "Consulting note"
```yaml
sourcing_policy: strict
sourcing_rules:
  freshness:
    max_source_age_days: 545     # 18 months — the consulting tempo
    warn_after_days: 270
  domain_trust:
    mode: reputation-only
    reputation_tiers:
      tier_1: ["reuters.com", "*.gov", "*.europa.eu"]
      tier_2: ["hbr.org", "mckinsey.com", "bcg.com"]
      tier_3: ["wikipedia.org"]
      min_tier: 2
  dedupe:
    cross_agent: true
    similarity_threshold: 0.85
```

### "Exploratory research (permissive)"
```yaml
sourcing_policy: permissive        # collect everything, block nothing
sourcing_rules:
  freshness:
    max_source_age_days: 3650
    warn_after_days: 730
  # domain_trust and dedupe omitted → no checks
```

---

## Migration from v0.4 → v0.5

Formats that omit `sourcing_rules` continue to work with the v0.4
policy-only behaviour. Adopting the new block is opt-in and
non-breaking:

1. Add `sourcing_rules:` to the format YAML.
2. Start with just `freshness` (a per-genre age ceiling is usually
   uncontroversial).
3. Add `domain_trust` once the format's editorial standards are
   clear; `reputation-only` is a safer default than `allow-list`.
4. Turn on `dedupe.cross_agent: true` last — it depends on the
   pipeline having enough co-cited URLs for the check to matter.

Consumers reading `SourcingReport` should note that:
- `total_findings` was renamed to `total_items` in v0.4 (still true
  in v0.5).
- `counts` is new in v0.5; `missing_sources_count` is preserved as
  a convenience alias.
- `SourcingWarning` gained four variants in v0.5. Exhaustive
  switches over `kind` must handle: `missing_source`,
  `missing_stakeholder_evidence`, `missing_risk_evidence`,
  `stale_source`, `untrusted_domain`, `duplicate_source`.

---

## Why this matters

Consulting-grade briefings live and die by trust in their evidence.
An LLM that silently fabricates a URL — even a plausible-looking one
— corrupts the reader's ability to verify any claim in the document,
including the ones that were correctly sourced. That is a
non-recoverable failure mode: the reader cannot un-see a fake
citation.

The hardened sourcing layer's job is to make sure Praxis never puts
the reader in that position. Missing sources are loud. Stale sources
are dated. Untrusted sources are declined. Duplicated sources are
audited. Fabricated sources are impossible.
