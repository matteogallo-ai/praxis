# Options Generation Agent

The Options agent (v0.6, fifth Praxis agent) reads Scoping +
Research + Stakeholders + Risks — every prior artefact — and
produces a bounded set of decision options: 2 to 4
mutually-exclusive courses of action, each with concrete tradeoff
dimensions, cross-referenced stakeholder impact predictions and
risk implications, and exactly one option marked `recommended`.

This document covers the philosophy, the discipline the parser
enforces, and the intent behind the shape of the output.

---

## Why Options is different

Scoping reformulates. Research collects. Stakeholders map the
terrain. Risks name the ways the plan could break. Options is the
first agent whose output the reader will use to make a decision
directly: they will pick one option, or ask you to sharpen the
choice. Every design decision in this agent flows from that use.

That imposes three disciplines the earlier agents did not need:

1. **The list must be a real choice.** Options that are variations
   of the same approach do not force a decision — they hide it.
   The prompt asks for mutually-exclusive top-level courses of
   action.
2. **The tradeoffs must be concrete.** `pros` / `cons` /
   `advantages` / `disadvantages` are rejected at parse time,
   case-insensitive. A reader cannot weigh vague labels.
3. **Exactly one option must be recommended.** Refusing to pick is
   the most common form of executive-briefing failure. The parser
   enforces `recommendation_level === "recommended"` on exactly one
   option, and `recommended_option_id` must match that option's id.

---

## The shape of an Option

| Field                         | Notes                                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| `id`                          | `OPT-A`, `OPT-B`, `OPT-C`, `OPT-D` — sequential.                       |
| `title`                       | Short noun-phrase headline.                                            |
| `summary`                     | 2-3 sentences describing the option in operational terms.              |
| `tradeoffs`                   | 3-6 concrete dimensions. Vague labels rejected.                        |
| `stakeholder_impact`          | Cross-referenced predicted reactions, per affected stakeholder.        |
| `risks_mitigated` / `risks_introduced` | Risk IDs the option addresses or creates. Cross-checked.      |
| `dependencies`                | Prerequisites for execution.                                           |
| `time_horizon`                | Reuses the risk-analysis vocabulary (immediate / short / medium / long). |
| `recommendation_level`        | `recommended` / `acceptable` / `not-recommended`.                      |
| `supporting_evidence`         | Real `SourceReference` OR explicit `SOURCE_MISSING`.                    |

### Recommendation levels — the three-band vocabulary

- **`recommended`** (exactly one): the option the agent proposes
  the reader picks. The `rationale_for_recommendation` argues WHY
  this option beats the alternatives.
- **`acceptable`**: a defensible fallback. A rational reader could
  pick this option instead; the recommendation is a judgment call
  the agent has taken but honestly names.
- **`not-recommended`**: considered and set aside on the merits.
  The `counter_arguments_considered` array explains why. Options
  that reach this level are NOT filler — they are the honesty
  signal that says "we looked at this and rejected it".

### The tradeoff dimension rejection list

The parser rejects the following dimension labels (case-insensitive):

```
pros, cons, advantages, disadvantages, strengths, weaknesses,
general, positives, negatives, benefits, drawbacks
```

Use concrete labels instead:

```
cost, capital-envelope, time-to-market, time-to-first-reference,
regulatory-exposure, reversibility, strategic-control,
competitive-signal, talent-required, board-narrative,
integration-risk, payback-horizon, …
```

The rejection is deliberate — a reader who sees "pros: cheap and
fast" cannot weigh "cheap" against "fast" against the OTHER
option's "cheap and slow". A reader who sees "cost: €5m envelope"
and "time-to-market: 9 months" can.

---

## Cross-artefact validation

Every entry in `stakeholder_impact[].stakeholder_name` MUST match a
`Stakeholder.name` in the supplied `StakeholderMapResult` EXACTLY.
Every id in `risks_mitigated[]` and `risks_introduced[]` MUST match
a `Risk.id` in the supplied `RiskAnalysisResult` EXACTLY. No fuzzy
matching. No alias resolution. Failures raise
`InvalidOptionStakeholderReference` or `InvalidOptionRiskReference`.

Additionally: a single risk cannot be in both `risks_mitigated` and
`risks_introduced` for the same option. If the agent believes an
option BOTH mitigates and introduces a risk, that is a signal the
risk needs to be split into two risks upstream, not that the option
is ambiguous.

---

## Hard caps

| Cap                       | Value | Rationale                                       |
| ------------------------- | ----- | ----------------------------------------------- |
| `MIN_OPTIONS`             | 2     | Fewer than 2 undermines "genuine choice".       |
| `MAX_OPTIONS`             | 4     | Beyond 4 the reader cannot hold the space.      |
| Tradeoffs per option      | 3-6   | Fewer is under-analysed; more is padding.       |
| Recommended options       | 1     | Exactly one. Enforced by the parser.            |
| `top_3_priorities`        | n/a   | Options does not surface a priority list — the recommendation IS the priority. |

---

## Runtime errors

- `OptionsGenerationError` — general structural failure (bad
  option count, non-sequential IDs, duplicate tradeoff dimensions,
  no or too many recommended options, `recommended_option_id`
  mismatch, risk in both mitigated and introduced).
- `InvalidOptionStakeholderReference` — a stakeholder name in
  `stakeholder_impact` is not in the supplied
  `StakeholderMapResult`.
- `InvalidOptionRiskReference` — a risk id in `risks_mitigated` or
  `risks_introduced` is not in the supplied `RiskAnalysisResult`.
- `InvalidAgentOutputError` — the JSON does not match the expected
  shape (wrong types, missing fields, malformed source).

All extend `AgentExecutionError`, which extends `PraxisError`.

---

## Pipeline integration

Options is called by `Orchestrator.brief()` after Risks and before
Synthesis. Synthesis then weaves the recommended option (and, where
relevant, the counter-argument summary of the non-recommended ones)
into the format's `recommendation` / `answer` / `our-position`
section.

The three shipped formats declare Options in a section that carries
the recommendation:
- `executive-pre-read` — `recommendation` section
- `mckinsey-style-note` — `supporting-arguments` section
- `position-paper-corporate` — `rationale` section

---

## Why not more options, more tradeoffs, or a "no clear winner" mode?

The temptation is real. Two options feels sparse; five options
feels thorough. The parser is intentionally strict because:

- Two-to-four options is the range that executive readers can hold
  in their head while reading a short briefing. Five options is a
  workshop, not a brief.
- "No clear winner" mode would remove the discipline that forces
  the agent to take a stand. The agent can flag its uncertainty in
  `unresolved_uncertainties` — but it must still recommend.
- Vague tradeoff labels are how bad options-generation looks
  competent. The strict list catches obvious lapses.

The narrow shape is what makes Synthesis's job possible. A
free-form options list would produce a free-form recommendation
section, which is exactly what the target formats forbid.
