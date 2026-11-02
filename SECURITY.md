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

That answer is then inserted into the next stages' prompts. Today it is
placed between `---` lines with a label such as "Research output (JSON)", but
with **no instruction to treat it as data and ignore instructions inside it**,
and the same `---` line also separates the system text from the user text, so
injected content can imitate that boundary. There is no prompt-injection test.
A hostile page could therefore steer later stages, for instance towards a
given option in the recommendation. Defending against this is roadmap item
C17 in [`docs/CLAIMS.md`](docs/CLAIMS.md).

What limits the damage today: the output is a document for a human reader,
not an action; Praxis executes no tool other than web search and writes only
to the output path you give it; under the `strict` sourcing policy every
cited URL must pass the format's freshness and domain-trust checks.

### 2. Uncontrolled cost

One briefing makes at least 7 model calls, plus one synthesis call per format
section, up to 5 `pause_turn` rounds per web-search call, up to 3 attempts on
429/5xx responses, bounded `strict_editorial` regeneration attempts and at
most one synthesis rerun. Praxis sets no cap on the number of web searches per
call (the tool's `max_uses` is not sent), records no token usage and enforces
no budget per briefing. `bun run bench:live` runs every benchmark question.

Controls in place:

- `bun test` never calls the API unless `PRAXIS_LIVE_TESTS=1` is set, even
  with a key in `.env` (Bun loads `.env` automatically).
- CI holds no API key.
- Project rule: no paid run without a cost estimate and the maintainer's
  approval (`CLAUDE.md`).

Per-stage usage and cost reporting is part of roadmap item C14.

### 3. The API key

The Anthropic key is read from the `apiKey` constructor option or the
`ANTHROPIC_API_KEY` environment variable, kept in memory, and sent only in the
`x-api-key` header to `api.anthropic.com`. It is never written to output
files. `.env` is git-ignored; never commit it. If a key may have leaked,
revoke it in the Anthropic console first.

## Out of scope

The content of generated briefings (accuracy, bias) is a quality question, not
a security one; see [`docs/benchmarking-methodology.md`](docs/benchmarking-methodology.md).
