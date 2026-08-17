# Stakeholder Mapping

Praxis's third agent, introduced in v0.4, produces a structured map of
the actors relevant to a briefing question. It is the first agent
whose input includes both prior outputs (Scoping and Research) and
the first analytical agent in the strong sense — it synthesises a
model of the terrain rather than reformulating or collecting.

This document covers the taxonomy, the sourcing discipline as it
applies to real people and organisations, the hard caps, and the
ethical considerations that shape the prompt.

---

## Why "map" rather than "list"

A raw list of stakeholders is worthless without structure. The
briefing reader needs to know, at a glance:

- who owns the decision,
- who can veto it,
- who bears its consequences,
- who can escalate its cost from outside,
- and which relationships between these actors matter.

The map answers each of those. The five-category vocabulary, the
power/priority bands, and the `key_dynamics` section exist so a reader
can pattern-match the whole map in under two minutes and know where to
spend attention.

---

## The taxonomy

### Category — the actor's role vs the decision

Five categories, exhaustive and mutually exclusive at the coarse
level:

| Category | Meaning |
| --- | --- |
| `decision-maker` | Formally decides. |
| `influencer` | Shapes the decision without owning it. |
| `gatekeeper` | Controls a resource, approval, or channel the decision passes through. |
| `affected-party` | Bears consequences without shaping the call. |
| `external-observer` | Regulators, media, watchdogs — outside the decision but able to escalate cost. |

The vocabulary is deliberately coarse. Sub-typing (regulator vs media
vs union under `external-observer`) may land in a later release; the
extension will be additive.

### Position — where they stand on the direction

`supportive` | `neutral` | `resistant` | `unknown`.

`unknown` is a legitimate answer — pretending otherwise is how a
mapping starts lying. If the agent cannot document a position from
public evidence, it must say so.

### Power — capacity to act

`high` | `medium` | `low`.

Deliberately kept separate from position. A supportive stakeholder
with low power is different from a resistant one with high power; the
map must make that clear.

### Priority — how much attention the engagement plan should give them

`critical` (deal-maker/breaker) | `important` (must be handled) |
`monitor` (watch for change, no active engagement needed).

Priority is a function of the tuple `(category, power, position)` plus
context from the Scoping + Research outputs — not a mechanical
computation.

---

## Sourcing discipline for real people and organisations

Every `position_evidence` field must be EITHER a real
`SourceReference` (URL, title, `accessed_at`, excerpt ≤500 chars) OR
an explicit `SOURCE_MISSING` marker with a `searched_for` string.
This is the same discipline the Research agent applies to findings,
and the runtime enforces it identically at the parse step.

There is one extra consideration that makes stakeholder sourcing more
sensitive than research sourcing: **fabricated evidence about a real
person or organisation is a distinct kind of harm**. A made-up URL in
a market-size claim is misleading; a made-up quote attributed to a
named executive or regulator is defamatory. The prompt reflects that:
when in doubt, the agent must mark `SOURCE_MISSING` and downgrade the
priority accordingly.

The sourcing layer surfaces the discipline as a discriminated
`SourcingWarning`:

```ts
| { kind: "missing_stakeholder_evidence";
    stakeholder_index: number;
    stakeholder_name: string;
    searched_for: string }
```

Under `sourcing_policy: strict`, one missing position kills the whole
mapping run (throws `SourcingValidationError`). Under `permissive`,
missing positions are collected in the report and returned; later
pipeline stages can decide what to do with them.

---

## Hard caps: 3 and 20

The parser enforces `MIN_STAKEHOLDERS = 3` and `MAX_STAKEHOLDERS = 20`.

- Fewer than 3 is treated as a failure: a briefing question that
  produces only two stakeholders is either misscoped or was researched
  too narrowly. The agent throws `StakeholderMappingError` and the
  reader should re-run with a broader lens.
- More than 20 is noise: at that point the map stops being a
  navigable tool and starts being a directory. The agent throws
  `StakeholderMappingError`.

Both caps are values, not policy — a format cannot override them in
v0.4. If a real briefing consistently pushes against them, the caps
should move rather than be relaxed per-format.

---

## Key dynamics and blind spots

Two sections deliberately kept short:

- `key_dynamics` (3-5 items) are RELATIONAL — alliances, tensions,
  dependencies BETWEEN stakeholders. They are not per-actor
  paraphrases. If an item can be understood by reading only one
  stakeholder card, it does not belong here.
- `blind_spots` (0-5 items) is where the agent exercises humility.
  Stakeholders suspected but under-documented, or classes of actor
  the coverage clearly missed. An empty array is a legitimate
  answer — inventing blind spots to look thorough is a failure mode.

The self-assessed `coverage_confidence` (`high` | `medium` | `low`)
completes the audit trail: the reader knows what the agent thinks of
its own work.

---

## Ethical guidance baked into the prompt

The stakeholder prompt (`prompts/stakeholder.prompt`) instructs the
model in plain terms:

> Fabricated evidence about a real person or organisation is not just
> misleading — it can be harmful. When in doubt, prefer SOURCE_MISSING
> and downgrade the priority.

This is not a nice-to-have. It is a load-bearing invariant that keeps
Praxis safe to use in real corporate-affairs, government-relations,
and family-office contexts. A briefing that quietly invents a
regulator's stance can start a wrong-footed engagement that costs
years of trust to unwind.

---

## What v0.4 does *not* do (yet)

- **Cross-format taxonomies.** Every format currently sees the same
  five categories. Government-affairs formats may deserve `agency`
  and `elected-official` sub-types; family-office formats may deserve
  `principal` and `advisor`. The additive extension is scoped for
  v0.6+.
- **Automatic dedupe across agents.** If Research cites a source and
  Stakeholder Mapping cites the same URL as `position_evidence`, both
  are printed. A later Sourcing Layer pass will dedupe.
- **Position change detection.** Positions can flip; v0.4 has no
  notion of history. If a stakeholder used to be supportive and is
  now resistant, that must be captured in `engagement_notes` today.
- **Confidence per stakeholder.** Only the mapping as a whole has
  `coverage_confidence`. Per-stakeholder confidence bands are a
  candidate refinement.

---

## Why this matters

Consulting-grade briefings don't just present facts; they present a
map of who those facts move. A recommendation that ignores a
gatekeeper or over-values an ally fails on execution even when it is
factually correct.

The Stakeholder Mapping agent's job is to make sure Praxis briefings
carry that map explicitly — with sourced positions where the evidence
exists, and clearly-marked gaps where it doesn't.
