/**
 * v0.9 — `--format auto` — opinionated shortcut, not intelligence.
 *
 * Maps question keywords to one of the shipped formats:
 *
 *   executive-pre-read       → board / executive / leadership decision
 *   position-paper-corporate → position / regulatory / policy / association
 *   mckinsey-style-note      → should we / market entry / M&A / acquisition / strategic
 *   family-office-memo       → family council / family principal / successor generation / patrimonial / family office
 *
 * Design note: this is a deterministic keyword matcher, not an LLM
 * router. When several groups fire (e.g. "Should we take a position
 * on the new regulation?" matches both mckinsey-style-note and
 * position-paper-corporate), the result is `{ kind: "ambiguous",
 * matches }` — the caller decides between prompting interactively
 * or emitting an actionable error under `--quiet`.
 *
 * Users who dislike the choice can always spell the format id.
 */

export const AUTO_FORMAT_IDS = [
  "executive-pre-read",
  "position-paper-corporate",
  "mckinsey-style-note",
  "family-office-memo",
] as const;

export type AutoFormatId = (typeof AUTO_FORMAT_IDS)[number];

/**
 * Keyword groups per format. Order matters ONLY for tie-break
 * heuristics: the current implementation returns `ambiguous` on any
 * tie rather than silently biasing.
 */
export const AUTO_FORMAT_KEYWORDS: Record<AutoFormatId, readonly string[]> = {
  "executive-pre-read": ["board", "executive", "leadership decision"],
  "position-paper-corporate": [
    "position",
    "regulatory",
    "policy",
    "association",
  ],
  "mckinsey-style-note": [
    "should we",
    "market entry",
    "m&a",
    "acquisition",
    "strategic",
  ],
  "family-office-memo": [
    "family council",
    "family principal",
    "successor generation",
    "patrimonial",
    "family office",
  ],
};

export type AutoFormatResult =
  | { kind: "matched"; id: AutoFormatId; matched_keywords: string[] }
  | { kind: "ambiguous"; matches: readonly AutoMatch[] }
  | { kind: "no-match" };

export interface AutoMatch {
  id: AutoFormatId;
  matched_keywords: string[];
}

/**
 * Detect the target format from the raw question string.
 *
 *   - `matched`   — exactly one format's keyword group fired.
 *   - `ambiguous` — two or three groups fired. Caller picks the UX.
 *   - `no-match`  — no group fired. Caller emits "please pick one".
 *
 * The match is case-insensitive and word-boundary-aware where
 * possible (e.g. `board` in `boardroom` is NOT a match; `M&A` is a
 * literal substring since the ampersand defeats `\b`).
 */
export function detectFormatFromQuestion(question: string): AutoFormatResult {
  const q = question.toLowerCase();
  const matches: AutoMatch[] = [];

  for (const id of AUTO_FORMAT_IDS) {
    const hits: string[] = [];
    for (const kw of AUTO_FORMAT_KEYWORDS[id]) {
      if (matchesKeyword(q, kw)) hits.push(kw);
    }
    if (hits.length > 0) {
      matches.push({ id, matched_keywords: hits });
    }
  }

  if (matches.length === 0) return { kind: "no-match" };
  if (matches.length === 1) {
    const m = matches[0]!;
    return { kind: "matched", id: m.id, matched_keywords: m.matched_keywords };
  }
  return { kind: "ambiguous", matches };
}

/**
 * A keyword matches when it appears as a word/phrase in `q`. Rules:
 *
 *   - Multi-word keywords (contain a space) match as literal substrings.
 *     `"should we"` matches `"When should we enter?"`.
 *   - Single-word keywords match on word boundaries (`\b`). `board`
 *     does NOT match inside `boardroom`.
 *   - Keywords containing punctuation the boundary regex cannot
 *     handle (e.g. `m&a`) match as literal substrings after
 *     casefolding.
 */
function matchesKeyword(q: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (kw.includes(" ")) return q.includes(kw);
  if (!/^[a-z0-9]+$/.test(kw)) return q.includes(kw);
  // Word-boundary regex; escape not needed because kw is [a-z0-9]+.
  const re = new RegExp(`\\b${kw}\\b`, "i");
  return re.test(q);
}
