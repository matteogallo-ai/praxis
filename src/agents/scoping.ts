/**
 * Scoping agent — v0.2, the first Praxis agent.
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

import { readFileSync, existsSync } from "node:fs";

import { tokenize } from "promptlang/lexer";
import { parse } from "promptlang/parser";
import type { Program, PromptDeclaration, MessageSection } from "promptlang/ast";

import type { LLMProvider } from "../llm/provider.ts";
import type { AgentContext, ScopingResult } from "./types.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
} from "./errors.ts";

const AGENT_ID = "scoping";
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
  const declaration = loadPromptDeclaration(promptPath);

  const inputs: Record<string, string> = {
    question: ctx.question,
    format_id: ctx.formatId,
    target_words: String(ctx.targetWords),
  };

  validateParameterCoverage(declaration, inputs, promptPath);

  const systemText = renderSection(declaration, "system", inputs, promptPath);
  const userText = renderSection(declaration, "user", inputs, promptPath);
  const prompt = `${systemText.trim()}\n\n---\n\n${userText.trim()}`;

  let raw: string;
  try {
    raw = await llm.complete(prompt);
  } catch (err) {
    if (err instanceof AgentExecutionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentExecutionError(AGENT_ID, `LLM provider error — ${message}`);
  }

  return parseScopingResult(raw);
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

function parseScopingResult(raw: string): ScopingResult {
  const stripped = stripJsonFences(raw).trim();
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

  return {
    reformulated_question: reformulated,
    hidden_questions: hidden,
    scope_boundaries: boundaries,
    assumptions_to_validate: assumptions,
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

function stripJsonFences(raw: string): string {
  const fenced = raw.match(/^```(?:json)?\n([\s\S]*?)\n```\s*$/);
  if (fenced && fenced[1] !== undefined) return fenced[1];
  return raw;
}
