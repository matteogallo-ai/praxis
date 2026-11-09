# Praxis

[![CI](https://github.com/matteogallo-ai/praxis/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/matteogallo-ai/praxis/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/matteogallo-ai/praxis)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/matteogallo-ai/praxis/badge)](https://scorecard.dev/viewer/?uri=github.com/matteogallo-ai/praxis) ([why some checks stay low](docs/supply-chain.md#scorecard-checks-that-stay-low))

A 7-stage LLM pipeline that turns a business question into an analytical
briefing.

Each briefing follows a format declared in YAML (executive pre-read,
consulting-style note, position paper, family-office memo) and is written
as Markdown, PDF and DOCX.

An LLM-written briefing looks sourced even when it is not. In Praxis, code,
not the model, checks that each sourced item has a URL on a trusted domain
and is not stale by its stated publication date (an undated source is
counted separately), and the briefing lists every item that fails. It does
not check that a page says what the claim says, nor that the URL came from
the search.

## Status

Praxis's value over a single model call is not demonstrated: in a blind
review of one question, the reviewer preferred the single call, and 3 of 4
checked claims in Praxis's briefing were not supported by their source,
against 2 of 4 in the single call's.

Praxis has completed **six briefings against a real model** (4 Nov 2026,
`benchmarks/outputs/live/`), each $3.29 to $4.75 and each flagged
insufficiently sourced; [`docs/SYSTEM_CARD.md`](docs/SYSTEM_CARD.md) gives
them one by one, and an [excerpt](benchmarks/outputs/live/README.md#excerpt-question-12s-answer-and-its-sourcing-flag)
shows one answer and its flag.
Live attempts by commit (3 Nov 2026 and 4 Nov 2026), completed of attempted: fe09710 0 of 1, 7c75a06 1 of 1, 3a7ca6a 1 of 1, 8df678f 4 of 5; 5 earlier attempts, in 1.2.1, failed and left no record.
A human review (4 Nov 2026) covered only question 10's eight first-party
sources, the ones the rule accepted: the reviewer accepted 6 and refused 2
([review](benchmarks/outputs/live/README.md#question-10-human-review-of-its-first-party-sources)).
The quality of the briefings themselves is reviewed for question 12 only, in one blind comparison with a single model call.
On question 12, a blind review (8 Nov 2026, by Praxis's author;
[grades](benchmarks/review/q12/grades.md), [key](benchmarks/review/q12/key.json))
preferred one model call given the same format and search tool, with fewer
searches, at $0.48 to the pipeline's briefing at $4.75. Of one sourced claim
checked per section, 3 of 4 in the pipeline's briefing and 2 of 4 in the
single call's were not supported by their source. Praxis's value over a
single call is not demonstrated: n = 1 question, 1 reviewer who wrote
Praxis, one run per arm, the two runs three days apart on a changing web.
Next step: more questions, and an ablation of the pipeline's stages.
Known limit of that review: key generated and committed by the reviewer
the day before grading ([6e5ed72](https://github.com/matteogallo-ai/praxis/commit/6e5ed72),
then [1d13a80](https://github.com/matteogallo-ai/praxis/commit/1d13a80)); blinding is self-enforced.
The bias would have favoured Praxis; the result went against it.

## Quick start

Requirements: [Bun](https://bun.sh) 1.3 or later and git.

```bash
git clone https://github.com/matteogallo-ai/praxis.git && cd praxis && bun install --frozen-lockfile && bun run cli brief "Should we enter the German market?" --format auto --full
```

That runs on the mock provider: no key, no network, fixture text chosen by
format; each briefing (Markdown, PDF, DOCX) carries the banner
« DONNÉES FICTIVES — mode mock ». The CI
job `clean-clone` runs these steps in an empty directory.
`--provider anthropic` with `ANTHROPIC_API_KEY` set calls the real API and
is paid; `--max-cost-usd` caps a briefing.

## Architecture

```
1 scoping → 2 research → 3 stakeholders → 4 risks → 5 options → 6 synthesis → 7 adversarial review
            (stages 2–5 and 7 use web_search; a sourcing check follows 2, 3 and 4)
```

Each stage reads the typed output of the earlier ones and runs after them;
only the synthesis sections, one model call each, run concurrently. The
adversarial review may trigger one synthesis rerun. Under a `strict`
sourcing policy a missing, stale or untrusted source makes the CLI degrade
the briefing, which then lists every such item, unless no research finding
has a source at all; the library aborts unless asked to degrade (ADR 0002). Module map: [`docs/architecture.md`](docs/architecture.md).

## Features

- Briefing formats as YAML files checked against a typed schema (C01); four ship (C02).
- The seven stages run end to end on the mock provider, a wiring test, not a quality measure (C03); every stage's answer is validated into typed records, malformed output is a typed error (C04).
- Sourcing checks: `SOURCE_MISSING`, freshness, domain trust, duplicates, `strict` or `permissive` (C05); requester-only facts listed separately (C24); an organisation's own site counts only for its own facts, from a reviewed list (C25).
- One bounded synthesis rerun after the adversarial review (C06); `strict_editorial` sections regenerated when they break their rules (C07).
- Markdown, PDF and DOCX renderers (C08); CLI with `--format auto` (C09); library entry point with a typed error hierarchy (C10).
- Anthropic provider with the `web_search` tool loop and bounded retries, tested on API-shaped fixtures (C11); the observed live failures handled, tested on fixtures (C15); checkpoints, `--resume`, cost per stage and a `--max-cost-usd` cap (C16).
- Untrusted content delimited in every prompt, injected instructions rejected, tested on a simulated poisoned result (C17); the API key never reaches stderr or run files (C20).
- `bench:mock` reproducible (C12); paid tests only on opt-in (C13); installs from a clean clone (C19).

Each `Cnn` is a row of [`docs/CLAIMS.md`](docs/CLAIMS.md) naming the tests that prove it; CI fails if one does not pass.
Those tests run on the mock provider and hand-written fixtures: they prove the wiring, not the quality of a model's output.

## Roadmap

- All five protocol questions completing live, with committed run artefacts (02 failed in synthesis, 4 Nov 2026) (C14).
- Live-output quality scored by a judge validated against human labels (C18), with its noise band and planted-error detection (C23).
- Freshness from each page's own age (C21); web search with dynamic filtering, evaluated against the basic tool (C22).

## Formats

| id | intent | length |
| --- | --- | --- |
| `executive-pre-read` | Board / executive decision, 6 sections | ~800 words |
| `mckinsey-style-note` | Situation / Complication / Answer / So-What | ~1200 words |
| `position-paper-corporate` | Public position on a regulatory or policy question | ~1500 words |
| `family-office-memo` | Patrimonial memo, `strict_editorial` | ~1200 words |

One YAML file per format under `formats/` ([`docs/creating-a-format.md`](docs/creating-a-format.md)).
As a library: [`docs/api.md`](docs/api.md); another model provider: [`docs/cookbook.md`](docs/cookbook.md) § 2.

## Development

`bun run typecheck`, `bun test`, `bun run lint` (any warning fails), `bun run check:claims`;
[`CLAUDE.md`](CLAUDE.md) lists every command, the paid ones included, and
[`SECURITY.md`](SECURITY.md) the threat model and how to report a vulnerability.

Built with coding agents: I write the specs, review the pull requests and their tests, and answer for what gets merged.
An audit on 2 Nov 2026 found that the tests proved only wiring and the
published scores graded fixture text; those scores are withdrawn
([`benchmarks/RESULTS.md`](benchmarks/RESULTS.md)). Design decisions: [`docs/adr/`](docs/adr/README.md).

MIT ([`LICENSE`](LICENSE)). Maintainer: Matteo Gallo, matteogallo.office@gmail.com. Bugs via GitHub Issues.
