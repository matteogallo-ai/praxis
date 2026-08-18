/**
 * Structural validator for a parsed YAML value against the Format schema.
 *
 * Design goals:
 *   1. Accumulate ALL issues before throwing — surface every problem at
 *      once so contributors can fix a format in a single pass.
 *   2. Reject unknown top-level keys (strict-by-default). Silent drops
 *      hide typos and are the enemy of a registry that must not drift.
 *   3. Narrow `unknown` to the concrete `Format` type through explicit
 *      per-field checks — no runtime coercion.
 */

import type { YamlValue } from "@promptlang/yaml-parser";
import {
  AGENT_IDS,
  DEDUPE_RULE_ALLOWED_KEYS,
  DOMAIN_TRUST_MODES,
  DOMAIN_TRUST_RULE_ALLOWED_KEYS,
  FORMAT_ALLOWED_KEYS,
  FRESHNESS_RULE_ALLOWED_KEYS,
  LANGUAGES,
  METADATA_ALLOWED_KEYS,
  ORGANIZATION_STYLES,
  OUTPUT_TARGETS,
  REPUTATION_TIERS_ALLOWED_KEYS,
  SECTION_ALLOWED_KEYS,
  SECTION_MAX_LENGTH_ALLOWED_KEYS,
  SOURCING_POLICIES,
  SOURCING_RULES_ALLOWED_KEYS,
  STYLE_GUIDE_ALLOWED_KEYS,
  TARGET_LENGTH_ALLOWED_KEYS,
  isAgentId,
  isDomainTrustMode,
  isKebabCase,
  isLanguage,
  isOrganizationStyle,
  isOutputTarget,
  isSourcingPolicy,
  isValidIsoDate,
  isValidSemver,
} from "./schema.ts";
import type {
  AgentId,
  DedupeRule,
  DomainTrustMode,
  DomainTrustRule,
  Format,
  FormatMetadata,
  FormatSection,
  FreshnessRule,
  OutputTarget,
  ReputationTiers,
  SourcingRules,
  StyleGuide,
  TargetLength,
} from "./schema.ts";
import { ValidationError } from "./errors.ts";
import type { ValidationIssue } from "./errors.ts";

/**
 * Validate a raw YAML value and return a strongly-typed `Format`.
 *
 * @param raw     the value produced by `parseYaml`
 * @param source  optional identifier (file path or logical name) used in
 *                error messages
 * @throws ValidationError when any structural issue is found
 */
export function validateFormat(raw: YamlValue, source?: string): Format {
  const issues: ValidationIssue[] = [];

  if (!isPlainObject(raw)) {
    issues.push({ path: "$", message: "root must be a mapping" });
    throw new ValidationError(issues, source);
  }

  checkExtraKeys(raw, FORMAT_ALLOWED_KEYS, "$", issues);

  const id = requireString(raw, "id", issues);
  if (id !== null && !isKebabCase(id)) {
    issues.push({
      path: "id",
      message: `must be kebab-case (lowercase letters, digits, single hyphens), got '${id}'`,
    });
  }

  requireString(raw, "name", issues);

  const version = requireString(raw, "version", issues);
  if (version !== null && !isValidSemver(version)) {
    issues.push({
      path: "version",
      message: `must be valid SemVer 2.0.0 (MAJOR.MINOR.PATCH), got '${version}'`,
    });
  }

  const metadata = validateMetadata(raw["metadata"], issues);
  const targetLength = validateTargetLength(raw["target_length"], issues);
  const sections = validateSections(raw["sections"], issues);

  let sourcingPolicy: Format["sourcing_policy"] | null = null;
  const spRaw = raw["sourcing_policy"];
  if (spRaw === undefined) {
    issues.push({ path: "sourcing_policy", message: "is required" });
  } else if (!isSourcingPolicy(spRaw)) {
    issues.push({
      path: "sourcing_policy",
      message: `must be one of [${SOURCING_POLICIES.join(", ")}], got ${formatValue(spRaw)}`,
    });
  } else {
    sourcingPolicy = spRaw;
  }

  const styleGuide = validateStyleGuide(raw["style_guide"], issues);
  const outputTargets = validateOutputTargets(raw["output_targets"], issues);

  // v0.5 — optional. Absent → no rules; present → structurally validated.
  let sourcingRules: SourcingRules | undefined;
  const rulesRaw = raw["sourcing_rules"];
  if (rulesRaw !== undefined && rulesRaw !== null) {
    sourcingRules = validateSourcingRules(rulesRaw, issues) ?? undefined;
  }

  if (issues.length > 0) {
    throw new ValidationError(issues, source);
  }

  // At this point every branch above returned non-null OR we would have thrown.
  const format: Format = {
    id: id as string,
    name: raw["name"] as string,
    version: version as string,
    metadata: metadata as FormatMetadata,
    target_length: targetLength as TargetLength,
    sections: sections as FormatSection[],
    sourcing_policy: sourcingPolicy as Format["sourcing_policy"],
    style_guide: styleGuide as StyleGuide,
    output_targets: outputTargets as OutputTarget[],
  };
  if (sourcingRules !== undefined) {
    format.sourcing_rules = sourcingRules;
  }
  return format;
}

// ---------------------------------------------------------------------------
// Sub-object validators
// ---------------------------------------------------------------------------

function validateMetadata(
  raw: YamlValue | undefined,
  issues: ValidationIssue[]
): FormatMetadata | null {
  if (raw === undefined) {
    issues.push({ path: "metadata", message: "is required" });
    return null;
  }
  if (!isPlainObject(raw)) {
    issues.push({ path: "metadata", message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, METADATA_ALLOWED_KEYS, "metadata", issues);

  const author = requireString(raw, "author", issues, "metadata");

  const orgStyle = raw["organization_style"];
  let organization: FormatMetadata["organization_style"] | null = null;
  if (orgStyle === undefined) {
    issues.push({ path: "metadata.organization_style", message: "is required" });
  } else if (!isOrganizationStyle(orgStyle)) {
    issues.push({
      path: "metadata.organization_style",
      message: `must be one of [${ORGANIZATION_STYLES.join(", ")}], got ${formatValue(orgStyle)}`,
    });
  } else {
    organization = orgStyle;
  }

  const langRaw = raw["language"];
  let language: FormatMetadata["language"] | null = null;
  if (langRaw === undefined) {
    issues.push({ path: "metadata.language", message: "is required" });
  } else if (!isLanguage(langRaw)) {
    issues.push({
      path: "metadata.language",
      message: `must be one of [${LANGUAGES.join(", ")}], got ${formatValue(langRaw)}`,
    });
  } else {
    language = langRaw;
  }

  const lastReviewed = requireString(raw, "last_reviewed", issues, "metadata");
  if (lastReviewed !== null && !isValidIsoDate(lastReviewed)) {
    issues.push({
      path: "metadata.last_reviewed",
      message: `must be a valid ISO date YYYY-MM-DD, got '${lastReviewed}'`,
    });
  }

  if (
    author === null ||
    organization === null ||
    language === null ||
    lastReviewed === null ||
    !isValidIsoDate(lastReviewed)
  ) {
    return null;
  }
  return {
    author,
    organization_style: organization,
    language,
    last_reviewed: lastReviewed,
  };
}

function validateTargetLength(
  raw: YamlValue | undefined,
  issues: ValidationIssue[]
): TargetLength | null {
  if (raw === undefined) {
    issues.push({ path: "target_length", message: "is required" });
    return null;
  }
  if (!isPlainObject(raw)) {
    issues.push({ path: "target_length", message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, TARGET_LENGTH_ALLOWED_KEYS, "target_length", issues);

  const pages = requirePositiveInt(raw, "pages", issues, "target_length");
  const words = requirePositiveInt(raw, "words", issues, "target_length");
  if (pages === null || words === null) return null;
  return { pages, words };
}

function validateSections(
  raw: YamlValue | undefined,
  issues: ValidationIssue[]
): FormatSection[] | null {
  if (raw === undefined) {
    issues.push({ path: "sections", message: "is required" });
    return null;
  }
  if (!Array.isArray(raw)) {
    issues.push({ path: "sections", message: "must be a sequence" });
    return null;
  }
  if (raw.length === 0) {
    issues.push({ path: "sections", message: "must contain at least one section" });
    return null;
  }

  const seenIds = new Map<string, number>();
  const sections: FormatSection[] = [];
  let anyInvalid = false;

  for (let i = 0; i < raw.length; i++) {
    const path = `sections[${i}]`;
    const item = raw[i]!;
    const parsed = validateSection(item, path, issues);
    if (parsed === null) {
      anyInvalid = true;
      continue;
    }
    const previousIndex = seenIds.get(parsed.id);
    if (previousIndex !== undefined) {
      issues.push({
        path: `${path}.id`,
        message: `duplicate section id '${parsed.id}' (first seen at sections[${previousIndex}])`,
      });
      anyInvalid = true;
    } else {
      seenIds.set(parsed.id, i);
    }
    sections.push(parsed);
  }

  return anyInvalid ? null : sections;
}

function validateSection(
  raw: YamlValue,
  path: string,
  issues: ValidationIssue[]
): FormatSection | null {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, SECTION_ALLOWED_KEYS, path, issues);

  const id = requireString(raw, "id", issues, path);
  if (id !== null && !isKebabCase(id)) {
    issues.push({
      path: `${path}.id`,
      message: `must be kebab-case, got '${id}'`,
    });
  }
  const title = requireString(raw, "title", issues, path);
  const purpose = requireString(raw, "purpose", issues, path);
  const toneDirectives = requireString(raw, "tone_directives", issues, path);

  const maxLen = validateSectionMaxLength(raw["max_length"], `${path}.max_length`, issues);
  const requiredAgents = validateRequiredAgents(
    raw["required_agents"],
    `${path}.required_agents`,
    issues
  );

  const validationRulesRaw = raw["validation_rules"];
  let validationRules: string[] | undefined;
  if (validationRulesRaw !== undefined && validationRulesRaw !== null) {
    if (!Array.isArray(validationRulesRaw)) {
      issues.push({ path: `${path}.validation_rules`, message: "must be a sequence of strings" });
    } else {
      const rules: string[] = [];
      let ok = true;
      for (let j = 0; j < validationRulesRaw.length; j++) {
        const r = validationRulesRaw[j]!;
        if (typeof r !== "string" || r.trim() === "") {
          issues.push({
            path: `${path}.validation_rules[${j}]`,
            message: "must be a non-empty string",
          });
          ok = false;
        } else if (!/^[a-z_][a-z0-9_]*\s*:\s*.+$/i.test(r)) {
          issues.push({
            path: `${path}.validation_rules[${j}]`,
            message: `must be 'key: value' shape (declarative rule), got '${r}'`,
          });
          ok = false;
        } else {
          rules.push(r);
        }
      }
      if (ok) validationRules = rules;
    }
  }

  if (
    id === null ||
    !isKebabCase(id ?? "") ||
    title === null ||
    purpose === null ||
    toneDirectives === null ||
    maxLen === null ||
    requiredAgents === null
  ) {
    return null;
  }

  const section: FormatSection = {
    id,
    title,
    purpose,
    max_length: maxLen,
    required_agents: requiredAgents,
    tone_directives: toneDirectives,
  };
  if (validationRules !== undefined) {
    section.validation_rules = validationRules;
  }
  return section;
}

function validateSectionMaxLength(
  raw: YamlValue | undefined,
  path: string,
  issues: ValidationIssue[]
): { words: number } | null {
  if (raw === undefined) {
    issues.push({ path, message: "is required" });
    return null;
  }
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, SECTION_MAX_LENGTH_ALLOWED_KEYS, path, issues);
  const words = requirePositiveInt(raw, "words", issues, path);
  if (words === null) return null;
  return { words };
}

function validateRequiredAgents(
  raw: YamlValue | undefined,
  path: string,
  issues: ValidationIssue[]
): AgentId[] | null {
  if (raw === undefined) {
    issues.push({ path, message: "is required" });
    return null;
  }
  if (!Array.isArray(raw)) {
    issues.push({ path, message: "must be a sequence of agent ids" });
    return null;
  }
  if (raw.length === 0) {
    issues.push({ path, message: "must list at least one agent id" });
    return null;
  }
  const seen = new Set<string>();
  const agents: AgentId[] = [];
  let ok = true;
  for (let j = 0; j < raw.length; j++) {
    const v = raw[j]!;
    if (!isAgentId(v)) {
      issues.push({
        path: `${path}[${j}]`,
        message: `must be one of [${AGENT_IDS.join(", ")}], got ${formatValue(v)}`,
      });
      ok = false;
      continue;
    }
    if (seen.has(v)) {
      issues.push({ path: `${path}[${j}]`, message: `duplicate agent id '${v}'` });
      ok = false;
      continue;
    }
    seen.add(v);
    agents.push(v);
  }
  return ok ? agents : null;
}

function validateStyleGuide(
  raw: YamlValue | undefined,
  issues: ValidationIssue[]
): StyleGuide | null {
  if (raw === undefined) {
    issues.push({ path: "style_guide", message: "is required" });
    return null;
  }
  if (!isPlainObject(raw)) {
    issues.push({ path: "style_guide", message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, STYLE_GUIDE_ALLOWED_KEYS, "style_guide", issues);

  const voice = requireString(raw, "voice", issues, "style_guide");
  const sentence = requireString(raw, "sentence_structure", issues, "style_guide");

  const forbiddenRaw = raw["forbidden_terms"];
  let forbidden: string[] | null = null;
  if (forbiddenRaw === undefined) {
    issues.push({ path: "style_guide.forbidden_terms", message: "is required" });
  } else if (!Array.isArray(forbiddenRaw)) {
    issues.push({
      path: "style_guide.forbidden_terms",
      message: "must be a sequence of strings (may be empty)",
    });
  } else {
    const terms: string[] = [];
    let ok = true;
    for (let j = 0; j < forbiddenRaw.length; j++) {
      const t = forbiddenRaw[j]!;
      if (typeof t !== "string" || t === "") {
        issues.push({
          path: `style_guide.forbidden_terms[${j}]`,
          message: "must be a non-empty string",
        });
        ok = false;
      } else {
        terms.push(t);
      }
    }
    if (ok) forbidden = terms;
  }

  if (voice === null || sentence === null || forbidden === null) return null;
  return { voice, sentence_structure: sentence, forbidden_terms: forbidden };
}

function validateOutputTargets(
  raw: YamlValue | undefined,
  issues: ValidationIssue[]
): OutputTarget[] | null {
  if (raw === undefined) {
    issues.push({ path: "output_targets", message: "is required" });
    return null;
  }
  if (!Array.isArray(raw)) {
    issues.push({ path: "output_targets", message: "must be a sequence" });
    return null;
  }
  if (raw.length === 0) {
    issues.push({ path: "output_targets", message: "must list at least one target" });
    return null;
  }
  const seen = new Set<string>();
  const targets: OutputTarget[] = [];
  let ok = true;
  for (let j = 0; j < raw.length; j++) {
    const v = raw[j]!;
    if (!isOutputTarget(v)) {
      issues.push({
        path: `output_targets[${j}]`,
        message: `must be one of [${OUTPUT_TARGETS.join(", ")}], got ${formatValue(v)}`,
      });
      ok = false;
      continue;
    }
    if (seen.has(v)) {
      issues.push({ path: `output_targets[${j}]`, message: `duplicate target '${v}'` });
      ok = false;
      continue;
    }
    seen.add(v);
    targets.push(v);
  }
  return ok ? targets : null;
}

// ---------------------------------------------------------------------------
// v0.5 — sourcing_rules validators
// ---------------------------------------------------------------------------

function validateSourcingRules(
  raw: YamlValue,
  issues: ValidationIssue[]
): SourcingRules | null {
  if (!isPlainObject(raw)) {
    issues.push({ path: "sourcing_rules", message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, SOURCING_RULES_ALLOWED_KEYS, "sourcing_rules", issues);

  const rules: SourcingRules = {};

  const freshnessRaw = raw["freshness"];
  if (freshnessRaw !== undefined && freshnessRaw !== null) {
    const parsed = validateFreshnessRule(freshnessRaw, issues);
    if (parsed !== null) rules.freshness = parsed;
  }

  const trustRaw = raw["domain_trust"];
  if (trustRaw !== undefined && trustRaw !== null) {
    const parsed = validateDomainTrustRule(trustRaw, issues);
    if (parsed !== null) rules.domain_trust = parsed;
  }

  const dedupeRaw = raw["dedupe"];
  if (dedupeRaw !== undefined && dedupeRaw !== null) {
    const parsed = validateDedupeRule(dedupeRaw, issues);
    if (parsed !== null) rules.dedupe = parsed;
  }

  return rules;
}

function validateFreshnessRule(
  raw: YamlValue,
  issues: ValidationIssue[]
): FreshnessRule | null {
  const path = "sourcing_rules.freshness";
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, FRESHNESS_RULE_ALLOWED_KEYS, path, issues);
  const max = requirePositiveInt(raw, "max_source_age_days", issues, path);
  const warn = requirePositiveInt(raw, "warn_after_days", issues, path);
  if (max === null || warn === null) return null;
  if (warn > max) {
    issues.push({
      path: `${path}.warn_after_days`,
      message: `must be ≤ max_source_age_days (${max}), got ${warn}`,
    });
    return null;
  }
  return { max_source_age_days: max, warn_after_days: warn };
}

function validateDomainTrustRule(
  raw: YamlValue,
  issues: ValidationIssue[]
): DomainTrustRule | null {
  const path = "sourcing_rules.domain_trust";
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, DOMAIN_TRUST_RULE_ALLOWED_KEYS, path, issues);

  const modeRaw = raw["mode"];
  let mode: DomainTrustMode | null = null;
  if (modeRaw === undefined) {
    issues.push({ path: `${path}.mode`, message: "is required" });
  } else if (!isDomainTrustMode(modeRaw)) {
    issues.push({
      path: `${path}.mode`,
      message: `must be one of [${DOMAIN_TRUST_MODES.join(", ")}], got ${formatValue(modeRaw)}`,
    });
  } else {
    mode = modeRaw;
  }

  const allowList = optionalStringArray(raw["allow_list"], `${path}.allow_list`, issues);
  const denyList = optionalStringArray(raw["deny_list"], `${path}.deny_list`, issues);

  let tiers: ReputationTiers | null | undefined = undefined;
  if (raw["reputation_tiers"] !== undefined && raw["reputation_tiers"] !== null) {
    tiers = validateReputationTiers(raw["reputation_tiers"], issues);
  }

  if (mode === null) return null;

  if (mode === "allow-list") {
    if (allowList === null || allowList.length === 0) {
      issues.push({
        path: `${path}.allow_list`,
        message: "is required (non-empty) when mode is 'allow-list'",
      });
      return null;
    }
    return { mode, allow_list: allowList };
  }
  if (mode === "deny-list") {
    if (denyList === null || denyList.length === 0) {
      issues.push({
        path: `${path}.deny_list`,
        message: "is required (non-empty) when mode is 'deny-list'",
      });
      return null;
    }
    return { mode, deny_list: denyList };
  }
  // reputation-only
  if (tiers === undefined) {
    issues.push({
      path: `${path}.reputation_tiers`,
      message: "is required when mode is 'reputation-only'",
    });
    return null;
  }
  if (tiers === null) return null;
  return { mode, reputation_tiers: tiers };
}

function validateReputationTiers(
  raw: YamlValue,
  issues: ValidationIssue[]
): ReputationTiers | null {
  const path = "sourcing_rules.domain_trust.reputation_tiers";
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, REPUTATION_TIERS_ALLOWED_KEYS, path, issues);

  const t1 = requireStringArrayAllowEmpty(raw, "tier_1", `${path}.tier_1`, issues);
  const t2 = requireStringArrayAllowEmpty(raw, "tier_2", `${path}.tier_2`, issues);
  const t3 = requireStringArrayAllowEmpty(raw, "tier_3", `${path}.tier_3`, issues);

  const minTierRaw = raw["min_tier"];
  let minTier: 1 | 2 | 3 | null = null;
  if (minTierRaw === undefined) {
    issues.push({ path: `${path}.min_tier`, message: "is required" });
  } else if (typeof minTierRaw !== "number" || !Number.isInteger(minTierRaw)) {
    issues.push({
      path: `${path}.min_tier`,
      message: `must be an integer 1|2|3, got ${formatValue(minTierRaw)}`,
    });
  } else if (minTierRaw !== 1 && minTierRaw !== 2 && minTierRaw !== 3) {
    issues.push({
      path: `${path}.min_tier`,
      message: `must be one of [1, 2, 3], got ${minTierRaw}`,
    });
  } else {
    minTier = minTierRaw;
  }

  if (t1 === null || t2 === null || t3 === null || minTier === null) return null;
  return { tier_1: t1, tier_2: t2, tier_3: t3, min_tier: minTier };
}

function validateDedupeRule(
  raw: YamlValue,
  issues: ValidationIssue[]
): DedupeRule | null {
  const path = "sourcing_rules.dedupe";
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a mapping" });
    return null;
  }
  checkExtraKeys(raw, DEDUPE_RULE_ALLOWED_KEYS, path, issues);

  const crossAgentRaw = raw["cross_agent"];
  let crossAgent: boolean | null = null;
  if (crossAgentRaw === undefined) {
    issues.push({ path: `${path}.cross_agent`, message: "is required" });
  } else if (typeof crossAgentRaw !== "boolean") {
    issues.push({
      path: `${path}.cross_agent`,
      message: `must be a boolean, got ${formatValue(crossAgentRaw)}`,
    });
  } else {
    crossAgent = crossAgentRaw;
  }

  const thresholdRaw = raw["similarity_threshold"];
  let threshold: number | null = null;
  if (thresholdRaw === undefined) {
    issues.push({ path: `${path}.similarity_threshold`, message: "is required" });
  } else if (typeof thresholdRaw !== "number" || Number.isNaN(thresholdRaw)) {
    issues.push({
      path: `${path}.similarity_threshold`,
      message: `must be a number in [0, 1], got ${formatValue(thresholdRaw)}`,
    });
  } else if (thresholdRaw < 0 || thresholdRaw > 1) {
    issues.push({
      path: `${path}.similarity_threshold`,
      message: `must be in [0, 1], got ${thresholdRaw}`,
    });
  } else {
    threshold = thresholdRaw;
  }

  if (crossAgent === null || threshold === null) return null;
  return { cross_agent: crossAgent, similarity_threshold: threshold };
}

function optionalStringArray(
  raw: YamlValue | undefined,
  path: string,
  issues: ValidationIssue[]
): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    issues.push({ path, message: "must be a sequence of strings" });
    return null;
  }
  const out: string[] = [];
  let ok = true;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]!;
    if (typeof v !== "string" || v.trim() === "") {
      issues.push({ path: `${path}[${i}]`, message: "must be a non-empty string" });
      ok = false;
    } else {
      out.push(v);
    }
  }
  return ok ? out : null;
}

function requireStringArrayAllowEmpty(
  obj: { [k: string]: YamlValue },
  key: string,
  path: string,
  issues: ValidationIssue[]
): string[] | null {
  const raw = obj[key];
  if (raw === undefined) {
    issues.push({ path, message: "is required" });
    return null;
  }
  if (!Array.isArray(raw)) {
    issues.push({ path, message: "must be a sequence of strings" });
    return null;
  }
  const out: string[] = [];
  let ok = true;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]!;
    if (typeof v !== "string" || v.trim() === "") {
      issues.push({ path: `${path}[${i}]`, message: "must be a non-empty string" });
      ok = false;
    } else {
      out.push(v);
    }
  }
  return ok ? out : null;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: YamlValue): v is { [k: string]: YamlValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkExtraKeys(
  obj: { [k: string]: YamlValue },
  allowed: readonly string[],
  parentPath: string,
  issues: ValidationIssue[]
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const at = parentPath === "$" ? key : `${parentPath}.${key}`;
      issues.push({
        path: at,
        message: `unknown key (allowed: ${allowed.join(", ")})`,
      });
    }
  }
}

function requireString(
  obj: { [k: string]: YamlValue },
  key: string,
  issues: ValidationIssue[],
  parentPath?: string
): string | null {
  const path = parentPath ? `${parentPath}.${key}` : key;
  const v = obj[key];
  if (v === undefined) {
    issues.push({ path, message: "is required" });
    return null;
  }
  if (typeof v !== "string") {
    issues.push({ path, message: `must be a string, got ${formatValue(v)}` });
    return null;
  }
  if (v === "") {
    issues.push({ path, message: "must be a non-empty string" });
    return null;
  }
  return v;
}

function requirePositiveInt(
  obj: { [k: string]: YamlValue },
  key: string,
  issues: ValidationIssue[],
  parentPath?: string
): number | null {
  const path = parentPath ? `${parentPath}.${key}` : key;
  const v = obj[key];
  if (v === undefined) {
    issues.push({ path, message: "is required" });
    return null;
  }
  if (typeof v !== "number") {
    issues.push({ path, message: `must be a number, got ${formatValue(v)}` });
    return null;
  }
  if (!Number.isInteger(v)) {
    issues.push({ path, message: `must be an integer, got ${v}` });
    return null;
  }
  if (v <= 0) {
    issues.push({ path, message: `must be strictly greater than 0, got ${v}` });
    return null;
  }
  return v;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return `'${v}'`;
  if (Array.isArray(v)) return "sequence";
  if (typeof v === "object") return "mapping";
  return String(v);
}
