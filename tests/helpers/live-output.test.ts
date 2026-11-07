import { describe, expect, test } from "bun:test";
import { rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";

import { liveOutputDir } from "./live-output.ts";

describe("liveOutputDir", () => {
  test("creates a fresh directory under the temp dir that only this user can open", () => {
    const a = liveOutputDir("x");
    const b = liveOutputDir("x");
    try {
      expect(a).not.toBe(b);
      expect(a.startsWith(tmpdir())).toBe(true);
      expect(statSync(a).isDirectory()).toBe(true);
      expect(statSync(a).mode & 0o077).toBe(0);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});
