/**
 * Minimal XML builder utilities for the DOCX renderer.
 *
 * DOCX is Open Packaging Convention (OPC) + XML. We only need
 * write-side support here, and the XML we produce is small
 * (element tree + escaping + indent-free). No parsing, no
 * validation beyond escaping — Word/LibreOffice are the ground
 * truth for schema conformance.
 */

/**
 * XML-escape a text node — the five characters that MUST be
 * escaped in XML text.
 */
export function escapeXmlText(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** XML-escape an attribute value. Same rules as text for our use. */
export function escapeXmlAttr(v: string): string {
  return escapeXmlText(v);
}

/**
 * Emit an element opening tag with `name` and `attrs`. Attribute
 * values are XML-escaped.
 */
export function openTag(name: string, attrs: Record<string, string> = {}): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join("");
  return `<${name}${attrStr}>`;
}

/** Emit an element closing tag. */
export function closeTag(name: string): string {
  return `</${name}>`;
}

/** Emit a self-closing element (`<name attrs />`). */
export function selfClosing(name: string, attrs: Record<string, string> = {}): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join("");
  return `<${name}${attrStr}/>`;
}

/**
 * Emit an element with text content. Text is XML-escaped. Attributes
 * are optional.
 */
export function elem(
  name: string,
  attrs: Record<string, string> | null,
  text: string
): string {
  const open = attrs === null ? openTag(name) : openTag(name, attrs);
  return `${open}${escapeXmlText(text)}${closeTag(name)}`;
}

/** Emit an XML prolog. */
export const XML_PROLOG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
