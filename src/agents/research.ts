/**
 * Research agent — v0.3, the second Praxis agent.
 *
 * Pipeline:
 *   1. Load `prompts/research.prompt` and parse it with PromptLang.
 *   2. Locate the `research` prompt declaration and its system + user
 *      message sections.
 *   3. Interpolate {{scoping_json}} / {{format_id}} /
 *      {{sourcing_policy}} / {{target_words}} against the injected
 *      `ResearchContext`. Reject unknown parameter names and orphan
 *      placeholders.
 *   4. Concatenate system + "---" + user into one prompt string and
 *      dispatch it to `llm.completeWithTools` with the `web_search`
 *      tool. Loop up to `max_tool_rounds` — throws
 *      `MaxToolRoundsExceededError` if the model never ends its turn.
 *   5. Parse the returned text as JSON and validate it matches
 *      `ResearchResult` (findings with SourceReference OR SourceMissing).
 *
 * Any deviation surfaces as one of the typed errors in `./errors.ts`.
 * Sourcing policy is enforced by `validateSourcing` in the sourcing
 * layer — this agent trusts the LLM's SOURCE_MISSING markers verbatim
 * and does not silently fill them in.
 */

import { callModel, loadPrompt, renderPrompt, stripJsonFences, outputReader } from "./prompt-runtime.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { Tool } from "../llm/types.ts";
import { ToolUseNotSupportedError } from "../llm/errors.ts";
import type { ResearchContext, ResearchResult, Finding } from "./types.ts";
import {
  InvalidAgentOutputError,
} from "./errors.ts";

const AGENT_ID = "research";
const PROMPT_NAME = "research";
const DEFAULT_PROMPT_PATH = "prompts/research.prompt";
const { parseSource } = outputReader(AGENT_ID);
const DEFAULT_MAX_TOOL_ROUNDS = 5;

const WEB_SEARCH_TOOL: Tool = { type: "web_search", name: "web_search" };

export interface ExecuteResearchOptions {
  /** Overrides the default `prompts/research.prompt` location — used in tests. */
  promptPath?: string;
  /** Hard cap on tool-use rounds. Default: 5. */
  maxToolRounds?: number;
}

export async function executeResearch(
  ctx: ResearchContext,
  llm: LLMProvider,
  options: ExecuteResearchOptions = {}
): Promise<ResearchResult> {
  if (typeof llm.completeWithTools !== "function") {
    throw new ToolUseNotSupportedError(llm.name);
  }

  const promptPath = options.promptPath ?? DEFAULT_PROMPT_PATH;
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const loaded = loadPrompt(AGENT_ID, promptPath, PROMPT_NAME);

  const inputs: Record<string, string> = {
    scoping_json: JSON.stringify(ctx.scoping, null, 2),
    format_id: ctx.formatId,
    sourcing_policy: ctx.sourcingPolicy,
    target_words: String(ctx.targetWords),
  };

  const rendered = renderPrompt(AGENT_ID, loaded, inputs);
  const completion = await callModel(AGENT_ID, llm, loaded, rendered, {
    tools: [WEB_SEARCH_TOOL],
    maxToolRounds,
  });

  return parseResearchResult(completion.text);
}

function parseResearchResult(raw: string): ResearchResult {
  const stripped = stripJsonFences(raw).trim();
  if (stripped.length === 0) {
    throw new InvalidAgentOutputError(AGENT_ID, "empty response", raw);
  }
  let value: unknown;
  try {
    value = JSON.parse(stripped);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidAgentOutputError(AGENT_ID, `not valid JSON (${message})`, raw);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      "expected a JSON object at the top level",
      raw
    );
  }
  const obj = value as Record<string, unknown>;

  const findingsRaw = obj["findings"];
  if (!Array.isArray(findingsRaw)) {
    throw new InvalidAgentOutputError(AGENT_ID, "'findings' must be an array", raw);
  }
  const findings = findingsRaw.map((item, i) => parseFinding(item, i, raw));

  const openQuestions = requireStringArray(obj, "open_questions", raw, true);
  const searchQueries = requireStringArray(obj, "search_queries_used", raw, true);

  return {
    findings,
    open_questions: openQuestions,
    search_queries_used: searchQueries,
  };
}

function parseFinding(item: unknown, i: number, raw: string): Finding {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `findings[${i}] must be an object`,
      raw
    );
  }
  const obj = item as Record<string, unknown>;
  const claim = obj["claim"];
  const evidence = obj["supporting_evidence"];
  if (typeof claim !== "string" || claim.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `findings[${i}].claim must be a non-empty string`,
      raw
    );
  }
  if (typeof evidence !== "string" || evidence.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `findings[${i}].supporting_evidence must be a non-empty string`,
      raw
    );
  }
  const source = parseSource(obj["source"], `findings[${i}].source`, raw);
  return { claim, supporting_evidence: evidence, source };
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

