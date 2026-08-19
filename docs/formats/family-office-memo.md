# Family Office Memo Format

The `family-office-memo` format is Praxis' fourth shipped
briefing template (v1.2.0). It is calibrated for a family
principal or a family council — the audience for which
corporate briefings (`executive-pre-read`,
`mckinsey-style-note`, `position-paper-corporate`) are not the
right register.

The memo is short (three pages, ~1200 words), institution-voiced,
and discreet by design. It goes to the reader in the tone it was
authored for or not at all — the format ships with
`strict_editorial: true` and every rejection axis on `"reject"`,
so Synthesis regenerates any section that trips the forbidden-term
guard, the length cap, or the validation rules rather than
surfacing a warning.

---

## When to use this format

The `family-office-memo` fits patrimonial decisions that carry
governance weight. Typical scenarios:

- **Co-investment authorisation.** A material co-investment
  alongside an external advisor, a peer family, or an
  institutional GP, where the direct-venture sleeve is close to
  its soft ceiling and the council must document a formal
  authorisation.
- **Advisor selection.** Onboarding or replacement of an
  external private banker, family lawyer, or trustee, where the
  fiduciary posture and the alignment with the successor
  generation warrant a written council record.
- **Generational transition governance.** A staged transfer of
  authority to the successor generation on a specific mandate
  (investment committee seat, philanthropy chair, holding
  company board), where the memo captures the terms of the
  transfer and the decisions each side retains.
- **Regulatory or supervisory inquiry response.** A written
  position for a FINMA, BaFin, HMRC, or comparable regulator on
  a matter touching the principal's holding structure.
- **Philanthropic vehicle structuring.** Authorisation of a new
  foundation, endowment, or DAF, including its governance,
  perpetuity horizon, and reporting obligations.

The memo is not the right vehicle for a routine capital-markets
transaction, an operational board decision at a family-owned
operating company, or an executive HR matter. Use the corporate
formats for those.

---

## Structure

The memo has exactly six sections, presented in this order.

| # | Section id                    | Purpose                                                                                                                        | Word cap |
| - | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 1 | `principal-summary`           | One paragraph orienting the principal: what this memo is, what decision is being surfaced, why it matters now.                 | 120      |
| 2 | `context-and-heritage`        | Situate the decision within the long-term patrimonial and governance context — generational timeframe, prior council record.   | 200      |
| 3 | `stakeholders-and-alignment`  | Roles concerned (Principal, Council, Successor Generation, External Trustee, Private Banker, External Advisor, Family Lawyer). | 250      |
| 4 | `options-and-tradeoffs`       | 2–3 realistic courses of action across four dimensions: fiscal exposure, governance impact, generational alignment, reputational surface. | 350      |
| 5 | `risks-and-preservation`      | 3–5 material risks to patrimony or reputation attached to the recommended option, each with a concrete mitigation.             | 200      |
| 6 | `recommended-next-step`       | One sentence: a single concrete next step for the principal or council.                                                        | 80       |

Cumulative section budget (1200 words) matches the memo's
`target_length`.

---

## Tone conventions

The memo is written in a **third-person institutional voice**.
The principal is addressed *through* the document, never as
"you". No journalistic phrasing, no conversational openers, no
sales-pitch adjectives. Sentence structure is short-to-medium
(12–25 words typical), simple hypotactic constructions, no
rhetorical questions.

The `style_guide.forbidden_terms` list bans the standard
corporate-jargon and hype vocabulary (`leverage`, `synergy`,
`unlock value`, `game-changing`, `cutting-edge`, `world-class`,
`seize the opportunity`, `no-brainer`, `low-hanging fruit`,
`at the end of the day`, `moving forward`, `going forward`,
`obviously`, `clearly`, `arguably`, ...) — a rejected term
triggers a regeneration attempt under `strict_editorial: true`.

---

## Discretion protocols

Named individuals appear only when they are (a) publicly
documented (regulatory filings, press releases, published
interviews) or (b) explicitly authorised via
`scoping.reformulated_question`. Otherwise, the memo speaks in
**roles**:

- **Principal** — the family member holding ultimate authority
  on the file.
- **Family Council** — the standing governance body ratifying
  material patrimonial decisions.
- **Successor Generation** — collective reference to the next
  generation inheriting the exposure.
- **External Trustee** — the independent trustee overseeing
  fiduciary compliance for the holding structure.
- **Private Banker** — the custodian and lending counterparty.
- **Family Lawyer** — independent counsel for governance and
  transactional review. (Referenced in prose as "the retained
  counsel" to avoid the forbidden phrase "the family lawyer".)
- **External Advisor** — third-party advisor to the file,
  possibly with a concurrent counterparty role.

The forbidden term `"the family"` is banned globally to force
the roles vocabulary in every section.

---

## Sourcing standards

The memo uses a **reputation-only** domain-trust model with
three tiers, `min_tier: 2` (so tier-3 is excluded by default):

**Tier 1** — institutional patrimonial anchors:

- FT, Reuters, Bloomberg, WSJ, Economist
- Government sources (`*.gov`, `*.gov.uk`, `*.admin.ch`,
  `*.finma.ch`, `*.esma.europa.eu`)
- OECD, BIS, IMF
- Campden FB (the reference family-office trade press)

**Tier 2** — family-office and private-wealth trade:

- Wealth Briefing, Family Officer, Family Office Network
- Private Banker International
- Law360
- STEP (Society of Trust and Estate Practitioners)

**Tier 3** — general reference (Wikipedia). Excluded by default
because `min_tier` is `2`; can be admitted only by relaxing the
format-level policy.

**Freshness:** sources older than **5 years** (`1825` days) are
rejected under the strict policy; sources older than **3 years**
(`1095` days) trigger a warning. This is materially longer than
the corporate formats' 1-to-2 year windows — patrimonial
decisions digest over longer horizons and rely more heavily on
practice notes, statutes, and multi-year benchmarks.

---

## Example use cases

The v1.2.0 shipped benchmark
(`benchmarks/questions.yaml`, id `11-family-office-co-investment`)
exercises the format on: *"Should the family council approve the
co-investment opportunity in the Zurich-based fintech proposed by
our external advisor?"* The full 12 mock-llm fixtures produce a
complete, sourced, format-conformant memo end-to-end via
`bun run bench:mock`.

Other candidate briefings the format would fit naturally:

- Selection of a new external private banker after a coverage
  reorganisation at the incumbent.
- Governance of a staged transfer of the investment-committee
  chair to the successor generation over a three-year horizon.
- Authorisation of a philanthropic foundation with a
  50-year perpetuity horizon and a cross-jurisdictional
  reporting footprint.
- Written response to a FINMA supervisory inquiry on beneficial
  ownership disclosure for a Swiss-domiciled portfolio company.

---

## Reference commands

Validate the format:

```bash
bun run cli formats validate formats/family-office-memo.yaml
```

Inspect the full section tree:

```bash
bun run cli formats inspect family-office-memo
```

Produce a full brief against the mock provider:

```bash
bun run cli brief "Should the family council approve the co-investment opportunity in the Zurich-based fintech proposed by our external advisor?" \
  --format family-office-memo --full --render pdf --output brief.pdf
```
