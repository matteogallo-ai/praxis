/**
 * First-party sources (ADR 0003): a company's or institution's own site is
 * the primary source for that organisation's own facts.
 *
 * The model proposes the mark (`first_party_for`); code accepts it only
 * when the organisation is in the reviewed list, the URL's host is one of
 * its domains, and the organisation is the item's subject. Nothing is
 * inferred from a name inside a domain: a look-alike host never matches.
 * Whether the sentence states the organisation's own fact is the model's
 * judgment, so accepted items are counted and listed apart.
 */

import { extractHost } from "./domain-trust.ts";
import { FIRST_PARTY_ORGANISATIONS } from "./first-party-organisations.ts";
import type { SourceReference } from "./types.ts";

export interface FirstPartyOrganisation {
  /** The name a stage writes in `first_party_for`. */
  name: string;
  /** Other names that mark the organisation as an item's subject. */
  aliases: string[];
  /** Every domain it controls, written out; a subdomain of one matches. */
  domains: string[];
  /** A page on one of those domains that shows the ownership. */
  evidence: string;
  /** The benchmark question whose subject the organisation is. */
  question: string;
}

/**
 * The organisation `source` is first-party for, given the item's own text
 * (`subject`), or `null` when any check fails.
 */
export function firstPartyOrganisation(
  source: SourceReference,
  subject: string,
  list: readonly FirstPartyOrganisation[] = FIRST_PARTY_ORGANISATIONS
): string | null {
  const mark = source.first_party_for;
  if (mark === undefined) return null;
  const org = list.find((o) => o.name === mark);
  if (org === undefined) return null;
  const host = extractHost(source.url);
  if (host === null) return null;
  if (!org.domains.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  if (![org.name, ...org.aliases].some((n) => containsWord(subject, n))) return null;
  return org.name;
}

/** `word` appears in `text` with its case, not inside a longer word. */
function containsWord(text: string, word: string): boolean {
  if (word.length === 0) return false;
  const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + word.length])) return true;
  }
  return false;
}
