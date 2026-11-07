# Praxis

[![CI](https://github.com/matteogallo-ai/praxis/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/matteogallo-ai/praxis/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/matteogallo-ai/praxis)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/matteogallo-ai/praxis/badge)](https://scorecard.dev/viewer/?uri=github.com/matteogallo-ai/praxis) ([why some checks stay low](docs/supply-chain.md#scorecard-checks-that-stay-low))

> A 7-stage LLM pipeline that turns a business question into an analytical
> briefing shaped by a declared format (executive pre-read, consulting-style
> note, position paper, family-office memo), with sourcing checks, an
> adversarial review and Markdown / PDF / DOCX output.

## Excerpt from a live briefing

Extract, not edited, from question 12's step 1 briefing (4 Nov 2026),
which is flagged insufficiently sourced. The lines are copied as the
pipeline wrote them. Lines 90–100 hold the answer and its cited sources:

```markdown
## Answer

The requester should hold Moroccan factory capital until EU origin rules are final. Within 12 months, it should license a cell design, obtain toll-made samples and sign named buyers. That avoids Gotion-scale exposure, reported at $1.3bn for phase one.

No European OEM sodium-ion demand is documented. EEA-only Battery Booster loans and split Council positions leave Moroccan origin status open. Choose Morocco or Iberia only after a sourced landed-cost benchmark exists.

**Sources:**

- [Gotion Starts Up Morocco's First Battery Gigafactory](https://www.winssolutions.org/gotion-kenitra-battery-gigafactory-morocco/)
- [Commission seeks projects to fund under Battery Booster Facility - Internal Market, Industry, Entrepreneurship and SMEs](https://single-market-economy.ec.europa.eu/news/commission-seeks-projects-fund-under-battery-booster-facility-2026-07-28_en)
- [Made in Europe: the Industrial Accelerator Act and your BOM · GETMILK](https://getmilk.tech/blog/how-much-of-your-product-is-made-in-europe)
```

Lines 101–172 are omitted. Lines 102–109 are a validation note that
viewers hide. It says the answer follows the critique's steelmanned
alternative rather than the recommended option, and that its toll-made
sample route comes from that alternative, not from a cited source.
Lines 173–179 start the sourcing flag; its first item is the first source
the answer cites:

```markdown
## Insufficiently sourced

This format's sourcing policy is strict. The 39 item(s) below did not meet it.
They stayed in the analysis that produced this briefing; treat every statement
that rests on them as unverified.

- **research item 1**: https://www.winssolutions.org/gotion-kenitra-battery-gigafactory-morocco/ is not a trusted domain (host 'www.winssolutions.org' matches no reputation tier).
```

The flag lists 39 items where the Status below counts 6 without a source and
32 from untrusted domains: the remaining item is option OPT-B's citation on an
untrusted host, which the flag lists and those two counts do not include.

Full briefing: [`brief.md`](benchmarks/outputs/live/12-sodium-ion-plant-morocco/run-2026-11-04T13-20-16-572Z/brief.md) · [`brief.pdf`](benchmarks/outputs/live/12-sodium-ion-plant-morocco/run-2026-11-04T13-20-16-572Z/brief.pdf).

## Status: six live briefings completed, their quality not reviewed

Praxis has completed **six briefings against a real model**, on questions
05, 08, 10, 11 and 12, 4 Nov 2026 (`benchmarks/outputs/live/`):

- question 05, step 0: $3.51, flagged insufficiently sourced: 11 of 44 items without a source, 24 from untrusted domains;
- question 05, rerun after the sourcing fixes: $3.69, flagged insufficiently sourced: 8 of 47 items without a source, 17 from untrusted domains;
- question 08 (step 1): $3.66, flagged insufficiently sourced: 15 of 47 items without a source, 16 from untrusted domains;
- question 10 (step 1): $3.92, flagged insufficiently sourced: 6 of 46 items without a source, 19 from untrusted domains;
- question 11 (step 1): $3.29, flagged insufficiently sourced: 13 of 41 items without a source, 23 from untrusted domains;
- question 12 (step 1): $4.75, flagged insufficiently sourced: 6 of 49 items without a source, 32 from untrusted domains.

Every one is flagged insufficiently sourced; the runs are compared in
[`benchmarks/outputs/live/README.md`](benchmarks/outputs/live/README.md).
A human review (4 Nov 2026) covered only question 10's eight first-party
sources, the ones the rule accepted: the reviewer accepted 6 and refused 2
([review](benchmarks/outputs/live/README.md#question-10-human-review-of-its-first-party-sources)).
The quality of the briefings themselves is not reviewed, for any question.
Live attempts by commit (3 Nov 2026 and 4 Nov 2026), completed of attempted: fe09710 0 of 1, 7c75a06 1 of 1, 3a7ca6a 1 of 1, 8df678f 4 of 5; 5 earlier attempts, in 1.2.1, failed and left no record. In
[`CHANGELOG.md` § 1.2.1](CHANGELOG.md), three aborted on the
`strict` sourcing policy because the model returned findings without
source URLs, one on prose before the JSON, one on a 60 s timeout during
web search. On 3 Nov 2026 the risk stage's answer was cut at its
`max_tokens`; on 4 Nov 2026 question 02's synthesis section was refused
and its retry too, the last time for a `www.` address in its prose. Everything listed under [Features](#features) is
proven on the mock provider, which replays hand-written fixtures; that proves
the wiring, not the quality of a model's output.

Making the live path work, and measuring it (cost, tokens, duration, a scored
sample), is the work under [Roadmap](#roadmap).

## Architecture

Seven stages in a fixed order, each receiving the earlier stages' typed
output. The stages run one after another; inside the synthesis stage, the
format's sections are written by one call each, concurrently
(`src/agents/synthesis.ts`).

```mermaid
flowchart LR
    Q([Question + format]) --> S1[1 Scoping]
    S1 --> S2[2 Research<br/>web_search]
    S2 --> V2{{sourcing check}}
    V2 --> S3[3 Stakeholders<br/>web_search]
    S3 --> V3{{sourcing check}}
    V3 --> S4[4 Risks<br/>web_search]
    S4 --> V4{{sourcing check}}
    V4 --> S5[5 Options<br/>web_search]
    S5 --> S6[6 Synthesis<br/>one call per section,<br/>sections in parallel]
    S6 --> S7[7 Adversarial review<br/>web_search]
    S7 -- revised recommendation needed --> S6b[Synthesis rerun<br/>at most once]
    S7 --> R([Renderers<br/>md · pdf · docx])
    S6b --> R
```

| Stage | Reads | Writes |
| --- | --- | --- |
| 1 Scoping | question, format | reformulated question, sub-questions |
| 2 Research | scoping | sourced findings |
| 3 Stakeholders | scoping, research | stakeholders and positions |
| 4 Risks | scoping, research, stakeholders | risks, likelihood, impact, mitigations |
| 5 Options | stages 1–4 | 2–4 options with trade-offs |
| 6 Synthesis | stages 1–5, format sections | one text per format section |
| 7 Adversarial review | the assembled brief | critiques and whether to revise |

The sourcing check after stages 2–4, and the domain check on the options'
citations, enforce the format's `sourcing_policy`:
under `strict` a missing, stale or untrusted source aborts the brief; under
`permissive` it is reported. A source is stale only by its publication date;
without one its freshness is unknown and counted apart. The research,
stakeholder, risk and options prompts ask for the date the page states and
name the format's trusted hosts, as guidance, not as a search filter. `docs/architecture.md` has the module map.

## Quick start

Requirements: [Bun](https://bun.sh) 1.3 or later and git. Everything else,
[PromptLang](https://github.com/matteogallo-ai/promptlang) included
(`@promptlang/core`), comes from npm through the lockfile.

```bash
git clone https://github.com/matteogallo-ai/praxis.git && cd praxis && bun install --frozen-lockfile && bun run cli brief "Should we enter the German market?" --format auto --full
```

The CI job `clean-clone` runs exactly these steps, plus `bun test`, in a
directory with nothing else in it.

That runs on the mock provider: no key, no network. Its text comes from
fixtures chosen by format, so every question with the same format gets the
same briefing.

`--provider anthropic` with `ANTHROPIC_API_KEY` set calls the real API. It is
paid, and in its current state it is expected to fail (see Status).

## Features

- Briefing formats as YAML files checked against a typed schema (C01); four of them ship (C02).
- Seven stages run end to end on the mock provider; pipeline smoke test, not a quality measure (C03).
- Every stage's model output is parsed and validated into typed records; malformed output is a typed error (C04).
- Sourcing checks: explicit `SOURCE_MISSING` markers, freshness, domain trust, cross-stage duplicates, `strict` or `permissive` (C05).
- One bounded synthesis rerun when the adversarial review asks for it (C06).
- `strict_editorial` formats regenerate sections that break their rules (C07).
- Markdown, PDF and DOCX renderers (C08).
- CLI with format listing, inspection, validation and keyword-based `--format auto` (C09).
- Library entry point with a typed error hierarchy (C10).
- Anthropic provider with the server-side `web_search` tool loop and bounded retries, tested against hand-written API-shaped fixtures, not the live API (C11).
- Reproducible mock benchmark: `bun run bench:mock` twice leaves `git status` clean (C12).
- Paid live tests run only on explicit opt-in (C13).
- Handling of the three observed live failures: prose around the JSON, a degraded briefing instead of an abort under `strict` sourcing, per-stage timeouts; tested on fixtures, not live (C15).
- `brief --full` checkpoints every stage and resumes a failed run with `--resume <run-id>`; bounded retry per stage; tokens and cost per stage in `metadata.json`; `--max-cost-usd` budget cap (C16).
- Untrusted content (earlier stages' output, web page excerpts) delimited in every prompt; answers that obey an injected instruction are rejected; tested on a simulated poisoned search result, not against a live model (C17).
- The API key never reaches stderr, run files or a printed provider; home paths and e-mail addresses in stderr are masked (C20).
- Installs and runs from a clean clone, with PromptLang from npm (C19).
- Facts only the requester can supply are listed in the briefing as "Requester-provided, not sourceable" and counted apart, never as sourced (C24).
- An organisation's own site counts as a source for its own facts only when a reviewed list names the organisation and its domains and the item names it; such sources are listed apart in the briefing (C25).

Each `Cnn` is a row of [`docs/CLAIMS.md`](docs/CLAIMS.md) naming the tests that
prove it; CI fails if one of them does not pass.

## Roadmap

- Live briefings that complete against Anthropic, with committed run artefacts (C14).
- Live-output quality scored by a judge validated against human labels (C18).
- Source freshness checked against each page's own age (`page_age`) (C21).
- Web search with dynamic filtering (`web_search_20260209`), evaluated against the basic tool (C22).
- The judge's noise band and planted-error detection; today each briefing is judged once (C23).

## Formats

| id | intent | length |
| --- | --- | --- |
| `executive-pre-read` | Board / executive decision, 6 sections | ~800 words |
| `mckinsey-style-note` | Situation / Complication / Answer / So-What | ~1200 words |
| `position-paper-corporate` | Public position on a regulatory or policy question | ~1500 words |
| `family-office-memo` | Patrimonial memo, `strict_editorial` | ~1200 words |

A format is one YAML file under `formats/`; see
[`docs/creating-a-format.md`](docs/creating-a-format.md).

## As a library

```ts
import { FormatRegistry, MockLLMProvider, Orchestrator } from "praxis";

const registry = new FormatRegistry();
registry.loadDirectory("formats");
const orch = new Orchestrator(
  registry,
  new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" })
);
const out = await orch.briefWithCritiqueAndRerun(
  "Should we enter the German market?",
  "executive-pre-read"
);
console.log(out.synthesis.total_word_count, out.rerun_performed);
```

Reference: [`docs/api.md`](docs/api.md).

## Development

```bash
bun install --frozen-lockfile
bun run typecheck                    # tsc --noEmit, strict
bun test                             # mock provider only; live tests need PRAXIS_LIVE_TESTS=1
bun run lint                         # Biome; any warning fails
bun run knip                         # unused files, exports, dependencies
bun run check:claims                 # docs/CLAIMS.md ≡ passing tests ≡ this README
bun run check:stale-narrative        # no future tense or untracked TODOs in shipped text
bun run bench:mock                   # renderer smoke test, writes benchmarks/outputs/mock/
```

`CLAUDE.md` lists every command, including the paid ones. The `.claude/`
directory holds the Claude Code permission settings used to build this repo:
reads, tests, `bun run *` and commits are allowed without a prompt;
`git push`, `git tag`, `curl`, `wget`, `rm -rf` and `npm install` are denied,
and so are the paid entry points: `bun run bench` and `bun run bench:live`,
every `bun run score*` script (including the free `score:dry`), and any
command starting with `PRAXIS_LIVE_TESTS=1`. `bun run bench:mock` stays
allowed. The deny rules match command prefixes, so they are a backstop, not
a guarantee: the approval rule in `CLAUDE.md` still applies to every paid run.

## How this was built

Praxis was written with [Claude Code](https://claude.com/claude-code) between
14 and 20 August 2026, v0.1 to v1.3.0 in about 135 commits. Each release
started from a written spec; the agent wrote the code, the tests and the
fixtures.

What went wrong is instructive:

- **The tests could only prove wiring.** Every agent was developed against a
  mock provider that returns hand-written, perfectly formed JSON with four
  verified sources per finding. A real model does not behave like that, and
  the first live benchmark aborted on all five briefings (Status above).
- **The benchmark measured the fixtures.** The published "AI-assisted
  scoring" graded mock briefings whose text does not depend on the question;
  a follow-up release rewrote fixtures by hand and planned to re-score them.
  Those scores are withdrawn ([`benchmarks/RESULTS.md`](benchmarks/RESULTS.md)).
- **The project was declared feature-complete without a live briefing,**
  and the README claimed it "runs live against Anthropic".

An independent audit on 2 November 2026 found the above, plus: no CI; a
quickstart that fails on a fresh clone (it omitted the sibling PromptLang
checkout); every stage sending its system prompt concatenated into
the user message; and the `@model` declared in each `.prompt` file never
reaching the API. This README, `docs/CLAIMS.md`, the CI workflow and
[`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md) are the first
response; the fixes to the pipeline itself are listed under Roadmap.
The design decisions, and what I would do differently, are in
[`docs/adr/`](docs/adr/README.md).

## FAQ

**Why `pdfkit`?** Writing PDF font embedding by hand would triple the renderer
for no gain. The DOCX renderer writes its Open Packaging parts by hand with
`node:zlib`.

**Can I use another model provider?** Implement `LLMProvider` (`complete`, and
`completeWithTools` for the web-search stages) and pass it to the
`Orchestrator`. See [`docs/cookbook.md`](docs/cookbook.md) § 2.

## License, contact

MIT, see [`LICENSE`](LICENSE). Maintainer: Matteo Gallo —
matteogallo.office@gmail.com. Bugs and requests via GitHub Issues; security
reports as described in [`SECURITY.md`](SECURITY.md).
