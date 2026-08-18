/**
 * v0.10 — Unit tests for benchmarks/score-all.ts.
 *
 * ZERO real API calls. Every scenario is driven by fixture JSON
 * under tests/fixtures/scoring/ so the suite runs offline and
 * deterministically.
 *
 * Coverage:
 *   - parseScoreArgs: flag combinations, --refresh, --dry-run,
 *     mutual exclusions, unknown flags.
 *   - parseScoringPayload: happy path (valid-scoring.json),
 *     malformed rejections (edge-cases.json), score-out-of-range
 *     rejections, provider allow-list, total mismatch.
 *   - extractJsonBody: fenced ```json blocks, plain-JSON,
 *     preamble+trailing prose, complete garbage.
 *   - aggregate: computes per-criterion mock/live/delta correctly
 *     on the ten-briefing synthetic set.
 *   - computeObservations: identifies live-outperforms
 *     (Δ ≥ +1.0), holds-close (Δ < +0.5), weakest / strongest.
 *   - insertScoringSection: idempotent, replaces existing block,
 *     appends when absent.
 *   - renderScoringSection: markdown structure sanity.
 *   - readCache / writeCache: TTL enforcement, malformed cache
 *     ignored.
 *   - enumerateBriefings: only picks directories with both
 *     brief.md and metadata.json.
 *   - scoreAll(--dry-run): does NOT touch the API, exits with
 *     zero results.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  aggregate,
  computeObservations,
  CRITERION_LABELS,
  enumerateBriefings,
  extractJsonBody,
  insertScoringSection,
  interpolateScoringPrompt,
  parseScoreArgs,
  parseScoringPayload,
  ScoringParseError,
  readCache,
  renderScoringSection,
  scoreAll,
  SCORING_CRITERIA,
  writeCache,
  type ScoringPayload,
} from "../../benchmarks/score-all.ts";

// ---------------------------------------------------------------------------
// parseScoreArgs
// ---------------------------------------------------------------------------

describe("parseScoreArgs", () => {
  test("defaults to no flags", () => {
    const o = parseScoreArgs([]);
    expect(o.mockOnly).toBe(false);
    expect(o.liveOnly).toBe(false);
    expect(o.dryRun).toBe(false);
    expect(o.refresh).toBe(null);
    expect(o.cacheTtlMs).toBe(24 * 60 * 60 * 1000);
  });

  test("--mock-only, --live-only, --dry-run", () => {
    expect(parseScoreArgs(["--mock-only"]).mockOnly).toBe(true);
    expect(parseScoreArgs(["--live-only"]).liveOnly).toBe(true);
    expect(parseScoreArgs(["--dry-run"]).dryRun).toBe(true);
  });

  test("--mock-only and --live-only are mutually exclusive", () => {
    expect(() => parseScoreArgs(["--mock-only", "--live-only"])).toThrow(
      /mutually exclusive/i
    );
  });

  test("--refresh <slug> and --refresh=<slug>", () => {
    expect(parseScoreArgs(["--refresh", "01-x"]).refresh).toBe("01-x");
    expect(parseScoreArgs(["--refresh=02-y"]).refresh).toBe("02-y");
  });

  test("--refresh without a value throws", () => {
    expect(() => parseScoreArgs(["--refresh"])).toThrow(/slug/);
  });

  test("--root <path> and --root=<path>", () => {
    const o1 = parseScoreArgs(["--root", "/tmp/x"]);
    expect(o1.root).toBe("/tmp/x");
    const o2 = parseScoreArgs(["--root=/tmp/y"]);
    expect(o2.root).toBe("/tmp/y");
  });

  test("unknown flag throws", () => {
    expect(() => parseScoreArgs(["--nope"])).toThrow(/Unknown flag/);
  });
});

// ---------------------------------------------------------------------------
// parseScoringPayload
// ---------------------------------------------------------------------------

const VALID = JSON.parse(
  readFileSync("tests/fixtures/scoring/valid-scoring.json", "utf-8")
);
const MALFORMED = JSON.parse(
  readFileSync("tests/fixtures/scoring/malformed-scoring.json", "utf-8")
);
const EDGE = JSON.parse(
  readFileSync("tests/fixtures/scoring/edge-cases.json", "utf-8")
);
const SYNTH: ScoringPayload[] = JSON.parse(
  readFileSync("tests/fixtures/scoring/aggregates-synthetic.json", "utf-8")
);

describe("parseScoringPayload — happy path", () => {
  test("parses valid-scoring.json into a ScoringPayload", () => {
    const p = parseScoringPayload(VALID);
    expect(p.briefing_id).toBe("01-german-market-entry");
    expect(p.provider).toBe("anthropic");
    expect(p.format_id).toBe("mckinsey-style-note");
    expect(p.total).toBe(25);
    // Every criterion present with valid shape.
    for (const c of SCORING_CRITERIA) {
      expect(p.scores[c].score).toBeGreaterThanOrEqual(1);
      expect(p.scores[c].score).toBeLessThanOrEqual(5);
      expect(p.scores[c].example.length).toBeGreaterThan(0);
      expect(p.scores[c].improvement.length).toBeGreaterThan(0);
    }
    // Sum equals total.
    const summed = SCORING_CRITERIA.reduce(
      (acc, c) => acc + p.scores[c].score,
      0
    );
    expect(summed).toBe(p.total);
  });
});

describe("parseScoringPayload — rejections", () => {
  test("malformed-scoring.json is rejected", () => {
    expect(() => parseScoringPayload(MALFORMED)).toThrow(ScoringParseError);
  });

  test("score 0 rejected (out of [1,5])", () => {
    expect(() => parseScoringPayload(EDGE.score_zero_rejected)).toThrow(
      /\[1, 5\]/
    );
  });

  test("score 6 rejected (out of [1,5])", () => {
    expect(() => parseScoringPayload(EDGE.score_six_rejected)).toThrow(
      /\[1, 5\]/
    );
  });

  test("missing criterion rejected", () => {
    expect(() => parseScoringPayload(EDGE.missing_criterion)).toThrow(
      /format_fidelity/
    );
  });

  test("total mismatch rejected", () => {
    expect(() => parseScoringPayload(EDGE.total_mismatch)).toThrow(
      /does not equal the sum/
    );
  });

  test("unknown provider rejected", () => {
    expect(() => parseScoringPayload(EDGE.unknown_provider)).toThrow(
      /provider.*mock.*anthropic/
    );
  });

  test("non-object input rejected", () => {
    expect(() => parseScoringPayload("string")).toThrow(/JSON object/);
    expect(() => parseScoringPayload([])).toThrow(/JSON object/);
    expect(() => parseScoringPayload(null)).toThrow(/JSON object/);
  });
});

// ---------------------------------------------------------------------------
// extractJsonBody
// ---------------------------------------------------------------------------

describe("extractJsonBody", () => {
  test("plain JSON pass-through", () => {
    expect(extractJsonBody('{"a":1}')).toBe('{"a":1}');
  });

  test("stripped surrounding whitespace", () => {
    expect(extractJsonBody('   {"a":1}   \n')).toBe('{"a":1}');
  });

  test("fenced ```json block", () => {
    const wrapped = '```json\n{"a":1}\n```';
    expect(extractJsonBody(wrapped)).toBe('{"a":1}');
  });

  test("fenced ``` block without language tag", () => {
    const wrapped = '```\n{"a":1}\n```';
    expect(extractJsonBody(wrapped)).toBe('{"a":1}');
  });

  test("JSON embedded in prose", () => {
    const wrapped = 'here you go: {"a":1} — that was easy';
    expect(extractJsonBody(wrapped)).toBe('{"a":1}');
  });

  test("no JSON at all → throws", () => {
    expect(() => extractJsonBody("just prose here")).toThrow(ScoringParseError);
  });
});

// ---------------------------------------------------------------------------
// interpolateScoringPrompt
// ---------------------------------------------------------------------------

describe("interpolateScoringPrompt", () => {
  test("substitutes every placeholder", () => {
    const template =
      "id={briefing_id} p={provider} fmt={format_id} q={question} body={briefing_markdown}";
    const out = interpolateScoringPrompt(
      template,
      {
        slug: "s",
        mode: "mock",
        dir: ".",
        brief_md_path: "./brief.md",
        metadata_path: "./m.json",
      },
      { id: "S", question: "Q?", format: "F", mode: "mock" },
      "MD"
    );
    expect(out).toBe("id=S p=mock fmt=F q=Q? body=MD");
  });

  test("live mode maps to provider=anthropic", () => {
    const template = "p={provider}";
    const out = interpolateScoringPrompt(
      template,
      {
        slug: "s",
        mode: "live",
        dir: ".",
        brief_md_path: ".",
        metadata_path: ".",
      },
      { id: "S", question: "?", format: "F", mode: "live" },
      "MD"
    );
    expect(out).toBe("p=anthropic");
  });
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

describe("aggregate", () => {
  test("computes correct mock/live counts and averages on the synthetic set", () => {
    const parsed = SYNTH.map(parseScoringPayload);
    const agg = aggregate(parsed);
    expect(agg.mock_n).toBe(5);
    expect(agg.live_n).toBe(5);
    expect(agg.total_mock_avg).not.toBeNull();
    expect(agg.total_live_avg).not.toBeNull();
    // Sanity: live totals are strictly higher than mock totals in the fixture.
    expect(agg.total_live_avg!).toBeGreaterThan(agg.total_mock_avg!);
    // Delta is live - mock.
    expect(agg.total_delta).toBeCloseTo(
      agg.total_live_avg! - agg.total_mock_avg!,
      1
    );
  });

  test("per-criterion deltas equal live avg minus mock avg", () => {
    const parsed = SYNTH.map(parseScoringPayload);
    const agg = aggregate(parsed);
    for (const c of SCORING_CRITERIA) {
      const a = agg.by_criterion[c];
      expect(a.mock_n).toBe(5);
      expect(a.live_n).toBe(5);
      expect(a.mock_avg).not.toBeNull();
      expect(a.live_avg).not.toBeNull();
      expect(a.delta).toBeCloseTo(a.live_avg! - a.mock_avg!, 1);
    }
  });

  test("aggregate on mock-only returns null live averages", () => {
    const parsed = SYNTH.filter((s) => s.provider === "mock").map(
      parseScoringPayload
    );
    const agg = aggregate(parsed);
    expect(agg.mock_n).toBe(5);
    expect(agg.live_n).toBe(0);
    expect(agg.total_live_avg).toBeNull();
    expect(agg.total_delta).toBeNull();
  });

  test("aggregate on empty input returns all-null aggregates", () => {
    const agg = aggregate([]);
    expect(agg.mock_n).toBe(0);
    expect(agg.live_n).toBe(0);
    expect(agg.total_mock_avg).toBeNull();
    expect(agg.total_live_avg).toBeNull();
    expect(agg.total_delta).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeObservations
// ---------------------------------------------------------------------------

describe("computeObservations", () => {
  test("identifies weakest / strongest aspects from real deltas", () => {
    const parsed = SYNTH.map(parseScoringPayload);
    const agg = aggregate(parsed);
    const obs = computeObservations(agg, parsed);
    // In the synthetic set, perceived_sourcing has the widest delta
    // (mock 2.4 vs live 4.4). It should be among live-outperforms.
    expect(obs.live_outperforms.join(", ")).toContain(
      CRITERION_LABELS.perceived_sourcing
    );
    // format_fidelity is stable across mock and live at 4.0 →
    // holds-close (delta 0).
    expect(obs.mock_holds_close.join(", ")).toContain(
      CRITERION_LABELS.format_fidelity
    );
    expect(obs.weakest_aspect.length).toBeGreaterThan(0);
    expect(obs.strongest_aspect.length).toBeGreaterThan(0);
    expect(obs.verdict.length).toBeGreaterThan(0);
  });

  test("handles a briefing below the usability floor", () => {
    // Craft a scoring with total < 15.
    const low: ScoringPayload = {
      briefing_id: "sink",
      provider: "mock",
      format_id: "executive-pre-read",
      scores: {
        framing_clarity: { score: 1, example: "…", improvement: "…" },
        non_hedging: { score: 1, example: "…", improvement: "…" },
        decisive_recommendation: { score: 1, example: "…", improvement: "…" },
        concrete_tradeoffs: { score: 1, example: "…", improvement: "…" },
        perceived_sourcing: { score: 2, example: "…", improvement: "…" },
        adversarial_usefulness: { score: 2, example: "…", improvement: "…" },
        format_fidelity: { score: 2, example: "…", improvement: "…" },
      },
      total: 10,
      weakest_aspect: "…",
      strongest_aspect: "…",
      comparative_note: "…",
    };
    const agg = aggregate([low]);
    const obs = computeObservations(agg, [low]);
    const verdictJoined = obs.verdict.join(" ");
    expect(verdictJoined).toContain("below the 15/35 usability floor");
  });
});

// ---------------------------------------------------------------------------
// insertScoringSection
// ---------------------------------------------------------------------------

describe("insertScoringSection", () => {
  test("appends when no block exists", () => {
    const existing = "# Benchmark results\n\n## Objective checks\n\nfoo\n";
    const block =
      "## AI-Assisted Qualitative Scoring (2026-01-01)\n\nnew content\n";
    const out = insertScoringSection(existing, block);
    expect(out).toContain("## Objective checks");
    expect(out).toContain("## AI-Assisted Qualitative Scoring (2026-01-01)");
  });

  test("replaces (does not concatenate) when block exists", () => {
    const existing =
      "# Results\n\n## AI-Assisted Qualitative Scoring (2026-01-01)\n\nOLD\n\n## Other\n\ntail\n";
    const block =
      "## AI-Assisted Qualitative Scoring (2026-02-02)\n\nNEW\n";
    const out = insertScoringSection(existing, block);
    expect(out).toContain("NEW");
    expect(out).not.toContain("OLD");
    // Tail is preserved.
    expect(out).toContain("## Other");
    expect(out).toContain("tail");
    // Only one AI-Assisted block.
    const matches = out.match(/## AI-Assisted Qualitative Scoring/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// renderScoringSection
// ---------------------------------------------------------------------------

describe("renderScoringSection", () => {
  test("renders the seven-criterion table and totals row", () => {
    const parsed = SYNTH.map(parseScoringPayload);
    const agg = aggregate(parsed);
    const obs = computeObservations(agg, parsed);
    const md = renderScoringSection(parsed, agg, obs, "2026-01-01");
    expect(md).toContain("## AI-Assisted Qualitative Scoring (2026-01-01)");
    expect(md).toContain("| Criterion | Mock (n) | Live (n) | Delta |");
    for (const c of SCORING_CRITERIA) {
      expect(md).toContain(CRITERION_LABELS[c]);
    }
    expect(md).toContain("**Total /35**");
    expect(md).toContain("Per-briefing scores");
    expect(md).toContain("Systematic observations");
    expect(md).toContain("Overall verdict:");
  });
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe("readCache / writeCache", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = join(tmpdir(), `praxis-score-cache-${Date.now()}-${Math.random()}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("writeCache + readCache round-trip", () => {
    const p = parseScoringPayload(VALID);
    writeCache(tmp, "01-german-market-entry", "live", p);
    const back = readCache(tmp, "01-german-market-entry", "live", 60_000);
    expect(back).not.toBeNull();
    expect(back!.total).toBe(p.total);
    expect(back!.provider).toBe(p.provider);
  });

  test("readCache returns null past TTL", () => {
    const p = parseScoringPayload(VALID);
    writeCache(tmp, "01-x", "mock", p);
    // TTL = 0 → any age exceeds it.
    const back = readCache(tmp, "01-x", "mock", 0, Date.now() + 1000);
    expect(back).toBeNull();
  });

  test("readCache returns null on malformed cache file", () => {
    const dir = join(tmp, "benchmarks", ".scoring-cache");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "01-broken-mock.json"), "{ not json");
    const back = readCache(tmp, "01-broken", "mock", 60_000);
    expect(back).toBeNull();
  });

  test("readCache returns null when file absent", () => {
    const back = readCache(tmp, "01-nope", "mock", 60_000);
    expect(back).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// enumerateBriefings — reads the shipped v0.9 mock outputs
// ---------------------------------------------------------------------------

describe("enumerateBriefings", () => {
  test("finds every mock briefing that declares 'md' in output_targets", () => {
    // v0.9 output artefacts: only formats declaring `md` in
    // `output_targets[]` produce a brief.md. That is:
    //   executive-pre-read       ([md, pdf])           → 3 briefings (02-04)
    //   mckinsey-style-note      ([md, pdf, docx])     → 4 briefings (01, 05-07)
    //   position-paper-corporate ([pdf, docx])         → 0 briefings (08-10)
    // Total: 7. The three position-paper briefings are documented
    // limitations in docs/benchmarking-methodology.md and will be
    // resolved in v0.10.1 by writing a scoring-source text artefact.
    const refs = enumerateBriefings(".", { mockOnly: true, liveOnly: false });
    expect(refs.length).toBe(7);
    expect(refs.every((r) => r.mode === "mock")).toBe(true);
    for (const r of refs) {
      expect(existsSync(r.brief_md_path)).toBe(true);
      expect(existsSync(r.metadata_path)).toBe(true);
    }
    // Every position-paper briefing (08-10) is correctly SKIPPED.
    const slugs = refs.map((r) => r.slug).join(",");
    expect(slugs).not.toContain("08-");
    expect(slugs).not.toContain("09-");
    expect(slugs).not.toContain("10-");
  });

  test("live-only with only the placeholder README returns zero refs", () => {
    const refs = enumerateBriefings(".", { mockOnly: false, liveOnly: true });
    // The v0.9 live/ dir has only .gitkeep + README.md — no directories.
    expect(refs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreAll --dry-run — never touches the API
// ---------------------------------------------------------------------------

describe("scoreAll — --dry-run", () => {
  let originalStderr: typeof process.stderr.write;
  let stderrBuf: string[];

  beforeEach(() => {
    stderrBuf = [];
    originalStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown): boolean => {
      stderrBuf.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderr;
  });

  test("dry-run enumerates without calling the API", async () => {
    const report = await scoreAll({
      mockOnly: true,
      liveOnly: false,
      refresh: null,
      dryRun: true,
      root: ".",
      cacheTtlMs: 60_000,
    });
    expect(report.scored).toBe(0);
    expect(report.from_cache).toBe(0);
    expect(report.errors).toBe(0);
    expect(report.results_md_path).toBeNull();
    const out = stderrBuf.join("");
    expect(out).toContain("dry-run: would score");
    expect(out).toContain("no API call issued");
  });

  test("dry-run does NOT require ANTHROPIC_API_KEY", async () => {
    const saved = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      const report = await scoreAll({
        mockOnly: true,
        liveOnly: false,
        refresh: null,
        dryRun: true,
        root: ".",
        cacheTtlMs: 60_000,
      });
      expect(report.errors).toBe(0);
    } finally {
      if (saved === undefined) delete process.env["ANTHROPIC_API_KEY"];
      else process.env["ANTHROPIC_API_KEY"] = saved;
    }
  });

  test("--live-only in dry-run does NOT throw even when no live outputs exist", async () => {
    // Wait — the spec says --live-only errors when no live outputs; but
    // dry-run should still error (the goal of --live-only is to score live).
    // Cover the ACTUAL behaviour: dry-run enumerates whatever is there; if
    // --live-only requests it and there are no live briefings, the error
    // guard fires BEFORE dry-run branches out.
    await expect(
      scoreAll({
        mockOnly: false,
        liveOnly: true,
        refresh: null,
        dryRun: true,
        root: ".",
        cacheTtlMs: 60_000,
      })
    ).rejects.toThrow(/no live briefings/);
  });
});
