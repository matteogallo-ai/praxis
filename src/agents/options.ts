/**
 * Options Generation agent — v0.6, the fifth Praxis agent.
 *
 * First agent whose input includes ALL FOUR prior artefacts (Scoping +
 * Research + Stakeholders + Risks). Produces an
 * `OptionsGenerationResult`: 2-4 mutually-exclusive decision options,
 * each with concrete tradeoffs, cross-referenced stakeholder impact
 * predictions, cross-referenced risk implications, and one
 * `recommended` option.
 *
 * Pipeline:
 *   1. Load `prompts/options.prompt` and parse it with PromptLang.
 *   2. Locate the `options` prompt declaration; render its system +
 *      user sections with all six template inputs.
 *   3. Dispatch to `llm.completeWithTools` with the `web_search` tool;
 *      cap the loop at `max_tool_rounds`.
 *   4. Parse the response as JSON. Validate every field, enforce hard
 *      caps on option count, verify each `stakeholder_impact` name
 *      exists in the mapping, verify each risk id exists in the risk
 *      analysis, verify EXACTLY ONE option carries
 *      `recommendation_level === "recommended"`, and verify
 *      `recommended_option_id` matches that option's id.
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
  Option,
  OptionRecommendationLevel,
  OptionStakeholderImpact,
  OptionTradeoff,
  OptionsContext,
  OptionsGenerationResult,
  RiskAnalysisResult,
  RiskTimeframe,
  StakeholderMapResult,
  StakeholderPosition,
} from "./types.ts";
import {
  OPTION_RECOMMENDATION_LEVELS,
  RISK_TIMEFRAMES,
} from "./types.ts";
import type { SourceStatus } from "../sourcing/types.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  InvalidOptionRiskReference,
  InvalidOptionStakeholderReference,
  MaxToolRoundsExceededError,
  OptionsGenerationError,
  PromptFileError,
} from "./errors.ts";

const AGENT_ID = "options";
const PROMPT_NAME = "options";
const DEFAULT_PROMPT_PATH = "prompts/options.prompt";
const DEFAULT_MAX_TOOL_ROUNDS = 5;

/** Hard floor: fewer than 2 undermines "genuine choice". */
export const MIN_OPTIONS = 2;
/** Hard ceiling: beyond 4 the reader can't hold the space. */
export const MAX_OPTIONS = 4;
/** Minimum concrete tradeoff dimensions per option. */
export const MIN_TRADEOFFS_PER_OPTION = 3;
/** Maximum tradeoff dimensions before we're padding. */
export const MAX_TRADEOFFS_PER_OPTION = 6;

const WEB_SEARCH_TOOL: Tool = { type: "web_search", name: "web_search" };

const VALID_REACTIONS: readonly StakeholderPosition[] = [
  "supportive",
  "neutral",
  "resistant",
  "unknown",
];

/**
 * Vague tradeoff labels that the model must not use. Rejecting these
 * at parse time forces the model to pick a concrete dimension.
 */
const VAGUE_TRADEOFF_LABELS = new Set([
  "pros",
  "cons",
  "advantages",
  "disadvantages",
  "strengths",
  "weaknesses",
  "general",
  "positives",
  "negatives",
  "benefits",
  "drawbacks",
]);

/** Option IDs assigned sequentially by the parser. */
const OPTION_ID_ALPHABET = ["OPT-A", "OPT-B", "OPT-C", "OPT-D"] as const;

export interface ExecuteOptionsGenerationOptions {
  /** Overrides the default `prompts/options.prompt` location — used in tests. */
  promptPath?: string;
  /** Hard cap on tool-use rounds. Default: 5. */
  maxToolRounds?: number;
}

export async function executeOptionsGeneration(
  ctx: OptionsContext,
  llm: LLMProvider,
  options: ExecuteOptionsGenerationOptions = {}
): Promise<OptionsGenerationResult> {
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
    risks_json: JSON.stringify(ctx.risks, null, 2),
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

  return parseOptionsGenerationResult(completion.text, ctx.stakeholders, ctx.risks);
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

export function parseOptionsGenerationResult(
  raw: string,
  stakeholders: StakeholderMapResult,
  risks: RiskAnalysisResult
): OptionsGenerationResult {
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

  const rawOptions = obj["options"];
  if (!Array.isArray(rawOptions)) {
    throw new InvalidAgentOutputError(AGENT_ID, "'options' must be an array", raw);
  }
  if (rawOptions.length < MIN_OPTIONS) {
    throw new OptionsGenerationError(
      `options count ${rawOptions.length} is below the minimum of ${MIN_OPTIONS}. Present at least one real alternative.`
    );
  }
  if (rawOptions.length > MAX_OPTIONS) {
    throw new OptionsGenerationError(
      `options count ${rawOptions.length} exceeds the maximum of ${MAX_OPTIONS}. Consolidate variations into distinct top-level options.`
    );
  }

  const knownStakeholderNames = new Set(
    stakeholders.stakeholders.map((s) => s.name)
  );
  const knownRiskIds = new Set(risks.risks.map((r) => r.id));

  const parsedOptions = rawOptions.map((item, i) =>
    parseOption(item, i, raw, knownStakeholderNames, knownRiskIds)
  );

  // Enforce ID uniqueness + sequential (OPT-A, OPT-B, …).
  const seenIds = new Set<string>();
  for (const [i, o] of parsedOptions.entries()) {
    if (seenIds.has(o.id)) {
      throw new OptionsGenerationError(
        `duplicate option id '${o.id}' at index ${i}`
      );
    }
    seenIds.add(o.id);
  }
  for (let i = 0; i < parsedOptions.length; i++) {
    const expected = OPTION_ID_ALPHABET[i]!;
    if (parsedOptions[i]!.id !== expected) {
      throw new OptionsGenerationError(
        `option ids must be sequential 'OPT-A', 'OPT-B', … — got '${parsedOptions[i]!.id}' at index ${i}, expected '${expected}'`
      );
    }
  }

  // Enforce exactly-one-recommended discipline.
  const recommendedIds = parsedOptions
    .filter((o) => o.recommendation_level === "recommended")
    .map((o) => o.id);
  if (recommendedIds.length === 0) {
    throw new OptionsGenerationError(
      `no option carries recommendation_level='recommended'. Exactly one required.`
    );
  }
  if (recommendedIds.length > 1) {
    throw new OptionsGenerationError(
      `${recommendedIds.length} options carry recommendation_level='recommended' (${recommendedIds.join(", ")}). Exactly one required.`
    );
  }

  const recommendedId = requireNonEmptyString(
    obj,
    "recommended_option_id",
    "recommended_option_id",
    raw
  );
  if (!seenIds.has(recommendedId)) {
    throw new OptionsGenerationError(
      `recommended_option_id='${recommendedId}' does not reference any option id (known: [${[...seenIds].join(", ")}])`
    );
  }
  if (recommendedId !== recommendedIds[0]) {
    throw new OptionsGenerationError(
      `recommended_option_id='${recommendedId}' does not match the option marked recommendation_level='recommended' ('${recommendedIds[0]}')`
    );
  }

  const rationale = requireNonEmptyString(
    obj,
    "rationale_for_recommendation",
    "rationale_for_recommendation",
    raw
  );

  const counterArguments = requireStringArray(
    obj,
    "counter_arguments_considered",
    raw,
    true
  );
  const uncertainties = requireStringArray(
    obj,
    "unresolved_uncertainties",
    raw,
    true
  );

  return {
    options: parsedOptions,
    recommended_option_id: recommendedId,
    rationale_for_recommendation: rationale,
    counter_arguments_considered: counterArguments,
    unresolved_uncertainties: uncertainties,
  };
}

function parseOption(
  item: unknown,
  i: number,
  raw: string,
  knownStakeholderNames: ReadonlySet<string>,
  knownRiskIds: ReadonlySet<string>
): Option {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}] must be an object`,
      raw
    );
  }
  const obj = item as Record<string, unknown>;

  const id = requireNonEmptyString(obj, "id", `options[${i}].id`, raw);
  const title = requireNonEmptyString(obj, "title", `options[${i}].title`, raw);
  const summary = requireNonEmptyString(obj, "summary", `options[${i}].summary`, raw);

  const timeHorizon = requireEnum(
    obj,
    "time_horizon",
    RISK_TIMEFRAMES,
    `options[${i}].time_horizon`,
    raw
  ) as RiskTimeframe;
  const recommendation = requireEnum(
    obj,
    "recommendation_level",
    OPTION_RECOMMENDATION_LEVELS,
    `options[${i}].recommendation_level`,
    raw
  ) as OptionRecommendationLevel;

  const tradeoffs = parseTradeoffs(obj["tradeoffs"], i, raw);
  const stakeholderImpact = parseStakeholderImpact(
    obj["stakeholder_impact"],
    i,
    raw,
    id,
    knownStakeholderNames
  );
  const risksMitigated = parseRiskReferences(
    obj["risks_mitigated"],
    i,
    "risks_mitigated",
    raw,
    id,
    knownRiskIds
  );
  const risksIntroduced = parseRiskReferences(
    obj["risks_introduced"],
    i,
    "risks_introduced",
    raw,
    id,
    knownRiskIds
  );
  // A risk cannot be both mitigated and introduced by the same option.
  const overlap = risksMitigated.filter((r) => risksIntroduced.includes(r));
  if (overlap.length > 0) {
    throw new OptionsGenerationError(
      `option '${id}' lists risk id(s) ${overlap.join(", ")} in BOTH risks_mitigated and risks_introduced. A risk cannot be both.`
    );
  }

  const dependencies = parseStringArray(
    obj["dependencies"],
    `options[${i}].dependencies`,
    raw,
    true
  );
  const supportingEvidence = parseSource(
    obj["supporting_evidence"],
    i,
    raw
  );

  return {
    id,
    title,
    summary,
    tradeoffs,
    stakeholder_impact: stakeholderImpact,
    risks_mitigated: risksMitigated,
    risks_introduced: risksIntroduced,
    dependencies,
    time_horizon: timeHorizon,
    recommendation_level: recommendation,
    supporting_evidence: supportingEvidence,
  };
}

function parseTradeoffs(
  value: unknown,
  i: number,
  raw: string
): OptionTradeoff[] {
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].tradeoffs must be an array`,
      raw
    );
  }
  if (value.length < MIN_TRADEOFFS_PER_OPTION) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].tradeoffs must contain at least ${MIN_TRADEOFFS_PER_OPTION} entries`,
      raw
    );
  }
  if (value.length > MAX_TRADEOFFS_PER_OPTION) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].tradeoffs must contain at most ${MAX_TRADEOFFS_PER_OPTION} entries`,
      raw
    );
  }
  const out: OptionTradeoff[] = [];
  const seenDims = new Set<string>();
  for (const [j, entry] of value.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `options[${i}].tradeoffs[${j}] must be an object`,
        raw
      );
    }
    const eo = entry as Record<string, unknown>;
    const dimension = requireNonEmptyString(
      eo,
      "dimension",
      `options[${i}].tradeoffs[${j}].dimension`,
      raw
    );
    const assessment = requireNonEmptyString(
      eo,
      "assessment",
      `options[${i}].tradeoffs[${j}].assessment`,
      raw
    );
    const normalized = dimension.trim().toLowerCase();
    if (VAGUE_TRADEOFF_LABELS.has(normalized)) {
      throw new OptionsGenerationError(
        `options[${i}].tradeoffs[${j}].dimension '${dimension}' is too vague — use a concrete label (e.g. cost, time-to-market, regulatory-exposure).`
      );
    }
    if (seenDims.has(normalized)) {
      throw new OptionsGenerationError(
        `options[${i}].tradeoffs[${j}].dimension '${dimension}' is duplicated within the same option.`
      );
    }
    seenDims.add(normalized);
    out.push({ dimension, assessment });
  }
  return out;
}

function parseStakeholderImpact(
  value: unknown,
  i: number,
  raw: string,
  optionId: string,
  knownNames: ReadonlySet<string>
): OptionStakeholderImpact[] {
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].stakeholder_impact must be an array`,
      raw
    );
  }
  if (value.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].stakeholder_impact must reference at least one stakeholder`,
      raw
    );
  }
  const out: OptionStakeholderImpact[] = [];
  for (const [j, entry] of value.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `options[${i}].stakeholder_impact[${j}] must be an object`,
        raw
      );
    }
    const eo = entry as Record<string, unknown>;
    const name = requireNonEmptyString(
      eo,
      "stakeholder_name",
      `options[${i}].stakeholder_impact[${j}].stakeholder_name`,
      raw
    );
    if (!knownNames.has(name)) {
      throw new InvalidOptionStakeholderReference(
        optionId,
        name,
        [...knownNames]
      );
    }
    const reaction = requireEnum(
      eo,
      "predicted_reaction",
      VALID_REACTIONS,
      `options[${i}].stakeholder_impact[${j}].predicted_reaction`,
      raw
    ) as StakeholderPosition;
    const impactDescription = requireNonEmptyString(
      eo,
      "impact_description",
      `options[${i}].stakeholder_impact[${j}].impact_description`,
      raw
    );
    out.push({
      stakeholder_name: name,
      predicted_reaction: reaction,
      impact_description: impactDescription,
    });
  }
  return out;
}

function parseRiskReferences(
  value: unknown,
  i: number,
  field: "risks_mitigated" | "risks_introduced",
  raw: string,
  optionId: string,
  knownIds: ReadonlySet<string>
): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].${field} must be an array of risk ids (may be empty)`,
      raw
    );
  }
  const out: string[] = [];
  for (const [j, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `options[${i}].${field}[${j}] must be a non-empty string`,
        raw
      );
    }
    if (!knownIds.has(entry)) {
      throw new InvalidOptionRiskReference(optionId, entry, field, [...knownIds]);
    }
    out.push(entry);
  }
  return out;
}

function parseSource(value: unknown, i: number, raw: string): SourceStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].supporting_evidence must be an object`,
      raw
    );
  }
  const obj = value as Record<string, unknown>;
  if (obj["status"] === "SOURCE_MISSING") {
    const searchedFor = obj["searched_for"];
    if (typeof searchedFor !== "string" || searchedFor.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `options[${i}].supporting_evidence: SOURCE_MISSING requires a non-empty 'searched_for'`,
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
      `options[${i}].supporting_evidence.url must be a non-empty string (or use SOURCE_MISSING)`,
      raw
    );
  }
  if (typeof title !== "string" || title.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].supporting_evidence.title must be a non-empty string`,
      raw
    );
  }
  if (typeof accessedAt !== "string" || accessedAt.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].supporting_evidence.accessed_at must be a non-empty ISO 8601 string`,
      raw
    );
  }
  if (typeof excerpt !== "string") {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].supporting_evidence.excerpt must be a string`,
      raw
    );
  }
  if (excerpt.length > 500) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `options[${i}].supporting_evidence.excerpt exceeds 500 characters`,
      raw
    );
  }
  return { url, title, accessed_at: accessedAt, excerpt };
}

// ---------------------------------------------------------------------------
// Low-level helpers (mirror the pattern from risk.ts).
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

function requireStringArray(
  obj: Record<string, unknown>,
  field: string,
  raw: string,
  allowEmpty: boolean
): string[] {
  return parseStringArray(obj[field], `'${field}'`, raw, allowEmpty);
}

function parseStringArray(
  value: unknown,
  displayPath: string,
  raw: string,
  allowEmpty: boolean
): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `${displayPath} must be an array of strings`,
      raw
    );
  }
  if (!allowEmpty && value.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `${displayPath} must not be empty`,
      raw
    );
  }
  const out: string[] = [];
  for (const [i, item] of value.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `${displayPath}[${i}] must be a non-empty string`,
        raw
      );
    }
    out.push(item);
  }
  return out;
}

function stripJsonFences(raw: string): string {
  const fenced = raw.match(/^```(?:json)?\n([\s\S]*?)\n```\s*$/);
  if (fenced && fenced[1] !== undefined) return fenced[1];
  return raw;
}

/** Re-exported so callers can construct richer errors. */
export {
  OptionsGenerationError,
  InvalidOptionStakeholderReference,
  InvalidOptionRiskReference,
};
