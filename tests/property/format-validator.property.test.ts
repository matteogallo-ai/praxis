/**
 * Properties of the format registry's input boundary: `loadFormatFromSource`
 * (YAML text) and `validateFormat` (the parsed value). A format file is
 * written by hand, so any text must come back as a `Format` or as one of the
 * registry's typed errors, and a broken field must be named in the issues.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, type YamlValue } from "@promptlang/yaml-parser";
import fc from "fast-check";

import { ValidationError, YamlSyntaxError } from "../../src/registry/errors.ts";
import { loadFormatFromSource } from "../../src/registry/loader.ts";
import { validateFormat } from "../../src/registry/validator.ts";

const FORMATS_DIR = join(import.meta.dir, "..", "..", "formats");
const shipped = readdirSync(FORMATS_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => ({ name: f, text: readFileSync(join(FORMATS_DIR, f), "utf-8") }));

type Mapping = { [key: string]: YamlValue };
const parsedShipped = shipped.map((f) => parseYaml(f.text) as Mapping);

/** Runs `f`; returns the error it threw, or undefined. */
function thrownBy(f: () => unknown): unknown {
  try {
    f();
    return undefined;
  } catch (err) {
    return err;
  }
}

/** Every path of a parsed value, as `a.b[2].c`, with the value there. */
function paths(value: YamlValue, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => [`${prefix}[${i}]`, ...paths(v, `${prefix}[${i}]`)]);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const p = prefix === "" ? k : `${prefix}.${k}`;
      return [p, ...paths(v, p)];
    });
  }
  return [];
}

/** A copy of `root` with the value at `path` replaced (or removed when `replacement` is undefined). */
function edit(root: Mapping, path: string, replacement: YamlValue | undefined): Mapping {
  const copy = structuredClone(root);
  const steps = path.match(/[^.[\]]+/g) ?? [];
  let node: YamlValue = copy;
  for (const step of steps.slice(0, -1)) {
    node = (node as Record<string, YamlValue>)[step] as YamlValue;
  }
  const last = steps[steps.length - 1] as string;
  const holder = node as Record<string, YamlValue> & YamlValue[];
  if (replacement !== undefined) holder[last] = replacement;
  else if (Array.isArray(holder)) holder.splice(Number(last), 1);
  else delete holder[last];
  return copy;
}

/** A shipped format with one value replaced, or removed, at a random path. */
const edited = fc
  .nat({ max: parsedShipped.length - 1 })
  .chain((i) => {
    const root = parsedShipped[i] as Mapping;
    return fc.record({
      root: fc.constant(root),
      path: fc.constantFrom(...paths(root)),
      replacement: fc.option(fc.jsonValue() as fc.Arbitrary<YamlValue>, { nil: undefined }),
    });
  });

describe("validateFormat — properties", () => {
  test("every shipped format validates", () => {
    for (const f of shipped) expect(() => loadFormatFromSource(f.text, f.name)).not.toThrow();
  });

  test("any parsed value yields a Format or a ValidationError, nothing else", () => {
    fc.assert(
      fc.property(fc.jsonValue() as fc.Arbitrary<YamlValue>, (value) => {
        const err = thrownBy(() => validateFormat(value));
        expect(err === undefined || err instanceof ValidationError).toBe(true);
      })
    );
  });

  test("a shipped format with one field changed or removed validates, or is refused with ValidationError", () => {
    fc.assert(
      fc.property(edited, ({ root, path, replacement }) => {
        const err = thrownBy(() => validateFormat(edit(root, path, replacement)));
        expect(err === undefined || err instanceof ValidationError).toBe(true);
        if (err instanceof ValidationError) expect(err.issues.length).toBeGreaterThan(0);
      })
    );
  });

  test("a top-level field removed is either optional or named by an issue", () => {
    fc.assert(
      fc.property(edited, ({ root }) => {
        for (const key of Object.keys(root)) {
          const err = thrownBy(() => validateFormat(edit(root, key, undefined)));
          if (err instanceof ValidationError) {
            expect(err.issues.some((i) => i.path === key || i.path.startsWith(`${key}.`))).toBe(true);
          }
        }
      }),
      { numRuns: parsedShipped.length * 4 }
    );
  });

  test("an unknown top-level key is refused, and the issue names it", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...parsedShipped),
        fc.string({ minLength: 1 }).filter((k) => !["__proto__", "constructor"].includes(k)),
        (root, key) => {
          fc.pre(!(key in root));
          const err = thrownBy(() => validateFormat({ ...root, [key]: "x" }));
          expect(err).toBeInstanceOf(ValidationError);
          expect((err as ValidationError).message).toContain(key);
        }
      )
    );
  });
});

describe("loadFormatFromSource — properties", () => {
  test("any text yields a Format, a YamlSyntaxError or a ValidationError", () => {
    const yamlish = fc.stringMatching(/^[a-z_:\- "'#\n[\]{}|>0-9.]{0,200}$/);
    fc.assert(
      fc.property(fc.oneof(fc.string(), yamlish), (text) => {
        const err = thrownBy(() => loadFormatFromSource(text, "fuzz.yaml"));
        expect(err === undefined || err instanceof YamlSyntaxError || err instanceof ValidationError).toBe(true);
      })
    );
  });

  test("a shipped format cut short anywhere loads or is refused with a typed error", () => {
    fc.assert(
      fc.property(fc.constantFrom(...shipped), fc.double({ min: 0, max: 1, noNaN: true }), (f, at) => {
        const text = f.text.slice(0, Math.floor(f.text.length * at));
        const err = thrownBy(() => loadFormatFromSource(text, f.name));
        expect(err === undefined || err instanceof YamlSyntaxError || err instanceof ValidationError).toBe(true);
      })
    );
  });
});
