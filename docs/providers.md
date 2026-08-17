# Providers

A **provider** is a small class implementing the `LLMProvider`
interface — the single surface every Praxis agent calls to obtain a
completion. Providers are swap-in / swap-out: the same agent code
runs against the offline mock or the live Anthropic backend without
change.

This document covers the shipped providers, how to configure them,
and how to add a new one.

---

## The `LLMProvider` interface

```ts
export interface LLMProvider {
  readonly name: string;
  complete(prompt: string, options?: CompleteOptions): Promise<string>;
  completeWithTools?(
    prompt: string,
    tools: Tool[],
    options?: CompleteWithToolsOptions
  ): Promise<CompletionResult>;
}
```

- `name` — provider identifier used in errors and diagnostics
  (`"mock"`, `"anthropic"`).
- `complete()` — required. Returns the model's final text.
- `completeWithTools()` — optional. Providers that support tool use
  implement it; agents that need tools check for its presence and
  throw `ToolUseNotSupportedError` otherwise.

The `CompletionResult` returned by `completeWithTools` captures both
the final text and every tool call the model made (across all
rounds), plus a `rounds` counter and the terminal `stop_reason`. This
is deliberately provider-independent — Anthropic's server-side
`web_search` and a future client-side tool loop both fit under the
same shape.

---

## Shipped providers

### `MockLLMProvider`

Deterministic, offline. Loads JSON fixtures from a directory and
returns the response of the first fixture whose `match_substring`
appears in the rendered prompt. Extended in v0.3 to carry optional
`tool_calls`, `rounds`, and `stop_reason` fields so it can back both
`complete` and `completeWithTools` from the same fixture format.

Use it for:

- All unit and integration tests (offline, zero cost, reproducible).
- CLI demos when you don't want to burn tokens.
- Debugging the agent / orchestrator layers in isolation.

### `AnthropicLLMProvider`

Live backend. Talks to `POST https://api.anthropic.com/v1/messages`
using Bun's native `fetch`. Zero external HTTP libraries.

Wire-level features:

- **Endpoint:** `https://api.anthropic.com/v1/messages`.
- **Headers:** `x-api-key`, `anthropic-version: 2023-06-01`,
  `content-type: application/json`.
- **Model:** defaults to `claude-sonnet-4-5`; overridable via the
  `ANTHROPIC_MODEL` env var or the constructor `model` option.
- **Timeout:** 60s per request, enforced via `AbortController`.
- **Retries:** up to 3 attempts total on `429` and `5xx`, with
  exponential backoff `1s → 2s → 4s`. Never retries on `4xx`.
- **Tool use:** maps the Praxis-side tool identifier `web_search` to
  the Anthropic-side `web_search_20250305`. Handles
  `stop_reason: "pause_turn"` by echoing the assistant message back
  and issuing another request, up to `max_tool_rounds` (default 5).

### Configuration

Copy the example env file and fill in your key:

```bash
cp .env.example .env
```

| Variable | Purpose | Default |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Sent as the `x-api-key` header. **Required.** | — |
| `ANTHROPIC_MODEL`   | Overrides the default model name. | `claude-sonnet-4-5` |

`.env` is git-ignored. The provider reads these at construction and
throws `AnthropicAuthenticationError` if the key is missing or empty.

### Selecting a provider from the CLI

```bash
# offline (default)
bun run cli brief "..." --format executive-pre-read --with-research

# live
bun run cli brief "..." --format executive-pre-read --with-research \
    --provider anthropic
```

### Selecting a provider from the library

```ts
import {
  AnthropicLLMProvider,
  MockLLMProvider,
  Orchestrator,
  FormatRegistry,
} from "praxis";

const registry = new FormatRegistry();
registry.loadDirectory("formats");

// offline
const mock = new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });

// live
const anthropic = new AnthropicLLMProvider();
// optional overrides
const anthropicCustom = new AnthropicLLMProvider({
  apiKey: process.env.MY_KEY,
  model: "claude-opus-4-7",
  timeoutMs: 30_000,
  maxAttempts: 5,
});

const orch = new Orchestrator(registry, anthropic);
```

---

## Cost model (Anthropic)

Praxis does not itemise cost; the Anthropic API returns `usage.input_tokens`
and `usage.output_tokens` on every response, and Anthropic publishes
per-model pricing. Rough order of magnitude for the shipped agents,
per invocation of `researchAfterScoping`:

- Scoping: 1 request, ~1k input tokens, ~500 output tokens.
- Research: 1–3 requests (tool-use loop), ~5k input tokens including
  server-side `web_search` results, ~1k output tokens.

A single end-to-end run typically stays well under the "few cents"
mark on `claude-sonnet-4-5`. Live tests are designed to stay under
that budget too.

Rate limits and retries: `429` responses are retried up to twice with
the built-in backoff. If your account has aggressive limits, raise
them or lower `maxAttempts` and add your own throttling.

---

## Adding a new provider

1. Create `src/llm/<vendor>-provider.ts` implementing `LLMProvider`.
   Implement `completeWithTools` if the backend supports tools.
2. Read secrets from `process.env` at construction and throw a typed
   auth error if unset. Never accept a null key or a "sk-your-key-here"
   placeholder.
3. Use Bun's native `fetch` — no external HTTP libraries.
4. Add error classes to `src/llm/errors.ts` (auth, API, rate-limit,
   timeout — one per failure mode you can distinguish from the wire).
5. Register the provider name in `src/cli/commands/brief.ts`
   (`selectProvider`) and update `ProviderNotSupportedError`'s
   message.
6. Add unit tests with a fetch mock (see
   `tests/llm/anthropic-provider.test.ts` for the reference pattern).
   Do NOT hit the real API from `bun test`; put optional live tests
   under `tests/live/` and gate them on the required env vars.
7. Update `README.md` (**Configuring providers**) and this file with
   the new provider's env vars and cost profile.

Do not introduce a "provider factory" or a plugin loader — a small
`if (name === "…")` chain in `selectProvider` is the correct
abstraction level for the release cadence Praxis targets.
