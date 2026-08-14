/**
 * Terminal output helpers — raw ANSI, zero dependencies.
 *
 * Colours are automatically disabled when:
 *   - NO_COLOR is set (https://no-color.org/), OR
 *   - stdout is not a TTY (piped, redirected).
 *
 * Test suites can force colour off explicitly by calling `setColorEnabled(false)`.
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const FG_RED = "\x1b[31m";
const FG_GREEN = "\x1b[32m";
const FG_YELLOW = "\x1b[33m";
const FG_BLUE = "\x1b[34m";
const FG_MAGENTA = "\x1b[35m";
const FG_CYAN = "\x1b[36m";

let colorEnabled = detectColor();

function detectColor(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env["NO_COLOR"] !== undefined && process.env["NO_COLOR"] !== "") {
    return false;
  }
  return Boolean(process.stdout?.isTTY);
}

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

function wrap(code: string, s: string): string {
  return colorEnabled ? `${code}${s}${RESET}` : s;
}

export const c = {
  bold: (s: string) => wrap(BOLD, s),
  dim: (s: string) => wrap(DIM, s),
  red: (s: string) => wrap(FG_RED, s),
  green: (s: string) => wrap(FG_GREEN, s),
  yellow: (s: string) => wrap(FG_YELLOW, s),
  blue: (s: string) => wrap(FG_BLUE, s),
  magenta: (s: string) => wrap(FG_MAGENTA, s),
  cyan: (s: string) => wrap(FG_CYAN, s),
};

// ---------------------------------------------------------------------------
// Table renderer (fixed-width, monospace, no external dep).
// ---------------------------------------------------------------------------

export interface TableColumn {
  header: string;
  key: string;
  /** Optional min width. The final width is max(min, header.length, longest cell). */
  minWidth?: number;
}

/**
 * Render a fixed-width table. Column widths are computed from the widest
 * value in each column (or `minWidth`, whichever is larger). Header row
 * is bolded when colour is enabled.
 */
export function renderTable(
  columns: readonly TableColumn[],
  rows: readonly { [k: string]: string }[]
): string {
  const widths = columns.map((col) => {
    let w = Math.max(col.minWidth ?? 0, col.header.length);
    for (const row of rows) {
      const cell = row[col.key] ?? "";
      if (cell.length > w) w = cell.length;
    }
    return w;
  });

  const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));

  const headerCells = columns.map((col, i) => c.bold(pad(col.header, widths[i]!)));
  const header = headerCells.join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map((row) =>
      columns.map((col, i) => pad(row[col.key] ?? "", widths[i]!)).join("  ")
    )
    .join("\n");

  return [header, c.dim(separator), body].filter((s) => s.length > 0).join("\n");
}

// ---------------------------------------------------------------------------
// Section rendering for `inspect`.
// ---------------------------------------------------------------------------

export function renderSectionHeader(title: string): string {
  return `\n${c.bold(c.cyan(title))}\n${c.dim("=".repeat(title.length))}`;
}

export function renderKeyValue(key: string, value: string, keyWidth = 20): string {
  const paddedKey = key + " ".repeat(Math.max(0, keyWidth - key.length));
  return `  ${c.dim(paddedKey)}${value}`;
}

export function renderBullet(text: string): string {
  return `  ${c.dim("-")} ${text}`;
}
