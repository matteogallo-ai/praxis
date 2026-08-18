# Renderers

The renderers turn a `BriefResult` (v0.6) or
`BriefWithCritiqueResult` (v0.7) into a deliverable in one of three
target formats:

| Target        | Renderer                          | Use case                            |
| ------------- | --------------------------------- | ----------------------------------- |
| `md-enhanced` | `src/renderers/markdown-enhanced` | Editor / web / GitHub               |
| `docx`        | `src/renderers/docx`              | Executive circulation, Word review  |
| `pdf`         | `src/renderers/pdf` (via pdfkit)  | Board pack, printed distribution    |

This document covers the architecture, the theme system, how the
CLI wires renderers to output paths, and how to add a new target.

---

## Architecture

```
src/renderers/
├── types.ts                   RenderTarget, RenderOptions, Renderer, hasCritique
├── errors.ts                  RenderError, UnsupportedRenderTargetError
├── index.ts                   dispatcher: render(brief, target, format, options)
├── markdown-enhanced.ts       enhanced Markdown renderer
├── docx.ts                    DOCX renderer (from-scratch)
├── pdf.ts                     PDF renderer (via pdfkit)
└── docx-internals/
    ├── xml-builder.ts         XML escape + element helpers
    ├── zip-builder.ts         PKZIP writer (uses node:zlib DEFLATE)
    ├── content-types.ts       [Content_Types].xml + rels
    ├── styles-xml.ts          Word style definitions
    └── document-xml.ts        word/document.xml body
```

Every renderer implements the `Renderer` interface:

```ts
interface Renderer {
  target: RenderTarget;
  render(brief: BriefResult | BriefWithCritiqueResult, options?: RenderOptions): Promise<Buffer>;
}
```

The dispatcher `render(brief, target, format, options)` resolves
`target` against `format.output_targets[]` and picks the
implementation. Unknown or disallowed targets raise
`UnsupportedRenderTargetError`.

---

## The rule: `format.output_targets[]` gates every render

The dispatcher CROSS-CHECKS the requested target against the
format's declared `output_targets`. If the format does not declare
the target, the render is refused. This is not accidental — the
formats commit to a delivery contract, and a briefing format that
says "PDF only" should not be silently rendered to Word.

The v0.1-v0.6 vocabulary uses the short forms `"md"`, `"docx"`,
`"pdf"` in YAML. The v0.7 renderer types use `"md-enhanced"` for
Markdown so callers can be explicit about the enhanced feature
set. The dispatcher's `normaliseRenderTarget()` accepts either
spelling.

---

## RenderOptions

```ts
interface RenderOptions {
  include_sourcing_report?: boolean;
  include_critique?: boolean;
  include_toc?: boolean;
  include_appendices?: boolean;
  theme?: RenderTheme;            // PDF only
  compress_pdf_streams?: boolean; // PDF only, tests use false
}
```

Options that do not apply to the target are silently ignored —
`theme` is a no-op on Markdown; `include_toc` renders a
Markdown TOC but a paginated TOC in PDF; etc.

---

## Themes (PDF only)

Three themes, chosen to fit the three shipped formats:

| Theme          | Accent colour  | Fonts                 | Use case                              |
| -------------- | -------------- | --------------------- | ------------------------------------- |
| `professional` | navy `#0B3D91` | Helvetica             | Default; corporate general use.       |
| `government`   | maroon `#7A0019` | Times                 | Institutional / policy briefings.     |
| `consulting`   | amber `#D97706` | Helvetica             | Consulting notes (McKinsey-like).     |

Themes affect the accent colour on headings and the headline font.
Body text stays legible across themes.

---

## The DOCX renderer is from-scratch (no npm dep)

DOCX is Open Packaging Convention (OPC) + XML. The renderer emits
the minimum set of parts Word / LibreOffice need:

- `[Content_Types].xml` — MIME registration
- `_rels/.rels` — package relationships pointing at word/document.xml
- `word/document.xml` — the content body
- `word/styles.xml` — Heading1/2/3, Normal, PraxisTable
- `word/_rels/document.xml.rels` — points at styles.xml

The ZIP writer (`docx-internals/zip-builder.ts`) is a minimal PKZIP
implementation over `node:zlib` DEFLATE. Timestamps are pinned so
archives are byte-reproducible.

**Why from-scratch?** Adding a Word-writer library would double
the Praxis dependency footprint for a format we only need in three
sections and one table style. From-scratch is ~200 lines and gives
us complete control over the output.

---

## The PDF renderer uses pdfkit — the SOLE external dep

pdfkit is the ONE npm dependency Praxis takes on (see CHANGELOG
v0.7.0 for the justification). PDF from-scratch would triple the
renderer LOC and require font-embedding (afm parsing, Type 1
programs, encoding tables). Not worth it.

The PDF layout is:
1. Cover page (question, recommended option, aggregated risk).
2. Optional TOC.
3. Section pages (one per synthesis section, Heading + body).
4. Options / Risks / Stakeholders tables.
5. Optional Adversarial Critique section.
6. Optional Appendices (findings, stakeholders, risk register).
7. Sources page (deduplicated, grouped by domain).
8. Optional Sourcing Report page.
9. Footers on every page (title + "p. N / total").

---

## Adding a new render target

1. Add the string literal to `RenderTarget` in `types.ts` and
   `RENDER_TARGETS`.
2. Add the format YAML entry — every format that wants the target
   must declare it in `output_targets[]`.
3. Implement `Renderer` in `src/renderers/<target>.ts`.
4. Register the renderer in the dispatcher table in
   `src/renderers/index.ts`.
5. Extend `normaliseRenderTarget()` to accept the short-form
   spelling used in YAML.
6. Add tests under `tests/renderers/<target>.test.ts`.
7. Update the CLI help in `src/cli/index.ts`.

---

## Consumers other than the CLI

The dispatcher is a plain function — programmatic callers can
skip the CLI and drive it directly:

```ts
import { render } from "praxis/renderers";
import { Orchestrator } from "praxis/orchestrator";
// …
const result = await orch.briefWithCritique(question, formatId);
const buf = await render(result, "pdf", format, {
  include_critique: true,
  include_toc: true,
  theme: "consulting",
});
await Bun.write("/tmp/brief.pdf", buf);
```

The renderer is decoupled from the pipeline — the same result
can be rendered to all three targets by three consecutive calls.
