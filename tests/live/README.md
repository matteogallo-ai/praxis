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
- `stakeholder-agent.live.test.ts` — runs the Stakeholder Mapping
  agent with a real web_search tool and verifies at least three
  well-formed stakeholders come back with real sources.
- `risk-agent.live.test.ts` — runs the Risk Analysis agent with a
  real web_search tool and verifies risks come back cross-referenced
  to the supplied stakeholders and sourced on likelihood or impact.
- `full-pipeline.live.test.ts` — runs the four-agent v0.5 pipeline
  (Scoping → Research → Stakeholders → Risks with the hardened
  sourcing layer) end-to-end and writes the payload to `/tmp` for
  post-hoc inspection.

Costs are minimal (a handful of small requests per invocation) but
still real. Do not include these tests in CI unless you budget for it.
