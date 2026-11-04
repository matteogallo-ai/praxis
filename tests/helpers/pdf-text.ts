/**
 * Text runs and their positions, page by page, read from a PDF that pdfkit
 * wrote with `compress_pdf_streams: false`. It knows only what pdfkit emits
 * for text — `x y Tm`, `/F size Tf`, `[<hex> kern …] TJ` — which is enough to
 * test layout without a PDF library the CI does not have.
 */

export interface TextRun {
  /** Left edge, in points from the page's left. */
  x: number;
  /** Baseline, in points from the page's bottom. */
  y: number;
  size: number;
  text: string;
}

export function pdfPages(buf: Buffer): TextRun[][] {
  const raw = buf.toString("latin1");
  const objects = new Map<number, string>();
  for (const m of raw.matchAll(/(\d+) 0 obj\s([\s\S]*?)endobj/g)) objects.set(Number(m[1]), m[2] as string);
  const pages: TextRun[][] = [];
  // pdfkit writes page objects in page order.
  for (const body of objects.values()) {
    if (!/\/Type \/Page\b(?!s)/.test(body)) continue;
    const ref = /\/Contents (\d+) 0 R/.exec(body);
    const content = ref === null ? "" : (objects.get(Number(ref[1])) ?? "");
    pages.push(runsOf(content));
  }
  return pages;
}

function runsOf(content: string): TextRun[] {
  const runs: TextRun[] = [];
  let x = 0;
  let y = 0;
  let size = 0;
  for (const m of content.matchAll(/([\d.-]+) ([\d.-]+) Tm|\/\S+ ([\d.]+) Tf|\[([^\]]*)\] TJ/g)) {
    if (m[1] !== undefined) {
      x = Number(m[1]);
      y = Number(m[2]);
    } else if (m[3] !== undefined) {
      size = Number(m[3]);
    } else {
      const hex = [...(m[4] as string).matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join("");
      const text = (hex.match(/../g) ?? []).map((c) => String.fromCharCode(Number.parseInt(c, 16))).join("");
      runs.push({ x, y, size, text });
    }
  }
  return runs;
}

/**
 * Pairs of runs drawn over each other: the same left edge (one column) and
 * baselines closer than the font size, so one line sits inside the other.
 */
export function overlappingRuns(page: TextRun[]): [TextRun, TextRun][] {
  const pairs: [TextRun, TextRun][] = [];
  for (let i = 0; i < page.length; i++) {
    for (let j = i + 1; j < page.length; j++) {
      const a = page[i] as TextRun;
      const b = page[j] as TextRun;
      if (Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 0.9 * Math.min(a.size, b.size)) pairs.push([a, b]);
    }
  }
  return pairs;
}
