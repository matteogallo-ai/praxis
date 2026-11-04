import { describe, expect, test } from "bun:test";

import { optionsCitationReport, untrustedCitations, critiqueCitations } from "../../src/sourcing/citations.ts";
import { UntrustedDomainError } from "../../src/sourcing/errors.ts";
import { buildReport, mergeReports } from "../../src/sourcing/report.ts";
import type { DomainTrustRule, SourceStatus } from "../../src/sourcing/types.ts";

const RULE: DomainTrustRule = { mode: "allow-list", allow_list: ["reuters.com"] };

const src = (url: string): SourceStatus => ({
  url,
  title: "t",
  accessed_at: "2026-11-04T00:00:00Z",
  excerpt: "e",
});

describe("untrustedCitations", () => {
  test("lists each citation whose domain fails the rule, with its stage and id", () => {
    const out = untrustedCitations(
      "options",
      [
        { id: "OPT-A", evidence: src("https://reuters.com/a") },
        { id: "OPT-B", evidence: src("https://blog.example.com/b") },
      ],
      RULE
    );
    expect(out).toEqual([
      {
        stage: "options",
        id: "OPT-B",
        url: "https://blog.example.com/b",
        reason: "host 'blog.example.com' matches no entry in allow-list",
      },
    ]);
  });

  test("a SOURCE_MISSING citation has no domain to judge", () => {
    const missing: SourceStatus = { status: "SOURCE_MISSING", searched_for: "x" };
    expect(untrustedCitations("adversarial", [{ id: "CRIT-1", evidence: missing }], RULE)).toEqual([]);
  });

  test("an unparseable URL is untrusted, never skipped", () => {
    const out = untrustedCitations("adversarial", [{ id: "CRIT-1", evidence: src("not a url") }], RULE);
    expect(out.map((c) => c.id)).toEqual(["CRIT-1"]);
  });

  test("no citations, no findings", () => {
    expect(untrustedCitations("options", [], RULE)).toEqual([]);
  });
});

describe("optionsCitationReport", () => {
  const options = (urls: string[]) =>
    urls.map((url, i) => ({ id: `OPT-${String.fromCharCode(65 + i)}`, supporting_evidence: src(url) }));

  test("permissive: lists the untrusted citations in a report of no items", () => {
    const r = optionsCitationReport(options(["https://reuters.com/a", "https://blog.example.com/b"]), "permissive", RULE);
    expect(r.total_items).toBe(0);
    expect(r.warnings).toEqual([]);
    expect(r.untrusted_citations?.map((c) => c.id)).toEqual(["OPT-B"]);
  });

  test("strict: an untrusted citation fails like an untrusted research source, and the error carries the report", () => {
    let caught: unknown;
    try {
      optionsCitationReport(options(["https://blog.example.com/b"]), "strict", RULE);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UntrustedDomainError);
    const e = caught as UntrustedDomainError;
    expect(e.url).toBe("https://blog.example.com/b");
    expect(e.report.untrusted_citations?.map((c) => c.id)).toEqual(["OPT-A"]);
  });

  test("strict: trusted citations pass", () => {
    expect(optionsCitationReport(options(["https://reuters.com/a"]), "strict", RULE).untrusted_citations).toEqual([]);
  });
});

describe("mergeReports — untrusted citations", () => {
  test("concatenates them, and leaves the field out when no report has it", () => {
    const c = (id: string) => ({ stage: "options" as const, id, url: "u", reason: "r" });
    const a = { ...buildReport("permissive", 1, []), untrusted_citations: [c("OPT-A")] };
    const b = { ...buildReport("permissive", 1, []), untrusted_citations: [c("OPT-B")] };
    expect(mergeReports("permissive", [a, buildReport("permissive", 1, []), b]).untrusted_citations?.map((x) => x.id)).toEqual(["OPT-A", "OPT-B"]);
    expect(mergeReports("permissive", [buildReport("permissive", 1, [])])).not.toHaveProperty("untrusted_citations");
  });
});

describe("critiqueCitations", () => {
  const critique = (id: string, position: string, url: string, mark?: string) => ({
    id,
    steelmanned_position: position,
    counter_evidence: { ...src(url), ...(mark === undefined ? {} : { first_party_for: mark }) },
  });

  test("a confirmed first-party counter-evidence is listed apart, not as untrusted", () => {
    const out = critiqueCitations(
      [critique("CRIT-001", "The FCA's own rules make the dual listing slower than the brief assumes.", "https://www.fca.org.uk/r", "Financial Conduct Authority")],
      RULE
    );
    expect(out.untrusted).toEqual([]);
    expect(out.firstParty).toEqual([
      { stage: "adversarial", item: "CRIT-001", organisation: "Financial Conduct Authority", url: "https://www.fca.org.uk/r" },
    ]);
  });

  test("a refused mark, or none, stays an untrusted citation", () => {
    const out = critiqueCitations(
      [
        critique("CRIT-001", "Exchanges compete on fees.", "https://www.fca.org.uk/r", "Financial Conduct Authority"),
        critique("CRIT-002", "The FCA may object.", "https://blog.example.com/b"),
      ],
      RULE
    );
    expect(out.untrusted.map((c) => c.id)).toEqual(["CRIT-001", "CRIT-002"]);
    expect(out.firstParty).toEqual([]);
  });

  test("a trusted or missing counter-evidence is neither", () => {
    const missing = { id: "CRIT-003", steelmanned_position: "x", counter_evidence: { status: "SOURCE_MISSING" as const, searched_for: "y" } };
    const out = critiqueCitations([critique("CRIT-001", "FCA", "https://reuters.com/a", "Financial Conduct Authority"), missing], RULE);
    expect(out).toEqual({ untrusted: [], firstParty: [] });
  });
});
