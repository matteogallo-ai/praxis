# Benchmarking methodology (v0.10)

Praxis ships two things labelled "benchmarks":

- **Objective checks** — automated, deterministic, format /
  structure / freshness verifications on the ten calibrated
  briefings. Shipped in v0.9. See
  `benchmarks/CHECKLIST.md § Objective checks`.
- **AI-assisted qualitative scoring** — a Claude Sonnet 4.5 pass
  over each briefing that returns a 7-criterion 1-to-5 score plus
  a systematic analysis. Framework shipped in v0.10.0;
  empirical results (mock-vs-live delta table in `RESULTS.md`)
  land in **v0.10.1** when a maintainer with API credits runs
  `bun run score`.

This document covers the second track: the rubric, the prompt,
the model choice, the known biases, and how to reproduce.

---

## The rubric

Seven criteria, each scored 1–5, summed to a total /35. Higher
is better.

1. **Framing clarity** — Is the question stated, and is the
   reader oriented, within the first paragraph?
2. **Non-hedging** — Does the brief commit, or does it fill
   itself with `may` / `could` / `arguably`?
3. **Decisive recommendation** — Is there a clear call to
   action, or is the reader left with "on the one hand …"?
4. **Concrete tradeoffs** — Are cost / time / exposure
   dimensioned, or hand-waved?
5. **Perceived sourcing** — Do the citations look tier-1 to a
   senior reader, or thin?
6. **Adversarial usefulness** — Does the critique steelman real
   objections, or straw-man?
7. **Format fidelity** — Does it read like the target format
   (McKinsey MECE, exec pre-read, position paper), or generic?

The score bands are calibrated:

| Score | Meaning                                         |
| ----- | ----------------------------------------------- |
| 1     | Actively bad — unusable at that criterion.      |
| 2     | Below expectations for a junior analyst.        |
| 3     | Normal / passable. Most competent output lives here. |
| 4     | Above expectations — the reader is grateful.    |
| 5     | Genuinely excellent — surprises a senior partner. |

**Do not inflate.** A brief that averages 3.0 is not failing. A
brief that averages 4.0 is genuinely strong. Scores at 5.0
across the board should be rare; if the aggregate ever creeps
there, the rubric or the prompt is broken.

---

## The prompt

Text lives at `benchmarks/scoring-prompt.txt`. Verbatim contract
of what the scorer receives; edited by the release owner, never
by the scorer, never by the CLI at runtime.

Key discipline choices in the prompt:

- **"You are NOT the author"** — casts the scorer as a reviewer,
  not the writer. Reduces the "praise everything" pull.
- **"Executives who read weak briefings make bad decisions —
  your rigor protects them"** — grounds the incentive.
- **"BE HONEST. A score of 3/5 is NORMAL"** — repeated because
  LLMs default to leniency. Empirical: this line alone typically
  drops average scores by 0.5 points.
- **"For each criterion, provide: score, example, improvement"**
  — forces per-criterion specificity, harder to bluff.
- **"Return ONLY this JSON"** — the parser
  (`parseScoringPayload`) rejects any preamble or trailing text.

If you edit the prompt, keep the JSON schema stable — the parser
is strict and any deviation surfaces as a `ScoringParseError`.

---

## Model choice

`claude-sonnet-4-5` — the same model the Synthesis and
Adversarial agents run against by default. Consistency matters:

- **Same-family scoring**. Claude scores Claude output. This is
  a **known bias** (see § Limitations below).
- **Cost sanity**. Sonnet is cheap enough for 20+ scorings per
  release, unlike Opus.
- **Reasoning quality**. Under the calibrated prompt Sonnet is
  strict, mostly refuses to hand out 5s, and produces the
  per-criterion `example` fields at analytical depth.

The model id is hard-coded in `score-all.ts` as the constructor
argument to `AnthropicLLMProvider`. Change it there if you want
to experiment with a different model.

---

## Known biases and limitations

- **Same-family scoring bias.** Claude Sonnet is likely to
  reward the phrasing conventions of Claude-authored briefs.
  Interpret mock-vs-live deltas as **comparative** signal (does
  live outperform mock?) more than **absolute** quality. Absolute
  scores are directional, not gospel.
- **Deterministic mock content.** The MockLLMProvider fixtures
  respond to the format id, not the question. Every mock brief
  for a given format contains identical body text. Ten mock
  scorings across three formats therefore give the scorer only
  three distinct texts to grade, which produces artificially
  clustered mock scores.
- **v0.10.0 scoring covers 7 of the 10 mock briefings.** The
  three `position-paper-corporate` briefings (08–10) do not
  emit `brief.md` because that format does not declare `md` in
  `output_targets[]`. v0.10.1 will resolve this by emitting a
  scoring-source text artefact alongside `pdf`/`docx`.
- **No calibration against human reviewers.** A future release
  will hand the ten mocks + ten lives to a senior consultant
  for a blind score, and correlate against the AI scoring. That
  is the acid test.
- **Cache TTL is 24 h.** A retry within 24 hours reads from
  `.scoring-cache/` (gitignored) and does not spend tokens. On
  cache miss the full pass runs; use `--refresh <slug>` to
  bypass the cache for a single briefing.

---

## Reproducing

Prerequisites: `ANTHROPIC_API_KEY` in `.env` or exported in your
shell, funded to ~$10 (see § Budget below).

```bash
# Generate the ten mock briefings if you haven't already.
bun run bench:mock

# Generate the ten live briefings (Anthropic API).
bun run bench:live

# Score every briefing on disk (mock + live).
bun run score

# Or scope the scoring to one mode.
bun run score:mock
bun run score:live

# Dry-run: enumerate what would be scored, no API call.
bun run score:dry

# Force a refresh for one slug.
bun run benchmarks/score-all.ts --refresh 01-german-market-entry
```

`bun run score` rewrites the "AI-Assisted Qualitative Scoring"
block in `benchmarks/RESULTS.md`. It preserves the v0.9
"Automated objective checks" block above it verbatim.

---

## Budget

Ballpark, at v0.10 rates (subject to Anthropic pricing changes):

- **Live benchmark generation** (10 × 7 agents +
  strict_editorial retries + rerun): **~$3–5**
- **Scoring** (20 briefings × one 5–8 kToken prompt + short
  JSON response): **~$0.50–1.50**
- **Total per full pass**: **~$5–7**

Cache TTL (24 h) means development-time iterations on the
prompt or aggregation are effectively free after the first pass.

---

## Interpretation guide

When the empirical RESULTS.md table finally lands, read it like
this:

- The **delta** column is the load-bearing figure. If live
  ≥ mock + 1.5 on `perceived_sourcing`, that is the value of
  the live provider paying off. If the delta is < 0.5, the
  test bar is too permissive.
- **Low mock scores are expected** on
  `perceived_sourcing` and `concrete_tradeoffs`. The mock
  fixtures cite second-tier sources on purpose; the scorer
  should catch that.
- **High mock scores** on `format_fidelity` and
  `framing_clarity` validate the Format Registry — the
  structural discipline is format-agnostic to LLM quality.
- **Weakest aspect** is a release backlog item; every release
  should try to lift the previous weakest.

---

## When to trust the scores

- Trust the **relative** signal (mock-vs-live delta, per-format
  ranking, per-criterion trend across releases).
- Trust the **outliers** more than the averages. A briefing
  scoring 14/35 is a real regression to investigate; a briefing
  scoring 34/35 is worth reading closely to see what worked.
- Trust the `weakest_aspect` and `strongest_aspect` free-text
  fields — they are the scorer's honest one-line take.
- **Do NOT** use AI scoring as a substitute for a senior human
  read. It is a coarse gate, not the final review.
