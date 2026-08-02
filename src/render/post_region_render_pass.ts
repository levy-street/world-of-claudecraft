import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

/**
 * Scene pass for the dynamic-resolution (grade-only) path.
 *
 * Dynamic resolution never reallocates: it keeps full-size composer targets and
 * shrinks only the rendered region, leaving OutputGradePass to expand that
 * sub-rect back to full extent through its input uv rect. The region therefore
 * belongs to the SCENE draw and to nothing else. Any later pass that inherits it
 * writes a partial image into a full-size target, and the tail pass then stretches
 * that target (valid sub-rect plus a never-written margin) across the canvas: the
 * frame lands scaled into one corner with a frozen margin beside it.
 *
 * Owning the region here, applied immediately before the scene draw and removed
 * immediately after, makes that leak unrepresentable. It holds regardless of
 * EffectComposer ping-pong parity and of whether the screen-fx pass is enabled on
 * any given frame, both of which change which physical target each later pass
 * writes to.
 */

export interface RenderRegionSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Clamp `target` to `region`, or restore its full extent when `region` is null.
 * A region at or beyond the target extent clears the scissor test rather than
 * leaving a full-coverage one armed.
 */
export function applyRenderRegion(
  target: WebGLRenderTarget,
  region: RenderRegionSize | null,
): void {
  const width = region
    ? Math.min(target.width, Math.max(1, Math.floor(region.width)))
    : target.width;
  const height = region
    ? Math.min(target.height, Math.max(1, Math.floor(region.height)))
    : target.height;
  target.viewport.set(0, 0, width, height);
  target.scissor.set(0, 0, width, height);
  target.scissorTest = width < target.width || height < target.height;
}

export class RegionRenderPass extends RenderPass {
  /** Live render region, or null to draw the scene at the target's full extent. */
  region: RenderRegionSize | null = null;

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    // RenderPass draws into readBuffer; renderToScreen has no target to carry a
    // region, and the grade pass always follows this one, so it cannot be last.
    const target = this.renderToScreen ? null : readBuffer;
    const region = this.region;
    if (target && region) applyRenderRegion(target, region);
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      if (target && region) applyRenderRegion(target, null);
    }
  }
}
