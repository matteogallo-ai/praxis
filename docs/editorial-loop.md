# The editorial re-run loop (v0.8)

Praxis produces briefings. Adversarial critique stress-tests them.
When a critique flags that the recommendation should be reconsidered,
`Orchestrator.briefWithCritiqueAndRerun()` invokes the Synthesis
agent ONE MORE TIME to produce a briefing that addresses its own
critique — so what ships to the reader is already the revised
version, not the version-with-caveat.

This document describes the mechanics and — more importantly — the
safeguard that keeps the loop from oscillating: **the hard cap of
exactly one rerun per call.**

## When the rerun fires

The rerun fires iff BOTH conditions hold:

1. `adversarial.revised_recommendation_needed === true`, AND
2. `adversarial.steelmanned_alternative !== null`.

The adversarial parser guarantees that (1) implies (2) — the whole
point of flagging a revision is to give the reader a place to land.
Nevertheless the orchestrator defends against future drift: if the
parser one day admits a `true`-signal-with-null-alternative case,
the orchestrator falls through to `rerun_performed: false` rather
than run a rerun with no target.

## What the rerun does

The Synthesis agent is called a second time with a
`revision_context: RevisionContext` field set on its
`SynthesisContext`:

```ts
{
  original_synthesis: initial.synthesis,
  adversarial: initial.adversarial,
  critiques_to_address: <critical + material critiques>,
  steelmanned_alternative: <the parsed alternative>,
  instruction: "revise sections and align recommendation with the steelmanned alternative"
}
```

The prompt then reserves a **REVISION MODE** block that names the
critique IDs, their steelmanned positions, their
`suggested_revision`, the steelmanned alternative recommendation,
and the instruction. Critiques with a `target.section_id` are
filtered to the matching section; unscoped critiques
(no `section_id`) apply to every section.

## Hard cap: one rerun. Ever.

The method NEVER re-iterates. Once the second Synthesis pass
returns, the payload is finalised — even if the same critique
signal would (hypothetically) trigger another. There is:

- **No recursion.** The rerun path is a linear `if/else` — a single
  Synthesis call, then return. No loop, no recursive helper.
- **No re-critique.** The adversarial agent runs exactly once per
  `briefWithCritiqueAndRerun()` call, on the initial brief.
- **No auto-retry on the post-rerun brief.** Callers who want
  another pass can invoke the method again on the new output
  themselves. The library never loops on its own.

Why this discipline matters: an editorial loop that could re-run
itself would either (a) converge on a hedged, no-signal
"consensus" brief that satisfies every critique by refusing to
recommend anything, or (b) diverge — a critique that gets
addressed in one pass surfaces a different critique on the next
pass, and the loop never terminates. Both outcomes destroy the
"consultant-grade" quality the pipeline exists to deliver.

The one-rerun bound is the smallest cap that captures the
first-order value (address obvious counter-arguments) without
sliding into either failure mode.

## The returned payload

The method returns `BriefWithCritiqueAndRerunResult` — a superset
of `BriefWithCritiqueResult` with four extra fields:

- `rerun_performed: boolean` — `true` iff the second Synthesis
  ran. `false` in every no-rerun path.
- `rerun_reason: string | null` — one-line human-readable summary
  when `rerun_performed === true`; `null` otherwise.
- `original_synthesis: SynthesisResult | null` — the PRE-rerun
  synthesis. Preserved as the audit trail; the current
  `synthesis` field carries the POST-rerun output.
- `rerun_metadata: RerunMetadata | null`:
  - `critiques_addressed: string[]` — critique IDs the rerun
    targeted (critical + material).
  - `steelmanned_alternative_used: string | null`.
  - `re_synthesis_deviations: string[]` — section IDs whose text
    changed substantially between the original and rerun.

The `SourcingReport.edited_after_critique: boolean` flag flips
to `true` on the returned payload when the rerun fires.

### The deviation heuristic

`computeReSynthesisDeviations(original, rerun)` compares the two
`SynthesisResult` values section by section. A section counts as
substantially changed iff EITHER:

1. Word-count delta > 20% of the original, OR
2. Normalised Levenshtein distance on `content_markdown` > 0.30.

Two-signal design: (1) catches shortening/expansion, (2) catches
paraphrase-level rewrites that preserve the word count. Sections
present in one synthesis but not the other are flagged as
deviations too (they either appeared or vanished, which is a
substantial change).

The function is exported publicly so callers can run their own
diagnostics on a `SynthesisResult` pair.

## Under `strict_editorial` mode

When the format sets `sourcing_rules.editorial.strict_editorial:
true`, the Synthesis agent applies a SEPARATE retry loop PER
section — capped at `max_regeneration_attempts` (in `[1, 3]`,
default 2). This is independent of the rerun loop: strict-mode
retries happen inside a single Synthesis pass; the rerun loop
happens between passes.

The rerun loop and strict-mode retries compose naturally:

1. Initial `brief()` runs Synthesis. In strict mode, each section
   may retry up to `max_regeneration_attempts` times to satisfy
   the reject-action rules. Attempt history is recorded in
   `SynthesizedSection.editorial_attempts[]`.
2. Adversarial critique runs on the resulting brief.
3. If the critique flags revision → Synthesis runs a SECOND time,
   also in strict mode. Each section may again retry up to
   `max_regeneration_attempts` times.

An `EditorialFailureError` raised inside the initial pass
propagates as-is (the caller sees a failed brief); an
`EditorialFailureError` raised inside the rerun pass also
propagates as-is (the caller sees a partially failed rerun).

## CLI usage

```bash
praxis brief "Should we enter the German market?" \
  --format executive-pre-read \
  --full \
  --with-rerun
```

`--with-rerun` implies `--critique` (the rerun consumes the
critique output) and requires `--full`. The command prints a
one-line rerun note to stderr:

```
rerun: synthesis rewritten to address CRIT-001, CRIT-002 — 3 section(s) changed substantially.
```

Add `--json` for the full payload including `original_synthesis`
and `rerun_metadata`.
