/**
 * v0.9 — `--format auto` keyword detector.
 *
 * Verifies:
 *   - Each shipped format is picked when its canonical keywords fire.
 *   - Word-boundary discipline (`board` in `boardroom` is NOT a match).
 *   - Ambiguous overlap surfaces as `{ kind: "ambiguous", matches }`.
 *   - Unknown questions surface as `{ kind: "no-match" }`.
 *   - The runBriefCli integration path routes `--format auto` to the
 *     matched format and prints a helpful stderr note.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  AUTO_FORMAT_IDS,
  AUTO_FORMAT_KEYWORDS,
  detectFormatFromQuestion,
} from "../../src/cli/format-auto.ts";
import { runBriefCli } from "../../src/cli/commands/brief.ts";
import { setColorEnabled, setVerbosity } from "../../src/cli/output.ts";

const CTX = {
  formatsDir: "formats",
  fixturesDir: "tests/fixtures/mock-llm",
};

let stdoutBuf: string[];
let stderrBuf: string[];
let originalStdout: typeof process.stdout.write;
let originalStderr: typeof process.stderr.write;

beforeEach(() => {
  setColorEnabled(false);
  setVerbosity("normal");
  stdoutBuf = [];
  stderrBuf = [];
  originalStdout = process.stdout.write.bind(process.stdout);
  originalStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown): boolean => {
    stdoutBuf.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderrBuf.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = originalStdout;
  process.stderr.write = originalStderr;
  setVerbosity("normal");
});

const stdout = (): string => stdoutBuf.join("");
const stderr = (): string => stderrBuf.join("");

// ---------------------------------------------------------------------------
// Pure detector — unit tests
// ---------------------------------------------------------------------------

describe("detectFormatFromQuestion — matched cases", () => {
  test("board keyword → executive-pre-read", () => {
    const r = detectFormatFromQuestion("What should the board decide?");
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.id).toBe("executive-pre-read");
  });

  test("executive keyword → executive-pre-read", () => {
    const r = detectFormatFromQuestion(
      "Executive summary for the CFO please."
    );
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.id).toBe("executive-pre-read");
  });

  test("policy keyword → position-paper-corporate", () => {
    // NB: no "should we" here — that would tip into ambiguous.
    const r = detectFormatFromQuestion("Frame our policy response.");
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.id).toBe("position-paper-corporate");
  });

  test("regulatory keyword → position-paper-corporate", () => {
    const r = detectFormatFromQuestion(
      "Draft our reply to the new regulatory framework."
    );
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.id).toBe("position-paper-corporate");
  });

  test("M&A keyword → mckinsey-style-note", () => {
    const r = detectFormatFromQuestion("Evaluate the M&A opportunity.");
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.id).toBe("mckinsey-style-note");
  });

  test("acquisition keyword → mckinsey-style-note", () => {
    const r = detectFormatFromQuestion("Should we pursue the acquisition?");
    // Note: also matches "should we" for mckinsey-style-note → still resolves
    // to mckinsey-style-note; but not ambiguous because both keywords belong
    // to the same format group.
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") {
      expect(r.id).toBe("mckinsey-style-note");
      expect(r.matched_keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("detectFormatFromQuestion — word-boundary discipline", () => {
  test("'board' does NOT match inside 'boardroom'", () => {
    const r = detectFormatFromQuestion("How is the boardroom decor?");
    expect(r.kind).toBe("no-match");
  });

  test("case-insensitive match works", () => {
    const r = detectFormatFromQuestion("What Should The BOARD Do?");
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.id).toBe("executive-pre-read");
  });
});

describe("detectFormatFromQuestion — ambiguous overlap", () => {
  test("keywords from two different formats → ambiguous", () => {
    // "board" → executive-pre-read; "regulatory" → position-paper-corporate.
    const r = detectFormatFromQuestion(
      "Board briefing on the regulatory shift?"
    );
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") {
      const ids = r.matches.map((m) => m.id).sort();
      expect(ids).toContain("executive-pre-read");
      expect(ids).toContain("position-paper-corporate");
    }
  });
});

describe("detectFormatFromQuestion — no-match paths", () => {
  test("neutral question → no-match", () => {
    const r = detectFormatFromQuestion("Tell me about the weather.");
    expect(r.kind).toBe("no-match");
  });
});

describe("AUTO_FORMAT_IDS / AUTO_FORMAT_KEYWORDS export shape", () => {
  test("four shipped format ids exposed", () => {
    expect(AUTO_FORMAT_IDS.length).toBe(4);
    expect(AUTO_FORMAT_IDS).toContain("executive-pre-read");
    expect(AUTO_FORMAT_IDS).toContain("position-paper-corporate");
    expect(AUTO_FORMAT_IDS).toContain("mckinsey-style-note");
    expect(AUTO_FORMAT_IDS).toContain("family-office-memo");
  });

  test("every format has at least one keyword", () => {
    for (const id of AUTO_FORMAT_IDS) {
      expect(AUTO_FORMAT_KEYWORDS[id].length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// CLI integration — `praxis brief "..." --format auto`
// ---------------------------------------------------------------------------

describe("runBriefCli — --format auto integration", () => {
  test("--format auto with a matching question resolves and prints a note", async () => {
    const code = await runBriefCli(
      [
        "Should we enter the German market?",
        "--format",
        "auto",
        "--full",
      ],
      CTX
    );
    expect(code).toBe(0);
    // Progress note names the chosen format on stderr.
    expect(stderr()).toContain("--format auto → mckinsey-style-note");
    // The brief still lands on stdout.
    expect(stdout()).toContain("# Should we enter the German market?");
  });

  test("--format auto with an ambiguous question exits 1 with context", async () => {
    const code = await runBriefCli(
      [
        "Board briefing on the regulatory shift?",
        "--format",
        "auto",
        "--full",
      ],
      CTX
    );
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("ambiguous match");
    expect(err).toContain("cause:");
    expect(err).toContain("suggestion:");
  });

  test("--format auto with a no-match question exits 1 with context", async () => {
    const code = await runBriefCli(
      ["Tell me about the weather.", "--format", "auto", "--full"],
      CTX
    );
    expect(code).toBe(1);
    const err = stderr();
    expect(err).toContain("no keyword match");
    expect(err).toContain("suggestion:");
  });
});
