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
 * an angle autolink, a `www.`, scheme or e-mail autolink, outside code
 * spans. The YAML front matter is skipped: its values are quoted YAML,
 * not Markdown. A pattern check, not a parser: it errs towards reporting.
 */
export function liveTargets(document: string, needle: string): string[] {
  const markdown = document.replace(/^---\n[\s\S]*?\n---\n/, "");
  const text = markdown.replace(/\\`/g, "").replace(/(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g, "");
  const found = [
    ...(text.match(/(?<!\\)\]\([^)\n]*/g) ?? []),
    ...(text.match(/^[ \t]*(?<!\\)\[[^\]\n]*(?<!\\)\]:.*$/gm) ?? []),
    ...(text.match(/<[a-z][a-z0-9+.-]*:[^>\n]*>?/gi) ?? []),
    ...(text.match(/(?<!\\)@[a-z0-9.-]+/gi) ?? []),
    ...autolinkable(markdown),
  ];
  return found.filter((f) => f.includes(needle));
}

/** Every way GFM turns text into a link or an image, all to one host. */
export const HOSTILE =
  "![i](https://img.attacker.example/p.png) [l](https://l.attacker.example) www.attacker.example " +
  "https://bare.attacker.example/x ceo@attacker.example <https://angle.attacker.example>\n[r]: https://ref.attacker.example";
