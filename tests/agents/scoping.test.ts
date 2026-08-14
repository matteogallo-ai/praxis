import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeScoping } from "../../src/agents/scoping.ts";
import {
  AgentExecutionError,
  InvalidAgentOutputError,
  PromptFileError,
} from "../../src/agents/errors.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { AgentContext } from "../../src/agents/types.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";

const CTX: AgentContext = {
  question: "Should we enter the German market?",
  formatId: "executive-pre-read",
  targetWords: 800,
};

function fixedProvider(response: string): LLMProvider {
  return {
    name: "fixed",
    async complete(_prompt: string): Promise<string> {
      return response;
    },
  };
}

function capturingProvider(response: string): {
  provider: LLMProvider;
  seen: { prompt: string | null };
} {
  const seen: { prompt: string | null } = { prompt: null };
  const provider: LLMProvider = {
    name: "capturing",
    async complete(prompt: string): Promise<string> {
      seen.prompt = prompt;
      return response;
    },
  };
  return { provider, seen };
}

const VALID_RESPONSE = JSON.stringify({
  reformulated_question: "Reformulated Q.",
  hidden_questions: ["h1", "h2"],
  scope_boundaries: ["b1"],
  assumptions_to_validate: ["a1", "a2"],
});

describe("executeScoping — nominal flow", () => {
  test("returns a fully populated ScopingResult when the LLM answers valid JSON", async () => {
    const result = await executeScoping(CTX, fixedProvider(VALID_RESPONSE));
    expect(result.reformulated_question).toBe("Reformulated Q.");
    expect(result.hidden_questions).toEqual(["h1", "h2"]);
    expect(result.scope_boundaries).toEqual(["b1"]);
    expect(result.assumptions_to_validate).toEqual(["a1", "a2"]);
  });

  test("interpolates {{question}}, {{format_id}}, {{target_words}} into the prompt", async () => {
    const { provider, seen } = capturingProvider(VALID_RESPONSE);
    await executeScoping(CTX, provider);
    expect(seen.prompt).not.toBeNull();
    const p = seen.prompt!;
    expect(p).toContain("Should we enter the German market?");
    expect(p).toContain("executive-pre-read");
    expect(p).toContain("800");
    expect(p).not.toContain("{{question}}");
    expect(p).not.toContain("{{format_id}}");
    expect(p).not.toContain("{{target_words}}");
  });

  test("prompt concatenates system, separator, user in that order", async () => {
    const { provider, seen } = capturingProvider(VALID_RESPONSE);
    await executeScoping(CTX, provider);
    const p = seen.prompt!;
    const systemIdx = p.indexOf("You are the Scoping analyst");
    const userIdx = p.indexOf("Briefing format:");
    expect(systemIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeGreaterThan(systemIdx);
    expect(p).toContain("---");
  });

  test("integrates end-to-end with MockLLMProvider and the real scoping fixture", async () => {
    const provider = new MockLLMProvider({
      fixturesDir: "tests/fixtures/mock-llm",
    });
    const result = await executeScoping(CTX, provider);
    expect(result.reformulated_question.length).toBeGreaterThan(20);
    expect(result.hidden_questions.length).toBeGreaterThanOrEqual(3);
    expect(result.scope_boundaries.length).toBeGreaterThanOrEqual(2);
    expect(result.assumptions_to_validate.length).toBeGreaterThanOrEqual(2);
  });

  test("tolerates ```json ... ``` fenced responses from the LLM", async () => {
    const fenced = "```json\n" + VALID_RESPONSE + "\n```";
    const result = await executeScoping(CTX, fixedProvider(fenced));
    expect(result.reformulated_question).toBe("Reformulated Q.");
  });

  test("tolerates a bare ``` ... ``` fence", async () => {
    const fenced = "```\n" + VALID_RESPONSE + "\n```";
    const result = await executeScoping(CTX, fixedProvider(fenced));
    expect(result.reformulated_question).toBe("Reformulated Q.");
  });
});

describe("executeScoping — LLM output errors", () => {
  test("throws InvalidAgentOutputError on non-JSON output", async () => {
    let caught: unknown;
    try {
      await executeScoping(CTX, fixedProvider("not json at all"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidAgentOutputError);
    expect((caught as InvalidAgentOutputError).rawOutput).toBe("not json at all");
  });

  test("throws when top-level JSON is an array", async () => {
    await expect(executeScoping(CTX, fixedProvider("[]"))).rejects.toBeInstanceOf(
      InvalidAgentOutputError
    );
  });

  test("throws when reformulated_question is missing", async () => {
    const bad = JSON.stringify({
      hidden_questions: ["h"],
      scope_boundaries: ["b"],
      assumptions_to_validate: ["a"],
    });
    await expect(executeScoping(CTX, fixedProvider(bad))).rejects.toBeInstanceOf(
      InvalidAgentOutputError
    );
  });

  test("throws when reformulated_question is empty", async () => {
    const bad = JSON.stringify({
      reformulated_question: "",
      hidden_questions: ["h"],
      scope_boundaries: ["b"],
      assumptions_to_validate: ["a"],
    });
    await expect(executeScoping(CTX, fixedProvider(bad))).rejects.toBeInstanceOf(
      InvalidAgentOutputError
    );
  });

  test("throws when hidden_questions is not an array", async () => {
    const bad = JSON.stringify({
      reformulated_question: "Q",
      hidden_questions: "not-an-array",
      scope_boundaries: ["b"],
      assumptions_to_validate: ["a"],
    });
    await expect(executeScoping(CTX, fixedProvider(bad))).rejects.toBeInstanceOf(
      InvalidAgentOutputError
    );
  });

  test("throws when a string-array entry is empty", async () => {
    const bad = JSON.stringify({
      reformulated_question: "Q",
      hidden_questions: ["", "h2"],
      scope_boundaries: ["b"],
      assumptions_to_validate: ["a"],
    });
    await expect(executeScoping(CTX, fixedProvider(bad))).rejects.toBeInstanceOf(
      InvalidAgentOutputError
    );
  });

  test("throws when an array contains a non-string", async () => {
    const bad = JSON.stringify({
      reformulated_question: "Q",
      hidden_questions: ["h1", 42],
      scope_boundaries: ["b"],
      assumptions_to_validate: ["a"],
    });
    await expect(executeScoping(CTX, fixedProvider(bad))).rejects.toBeInstanceOf(
      InvalidAgentOutputError
    );
  });

  test("wraps LLM provider errors as AgentExecutionError", async () => {
    const badProvider: LLMProvider = {
      name: "boom",
      async complete(): Promise<string> {
        throw new Error("network unreachable");
      },
    };
    let caught: unknown;
    try {
      await executeScoping(CTX, badProvider);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgentExecutionError);
    expect((caught as AgentExecutionError).message).toContain("network unreachable");
  });
});

describe("executeScoping — prompt file errors", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "praxis-scoping-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("PromptFileError when the prompt file is absent", async () => {
    await expect(
      executeScoping(CTX, fixedProvider(VALID_RESPONSE), {
        promptPath: join(tmp, "missing.prompt"),
      })
    ).rejects.toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the file is not valid PromptLang", async () => {
    const p = join(tmp, "broken.prompt");
    writeFileSync(p, "@version \"1.0.0\"\nnot a prompt");
    await expect(
      executeScoping(CTX, fixedProvider(VALID_RESPONSE), { promptPath: p })
    ).rejects.toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the file has no 'scope' prompt declaration", async () => {
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
      executeScoping(CTX, fixedProvider(VALID_RESPONSE), { promptPath: p })
    ).rejects.toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when the prompt lacks required parameters", async () => {
    const p = join(tmp, "missing-params.prompt");
    writeFileSync(
      p,
      `@version "1.0.0"\n` +
        `prompt scope(question: string) -> string {\n` +
        `  system: "s"\n` +
        `  user: "u {{question}}"\n` +
        `  output: string\n` +
        `}\n`
    );
    await expect(
      executeScoping(CTX, fixedProvider(VALID_RESPONSE), { promptPath: p })
    ).rejects.toBeInstanceOf(PromptFileError);
  });

  test("PromptFileError when a section references an undeclared placeholder", async () => {
    const p = join(tmp, "orphan.prompt");
    writeFileSync(
      p,
      `@version "1.0.0"\n` +
        `prompt scope(question: string, format_id: string, target_words: number) -> string {\n` +
        `  system: "s"\n` +
        `  user: "hello {{mystery}}"\n` +
        `  output: string\n` +
        `}\n`
    );
    await expect(
      executeScoping(CTX, fixedProvider(VALID_RESPONSE), { promptPath: p })
    ).rejects.toBeInstanceOf(PromptFileError);
  });
});
