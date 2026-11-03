# Runbook

The five failures a `praxis brief --full` run is most likely to hit, ranked
by what the recorded live runs and the code's error paths show (CHANGELOG
1.2.1: five of five live briefings aborted, on causes 2, 3 and 4 below).
For each: what you see, how to tell it apart, what to do.

Every failure exits with code 1 and one red `✗` line on stderr naming the
error class. A `--full` run prints its id at the start
(`→ run (<run-id> in .praxis/runs/<run-id>; resume with --resume <run-id>)`),
writes one checkpoint per finished stage and writes `metadata.json`
(tokens, searches, cost and duration per stage) even when it fails. The
stage that failed is the first one without a `<stage>.json` in the run
directory.

## 1. No API key, or a rejected one

- **Symptom**: an empty or missing key stops the command before any run
  starts ("The Anthropic provider needs a valid API key"); a key the API
  rejects stops the first stage with `AnthropicAuthenticationError`.
- **Detection**: no run id is printed (missing key), or the run has no stage
  checkpoint (rejected key).
- **Response**: set `ANTHROPIC_API_KEY` (Bun reads `.env` from the working
  directory), check it in the Anthropic console, run again. Nothing was
  spent.

## 2. A stage's answer is not the expected JSON

- **Symptom**: `InvalidAgentOutputError` naming the stage and the field
  (e.g. `findings[2].source.url must be an absolute http(s) URL`), after one
  automatic retry. Also: a reference to a stakeholder, risk or option that
  does not exist (`InvalidRiskStakeholderReference`,
  `InvalidOptionRiskReference`), or synthesis citing a URL no stage returned.
- **Detection**: the message names the stage; the earlier stages have
  checkpoints.
- **Response**: `praxis brief --resume <run-id>` reruns from that stage; the
  earlier ones are not called again. If it fails the same way twice, the
  prompt and the model disagree: read the raw answer in the error, compare
  it with the prompt's output contract, and fix the prompt (bumping its
  `@version`) before resuming. A prompt change makes the resume refuse the
  old run (see "Resume refused" below): start a new one.

## 3. Too few sourced findings under a `strict` format

- **Symptom**: either the briefing completes with an "Insufficiently
  sourced" section and `insufficiently_sourced: true` in `--json`, or it
  stops with `SourcingValidationError: … no research finding has a source`.
- **Detection**: the sourcing report (`--sourcing-report`, or
  `sourcing_report` in `--json`) lists each `SOURCE_MISSING`, stale or
  untrusted source with the stage and item.
- **Response**: this is the pipeline refusing to present unsourced claims as
  fact (ADR 0002), not a crash. Narrow the question, choose a `permissive`
  format if the reader accepts unsourced context, or treat the briefing as
  a list of what could not be sourced. `--on-sourcing-failure abort` turns
  the degraded case into a failure when a partial briefing is useless.

## 4. Anthropic is slow, rate-limiting or failing

- **Symptom**: `AnthropicTimeoutError` (`Anthropic API request timed out
  after <ms>ms`, the stage's own timeout), `AnthropicRateLimitError` or `AnthropicAPIError` with a 5xx.
- **Detection**: the error class; `metadata.json` shows the stages that
  finished and their durations. A timed-out request reports no usage; under
  a cap it is charged its worst case (`unreported_usd` in the stage's usage),
  so a run with timeouts can stop at its cap before the work is done.
- **Response**: the provider already retried 429 and 5xx with backoff, and
  the stage retried once. Wait, check https://status.anthropic.com, then
  `--resume <run-id>`. Repeated timeouts on one stage with a healthy API mean
  its timeout is short for the work: the stage limits are derived, not
  measured (`src/agents/stage-limits.ts`); compare with
  `usage.stages.<stage>.duration_ms` of finished runs before raising one.

## 5. The budget cap stops the run

- **Symptom**: `BudgetExceededError: Budget cap reached before stage '…':
  $x spent of a $y cap`, or `… stops the run before stage '…': <model> has no
  price` when the model is missing from the price table.
- **Detection**: `metadata.json` → `usage.total.cost_usd` and the cost per
  stage.
- **Response**: decide whether the remaining stages are worth it, then
  `--resume <run-id> --max-cost-usd <higher>`; the resumed run counts what
  the earlier attempts spent. For an unpriced model, add it with
  `--price-table <file>` rather than lifting the cap.

## Resume refused

`--resume` refuses a run whose provider, sourcing mode, prompts or format
changed since it started (`OrchestrationError: Run '<id>' cannot be
resumed: … Start a new run instead.`): reusing outputs produced under other
prompts would mix two pipelines in one briefing. Start a new run. A
checkpoint that no longer passes its stage's validation is refused too
(`Checkpoint '<stage>' of run '<id>' is invalid: …`); delete that file to
run the stage again, or start a new run.
