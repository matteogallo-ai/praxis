# Praxis

![tests: 1100+](https://img.shields.io/badge/tests-1100%2B-brightgreen)
![bun: 1.3+](https://img.shields.io/badge/bun-1.3%2B-orange)
![typescript: strict](https://img.shields.io/badge/typescript-strict-blue)
![license: MIT](https://img.shields.io/badge/license-MIT-lightgrey)
![release: v1.0](https://img.shields.io/badge/release-v1.0-brightgreen)
![status](https://img.shields.io/badge/status-feature--complete_at_v1.3.0-blue)

> Multi-agent briefing system that produces senior-analyst-grade
> documents in your organization's exact format — with rigorous
> sourcing, adversarial stress-testing, and PDF / DOCX / Markdown
> renderers.

Praxis is CLI-first and library-second. Zero paid dependencies
beyond `pdfkit` (see § FAQ). Runs offline against a
fixture-driven mock provider; runs live against Anthropic when
you export a key.

---

## Project status

Praxis reached **feature completeness at v1.3.0**. The pipeline,
formats, renderers, sourcing layer, and library API are stable.
One patch release (v1.3.1) is planned to add empirical validation
of the v1.3.0 framing improvements. After v1.3.1, Praxis enters
maintenance mode.

See [`ROADMAP.md`](./ROADMAP.md) for the closure plan and
post-v1.3.1 status.

---

## What Praxis does

Ask a question. Get an analytical briefing shaped like a
consultant's:

```
$ bun run cli brief "Should we enter the German market?" \
    --format executive-pre-read --full

---
question: "Should we enter the German market?"
format: "executive-pre-read"
recommended_option: "OPT-A"
aggregated_risk: "high"
sourcing_summary: "total=29 ok=28 stale=0 untrusted=0 duplicated=1 missing=0"
total_word_count: 338
---

# Should we enter the German market?

## Context
The German market represents Europe's largest SaaS opportunity
outside the UK, with a 2026 addressable spend of €14.2bn…

## Recommendation
Enter Germany via a Munich-based sales beachhead in Q2 2027,
with a capped €4-6m first-year envelope and an explicit reversal
option at month 9. (see OPT-A.)

## Risks and Mitigations
- RISK-001 (regulatory): the EU AI Act's GPAI provisions apply…
```

The pipeline behind that: seven analytical agents (Scoping,
Research, Stakeholders, Risks, Options, Synthesis, Adversarial
Critique), a hardened sourcing layer, an optional editorial
re-run loop, and three renderers.

---

## Quick start

Three commands.

```bash
git clone https://github.com/matteogallo-ai/praxis.git
cd praxis && bun install
bun run cli brief "Should we enter the German market?" --format auto --full
```

That's the offline path (mock provider, no API key). For live
briefings against Anthropic:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run cli brief "Q" --format auto --full --provider anthropic
```

For the 5-minute walkthrough (formats, rendering, verbosity, the
editorial re-run loop) see [`docs/getting-started.md`](docs/getting-started.md).

---

## How it works

Seven agents. Deterministic sequencing. Every agent's output is
a typed JSON record the next stage validates.

```
┌─────────────┐   ┌──────────────┐   ┌───────────────┐
│  Scoping    │──▶│  Research    │──▶│ Stakeholders  │
└─────────────┘   └──────────────┘   └───────────────┘
                          │                  │
                          ▼                  ▼
                  ┌─────────────────────────────────┐
                  │   Hardened sourcing layer       │
                  │  (freshness · trust · dedupe)   │
                  └─────────────────────────────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
           ┌─────────┐    ┌─────────┐    ┌─────────────┐
           │  Risks  │──▶ │ Options │──▶ │ Synthesis   │
           └─────────┘    └─────────┘    └─────────────┘
                                                │
                                                ▼
                                     ┌───────────────────┐
                                     │  Adversarial      │
                                     │  Critique         │
                                     └───────────────────┘
                                                │
                     (optional v0.8 loop)       │
                     ┌──────────────────────────┤
                     ▼                          ▼
             ┌─────────────┐           ┌─────────────────┐
             │  Rerun in   │           │  Renderers      │
             │ REVISION    │           │  md · pdf · docx│
             │  MODE (×1)  │           └─────────────────┘
             └─────────────┘
```

Design notes:

- **Format discipline is enforced upstream.** Every section's
  tone directives, max-length, `forbidden_terms`, and
  `validation_rules` are contract, not documentation. The
  Synthesis agent respects them; the optional
  `strict_editorial` mode makes them structural.
- **Sources are structural.** Every finding, position, and
  risk-evidence carries either a real `SourceReference` or an
  explicit `SOURCE_MISSING` marker. Fabricated URLs are
  structurally forbidden.
- **The critique is a stress test, not decoration.** The
  Adversarial agent produces 3–15 steelmanned counter-arguments;
  if the derived signal flags the recommendation, the editorial
  re-run loop invokes Synthesis a second time to address them.
  Hard cap: one rerun (no oscillation).

---

## Formats included

Four shipped formats calibrated across the corporate and
patrimonial briefing spectrum:

| id                         | intent                                                             | length      | targets       |
| -------------------------- | ------------------------------------------------------------------ | ----------- | ------------- |
| `executive-pre-read`       | Board / executive decision, 6 sections                             | ~800 words  | md, pdf       |
| `mckinsey-style-note`      | Situation / Complication / Answer / So-What arc                    | ~1200 words | md, pdf, docx |
| `position-paper-corporate` | Public position on a regulatory or policy question                 | ~1500 words | pdf, docx     |
| `family-office-memo`       | Discreet patrimonial memo for a family principal or family council | ~1200 words | md, pdf, docx |

The `family-office-memo` format (shipped in v1.2.0) enforces a
strict-editorial posture — sections that trip forbidden terms,
length caps, or validation rules are rejected and regenerated
rather than surfaced as warnings. See
[`docs/formats/family-office-memo.md`](docs/formats/family-office-memo.md)
for the discretion protocols and sourcing standards.

Adding a fifth format is one YAML file. See
[`docs/cookbook.md § 1`](docs/cookbook.md).

---

## As a library

`src/index.ts` is the v1.0 stable API surface. Every named
export is covered by SemVer.

```ts
import {
  FormatRegistry,
  AnthropicLLMProvider,
  Orchestrator,
  PraxisError,
} from "praxis";

const registry = new FormatRegistry();
registry.loadDirectory("formats");

const orch = new Orchestrator(registry, new AnthropicLLMProvider());

try {
  const out = await orch.briefWithCritiqueAndRerun(
    "Should we enter the German market?",
    "executive-pre-read"
  );
  console.log(out.synthesis.total_word_count, "words");
  console.log("rerun:", out.rerun_performed);
} catch (e) {
  if (e instanceof PraxisError) console.error(e.name, e.message);
  else throw e;
}
```

Full API reference: [`docs/api.md`](docs/api.md). Embedding
quick-start: [`docs/embedding-praxis.md`](docs/embedding-praxis.md).

---

## Development

Praxis runs on [Bun](https://bun.sh) 1.3+. Since v1.1
[`@promptlang/yaml-parser`](https://www.npmjs.com/package/@promptlang/yaml-parser)
resolves from the npm registry — no sibling checkout is needed for
that piece. The `promptlang` **core** (lexer / parser / ast /
runtime) is still consumed via TypeScript `paths` from a sibling
checkout under `~/dev/promptlang/`, so both repos must currently
live side by side:

```
~/dev/
├── praxis/        ← this repo
└── promptlang/    ← required for the promptlang core imports
```

Setup:

```bash
git clone https://github.com/matteogallo-ai/promptlang.git ~/dev/promptlang
git clone https://github.com/matteogallo-ai/praxis.git ~/dev/praxis
cd ~/dev/praxis
bun install
bun run typecheck   # bunx tsc --noEmit — 0 errors
bun test            # 1146 pass, 11 skip (live tests gated on API key)
bun run bench:mock  # 10 benchmarks against the mock provider
```

Publishing the `promptlang` core to npm (removing this last sibling
requirement) is planned for a future release.

CLI dev loop:

```bash
bun run cli version
bun run cli formats list
bun run cli brief "Q" --format auto --full --verbose
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contributor
walkthrough and the coding conventions (TypeScript strict,
`any`-free src, no new npm deps).

---

## FAQ

**Why only one npm dep (`pdfkit`)?** From-scratch PDF generation
would triple the renderer LOC and require font-embedding (AFM
parsing, Type 1 programs, encoding tables) for zero incremental
capability. `pdfkit` was called out as the one planned exception
in the v0.1 migration prompt; every other renderer stays
from-scratch (the DOCX renderer emits Open Packaging Convention
parts by hand and uses `node:zlib` for DEFLATE).

**Why still a sibling PromptLang checkout?** Since v1.1, the
`@promptlang/yaml-parser` sub-package is on npm and no longer
needs one. The `promptlang` **core** (lexer / parser / ast /
runtime), which the agents import for prompt-file parsing, is not
yet published to npm — Praxis reaches it via `tsconfig` `paths`
against `~/dev/promptlang/`. Publishing the core is a future
release.

**Does Praxis need an API key?** No — the mock provider is
fixture-driven and produces every artefact type. Live runs need
`ANTHROPIC_API_KEY`; nothing else does.

**Can I hit OpenAI / OpenRouter / a local model?** Yes. Implement
`LLMProvider` (two methods) and pass your instance to the
Orchestrator. Recipe:
[`docs/cookbook.md § 2`](docs/cookbook.md).

**Is there a Web UI?** No, and there isn't planned to be one in
v1.0. The library API is the contract; UIs are downstream
projects on top of it.

---

## License, contact

MIT. See [`LICENSE`](LICENSE).

Maintainer: Matteo Gallo — matteo.gallo@gallarti.io. Bug
reports and feature requests via GitHub Issues.
