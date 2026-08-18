/**
 * Renderer types (v0.7).
 *
 * A renderer takes a `BriefResult` or `BriefWithCritiqueResult` and
 * produces a Buffer in a target format. The dispatcher chooses the
 * renderer implementation based on the `RenderTarget` string.
 */

import type {
  BriefResult,
  BriefWithCritiqueResult,
} from "../orchestrator/orchestrator.ts";

/**
 * Supported render targets. The dispatcher rejects any target
 * outside this set. Formats declare which targets they support in
 * their `output_targets[]` field; the dispatcher cross-checks.
 */
export type RenderTarget = "md-enhanced" | "docx" | "pdf";

export const RENDER_TARGETS: readonly RenderTarget[] = [
  "md-enhanced",
  "docx",
  "pdf",
] as const;

/**
 * Rendering themes. Currently affect PDF only. Kept as a plain
 * enum so more themes can be added later without changing the
 * rendering interface.
 */
export type RenderTheme = "professional" | "government" | "consulting";

export const RENDER_THEMES: readonly RenderTheme[] = [
  "professional",
  "government",
  "consulting",
] as const;

/**
 * Options that apply to every renderer. Individual renderers may
 * ignore options that do not apply to them (e.g. PDF ignores nothing;
 * enhanced Markdown ignores theme).
 */
export interface RenderOptions {
  include_sourcing_report?: boolean;
  include_critique?: boolean;
  include_toc?: boolean;
  include_appendices?: boolean;
  theme?: RenderTheme;
  /**
   * PDF only. Whether to compress content streams (default: true).
   * Tests set this to `false` so they can grep the raw buffer for
   * strings without inflating FlateDecode streams. Production
   * consumers should leave this at the default.
   */
  compress_pdf_streams?: boolean;
}

/** A renderer implementation. */
export interface Renderer {
  target: RenderTarget;
  render(
    brief: BriefResult | BriefWithCritiqueResult,
    options?: RenderOptions
  ): Promise<Buffer>;
}

/**
 * Narrowing helper — a `BriefResult` becomes a `BriefWithCritiqueResult`
 * as soon as it carries an `adversarial` field. Renderers use this
 * to decide whether to include the critique section.
 */
export function hasCritique(
  brief: BriefResult | BriefWithCritiqueResult
): brief is BriefWithCritiqueResult {
  return "adversarial" in brief && brief.adversarial !== undefined;
}
