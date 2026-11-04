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
