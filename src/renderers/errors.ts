/**
 * Renderer error hierarchy (v0.7).
 */

import { PraxisError } from "../registry/errors.ts";
import type { RenderTarget } from "./types.ts";

/**
 * Generic renderer failure — shape parsing, XML/PDF writer error,
 * etc. Renderers should throw this (or a subclass) rather than
 * generic Errors so the CLI can render a clean exit-1 message.
 */
export class RenderError extends PraxisError {
  readonly target: RenderTarget | string;

  constructor(target: RenderTarget | string, message: string) {
    super(`Renderer '${target}' failed: ${message}`);
    this.name = "RenderError";
    this.target = target;
  }
}

/**
 * Raised by the dispatcher when the caller asks for a target that
 * either does not exist OR is not declared in the format's
 * `output_targets[]`.
 */
export class UnsupportedRenderTargetError extends RenderError {
  readonly formatId: string;
  readonly allowedTargets: readonly string[];

  constructor(
    target: string,
    formatId: string,
    allowedTargets: readonly string[]
  ) {
    super(
      target,
      `format '${formatId}' does not declare '${target}' in output_targets[] (allowed: [${allowedTargets.join(", ")}])`
    );
    this.name = "UnsupportedRenderTargetError";
    this.formatId = formatId;
    this.allowedTargets = allowedTargets;
  }
}
