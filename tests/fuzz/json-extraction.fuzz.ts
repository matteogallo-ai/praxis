/**
 * A mutation fuzzer for `extractJsonText`, the tolerant reader of a model's
 * JSON answer (ADR 0001). Inputs start from the answer shapes seen live
 * (prose before the JSON, fences, two objects, a truncated answer) and are
 * mutated: structural characters inserted, spans deleted or repeated, seeds
 * spliced together, the text cut short or blown up in size. fast-check drives
 * it, so a failure is shrunk to a minimal mutation list and replayable from
 * its seed.
 *
 * Used by the test suite (a short run with a fixed seed) and by
 * `bun run fuzz` (a long run with a fresh seed).
 */
import fc from "fast-check";

import { extractJsonText } from "../../src/agents/prompt-runtime.ts";

const OBJ = '{"findings": [{"claim": "a {braced} claim", "n": 1}], "open_questions": []}';

export const SEEDS: readonly string[] = [
  OBJ,
  `I have gathered the findings below.\n\n${OBJ}`,
  `Here is the JSON:\n\`\`\`json\n${OBJ}\n\`\`\``,
  `${OBJ}\n\nLet me know if you need more detail.`,
  `I used the {research} template.\n${OBJ}\nNote: {done}`,
  'Answer: {"claim": "he said \\"}\\" twice"}',
  `Example: {"a": 1}\nAnswer:\n${OBJ}`,
  'Here: {"findings": [{"claim": "cut',
  "I could not find anything.",
  "",
];

type Mutation =
  | { op: "insert"; at: number; text: string }
  | { op: "delete"; at: number; length: number }
  | { op: "repeat"; at: number; length: number; times: number }
  | { op: "splice"; at: number; seed: number }
  | { op: "cut"; at: number };

const STRUCTURE = ["{", "}", '"', "\\", "[", "]", ",", ":", "```", "```json\n", "\n", " ", "null", '{"a":', "}}"];

const mutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    op: fc.constant("insert" as const),
    at: fc.nat(),
    text: fc.oneof(fc.constantFrom(...STRUCTURE), fc.string({ unit: "grapheme", maxLength: 8 })),
  }),
  fc.record({ op: fc.constant("delete" as const), at: fc.nat(), length: fc.integer({ min: 1, max: 40 }) }),
  fc.record({
    op: fc.constant("repeat" as const),
    at: fc.nat(),
    length: fc.integer({ min: 1, max: 80 }),
    times: fc.integer({ min: 2, max: 3000 }),
  }),
  fc.record({ op: fc.constant("splice" as const), at: fc.nat(), seed: fc.nat({ max: SEEDS.length - 1 }) }),
  fc.record({ op: fc.constant("cut" as const), at: fc.nat() })
);

/** Inputs larger than this are cut, so one run stays in memory and time. */
const MAX_LENGTH = 400_000;

function apply(text: string, m: Mutation): string {
  const at = text.length === 0 ? 0 : m.at % (text.length + 1);
  switch (m.op) {
    case "insert":
      return text.slice(0, at) + m.text + text.slice(at);
    case "delete":
      return text.slice(0, at) + text.slice(at + m.length);
    case "repeat":
      return (text.slice(0, at) + text.slice(at, at + m.length).repeat(m.times) + text.slice(at + m.length)).slice(
        0,
        MAX_LENGTH
      );
    case "splice":
      return (text.slice(0, at) + (SEEDS[m.seed] ?? "") + text.slice(at)).slice(0, MAX_LENGTH);
    case "cut":
      return text.slice(0, at);
  }
}

/** A seed with up to eight mutations applied. */
export const fuzzInput: fc.Arbitrary<string> = fc
  .tuple(fc.nat({ max: SEEDS.length - 1 }), fc.array(mutation, { maxLength: 8 }))
  .map(([seed, mutations]) => mutations.reduce(apply, SEEDS[seed] ?? ""));

function isObjectJson(text: string): boolean {
  if (!text.startsWith("{")) return false;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v);
  } catch {
    // Not JSON is a valid outcome here, not an error.
    return false;
  }
}

/**
 * The text from the first `{` to the last `}`, when it is a JSON object.
 * Any other balanced span lies inside it, so under "the largest object wins"
 * (ADR 0001) the extractor must return it whatever the prose around it says.
 */
function soleObject(text: string): string | undefined {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last < first) return undefined;
  const span = text.slice(first, last + 1);
  return isObjectJson(span) ? span : undefined;
}

/**
 * The oracles; throws on a violation. The extractor must not throw, must
 * return either the trimmed answer or a JSON object found verbatim in it,
 * must return the sole object of an answer whose braces all belong to it,
 * must keep an answer that is already an object, must be idempotent, and must stay linear: a
 * quadratic scan of a 400 000-character answer would take seconds, far over
 * the time bound.
 */
export function checkExtraction(raw: string, extract: (raw: string) => string = extractJsonText): void {
  const started = performance.now();
  const out = extract(raw);
  const elapsed = performance.now() - started;
  const trimmed = raw.trim();
  if (out !== trimmed && !(isObjectJson(out) && raw.includes(out))) {
    throw new Error("returned neither the trimmed answer nor an object found in it");
  }
  if (isObjectJson(trimmed) && out !== trimmed) {
    throw new Error("an answer that is already an object was not returned as is");
  }
  const sole = soleObject(raw);
  if (sole !== undefined && out !== sole) {
    throw new Error("the answer's only object was not returned");
  }
  if (extract(out) !== out) throw new Error("not idempotent");
  const bound = 250 + raw.length / 1000;
  if (elapsed > bound) throw new Error(`took ${elapsed.toFixed(0)} ms on ${raw.length} characters (bound ${bound} ms)`);
}
