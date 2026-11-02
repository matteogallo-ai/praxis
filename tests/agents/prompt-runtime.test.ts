import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { callModel, loadPrompt, renderPrompt } from "../../src/agents/prompt-runtime.ts";
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
    expect(rendered.system).toBe("You are a careful analyst.");
    expect(rendered.user).toBe("Topic: Germany");
  });
});

describe("callModel", () => {
  const loaded = () => loadPrompt("demo", writePrompt(PROMPT), "demo");
  const rendered = { system: "SYS", user: "USER" };

  test("sends system and user separately, with the prompt's @model", async () => {
    const { llm, seen } = recordingProvider(true);
    await callModel("demo", llm, loaded(), rendered, { tools: [] });
    expect(seen[0]!.prompt).toBe("USER");
    expect(seen[0]!.options).toEqual({ system: "SYS", model: "claude-haiku-5-5" });
  });

  test("with tools, the same placement goes through completeWithTools", async () => {
    const { llm, seen } = recordingProvider(true);
    const tools = [{ type: "web_search", name: "web_search" }];
    await callModel("demo", llm, loaded(), rendered, { tools, maxToolRounds: 3 });
    expect(seen[0]!.tools).toEqual(tools);
    expect(seen[0]!.options).toEqual({
      system: "SYS",
      model: "claude-haiku-5-5",
      max_tool_rounds: 3,
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
    expect(seen[0]!.options).toEqual({ model: "claude-haiku-5-5" });
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
