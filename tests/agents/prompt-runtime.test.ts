import { stageLimits } from "../../src/agents/stage-limits.ts";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  callModel,
  loadPrompt,
  outputReader,
  renderPrompt,
  stampRetrievalTime,
  UNTRUSTED_CONTENT_RULE,
} from "../../src/agents/prompt-runtime.ts";
import { AgentExecutionError, MaxToolRoundsExceededError } from "../../src/agents/errors.ts";
import type { CompleteOptions, LLMProvider } from "../../src/llm/provider.ts";
import type { CompleteWithToolsOptions, Tool } from "../../src/llm/types.ts";
import { AnthropicTimeoutError } from "../../src/llm/errors.ts";

const PROMPT = `@version "1.0.0"
@model claude-haiku-5-5
@description "test"

prompt demo(topic: string) -> string {
  system: """
    You are a careful analyst.
  """
  user: """
    Topic: {{topic}}
  """
  output: string
}
`;

function writePrompt(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-prompt-"));
  const path = join(dir, "demo.prompt");
  writeFileSync(path, text);
  return path;
}

interface Seen {
  prompt: string;
  options: CompleteOptions | CompleteWithToolsOptions | undefined;
  tools?: Tool[];
}

function recordingProvider(acceptsSystemPrompt: boolean | undefined): {
  llm: LLMProvider;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const llm: LLMProvider = {
    name: "recording",
    ...(acceptsSystemPrompt === undefined ? {} : { acceptsSystemPrompt }),
    async complete(prompt, options) {
      seen.push({ prompt, options });
      return "{}";
    },
    async completeWithTools(prompt, tools, options) {
      seen.push({ prompt, options, tools });
      return { text: "{}", tool_calls: [], rounds: 1, stop_reason: "end_turn" };
    },
  };
  return { llm, seen };
}

describe("loadPrompt / renderPrompt", () => {
  test("reads @model and renders both sections, trimmed", () => {
    const loaded = loadPrompt("demo", writePrompt(PROMPT), "demo");
    expect(loaded.model).toBe("claude-haiku-5-5");
    const rendered = renderPrompt("demo", loaded, { topic: "Germany" });
    expect(rendered.system).toBe(`You are a careful analyst.\n\n${UNTRUSTED_CONTENT_RULE}`);
    expect(rendered.user).toBe("Topic: Germany");
  });
});

const LIMITS = {
  max_tokens: stageLimits("demo").maxTokens,
  timeout_ms: stageLimits("demo").timeoutMs,
};

describe("callModel", () => {
  test("each stage sends its own max_tokens, timeout and search cap", async () => {
    const { llm, seen } = recordingProvider(true);
    const tools = [{ type: "web_search", name: "web_search" }];
    await callModel("scoping", llm, loaded(), rendered, { tools: [] });
    await callModel("research", llm, loaded(), rendered, { tools });
    expect(seen[0]!.options).toMatchObject({ max_tokens: 8_000, timeout_ms: 240_000 });
    expect(seen[0]!.tools).toEqual([]);
    expect(seen[1]!.options).toMatchObject({ max_tokens: 16_000, timeout_ms: 480_000 });
    expect(seen[1]!.tools).toEqual([{ type: "web_search", name: "web_search", max_uses: 5 }]);
  });

  test("a provider with only complete() still serves tool-less stages", async () => {
    const seen: Seen[] = [];
    const llm: LLMProvider = {
      name: "plain",
      acceptsSystemPrompt: true,
      async complete(prompt, options) {
        seen.push({ prompt, options });
        return "{}";
      },
    };
    const out = await callModel("synthesis", llm, loaded(), rendered, { tools: [] });
    expect(out.text).toBe("{}");
    expect(seen[0]!.options).toMatchObject({ max_tokens: 8_000, timeout_ms: 240_000 });
  });

  const loaded = () => loadPrompt("demo", writePrompt(PROMPT), "demo");
  const rendered = { system: "SYS", user: "USER" };

  test("sends system and user separately, with the prompt's @model", async () => {
    const { llm, seen } = recordingProvider(true);
    await callModel("demo", llm, loaded(), rendered, { tools: [] });
    expect(seen[0]!.prompt).toBe("USER");
    expect(seen[0]!.options).toEqual({ system: "SYS", model: "claude-haiku-5-5", ...LIMITS });
  });

  test("with tools, the same placement goes through completeWithTools", async () => {
    const { llm, seen } = recordingProvider(true);
    const tools = [{ type: "web_search", name: "web_search" }];
    await callModel("demo", llm, loaded(), rendered, { tools, maxToolRounds: 3 });
    expect(seen[0]!.tools).toEqual([{ ...tools[0]!, max_uses: stageLimits("demo").maxSearches }]);
    expect(seen[0]!.options).toEqual({
      system: "SYS",
      model: "claude-haiku-5-5",
      max_tool_rounds: 3,
      ...LIMITS,
    });
  });

  test("an output schema is passed on calls without tools only", async () => {
    const { llm, seen } = recordingProvider(true);
    const schema = { type: "object" };
    await callModel("demo", llm, loaded(), rendered, { tools: [], outputSchema: schema });
    expect(seen[0]!.options).toEqual({
      system: "SYS",
      model: "claude-haiku-5-5",
      output_schema: schema,
      ...LIMITS,
    });
    await callModel("demo", llm, loaded(), rendered, {
      tools: [{ type: "web_search", name: "web_search" }],
      outputSchema: schema,
    });
    expect(seen[1]!.options).not.toHaveProperty("output_schema");
  });

  test("a provider that does not declare acceptsSystemPrompt still gets the system text", async () => {
    const { llm, seen } = recordingProvider(undefined);
    await callModel("demo", llm, loaded(), rendered, { tools: [] });
    expect(seen[0]!.prompt).toBe("SYS\n\n---\n\nUSER");
    expect(seen[0]!.options).toEqual({ model: "claude-haiku-5-5", ...LIMITS });
  });

  test("a provider error keeps its type as the cause", async () => {
    const timeout = new AnthropicTimeoutError(1000);
    const llm: LLMProvider = {
      name: "failing",
      acceptsSystemPrompt: true,
      async complete() {
        throw timeout;
      },
    };
    const err = await callModel("demo", llm, loaded(), rendered, {
      tools: [],
      errorContext: "while testing",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentExecutionError);
    expect((err as Error).message).toContain("LLM provider error while testing");
    expect((err as Error).cause).toBe(timeout);
  });

  test("a turn still paused at the round cap is MaxToolRoundsExceededError", async () => {
    const llm: LLMProvider = {
      name: "paused",
      acceptsSystemPrompt: true,
      async complete() {
        return "";
      },
      async completeWithTools() {
        return { text: "", tool_calls: [], rounds: 2, stop_reason: "pause_turn" };
      },
    };
    await expect(
      callModel("demo", llm, loaded(), rendered, {
        tools: [{ type: "web_search", name: "web_search" }],
        maxToolRounds: 2,
      })
    ).rejects.toBeInstanceOf(MaxToolRoundsExceededError);
  });
});

describe("retrieval time", () => {
  const reader = outputReader("research");
  const at = new Date("2026-11-02T10:00:00.000Z");

  test("a source without accessed_at parses, then gets the call's time", () => {
    const parsed = reader.parseSource(
      { url: "https://www.destatis.de/x", title: "Destatis", excerpt: "GDP rose 0.2%" },
      "findings[0].source",
      "raw"
    );
    const result = stampRetrievalTime({ findings: [{ source: parsed }] }, at);
    expect(result.findings[0]!.source).toEqual({
      url: "https://www.destatis.de/x",
      title: "Destatis",
      accessed_at: "2026-11-02T10:00:00.000Z",
      excerpt: "GDP rose 0.2%",
    });
  });

  test("a timestamp already present and SOURCE_MISSING markers are left alone", () => {
    const result = stampRetrievalTime(
      {
        a: { url: "https://x.example", title: "t", accessed_at: "2026-10-01T00:00:00Z", excerpt: "" },
        b: { status: "SOURCE_MISSING", searched_for: "q" },
      },
      at
    );
    expect(result.a.accessed_at).toBe("2026-10-01T00:00:00Z");
    expect(result.b).toEqual({ status: "SOURCE_MISSING", searched_for: "q" });
  });

  test("a non-string accessed_at is still rejected", () => {
    expect(() =>
      reader.parseSource(
        { url: "https://x.example", title: "t", accessed_at: 20261102, excerpt: "" },
        "findings[0].source",
        "raw"
      )
    ).toThrow("findings[0].source.accessed_at must be an ISO 8601 string when present");
  });
});

describe("source URLs (OWASP LLM05)", () => {
  const reader = outputReader("research");
  const source = (url: string) => ({ url, title: "t", excerpt: "" });

  // A model steered by a page it searched can cite any string as a URL; the
  // Markdown briefing turns it into a link the reader clicks.
  test.each([
    "javascript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "www.destatis.de/x",
    "not a url",
  ])("refuses %p", (url) => {
    expect(() => reader.parseSource(source(url), "findings[0].source", "raw")).toThrow(
      "findings[0].source.url must be an absolute http(s) URL"
    );
  });

  test.each(["https://www.destatis.de/x?y=1#z", "http://example.org/a_(b)"])("accepts %p", (url) => {
    expect(reader.parseSource(source(url), "findings[0].source", "raw")).toMatchObject({ url });
  });
});

describe("terminal control characters in an answer (OWASP LLM05)", () => {
  // JSON can carry ESC and other control characters as \u escapes; parsed,
  // they reach the terminal the CLI prints to (colours, hidden text, links).
  const loaded = () => loadPrompt("demo", writePrompt(PROMPT), "demo");
  const answering = (text: string): LLMProvider => ({
    name: "plain",
    acceptsSystemPrompt: true,
    async complete() {
      return text;
    },
  });

  test.each([
    ["ESC", '{"claim": "a \\u001b[31mred\\u001B[0m b"}'],
    ["CSI (C1)", '{"claim": "a \\u009b31m b"}'],
    ["BEL and backspace", '{"claim": "a \\u0007\\u0008 b"}'],
    ["DEL", '{"claim": "a \\u007f b"}'],
  ])("%s escapes parse to U+FFFD", async (_label, answer) => {
    const out = await callModel("demo", answering(answer), loaded(), { system: "SYS", user: "U" }, { tools: [] });
    const claim = (JSON.parse(out.text) as { claim: string }).claim;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the test asserts these characters are absent.
    expect(claim).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/);
    expect(claim).toContain("�");
  });

  test("a raw control character inside a string parses to U+FFFD", async () => {
    const out = await callModel("demo", answering('{"claim": "a \u001b[31m b"}'), loaded(), { system: "SYS", user: "U" }, { tools: [] });
    expect((JSON.parse(out.text) as { claim: string }).claim).toBe("a \ufffd[31m b");
  });

  test("tab, newline, an escaped backslash before u, and ordinary escapes are kept", async () => {
    const answer = '{"claim": "a\\tb\\nc \\\\u001b \\u00e9"}';
    const out = await callModel("demo", answering(answer), loaded(), { system: "SYS", user: "U" }, { tools: [] });
    expect((JSON.parse(out.text) as { claim: string }).claim).toBe("a\tb\nc \\u001b é");
  });
});

describe("output reader refusals name the field and the rule", () => {
  const reader = outputReader("research");
  const source = { url: "https://x.example/a", title: "t", excerpt: "" };

  test.each([
    [{ v: "" }, "x.v must be a non-empty string"],
    [{ v: 5 }, "x.v must be a non-empty string"],
    [{}, "x.v must be a non-empty string"],
  ])("requireNonEmptyString refuses %j", (obj, message) => {
    expect(() => reader.requireNonEmptyString(obj, "v", "x.v", "raw")).toThrow(message);
  });

  test("requireNonEmptyString returns the string it accepts", () => {
    expect(reader.requireNonEmptyString({ v: "ok" }, "v", "x.v", "raw")).toBe("ok");
  });

  test("requireEnum refuses a value outside the list, and names the list", () => {
    expect(() => reader.requireEnum({ v: "huge" }, "v", ["low", "high"], "x.v", "raw")).toThrow(
      "x.v must be one of low|high"
    );
    expect(() => reader.requireEnum({ v: 1 }, "v", ["low", "high"], "x.v", "raw")).toThrow("x.v must be one of");
    expect(reader.requireEnum({ v: "low" }, "v", ["low", "high"], "x.v", "raw")).toBe("low");
  });

  test.each([
    ["a string", "https://x.example", "s must be an object"],
    ["null", null, "s must be an object"],
    ["an array", [source], "s must be an object"],
    ["an empty url", { ...source, url: "" }, "s.url must be a non-empty string (or use SOURCE_MISSING)"],
    ["a numeric url", { ...source, url: 5 }, "s.url must be a non-empty string (or use SOURCE_MISSING)"],
    ["an empty title", { ...source, title: "" }, "s.title must be a non-empty string"],
    ["a numeric accessed_at", { ...source, accessed_at: 1 }, "s.accessed_at must be an ISO 8601 string when present"],
    ["a missing excerpt", { url: source.url, title: "t" }, "s.excerpt must be a string"],
  ])("parseSource refuses %s with its own message", (_label, value, message) => {
    expect(() => reader.parseSource(value, "s", "raw")).toThrow(message);
  });
});
