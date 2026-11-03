# ADR 0001 — Getting JSON out of each stage

Status: accepted, 2026-11-02.

## Context

Every stage asks the model for one JSON object. The only live failure on record
for this (CHANGELOG 1.2.1) is a research answer that opened with prose ("I …")
before the JSON, which `JSON.parse` rejected. With web search the Messages API
returns the model's narration ("I'll search for …"), the tool blocks, then the
answer split into several `text` blocks wherever a citation attaches; the
provider joined all of them, narration included.

## Options evaluated

| Option | Search stages (research, stakeholder, risk, options, adversarial) | Scoping, synthesis |
| --- | --- | --- |
| Structured outputs (`output_config.format`) | Rejected. The API returns 400 when citations are enabled with `output_config.format`, and web search citations are always enabled (structured-outputs and web-search-tool docs). | Adopted: the decoder can only emit the schema's shape. |
| Forced tool use (`tool_choice` `any` / `tool`) | Rejected. Returns 400 on Claude Opus 5.5 and Sonnet 5.5, the models these stages run on. | Not needed. |
| A strict "submit" tool with `tool_choice: auto` | Not adopted. `auto` does not guarantee the call, so the text path is still needed, and its behaviour next to web search cannot be checked without a paid run. | Not needed. |
| Tolerant extraction in code | Adopted. | Kept as the parser's first step, so a provider that ignores the schema still parses. |

## Decision

1. The provider returns only the text after the turn's last tool block, joined
   across citation splits (`extractFinalText`).
2. `extractJsonText` returns the largest balanced `{…}` span that parses as an
   object; it skips braces inside strings, and repairs nothing.
3. Scoping and synthesis send their output schema as `output_config.format`.
   Length limits are not expressible there and stay in the parsers.

## Consequences

- The parsers still validate every field: the schema constrains decoding, it
  does not replace validation.
- An answer truncated by `max_tokens` still fails, as it should.
- No live run has exercised either path yet. The tests use the recorded
  failure's shape and the response shape documented for web search.
