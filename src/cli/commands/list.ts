import { loadRegistry } from "../../registry/registry.ts";
import { isOrganizationStyle, ORGANIZATION_STYLES } from "../../registry/schema.ts";
import type { OrganizationStyle } from "../../registry/schema.ts";
import { c, renderTable } from "../output.ts";

export interface ListArgs {
  formatsDir: string;
  orgStyle?: OrganizationStyle;
}

export function listCommand(args: ListArgs): number {
  const registry = loadRegistry(args.formatsDir);
  const formats = args.orgStyle
    ? registry.filterByOrgStyle(args.orgStyle)
    : registry.list();

  if (formats.length === 0) {
    const scope = args.orgStyle
      ? ` for organization style '${args.orgStyle}'`
      : "";
    process.stdout.write(c.yellow(`No formats registered${scope}.\n`));
    return 0;
  }

  const rows = formats.map((f) => ({
    id: f.id,
    name: f.name,
    org: f.metadata.organization_style,
    lang: f.metadata.language,
    pages: String(f.target_length.pages),
    version: f.version,
  }));

  const table = renderTable(
    [
      { header: "ID", key: "id" },
      { header: "Name", key: "name" },
      { header: "Org Style", key: "org" },
      { header: "Language", key: "lang" },
      { header: "Pages", key: "pages" },
      { header: "Version", key: "version" },
    ],
    rows
  );

  process.stdout.write(table + "\n");
  process.stdout.write(
    c.dim(`\n${formats.length} format${formats.length === 1 ? "" : "s"} registered.\n`)
  );
  return 0;
}

/**
 * Parse the optional `--org-style <value>` flag out of the residual argv
 * (i.e. after `formats list` has been shifted off). Returns the org style
 * or `null` if the flag is absent. Throws if the value is unknown.
 */
export function parseOrgStyleFlag(argv: readonly string[]): OrganizationStyle | null {
  const idx = argv.indexOf("--org-style");
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (value === undefined) {
    throw new Error("--org-style flag requires a value");
  }
  if (!isOrganizationStyle(value)) {
    throw new Error(
      `--org-style must be one of [${ORGANIZATION_STYLES.join(", ")}], got '${value}'`
    );
  }
  return value;
}
