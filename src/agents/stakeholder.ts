/**
 * Stakeholder Mapping agent — v0.4, the third Praxis agent.
 *
 * First agent whose input includes BOTH the Scoping and Research
 * outputs. Produces a `StakeholderMapResult` that later agents will
 * consume and that the reader can use as an engagement plan.
 *
 * Pipeline:
 *   1. Load `prompts/stakeholder.prompt` and parse it with PromptLang.
 *   2. Locate the `stakeholder` prompt declaration; render its
 *      system + user sections with {{scoping_json}} /
 *      {{research_json}} / {{format_id}} / {{sourcing_policy}}.
 *   3. Dispatch to `llm.completeWithTools` with the `web_search`
 *      tool; cap the loop at `max_tool_rounds`.
 *   4. Parse the response as JSON. Validate every field, enforce
 *      hard caps on stakeholder count, and require each
 *      `position_evidence` to be a `SourceReference` OR an explicit
 *      `SOURCE_MISSING` marker (no third option).
 *
 * Sourcing policy enforcement is delegated to the sourcing layer via
 * the Orchestrator — this agent trusts SOURCE_MISSING markers
 * verbatim.
 */

import { callModel, loadPrompt, renderPrompt, stampRetrievalTime, extractJsonText, outputReader } from "./prompt-runtime.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { Tool } from "../llm/types.ts";
import { ToolUseNotSupportedError } from "../llm/errors.ts";
import type {
  StakeholderContext,
  StakeholderMapResult,
  Stakeholder,
  StakeholderCategory,
  StakeholderPower,
  StakeholderPosition,
  StakeholderPriority,
  CoverageConfidence,
} from "./types.ts";
import {
  InvalidAgentOutputError,
  StakeholderMappingError,
} from "./errors.ts";

const AGENT_ID = "stakeholder";
const PROMPT_NAME = "stakeholder";
const DEFAULT_PROMPT_PATH = "prompts/stakeholder.prompt";
const { requireNonEmptyString, requireEnum, parseSource } = outputReader(AGENT_ID);
const DEFAULT_MAX_TOOL_ROUNDS = 5;

/** Hard floor for stakeholder count. Anything below is a failure. */
export const MIN_STAKEHOLDERS = 3;
/** Hard ceiling — the LLM must not pad the list. */
export const MAX_STAKEHOLDERS = 20;

const WEB_SEARCH_TOOL: Tool = { type: "web_search", name: "web_search" };

const VALID_CATEGORIES: readonly StakeholderCategory[] = [
  "decision-maker",
  "influencer",
  "gatekeeper",
  "affected-party",
  "external-observer",
];
const VALID_POWERS: readonly StakeholderPower[] = ["high", "medium", "low"];
const VALID_POSITIONS: readonly StakeholderPosition[] = [
  "supportive",
  "neutral",
  "resistant",
  "unknown",
];
const VALID_PRIORITIES: readonly StakeholderPriority[] = [
  "critical",
  "important",
  "monitor",
];
const VALID_CONFIDENCES: readonly CoverageConfidence[] = ["high", "medium", "low"];

export interface ExecuteStakeholderMappingOptions {
  /** Overrides the default `prompts/stakeholder.prompt` location — used in tests. */
  promptPath?: string;
  /** Hard cap on tool-use rounds. Default: 5. */
  maxToolRounds?: number;
}

export async function executeStakeholderMapping(
  ctx: StakeholderContext,
  llm: LLMProvider,
  options: ExecuteStakeholderMappingOptions = {}
): Promise<StakeholderMapResult> {
  if (typeof llm.completeWithTools !== "function") {
    throw new ToolUseNotSupportedError(llm.name);
  }

  const promptPath = options.promptPath ?? DEFAULT_PROMPT_PATH;
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const loaded = loadPrompt(AGENT_ID, promptPath, PROMPT_NAME);

  const inputs: Record<string, string> = {
    scoping_json: JSON.stringify(ctx.scoping, null, 2),
    research_json: JSON.stringify(ctx.research, null, 2),
    format_id: ctx.format.id,
    sourcing_policy: ctx.format.sourcing_policy,
  };

  const rendered = renderPrompt(AGENT_ID, loaded, inputs);
  const completion = await callModel(AGENT_ID, llm, loaded, rendered, {
    tools: [WEB_SEARCH_TOOL],
    maxToolRounds,
  });

  return stampRetrievalTime(parseStakeholderMapResult(completion.text), new Date());
}

function parseStakeholderMapResult(raw: string): StakeholderMapResult {
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

  const rawList = obj["stakeholders"];
  if (!Array.isArray(rawList)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      "'stakeholders' must be an array",
      raw
    );
  }
  if (rawList.length < MIN_STAKEHOLDERS) {
    throw new StakeholderMappingError(
      `stakeholder count ${rawList.length} is below the minimum of ${MIN_STAKEHOLDERS}. Re-run with a broader lens.`
    );
  }
  if (rawList.length > MAX_STAKEHOLDERS) {
    throw new StakeholderMappingError(
      `stakeholder count ${rawList.length} exceeds the maximum of ${MAX_STAKEHOLDERS}. Tighten the mapping.`
    );
  }

  const stakeholders = rawList.map((item, i) =>
    parseStakeholder(item, i, raw)
  );

  const keyDynamics = requireStringArray(obj, "key_dynamics", raw, false);
  const blindSpots = requireStringArray(obj, "blind_spots", raw, true);

  const coverage = obj["coverage_confidence"];
  if (
    typeof coverage !== "string" ||
    !(VALID_CONFIDENCES as readonly string[]).includes(coverage)
  ) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `'coverage_confidence' must be one of ${VALID_CONFIDENCES.join("|")}`,
      raw
    );
  }

  return {
    stakeholders,
    key_dynamics: keyDynamics,
    blind_spots: blindSpots,
    coverage_confidence: coverage as CoverageConfidence,
  };
}

function parseStakeholder(item: unknown, i: number, raw: string): Stakeholder {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `stakeholders[${i}] must be an object`,
      raw
    );
  }
  const obj = item as Record<string, unknown>;

  const name = requireNonEmptyString(obj, "name", `stakeholders[${i}].name`, raw);
  const category = requireEnum(
    obj,
    "category",
    VALID_CATEGORIES,
    `stakeholders[${i}].category`,
    raw
  ) as StakeholderCategory;
  const interest = requireNonEmptyString(
    obj,
    "interest",
    `stakeholders[${i}].interest`,
    raw
  );
  const position = requireEnum(
    obj,
    "position",
    VALID_POSITIONS,
    `stakeholders[${i}].position`,
    raw
  ) as StakeholderPosition;
  const positionEvidence = parseSource(obj["position_evidence"], `stakeholders[${i}].position_evidence`, raw);
  const power = requireEnum(
    obj,
    "power",
    VALID_POWERS,
    `stakeholders[${i}].power`,
    raw
  ) as StakeholderPower;
  const priority = requireEnum(
    obj,
    "priority",
    VALID_PRIORITIES,
    `stakeholders[${i}].priority`,
    raw
  ) as StakeholderPriority;
  const engagementNotes = requireNonEmptyString(
    obj,
    "engagement_notes",
    `stakeholders[${i}].engagement_notes`,
    raw
  );

  return {
    name,
    category,
    interest,
    position,
    position_evidence: positionEvidence,
    power,
    priority,
    engagement_notes: engagementNotes,
  };
}

function requireStringArray(
  obj: Record<string, unknown>,
  field: string,
  raw: string,
  allowEmpty: boolean
): string[] {
  const value = obj[field];
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `'${field}' must be an array of strings`,
      raw
    );
  }
  if (!allowEmpty && value.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `'${field}' must not be empty`,
      raw
    );
  }
  const out: string[] = [];
  for (const [i, item] of value.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `'${field}[${i}]' must be a non-empty string`,
        raw
      );
    }
    out.push(item);
  }
  return out;
}

