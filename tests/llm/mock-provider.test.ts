import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import {
  LLMError,
  MockFixtureNotFoundError,
} from "../../src/llm/errors.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "praxis-mock-llm-"));
}

describe("MockLLMProvider", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("name is 'mock'", () => {
    writeFileSync(
      join(tmp, "a.json"),
      JSON.stringify({ match_substring: "hi", response: "ok" })
    );
    const p = new MockLLMProvider({ fixturesDir: tmp });
    expect(p.name).toBe("mock");
  });

  test("returns fixture response when substring matches", async () => {
    writeFileSync(
      join(tmp, "a.json"),
      JSON.stringify({
        match_substring: "scoping question",
        response: '{"ok":true}',
      })
    );
    const p = new MockLLMProvider({ fixturesDir: tmp });
    const out = await p.complete("Please answer this scoping question about X.");
    expect(out).toBe('{"ok":true}');
  });

  test("scans fixtures in sorted order for deterministic first match", async () => {
    writeFileSync(
      join(tmp, "b.json"),
      JSON.stringify({ match_substring: "hello", response: "from-b" })
    );
    writeFileSync(
      join(tmp, "a.json"),
      JSON.stringify({ match_substring: "hello", response: "from-a" })
    );
    const p = new MockLLMProvider({ fixturesDir: tmp });
    const out = await p.complete("say hello please");
    expect(out).toBe("from-a");
  });

  test("throws MockFixtureNotFoundError when nothing matches", async () => {
    writeFileSync(
      join(tmp, "a.json"),
      JSON.stringify({ match_substring: "xyz", response: "n/a" })
    );
    const p = new MockLLMProvider({ fixturesDir: tmp });
    let caught: unknown;
    try {
      await p.complete("this prompt has no matching substring");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MockFixtureNotFoundError);
    const e = caught as MockFixtureNotFoundError;
    expect(e.fixturesDir).toBe(tmp);
    expect(e.promptHash.length).toBe(12);
  });

  test("throws LLMError when fixtures dir does not exist", () => {
    expect(() =>
      new MockLLMProvider({ fixturesDir: join(tmp, "missing") })
    ).toThrow(LLMError);
  });

  test("throws LLMError when fixtures dir is actually a file", () => {
    const p = join(tmp, "not-a-dir.txt");
    writeFileSync(p, "x");
    expect(() => new MockLLMProvider({ fixturesDir: p })).toThrow(LLMError);
  });

  test("throws LLMError on invalid JSON", () => {
    writeFileSync(join(tmp, "broken.json"), "{ this is not json");
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });

  test("throws LLMError when fixture missing match_substring", () => {
    writeFileSync(
      join(tmp, "bad.json"),
      JSON.stringify({ response: "x" })
    );
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });

  test("throws LLMError when fixture missing response", () => {
    writeFileSync(
      join(tmp, "bad.json"),
      JSON.stringify({ match_substring: "x" })
    );
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });

  test("throws LLMError when fixture is not an object", () => {
    writeFileSync(join(tmp, "bad.json"), JSON.stringify(["array"]));
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });

  test("throws LLMError when match_substring is empty", () => {
    writeFileSync(
      join(tmp, "bad.json"),
      JSON.stringify({ match_substring: "", response: "x" })
    );
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });

  test("ignores non-json files in the fixtures dir", async () => {
    writeFileSync(join(tmp, "notes.md"), "just a note");
    writeFileSync(
      join(tmp, "a.json"),
      JSON.stringify({ match_substring: "hi", response: "ok" })
    );
    const p = new MockLLMProvider({ fixturesDir: tmp });
    expect(await p.complete("hi there")).toBe("ok");
  });

  test("empty fixtures dir yields immediate fixture-not-found on complete", async () => {
    mkdirSync(join(tmp, "child"));
    const p = new MockLLMProvider({ fixturesDir: tmp });
    let caught: unknown;
    try {
      await p.complete("anything");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MockFixtureNotFoundError);
  });

  test("optional label is preserved but not used for matching", async () => {
    writeFileSync(
      join(tmp, "a.json"),
      JSON.stringify({
        match_substring: "xyz",
        response: "hit",
        label: "scoping/executive-pre-read",
      })
    );
    const p = new MockLLMProvider({ fixturesDir: tmp });
    expect(await p.complete("prompt contains xyz")).toBe("hit");
  });
});

describe("MockLLMProvider.completeWithTools", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("returns text, tool_calls, rounds, stop_reason from a full fixture", async () => {
    writeFileSync(
      join(tmp, "a.json"),
      JSON.stringify({
        match_substring: "research query",
        response: '{"findings": []}',
        tool_calls: [
          {
            id: "call_1",
            name: "web_search",
            input: { query: "German market entry cost" },
          },
        ],
        rounds: 2,
        stop_reason: "end_turn",
      })
    );
    const p = new MockLLMProvider({ fixturesDir: tmp });
    const out = await p.completeWithTools(
      "please handle this research query",
      [{ type: "web_search", name: "web_search" }]
    );
    expect(out.text).toBe('{"findings": []}');
    expect(out.tool_calls).toHaveLength(1);
    expect(out.tool_calls[0]!.name).toBe("web_search");
    expect(out.tool_calls[0]!.input.query).toBe("German market entry cost");
    expect(out.rounds).toBe(2);
    expect(out.stop_reason).toBe("end_turn");
  });

  test("defaults tool_calls to [], rounds to 1, stop_reason to 'end_turn' when fixture omits them", async () => {
    writeFileSync(
      join(tmp, "a.json"),
      JSON.stringify({ match_substring: "simple", response: "just text" })
    );
    const p = new MockLLMProvider({ fixturesDir: tmp });
    const out = await p.completeWithTools("a simple prompt", []);
    expect(out.text).toBe("just text");
    expect(out.tool_calls).toEqual([]);
    expect(out.rounds).toBe(1);
    expect(out.stop_reason).toBe("end_turn");
  });

  test("throws MockFixtureNotFoundError when nothing matches", async () => {
    writeFileSync(
      join(tmp, "a.json"),
      JSON.stringify({ match_substring: "xxx", response: "n/a" })
    );
    const p = new MockLLMProvider({ fixturesDir: tmp });
    await expect(
      p.completeWithTools("nope", [])
    ).rejects.toBeInstanceOf(MockFixtureNotFoundError);
  });

  test("rejects fixtures with non-array tool_calls at load time", () => {
    writeFileSync(
      join(tmp, "bad.json"),
      JSON.stringify({
        match_substring: "x",
        response: "y",
        tool_calls: "not-an-array",
      })
    );
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });

  test("rejects tool_call entries missing id", () => {
    writeFileSync(
      join(tmp, "bad.json"),
      JSON.stringify({
        match_substring: "x",
        response: "y",
        tool_calls: [{ name: "web_search", input: {} }],
      })
    );
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });

  test("rejects tool_call entries missing name", () => {
    writeFileSync(
      join(tmp, "bad.json"),
      JSON.stringify({
        match_substring: "x",
        response: "y",
        tool_calls: [{ id: "1", input: {} }],
      })
    );
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });

  test("rejects tool_call entries where input is not an object", () => {
    writeFileSync(
      join(tmp, "bad.json"),
      JSON.stringify({
        match_substring: "x",
        response: "y",
        tool_calls: [{ id: "1", name: "web_search", input: "nope" }],
      })
    );
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });

  test("rejects fixture with invalid rounds value", () => {
    writeFileSync(
      join(tmp, "bad.json"),
      JSON.stringify({
        match_substring: "x",
        response: "y",
        rounds: 0,
      })
    );
    expect(() => new MockLLMProvider({ fixturesDir: tmp })).toThrow(LLMError);
  });
});
