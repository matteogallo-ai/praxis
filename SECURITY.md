# Security

## Reporting a vulnerability

Email matteogallo.office@gmail.com, or use GitHub's private vulnerability
reporting on this repository. Do not open a public issue. Expect a reply
within a week.

## Supported versions

Only the latest commit on `main` is supported.

## Threat model

Praxis is a CLI and a library run by the person who owns the API key, on
questions they choose. It has no server, no user accounts and no stored data
beyond the files it writes. The risks below are about what the pipeline reads
from the web, what it spends, and the key it holds. Each states what the code
does **today**.

### 1. Untrusted web content flowing between stages

Stages 2–5 and 7 call Anthropic's server-side `web_search` tool. What the
model reads there, and what it writes back into its JSON answer (claims,
excerpts, stakeholder positions), is untrusted: a page can contain
instructions aimed at the model.

That answer is then inserted into the next stages' prompts inside an
`<untrusted_data>` block whose content cannot close it (every `<` is
escaped), and every stage's system text says such blocks and web search
results are data, never instructions. Code checks the answer: one that
repeats twelve consecutive words of the system text is rejected, and every
option, risk or stakeholder a stage references must exist
(`tests/agents/prompt-injection.test.ts`, claim C17). Web search results
arrive in the model's own turn and cannot be wrapped; only the system rule
covers them. Whether a live model resists injection has not been measured.

What limits the damage today: the output is a document for a human reader,
not an action; Praxis executes no tool other than web search and writes only
to the output path you give it; under the `strict` sourcing policy every
source cited by the research, stakeholder and risk stages must pass the
format's freshness and domain-trust checks. Sources cited by the options and
adversarial stages, and the synthesis text, are not checked.

### 2. Uncontrolled cost

One briefing makes at least 7 model calls, plus one synthesis call per format
section, up to 5 `pause_turn` rounds per web-search call, up to 3 attempts on
429/5xx responses, one stage retry on a recoverable error, bounded
`strict_editorial` regeneration attempts and at most one synthesis rerun.
Each stage sends its own `max_tokens`, timeout and web-search cap
(`max_uses`, `src/agents/stage-limits.ts`). Every call's usage is recorded
and priced per stage in the run's `metadata.json`, and `--max-cost-usd`
(`maxCostUsd` in the library) stops a briefing before the next call once it
has spent the cap. `bun run bench:live` runs every benchmark question.

Controls in place:

- `bun test` never calls the API unless `PRAXIS_LIVE_TESTS=1` is set, even
  with a key in `.env` (Bun loads `.env` automatically).
- CI holds no API key.
- `.claude/settings.json` denies Claude Code the paid entry points
  (`bun run bench`, `bench:live`, `score*`, `PRAXIS_LIVE_TESTS=1 …`,
  `env PRAXIS_LIVE_TESTS=1 …`) and tag creation and publication
  (`git tag *`, `git push --tags`).
- Project rule: no paid run without a cost estimate and the maintainer's
  approval (`CLAUDE.md`).

These deny rules match command prefixes. They are a safety net, not a
guarantee: the same effect is reachable through another spelling (a
subshell, a script, `git push origin v1.2.3`, `--follow-tags`). The
protections that hold:

- The GitHub ruleset on `main` (pull request required, no force-push, no
  deletion, no bypass actor) refuses a direct push whatever the client.
- The ruleset on `v*` tags restricts creating, moving and deleting them, but
  lets repository admins bypass it. A tool running with the maintainer's
  admin credentials can therefore still push a tag; for tags the deny rules
  and the project rule are the only guard.
- `--max-cost-usd` bounds what a briefing can spend whatever starts it.

### 3. The API key

The Anthropic key is read from the `apiKey` constructor option or the
`ANTHROPIC_API_KEY` environment variable, kept in memory in an ECMAScript
private field (so printing the provider cannot show it), and sent only in the
`x-api-key` header to `api.anthropic.com`. It is never written to output or
run files, and the CLI masks it, other `sk-ant-` keys, auth headers, e-mail
addresses and the home directory in everything it writes to stderr
(`tests/cli/no-secrets-in-logs.test.ts`, claim C20). `.env` is git-ignored; never commit it. If a key may have leaked,
revoke it in the Anthropic console first.

## Out of scope

The content of generated briefings (accuracy, bias) is a quality question, not
a security one; see [`docs/benchmarking-methodology.md`](docs/benchmarking-methodology.md).
