import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string | undefined;

/**
 * The mock fixtures with a publication date on every research, stakeholder
 * and risk source: the day it was read. The shipped fixtures carry none, as
 * a model that states no date would, so their freshness is unknown; tests
 * about the clock ageing sources need dated ones. The shipped files are left
 * as they are because the committed token counts are measured on them.
 */
export function datedMockFixtures(): string {
  if (dir !== undefined) return dir;
  const out = mkdtempSync(join(tmpdir(), "praxis-dated-fixtures-"));
  cpSync("tests/fixtures/mock-llm", out, { recursive: true });
  for (const name of readdirSync(out).filter((f) => /^(research|stakeholders|risks)-.*\.json$/.test(f))) {
    const path = join(out, name);
    const text = readFileSync(path, "utf-8").replace(
      /(\\"accessed_at\\": \\"(\d{4}-\d{2}-\d{2})T[^\\"]*\\")/g,
      '$1, \\"published_at\\": \\"$2\\"'
    );
    writeFileSync(path, text);
  }
  dir = out;
  return out;
}
