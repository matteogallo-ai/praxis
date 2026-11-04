import { marked } from "marked";

/**
 * What a GFM viewer (GitHub, VS Code) would turn into a link in Markdown
 * text: a `www.` address or a scheme URL outside code spans. Control text
 * that names a URL or a host must not be clickable: the URL is the one that
 * failed the check. Limits: e-mail autolinks are not looked for, and text
 * inside an explicit link counts (a false failure, never a false pass).
 */
export function autolinkable(markdown: string): string[] {
  // An escaped backtick opens no code span (CommonMark).
  const text = markdown
    .replace(/\\`/g, "")
    .replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, "");
  return text.match(/\bwww\.\S*|\b[a-z][a-z0-9+.-]*:\/\/\S*/gi) ?? [];
}

/**
 * Where `needle` (a host) could become a link or an image in Markdown that a
 * GFM viewer renders: a link or image destination, a reference definition,
 * an angle autolink, a `www.`, scheme or e-mail autolink, in text and in
 * code spans alike. Code spans are not skipped: finding them is what the
 * renderer can get wrong, so a needle in one is reported. The YAML front
 * matter is skipped: its values are quoted YAML, not Markdown. A pattern
 * check, not a parser: it errs towards reporting.
 */
export function liveTargets(document: string, needle: string): string[] {
  const text = document.replace(/^---\n[\s\S]*?\n---\n/, "");
  const found = [
    ...(text.match(/(?<!\\)\]\([^)\n]*/g) ?? []),
    ...(text.match(/^[ \t>-]*(?<!\\)\[[^\]\n]*(?<!\\)\]:.*$/gm) ?? []),
    ...(text.match(/<[a-z][a-z0-9+.-]*:[^>\n]*>?/gi) ?? []),
    ...(text.match(/(?<!\\)@[a-z0-9.-]+/gi) ?? []),
    ...(text.match(/\bwww\.\S*|\b[a-z][a-z0-9+.-]*:\/\/\S*/gi) ?? []),
  ];
  return found.filter((f) => f.includes(needle));
}

/** Every way GFM turns text into a link or an image, all to one host. */
export const HOSTILE =
  "![i](https://img.attacker.example/p.png) [l](https://l.attacker.example) www.attacker.example " +
  "https://bare.attacker.example/x ceo@attacker.example <https://angle.attacker.example>\n[r]: https://ref.attacker.example\n" +
  // Backticks a renderer could pair where the viewer does not (review of the fix).
  "`a\nb` [x](https://cross.attacker.example) `c`\n\n| h | k |\n|---|---|\n| `a | www.cell.attacker.example` |\n\n`a\r\r www.cr.attacker.example `";

/**
 * The `href` and `src` a GFM renderer (marked) writes for `needle`: the
 * check `liveTargets` approximates with patterns, made by a real parser.
 * The front matter is skipped, as a viewer shows it as a table, not as Markdown.
 */
export function renderedTargets(document: string, needle: string): string[] {
  const html = marked.parse(document.replace(/^---\n[\s\S]*?\n---\n/, ""), { async: false, gfm: true });
  return [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1] as string).filter((u) => u.includes(needle));
}
