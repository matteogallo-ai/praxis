# `tests/live/`

Live integration tests against the real Anthropic API. **Skipped by
default**: they run only when both `PRAXIS_LIVE_TESTS=1` and
`ANTHROPIC_API_KEY` are set (`tests/helpers/live-gate.ts`).

A key alone is not enough on purpose: Bun loads `.env` automatically,
so a key kept there would otherwise turn every `bun test` into paid
API calls. Every run of these tests costs money and needs a cost
estimate and the maintainer's approval first.

## Run them

```bash
PRAXIS_LIVE_TESTS=1 bun test tests/live/
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
- `options-agent.live.test.ts` — runs the Options Generation agent
  with a real `web_search` tool and verifies the cross-artefact
  reference discipline (stakeholder names, risk IDs) survives an
  end-to-end run.
- `synthesis-agent.live.test.ts` — runs the Synthesis agent with a
  tightly-scoped 2-section format and verifies the no-invention
  rule (no cited URL outside the supplied artefacts) holds
  end-to-end.
- `full-brief.live.test.ts` — runs the FULL v0.6 six-agent
  pipeline (Scoping → Research → Stakeholders → Risks → Options →
  Synthesis) and writes the assembled Markdown brief to
  `/tmp/praxis-live-brief-<ts>.md` for post-hoc human review.

CI never sets `PRAXIS_LIVE_TESTS`, so these tests are skipped there.
