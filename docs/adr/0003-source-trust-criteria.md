# ADR 0003 — Criteria for trusting a source: first-party facts and specialist press

Status: accepted, 2026-11-04, on one condition: the organisation-to-domains
mapping (Decision 1) is explicit, reviewed and versioned. Explicit: each
entry names its domains and the evidence of ownership. Reviewed: an entry is
added or changed only through a pull request the maintainer has read.
Versioned: the file is committed, so git holds every past state; it carries
no version number of its own. Until that file exists on those terms, no item
is accepted as first-party.

## Context

Question 05's live briefing (4 Nov 2026, `mckinsey-style-note`, strict) was
flagged insufficiently sourced: 24 of 44 items from untrusted domains. Its
brief cites 33 hosts; the format's `reputation-only` rule trusts 2 of them
(`www.mckinsey.com`, `www.bain.com`). The 31 others, re-evaluated with the
shipped rule on the committed `brief.md` (the record is unchanged), are
grouped below from the host and the cited page. The grouping illustrates
the problem; it is not the check of any host against the criteria, which is
done host by host before a list changes.

| Group | Hosts in q05 |
| --- | --- |
| The company a claim is about, on its own site | `investor.dsv.com`, `group.dhl.com` |
| Sector press | `theloadstar.com`, `breakbulk.news`, `www.trasportoeuropa.it`, `gfmag.com` |
| Sector press owned by a company of the sector | `trans.info` (Trans.eu, a freight exchange) |
| Sector research firms | `ti-insight.com` |
| Law-firm client memos and legal blogs | `www.aoshearman.com`, `www.sullcrom.com`, `www.cooley.com`, `www.goodwinlaw.com`, `www.mcdermottlaw.com`, `vlolawfirm.com`, `globallawexperts.com`, `legalblogs.wolterskluwer.com` |
| Vendors', advisers' and platforms' content | `axiagrowth.com`, `acquisitionstars.com`, `rlhulett.com`, `www.gotara.com`, `www.logisyn.com`, `www.valoremreply.com`, `www.bakertilly.global`, `www.aranca.com`, `market-insights.upply.com`, `m.jctrans.com` |
| Aggregators and republishers | `www.investing.com` |
| Trade bodies, training and education | `www.rha.uk.net`, `imaa-institute.org`, `www.pon.harvard.edu`, `executiveeducation.wharton.upenn.edu` |

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

A source published by a company is accepted **for that company's own facts
only**: its reported figures, announcements, filings, decisions and stated
positions. It is not accepted for claims about other parties, markets,
forecasts or evaluations, including the company's claims about its
competitors or its market.

What code checks, and what it cannot:

- **The publisher, by an explicit, reviewed, versioned list.** A committed
  file, changed only through a reviewed pull request, maps each
  organisation to the domains it controls (`DSV` → `dsv.com`; `DHL Group` →
  `dhl.com`, `dpdhl.com`), each entry with the page that shows the
  ownership (an annual report, an investor-relations page). A stage marks an
  item `first_party_for: "<organisation>"`; code accepts the mark only if the
  organisation is in the file and the URL's host is one of its domains or a
  subdomain of one, compared label by label. Nothing is inferred from the
  name: `dsvtravel.com` or `mydsv.net` never match `dsv.com`, and a
  subsidiary or rebrand fails until its domain is added. No public-suffix
  list is needed, because every domain is written out.
- **The subject, by name.** The organisation must be the item's subject:
  the stakeholder's `name`, or a name the file lists for it appearing in the
  finding's claim or the risk's text.
- **Not the kind of claim.** Whether a sentence states the company's own
  fact (DSV's reported revenue) or something else (DSV's view of DHL;
  a regulator's decision about a DHL joint venture reported on
  `group.dhl.com`) is the model's judgment; code cannot verify it. First-party
  items are therefore counted apart in the sourcing report and listed apart
  in the briefing, so a reader sees how much rests on what companies say
  about themselves.

Under `strict`, an accepted first-party item is not blocking: it is counted
as first-party, not as untrusted. A mark code refuses leaves the item
untrusted, and blocking as before.

### 2. Specialist press: a tier defined by criteria

A host joins a format's `tier_2` as specialist press only if it meets
**all** of:

1. **Editorial business.** Its main activity is reporting on a sector. It
   does not sell the product, service or advice its articles discuss.
2. **Independent ownership.** It is not owned by, or financially dependent
   on, a company of the sector it covers (a freight exchange's news site
   fails for logistics).
3. **Accountable masthead.** Named editors and a published corrections
   policy.
4. **Attributed, dated articles.** Each article names its author and its
   publication date.
5. **Sponsored content separable.** Paid content is labelled and served
   from a host the trust rule can leave out. The matcher reads hosts, not
   paths, so a site mixing paid and editorial pages on one host fails.
6. **Original reporting.** Of its ten most recent articles on the day it is
   checked, at least eight are not reprints of press releases or of other
   outlets' wires. Aggregators and republishers fail.

Each host added under this rule is listed with the date it was checked and
the evidence for each criterion (masthead, corrections page, owner, the ten
articles). Sector research firms, trade bodies and training or university
pages are not press: they need their own criteria and stay untrusted until a
record gives them.

### 3. What stays untrusted

Law-firm client memos, vendors', advisers' and platforms' content, and
aggregators and republishers stay untrusted under every format, whatever
their quality on a given page. They are written to win clients or traffic,
and the pipeline cannot tell a fair page from a slanted one
(`docs/SYSTEM_CARD.md`).

## Rejected

- **Adding q05's hosts to `tier_2` one by one.** This fits the list to one
  run and leaves no rule for the next host.
- **Matching a company's name inside the domain.** `DSV A/S` normalises to
  `dsvas`, which is in no DSV domain, while `dsv` is a substring of
  look-alike domains a search can return. An explicit list fails safe; a
  name heuristic fails both ways.
- **Letting the model rate a source's trust.** The model would grade its own
  sources. It may propose a first-party mark; code checks the publisher.
- **Dropping `strict` for `mckinsey-style-note`.** The flag is right to say
  what is unverified (ADR 0002); the defect is a list without criteria.
- **Strict `allowed_domains` on web search.** It would hide the sources
  instead of judging them, and would also exclude first-party sites.

## Implementation (4 Nov 2026)

Decision 1 is implemented; Decision 2 is not (no specialist-press host has
been checked against the six criteria).

- The list is `src/sourcing/first-party-organisations.ts`. Its entries are
  the organisations whose own decisions or publications a benchmark question
  is about, each tied to that question; a host a format already trusts
  needs no entry. `tests/sourcing/first-party.test.ts` fails on an entry
  without domains, with a domain that is not written out, or with ownership
  evidence on a host it does not list.
- The rule judges the research, stakeholder and risk sources and, beyond
  what Decision 1 first named, the critique's counter-evidence: a critique
  that cites an organisation's own site for that organisation's own facts is
  as well sourced as a research finding that does. The critique's subject
  text is its steelmanned position. Options' citations are not judged by it.
- Accepted items are listed in `SourcingReport.first_party_sources`, in a
  "First-party sources" section of every briefing, and in every sourcing
  report.

## Amendments

### 4 Nov 2026: a risk's likelihood and impact are not first-party

- **Found by:** the human review of question 10's step 1 briefing (rows 7
  and 8 of its "First-party sources"). `RISK-003 likelihood` on
  ghgprotocol.org and `RISK-008 likelihood` (very-high) on ifrs.org had
  passed all three checks.
- **Why the checks passed:** the host was the organisation's and the risk's
  description named it. But a likelihood or an impact is the model's
  judgement of what may happen, not a decision, rule, publication or figure
  of the organisation. Decision 1 already excluded "forecasts"; the code
  did not apply that to estimates.
- **Change:** a risk's `likelihood_evidence` and `impact_evidence` are never
  first-party. The risk prompt no longer receives the rule or shows
  `first_party_for` in its example (risk.prompt 3.1.1). Research findings,
  stakeholder positions and critique counter-evidence keep the rule.
- **Effect on records:** none is rewritten. Question 10's two items would
  now be counted untrusted; the human review is recorded in
  `benchmarks/outputs/live/README.md`.

## Consequences

- When accepted, this record changed no list and no code. Implementing it took:
  - the organisation-to-domains file, and a test that fails when an entry
    has no ownership evidence;
  - a `CODEOWNERS` entry naming the maintainer for that file, with the
    ruleset on `main` requiring the code owner's review. Until both exist,
    the review is a manual rule;
  - `first_party_for` in the research, stakeholder and risk output
    contracts (and the critique's), with an `@version` bump;
  - the publisher and subject checks;
  - a first-party count in `SourcingReport` (a new optional field) and a
    first-party list in the briefing;
  - the specialist-press evidence table, and a test that fails when a
    specialist-press entry in a format has no row in it.
- Of q05's 24 untrusted items, only those citing a listed company's own
  domain for its own facts, or a press host that meets all six criteria
  once checked, would change category. How many is known only once the
  lists exist, and is reported as an indication: the record stays as it is.
- Under `strict`, q05's 11 items without a source keep the briefing flagged
  whatever the trust policy.
