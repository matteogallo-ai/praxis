/**
 * `[Content_Types].xml` — declares MIME types for every part in the
 * DOCX package. The absolute minimum for a Word-parseable document is
 * three types: relationships, main document, styles.
 */

import { XML_PROLOG } from "./xml-builder.ts";

export function buildContentTypesXml(): string {
  return (
    XML_PROLOG +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`
  );
}

/**
 * `_rels/.rels` — package-level relationships. Points at
 * `word/document.xml` as the main document.
 */
export function buildRootRelsXml(): string {
  return (
    XML_PROLOG +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`
  );
}

/**
 * `word/_rels/document.xml.rels` — document-level relationships. Points
 * at `word/styles.xml` so the main document can reference its styles.
 */
export function buildDocumentRelsXml(): string {
  return (
    XML_PROLOG +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`
  );
}
