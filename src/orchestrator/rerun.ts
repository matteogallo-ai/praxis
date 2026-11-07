/**
 * Whether the synthesis rerun changed a section substantially, and the
 * reason recorded for running it.
 */
import type { AdversarialCritiqueResult, Critique, SynthesisResult, SynthesizedSection } from "../agents/types.ts";
import { levenshtein } from "../sourcing/dedupe.ts";

/**
 * "Substantial change" between two versions of a section:
 *   - absolute word-count delta > 20% of the OLD count, OR
 *   - normalised Levenshtein distance > 0.30 on the content_markdown.
 *
 * Both signals capture ways the LLM might have re-written the section
 * — a paraphrase without changing word count still trips (2), while
 * a shortening without changing meaning trips (1). Sections missing
 * from either side are surfaced explicitly (new / removed IDs).
 */
export function computeReSynthesisDeviations(
  original: SynthesisResult,
  rerun: SynthesisResult
): string[] {
  const deviations: string[] = [];
  const origBySection = new Map<string, SynthesizedSection>(
    original.sections.map((s) => [s.section_id, s])
  );
  const rerunBySection = new Map<string, SynthesizedSection>(
    rerun.sections.map((s) => [s.section_id, s])
  );

  for (const [sid, rerunSec] of rerunBySection) {
    const origSec = origBySection.get(sid);
    if (origSec === undefined) {
      deviations.push(sid);
      continue;
    }
    if (isSubstantiallyChanged(origSec, rerunSec)) {
      deviations.push(sid);
    }
  }
  // Sections present in the original but removed on rerun — surface them too.
  for (const sid of origBySection.keys()) {
    if (!rerunBySection.has(sid)) deviations.push(sid);
  }
  return deviations;
}

/**
 * A rerun section counts as changed when its word count moves by more than
 * 20% or its text by more than 0.3 of its length in edits.
 */
export function isSubstantiallyChanged(
  a: SynthesizedSection,
  b: SynthesizedSection
): boolean {
  const wordDelta =
    a.word_count === 0
      ? b.word_count > 0
        ? 1
      : 0
      : Math.abs(b.word_count - a.word_count) / a.word_count;
  if (wordDelta > 0.2) return true;
  const nlev = normalisedLevenshtein(a.content_markdown, b.content_markdown);
  return nlev > 0.3;
}

/** Edit distance over the longer length: 0 for equal texts, 1 when one is empty. */
function normalisedLevenshtein(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : levenshtein(a, b) / longest;
}

export function buildRerunReason(
  adv: AdversarialCritiqueResult,
  toAddress: readonly Critique[]
): string {
  const critical = adv.critical_count;
  const material = adv.material_count;
  const trigger =
    critical >= 1
      ? `${critical} critical critique(s)`
      : `${material} material critique(s)`;
  return `${trigger} triggered a Synthesis rerun in REVISION MODE addressing critique IDs: ${toAddress
    .map((c) => c.id)
    .join(", ")}.`;
}
