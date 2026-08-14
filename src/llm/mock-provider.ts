/**
 * `MockLLMProvider` — a deterministic, offline `LLMProvider`
 * implementation for tests and the v0.2 CLI.
 *
 * Fixtures are JSON files with shape:
 *
 *   { "match_substring": "<snippet the prompt must contain>",
 *     "response": "<string returned verbatim by complete()>" }
 *
 * The provider loads every `.json` under `fixturesDir` on construction.
 * On `complete(prompt)` it returns the response of the first fixture
 * whose `match_substring` appears in `prompt`. If none matches, it
 * throws `MockFixtureNotFoundError`.
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
import { LLMError, MockFixtureNotFoundError } from "./errors.ts";

export interface MockFixture {
  match_substring: string;
  response: string;
  /** Optional label for debugging; not used for matching. */
  label?: string;
}

export interface MockLLMProviderOptions {
  fixturesDir: string;
}

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  private readonly fixtures: readonly MockFixture[];
  private readonly fixturesDir: string;

  constructor(options: MockLLMProviderOptions) {
    this.fixturesDir = options.fixturesDir;
    this.fixtures = loadFixtures(options.fixturesDir);
  }

  async complete(prompt: string, _options?: CompleteOptions): Promise<string> {
    for (const fixture of this.fixtures) {
      if (prompt.includes(fixture.match_substring)) {
        return fixture.response;
      }
    }
    const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
    throw new MockFixtureNotFoundError(hash, this.fixturesDir);
  }
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
  return fixture;
}
