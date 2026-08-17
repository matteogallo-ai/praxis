import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeResearch } from "../../src/agents/research.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
  MaxToolRoundsExceededError,
} from "../../src/agents/errors.ts";
import { ToolUseNotSupportedError } from "../../src/llm/errors.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { CompletionResult, Tool } from "../../src/llm/types.ts";
import type { ResearchContext } from "../../src/agents/types.ts";
import { isSourceMissing } from "../../src/sourcing/types.ts";

const CTX: ResearchContext = {
  scoping: {
    reformulated_question: "Should we enter Germany?",
    hidden_questions: ["at what cost?", "with what team?"],
    scope_boundaries: ["Germany only"],
    assumptions_to_validate: ["unit economics survive"],
  },
  formatId: "executive-pre-read",
  sourcingPolicy: "strict",
  targetWords: 800,
};

const VALID_RESPONSE = JSON.stringify({
  findings: [
    {
      claim: "German SaaS grew 12% CAGR.",
      supporting_evidence: "Bitkom 2026 report.",
      source: {
        url: "https://a.example",
        title: "A",
        accessed_at: "2026-08-17T09:00:00Z",
        excerpt: "German B2B SaaS grew 12% CAGR.",
      },
    },
  ],
  open_questions: ["with what team?"],
  search_queries_used: ["german saas cagr 2025"],
});

function fixedToolsProvider(result: Partial<CompletionResult>): LLMProvider {
  const completion: CompletionResult = {
    text: result.text ?? VALID_RESPONSE,
    tool_calls: result.tool_calls ?? [],
    rounds: result.rounds ?? 1,
    stop_reason: result.stop_reason ?? "end_turn",
  };
  return {
    name: "fixed-tools",
    async complete(_p: string): Promise<string> {
      return completion.text;
    },
    async completeWithTools(_p: string, _t: Tool[]): Promise<CompletionResult> {
      return completion;
    },
  };
}

function capturingToolsProvider(response: string): {
  provider: LLMProvider;
  seen: { prompt: string | null; tools: Tool[] | null };
} {
  const seen: { prompt: string | null; tools: Tool[] | null } = {
    prompt: null,
    tools: null,
  };
  const provider: LLMProvider = {
    name: "capturing-tools",
    async complete(_p: string): Promise<string> {
      return response;
    },
    async completeWithTools(prompt: string, tools: Tool[]): Promise<CompletionResult> {
      seen.prompt = prompt;
      seen.tools = tools;
      return { text: response, tool_calls: [], rounds: 1, stop_reason: "end_turn" };
    },
  };
  return { provider, seen };
}

describe("executeResearch — nominal flow", () => {
  test("returns a ResearchResult when the LLM answers valid JSON", async () => {
    const result = await executeResearch(CTX, fixedToolsProvider({}));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.claim).toBe("German SaaS grew 12% CAGR.");
    expect(result.open_questions).toEqual(["with what team?"]);
    expect(result.search_queries_used).toEqual(["german saas cagr 2025"]);
  });

  test("interpolates all four parameters into the prompt", async () => {
    const { provider, seen } = capturingToolsProvider(VALID_RESPONSE);
    await executeResearch(CTX, provider);
    const p = seen.prompt!;
    expect(p).toContain("executive-pre-read");
    expect(p).toContain("strict");
    expect(p).toContain("800");
    expect(p).toContain("Should we enter Germany?");
    expect(p).not.toContain("{{format_id}}");
    expect(p).not.toContain("{{sourcing_policy}}");
    expect(p).not.toContain("{{target_words}}");
    expect(p).not.toContain("{{scoping_json}}");
  });

  test("passes the web_search tool to the LLM", async () => {
    const { provider, seen } = capturingToolsProvider(VALID_RESPONSE);
    await executeResearch(CTX, provider);
    expect(seen.tools).toEqual([{ type: "web_search", name: "web_search" }]);
  });

  test("tolerates fenced ```json``` responses", async () => {
    const fenced = "```json\n" + VALID_RESPONSE + "\n```";
    const result = await executeResearch(CTX, fixedToolsProvider({ text: fenced }));
    expect(result.findings).toHaveLength(1);
  });

  test("parses SOURCE_MISSING findings as-is (no fabrication)", async () => {
    const body = JSON.stringify({
      findings: [
        {
          claim: "Something without an internet-searchable source.",
          supporting_evidence: "Inference from analyst network.",
          source: { status: "SOURCE_MISSING", searched_for: "obscure private data" },
        },
      ],
      open_questions: [],
      search_queries_used: ["obscure private data"],
    });
    const result = await executeResearch(CTX, fixedToolsProvider({ text: body }));
    expect(result.findings).toHaveLength(1);
    expect(isSourceMissing(result.findings[0]!.source)).toBe(true);
  });

  test("integrates end-to-end with MockLLMProvider and the shipped research fixture", async () => {
    const provider = new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" });
    const result = await executeResearch(CTX, provider);
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    for (const f of result.findings) {
      expect(f.claim.length).toBeGreaterThan(0);
      if (!isSourceMissing(f.source)) {
        expect(f.source.url.startsWith("http")).toBe(true);
      }
    }
    expect(result.search_queries_used.length).toBeGreaterThanOrEqual(3);
  });
});

describe("executeResearch — provider capability", () => {
  test("throws ToolUseNotSupportedError when the provider lacks completeWithTools", async () => {
    const badProvider: LLMProvider = {
      name: "text-only",
      async complete(_p: string): Promise<string> {
        return VALID_RESPONSE;
      },
    };
    await expect(executeResearch(CTX, badProvider)).rejects.toBeInstanceOf(
      ToolUseNotSupportedError
    );
  });
});

describe("executeResearch — tool-use loop", () => {
  test("throws MaxToolRoundsExceededError when the provider pauses at the cap", async () => {
    const badProvider: LLMProvider = {
      name: "always-pauses",
      async complete(_p: string): Promise<string> {
        return VALID_RESPONSE;
      },
      async completeWithTools(_p: string, _t: Tool[]): Promise<CompletionResult> {
        return {
          text: "",
          tool_calls: [{ id: "1", name: "web_search", input: { query: "x" } }],
          rounds: 5,
          stop_reason: "pause_turn",
        };
      },
    };
    await expect(
      executeResearch(CTX, badProvider, { maxToolRounds: 5 })
    ).rejects.toBeInstanceOf(MaxToolRoundsExceededError);
  });
});

describe("executeResearch — LLM output errors", () => {
  test("throws InvalidAgentOutputError on non-JSON output", async () => {
    await expect(
      executeResearch(CTX, fixedToolsProvider({ text: "not json at all" }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when top-level JSON is an array", async () => {
    await expect(
      executeResearch(CTX, fixedToolsProvider({ text: "[]" }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when findings is missing", async () => {
    const bad = JSON.stringify({ open_questions: [], search_queries_used: [] });
    await expect(
      executeResearch(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when a finding claim is empty", async () => {
    const bad = JSON.stringify({
      findings: [
        {
          claim: "",
          supporting_evidence: "e",
          source: {
            url: "https://x",
            title: "T",
            accessed_at: "2026-08-17T00:00:00Z",
            excerpt: "e",
          },
        },
      ],
      open_questions: [],
      search_queries_used: [],
    });
    await expect(
      executeResearch(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when a source is missing url and is not SOURCE_MISSING", async () => {
    const bad = JSON.stringify({
      findings: [
        {
          claim: "c",
          supporting_evidence: "e",
          source: { title: "T", accessed_at: "2026-08-17T00:00:00Z", excerpt: "e" },
        },
      ],
      open_questions: [],
      search_queries_used: [],
    });
    await expect(
      executeResearch(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when SOURCE_MISSING lacks searched_for", async () => {
    const bad = JSON.stringify({
      findings: [
        {
          claim: "c",
          supporting_evidence: "e",
          source: { status: "SOURCE_MISSING" },
        },
      ],
      open_questions: [],
      search_queries_used: [],
    });
    await expect(
      executeResearch(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("throws when excerpt exceeds 500 characters", async () => {
    const longExcerpt = "x".repeat(501);
    const bad = JSON.stringify({
      findings: [
        {
          claim: "c",
          supporting_evidence: "e",
          source: {
            url: "https://x",
            title: "T",
            accessed_at: "2026-08-17T00:00:00Z",
            excerpt: longExcerpt,
          },
        },
      ],
      open_questions: [],
      search_queries_used: [],
    });
    await expect(
      executeResearch(CTX, fixedToolsProvider({ text: bad }))
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
  });

  test("wraps LLM provider errors as AgentExecutionError", async () => {
    const badProvider: LLMProvider = {
      name: "boom",
      async complete(_p: string): Promise<string> {
        throw new Error("network");
      },
      async completeWithTools(): Promise<CompletionResult> {
        throw new Error("network unreachable");
      },
    };
    let caught: unknown;
    try {
      await executeResearch(CTX, badProvider);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgentExecutionError);
    expect((caught as AgentExecutionError).message).toContain("network unreachable");
  });
});

describe("executeResearch — prompt file errors", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "praxis-research-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("PromptFileError when the prompt file is absent", async () => {
    await expect(
      executeResearch(CTX, fixedToolsProvider({}), {
        promptPath: join(tmp, "missing.prompt"),
      })
    ).rejects.toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the file lacks a 'research' prompt", async () => {
    const p = join(tmp, "wrong-name.prompt");
    writeFileSync(
      p,
      `@version "1.0.0"\n` +
        `prompt other(x: string) -> string {\n` +
        `  system: "s"\n` +
        `  user: "u {{x}}"\n` +
        `  output: string\n` +
        `}\n`
    );
    await expect(
      executeResearch(CTX, fixedToolsProvider({}), { promptPath: p })
    ).rejects.toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the prompt lacks required parameters", async () => {
    const p = join(tmp, "missing-params.prompt");
    writeFileSync(
      p,
      `@version "1.0.0"\n` +
        `prompt research(format_id: string) -> string {\n` +
        `  system: "s"\n` +
        `  user: "u {{format_id}}"\n` +
        `  output: string\n` +
        `}\n`
    );
    await expect(
      executeResearch(CTX, fixedToolsProvider({}), { promptPath: p })
    ).rejects.toBeInstanceOf(PromptFileError);
  });
});
