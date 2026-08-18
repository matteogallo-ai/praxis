# Risk Analysis Agent

The Risk agent (v0.5, fourth Praxis agent) reads Scoping + Research
+ Stakeholders and produces a structured `RiskAnalysisResult`: a
bounded set of risks, each sourced on both likelihood and impact,
each cross-referenced to a named stakeholder from the mapping, each
paired with concrete mitigations and a residual-risk estimate.

This document covers the philosophy, the taxonomy, the calibration
of likelihood/impact bands, and the cross-agent guarantees the agent
must respect.

---

## Why Risk is different

Scoping reformulates. Research collects. Stakeholders map the
terrain. Risk is the first agent whose output the reader will treat
as *operationally load-bearing*: the reader will approve or defer a
decision partly on the risks named here, and — if the briefing goes
past them — will not go back and re-check the mapping.

That imposes three disciplines the earlier agents do not need:

1. **Every likelihood and impact must be sourced.** Two source
   fields per risk, both under the same discipline as Research
   findings and Stakeholder positions: real `SourceReference` or
   explicit `SOURCE_MISSING`.
2. **Every risk must be linked to at least one stakeholder by exact
   name.** The runtime rejects any risk referencing a name not in
   the supplied `StakeholderMapResult`. Fabricated cross-references
   are structurally impossible.
3. **Every risk must carry mitigations that name a concrete action.**
   Vague mitigations (`"monitor closely"`, `"stay aware"`) are
   rejected by the parser.

---

## Taxonomy

### Category — 8 buckets

| Category         | When to use                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `strategic`      | Trajectory of the organisation is at stake (positioning, competition).      |
| `operational`    | Execution capacity (delivery, hiring, timelines).                           |
| `financial`      | P&L, cash, capital envelope, unit economics.                                |
| `regulatory`     | Formal rules, agencies, licences, audits.                                   |
| `reputational`   | Public trust, media coverage, brand.                                        |
| `geopolitical`   | Cross-border framework shifts (trade, data transfer, sanctions).            |
| `technological`  | Delivery-side technical risk (stack, dependencies, localisation).           |
| `human-capital`  | Key-person, culture, attrition, hiring latency.                             |

The vocabulary is deliberately coarse. Sub-categorisation lives in
the risk's `description`, not in extra enum values.

### Likelihood — 5 bands

| Band       | Meaning                                                            |
| ---------- | ------------------------------------------------------------------ |
| `very-low` | Plausible in principle, no precedent in scope.                     |
| `low`      | Precedent exists but is old or in an adjacent market.              |
| `medium`   | Precedent exists in scope; conditional.                            |
| `high`     | Precedent is recent and directly analogous.                        |
| `very-high`| Precedent is current, in-scope, and preconditions are in place.    |

### Impact — 5 bands

| Band          | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `negligible`  | Absorbed by operational buffer.                                  |
| `minor`       | Quarterly plan adjustment.                                       |
| `moderate`    | Annual plan adjustment; visible externally.                      |
| `major`       | Strategic revision; leadership scrutiny.                         |
| `severe`      | Existential; changes what the organisation is.                   |

### Timeframe — 4 buckets

| Bucket        | Horizon           |
| ------------- | ----------------- |
| `immediate`   | < 3 months        |
| `short-term`  | 3-12 months       |
| `medium-term` | 1-3 years         |
| `long-term`   | > 3 years         |

### Aggregated score

`aggregated_risk_score.overall` is `low | medium | high | critical`.
`critical` is reserved for cases where at least one risk is `severe`
with `likelihood >= high`. `by_category` names a level for every
category that has at least one risk.

---

## Calibration philosophy

Likelihood and impact are estimates. The point of the sourcing
requirement is not that a URL "proves" the number — it is that the
reader can pull the same URL and calibrate their own estimate. When
the model has evidence of a base rate ("34% of comparable expansions
missed payback"), it should use it. When it does not, it must mark
`SOURCE_MISSING` on the evidence field and downgrade its confidence.

Two heuristics from the prompt:

1. **Residual risk is a truthfulness test.** If
   `residual_risk_after_mitigation === likelihood`, the mitigations
   are inadequate. Either strengthen them or accept the residual
   honestly.
2. **Top-3 priorities are by likelihood × impact.** Not by category
   novelty, not by section fit — the reader wants to know which
   three risks matter most. The runtime enforces
   `top_3_priorities.length === min(3, risks.length)`.

---

## Hard caps

| Cap                   | Value | Rationale                                             |
| --------------------- | ----- | ----------------------------------------------------- |
| `MIN_RISKS`           | 5     | Guide; below it, coverage is likely too thin.         |
| `MAX_RISKS`           | 25    | Hard ceiling — raises `RiskInflationError`.           |
| Mitigations per risk  | 1-3   | Ceiling avoids busywork lists.                        |
| Ideal risk count      | 5-15  | The band the prompt asks the model to aim for.        |

The 5-15 band is prompt guidance; the 5 floor is soft (the parser
accepts fewer if the model returns fewer). The 25 ceiling is a hard
throw — the model must NOT pad the list to look thorough.

---

## Cross-stakeholder validation

Every `Risk.affected_stakeholders` entry must match a
`Stakeholder.name` EXACTLY. The parser builds a `Set<string>` from
the supplied `StakeholderMapResult` and rejects any risk that names
an unknown stakeholder with `InvalidRiskStakeholderReference`.

No fuzzy matching. No alias resolution. If the model wants to cite a
stakeholder not in the mapping, it must return SOURCE_MISSING and
add the actor to `unresolved_uncertainties`. The mapping is the
ground truth.

This is deliberate: alias resolution is where a two-line bug becomes
a one-year data-quality incident.

---

## Anti-vague-mitigation heuristic

The parser rejects mitigations that match a small regex of vague
phrases:

```
/^\s*(monitor|watch|keep\s+an\s+eye|track|observe|
      stay\s+aware|be\s+careful|be\s+prepared)(\s+closely)?\.?\s*$/i
```

This catches obvious slips like `"monitor closely"` or `"stay
aware"`. The prompt gives more nuanced examples of *why* those
phrases are inadequate — a mitigation must name an action, an
owner, or a metric.

---

## Runtime errors

- `RiskAnalysisError` — general structural failure (duplicate IDs,
  non-sequential IDs, top-3 references an unknown risk, aggregated
  score misses a required category, mitigation is too vague).
- `InvalidRiskStakeholderReference` — a risk names a stakeholder not
  in the supplied mapping.
- `RiskInflationError` — the model returned more than `MAX_RISKS`
  risks.
- `InvalidAgentOutputError` — the JSON does not match the expected
  shape (wrong types, missing fields, malformed evidence).

All extend `AgentExecutionError`, which extends `PraxisError`.

---

## Pipeline integration

`Orchestrator.assessRisksAfterStakeholders(question, formatId,
options?)` runs the four agents end-to-end, threads a single
`SourcingAccumulator` through their sourcing validations, and
returns:

```ts
{
  scoping: ScopingResult;
  research: ResearchResult;
  stakeholders: StakeholderMapResult;
  risks: RiskAnalysisResult;
  sourcing_report: SourcingReport;   // aggregated cross-agent
}
```

The Orchestrator refuses to run when the format's sections do not
list `research`, `stakeholder`, AND `risk` in their
`required_agents`.

### CLI

```
praxis brief "<question>" --format <id> --with-risks
```

Implies `--with-stakeholders` (which implies `--with-research`); a
stdout note is emitted when used alone. Under `--json`, the combined
payload is emitted as a single JSON object.

Add `--sourcing-report` to print ONLY the aggregated cross-agent
sourcing report (useful for audit).

---

## Why not more categories, wider bands, or free-form text?

The temptation to make risk analysis "more expressive" is why most
risk registers become unusable. Praxis chooses coarse-but-consistent
over fine-but-fragmented:

- 8 categories is enough to sort every real risk. More categories
  invite the model to nitpick.
- 5×5 likelihood/impact bands are what every risk-management text
  in practice uses.
- The `description` field is free-form. That is where nuance lives.

The narrow taxonomy is what lets the aggregated score and top-3
selection be defensible — you cannot rank risks that are typed
inconsistently.
