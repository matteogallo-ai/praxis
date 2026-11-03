# Mutation testing

Stryker changes the code one small edit at a time (a `>` into `>=`, a
condition into `true`, a string into `""`) and runs the tests against each
change, a *mutant*. A mutant the tests do not notice *survives*: either the
tests miss a behaviour, or the edit changes nothing observable (an
*equivalent* mutant). The score is the share of mutants killed.

## Scope and command

```bash
bun run mutation        # refuses uncommitted changes in src/, then stryker run (4–6 minutes, 8 workers)
```

`stryker.config.json` mutates the orchestrator and the validators: what
decides whether a stage's answer, a source or a briefing is accepted.

- `src/orchestrator/orchestrator.ts`
- `src/sourcing/validator.ts`, `freshness.ts`, `domain-trust.ts`
- `src/agents/prompt-runtime.ts`, lines 292–457: control characters,
  `extractJsonText`, the output reader and `parseSource`
- `src/agents/synthesis.ts`, lines 692–776: `checkProse` and
  `parseCitedSource`

Each mutant runs `bun test tests/orchestrator tests/sourcing tests/agents
tests/property --bail` through Stryker's built-in `command` runner, which
needs no third-party Bun plugin. Stryker runs `inPlace`: PromptLang resolves
through `tsconfig.json` paths to `../promptlang`, which a sandbox copy one
directory deeper would break. Stryker restores the files when it ends; a run
killed midway leaves them mutated: `git checkout -- src` restores them, and
`bun run mutation` will not start until `src/` is clean. Knip's Stryker
plugin infers `@stryker-mutator/command-runner` from `testRunner: "command"`;
that runner ships inside `@stryker-mutator/core`, so `knip.json` ignores it.

## Score

Measured at commit `ba50928`, 1016 mutants. `docs/mutation-score.json` holds
the counts per file and every survivor's line and mutator, from that run's
report; the full report (`reports/`) is not committed.

| File | First run | Now | Killed | Timeout | Survived |
| --- | --- | --- | --- | --- | --- |
| `orchestrator.ts` | 66.67% | 92.17% | 317 | 1 | 27 |
| `prompt-runtime.ts` (lines above) | 83.84% | 97.26% | 211 | 2 | 6 |
| `synthesis.ts` (lines above) | 63.50% | 100.00% | 136 | 1 | 0 |
| `domain-trust.ts` | 77.92% | 96.75% | 149 | 0 | 5 |
| `freshness.ts` | 96.55% | 96.55% | 28 | 0 | 1 |
| `validator.ts` | 84.85% | 97.73% | 129 | 0 | 3 |
| **All** | **74.63%** | **95.87%** | 970 | 4 | 42 |

The first run had 1068 mutants: the orchestrator's private Levenshtein (42
mutants) was replaced by the shared one in `src/sourcing/dedupe.ts`, and
`isJsonObject` lost type checks that could never fail (10).

## What the survivors of the first run showed

Tests added because a mutant survived, each a behaviour no test checked:

- `checkProse`: every input was caught by several checks at once, so
  weakening any one went unnoticed. Each check now has an input that only
  it catches, and the refusal reason and the offending text are asserted
  (`tests/agents/synthesis.test.ts`, "each prose check on its own"). The
  link-destination check was untested on its own: `[x](javascript:…)` and a
  relative link are caught by nothing else.
- Control characters written raw, not as `\u` escapes; a stray `}` in the
  prose before the JSON object; the reader's refusal messages.
- The validators' injected clock (a mutant read the wall clock instead),
  risk evidence numbering, an accumulator recording without dedupe, and the
  base error under strict when other rules are set.
- Domain trust: refusal reasons, an absent allow or deny list, `*.` and `.*`
  alone, a pattern with spaces, an unescaped `.` in the generic wildcard.
- The orchestrator: each stage's prompt path and round cap reaching its
  agent, stage names in the usage ledger, the critiques a rerun addresses,
  the reason it gives and the revision instruction in its prompt (claimed in
  `tests/orchestrator/rerun.test.ts`'s header, never asserted), sourced
  critiques adding no warning, sourcing rules applying from the risk stage
  on, cross-agent dedupe, and the thresholds of `isSubstantiallyChanged`.

## Surviving mutants

**Equivalent: 36.** The edit changes no output.

- `prompt-runtime.ts` (6): the fast path that returns an answer already a
  JSON object (the scan would return the same span); `isJsonObject`'s catch
  body (`undefined` is as falsy as `false`); `start = +1` (always set before
  use); `i <= length` (reads `undefined`, a no-op); yielding at inner `}`
  (an unbalanced span never parses); `requireEnum`'s type check (`includes`
  refuses a non-string).
- `domain-trust.ts` (5): the no-wildcard branch (the generic branch then
  compares the same way, 3); the `?? []` defaults (Stryker's sentinel string
  is never a host, 2).
- `validator.ts` (3): recording into the no-op accumulator; the freshness
  guard on a stale warning, which exists only when freshness rules do.
- `freshness.ts` (1): `<` for `<=` at an age of exactly 0 (both give 0).
- `orchestrator.ts` (21): the internal guard for a stage output read before
  its stage ran (unreachable, 3); a rerun with no steelmanned alternative
  (the parser refuses it upstream, 2); setting an absent prompt path, round
  cap, rules or revision context to `undefined` (the same as leaving it out,
  14); the zero-length branches of `isSubstantiallyChanged` and
  `normalisedLevenshtein` (`NaN` compares like 0, 2).

**Not killed: 6, all in `orchestrator.ts`.** Behaviours with no test:

- A format with no `sourcing_rules` on the risk or full path (3): the
  mutants build a dedupe accumulator from an absent rule; every format the
  mutation tests run through has one.
- The usage-ledger label of scoping when a custom scoping prompt is set (1).
- The rerun reason when only material critiques trigger it (2): every mock
  fixture with a rerun has a critical critique.

Three mutants first listed here as equivalent were not: the review of this
document showed that `isJsonObject`'s `{` check, the tie-break between two
objects of equal length, and the blank-pattern guard of domain trust each
change an output. Each now has a test.

## Limits

The score measures the tests against these files only, on the mock
provider; it says nothing of how a live model's answers are handled.
Mutants in the rest of `src/` are not measured.
