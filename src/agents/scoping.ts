/**
 * Scoping agent, the first Praxis agent.
 *
 * Pipeline:
 *   1. Load `prompts/scoping.prompt` and parse it with PromptLang.
 *   2. Locate the `scope` prompt declaration and its system + user
 *      message sections.
 *   3. Interpolate every `{{name}}` placeholder in system and user
 *      against the provided `AgentContext`. Reject unknown parameter
 *      names and orphan placeholders.
 *   4. Concatenate `system\n\n---\n\n<user>` into one prompt string and
 *      dispatch it to the injected `LLMProvider`.
 *   5. Parse the LLM's textual response as JSON and validate that it
 *      matches `ScopingResult` before returning.
 *
 * Any deviation surfaces as one of the typed errors in `./errors.ts`.
 */

import { callModel, loadPrompt, renderPrompt, parseAnswerObject } from "./prompt-runtime.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { AgentContext, ScopingResult } from "./types.ts";
import {
  InvalidAgentOutputError,
} from "./errors.ts";

const AGENT_ID = "scoping";

const STRING_LIST = { type: "array", items: { type: "string" } };

/** Constrains decoding to the shape `parseScopingResult` validates. */
const SCOPING_SCHEMA = {
  type: "object",
  properties: {
    reformulated_question: { type: "string" },
    hidden_questions: STRING_LIST,
    scope_boundaries: STRING_LIST,
    assumptions_to_validate: STRING_LIST,
    requester_provided: STRING_LIST,
  },
  required: [
    "reformulated_question",
    "hidden_questions",
    "scope_boundaries",
    "assumptions_to_validate",
    "requester_provided",
  ],
  additionalProperties: false,
};
const PROMPT_NAME = "scope";
const DEFAULT_PROMPT_PATH = "prompts/scoping.prompt";

export interface ExecuteScopingOptions {
  /** Overrides the default `prompts/scoping.prompt` location — used in tests. */
  promptPath?: string;
}

export async function executeScoping(
  ctx: AgentContext,
  llm: LLMProvider,
  options: ExecuteScopingOptions = {}
): Promise<ScopingResult> {
  const promptPath = options.promptPath ?? DEFAULT_PROMPT_PATH;
  const loaded = loadPrompt(AGENT_ID, promptPath, PROMPT_NAME);

  const inputs: Record<string, string> = {
    question: ctx.question,
    format_id: ctx.formatId,
    target_words: String(ctx.targetWords),
  };

  const rendered = renderPrompt(AGENT_ID, loaded, inputs);
  const completion = await callModel(AGENT_ID, llm, loaded, rendered, {
    tools: [],
    outputSchema: SCOPING_SCHEMA,
  });
  return parseScopingResult(completion.text);
}

export function parseScopingResult(raw: string): ScopingResult {
  const obj = parseAnswerObject(AGENT_ID, raw);
  const reformulated = obj["reformulated_question"];
  if (typeof reformulated !== "string" || reformulated.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      "'reformulated_question' must be a non-empty string",
      raw
    );
  }
  const hidden = requireStringArray(obj, "hidden_questions", raw);
  const boundaries = requireStringArray(obj, "scope_boundaries", raw);
  const assumptions = requireStringArray(obj, "assumptions_to_validate", raw);
  // Absent in checkpoints and fixtures written before the field existed.
  const requester =
    obj["requester_provided"] === undefined ? undefined : requireStringArray(obj, "requester_provided", raw);

  return {
    reformulated_question: reformulated,
    hidden_questions: hidden,
    scope_boundaries: boundaries,
    assumptions_to_validate: assumptions,
    ...(requester === undefined ? {} : { requester_provided: requester }),
  };
}

function requireStringArray(
  obj: Record<string, unknown>,
  field: string,
  raw: string
): string[] {
  const value = obj[field];
  if (!Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `'${field}' must be an array of strings`,
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

