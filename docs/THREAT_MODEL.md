# Threat model

Praxis turns a business question into a briefing through seven stages, five
of which search the web; synthesis makes one call per format section. This page walks the OWASP Top 10 for LLM
Applications 2025 item by item: whether it applies, what Praxis does about
it, the test that proves the mitigation, and what remains. A mitigation
without a test is listed under "remaining", not under "mitigation".

All tests named here run in `bun test` on the mock provider; none measures
how a live model behaves. Live resistance to injection is unmeasured
(`docs/CLAIMS.md` C14).

## Assets and trust boundaries

- **Assets**: the briefing's integrity (what the reader acts on), the
  Anthropic API key and budget, the question (may be confidential), the
  reader's machine when the briefing is opened.
- **Untrusted inputs**: web pages returned by `web_search`, and every model
  answer (it may have been steered by those pages).
- **Trusted**: the question and flags typed by the operator, the format YAML,
  the `.prompt` files, the code.
- **Outputs**: Markdown, PDF and DOCX files, `metadata.json`, checkpoints
  under `.praxis/runs/` (git-ignored), CLI stderr.

## LLM01 — Prompt injection

**Applies.** Indirect injection is the main threat: a page found by
`web_search` can carry instructions, and its text flows into later stages
through the earlier stages' JSON.

Mitigation:

1. Every earlier stage's output enters a prompt inside an
   `<untrusted_data source="…">` block whose `<` are escaped, so the content
   cannot close the block (`src/agents/prompt-runtime.ts`, `untrustedJson`).
2. Every stage's system text ends with a rule: content in those blocks and
   in web search results is data, never instructions.
3. Code, not the model, decides what a stage may reference: risks may only
   name stakeholders the stakeholder stage returned, options only risk ids
   the risk stage returned, synthesis only cite URLs the earlier stages
   returned, and its prose may not point anywhere else (LLM05).
4. An answer that repeats twelve consecutive words of the system text is
   refused as a leak (LLM07).

Tests:

- `tests/agents/prompt-injection.test.ts`:
  - "it appears only inside untrusted blocks, which it cannot close";
  - "every stage's system text carries the untrusted-content rule";
  - "recommending a non-existent option X is rejected; no briefing results";
  - "repeating the system prompt is rejected, after one retry";
  - "a smuggled closing tag is escaped, and JSON content still parses to the same value".
- `tests/agents/risk.test.ts`: "unknown stakeholder reference is rejected".
- `tests/agents/synthesis.test.ts`: "rejects a cited source whose url is not
  in any upstream artefact", and the five refusals under "links and images
  in the prose".

Remaining:

- Web search results arrive inside the model's own turn (server tool), so
  Praxis cannot wrap them; the system rule alone covers them.
- An injection that steers the model toward one of the *existing* options,
  or slants a claim that keeps a real source, passes every structural check.
  The adversarial stage may flag it; nothing guarantees it.
- None of this is measured against a live model.

## LLM02 — Sensitive information disclosure

**Applies.** Three things can leak: the API key, personal data in logs, and
the question itself.

Mitigation: the provider holds the key in a private field; every line the
CLI writes to stderr goes through one redaction sink that masks the key,
`sk-ant-` keys, `x-api-key` and `Authorization` headers, e-mail addresses
and the home directory; `metadata.json` and checkpoints never hold the key.

Tests: `tests/cli/no-secrets-in-logs.test.ts`:

- "is not in the provider when printed or serialised";
- "is not in stderr when an error message carries it";
- "is not in stderr, metadata.json or checkpoints of a full run";
- "masks keys, auth headers, e-mail addresses and the home directory";
- "a Bearer token after Authorization is masked whole";
- "a Buffer written to stderr is redacted too".

Remaining: the question is sent to Anthropic and, through the model's
search queries, to the search provider; a confidential question should not
be asked. Checkpoints store the question and the stage outputs in clear on
the operator's disk.

## LLM03 — Supply chain

**Applies.** Third-party code (npm packages, GitHub Actions, PromptLang)
and the model itself.

Mitigation: `bun.lock` installed frozen; every action pinned to a commit SHA;
Dependabot weekly; OSV-Scanner and CodeQL on every pull request and weekly;
OpenSSF Scorecard; releases with build provenance (`docs/supply-chain.md`).
Model ids are fixed per prompt and checked against the retired and
deprecated lists.

Tests:

- `tests/ci/required-checks.test.ts` (the checks `main` requires are the
  jobs the workflows declare).
- `tests/llm/anthropic-request-contract.test.ts`: "the built-in default
  model is neither retired nor deprecated".
- The CI jobs `OSV-Scanner (bun.lock) / osv-scan` and `CodeQL (…)`.

Remaining: PromptLang's lexer and parser come from a sibling checkout at a
fixed tag, outside the lockfile, until `@promptlang/core` is on npm (C19).

## LLM04 — Data and model poisoning

**Applies only at retrieval.** Praxis trains and fine-tunes nothing, and
keeps no corpus between runs. The poisoning it can meet is a search result
planted to be found.

Mitigation: each format's `sourcing_rules` rank domains by trust and bound
the age of a source; under `strict`, an untrusted or stale source is refused
and the briefing degrades (ADR 0002) rather than present it as sourced.

Tests: `tests/sourcing/domain-trust.test.ts` ("returns untrusted when the
host is not on the list"), `tests/sourcing/freshness.test.ts`,
`tests/sourcing/validator.test.ts`.

Remaining: a planted page on a trusted domain (a comment, a press release
host) passes the trust check.

## LLM05 — Improper output handling

**Applies.** Model text ends up in files a person opens and in the terminal
the CLI prints to: a Markdown viewer renders HTML and fetches images; a link
is clicked; a terminal obeys escape sequences.

Mitigation:

1. Every model answer is parsed and validated into a typed result before
   use; nothing the model writes is executed or used as a file path.
2. Control characters in an answer, raw or as JSON `\u` escapes (C0 other
   than tab, LF and CR; DEL; C1), become U+FFFD before parsing
   (`src/agents/prompt-runtime.ts`, `callModel`).
3. A cited URL must be an absolute `http(s)` URL: `javascript:`, `data:` and
   `file:` are refused (`src/agents/prompt-runtime.ts`, `parseSource`).
4. A synthesis section's prose may hold no image, and no link, reference,
   autolink, `www.` address or URL other than an upstream source's, on fresh
   answers and on stored checkpoints (`src/agents/synthesis.ts`,
   `checkProse`).
5. Both Markdown outputs, the `--full` default and `--render md-enhanced`,
   write model text through one module (`src/renderers/markdown-text.ts`):
   `<` becomes `&lt;`, `![` cannot open an image, `-->` cannot close the
   validation comment, and link targets are encoded so a URL stays one
   target.
6. DOCX text is XML-escaped; PDF text is drawn as text, with no link
   annotation.

Tests:

- `tests/agents/prompt-runtime.test.ts`, "terminal control characters in an
  answer (OWASP LLM05)": ESC, CSI, BEL, backspace and DEL escapes parse to
  U+FFFD; tab, newline and ordinary escapes are kept.
- `tests/agents/prompt-runtime.test.ts`, "source URLs (OWASP LLM05)": five
  refusals and two accepted URLs.
- `tests/agents/synthesis.test.ts`, "links and images in the prose": ten
  refused forms (images, unknown links and URLs, a known URL with data or a
  path appended, a `www.` address, protocol-relative tags); "a link to an
  upstream source is kept", with four legitimate forms.
- `tests/orchestrator/resume.test.ts`: "a URL no upstream stage returned is
  refused", "an image in the stored prose is refused, as in a fresh answer"
  (stored synthesis).
- `tests/renderers/markdown-enhanced.test.ts`, "model text cannot become
  markup": "raw HTML in a section, a claim or a title is written inert", "an
  image in a claim or a critique is not an image", "a validation issue
  cannot close the comment it is written in", "a URL with parentheses or
  spaces stays one link target".
- `tests/cli/output.test.ts`, "renderFullBrief — model text cannot become
  markup": "raw HTML and images in a section are written inert", "a
  validation issue cannot close its comment, and a URL stays one link
  target".
- `tests/renderers/pdf.test.ts`: "source URLs are drawn as text: the PDF has
  no link annotation".
- `tests/renderers/docx.test.ts`: "XML escaping — angle brackets and
  ampersands survive".

Remaining: a bare URL inside another stage's text (a claim, a critique) is
kept as text, and a viewer that auto-links URLs makes it clickable. It is
not fetched on open. Front matter values are YAML-quoted, not made inert.

## LLM06 — Excessive agency

**Applies, narrowly.** The model's only tool is Anthropic's server-side
`web_search`. It cannot write files, run commands or call other services;
the code decides every side effect.

Mitigation: `max_uses` caps searches per request; the client caps
`pause_turn` rounds; each stage has a tool-round ceiling.

Tests:

- `tests/llm/anthropic-usage-timeout.test.ts`: "max_uses reaches the
  web_search tool definition".
- `tests/agents/stakeholder.test.ts`: "throws MaxToolRoundsExceededError
  when the provider pauses at the cap".

Remaining: none beyond LLM10.

## LLM07 — System prompt leakage

**Applies, low impact.** The prompts are public in `prompts/` and hold no
secret, so a leak reveals nothing that is not in the repository. A leak in
the briefing would still be a defect.

Mitigation: an answer sharing twelve consecutive words with the system text
is refused and retried once.

Tests: `tests/agents/prompt-injection.test.ts`: "twelve consecutive words of
the system text count as a leak, fewer do not", "repeating the system
prompt is rejected, after one retry".

Remaining: a paraphrased leak passes.

## LLM08 — Vector and embedding weaknesses

**Does not apply.** Praxis has no vector store, no embeddings and no
retrieval index; retrieval is the web search tool (LLM01, LLM04).

## LLM09 — Misinformation

**Applies; it is the product risk.** A briefing that reads well and is
wrong is the failure that matters.

Mitigation: every finding, position and risk carries a source or an
explicit `SOURCE_MISSING`; synthesis cannot cite a source the earlier stages
did not return; under `strict`, an unsourced item turns into an
"Insufficiently sourced" section instead of being presented as fact
(ADR 0002); an adversarial stage critiques the assembled brief and can force
one rewrite.

Tests:

- `tests/sourcing/validator.test.ts`: "throws SourcingValidationError when a
  single finding is missing".
- `tests/orchestrator/degrade.test.ts`: "degrade: the briefing completes
  with an Insufficiently sourced section", "degrade: no sourced finding at
  all still aborts".
- `tests/agents/synthesis.test.ts`: "rejects a cited source whose url is not
  in any upstream artefact".

Remaining: whether a cited page supports the claim is not checked, and live
briefing quality is unmeasured: no validated judge (C18), no live run (C14).

## LLM10 — Unbounded consumption

**Applies.** Seven stages, five with web search; one synthesis call per
section; up to five rounds per search request (`pause_turn`); and retries.

Mitigation: per-stage `max_tokens`, timeout and `max_uses`
(`src/agents/stage-limits.ts`); bounded retries; usage priced per call and a
budget cap (`--max-cost-usd`) that stops the run before the next call; a
model without a price stops a capped run.

Tests:

- `tests/orchestrator/ledger.test.ts`: "the budget cap stops the briefing
  before the next call", "with a cap, a call that cannot be priced stops the
  run", "a resumed ledger starts from what earlier attempts spent".
- `tests/llm/anthropic-usage-timeout.test.ts`: "timeout_ms overrides the
  provider default and names itself in the error".
- `tests/orchestrator/resume.test.ts`: "malformed model output and a 5xx are
  recoverable; auth, 4xx and budget are not".

Remaining: a briefing ends above the cap by the calls in flight when it is
reached: one, which for a search stage includes all its rounds, or one per
section during synthesis (`docs/SLO.md`).
