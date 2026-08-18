/**
 * Canonical schema for a Praxis briefing format.
 *
 * A "format" describes the shape of an analytical briefing (executive
 * pre-read, position paper, McKinsey-style note, ...) that the future
 * agent pipeline will produce. Everything in this schema is declarative.
 *
 * These types are the single source of truth; the validator, loader,
 * registry, and CLI must all conform to them.
 */

export const ORGANIZATION_STYLES = [
  "pwc",
  "mckinsey",
  "bcg",
  "family-office",
  "corporate-affairs",
  "government",
  "generic",
] as const;
export type OrganizationStyle = (typeof ORGANIZATION_STYLES)[number];

export const LANGUAGES = ["en", "fr", "multi"] as const;
export type Language = (typeof LANGUAGES)[number];

export const SOURCING_POLICIES = ["strict", "permissive"] as const;
export type SourcingPolicy = (typeof SOURCING_POLICIES)[number];

export const AGENT_IDS = [
  "scoping",
  "research",
  "stakeholder",
  "risk",
  "options",
  "adversarial",
  "synthesis",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const OUTPUT_TARGETS = ["pdf", "docx", "md"] as const;
export type OutputTarget = (typeof OUTPUT_TARGETS)[number];

export interface FormatMetadata {
  author: string;
  organization_style: OrganizationStyle;
  language: Language;
  /** ISO date, format YYYY-MM-DD. */
  last_reviewed: string;
}

export interface TargetLength {
  pages: number;
  words: number;
}

export interface SectionMaxLength {
  words: number;
}

export interface FormatSection {
  id: string;
  title: string;
  purpose: string;
  max_length: SectionMaxLength;
  required_agents: AgentId[];
  tone_directives: string;
  /** Optional declarative rules — free-form strings for v0.1. */
  validation_rules?: string[];
}

export interface StyleGuide {
  voice: string;
  sentence_structure: string;
  forbidden_terms: string[];
}

export interface Format {
  id: string;
  name: string;
  /** SemVer, e.g. "1.0.0". */
  version: string;
  metadata: FormatMetadata;
  target_length: TargetLength;
  sections: FormatSection[];
  sourcing_policy: SourcingPolicy;
  /**
   * v0.5 optional block. When present, the hardened sourcing layer
   * uses these rules (freshness, domain trust, cross-agent dedupe) and
   * `sourcing_policy` is used only as the failure mode (`strict` throws
   * on any error, `permissive` collects). When absent, v0.4 behaviour
   * is preserved verbatim.
   */
  sourcing_rules?: SourcingRules;
  style_guide: StyleGuide;
  output_targets: OutputTarget[];
}

// ---------------------------------------------------------------------------
// v0.5 — Sourcing rules (freshness, domain trust, dedupe).
// ---------------------------------------------------------------------------

/**
 * Freshness gate. Sources whose `accessed_at` is older than
 * `max_source_age_days` are rejected (strict) or warned (permissive).
 * `warn_after_days` is a soft warning threshold; must satisfy
 * `warn_after_days <= max_source_age_days`.
 */
export interface FreshnessRule {
  max_source_age_days: number;
  warn_after_days: number;
}

export const DOMAIN_TRUST_MODES = ["allow-list", "deny-list", "reputation-only"] as const;
export type DomainTrustMode = (typeof DOMAIN_TRUST_MODES)[number];

/**
 * Domain trust rule. Wildcards `*.` (subdomain) and `.*` (any TLD) are
 * supported by the matcher — e.g. `*.gov.uk`, `gov.*`.
 */
export interface DomainTrustRule {
  mode: DomainTrustMode;
  /** Required iff `mode === "allow-list"`. */
  allow_list?: string[];
  /** Required iff `mode === "deny-list"`. */
  deny_list?: string[];
  /** Required iff `mode === "reputation-only"`. */
  reputation_tiers?: ReputationTiers;
}

/**
 * Reputation tiers for `reputation-only` mode. Tier 1 is the highest
 * reputation. `min_tier` names the lowest tier accepted (2 means tiers
 * 1 and 2 pass; tier 3 fails).
 */
export interface ReputationTiers {
  tier_1: string[];
  tier_2: string[];
  tier_3: string[];
  min_tier: 1 | 2 | 3;
}

export interface DedupeRule {
  /** When true, the accumulator tracks URLs across all agents. */
  cross_agent: boolean;
  /**
   * `0` = ignore, `1` = only strictly identical (after normalisation).
   * Between 0 and 1 defines a Levenshtein-based similarity threshold.
   */
  similarity_threshold: number;
}

export interface SourcingRules {
  freshness?: FreshnessRule;
  domain_trust?: DomainTrustRule;
  dedupe?: DedupeRule;
}

/**
 * Complete list of top-level keys allowed on a Format. Any extra key
 * encountered while validating a parsed YAML object triggers a
 * ValidationError (strict-by-default policy).
 */
export const FORMAT_ALLOWED_KEYS: readonly string[] = [
  "id",
  "name",
  "version",
  "metadata",
  "target_length",
  "sections",
  "sourcing_policy",
  "sourcing_rules",
  "style_guide",
  "output_targets",
] as const;

// Allowed key lists for the v0.5 sourcing_rules sub-schemas.
export const SOURCING_RULES_ALLOWED_KEYS: readonly string[] = [
  "freshness",
  "domain_trust",
  "dedupe",
] as const;

export const FRESHNESS_RULE_ALLOWED_KEYS: readonly string[] = [
  "max_source_age_days",
  "warn_after_days",
] as const;

export const DOMAIN_TRUST_RULE_ALLOWED_KEYS: readonly string[] = [
  "mode",
  "allow_list",
  "deny_list",
  "reputation_tiers",
] as const;

export const REPUTATION_TIERS_ALLOWED_KEYS: readonly string[] = [
  "tier_1",
  "tier_2",
  "tier_3",
  "min_tier",
] as const;

export const DEDUPE_RULE_ALLOWED_KEYS: readonly string[] = [
  "cross_agent",
  "similarity_threshold",
] as const;

export const METADATA_ALLOWED_KEYS: readonly string[] = [
  "author",
  "organization_style",
  "language",
  "last_reviewed",
] as const;

export const TARGET_LENGTH_ALLOWED_KEYS: readonly string[] = [
  "pages",
  "words",
] as const;

export const SECTION_ALLOWED_KEYS: readonly string[] = [
  "id",
  "title",
  "purpose",
  "max_length",
  "required_agents",
  "tone_directives",
  "validation_rules",
] as const;

export const SECTION_MAX_LENGTH_ALLOWED_KEYS: readonly string[] = [
  "words",
] as const;

export const STYLE_GUIDE_ALLOWED_KEYS: readonly string[] = [
  "voice",
  "sentence_structure",
  "forbidden_terms",
] as const;

// ---------------------------------------------------------------------------
// Enum membership helpers — narrow `unknown` to the enum union type.
// ---------------------------------------------------------------------------

export function isOrganizationStyle(v: unknown): v is OrganizationStyle {
  return typeof v === "string" && (ORGANIZATION_STYLES as readonly string[]).includes(v);
}

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);
}

export function isSourcingPolicy(v: unknown): v is SourcingPolicy {
  return typeof v === "string" && (SOURCING_POLICIES as readonly string[]).includes(v);
}

export function isAgentId(v: unknown): v is AgentId {
  return typeof v === "string" && (AGENT_IDS as readonly string[]).includes(v);
}

export function isOutputTarget(v: unknown): v is OutputTarget {
  return typeof v === "string" && (OUTPUT_TARGETS as readonly string[]).includes(v);
}

export function isDomainTrustMode(v: unknown): v is DomainTrustMode {
  return typeof v === "string" && (DOMAIN_TRUST_MODES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Format-level identifier / version constraints.
// ---------------------------------------------------------------------------

/** kebab-case: lowercase letters, digits, single hyphens, no leading/trailing hyphen. */
export const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** ISO calendar date YYYY-MM-DD with basic range validation (further checked by Date). */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * SemVer 2.0.0 — MAJOR.MINOR.PATCH with optional pre-release/build metadata.
 * Based on the official regex from semver.org.
 */
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isKebabCase(v: string): boolean {
  return KEBAB_CASE_RE.test(v);
}

export function isValidSemver(v: string): boolean {
  return SEMVER_RE.test(v);
}

/** Confirms `v` matches `YYYY-MM-DD` AND represents a real calendar date. */
export function isValidIsoDate(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false;
  const [yStr, mStr, dStr] = v.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}
