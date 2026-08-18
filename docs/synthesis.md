# Synthesis Agent

The Synthesis agent (v0.6, sixth Praxis agent) is the one that
turns Praxis outputs into a briefing. It consumes ALL FIVE prior
artefacts (Scoping + Research + Stakeholders + Risks + Options) and
produces the final Markdown text, one section at a time, respecting
the target format's tone directives, `max_length`, `forbidden_terms`,
and `validation_rules`.

This document covers the no-invention rule, the per-section loop,
the format-conformance report, and the design intent behind those
choices.

---

## The no-invention rule

Synthesis is the ONE agent that must not add facts. Every other
agent produces new information: Research collects it, Stakeholders
name actors, Risks assess likelihoods, Options enumerate courses of
action. Synthesis's job is to reorganise and articulate. Anything
that reads like a new claim in the final briefing is a bug.

The rule is enforced structurally:

- The prompt is explicit: "you MUST NOT introduce any fact, source,
  name, number, or date that is not present in the artefacts
  supplied to you".
- Every URL cited in a synthesized section MUST appear in one of
  the upstream artefacts (research findings, stakeholder position
  evidence, risk likelihood/impact evidence, option supporting
  evidence). Fabricated URLs raise `SynthesisError`.
- Sources cited must carry all four SourceReference fields
  (url + title + accessed_at + excerpt), lifted from the upstream
  artefact.
- Web search is DISABLED for this agent — it calls `llm.complete()`
  with no tools. There is no path by which the agent can fetch new
  content.

This mirrors the sourcing discipline the layer enforces on Research
/ Stakeholder / Risk evidence. Synthesis is not exempt because it
runs last.

---

## The per-section loop

Synthesis is called ONCE PER SECTION of the target format. Each
call receives:

- All five upstream artefacts (scoping, research, stakeholders,
  risks, options).
- The section's id, title, purpose, tone directives, max words,
  required agents, and validation rules.
- The format-level style guide (voice, sentence structure,
  forbidden terms).

The response is a JSON object per section:

```json
{
  "content_markdown": "<the section text, in Markdown>",
  "sources_cited": [ <SourceReference>, … ],
  "validation_issues": [ "<one-line description of a soft warning>", … ]
}
```

**Why per-section, not per-briefing?** One LLM call per section
lets each call focus on ONE tone, ONE length cap, ONE set of
validation rules. It costs more round-trips (six for the shipped
formats vs one for a monolithic approach), but produces materially
better format conformance in practice — the LLM does not get
tripped by the section's directive drifting into the next section.

---

## Format conformance

Every synthesized section is post-validated on three axes:

### 1. `max_length` (with tolerance)

A section that exceeds its `max_length.words` by more than 10% is
flagged in `validation_issues` and appears in
`format_conformance.sections_over_length`. Slight overruns are not
errors — the format contract is directional, not machine-precise.

Word count uses a Markdown-aware tokeniser: code fences and inline
code are stripped, punctuation collapsed, then whitespace-split.

### 2. `forbidden_terms` (case-insensitive)

Every occurrence of every forbidden term is counted in
`format_conformance.forbidden_terms_found` as
`{ term, section_id, count }`. The prompt tells the agent to
avoid them; the post-validator catches slips.

### 3. `validation_rules` (agent-acknowledged tracking)

`validation_rules` are declarative strings like
`must_state_recommendation_in_first_sentence: true`. The
post-validator cannot semantically enforce them (they are
free-form), but it tracks which rules the agent explicitly
acknowledged in its own `validation_issues` list and surfaces the
rest as "not confirmed".

### The `SynthesisResult.format_conformance` object

```ts
{
  target_words: number;
  actual_words: number;
  deviation_pct: number;          // signed; positive = over budget
  sections_over_length: string[];  // section_ids past the +10% cap
  forbidden_terms_found: Array<{ term, section_id, count }>;
  failed_validation_rules: Array<{ section_id, rule }>;
}
```

Under the shipped formats, the mock pipeline produces clean
briefings (no forbidden-term hits, sections within budget). The
report is the audit signal that a live-provider run may not.

---

## Sections mirror `format.sections[]` verbatim

The synthesis loop iterates `format.sections[]` in declared order.
The returned `sections[]` array has the same length, same order,
same section ids, same titles. The parser rejects mismatches — a
section that appears in the response but not in the format raises
`SynthesisError`, and vice versa.

This lets the assembler and downstream renderers rely on the
section ordering as a stable interface.

---

## Runtime errors

- `SynthesisError` — structural failure (missing section in output,
  extra section, cited URL not present in any upstream artefact).
- `SynthesisValidationError` — reserved for callers that want
  format-conformance failures to be throwable. Not raised from the
  agent's default execution path; the default surfaces conformance
  issues as `format_conformance` + per-section `validation_issues`.
- `InvalidAgentOutputError` — the JSON does not match the expected
  shape for a section.
- `AgentExecutionError` — provider-level failure wrapped.
- `PromptFileError` — the `.prompt` file is missing or malformed.

All extend `AgentExecutionError`, which extends `PraxisError`.

---

## Pipeline integration

Synthesis is the last agent in the `Orchestrator.brief()` chain. It
runs after Options (which produces the recommendation) and consumes
the full accumulated context.

The `renderFullBrief()` helper in `src/cli/output.ts` turns the
`SynthesisResult` into a self-contained Markdown document with a
YAML front-matter header (question, format, provider, generated_at,
recommended option, aggregated risk, sourcing summary, word-count
deviation). That is the artefact users see when they run
`praxis brief "..." --format <id> --full`.

---

## Why one LLM call per section (not one per briefing)?

The temptation to do a single monolithic call is real: it costs one
round-trip instead of six. But:

- Each section has its OWN tone directive, max_length, and
  validation rules. A monolithic prompt has to communicate all of
  them at once, and the LLM is measurably worse at holding
  section-by-section discipline across a long prompt.
- Per-section calls let the mock fixture set be decomposable — one
  fixture per (format, section) pair rather than 18 megaliths.
- Failure isolation: a bad section can be re-generated without
  invalidating the others.

The trade-off is worth it. The extra round-trips are the format's
price of admission.

---

## Why no adversarial pass yet?

The v0.7 Adversarial Critique agent will read the completed brief
and stress-test the recommendation. That is deliberately not
inside Synthesis because:

- Synthesis's job is assembly, not judgment. Mixing them muddles
  both.
- The adversarial pass needs the *full* rendered brief as input,
  which only exists after Synthesis has completed.
- Splitting the two roles keeps the agent contract narrow and
  keeps failure modes attributable.

Synthesis produces the brief. Adversarial critiques it. Two agents,
two responsibilities.
