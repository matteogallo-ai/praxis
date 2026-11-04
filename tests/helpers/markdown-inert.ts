/**
 * What a GFM viewer (GitHub, VS Code) would turn into a link in Markdown
 * text: a `www.` address or a scheme URL outside code spans and outside
 * explicit links. Control text that names a URL or a host must not be
 * clickable: the URL is the one that failed the check.
 */
export function autolinkable(markdown: string): string[] {
  const text = markdown.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, "");
  return text.match(/\bwww\.\S*|\b[a-z][a-z0-9+.-]*:\/\/\S*/gi) ?? [];
}
