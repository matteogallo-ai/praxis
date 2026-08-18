/**
 * Renderers dispatcher (v0.7).
 *
 * Given a `Format` (from the registry) and a target string, this
 * dispatcher resolves the right renderer implementation OR throws
 * `UnsupportedRenderTargetError` if the target is unknown OR not
 * declared in the format's `output_targets[]`.
 *
 * Convention: the format's `output_targets` uses `"md"` for
 * Markdown (v0.1-v0.6 convention preserved), but the renderer
 * target is `"md-enhanced"` so callers can be explicit about the
 * v0.7 renderer feature set. The dispatcher accepts both spellings.
 */

import type { Format } from "../registry/schema.ts";
import type {
  BriefResult,
  BriefWithCritiqueResult,
} from "../orchestrator/orchestrator.ts";
import type { Renderer, RenderOptions, RenderTarget } from "./types.ts";
import { RENDER_TARGETS } from "./types.ts";
import { UnsupportedRenderTargetError, RenderError } from "./errors.ts";
import { markdownEnhancedRenderer } from "./markdown-enhanced.ts";
import { docxRenderer } from "./docx.ts";
import { pdfRenderer } from "./pdf.ts";

const REGISTRY: Record<RenderTarget, Renderer> = {
  "md-enhanced": markdownEnhancedRenderer,
  docx: docxRenderer,
  pdf: pdfRenderer,
};

/**
 * Convert a `Format.output_targets[]` entry (which uses the v0.1
 * short vocabulary of "md" / "docx" / "pdf") into a renderer target
 * name. The dispatcher accepts both the short form ("md") and the
 * renderer-native form ("md-enhanced").
 */
export function normaliseRenderTarget(input: string): RenderTarget | null {
  if (input === "md" || input === "md-enhanced") return "md-enhanced";
  if (input === "docx") return "docx";
  if (input === "pdf") return "pdf";
  return null;
}

/**
 * Check that a target is (a) known to the dispatcher and (b) allowed
 * by the format's `output_targets[]`. Returns the normalised
 * renderer target on success; throws `UnsupportedRenderTargetError`
 * otherwise.
 */
export function resolveTarget(target: string, format: Format): RenderTarget {
  const normalised = normaliseRenderTarget(target);
  if (normalised === null) {
    throw new UnsupportedRenderTargetError(
      target,
      format.id,
      RENDER_TARGETS.slice()
    );
  }
  // The format's output_targets may use the short form "md" — the
  // check accepts either the requested string or the short form
  // that maps to the same renderer.
  const allowedShortForms = format.output_targets as readonly string[];
  const isAllowed =
    allowedShortForms.includes(target) ||
    (normalised === "md-enhanced" && allowedShortForms.includes("md")) ||
    (normalised === "docx" && allowedShortForms.includes("docx")) ||
    (normalised === "pdf" && allowedShortForms.includes("pdf"));
  if (!isAllowed) {
    throw new UnsupportedRenderTargetError(target, format.id, allowedShortForms);
  }
  return normalised;
}

/**
 * The one-line entry point CLI callers use. Resolves the target
 * against the format, picks the renderer, and returns the rendered
 * buffer.
 */
export async function render(
  brief: BriefResult | BriefWithCritiqueResult,
  target: string,
  format: Format,
  options: RenderOptions = {}
): Promise<Buffer> {
  const resolved = resolveTarget(target, format);
  const renderer = REGISTRY[resolved];
  if (renderer === undefined) {
    throw new RenderError(target, `no renderer registered for target '${resolved}'`);
  }
  return renderer.render(brief, options);
}

// Re-exports for consumers.
export {
  markdownEnhancedRenderer,
  docxRenderer,
  pdfRenderer,
  UnsupportedRenderTargetError,
  RenderError,
};
export type { Renderer, RenderOptions, RenderTarget } from "./types.ts";
export { RENDER_TARGETS, RENDER_THEMES, hasCritique } from "./types.ts";
export type { RenderTheme } from "./types.ts";
