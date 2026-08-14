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
  FORMAT_ALLOWED_KEYS,
  LANGUAGES,
  METADATA_ALLOWED_KEYS,
  ORGANIZATION_STYLES,
  OUTPUT_TARGETS,
  SECTION_ALLOWED_KEYS,
  SECTION_MAX_LENGTH_ALLOWED_KEYS,
  SOURCING_POLICIES,
  STYLE_GUIDE_ALLOWED_KEYS,
  TARGET_LENGTH_ALLOWED_KEYS,
  isAgentId,
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
  Format,
  FormatMetadata,
  FormatSection,
  OutputTarget,
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

  if (issues.length > 0) {
    throw new ValidationError(issues, source);
  }

  // At this point every branch above returned non-null OR we would have thrown.
  return {
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
