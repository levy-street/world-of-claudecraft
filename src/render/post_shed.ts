import { Color, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { PreparedBloomPass } from './post_bloom';
import type { StaticOpaqueN8AOPass } from './post_n8ao';
import type { OutputGradePass } from './post_output_grade';
import {
  POST_SHED_STEP,
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
  /** The boot-compiled output grade with the fused FXAA arm, or null when
   *  the chain has no SMAA to trade it for. */
  readonly gradeFxaa: OutputGradePass | null;
  readonly bloom: PreparedBloomPass | null;
  readonly ao: StaticOpaqueN8AOPass | null;
}

const clearColor = new Color();
const previousClearColor = new Color();

export class PostShed {
  private level = 1;
  private plan: PostShedPlan;

  constructor(
    private readonly webgl: WebGLRenderer,
    private readonly passes: PostShedPasses,
    readonly chain: PostShedChain,
  ) {
    this.plan = postShedPlan(chain, 1);
  }

  /** The deepest rung applied that changes this chain, `full` at level 1. */
  rung(): PostShedRung | 'full' {
    return postShedRungLabel(this.level, this.chain);
  }

  currentLevel(): number {
    return this.level;
  }

  /** Apply the governor's `post` level. Returns whether any pass flag moved.
   *  Called on every budget application (once per presented frame), so an
   *  unchanged level returns before planning anything. */
  apply(level: number): boolean {
    if (level === this.level) return false;
    const previous = this.plan;
    const next = postShedPlan(this.chain, level);
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
    const chain = this.chain;
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
    const { bloom, ao } = this.passes;
    if (bloom && this.chain.bloom) {
      if (!this.plan.bloom) this.clearBloomComposite(bloom);
      else if (this.plan.bloomMips < bloom.nMips)
        this.clearBloomTailMips(bloom, this.plan.bloomMips);
    }
    if (ao && this.chain.ao && !this.plan.ao) this.clearOcclusionWhite(ao);
  }

  /**
   * Compile the one program the shed can reach that the full chain never
   * runs, the FXAA grade twin, by rendering the chain once on the
   * `smaa-to-fxaa` rung; `render` is the caller's composer render (the
   * presentation prewarm runs it with the scene hidden). The level in force
   * before the call is restored after it. A chain without the twin has
   * nothing to compile and renders nothing here.
   */
  prewarm(render: () => void): void {
    if (!this.passes.gradeFxaa) return;
    const level = this.level;
    this.apply(1 - POST_SHED_STEP);
    try {
      render();
    } finally {
      this.apply(level);
    }
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
    webgl.getClearColor(previousClearColor);
    const previousAlpha = webgl.getClearAlpha();
    try {
      webgl.setClearColor(clearColor.setHex(hex), alpha);
      webgl.setRenderTarget(target);
      webgl.clear(true, false, false);
    } finally {
      webgl.setClearColor(previousClearColor, previousAlpha);
      webgl.setRenderTarget(previousTarget);
    }
  }
}
