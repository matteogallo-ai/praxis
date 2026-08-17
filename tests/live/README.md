# `tests/live/`

Live integration tests against the real Anthropic API. **Skipped by
default** — they only run when `ANTHROPIC_API_KEY` is set in the
environment.

These tests do NOT run under `bun test` when `ANTHROPIC_API_KEY` is
absent. They also don't count toward the release test total, because
they hit external services and their availability depends on network
and quota.

## Run them

```bash
export ANTHROPIC_API_KEY=sk-ant-…
bun test tests/live/
```

## What they cover

- `anthropic-provider.live.test.ts` — smoke tests `complete()` and
  `completeWithTools()` end-to-end against `/v1/messages`.
- `research-agent.live.test.ts` — runs the Research agent with a real
  web_search tool and verifies findings come back sourced.

Costs are minimal (a handful of small requests per invocation) but
still real. Do not include these tests in CI unless you budget for it.
