/**
 * The reviewed organisation-to-domains list ADR 0003 requires. An entry is
 * added or changed only through a pull request the maintainer has read.
 *
 * Each organisation is one whose own decisions or publications are the
 * subject of a benchmark question; a host a format already trusts
 * (`*.europa.eu`, `*.gov`) needs no entry. The list is not fitted to any
 * one run's sources.
 */

import type { FirstPartyOrganisation } from "./first-party.ts";

export const FIRST_PARTY_ORGANISATIONS: readonly FirstPartyOrganisation[] = [
  {
    name: "IFRS Foundation",
    aliases: ["ISSB", "International Sustainability Standards Board"],
    domains: ["ifrs.org"],
    evidence: "https://www.ifrs.org/",
    question: "10-esg-position",
  },
  {
    name: "EFRAG",
    aliases: ["European Financial Reporting Advisory Group"],
    domains: ["efrag.org"],
    evidence: "https://www.efrag.org/",
    question: "10-esg-position",
  },
  {
    name: "GHG Protocol",
    aliases: ["Greenhouse Gas Protocol"],
    domains: ["ghgprotocol.org"],
    evidence: "https://ghgprotocol.org/",
    question: "10-esg-position",
  },
  {
    name: "Financial Conduct Authority",
    aliases: ["FCA"],
    domains: ["fca.org.uk"],
    evidence: "https://www.fca.org.uk/",
    question: "04-uk-listing-board-briefing",
  },
  {
    name: "London Stock Exchange Group",
    aliases: ["LSEG", "London Stock Exchange"],
    domains: ["lseg.com", "londonstockexchange.com"],
    evidence: "https://www.lseg.com/",
    question: "04-uk-listing-board-briefing",
  },
];
