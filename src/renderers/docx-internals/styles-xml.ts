/**
 * `word/styles.xml` — a minimal style set the Praxis DOCX renderer
 * uses: Normal, Heading1, Heading2, Heading3, and a Table style.
 *
 * Font sizes in WordprocessingML are given in half-points (a
 * `w:sz` of 44 means 22pt). Colours are RGB hex, uppercase, no
 * leading `#`.
 */

import { XML_PROLOG } from "./xml-builder.ts";

const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;

export function buildStylesXml(): string {
  const styles = [
    // Normal — body text, 11pt Calibri equivalent.
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:name w:val="Normal"/>` +
      `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr>` +
      `</w:style>`,
    // Heading1 — briefing title, 24pt bold black.
    `<w:style w:type="paragraph" w:styleId="Heading1">` +
      `<w:name w:val="heading 1"/>` +
      `<w:basedOn w:val="Normal"/>` +
      `<w:next w:val="Normal"/>` +
      `<w:qFormat/>` +
      `<w:pPr><w:spacing w:before="400" w:after="200"/></w:pPr>` +
      `<w:rPr>` +
      `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>` +
      `<w:b/>` +
      `<w:color w:val="000000"/>` +
      `<w:sz w:val="48"/>` +
      `</w:rPr>` +
      `</w:style>`,
    // Heading2 — section title, 16pt bold dark grey.
    `<w:style w:type="paragraph" w:styleId="Heading2">` +
      `<w:name w:val="heading 2"/>` +
      `<w:basedOn w:val="Normal"/>` +
      `<w:next w:val="Normal"/>` +
      `<w:qFormat/>` +
      `<w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr>` +
      `<w:rPr>` +
      `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>` +
      `<w:b/>` +
      `<w:color w:val="404040"/>` +
      `<w:sz w:val="32"/>` +
      `</w:rPr>` +
      `</w:style>`,
    // Heading3 — sub-section (used for critique per-critique blocks etc.).
    `<w:style w:type="paragraph" w:styleId="Heading3">` +
      `<w:name w:val="heading 3"/>` +
      `<w:basedOn w:val="Normal"/>` +
      `<w:next w:val="Normal"/>` +
      `<w:qFormat/>` +
      `<w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>` +
      `<w:rPr>` +
      `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>` +
      `<w:b/>` +
      `<w:color w:val="606060"/>` +
      `<w:sz w:val="26"/>` +
      `</w:rPr>` +
      `</w:style>`,
    // Small — used for footer / metadata lines.
    `<w:style w:type="paragraph" w:styleId="Small">` +
      `<w:name w:val="Small"/>` +
      `<w:basedOn w:val="Normal"/>` +
      `<w:rPr><w:sz w:val="18"/><w:color w:val="606060"/></w:rPr>` +
      `</w:style>`,
    // TableStyle — plain table with thin borders and grey header row.
    `<w:style w:type="table" w:styleId="PraxisTable">` +
      `<w:name w:val="PraxisTable"/>` +
      `<w:tblPr>` +
      `<w:tblBorders>` +
      `<w:top w:val="single" w:sz="4" w:color="808080"/>` +
      `<w:left w:val="single" w:sz="4" w:color="808080"/>` +
      `<w:bottom w:val="single" w:sz="4" w:color="808080"/>` +
      `<w:right w:val="single" w:sz="4" w:color="808080"/>` +
      `<w:insideH w:val="single" w:sz="4" w:color="C0C0C0"/>` +
      `<w:insideV w:val="single" w:sz="4" w:color="C0C0C0"/>` +
      `</w:tblBorders>` +
      `</w:tblPr>` +
      `</w:style>`,
  ].join("");

  return (
    XML_PROLOG +
    `<w:styles ${W_NS}>` +
    styles +
    `</w:styles>`
  );
}
