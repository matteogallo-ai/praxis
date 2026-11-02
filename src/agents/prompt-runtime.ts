/**
 * What the seven stage agents share: loading a `.prompt` file, checking that
 * the runtime inputs match its parameters, rendering its `system:` and
 * `user:` sections, and reading the typed fields of the model's JSON answer.
 *
 * Every error names the calling agent, so a failure in a shared helper still
 * reads as "research: …" or "risk: …" in the CLI.
 */

import { existsSync, readFileSync } from "node:fs";

import { tokenize } from "promptlang/lexer";
import { parse } from "promptlang/parser";
import type { MessageSection, Program, PromptDeclaration } from "promptlang/ast";

import type { LLMProvider } from "../llm/provider.ts";
import type { CompletionResult, Tool } from "../llm/types.ts";
import type { SourceStatus } from "../sourcing/types.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  MaxToolRoundsExceededError,
  PromptFileError,
} from "./errors.ts";

/** A parsed `.prompt` file reduced to the one declaration a stage runs. */
export interface LoadedPrompt {
  path: string;
  declaration: PromptDeclaration;
  /** The file's `@model`, or undefined when it declares none. */
  model: string | undefined;
}

export function loadPrompt(agentId: string, path: string, promptName: string): LoadedPrompt {
  if (!existsSync(path)) {
    throw new PromptFileError(agentId, path, "file not found");
  }
  let source: string;
  try {
    source = readFileSync(path, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PromptFileError(agentId, path, `read failed — ${message}`);
  }

  let program: Program;
  try {
    program = parse(tokenize(source));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PromptFileError(agentId, path, `parse failed — ${message}`);
  }

  const declaration = program.declarations.find(
    (d): d is PromptDeclaration => d.kind === "PromptDeclaration" && d.name === promptName
  );
  if (!declaration) {
    throw new PromptFileError(agentId, path, `missing prompt declaration '${promptName}'`);
  }
  const modelMeta = program.metadata.find((m) => m.kind === "ModelMetadata");
  return { path, declaration, model: modelMeta?.value };
}

/** Rendered `system:` and `user:` text of one prompt call. */
export interface RenderedPrompt {
  system: string;
  user: string;
}

/**
 * Checks that `inputs` names exactly the declared parameters, then renders
 * both message sections. An input the prompt does not declare, a declared
 * parameter with no input, and a `{{placeholder}}` naming neither are all
 * `PromptFileError`s: each means the code and the prompt file drifted apart.
 */
export function renderPrompt(
  agentId: string,
  prompt: LoadedPrompt,
  inputs: Record<string, string>
): RenderedPrompt {
  const declared = new Set(prompt.declaration.parameters.map((p) => p.name));
  for (const name of Object.keys(inputs)) {
    if (!declared.has(name)) {
      throw new PromptFileError(
        agentId,
        prompt.path,
        `runtime passed input '${name}' but the prompt does not declare it as a parameter`
      );
    }
  }
  for (const name of declared) {
    if (!(name in inputs)) {
      throw new PromptFileError(
        agentId,
        prompt.path,
        `prompt declares parameter '${name}' but the runtime did not provide it`
      );
    }
  }
  return {
    system: renderSection(agentId, prompt, "system", inputs).trim(),
    user: renderSection(agentId, prompt, "user", inputs).trim(),
  };
}

function renderSection(
  agentId: string,
  prompt: LoadedPrompt,
  role: "system" | "user",
  inputs: Record<string, string>
): string {
  const section = prompt.declaration.sections.find(
    (s): s is MessageSection => s.kind === "MessageSection" && s.role === role
  );
  if (!section) {
    throw new PromptFileError(agentId, prompt.path, `missing '${role}:' section`);
  }
  return section.content.value.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
    const value = inputs[varName];
    if (value === undefined) {
      throw new PromptFileError(
        agentId,
        prompt.path,
        `'${role}:' references unknown parameter '{{${varName}}}'`
      );
    }
    return value;
  });
}

export interface CallModelOptions {
  /** Server tools the stage may use; empty for a plain completion. */
  tools: Tool[];
  /** Cap on pause_turn continuations; required when `tools` is non-empty. */
  maxToolRounds?: number;
  /**
   * JSON Schema for the answer, sent only on calls without tools: the API
   * rejects structured outputs alongside citations, which web search always
   * produces.
   */
  outputSchema?: Record<string, unknown>;
  /** Appended to the provider-error message, e.g. "while synthesising 'risks'". */
  errorContext?: string;
}

/**
 * Sends one rendered prompt to the provider: system text in the system
 * field when the provider takes one, the stage's `@model`, and the tools.
 * A provider error comes back as `AgentExecutionError` with the original
 * error as `cause`; a turn still paused after `maxToolRounds` is
 * `MaxToolRoundsExceededError`.
 */
export async function callModel(
  agentId: string,
  llm: LLMProvider,
  prompt: LoadedPrompt,
  rendered: RenderedPrompt,
  options: CallModelOptions
): Promise<CompletionResult> {
  const separate = llm.acceptsSystemPrompt === true;
  const userText = separate ? rendered.user : `${rendered.system}\n\n---\n\n${rendered.user}`;
  const placement: { system?: string; model?: string } = {};
  if (separate) placement.system = rendered.system;
  if (prompt.model !== undefined) placement.model = prompt.model;

  let completion: CompletionResult;
  try {
    if (options.tools.length === 0 && typeof llm.complete === "function") {
      const completeOptions: Parameters<LLMProvider["complete"]>[1] = { ...placement };
      if (options.outputSchema !== undefined) completeOptions.output_schema = options.outputSchema;
      const text = await llm.complete(userText, completeOptions);
      completion = { text, tool_calls: [], rounds: 1, stop_reason: "end_turn" };
    } else if (typeof llm.completeWithTools === "function") {
      const toolOptions: Parameters<NonNullable<LLMProvider["completeWithTools"]>>[2] = {
        ...placement,
      };
      if (options.maxToolRounds !== undefined) toolOptions.max_tool_rounds = options.maxToolRounds;
      completion = await llm.completeWithTools(userText, options.tools, toolOptions);
    } else {
      throw new AgentExecutionError(
        agentId,
        `LLM provider '${llm.name}' implements neither complete() nor completeWithTools()`
      );
    }
  } catch (err) {
    if (err instanceof AgentExecutionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const where = options.errorContext === undefined ? "" : ` ${options.errorContext}`;
    throw new AgentExecutionError(agentId, `LLM provider error${where} — ${message}`, {
      cause: err,
    });
  }

  if (
    options.maxToolRounds !== undefined &&
    completion.stop_reason === "pause_turn" &&
    completion.rounds >= options.maxToolRounds
  ) {
    throw new MaxToolRoundsExceededError(options.maxToolRounds);
  }
  return completion;
}

/**
 * The JSON object inside a model answer, as text for the caller to parse.
 *
 * Models put prose before or after the object, or wrap it in a fence, even
 * when told to return JSON only. This returns the largest balanced `{…}`
 * span that parses as an object (braces inside strings and escapes are
 * skipped). With no such span it returns the trimmed answer, so the caller's
 * `JSON.parse` error still describes what the model sent. Nothing is
 * repaired: a truncated object stays invalid.
 */
export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (isJsonObject(trimmed)) return trimmed;
  let best: string | undefined;
  for (const candidate of balancedObjects(trimmed)) {
    if ((best === undefined || candidate.length > best.length) && isJsonObject(candidate)) {
      best = candidate;
    }
  }
  return best ?? trimmed;
}

function isJsonObject(text: string): boolean {
  if (!text.startsWith("{")) return false;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v);
  } catch {
    // Not JSON is an expected answer here, not an error: the caller tries the
    // next candidate, and reports the parse failure itself if none fits.
    return false;
  }
}

/** Every top-level balanced `{…}` span, scanning strings and escapes properly. */
function* balancedObjects(text: string): Generator<string> {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0) yield text.slice(start, i + 1);
    }
  }
}

/** Typed field readers whose errors carry the agent id. */
export interface OutputReader {
  requireNonEmptyString(
    obj: Record<string, unknown>,
    field: string,
    displayPath: string,
    raw: string
  ): string;
  requireEnum(
    obj: Record<string, unknown>,
    field: string,
    allowed: readonly string[],
    displayPath: string,
    raw: string
  ): string;
  /**
   * Reads a `SourceReference` or an explicit `SOURCE_MISSING` marker at
   * `displayPath` (e.g. `findings[2].source`).
   */
  parseSource(value: unknown, displayPath: string, raw: string): SourceStatus;
}

export function outputReader(agentId: string): OutputReader {
  const fail = (message: string, raw: string): never => {
    throw new InvalidAgentOutputError(agentId, message, raw);
  };
  return {
    requireNonEmptyString(obj, field, displayPath, raw) {
      const v = obj[field];
      if (typeof v !== "string" || v.length === 0) {
        return fail(`${displayPath} must be a non-empty string`, raw);
      }
      return v;
    },
    requireEnum(obj, field, allowed, displayPath, raw) {
      const v = obj[field];
      if (typeof v !== "string" || !allowed.includes(v)) {
        return fail(`${displayPath} must be one of ${allowed.join("|")}`, raw);
      }
      return v;
    },
    parseSource(value, path, raw) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return fail(`${path} must be an object`, raw);
      }
      const obj = value as Record<string, unknown>;
      if (obj["status"] === "SOURCE_MISSING") {
        const searchedFor = obj["searched_for"];
        if (typeof searchedFor !== "string" || searchedFor.length === 0) {
          return fail(`${path}: SOURCE_MISSING requires a non-empty 'searched_for'`, raw);
        }
        return { status: "SOURCE_MISSING", searched_for: searchedFor };
      }
      const { url, title, accessed_at: accessedAt, excerpt } = obj;
      if (typeof url !== "string" || url.length === 0) {
        return fail(`${path}.url must be a non-empty string (or use SOURCE_MISSING)`, raw);
      }
      if (typeof title !== "string" || title.length === 0) {
        return fail(`${path}.title must be a non-empty string`, raw);
      }
      if (typeof accessedAt !== "string" || accessedAt.length === 0) {
        return fail(`${path}.accessed_at must be a non-empty ISO 8601 string`, raw);
      }
      if (typeof excerpt !== "string") {
        return fail(`${path}.excerpt must be a string`, raw);
      }
      if (excerpt.length > 500) {
        return fail(`${path}.excerpt exceeds 500 characters`, raw);
      }
      return { url, title, accessed_at: accessedAt, excerpt };
    },
  };
}
