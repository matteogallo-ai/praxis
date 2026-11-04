/**
 * docs/live-proof-protocol.md split at "## Amendments": the plan as first
 * written, then the dated changes to it. Tests that check the plan read only
 * the first part, so an amendment never passes for a rewrite of the plan.
 */
import { readFileSync } from "node:fs";

export function protocolParts(path = "docs/live-proof-protocol.md"): { doc: string; plan: string; amendments: string } {
  const doc = readFileSync(path, "utf-8");
  const at = doc.indexOf("\n## Amendments\n");
  return at === -1 ? { doc, plan: doc, amendments: "" } : { doc, plan: doc.slice(0, at), amendments: doc.slice(at) };
}
