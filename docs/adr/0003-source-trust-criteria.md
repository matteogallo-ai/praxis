# ADR 0003 — Criteria for trusting a source: first-party facts and specialist press

Status: proposed, 2026-11-04. The maintainer accepts or amends it; no live
run starts on a changed trust policy before it is accepted.

## Context

Question 05's live briefing (4 Nov 2026, `mckinsey-style-note`, strict) was
flagged insufficiently sourced: 24 of 44 items from untrusted domains. Its
brief cites 33 hosts; the format's `reputation-only` rule trusts 2 of them
(`www.mckinsey.com`, `www.bain.com`). The 31 others, re-evaluated with the
shipped rule on the committed `brief.md` (the record is unchanged), fall into
these groups:

| Group | Hosts in q05 |
| --- | --- |
| The company a claim is about, on its own site | `investor.dsv.com`, `group.dhl.com` |
| Sector press (logistics, finance) | `theloadstar.com`, `trans.info`, `breakbulk.news`, `www.trasportoeuropa.it`, `gfmag.com`, `m.jctrans.com`, `market-insights.upply.com` |
| Sector research firms | `ti-insight.com`, `www.aranca.com`, `imaa-institute.org` |
| Law-firm client memos and legal blogs | `www.aoshearman.com`, `www.sullcrom.com`, `www.cooley.com`, `www.goodwinlaw.com`, `www.mcdermottlaw.com`, `vlolawfirm.com`, `globallawexperts.com`, `legalblogs.wolterskluwer.com` |
| Vendors' and advisers' content marketing | `axiagrowth.com`, `acquisitionstars.com`, `rlhulett.com`, `www.gotara.com`, `www.logisyn.com`, `www.valoremreply.com`, `www.bakertilly.global` |
| Aggregators and republishers | `www.investing.com` |
| Trade bodies and education | `www.rha.uk.net`, `www.pon.harvard.edu`, `executiveeducation.wharton.upenn.edu` |

The trust lists name hosts, not reasons. Two cases are judged wrongly by
any host list:

1. **A company's own site** is the primary source for what that company
   reported, announced or decided. `investor.dsv.com` is untrusted for DSV's
   own acquisition terms, though nothing is closer to the fact.
2. **Specialist press** has no tier. Whether `theloadstar.com` belongs with
   `handelsblatt.com` (tier 2) or with content marketing has no written
   answer, so any change to the list would be a judgment made per host,
   after seeing the result it produces.

Widening the lists until q05 passes would fit the policy to one run. This
record fixes the criteria first; a host joins a list only by meeting them.

## Decision

### 1. A company's own source is primary for its own facts

A source on a host the company controls is trusted **for that company's own
facts only**: its reported figures, announcements, filings, decisions and
stated positions. It is not trusted for claims about other parties, markets,
forecasts or evaluations, including the company's claims about its
competitors or its market.

Deterministic check, so the model proposes and code decides:

- The stage marks the item `first_party_for: "<organisation>"`.
- Code accepts the mark only if the organisation is the item's subject: the
  stakeholder's `name`, or a name in the finding's claim or the risk's text.
- The URL's registrable domain (the host minus subdomains, `dsv.com` for
  `investor.dsv.com`) must contain the organisation's name, normalised to
  lowercase letters and digits (`DSV A/S` → `dsv`). A domain without the name
  (a subsidiary, a rebrand) fails, and the item stays untrusted: a false
  negative costs a flag, a false positive would let any site vouch for
  itself.
- An accepted item is counted as first-party in the sourcing report, not as
  tier 1 or 2, so a reader can see how much of a briefing rests on what
  companies say about themselves.

### 2. Specialist press: a tier defined by criteria

A host joins a format's `tier_2` as specialist press only if it meets
**all** of:

1. **Editorial business.** Its main activity is reporting on a sector. It
   does not sell the product, service or advice its articles discuss, so
   vendors, consultancies writing about their own services, and law firms
   writing for clients fail.
2. **Accountable masthead.** Named editors, and a published corrections
   policy or editorial standards.
3. **Attributed, dated articles.** Each article names its author and its
   publication date.
4. **Sponsored content labelled and separable.** Paid content is marked, and
   on paths the trust rule can exclude.
5. **Original reporting.** It reports, rather than republishing press
   releases or other outlets' wires; aggregators and republishers fail.

Each host added under this rule is listed with the date it was checked and
the evidence for each criterion (the masthead URL, the corrections page) in
`docs/sourcing.md`, and a test fails when a specialist-press entry in a
format has no such row (part of implementing this record, below). Sector research firms, trade bodies and university
pages are not press: they need their own criteria and remain untrusted
until a record gives them.

### 3. What stays untrusted

Law-firm client memos, vendors' and advisers' content marketing, aggregators
and republishers stay untrusted under every format, whatever their quality
on a given page. They are written to win clients or traffic, and the
pipeline cannot tell a fair page from a slanted one (`docs/SYSTEM_CARD.md`).

## Rejected

- **Adding q05's hosts to `tier_2` one by one.** This fits the list to one
  run and leaves no rule for the next host.
- **Letting the model rate a source's trust.** The model would grade its own
  sources. It may propose a first-party mark; code checks it.
- **Dropping `strict` for `mckinsey-style-note`.** The flag is right to say
  what is unverified (ADR 0002); the defect is a list without criteria.
- **Strict `allowed_domains` on web search.** It would hide the sources
  instead of judging them, and would also exclude first-party sites, which
  no list can enumerate in advance.

## Consequences

- No list changes and no code changes in this record. Implementing it takes:
  - `first_party_for` in the research, stakeholder and risk output
    contracts, with an `@version` bump;
  - the domain check;
  - a first-party count in `SourcingReport`, a new optional field;
  - the criteria table and its test.
- Of q05's 24 untrusted items, only those marked first-party (DSV, DHL), or
  citing a press host that meets all five criteria once checked, would
  change category. How many that is, is computed only after the criteria are
  applied, and only as an indication: the record stays as it is.
- Under `strict`, q05's 11 items without a source keep the briefing flagged
  whatever the trust policy.
