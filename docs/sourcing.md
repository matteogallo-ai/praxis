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
on Y"`, `"median deal size for German mid-market SaaS"`). Future
releases will use these strings to drive automated retries and to
surface residual research debt in the final briefing.

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

`FreshnessRule` classifies each source's `accessed_at` age (relative
to the pipeline's `now`) as `fresh`, `warn`, or `stale`:

- `age <= warn_after_days` → **fresh** (no warning)
- `warn_after_days < age <= max_source_age_days` → **warn** (soft
  warning, non-blocking under strict)
- `age > max_source_age_days` → **stale** (blocking under strict,
  raises `StaleSourceError`)

Malformed `accessed_at` timestamps are treated as `stale`. The
`warn_after_days <= max_source_age_days` invariant is validated at
format load time.

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
}
```

Categorisation is "most severe wins": if an item is both stale AND
untrusted, it lands in the `untrusted` bucket. Category counts
reconcile with `total_items`.

Under `strict`, the report is bundled into
`SourcingValidationError.report` (or a typed subclass). Under
`permissive`, the caller receives the report directly.

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
