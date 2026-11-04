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

import { callModel, loadPrompt, renderPrompt, stampRetrievalTime, extractJsonText, outputReader, untrustedJson } from "./prompt-runtime.ts";
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
import {
  InvalidAgentOutputError,
  InvalidRiskStakeholderReference,
  RiskAnalysisError,
  RiskInflationError,
} from "./errors.ts";
import { sourceGuidance } from "../sourcing/guidance.ts";

const AGENT_ID = "risk";
const PROMPT_NAME = "risk";
const DEFAULT_PROMPT_PATH = "prompts/risk.prompt";
const { requireNonEmptyString, requireEnum, parseSource } = outputReader(AGENT_ID);
const DEFAULT_MAX_TOOL_ROUNDS = 5;

/** Hard ceiling. Beyond this the parser throws `RiskInflationError`. */
export const MAX_RISKS = 25;
/** Minimum number of concrete mitigations per risk. */
const MIN_MITIGATIONS_PER_RISK = 1;
/** Maximum number of mitigations per risk. */
const MAX_MITIGATIONS_PER_RISK = 3;

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
  const loaded = loadPrompt(AGENT_ID, promptPath, PROMPT_NAME);

  const inputs: Record<string, string> = {
    scoping_json: untrustedJson("scoping", ctx.scoping),
    research_json: untrustedJson("research", ctx.research),
    stakeholders_json: untrustedJson("stakeholders", ctx.stakeholders),
    format_id: ctx.format.id,
    sourcing_policy: ctx.format.sourcing_policy,
    source_guidance: sourceGuidance(ctx.format.sourcing_rules, ctx.format.sourcing_policy, { firstParty: true }),
  };

  const rendered = renderPrompt(AGENT_ID, loaded, inputs);
  const completion = await callModel(AGENT_ID, llm, loaded, rendered, {
    tools: [WEB_SEARCH_TOOL],
    maxToolRounds,
  });

  return stampRetrievalTime(parseRiskAnalysisResult(completion.text, ctx.stakeholders), new Date());
}

// ---------------------------------------------------------------------------
// Parsing + validation of the LLM's structured output.
// ---------------------------------------------------------------------------

export function parseRiskAnalysisResult(
  raw: string,
  stakeholders: StakeholderMapResult
): RiskAnalysisResult {
  const stripped = extractJsonText(raw);
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

  const likelihoodEvidence = parseSource(obj["likelihood_evidence"], `risks[${i}].likelihood_evidence`, raw);
  const impactEvidence = parseSource(obj["impact_evidence"], `risks[${i}].impact_evidence`, raw);

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

