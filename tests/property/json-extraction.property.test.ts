/**
 * Properties of `extractJsonText`, the tolerant reader of a model's JSON
 * answer (ADR 0001). The example tests (tests/agents/json-extraction.test.ts)
 * pin the shapes seen live; these check the rules for any input.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { extractJsonText } from "../../src/agents/prompt-runtime.ts";

/** A JSON object answer: any keys, any JSON values. */
const answer = fc.dictionary(fc.string(), fc.jsonValue(), { minKeys: 1 });

/** What the model meant, as JSON can carry it (-0 is written as 0). */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Model prose around the answer, with no brace of its own. */
const prose = fc.string().filter((s) => !/[{}]/.test(s));

describe("extractJsonText — properties", () => {
  test("never throws, whatever the text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (raw) => {
        expect(typeof extractJsonText(raw)).toBe("string");
      })
    );
  });

  test("an object between brace-free prose comes back exactly", () => {
    fc.assert(
      fc.property(prose, answer, prose, (before, value, after) => {
        const text = extractJsonText(`${before}${JSON.stringify(value)}${after}`);
        expect(JSON.parse(text)).toEqual(asJson(value));
      })
    );
  });

  test("a fenced object comes back exactly, pretty-printed or not", () => {
    fc.assert(
      fc.property(prose, answer, fc.boolean(), (before, value, pretty) => {
        const body = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
        expect(JSON.parse(extractJsonText(`${before}\n\`\`\`json\n${body}\n\`\`\`\n`))).toEqual(asJson(value));
      })
    );
  });

  test("a quote in the prose before the object does not open a string", () => {
    fc.assert(
      fc.property(prose, answer, (before, value) => {
        const text = extractJsonText(`He said "${before} ${JSON.stringify(value)}`);
        expect(JSON.parse(text)).toEqual(asJson(value));
      })
    );
  });

  test("a stray closing brace in the prose before the object does not hide it", () => {
    fc.assert(
      fc.property(prose, answer, (before, value) => {
        expect(JSON.parse(extractJsonText(`${before} } ${JSON.stringify(value)}`))).toEqual(asJson(value));
      })
    );
  });

  test("of two objects in the answer, the larger one is returned", () => {
    fc.assert(
      fc.property(answer, answer, prose, (a, b, between) => {
        const [sa, sb] = [JSON.stringify(a), JSON.stringify(b)];
        fc.pre(sa.length !== sb.length);
        const larger = sa.length > sb.length ? a : b;
        expect(JSON.parse(extractJsonText(`${sa}${between}${sb}`))).toEqual(asJson(larger));
      })
    );
  });

  test("the result is either an object that parses or the trimmed answer itself", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const text = extractJsonText(raw);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Not JSON: then nothing may have been cut from the answer.
          expect(text).toBe(raw.trim());
          return;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          expect(text).toBe(raw.trim());
        }
      })
    );
  });

  test("extracting twice changes nothing", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), prose.chain((p) => answer.map((v) => `${p}${JSON.stringify(v)}`))), (raw) => {
        const once = extractJsonText(raw);
        expect(extractJsonText(once)).toBe(once);
      })
    );
  });

  test("a truncated object is never repaired into one", () => {
    fc.assert(
      fc.property(answer, fc.nat(), (value, cut) => {
        const full = JSON.stringify(value);
        const truncated = full.slice(0, cut % full.length);
        fc.pre(!/[{}]/.test(truncated.slice(1)));
        expect(extractJsonText(truncated)).toBe(truncated.trim());
      })
    );
  });
});
