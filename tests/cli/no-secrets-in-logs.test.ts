/**
 * No secret or personal data in what Praxis logs (stderr, run files).
 *
 * The API key must not appear in stderr, in metadata.json or checkpoints,
 * nor when the provider object itself is printed or serialised. Home
 * directory paths and e-mail addresses in stderr are masked.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/cli/index.ts";
import { redactSecrets } from "../../src/cli/redact.ts";
import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { setColorEnabled } from "../../src/cli/output.ts";

const KEY = "sk-ant-api03-TESTSECRET-abcdefghijklmnop";

let err: string[];
let savedWrite: typeof process.stderr.write;
let savedOut: typeof process.stdout.write;
let savedKey: string | undefined;

beforeEach(() => {
  setColorEnabled(false);
  err = [];
  savedWrite = process.stderr.write;
  savedOut = process.stdout.write;
  process.stderr.write = ((chunk: unknown) =>
    err.push(chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : String(chunk)) > 0) as typeof process.stderr.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  savedKey = process.env["ANTHROPIC_API_KEY"];
  process.env["ANTHROPIC_API_KEY"] = KEY;
});

afterEach(() => {
  process.stderr.write = savedWrite;
  process.stdout.write = savedOut;
  if (savedKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
  else process.env["ANTHROPIC_API_KEY"] = savedKey;
});

describe("the API key", () => {
  test("is not in the provider when printed or serialised", () => {
    const p = new AnthropicLLMProvider({ apiKey: KEY, fetchFn: async () => new Response("{}") });
    expect(JSON.stringify(p)).not.toContain(KEY);
    expect(Bun.inspect(p)).not.toContain(KEY);
    expect(String(Object.values(p))).not.toContain(KEY);
  });

  test("is not in stderr when an error message carries it", async () => {
    // An unknown command is echoed back; a key pasted in its place must not reach the log.
    const code = await run([KEY]);
    expect(code).toBe(1);
    expect(err.join("")).not.toContain(KEY);
    expect(err.join("")).toContain("Unknown command: [redacted]");
  });

  test("is not in stderr, metadata.json or checkpoints of a full run", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const code = await run([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
      "--runs-dir",
      runsDir,
    ]);
    expect(code).toBe(0);
    expect(err.join("")).not.toContain(KEY);
    const dir = join(runsDir, readdirSync(runsDir)[0]!);
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file), "utf-8")).not.toContain(KEY);
    }
  });
});

describe("redactSecrets", () => {
  test("masks keys, auth headers, e-mail addresses and the home directory", () => {
    const text = [
      `key ${KEY}`,
      `"x-api-key": "abcd1234efgh"`,
      "contact jane.doe@example.com",
      `file ${join(homedir(), "dev", "praxis")}`,
    ].join("\n");
    const out = redactSecrets(text);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("abcd1234efgh");
    expect(out).not.toContain("jane.doe@example.com");
    expect(out).not.toContain(homedir());
    expect(out).toContain(join("~", "dev", "praxis"));
  });

  test("the live key from the environment is masked whatever its shape", () => {
    expect(redactSecrets("token=custom-key-1234567", { ANTHROPIC_API_KEY: "custom-key-1234567" })).toBe(
      "token=[redacted]"
    );
  });
});

describe("redaction: review findings", () => {
  test("a Bearer token after Authorization is masked whole", () => {
    expect(redactSecrets("Authorization: Bearer abc.def.ghi123")).toBe("Authorization: [redacted]");
  });

  test("a Buffer written to stderr is redacted too", async () => {
    const { withRedactedStderr } = await import("../../src/cli/redact.ts");
    await withRedactedStderr(async () => {
      process.stderr.write(new TextEncoder().encode(`key ${KEY}\n`));
    });
    expect(err.join("")).not.toContain(KEY);
  });
});
