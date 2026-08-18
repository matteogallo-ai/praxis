/**
 * DOCX renderer (v0.7). From-scratch: no external dep.
 *
 * A DOCX file is a ZIP (Open Packaging Convention) whose entries
 * are XML parts. Praxis emits the minimum set Word / LibreOffice
 * need to render the briefing:
 *
 *   [Content_Types].xml       — MIME type registration
 *   _rels/.rels               — package relationships (main document pointer)
 *   word/document.xml         — the body content
 *   word/styles.xml           — style definitions
 *   word/_rels/document.xml.rels — document relationships (styles pointer)
 *
 * ZIP writing is `node:zlib`-only (bundled in Bun). See
 * `docx-internals/zip-builder.ts`.
 */

import type { Renderer, RenderOptions } from "./types.ts";
import { RenderError } from "./errors.ts";
import {
  buildContentTypesXml,
  buildDocumentRelsXml,
  buildRootRelsXml,
} from "./docx-internals/content-types.ts";
import { buildDocumentXml } from "./docx-internals/document-xml.ts";
import { buildStylesXml } from "./docx-internals/styles-xml.ts";
import { buildZip, type ZipEntry } from "./docx-internals/zip-builder.ts";

export const docxRenderer: Renderer = {
  target: "docx",
  async render(brief, options = {}) {
    try {
      const entries: ZipEntry[] = [
        // Content types MUST be first in the archive per the OPC spec;
        // Word tolerates other orderings but strict OPC readers do not.
        {
          path: "[Content_Types].xml",
          data: Buffer.from(buildContentTypesXml(), "utf-8"),
        },
        {
          path: "_rels/.rels",
          data: Buffer.from(buildRootRelsXml(), "utf-8"),
        },
        {
          path: "word/document.xml",
          data: Buffer.from(buildDocumentXml(brief, options), "utf-8"),
        },
        {
          path: "word/styles.xml",
          data: Buffer.from(buildStylesXml(), "utf-8"),
        },
        {
          path: "word/_rels/document.xml.rels",
          data: Buffer.from(buildDocumentRelsXml(), "utf-8"),
        },
      ];
      return buildZip(entries);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new RenderError("docx", `assembly failed — ${message}`);
    }
  },
};

/** Also exposed for unit tests that want to inspect the parts. */
export function buildDocxParts(
  brief: Parameters<Renderer["render"]>[0],
  options: RenderOptions = {}
): { name: string; content: string }[] {
  return [
    { name: "[Content_Types].xml", content: buildContentTypesXml() },
    { name: "_rels/.rels", content: buildRootRelsXml() },
    { name: "word/document.xml", content: buildDocumentXml(brief, options) },
    { name: "word/styles.xml", content: buildStylesXml() },
    { name: "word/_rels/document.xml.rels", content: buildDocumentRelsXml() },
  ];
}
