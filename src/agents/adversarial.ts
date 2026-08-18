/**
 * Adversarial Critique agent — v0.7, the seventh and final Praxis
 * agent before v1.0.
 *
 * Reads a completed `BriefResult` (the six upstream agents' output)
 * and produces a bounded set of steelmanned critiques — the
 * strongest arguments AGAINST the recommendation, formulated the
 * way a hostile-but-fair reviewer would raise them.
 *
 * Pipeline:
 *   1. Load `prompts/adversarial.prompt` and parse with PromptLang.
 *   2. Render the `adversarial` prompt declaration with the brief
 *      JSON, the format id, and the question.
 *   3. Dispatch to `llm.completeWithTools` with the `web_search`
 *      tool (used to look up counter-evidence).
 *   4. Parse the JSON. Enforce every discipline:
 *        - critique count in [MIN_CRITIQUES, MAX_CRITIQUES]
 *        - IDs are sequential CRIT-001, CRIT-002, …
 *        - `target` has at least one field set
 *        - every target reference exists inside the brief
 *        - `steelmanned_position` has ≥ MIN_STEELMAN_WORDS words
 *        - `counter_evidence` is a real source OR SOURCE_MISSING
 *        - severity counts (critical/material/minor) are
 *          recomputed and compared against the model's own counts
 *        - `revised_recommendation_needed` is derived and cross-
 *          checked against the model's own signal
 *        - if the derived signal is true, `steelmanned_alternative`
 *          must be a non-empty string
 */

import { readFileSync, existsSync } from "node:fs";

import { tokenize } from "promptlang/lexer";
import { parse } from "promptlang/parser";
import type { Program, PromptDeclaration, MessageSection } from "promptlang/ast";

import type { LLMProvider } from "../llm/provider.ts";
import type { Tool } from "../llm/types.ts";
import { ToolUseNotSupportedError } from "../llm/errors.ts";
import type {
  AdversarialContext,
  AdversarialCritiqueResult,
  Critique,
  CritiqueCategory,
  CritiqueSeverity,
  CritiqueTarget,
} from "./types.ts";
import { CRITIQUE_CATEGORIES, CRITIQUE_SEVERITIES } from "./types.ts";
import type { SourceStatus } from "../sourcing/types.ts";
import {
  AdversarialCritiqueError,
  AgentExecutionError,
  InvalidAgentOutputError,
  InvalidCritiqueTargetError,
  MaxToolRoundsExceededError,
  MissingAlternativeError,
  PromptFileError,
} from "./errors.ts";

const AGENT_ID = "adversarial";
const PROMPT_NAME = "adversarial";
const DEFAULT_PROMPT_PATH = "prompts/adversarial.prompt";
const DEFAULT_MAX_TOOL_ROUNDS = 5;

/** Minimum critiques a run should produce. */
export const MIN_CRITIQUES = 3;
/** Hard ceiling — prevents padding. */
export const MAX_CRITIQUES = 15;
/**
 * Minimum word count for `steelmanned_position`. Enforced by the
 * parser so bâclé critiques do not sneak past.
 */
export const MIN_STEELMAN_WORDS = 20;

/** Robustness thresholds — derived from severity counts. */
const CRITICAL_FOR_MEDIUM = 1;
const MATERIAL_FOR_MEDIUM = 2;
const CRITICAL_FOR_LOW = 2;
const MATERIAL_FOR_LOW = 4;

/** Derivation thresholds for `revised_recommendation_needed`. */
const CRITICAL_TRIGGER = 1;
const MATERIAL_TRIGGER = 3;

const WEB_SEARCH_TOOL: Tool = { type: "web_search", name: "web_search" };

export interface ExecuteAdversarialCritiqueOptions {
  /** Overrides the default `prompts/adversarial.prompt` location — used in tests. */
  promptPath?: string;
  /** Hard cap on tool-use rounds. Default: 5. */
  maxToolRounds?: number;
}

export async function executeAdversarialCritique(
  ctx: AdversarialContext,
  llm: LLMProvider,
  options: ExecuteAdversarialCritiqueOptions = {}
): Promise<AdversarialCritiqueResult> {
  if (typeof llm.completeWithTools !== "function") {
    throw new ToolUseNotSupportedError(llm.name);
  }

  const promptPath = options.promptPath ?? DEFAULT_PROMPT_PATH;
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const declaration = loadPromptDeclaration(promptPath);

  const inputs: Record<string, string> = {
    brief_json: JSON.stringify(ctx.brief_result, null, 2),
    format_id: ctx.format.id,
    question: ctx.brief_result.question,
  };

  validateParameterCoverage(declaration, inputs, promptPath);

  const systemText = renderSection(declaration, "system", inputs, promptPath);
  const userText = renderSection(declaration, "user", inputs, promptPath);
  const prompt = `${systemText.trim()}\n\n---\n\n${userText.trim()}`;

  let completion;
  try {
    completion = await llm.completeWithTools(prompt, [WEB_SEARCH_TOOL], {
      max_tool_rounds: maxToolRounds,
    });
  } catch (err) {
    if (err instanceof AgentExecutionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentExecutionError(AGENT_ID, `LLM provider error — ${message}`);
  }

  if (completion.stop_reason === "pause_turn" && completion.rounds >= maxToolRounds) {
    throw new MaxToolRoundsExceededError(maxToolRounds);
  }

  return parseAdversarialCritiqueResult(completion.text, ctx);
}

function loadPromptDeclaration(path: string): PromptDeclaration {
  if (!existsSync(path)) {
    throw new PromptFileError(AGENT_ID, path, "file not found");
  }
  let source: string;
  try {
    source = readFileSync(path, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PromptFileError(AGENT_ID, path, `read failed — ${message}`);
  }

  let program: Program;
  try {
    program = parse(tokenize(source));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PromptFileError(AGENT_ID, path, `parse failed — ${message}`);
  }

  const decl = program.declarations.find(
    (d): d is PromptDeclaration =>
      d.kind === "PromptDeclaration" && d.name === PROMPT_NAME
  );
  if (!decl) {
    throw new PromptFileError(
      AGENT_ID,
      path,
      `missing prompt declaration '${PROMPT_NAME}'`
    );
  }
  return decl;
}

function validateParameterCoverage(
  decl: PromptDeclaration,
  inputs: Record<string, string>,
  path: string
): void {
  const declared = new Set(decl.parameters.map((p) => p.name));
  for (const name of Object.keys(inputs)) {
    if (!declared.has(name)) {
      throw new PromptFileError(
        AGENT_ID,
        path,
        `runtime passed input '${name}' but the prompt does not declare it as a parameter`
      );
    }
  }
  for (const name of declared) {
    if (!(name in inputs)) {
      throw new PromptFileError(
        AGENT_ID,
        path,
        `prompt declares parameter '${name}' but the runtime did not provide it`
      );
    }
  }
}

function renderSection(
  decl: PromptDeclaration,
  role: "system" | "user",
  inputs: Record<string, string>,
  path: string
): string {
  const section = decl.sections.find(
    (s): s is MessageSection => s.kind === "MessageSection" && s.role === role
  );
  if (!section) {
    throw new PromptFileError(AGENT_ID, path, `missing '${role}:' section`);
  }
  const raw = section.content.value;
  const rendered = raw.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
    const value = inputs[varName];
    if (value === undefined) {
      throw new PromptFileError(
        AGENT_ID,
        path,
        `'${role}:' references unknown parameter '{{${varName}}}'`
      );
    }
    return value;
  });
  return rendered;
}

// ---------------------------------------------------------------------------
// Parsing + validation
// ---------------------------------------------------------------------------

/**
 * Index of legitimate targets extracted from the supplied brief.
 * The parser consults this to reject fabricated cross-references.
 */
interface TargetIndex {
  sectionIds: ReadonlySet<string>;
  optionIds: ReadonlySet<string>;
  riskIds: ReadonlySet<string>;
  stakeholderNames: ReadonlySet<string>;
  findingCount: number;
}

function buildTargetIndex(ctx: AdversarialContext): TargetIndex {
  return {
    sectionIds: new Set(ctx.brief_result.synthesis.sections.map((s) => s.section_id)),
    optionIds: new Set(ctx.brief_result.options.options.map((o) => o.id)),
    riskIds: new Set(ctx.brief_result.risks.risks.map((r) => r.id)),
    stakeholderNames: new Set(ctx.brief_result.stakeholders.stakeholders.map((s) => s.name)),
    findingCount: ctx.brief_result.research.findings.length,
  };
}

export function parseAdversarialCritiqueResult(
  raw: string,
  ctx: AdversarialContext
): AdversarialCritiqueResult {
  const stripped = stripJsonFences(raw).trim();
  if (stripped.length === 0) {
    throw new InvalidAgentOutputError(AGENT_ID, "empty response", raw);
  }
  let value: unknown;
  try {
    value = JSON.parse(stripped);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `not valid JSON (${message})`,
      raw
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      "expected a JSON object at the top level",
      raw
    );
  }
  const obj = value as Record<string, unknown>;

  const rawCritiques = obj["critiques"];
  if (!Array.isArray(rawCritiques)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      "'critiques' must be an array",
      raw
    );
  }
  if (rawCritiques.length > MAX_CRITIQUES) {
    throw new AdversarialCritiqueError(
      `critique count ${rawCritiques.length} exceeds the hard maximum of ${MAX_CRITIQUES}. Tighten the analysis.`
    );
  }
  if (rawCritiques.length < MIN_CRITIQUES) {
    throw new AdversarialCritiqueError(
      `critique count ${rawCritiques.length} is below the minimum of ${MIN_CRITIQUES}. Steelman more counter-arguments.`
    );
  }

  const index = buildTargetIndex(ctx);
  const critiques = rawCritiques.map((item, i) => parseCritique(item, i, raw, index));

  // ID uniqueness + sequential shape.
  const seenIds = new Set<string>();
  for (const [i, c] of critiques.entries()) {
    if (seenIds.has(c.id)) {
      throw new AdversarialCritiqueError(
        `duplicate critique id '${c.id}' at index ${i}`
      );
    }
    seenIds.add(c.id);
  }
  for (let i = 0; i < critiques.length; i++) {
    const expected = `CRIT-${String(i + 1).padStart(3, "0")}`;
    if (critiques[i]!.id !== expected) {
      throw new AdversarialCritiqueError(
        `critique ids must be sequential 'CRIT-001', 'CRIT-002', … — got '${critiques[i]!.id}' at index ${i}, expected '${expected}'`
      );
    }
  }

  // Derived severity counts (recomputed — the model's numbers are advisory).
  let criticalCount = 0;
  let materialCount = 0;
  let minorCount = 0;
  for (const c of critiques) {
    if (c.severity === "critical") criticalCount++;
    else if (c.severity === "material") materialCount++;
    else minorCount++;
  }

  // Cross-check the model's own severity counts if it supplied them.
  const modelCritical = obj["critical_count"];
  if (typeof modelCritical === "number" && modelCritical !== criticalCount) {
    throw new AdversarialCritiqueError(
      `critical_count mismatch: model reported ${modelCritical}, derived ${criticalCount}`
    );
  }
  const modelMaterial = obj["material_count"];
  if (typeof modelMaterial === "number" && modelMaterial !== materialCount) {
    throw new AdversarialCritiqueError(
      `material_count mismatch: model reported ${modelMaterial}, derived ${materialCount}`
    );
  }
  const modelMinor = obj["minor_count"];
  if (typeof modelMinor === "number" && modelMinor !== minorCount) {
    throw new AdversarialCritiqueError(
      `minor_count mismatch: model reported ${modelMinor}, derived ${minorCount}`
    );
  }

  const derivedRobustness = deriveRobustness(criticalCount, materialCount);
  const modelRobustness = obj["recommendation_robustness"];
  if (
    modelRobustness !== undefined &&
    modelRobustness !== derivedRobustness
  ) {
    // Advisory only — trust the derivation, keep as-is.
    // (No throw: the model's robustness read is a soft signal we
    // silently correct.)
  }

  const derivedRevisionNeeded =
    criticalCount >= CRITICAL_TRIGGER || materialCount >= MATERIAL_TRIGGER;

  // The model's `revised_recommendation_needed` field is checked
  // against the derived signal — mismatches indicate the model has
  // ignored its own severity classifications, which is a fault.
  const rawRevisionNeeded = obj["revised_recommendation_needed"];
  if (typeof rawRevisionNeeded !== "boolean") {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      "'revised_recommendation_needed' must be a boolean",
      raw
    );
  }
  if (rawRevisionNeeded !== derivedRevisionNeeded) {
    throw new AdversarialCritiqueError(
      `revised_recommendation_needed mismatch: model reported ${rawRevisionNeeded}, derived ${derivedRevisionNeeded} (from ${criticalCount} critical, ${materialCount} material)`
    );
  }

  let steelmannedAlternative: string | null = null;
  const rawAlt = obj["steelmanned_alternative"];
  if (rawAlt !== null && rawAlt !== undefined) {
    if (typeof rawAlt !== "string" || rawAlt.trim().length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        "'steelmanned_alternative' must be null or a non-empty string",
        raw
      );
    }
    steelmannedAlternative = rawAlt;
  }
  if (derivedRevisionNeeded && steelmannedAlternative === null) {
    throw new MissingAlternativeError();
  }

  return {
    critiques,
    critical_count: criticalCount,
    material_count: materialCount,
    minor_count: minorCount,
    recommendation_robustness: derivedRobustness,
    revised_recommendation_needed: derivedRevisionNeeded,
    steelmanned_alternative: steelmannedAlternative,
  };
}

function deriveRobustness(
  criticalCount: number,
  materialCount: number
): "high" | "medium" | "low" {
  if (criticalCount >= CRITICAL_FOR_LOW || materialCount >= MATERIAL_FOR_LOW) {
    return "low";
  }
  if (
    criticalCount >= CRITICAL_FOR_MEDIUM ||
    materialCount >= MATERIAL_FOR_MEDIUM
  ) {
    return "medium";
  }
  return "high";
}

function parseCritique(
  item: unknown,
  i: number,
  raw: string,
  index: TargetIndex
): Critique {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `critiques[${i}] must be an object`,
      raw
    );
  }
  const obj = item as Record<string, unknown>;

  const id = requireNonEmptyString(obj, "id", `critiques[${i}].id`, raw);
  const category = requireEnum(
    obj,
    "category",
    CRITIQUE_CATEGORIES,
    `critiques[${i}].category`,
    raw
  ) as CritiqueCategory;
  const severity = requireEnum(
    obj,
    "severity",
    CRITIQUE_SEVERITIES,
    `critiques[${i}].severity`,
    raw
  ) as CritiqueSeverity;

  const steelmanned = requireNonEmptyString(
    obj,
    "steelmanned_position",
    `critiques[${i}].steelmanned_position`,
    raw
  );
  const wordCount = steelmanned.trim().split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < MIN_STEELMAN_WORDS) {
    throw new AdversarialCritiqueError(
      `critiques[${i}].steelmanned_position has ${wordCount} words (min ${MIN_STEELMAN_WORDS}). A steelman needs room to breathe — spend at least ${MIN_STEELMAN_WORDS} words defending the counter-argument at its strongest.`
    );
  }

  const implication = requireNonEmptyString(
    obj,
    "implication_if_true",
    `critiques[${i}].implication_if_true`,
    raw
  );
  const suggestedRevision = requireNonEmptyString(
    obj,
    "suggested_revision",
    `critiques[${i}].suggested_revision`,
    raw
  );

  const counterEvidence = parseSource(obj["counter_evidence"], i, raw);
  const target = parseCritiqueTarget(obj["target"], i, id, raw, index);

  return {
    id,
    category,
    severity,
    target,
    steelmanned_position: steelmanned,
    counter_evidence: counterEvidence,
    implication_if_true: implication,
    suggested_revision: suggestedRevision,
  };
}

function parseCritiqueTarget(
  value: unknown,
  i: number,
  critiqueId: string,
  raw: string,
  index: TargetIndex
): CritiqueTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `critiques[${i}].target must be an object`,
      raw
    );
  }
  const obj = value as Record<string, unknown>;
  const out: CritiqueTarget = {};

  if (obj["section_id"] !== undefined && obj["section_id"] !== null) {
    if (typeof obj["section_id"] !== "string" || obj["section_id"].length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `critiques[${i}].target.section_id must be a non-empty string`,
        raw
      );
    }
    if (!index.sectionIds.has(obj["section_id"])) {
      throw new InvalidCritiqueTargetError(
        critiqueId,
        `unknown section_id '${obj["section_id"]}' (known: [${[...index.sectionIds].join(", ")}])`
      );
    }
    out.section_id = obj["section_id"];
  }
  if (obj["option_id"] !== undefined && obj["option_id"] !== null) {
    if (typeof obj["option_id"] !== "string" || obj["option_id"].length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `critiques[${i}].target.option_id must be a non-empty string`,
        raw
      );
    }
    if (!index.optionIds.has(obj["option_id"])) {
      throw new InvalidCritiqueTargetError(
        critiqueId,
        `unknown option_id '${obj["option_id"]}' (known: [${[...index.optionIds].join(", ")}])`
      );
    }
    out.option_id = obj["option_id"];
  }
  if (obj["risk_id"] !== undefined && obj["risk_id"] !== null) {
    if (typeof obj["risk_id"] !== "string" || obj["risk_id"].length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `critiques[${i}].target.risk_id must be a non-empty string`,
        raw
      );
    }
    if (!index.riskIds.has(obj["risk_id"])) {
      throw new InvalidCritiqueTargetError(
        critiqueId,
        `unknown risk_id '${obj["risk_id"]}' (known: [${[...index.riskIds].join(", ")}])`
      );
    }
    out.risk_id = obj["risk_id"];
  }
  if (obj["stakeholder_name"] !== undefined && obj["stakeholder_name"] !== null) {
    if (
      typeof obj["stakeholder_name"] !== "string" ||
      obj["stakeholder_name"].length === 0
    ) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `critiques[${i}].target.stakeholder_name must be a non-empty string`,
        raw
      );
    }
    if (!index.stakeholderNames.has(obj["stakeholder_name"])) {
      throw new InvalidCritiqueTargetError(
        critiqueId,
        `unknown stakeholder_name '${obj["stakeholder_name"]}' (known: [${[...index.stakeholderNames].join(", ")}])`
      );
    }
    out.stakeholder_name = obj["stakeholder_name"];
  }
  if (obj["finding_index"] !== undefined && obj["finding_index"] !== null) {
    const fi = obj["finding_index"];
    if (typeof fi !== "number" || !Number.isInteger(fi) || fi < 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `critiques[${i}].target.finding_index must be a non-negative integer`,
        raw
      );
    }
    if (fi >= index.findingCount) {
      throw new InvalidCritiqueTargetError(
        critiqueId,
        `finding_index ${fi} out of range (research.findings.length = ${index.findingCount})`
      );
    }
    out.finding_index = fi;
  }

  const anySet =
    out.section_id !== undefined ||
    out.option_id !== undefined ||
    out.risk_id !== undefined ||
    out.stakeholder_name !== undefined ||
    out.finding_index !== undefined;
  if (!anySet) {
    throw new InvalidCritiqueTargetError(
      critiqueId,
      "target is empty — at least one field (section_id / option_id / risk_id / stakeholder_name / finding_index) must be set"
    );
  }
  return out;
}

function parseSource(value: unknown, i: number, raw: string): SourceStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `critiques[${i}].counter_evidence must be an object`,
      raw
    );
  }
  const obj = value as Record<string, unknown>;
  if (obj["status"] === "SOURCE_MISSING") {
    const searchedFor = obj["searched_for"];
    if (typeof searchedFor !== "string" || searchedFor.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `critiques[${i}].counter_evidence: SOURCE_MISSING requires a non-empty 'searched_for'`,
        raw
      );
    }
    return { status: "SOURCE_MISSING", searched_for: searchedFor };
  }
  const url = obj["url"];
  const title = obj["title"];
  const accessedAt = obj["accessed_at"];
  const excerpt = obj["excerpt"];
  if (typeof url !== "string" || url.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `critiques[${i}].counter_evidence.url must be a non-empty string (or use SOURCE_MISSING)`,
      raw
    );
  }
  if (typeof title !== "string" || title.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `critiques[${i}].counter_evidence.title must be a non-empty string`,
      raw
    );
  }
  if (typeof accessedAt !== "string" || accessedAt.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `critiques[${i}].counter_evidence.accessed_at must be a non-empty ISO 8601 string`,
      raw
    );
  }
  if (typeof excerpt !== "string") {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `critiques[${i}].counter_evidence.excerpt must be a string`,
      raw
    );
  }
  if (excerpt.length > 500) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `critiques[${i}].counter_evidence.excerpt exceeds 500 characters`,
      raw
    );
  }
  return { url, title, accessed_at: accessedAt, excerpt };
}

// ---------------------------------------------------------------------------
// Low-level helpers (mirror the pattern from risk.ts / options.ts).
// ---------------------------------------------------------------------------

function requireNonEmptyString(
  obj: Record<string, unknown>,
  field: string,
  displayPath: string,
  raw: string
): string {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `${displayPath} must be a non-empty string`,
      raw
    );
  }
  return v;
}

function requireEnum(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  displayPath: string,
  raw: string
): string {
  const v = obj[field];
  if (typeof v !== "string" || !allowed.includes(v)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `${displayPath} must be one of ${allowed.join("|")}`,
      raw
    );
  }
  return v;
}

function stripJsonFences(raw: string): string {
  const fenced = raw.match(/^```(?:json)?\n([\s\S]*?)\n```\s*$/);
  if (fenced && fenced[1] !== undefined) return fenced[1];
  return raw;
}

/** Re-exported so callers can construct richer errors. */
export {
  AdversarialCritiqueError,
  InvalidCritiqueTargetError,
  MissingAlternativeError,
};
