import { Color, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { PreparedBloomPass } from './post_bloom';
import type { StaticOpaqueN8AOPass } from './post_n8ao';
import type { OutputGradePass } from './post_output_grade';
import {
  type PostShedChain,
  type PostShedPlan,
  type PostShedRung,
  postShedPlan,
  postShedRungLabel,
} from './post_shed_core';

/**
 * The thin painter of the post shed: applies the pure plan of
 * post_shed_core.ts to the live passes of one composer. Every write here is
 * a pass `enabled` flag (three's EffectComposer skips a disabled pass and
 * re-targets the last enabled one at the canvas, so a toggle is free), a
 * bloom mip count, the N8AO passthrough flag, or a ONE-TIME clear of a
 * target the chain already allocated. Nothing here compiles a program or
 * resizes a target; the FXAA grade twin is built and compiled at boot
 * (post.ts, `prewarmShed`).
 *
 * The clears exist because a skipped pass leaves its target holding the
 * last frame it drew: the composite passes downstream still read it, so
 * without a clear a shed bloom would ghost the last bright frame across the
 * screen and a shed AO would smear the last occlusion under a moving
 * camera. Bloom's targets clear to transparent black (the grade adds
 * `bloom.rgb * bloom.a`, the mip composite weighs each mip), the AO target
 * to white (the composite multiplies by its red channel). A resize
 * reallocates those targets, so `reclear` re-runs the clears the current
 * plan needs.
 *
 * Reads only the level it is handed: no tier, preset or governor import,
 * which is what keeps the fairness argument in the core's header true of
 * the application too.
 */
export interface PostShedPasses {
  readonly smaa: Pass | null;
  readonly grade: OutputGradePass;
  /** The output grade with the fused FXAA arm, linked by `prewarm`, or null
   *  when the chain has no SMAA to trade it for. */
  readonly gradeFxaa: OutputGradePass | null;
  readonly bloom: PreparedBloomPass | null;
  readonly ao: StaticOpaqueN8AOPass | null;
}

export class PostShed {
  private level = 1;
  private plan: PostShedPlan;
  /** The FXAA grade twin has been drawn once under the prewarm, so its
   *  program is linked. Until then the `smaa-to-fxaa` rung is refused (the
   *  SMAA tail keeps running) rather than linking a program in the shed
   *  frame: a constrained profile drops `post.initial-frame`, and a live
   *  frame can in principle precede it. */
  private twinReady = false;
  private disposed = false;
  private readonly clearColor = new Color();
  private readonly previousClearColor = new Color();

  constructor(
    private readonly webgl: WebGLRenderer,
    private readonly passes: PostShedPasses,
    readonly chain: PostShedChain,
  ) {
    this.plan = postShedPlan(chain, 1);
  }

  /** The deepest rung applied that changes this chain, `full` at level 1. */
  rung(): PostShedRung | 'full' {
    return postShedRungLabel(this.level, this.effectiveChain());
  }

  /** The chain as this painter may shed it now: SMAA is only tradable once
   *  the twin's program is linked. */
  private effectiveChain(): PostShedChain {
    if (this.twinReady || !this.chain.smaa) return this.chain;
    return { smaa: false, bloom: this.chain.bloom, ao: this.chain.ao };
  }

  currentLevel(): number {
    return this.level;
  }

  /** Apply the governor's `post` level. Returns whether any pass flag moved.
   *  Called on every budget application (once per presented frame), so an
   *  unchanged level returns before planning anything. */
  apply(level: number): boolean {
    if (this.disposed || level === this.level) return false;
    const previous = this.plan;
    const chain = this.effectiveChain();
    const next = postShedPlan(chain, level);
    this.level = level;
    this.plan = next;
    if (
      previous.smaa === next.smaa &&
      previous.gradeFxaa === next.gradeFxaa &&
      previous.bloom === next.bloom &&
      previous.bloomMips === next.bloomMips &&
      previous.ao === next.ao
    ) {
      return false;
    }
    // Each write is gated on the CHAIN, not only on the pass being present:
    // a pass the chain disowns (the `?postshed=off` kill switch builds every
    // pass and declares none) is never touched, whatever the plan says.
    const { smaa, grade, gradeFxaa, bloom, ao } = this.passes;
    if (smaa && chain.smaa) smaa.enabled = next.smaa;
    if (gradeFxaa && chain.smaa) {
      grade.enabled = !next.gradeFxaa;
      gradeFxaa.enabled = next.gradeFxaa;
    }
    if (bloom && chain.bloom) {
      bloom.enabled = next.bloom;
      bloom.activeMips = next.bloomMips;
      if (!next.bloom && previous.bloom) this.clearBloomComposite(bloom);
      else if (next.bloom && next.bloomMips < previous.bloomMips) {
        this.clearBloomTailMips(bloom, next.bloomMips);
      }
    }
    if (ao && chain.ao) {
      ao.occlusionPassthrough = !next.ao;
      if (!next.ao && previous.ao) this.clearOcclusionWhite(ao);
    }
    return true;
  }

  /** After a composer resize: the skipped targets were reallocated, so the
   *  clears the current plan relies on are run again. */
  reclear(): void {
    if (this.disposed) return;
    const { bloom, ao } = this.passes;
    if (bloom && this.chain.bloom) {
      if (!this.plan.bloom) this.clearBloomComposite(bloom);
      else if (this.plan.bloomMips < bloom.nMips)
        this.clearBloomTailMips(bloom, this.plan.bloomMips);
    }
    if (ao && this.chain.ao && !this.plan.ao) this.clearOcclusionWhite(ao);
  }

  /**
   * Link the one program the shed can reach that the full chain never runs,
   * the FXAA grade twin: `renderTwin` draws that single pass once (post.ts
   * runs it against the composer's own buffers, under the presentation
   * prewarm's hidden scene), and only after it returns is the
   * `smaa-to-fxaa` rung admitted. A chain without the twin has nothing to
   * link and draws nothing here.
   */
  prewarm(renderTwin: () => void): void {
    if (this.disposed || this.twinReady || !this.passes.gradeFxaa) return;
    renderTwin();
    this.twinReady = true;
    // A level already standing on the SMAA rung (a pin, or a shed that
    // preceded the prewarm) takes the twin now that it is linked.
    const level = this.level;
    this.level = Number.NaN;
    this.apply(level);
  }

  /** Terminal: every later call is a no-op, so a late budget application on
   *  a torn-down composer never touches WebGL. Idempotent. */
  dispose(): void {
    this.disposed = true;
  }

  private clearBloomComposite(bloom: PreparedBloomPass): void {
    this.clearTarget(bloom.renderTargetsHorizontal[0], 0, 0);
  }

  private clearBloomTailMips(bloom: PreparedBloomPass, keptMips: number): void {
    for (let mip = keptMips; mip < bloom.nMips; mip++) {
      this.clearTarget(bloom.renderTargetsVertical[mip], 0, 0);
    }
  }

  private clearOcclusionWhite(ao: StaticOpaqueN8AOPass): void {
    this.clearTarget(ao.occlusionTarget, 0xffffff, 1);
  }

  private clearTarget(target: WebGLRenderTarget, hex: number, alpha: number): void {
    const webgl = this.webgl;
    const previousTarget = webgl.getRenderTarget();
    webgl.getClearColor(this.previousClearColor);
    const previousAlpha = webgl.getClearAlpha();
    try {
      webgl.setClearColor(this.clearColor.setHex(hex), alpha);
      webgl.setRenderTarget(target);
      webgl.clear(true, false, false);
    } finally {
      webgl.setClearColor(this.previousClearColor, previousAlpha);
      webgl.setRenderTarget(previousTarget);
    }
  }
}
