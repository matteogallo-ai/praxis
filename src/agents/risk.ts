/**
 * Risk Analysis agent — v0.5, the fourth Praxis agent.
 *
 * First agent whose input includes THREE prior outputs (Scoping +
 * Research + Stakeholders). Produces a `RiskAnalysisResult` with
 * sourced likelihood + impact evidence, concrete mitigations, and
 * verified cross-references to the stakeholder mapping.
 *
 * Pipeline:
 *   1. Load `prompts/risk.prompt` and parse it with PromptLang.
 *   2. Locate the `risk` prompt declaration; render its system + user
 *      sections with {{scoping_json}} / {{research_json}} /
 *      {{stakeholders_json}} / {{format_id}} / {{sourcing_policy}}.
 *   3. Dispatch to `llm.completeWithTools` with the `web_search` tool;
 *      cap the loop at `max_tool_rounds`.
 *   4. Parse the response as JSON. Validate every field, enforce hard
 *      caps on risk count, cross-check every `affected_stakeholders`
 *      entry against the stakeholder mapping, and require every
 *      `likelihood_evidence` / `impact_evidence` field to be a
 *      `SourceReference` OR an explicit `SOURCE_MISSING` marker.
 *
 * Sourcing policy enforcement (freshness, domain trust, dedupe) is
 * delegated to the sourcing layer via the Orchestrator — this agent
 * only validates SHAPE and CROSS-REFERENCES.
 */

import { readFileSync, existsSync } from "node:fs";

import { tokenize } from "promptlang/lexer";
import { parse } from "promptlang/parser";
import type { Program, PromptDeclaration, MessageSection } from "promptlang/ast";

import type { LLMProvider } from "../llm/provider.ts";
import type { Tool } from "../llm/types.ts";
import { ToolUseNotSupportedError } from "../llm/errors.ts";
import type {
  AggregatedRiskLevel,
  Risk,
  RiskAnalysisResult,
  RiskCategory,
  RiskContext,
  RiskImpact,
  RiskLikelihood,
  RiskTimeframe,
  StakeholderMapResult,
} from "./types.ts";
import {
  AGGREGATED_RISK_LEVELS,
  RISK_CATEGORIES,
  RISK_IMPACTS,
  RISK_LIKELIHOODS,
  RISK_TIMEFRAMES,
} from "./types.ts";
import type { SourceStatus } from "../sourcing/types.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  InvalidRiskStakeholderReference,
  MaxToolRoundsExceededError,
  PromptFileError,
  RiskAnalysisError,
  RiskInflationError,
} from "./errors.ts";

const AGENT_ID = "risk";
const PROMPT_NAME = "risk";
const DEFAULT_PROMPT_PATH = "prompts/risk.prompt";
const DEFAULT_MAX_TOOL_ROUNDS = 5;

/** Lower bound the parser flags as a warning; runs still succeed. */
export const MIN_RISKS = 5;
/** Hard ceiling. Beyond this the parser throws `RiskInflationError`. */
export const MAX_RISKS = 25;
/** Minimum number of concrete mitigations per risk. */
export const MIN_MITIGATIONS_PER_RISK = 1;
/** Maximum number of mitigations per risk. */
export const MAX_MITIGATIONS_PER_RISK = 3;

const WEB_SEARCH_TOOL: Tool = { type: "web_search", name: "web_search" };

// Anti-vague-mitigation heuristic. Every mitigation must contain a
// concrete signal — a verb, a metric, a deadline word, or an owner
// keyword. This is a cheap rejection filter; the model is prompted to
// avoid vague mitigations, and this catches obvious slips.
const VAGUE_MITIGATION_RE =
  /^\s*(monitor|watch|keep\s+an\s+eye|track|observe|stay\s+aware|be\s+careful|be\s+prepared)(\s+closely)?\.?\s*$/i;

export interface ExecuteRiskAnalysisOptions {
  /** Overrides the default `prompts/risk.prompt` location — used in tests. */
  promptPath?: string;
  /** Hard cap on tool-use rounds. Default: 5. */
  maxToolRounds?: number;
}

export async function executeRiskAnalysis(
  ctx: RiskContext,
  llm: LLMProvider,
  options: ExecuteRiskAnalysisOptions = {}
): Promise<RiskAnalysisResult> {
  if (typeof llm.completeWithTools !== "function") {
    throw new ToolUseNotSupportedError(llm.name);
  }

  const promptPath = options.promptPath ?? DEFAULT_PROMPT_PATH;
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const declaration = loadPromptDeclaration(promptPath);

  const inputs: Record<string, string> = {
    scoping_json: JSON.stringify(ctx.scoping, null, 2),
    research_json: JSON.stringify(ctx.research, null, 2),
    stakeholders_json: JSON.stringify(ctx.stakeholders, null, 2),
    format_id: ctx.format.id,
    sourcing_policy: ctx.format.sourcing_policy,
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

  return parseRiskAnalysisResult(completion.text, ctx.stakeholders);
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
// Parsing + validation of the LLM's structured output.
// ---------------------------------------------------------------------------

export function parseRiskAnalysisResult(
  raw: string,
  stakeholders: StakeholderMapResult
): RiskAnalysisResult {
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

  const rawRisks = obj["risks"];
  if (!Array.isArray(rawRisks)) {
    throw new InvalidAgentOutputError(AGENT_ID, "'risks' must be an array", raw);
  }
  if (rawRisks.length > MAX_RISKS) {
    throw new RiskInflationError(rawRisks.length, MAX_RISKS);
  }
  if (rawRisks.length === 0) {
    throw new RiskAnalysisError(
      `risks list is empty — the agent must identify at least one risk.`
    );
  }

  const knownStakeholderNames = new Set(
    stakeholders.stakeholders.map((s) => s.name)
  );

  const risks = rawRisks.map((item, i) =>
    parseRisk(item, i, raw, knownStakeholderNames)
  );

  // Enforce ID uniqueness + sequential shape.
  const seenIds = new Set<string>();
  for (const [i, r] of risks.entries()) {
    if (seenIds.has(r.id)) {
      throw new RiskAnalysisError(`duplicate risk id '${r.id}' at index ${i}`);
    }
    seenIds.add(r.id);
  }
  const expected = risks.map((_, i) => `RISK-${String(i + 1).padStart(3, "0")}`);
  for (let i = 0; i < risks.length; i++) {
    if (risks[i]!.id !== expected[i]) {
      throw new RiskAnalysisError(
        `risk ids must be sequential 'RISK-001', 'RISK-002', … — got '${risks[i]!.id}' at index ${i}, expected '${expected[i]}'`
      );
    }
  }

  const aggregated = parseAggregatedScore(obj["aggregated_risk_score"], raw, risks);
  const topPriorities = parseTopPriorities(obj["top_3_priorities"], raw, seenIds, risks.length);
  const uncertainties = parseUnresolvedUncertainties(obj["unresolved_uncertainties"], raw);

  return {
    risks,
    aggregated_risk_score: aggregated,
    top_3_priorities: topPriorities,
    unresolved_uncertainties: uncertainties,
  };
}

function parseRisk(
  item: unknown,
  i: number,
  raw: string,
  knownStakeholderNames: ReadonlySet<string>
): Risk {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}] must be an object`,
      raw
    );
  }
  const obj = item as Record<string, unknown>;

  const id = requireNonEmptyString(obj, "id", `risks[${i}].id`, raw);
  const category = requireEnum(
    obj,
    "category",
    RISK_CATEGORIES,
    `risks[${i}].category`,
    raw
  ) as RiskCategory;
  const description = requireNonEmptyString(
    obj,
    "description",
    `risks[${i}].description`,
    raw
  );
  const likelihood = requireEnum(
    obj,
    "likelihood",
    RISK_LIKELIHOODS,
    `risks[${i}].likelihood`,
    raw
  ) as RiskLikelihood;
  const impact = requireEnum(
    obj,
    "impact",
    RISK_IMPACTS,
    `risks[${i}].impact`,
    raw
  ) as RiskImpact;
  const timeframe = requireEnum(
    obj,
    "timeframe",
    RISK_TIMEFRAMES,
    `risks[${i}].timeframe`,
    raw
  ) as RiskTimeframe;
  const residual = requireEnum(
    obj,
    "residual_risk_after_mitigation",
    RISK_LIKELIHOODS,
    `risks[${i}].residual_risk_after_mitigation`,
    raw
  ) as RiskLikelihood;

  const likelihoodEvidence = parseSource(
    obj["likelihood_evidence"],
    i,
    "likelihood_evidence",
    raw
  );
  const impactEvidence = parseSource(
    obj["impact_evidence"],
    i,
    "impact_evidence",
    raw
  );

  const affected = parseAffectedStakeholders(
    obj["affected_stakeholders"],
    i,
    raw,
    id,
    knownStakeholderNames
  );

  const mitigations = parseMitigations(obj["mitigations"], i, raw);

  return {
    id,
    category,
    description,
    likelihood,
    impact,
    likelihood_evidence: likelihoodEvidence,
    impact_evidence: impactEvidence,
    affected_stakeholders: affected,
    timeframe,
    mitigations,
    residual_risk_after_mitigation: residual,
  };
}

function parseSource(
  value: unknown,
  i: number,
  field: "likelihood_evidence" | "impact_evidence",
  raw: string
): SourceStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].${field} must be an object`,
      raw
    );
  }
  const obj = value as Record<string, unknown>;
  if (obj["status"] === "SOURCE_MISSING") {
    const searchedFor = obj["searched_for"];
    if (typeof searchedFor !== "string" || searchedFor.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `risks[${i}].${field}: SOURCE_MISSING requires a non-empty 'searched_for'`,
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
      `risks[${i}].${field}.url must be a non-empty string (or use SOURCE_MISSING)`,
      raw
    );
  }
  if (typeof title !== "string" || title.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].${field}.title must be a non-empty string`,
      raw
    );
  }
  if (typeof accessedAt !== "string" || accessedAt.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].${field}.accessed_at must be a non-empty ISO 8601 string`,
      raw
    );
  }
  if (typeof excerpt !== "string") {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].${field}.excerpt must be a string`,
      raw
    );
  }
  if (excerpt.length > 500) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].${field}.excerpt exceeds 500 characters`,
      raw
    );
  }
  return { url, title, accessed_at: accessedAt, excerpt };
}

function parseAffectedStakeholders(
  value: unknown,
  i: number,
  raw: string,
  riskId: string,
  knownStakeholderNames: ReadonlySet<string>
): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].affected_stakeholders must be a non-empty array of strings`,
      raw
    );
  }
  if (value.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].affected_stakeholders must reference at least one stakeholder`,
      raw
    );
  }
  const out: string[] = [];
  for (const [j, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `risks[${i}].affected_stakeholders[${j}] must be a non-empty string`,
        raw
      );
    }
    if (!knownStakeholderNames.has(entry)) {
      throw new InvalidRiskStakeholderReference(
        riskId,
        entry,
        [...knownStakeholderNames]
      );
    }
    out.push(entry);
  }
  return out;
}

function parseMitigations(value: unknown, i: number, raw: string): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].mitigations must be an array of strings`,
      raw
    );
  }
  if (value.length < MIN_MITIGATIONS_PER_RISK) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].mitigations must contain at least ${MIN_MITIGATIONS_PER_RISK} entry`,
      raw
    );
  }
  if (value.length > MAX_MITIGATIONS_PER_RISK) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `risks[${i}].mitigations must contain at most ${MAX_MITIGATIONS_PER_RISK} entries`,
      raw
    );
  }
  const out: string[] = [];
  for (const [j, m] of value.entries()) {
    if (typeof m !== "string" || m.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `risks[${i}].mitigations[${j}] must be a non-empty string`,
        raw
      );
    }
    if (VAGUE_MITIGATION_RE.test(m)) {
      throw new RiskAnalysisError(
        `risks[${i}].mitigations[${j}] is too vague ('${m}') — name a concrete action.`
      );
    }
    out.push(m);
  }
  return out;
}

function parseAggregatedScore(
  value: unknown,
  raw: string,
  risks: readonly Risk[]
): RiskAnalysisResult["aggregated_risk_score"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `'aggregated_risk_score' must be an object`,
      raw
    );
  }
  const obj = value as Record<string, unknown>;

  const overall = obj["overall"];
  if (
    typeof overall !== "string" ||
    !(AGGREGATED_RISK_LEVELS as readonly string[]).includes(overall)
  ) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `'aggregated_risk_score.overall' must be one of ${AGGREGATED_RISK_LEVELS.join("|")}`,
      raw
    );
  }

  const byCategoryRaw = obj["by_category"];
  if (
    typeof byCategoryRaw !== "object" ||
    byCategoryRaw === null ||
    Array.isArray(byCategoryRaw)
  ) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `'aggregated_risk_score.by_category' must be an object`,
      raw
    );
  }
  const byCategory: Partial<Record<RiskCategory, AggregatedRiskLevel>> = {};
  for (const [key, level] of Object.entries(byCategoryRaw)) {
    if (!(RISK_CATEGORIES as readonly string[]).includes(key)) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `'aggregated_risk_score.by_category.${key}' is not a valid risk category`,
        raw
      );
    }
    if (
      typeof level !== "string" ||
      !(AGGREGATED_RISK_LEVELS as readonly string[]).includes(level)
    ) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `'aggregated_risk_score.by_category.${key}' must be one of ${AGGREGATED_RISK_LEVELS.join("|")}`,
        raw
      );
    }
    byCategory[key as RiskCategory] = level as AggregatedRiskLevel;
  }

  // Every category that has at least one risk must appear in by_category.
  const categoriesWithRisks = new Set<RiskCategory>();
  for (const r of risks) categoriesWithRisks.add(r.category);
  for (const cat of categoriesWithRisks) {
    if (!(cat in byCategory)) {
      throw new RiskAnalysisError(
        `aggregated_risk_score.by_category is missing category '${cat}' which has at least one risk`
      );
    }
  }

  return { overall: overall as AggregatedRiskLevel, by_category: byCategory };
}

function parseTopPriorities(
  value: unknown,
  raw: string,
  knownRiskIds: ReadonlySet<string>,
  totalRisks: number
): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `'top_3_priorities' must be an array of risk ids`,
      raw
    );
  }
  const expected = Math.min(3, totalRisks);
  if (value.length !== expected) {
    throw new RiskAnalysisError(
      `top_3_priorities must contain exactly ${expected} entries, got ${value.length}`
    );
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [j, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `top_3_priorities[${j}] must be a non-empty string`,
        raw
      );
    }
    if (!knownRiskIds.has(entry)) {
      throw new RiskAnalysisError(
        `top_3_priorities[${j}]='${entry}' does not reference any risk id`
      );
    }
    if (seen.has(entry)) {
      throw new RiskAnalysisError(
        `top_3_priorities[${j}]='${entry}' is duplicated`
      );
    }
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function parseUnresolvedUncertainties(value: unknown, raw: string): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `'unresolved_uncertainties' must be an array (possibly empty)`,
      raw
    );
  }
  const out: string[] = [];
  for (const [j, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `unresolved_uncertainties[${j}] must be a non-empty string`,
        raw
      );
    }
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Low-level helpers (mirror the pattern from stakeholder.ts / research.ts).
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
  RiskAnalysisError,
  InvalidRiskStakeholderReference,
  RiskInflationError,
};
