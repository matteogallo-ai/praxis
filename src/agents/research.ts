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

import { readFileSync, existsSync } from "node:fs";

import { tokenize } from "promptlang/lexer";
import { parse } from "promptlang/parser";
import type { Program, PromptDeclaration, MessageSection } from "promptlang/ast";

import type { LLMProvider } from "../llm/provider.ts";
import type { Tool } from "../llm/types.ts";
import { ToolUseNotSupportedError } from "../llm/errors.ts";
import type { ResearchContext, ResearchResult, Finding } from "./types.ts";
import type { SourceStatus } from "../sourcing/types.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
  MaxToolRoundsExceededError,
  ResearchAgentError,
} from "./errors.ts";

const AGENT_ID = "research";
const PROMPT_NAME = "research";
const DEFAULT_PROMPT_PATH = "prompts/research.prompt";
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
  const declaration = loadPromptDeclaration(promptPath);

  const inputs: Record<string, string> = {
    scoping_json: JSON.stringify(ctx.scoping, null, 2),
    format_id: ctx.formatId,
    sourcing_policy: ctx.sourcingPolicy,
    target_words: String(ctx.targetWords),
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

  return parseResearchResult(completion.text);
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
  const source = parseSource(obj["source"], i, raw);
  return { claim, supporting_evidence: evidence, source };
}

function parseSource(value: unknown, i: number, raw: string): SourceStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `findings[${i}].source must be an object`,
      raw
    );
  }
  const obj = value as Record<string, unknown>;
  if (obj["status"] === "SOURCE_MISSING") {
    const searchedFor = obj["searched_for"];
    if (typeof searchedFor !== "string" || searchedFor.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `findings[${i}].source: SOURCE_MISSING requires a non-empty 'searched_for'`,
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
      `findings[${i}].source.url must be a non-empty string (or use SOURCE_MISSING)`,
      raw
    );
  }
  if (typeof title !== "string" || title.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `findings[${i}].source.title must be a non-empty string`,
      raw
    );
  }
  if (typeof accessedAt !== "string" || accessedAt.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `findings[${i}].source.accessed_at must be a non-empty ISO 8601 string`,
      raw
    );
  }
  if (typeof excerpt !== "string") {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `findings[${i}].source.excerpt must be a string`,
      raw
    );
  }
  if (excerpt.length > 500) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `findings[${i}].source.excerpt exceeds 500 characters`,
      raw
    );
  }
  return { url, title, accessed_at: accessedAt, excerpt };
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

function stripJsonFences(raw: string): string {
  const fenced = raw.match(/^```(?:json)?\n([\s\S]*?)\n```\s*$/);
  if (fenced && fenced[1] !== undefined) return fenced[1];
  return raw;
}

/** Re-exported so callers can construct richer errors when needed. */
export { ResearchAgentError };
