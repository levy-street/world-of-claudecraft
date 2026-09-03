/**
 * Budget-governed post-processing shed: the pure decision layer behind the
 * render budget's `post` level (render_budget.ts) and the pass painter that
 * applies it (post_shed.ts).
 *
 * The post chain was the one tier-static slice of a composer frame the
 * governor could not touch: SMAA (three passes over two full-resolution
 * RGBA16F targets), bloom (twelve passes over eleven targets, behind a
 * threshold interiors and night never cross) and N8AO (four to five passes,
 * full resolution on ultra and insane) ran unchanged while fleet ultra
 * sessions rested at the grass/foliage/vfx/lighting floor with nothing left
 * to shed. This module maps ONE governed 0..1 level onto a fixed ladder of
 * four rungs, in shed order:
 *
 *   1. `smaa-to-fxaa`: the tail SMAA pass is skipped and the output grade
 *      swaps to its boot-compiled twin carrying the fused FXAA arm, so the
 *      frame keeps an edge AA at a fraction of the cost.
 *   2. `bloom-mips`: the bloom blur chain stops after `POST_SHED_BLOOM_MIPS`
 *      of its five mips; the skipped mips are cleared once so the composite
 *      adds nothing from them.
 *   3. `bloom-off`: the whole bloom pass is skipped and its composite target
 *      cleared once, so the grade adds black.
 *   4. `ao-off`: N8AO keeps rendering the scene (it IS the scene pass on the
 *      composer tiers) but skips its evaluate and denoise passes, and its
 *      composite reads an AO target cleared to white once, so the scene
 *      passes through unoccluded. There is no half-resolution arm to step
 *      through: a resolution change reallocates the AO targets and relinks
 *      the AO program, which the scheduler contract forbids mid-fight.
 *
 * Every rung is a pass ENABLE flag or a one-time target clear on a pass the
 * chain already built and compiled at boot: no rung selects a new shader
 * program in a live frame (the FXAA grade twin compiles under the
 * `post.initial-frame` prewarm) and none reallocates a render target.
 *
 * Fairness (docs/design/graphics-settings-fairness.md): edge anti-aliasing,
 * bloom and ambient occlusion filter or shade the DISPLAY-SPACE image after
 * everything a player reads has been drawn into it. None of them adds,
 * removes, hides, delays or repositions anything actionable, so shedding
 * them is cosmetic. The level reads the live governor (a perf-governor
 * output, like the shadow cadence), while the FLOOR of the level is a pure
 * function of the static preset: which passes the tier built, see
 * `postShedFloor`.
 *
 * This core imports nothing and reads no tier, preset or device profile.
 */

export const POST_SHED_RUNGS = ['smaa-to-fxaa', 'bloom-mips', 'bloom-off', 'ao-off'] as const;

export type PostShedRung = (typeof POST_SHED_RUNGS)[number];

/** One rung of the level: 1 = the tier's full chain, 0 = every rung applied. */
export const POST_SHED_STEP = 0.25;

/** Bloom mips kept by the `bloom-mips` rung (of UnrealBloom's five). The
 *  chain is sequential (each mip blurs the previous mip's output), so only
 *  the TAIL can be skipped without changing any pass's input; the tail mips
 *  are the small ones, so this rung sheds pass count (submit-side driver
 *  work) more than fill rate. */
export const POST_SHED_BLOOM_MIPS = 3;

/** Which post passes the built chain carries: the static inputs of the
 *  floor. Structural, so the governor can hand it `GFX` directly. */
export interface PostShedChain {
  readonly smaa: boolean;
  readonly bloom: boolean;
  readonly ao: boolean;
}

/** The pass flags the painter applies for one level. */
export interface PostShedPlan {
  /** The tail SMAA pass runs. */
  readonly smaa: boolean;
  /** The output grade runs its fused-FXAA twin instead of the plain grade. */
  readonly gradeFxaa: boolean;
  /** The bloom pass runs. */
  readonly bloom: boolean;
  /** Bloom blur mips rendered (the rest are cleared once). */
  readonly bloomMips: number;
  /** N8AO evaluates occlusion; false is the white passthrough. */
  readonly ao: boolean;
}

function clamp01(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(1, Math.max(0, level));
}

/** Number of rungs a level applies: 1 -> 0, 0.75 -> 1, ..., 0 -> 4. */
export function postShedRungCount(level: number): number {
  return Math.round((1 - clamp01(level)) / POST_SHED_STEP);
}

/** The rungs a level applies, in shed order. */
export function postShedRungsApplied(level: number): readonly PostShedRung[] {
  return POST_SHED_RUNGS.slice(0, postShedRungCount(level));
}

/** The deepest rung a level applies, or `full` for the tier's whole chain. */
export function postShedRungLabel(level: number): PostShedRung | 'full' {
  const count = postShedRungCount(level);
  return count === 0 ? 'full' : POST_SHED_RUNGS[count - 1];
}

/** Whether the chain carries the pass a rung sheds. A rung whose pass is
 *  absent (an Advanced mix with bloom off, `?smaa=off`) is a no-op step. */
export function postShedRungApplies(rung: PostShedRung, chain: PostShedChain): boolean {
  switch (rung) {
    case 'smaa-to-fxaa':
      return chain.smaa;
    case 'bloom-mips':
    case 'bloom-off':
      return chain.bloom;
    case 'ao-off':
      return chain.ao;
  }
}

/**
 * The static floor of the `post` level for a chain: one step per rung down
 * to the DEEPEST rung whose pass the chain carries, so the governor never
 * walks past the last rung that can change anything. A chain with no post
 * pass at all (medium's grade-only chain, low, a kill-switched session)
 * floors at 1 and is not governable.
 */
export function postShedFloor(chain: PostShedChain | null): number {
  if (!chain) return 1;
  let deepest = 0;
  for (let i = 0; i < POST_SHED_RUNGS.length; i++) {
    if (postShedRungApplies(POST_SHED_RUNGS[i], chain)) deepest = i + 1;
  }
  return Math.round((1 - deepest * POST_SHED_STEP) * 100) / 100;
}

/** True when the chain carries at least one sheddable pass. */
export function postShedGovernable(chain: PostShedChain | null): boolean {
  return postShedFloor(chain) < 1;
}

/**
 * The pass plan for a level. Pure: the same level always yields the same
 * flags, so the painter can diff consecutive plans and touch only what
 * changed. A rung whose pass the chain lacks resolves to the pass's own
 * absence (a chain without bloom plans no bloom at every level).
 */
export function postShedPlan(chain: PostShedChain, level: number): PostShedPlan {
  const rungs = postShedRungCount(level);
  const bloom = chain.bloom && rungs < 3;
  return {
    smaa: chain.smaa && rungs < 1,
    gradeFxaa: chain.smaa && rungs >= 1,
    bloom,
    bloomMips: bloom && rungs >= 2 ? POST_SHED_BLOOM_MIPS : 5,
    ao: chain.ao && rungs < 4,
  };
}
