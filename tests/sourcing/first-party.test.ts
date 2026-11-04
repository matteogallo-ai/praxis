/**
 * ADR 0003: a source is first-party only when the organisation it is marked
 * for is in the reviewed list, the URL's host is one of that organisation's
 * domains, and the organisation is the item's subject.
 */
import { describe, expect, test } from "bun:test";

import { firstPartyOrganisation, type FirstPartyOrganisation } from "../../src/sourcing/first-party.ts";
import { FIRST_PARTY_ORGANISATIONS } from "../../src/sourcing/first-party-organisations.ts";
import type { SourceReference } from "../../src/sourcing/types.ts";

const LIST: FirstPartyOrganisation[] = [
  {
    name: "Example Group",
    aliases: ["EXG", "Example"],
    domains: ["example-group.com", "exg.de"],
    evidence: "https://www.example-group.com/investors",
    question: "test",
  },
];
const src = (url: string, mark?: string): SourceReference => ({
  url,
  title: "t",
  accessed_at: "2026-11-04T00:00:00Z",
  excerpt: "e",
  ...(mark === undefined ? {} : { first_party_for: mark }),
});

describe("firstPartyOrganisation", () => {
  test("accepts a marked source on the organisation's domain, about the organisation", () => {
    expect(firstPartyOrganisation(src("https://investors.example-group.com/r", "Example Group"), "Example Group reported revenue of 5bn.", LIST)).toBe("Example Group");
    expect(firstPartyOrganisation(src("https://exg.de/p", "Example Group"), "EXG raised its dividend.", LIST)).toBe("Example Group");
  });

  test("refuses a source without a mark", () => {
    expect(firstPartyOrganisation(src("https://example-group.com/r"), "Example Group reported.", LIST)).toBeNull();
  });

  test("refuses an organisation the list does not name", () => {
    expect(firstPartyOrganisation(src("https://example-group.com/r", "Other Corp"), "Other Corp reported.", LIST)).toBeNull();
  });

  test("refuses a host that is not one of its domains, compared label by label", () => {
    for (const url of [
      "https://example-group.com.evil.net/r",
      "https://myexample-group.com/r",
      "https://example-group.co/r",
      "https://exg.de.example.org/r",
    ]) {
      expect(firstPartyOrganisation(src(url, "Example Group"), "Example Group reported.", LIST)).toBeNull();
    }
  });

  test("refuses an item whose text does not name the organisation", () => {
    expect(firstPartyOrganisation(src("https://example-group.com/r", "Example Group"), "A competitor cut prices.", LIST)).toBeNull();
  });

  test("a name counts only as a whole word, with its case", () => {
    expect(firstPartyOrganisation(src("https://example-group.com/r", "Example Group"), "EXGTRA rose.", LIST)).toBeNull();
    expect(firstPartyOrganisation(src("https://example-group.com/r", "Example Group"), "exg rose.", LIST)).toBeNull();
    expect(firstPartyOrganisation(src("https://example-group.com/r", "Example Group"), "Counter-example rose.", LIST)).toBeNull();
    expect(firstPartyOrganisation(src("https://example-group.com/r", "Example Group"), "(EXG) rose.", LIST)).toBe("Example Group");
  });

  test("an unparseable URL is never first-party", () => {
    expect(firstPartyOrganisation(src("not a url", "Example Group"), "Example Group reported.", LIST)).toBeNull();
  });
});

describe("the reviewed organisation list", () => {
  test("every entry is explicit: names, domains written out, ownership evidence on one of them", () => {
    expect(FIRST_PARTY_ORGANISATIONS.length).toBeGreaterThan(0);
    for (const o of FIRST_PARTY_ORGANISATIONS) {
      expect(o.name.trim()).toBe(o.name);
      expect(o.domains.length).toBeGreaterThan(0);
      for (const d of o.domains) expect(d).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      const host = new URL(o.evidence).hostname;
      expect(new URL(o.evidence).protocol).toBe("https:");
      expect(o.domains.some((d) => host === d || host.endsWith(`.${d}`))).toBe(true);
      expect(o.question).toMatch(/^\d{2}-/);
    }
  });

  test("no organisation or domain is listed twice", () => {
    const names = FIRST_PARTY_ORGANISATIONS.map((o) => o.name);
    const domains = FIRST_PARTY_ORGANISATIONS.flatMap((o) => o.domains);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(domains).size).toBe(domains.length);
  });

  test("each entry is tied to a benchmark question that exists", async () => {
    const yaml = await Bun.file("benchmarks/questions.yaml").text();
    for (const o of FIRST_PARTY_ORGANISATIONS) expect(yaml).toContain(`id: "${o.question}"`);
  });
});
