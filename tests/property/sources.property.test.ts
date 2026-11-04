/**
 * Properties of the source validators: `parseSource` (every web-searching
 * stage's source field), `parseCitedSource` (a synthesis section's citation,
 * fresh or stored), freshness classification and the strict / permissive
 * sourcing policy. Each property states the rule independently of the code
 * and checks it on generated inputs, malformed ones included.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { InvalidAgentOutputError, SynthesisError } from "../../src/agents/errors.ts";
import { outputReader } from "../../src/agents/prompt-runtime.ts";
import { type KnownSourcesIndex, parseCitedSource } from "../../src/agents/synthesis.ts";
import type { ResearchResult } from "../../src/agents/types.ts";
import { SourcingValidationError } from "../../src/sourcing/errors.ts";
import { classifyFreshness } from "../../src/sourcing/freshness.ts";
import { validateSourcing } from "../../src/sourcing/validator.ts";

const reader = outputReader("research");

/** A value for any field: right type or not, present or not. */
const anyField = fc.oneof(fc.constant(undefined), fc.string(), fc.webUrl(), fc.integer(), fc.constant(null));

/** An excerpt around the 500-character cap, which short random strings never reach. */
const excerptField = fc.oneof(anyField, fc.string({ minLength: 495, maxLength: 505 }));

/** The rule for a usable source URL, written without the code's helper. */
function isWebUrl(url: unknown): boolean {
  return typeof url === "string" && /^https?:/i.test(url) && URL.canParse(url);
}

/** A well-formed source with a web URL, as a stage returns it. */
const goodSource = fc.record({
  url: fc.webUrl({ withQueryParameters: true, withFragments: true }),
  title: fc.string({ minLength: 1 }),
  excerpt: fc.string({ maxLength: 500 }),
});

describe("parseSource — properties", () => {
  test("accepts exactly the sources the rule allows, and rejects the rest with a typed error", () => {
    fc.assert(
      fc.property(
        fc.record({ url: fc.oneof(anyField, fc.webUrl()), title: anyField, excerpt: excerptField, accessed_at: anyField }),
        (source) => {
          const allowed =
            isWebUrl(source.url) &&
            typeof source.title === "string" &&
            source.title.length > 0 &&
            (source.accessed_at === undefined || source.accessed_at === null || typeof source.accessed_at === "string") &&
            typeof source.excerpt === "string" &&
            source.excerpt.length <= 500;
          let accepted = true;
          try {
            reader.parseSource(source, "s", "raw");
          } catch (err) {
            expect(err).toBeInstanceOf(InvalidAgentOutputError);
            accepted = false;
          }
          // `accessed_at: null` is read as absent by `?? ""`.
          expect(accepted).toBe(allowed);
        }
      )
    );
  });

  test("a well-formed source comes back with its fields, and an empty accessed_at when absent", () => {
    fc.assert(
      fc.property(goodSource, (source) => {
        expect(reader.parseSource(source, "s", "raw")).toEqual({ ...source, accessed_at: "" });
      })
    );
  });

  test("an excerpt is accepted up to 500 characters and refused past them", () => {
    fc.assert(
      // Half the draws are 500 or 501: a uniform draw alone can miss the boundary.
      fc.property(goodSource, fc.oneof(fc.constantFrom(500, 501), fc.integer({ min: 480, max: 520 })), (source, length) => {
        const parse = () => reader.parseSource({ ...source, excerpt: "x".repeat(length) }, "s", "raw");
        if (length <= 500) expect((parse() as { excerpt: string }).excerpt).toHaveLength(length);
        else expect(parse).toThrow("exceeds 500 characters");
      })
    );
  });

  test("a URL with any scheme other than http(s) is refused", () => {
    const scheme = fc.stringMatching(/^[a-z][a-z0-9+.-]{0,10}$/).filter((s) => s !== "http" && s !== "https");
    fc.assert(
      fc.property(goodSource, scheme, (source, s) => {
        const url = source.url.replace(/^https?/, s);
        expect(() => reader.parseSource({ ...source, url }, "s", "raw")).toThrow(InvalidAgentOutputError);
      })
    );
  });

  test("SOURCE_MISSING needs a non-empty searched_for, nothing else", () => {
    fc.assert(
      fc.property(anyField, (searchedFor) => {
        const marker = { status: "SOURCE_MISSING" as const, searched_for: searchedFor };
        const ok = typeof searchedFor === "string" && searchedFor.length > 0;
        if (ok) expect(reader.parseSource(marker, "s", "raw") as unknown).toEqual(marker);
        else expect(() => reader.parseSource(marker, "s", "raw")).toThrow("s: SOURCE_MISSING requires a non-empty 'searched_for'");
      })
    );
  });
});

describe("parseCitedSource — properties", () => {
  const known = (urls: string[]): KnownSourcesIndex => ({
    hasUrl: (url) => urls.includes(url),
    urls: () => [...urls].sort((a, b) => b.length - a.length),
  });

  test("a citation is kept iff its four fields are strings, three non-empty, and its URL came from upstream", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.webUrl(), { minLength: 1, maxLength: 5 }),
        fc.record({ url: fc.oneof(anyField, fc.webUrl()), title: anyField, accessed_at: anyField, excerpt: anyField }),
        fc.boolean(),
        (upstream, raw, cite) => {
          const citation = cite ? { ...raw, url: upstream[0] } : raw;
          const wellFormed =
            typeof citation.url === "string" &&
            citation.url.length > 0 &&
            typeof citation.title === "string" &&
            citation.title.length > 0 &&
            typeof citation.accessed_at === "string" &&
            citation.accessed_at.length > 0 &&
            typeof citation.excerpt === "string";
          const fromUpstream = wellFormed && upstream.includes(citation.url as string);
          try {
            const kept = parseCitedSource(citation, "c", known(upstream), "raw");
            expect(fromUpstream).toBe(true);
            expect(kept as unknown).toEqual({
              url: citation.url,
              title: citation.title,
              accessed_at: citation.accessed_at,
              excerpt: citation.excerpt,
            });
          } catch (err) {
            expect(fromUpstream).toBe(false);
            // Malformed is a model error (retried); an invented URL is a synthesis error.
            expect(err).toBeInstanceOf(wellFormed ? SynthesisError : InvalidAgentOutputError);
          }
        }
      )
    );
  });

  test("a citation that is not an object is refused as such", () => {
    const notObject = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.webUrl()));
    fc.assert(
      fc.property(notObject, (citation) => {
        expect(() => parseCitedSource(citation, "c", known([]), "raw")).toThrow("c must be an object");
      })
    );
  });

  test("a citation with one required field empty is malformed, not invented", () => {
    const valid = { url: "https://x.example/a", title: "t", accessed_at: "2026-08-17T00:00:00Z", excerpt: "" };
    for (const field of ["url", "title", "accessed_at"] as const) {
      expect(() => parseCitedSource({ ...valid, [field]: "" }, "c", known([valid.url]), "raw")).toThrow(
        "c must have url/title/accessed_at/excerpt (all strings)"
      );
    }
  });

  test("extra fields never reach the result", () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.dictionary(fc.string(), fc.jsonValue()), (url, extra) => {
        const citation = { ...extra, url, title: "t", accessed_at: "2026-08-17T00:00:00Z", excerpt: "" };
        expect(Object.keys(parseCitedSource(citation, "c", known([url]), "raw")).sort()).toEqual([
          "accessed_at",
          "excerpt",
          "title",
          "url",
        ]);
      })
    );
  });
});

describe("freshness — properties", () => {
  const rule = fc
    .tuple(fc.nat({ max: 3650 }), fc.nat({ max: 3650 }))
    .map(([a, b]) => ({ warn_after_days: Math.min(a, b), max_source_age_days: Math.max(a, b) }));
  const DAY = 86_400_000;
  const now = new Date("2026-08-20T00:00:00Z");

  test("the class follows the age: fresh up to warn_after_days, stale past max_source_age_days", () => {
    fc.assert(
      fc.property(rule, fc.integer({ min: -400, max: 8000 }), (r, ageDays) => {
        const published = new Date(now.getTime() - ageDays * DAY).toISOString();
        const { classification } = classifyFreshness(published, r, now);
        const age = Math.max(0, ageDays);
        // More than a day ahead of the clock is a date the source cannot have.
        const expected =
          ageDays < -1 ? "unknown" : age > r.max_source_age_days ? "stale" : age > r.warn_after_days ? "warn" : "fresh";
        expect(classification).toBe(expected);
      })
    );
  });

  test("an unreadable publication date is unknown, never fresh", () => {
    fc.assert(
      fc.property(rule, fc.string().filter((s) => Number.isNaN(Date.parse(s))), (r, published) => {
        expect(classifyFreshness(published, r, now).classification).toBe("unknown");
      })
    );
  });
});

describe("sourcing policy — properties", () => {
  const finding = fc.oneof(
    goodSource.map((source) => ({ claim: "c", supporting_evidence: "e", source: { ...source, accessed_at: "2026-08-17T00:00:00Z" } })),
    fc.string({ minLength: 1 }).map((q) => ({
      claim: "c",
      supporting_evidence: "e",
      source: { status: "SOURCE_MISSING" as const, searched_for: q },
    }))
  );
  const research = fc
    .array(finding, { maxLength: 8 })
    .map((findings): ResearchResult => ({ findings, open_questions: [], search_queries_used: [] }));
  const missing = (r: ResearchResult) => r.findings.filter((f) => "status" in f.source).length;

  test("permissive never throws and reports every missing source", () => {
    fc.assert(
      fc.property(research, (r) => {
        const report = validateSourcing(r, "permissive");
        expect(report.counts.missing).toBe(missing(r));
        expect(report.total_items).toBe(r.findings.length);
      })
    );
  });

  test("strict throws exactly when some source is missing", () => {
    fc.assert(
      fc.property(research, (r) => {
        const run = () => validateSourcing(r, "strict");
        if (missing(r) > 0) expect(run).toThrow(SourcingValidationError);
        else expect(run().counts.missing).toBe(0);
      })
    );
  });
});
