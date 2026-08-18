# Adversarial Critique agent

The Adversarial Critique agent (v0.7) is the seventh and last agent
in the Praxis pipeline before v1.0. It reads the completed
`BriefResult` (the output of the six upstream agents) and produces a
bounded set of **steelmanned** critiques — the strongest arguments
AGAINST the recommendation, formulated the way a hostile-but-fair
reviewer would raise them.

This document covers the philosophy (why steelman, not strawman),
the taxonomy of critiques, the `revised_recommendation_needed`
derivation logic, and the discipline the parser enforces on the
model's output.

---

## Steelman, never strawman

Every reviewer who matters does three things Praxis needs the
adversarial agent to do:

1. **Steelman.** Formulate the counter-argument at its strongest,
   not its weakest. A critique that beats a strawman is worse than
   no critique — it inoculates the reader against the real
   objection.
2. **Reference precisely.** Point at a specific section, option,
   risk, stakeholder, or finding — not general vibes. Every
   critique in the output MUST target a real element of the brief.
3. **Contain itself.** Three good critiques beat ten mediocre
   ones. Executive attention is finite.

The parser enforces all three: `steelmanned_position` MUST have
≥ 20 words, `target` MUST resolve to an existing artefact, and the
count MUST land between `MIN_CRITIQUES` (3) and `MAX_CRITIQUES`
(15).

---

## Taxonomy of critique categories

Eight categories cover the ways a serious reviewer typically breaks
a briefing:

| Category                    | When to use                                             |
| --------------------------- | ------------------------------------------------------- |
| `hidden-assumption`         | Unstated hypothesis the argument depends on.            |
| `weak-source`               | Source cited but weak (age, authority, bias).           |
| `dismissed-option`          | Option written off without adequate justification.      |
| `overconfidence`            | Affirmation stronger than the evidence supports.        |
| `missing-perspective`       | Stakeholder or dimension absent from the analysis.      |
| `internal-contradiction`    | Two assertions in the brief that clash.                 |
| `risk-underestimated`       | Risk severity below what benchmarks suggest.            |
| `temporal-blind-spot`       | Implicit stability assumption that may not hold.        |

The vocabulary is deliberately closed. If a critique does not fit
one of these boxes, it is probably either (a) something the earlier
agents should have caught, or (b) too general to be actionable.

---

## Severity + robustness + revision derivation

Three levels of `severity`:

- **`minor`** — legitimate but does not change the recommendation.
- **`material`** — recommendation stands but needs an explicit hedge.
- **`critical`** — recommendation should be revisited.

`recommendation_robustness` is DERIVED by the parser from severity
counts and the model's own value is silently corrected:

| Rule                                  | Derived robustness |
| ------------------------------------- | ------------------ |
| `critical ≥ 2` OR `material ≥ 4`     | `low`              |
| `critical ≥ 1` OR `material ≥ 2`     | `medium`           |
| otherwise                             | `high`             |

`revised_recommendation_needed` is DERIVED too, and mismatches
against the model's value raise `AdversarialCritiqueError`:

- **True iff** `critical ≥ 1` OR `material ≥ 3`.
- **If true**, `steelmanned_alternative` MUST be non-empty (the
  reader needs somewhere to land). Missing this raises
  `MissingAlternativeError`.

The design intent: the model can classify severity how it wants,
but the aggregation and the "revise?" verdict are structural, not
stylistic.

---

## The `target` field — precise references only

Every critique MUST target at least one artefact:

```ts
interface CritiqueTarget {
  section_id?: string;     // must match synthesis.sections[].section_id
  option_id?: string;      // must match options.options[].id
  risk_id?: string;        // must match risks.risks[].id
  stakeholder_name?: string;  // must match stakeholders.stakeholders[].name
  finding_index?: number;  // must be a valid index into research.findings
}
```

Multiple fields can be set — a critique about how OPT-A treats
BfDI can name both `option_id: "OPT-A"` and
`stakeholder_name: "BfDI (Federal Commissioner for Data Protection)"`.
The parser rejects any target with zero fields set as
`InvalidCritiqueTargetError`.

Unknown references (a section_id not in the brief, an option_id
absent from the options result, etc.) also raise
`InvalidCritiqueTargetError`. No fuzzy matching — the critique
either points at something real or it does not exist.

---

## Counter-evidence follows the same sourcing rule as Research

`counter_evidence` is either a real `SourceReference`:

```json
{
  "url": "https://…",
  "title": "…",
  "accessed_at": "<ISO 8601 UTC>",
  "excerpt": "<≤500-char passage>"
}
```

or an explicit missing-source marker:

```json
{
  "status": "SOURCE_MISSING",
  "searched_for": "<what you tried>"
}
```

Fabricated counter-evidence is worse than acknowledged absence.

---

## Hard caps

| Cap                      | Value          | Rationale                             |
| ------------------------ | -------------- | ------------------------------------- |
| `MIN_CRITIQUES`          | 3              | Fewer is not a stress-test.           |
| `MAX_CRITIQUES`          | 15             | Beyond is padding.                    |
| `MIN_STEELMAN_WORDS`     | 20             | A steelman needs room to breathe.     |
| `steelmanned_alternative`| required iff revised needed | The reader needs a landing spot. |

---

## Pipeline integration

`Orchestrator.briefWithCritique()` runs the six-agent `brief()`
pipeline and then feeds the complete `BriefResult` to the
adversarial agent. The sourcing report is re-aggregated to cover
the critique's counter-evidence sources.

`brief()` itself is UNCHANGED — API-compatible with v0.6.
`briefWithCritique()` is the opt-in path.

### CLI

```
praxis brief "<question>" --format <id> --full --critique
```

Prints the standard Markdown briefing plus an inline critique
block. Combines with `--render pdf|docx|md-enhanced --output <path>`
to include the critique in the rendered deliverable.

---

## Runtime errors

- `AdversarialCritiqueError` — general structural failure (bad
  critique count, non-sequential IDs, duplicate IDs, steelman
  under length, mismatched severity counts, mismatched revision
  signal).
- `InvalidCritiqueTargetError` — target references an artefact
  absent from the brief, OR target is empty.
- `MissingAlternativeError` — `revised_recommendation_needed=true`
  without a non-null `steelmanned_alternative`.
- `InvalidAgentOutputError` — JSON shape failure.

All extend `AgentExecutionError`, which extends `PraxisError`.

---

## Why not more critiques or more categories?

The temptation is real — more categories look thorough; more
critiques look diligent. Praxis rejects both:

- Eight categories is enough to bucket the failure modes an
  adversarial reviewer actually cares about. More would invite the
  model to nitpick.
- Three-to-ten critiques is the range a decision-maker can hold in
  their head while re-reading the recommendation. Fifteen is the
  ceiling; ten is the ceiling of readability.
- The `steelmanned_alternative` is the load-bearing field — an
  adversarial pass that says "revise please" without saying "here
  is what to do instead" is not a critique, it is a complaint.

The narrow discipline is what lets the adversarial agent ship as a
first-class Praxis step rather than a bolt-on.
