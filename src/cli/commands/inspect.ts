import { loadRegistry } from "../../registry/registry.ts";
import { c, renderBullet, renderKeyValue, renderSectionHeader } from "../output.ts";
import type { Format } from "../../registry/schema.ts";

export interface InspectArgs {
  formatsDir: string;
  id: string;
}

export function inspectCommand(args: InspectArgs): number {
  const registry = loadRegistry(args.formatsDir);
  const format = registry.get(args.id);
  process.stdout.write(renderFormat(format) + "\n");
  return 0;
}

export function renderFormat(f: Format): string {
  const parts: string[] = [];

  parts.push(c.bold(c.magenta(`${f.name}  `)) + c.dim(`(${f.id} v${f.version})`));

  parts.push(renderSectionHeader("Metadata"));
  parts.push(renderKeyValue("author", f.metadata.author));
  parts.push(renderKeyValue("organization_style", f.metadata.organization_style));
  parts.push(renderKeyValue("language", f.metadata.language));
  parts.push(renderKeyValue("last_reviewed", f.metadata.last_reviewed));

  parts.push(renderSectionHeader("Target Length"));
  parts.push(renderKeyValue("pages", String(f.target_length.pages)));
  parts.push(renderKeyValue("words", String(f.target_length.words)));

  parts.push(renderSectionHeader("Sections"));
  for (const s of f.sections) {
    parts.push(c.bold("  " + s.title) + c.dim(`  (${s.id}, ${s.max_length.words}w)`));
    parts.push(`    ${c.dim("purpose:")} ${s.purpose}`);
    parts.push(`    ${c.dim("tone:")}    ${s.tone_directives}`);
    parts.push(
      `    ${c.dim("agents:")}  ${s.required_agents.join(", ")}`
    );
    if (s.validation_rules && s.validation_rules.length > 0) {
      parts.push(`    ${c.dim("rules:")}`);
      for (const r of s.validation_rules) parts.push(`      ${c.dim("-")} ${r}`);
    }
    parts.push("");
  }

  parts.push(renderSectionHeader("Style Guide"));
  parts.push(renderKeyValue("voice", f.style_guide.voice));
  parts.push(renderKeyValue("sentence_structure", f.style_guide.sentence_structure));
  parts.push(renderKeyValue("forbidden_terms", ""));
  for (const t of f.style_guide.forbidden_terms) parts.push(renderBullet(t));

  parts.push(renderSectionHeader("Sourcing & Output"));
  parts.push(renderKeyValue("sourcing_policy", f.sourcing_policy));
  if (f.sourcing_rules !== undefined) {
    const r = f.sourcing_rules;
    if (r.freshness !== undefined) {
      parts.push(
        renderKeyValue(
          "freshness",
          `max ${r.freshness.max_source_age_days}d / warn ${r.freshness.warn_after_days}d`
        )
      );
    }
    if (r.domain_trust !== undefined) {
      parts.push(renderKeyValue("domain_trust.mode", r.domain_trust.mode));
      if (r.domain_trust.mode === "allow-list") {
        parts.push(
          renderKeyValue(
            "domain_trust.allow_list",
            `${(r.domain_trust.allow_list ?? []).length} entries`
          )
        );
      } else if (r.domain_trust.mode === "deny-list") {
        parts.push(
          renderKeyValue(
            "domain_trust.deny_list",
            `${(r.domain_trust.deny_list ?? []).length} entries`
          )
        );
      } else if (r.domain_trust.mode === "reputation-only") {
        const t = r.domain_trust.reputation_tiers;
        if (t !== undefined) {
          parts.push(
            renderKeyValue(
              "domain_trust.tiers",
              `${t.tier_1.length}/${t.tier_2.length}/${t.tier_3.length} (min_tier ${t.min_tier})`
            )
          );
        }
      }
    }
    if (r.dedupe !== undefined) {
      parts.push(
        renderKeyValue(
          "dedupe",
          `cross_agent=${r.dedupe.cross_agent}, similarity=${r.dedupe.similarity_threshold}`
        )
      );
    }
  }
  parts.push(renderKeyValue("output_targets", f.output_targets.join(", ")));

  return parts.join("\n");
}
