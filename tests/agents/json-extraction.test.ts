/**
 * extractJsonText on the answer shapes seen from real models. The one live
 * failure on record (CHANGELOG 1.2.1) is a research answer that opened with
 * prose ("I …") before the JSON; the others are the common variants of it.
 */
import { describe, expect, test } from "bun:test";

import { extractJsonText } from "../../src/agents/prompt-runtime.ts";

const OBJ = '{"findings": [{"claim": "a {braced} claim", "n": 1}], "open_questions": []}';
const parsed = (raw: string): unknown => JSON.parse(extractJsonText(raw));

describe("extractJsonText", () => {
  test("bare JSON is returned unchanged", () => {
    expect(extractJsonText(OBJ)).toBe(OBJ);
  });

  test("prose before the JSON (the recorded live failure)", () => {
    expect(parsed(`I have gathered the findings below.\n\n${OBJ}`)).toEqual(JSON.parse(OBJ));
  });

  test("prose before a fenced block", () => {
    expect(parsed(`Here is the JSON:\n\`\`\`json\n${OBJ}\n\`\`\``)).toEqual(JSON.parse(OBJ));
  });

  test("a whole-answer fence", () => {
    expect(parsed(`\`\`\`json\n${OBJ}\n\`\`\``)).toEqual(JSON.parse(OBJ));
  });

  test("prose after the JSON", () => {
    expect(parsed(`${OBJ}\n\nLet me know if you need more detail.`)).toEqual(JSON.parse(OBJ));
  });

  test("braces in the surrounding prose do not capture the answer", () => {
    expect(parsed(`I used the {research} template.\n${OBJ}\nNote: {done}`)).toEqual(
      JSON.parse(OBJ)
    );
  });

  test("an escaped quote and a closing brace inside a string", () => {
    const tricky = '{"claim": "he said \\"}\\" twice"}';
    expect(parsed(`Answer: ${tricky}`)).toEqual({ claim: 'he said "}" twice' });
  });

  test("an unmatched brace before the answer fails loudly, never as a fragment (ADR 0001)", () => {
    expect(() => parsed(`I used the { character.\n${OBJ}`)).toThrow(SyntaxError);
    expect(() => parsed(`{{${OBJ}`)).toThrow(SyntaxError);
  });

  test("of two objects, the larger one is the answer", () => {
    expect(parsed(`Example: {"a": 1}\nAnswer:\n${OBJ}`)).toEqual(JSON.parse(OBJ));
  });

  test("text with no object is returned trimmed so the caller's JSON.parse reports it", () => {
    expect(extractJsonText("  I could not find anything.  ")).toBe("I could not find anything.");
    expect(extractJsonText("   ")).toBe("");
  });

  test("a truncated object (max_tokens) is not repaired", () => {
    expect(() => JSON.parse(extractJsonText('Here: {"findings": [{"claim": "cut'))).toThrow();
  });
});
