/**
 * `MockLLMProvider` — a deterministic, offline `LLMProvider`
 * implementation for tests and offline CLI runs.
 *
 * Fixtures are JSON files with shape:
 *
 *   {
 *     "match_substring": "<snippet the prompt must contain>",
 *     "response":        "<string returned verbatim by complete()>",
 *
 *     // Optional — only read by completeWithTools():
 *     "tool_calls":  [ { "id", "name", "input" }, ... ],
 *     "rounds":      2,
 *     "stop_reason": "end_turn"
 *   }
 *
 * The provider loads every `.json` under `fixturesDir` on construction.
 * On `complete(prompt)` / `completeWithTools(prompt, ...)` it returns
 * the response of the first fixture whose `match_substring` appears in
 * `prompt`. If none matches, it throws `MockFixtureNotFoundError`.
 *
 * The design privileges *substring* matching over exact hashing so that
 * cosmetic edits to a `.prompt` (whitespace, phrasing) do not silently
 * break fixtures — the fixture's discriminating snippet is what must
 * remain stable.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import type { LLMProvider, CompleteOptions } from "./provider.ts";
import type {
  Tool,
  ToolCall,
  CompletionResult,
  CompleteWithToolsOptions,
  TokenUsage,
} from "./types.ts";
import { LLMError, MockFixtureNotFoundError } from "./errors.ts";

export interface MockFixture {
  match_substring: string;
  response: string;
  /** Optional label for debugging; not used for matching. */
  label?: string;
  /** Optional pre-scripted tool calls for `completeWithTools`. */
  tool_calls?: ToolCall[];
  /** Optional round count surfaced in `CompletionResult`. Defaults to 1. */
  rounds?: number;
  /** Optional stop_reason surfaced in `CompletionResult`. Defaults to "end_turn". */
  stop_reason?: string;
}

export interface MockLLMProviderOptions {
  fixturesDir: string;
}

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  readonly acceptsSystemPrompt = true;
  private readonly fixtures: readonly MockFixture[];
  private readonly fixturesDir: string;

  constructor(options: MockLLMProviderOptions) {
    this.fixturesDir = options.fixturesDir;
    this.fixtures = loadFixtures(options.fixturesDir);
  }

  async complete(prompt: string, options?: CompleteOptions): Promise<string> {
    const fixture = this.matchFixture(matchText(prompt, options?.system));
    return fixture.response;
  }

  async completeWithTools(
    prompt: string,
    tools: Tool[],
    options?: CompleteWithToolsOptions
  ): Promise<CompletionResult> {
    const text = matchText(prompt, options?.system);
    const fixture = this.matchFixture(text);
    const toolCalls = fixture.tool_calls ?? [];
    return {
      text: fixture.response,
      tool_calls: toolCalls,
      rounds: fixture.rounds ?? 1,
      stop_reason: fixture.stop_reason ?? "end_turn",
      usage: simulatedUsage(text, fixture.response, tools.length === 0 ? 0 : toolCalls.length),
      model: options?.model ?? "mock",
    };
  }

  private matchFixture(prompt: string): MockFixture {
    for (const fixture of this.fixtures) {
      if (prompt.includes(fixture.match_substring)) {
        return fixture;
      }
    }
    const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
    throw new MockFixtureNotFoundError(hash, this.fixturesDir);
  }
}

/**
 * Usage the mock reports so the cost ledger runs end to end offline: four
 * characters per token, one search per scripted tool call. Deterministic,
 * so mock artefacts stay byte-identical; it measures nothing.
 */
function simulatedUsage(input: string, output: string, searches: number): TokenUsage {
  return {
    input_tokens: Math.ceil(input.length / 4),
    output_tokens: Math.ceil(output.length / 4),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: searches,
  };
}

/**
 * Fixtures match on a substring of the system and user text together, laid
 * out as agents joined them before the system field existed, so fixtures
 * written against either layout keep matching.
 */
function matchText(prompt: string, system: string | undefined): string {
  return system === undefined ? prompt : `${system}\n\n---\n\n${prompt}`;
}

function loadFixtures(dir: string): MockFixture[] {
  if (!existsSync(dir)) {
    throw new LLMError(`MockLLMProvider fixtures directory not found: ${dir}`);
  }
  if (!statSync(dir).isDirectory()) {
    throw new LLMError(`MockLLMProvider fixtures path is not a directory: ${dir}`);
  }
  const entries = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const fixtures: MockFixture[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const raw = readFileSync(full, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMError(`Invalid JSON in mock fixture '${entry}': ${msg}`);
    }
    fixtures.push(validateFixture(parsed, entry));
  }
  return fixtures;
}

function validateFixture(value: unknown, source: string): MockFixture {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LLMError(`Mock fixture '${source}' must be a JSON object`);
  }
  const obj = value as Record<string, unknown>;
  const match = obj["match_substring"];
  const response = obj["response"];
  if (typeof match !== "string" || match.length === 0) {
    throw new LLMError(
      `Mock fixture '${source}' is missing a non-empty 'match_substring' string`
    );
  }
  if (typeof response !== "string") {
    throw new LLMError(
      `Mock fixture '${source}' is missing a 'response' string`
    );
  }
  const fixture: MockFixture = { match_substring: match, response };
  if (typeof obj["label"] === "string") {
    fixture.label = obj["label"];
  }
  if (obj["tool_calls"] !== undefined) {
    fixture.tool_calls = validateToolCalls(obj["tool_calls"], source);
  }
  if (typeof obj["rounds"] === "number") {
    if (!Number.isInteger(obj["rounds"]) || obj["rounds"] < 1) {
      throw new LLMError(
        `Mock fixture '${source}' has invalid 'rounds' (must be positive integer)`
      );
    }
    fixture.rounds = obj["rounds"];
  }
  if (typeof obj["stop_reason"] === "string") {
    fixture.stop_reason = obj["stop_reason"];
  }
  return fixture;
}

function validateToolCalls(value: unknown, source: string): ToolCall[] {
  if (!Array.isArray(value)) {
    throw new LLMError(
      `Mock fixture '${source}': 'tool_calls' must be an array`
    );
  }
  const out: ToolCall[] = [];
  for (const [i, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new LLMError(
        `Mock fixture '${source}': tool_calls[${i}] must be an object`
      );
    }
    const obj = item as Record<string, unknown>;
    const id = obj["id"];
    const name = obj["name"];
    const input = obj["input"];
    if (typeof id !== "string" || id.length === 0) {
      throw new LLMError(
        `Mock fixture '${source}': tool_calls[${i}].id must be a non-empty string`
      );
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new LLMError(
        `Mock fixture '${source}': tool_calls[${i}].name must be a non-empty string`
      );
    }
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new LLMError(
        `Mock fixture '${source}': tool_calls[${i}].input must be an object`
      );
    }
    out.push({ id, name, input: input as Record<string, unknown> });
  }
  return out;
}
