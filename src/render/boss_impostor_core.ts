// Where a world boss's far sprite is drawn, and how it looks from there.
//
// The whole point of a WORLD boss is that he is a landmark: you should be able to stand on
// the far side of the zone, see a thirteen-yard silhouette moving on the horizon, and decide
// to go there. The renderer's entity band is 80 yards, so past that he does not merely lose
// detail, he stops existing on screen, and the fight becomes something you only ever learn
// about from chat.
//
// Same technique as the far-foliage impostors (`foliage_impostor.ts`): bake a ring of yaw
// views of the real model into one atlas, then draw a camera-facing quad that samples the
// two views bracketing the current bearing and blends them, so orbiting never snaps. The
// difference, and the reason this is its own module rather than a fifth foliage category, is
// that the subject MOVES and TURNS: the bearing is taken relative to his own facing, so the
// sprite shows his back while he runs away from you and his front while he charges the town.
//
// Three/DOM/i18n-free and deterministic, so a Vitest drives it directly and the
// RENDER_PURE_CORES purity sweep in tests/architecture.test.ts covers it.

/**
 * Yaw views baked around the model.
 *
 * Twelve is 30 degrees apart. Fewer starts to read as a flip-book on a subject that turns
 * while you watch him (he walks a circuit, so he is turning most of the time), and each view
 * is one small cell in one atlas, so the cost of the extra four over a foliage-style eight is
 * a few hundred KB of texture for the one entity in the world that earns it.
 */
export const BOSS_IMPOSTOR_VIEWS = 12;

/**
 * Where the real articulated rig stops being drawn.
 *
 * Pinned against `ENTITY_DRAW_RANGE` by the test rather than imported, because this module
 * must stay free of the renderer: if that band ever moves, the test says so instead of the
 * handoff silently opening a gap (a ring of nothing) or an overlap (two Balgaths).
 */
export const BOSS_IMPOSTOR_FADE_START = 66;
/** Fully opaque from here out, forever. */
export const BOSS_IMPOSTOR_FADE_END = 88;

/**
 * Hardest the horizon may wash him out.
 *
 * A sprite that takes the scene fog at full strength is gone by the distance this exists to
 * cover: the fog wall is closer than the horizon he is supposed to stand on. Capping the mix
 * keeps a legible silhouette at any range while still letting him sit BEHIND the atmosphere
 * rather than being pasted in front of it, which is what a hard zero would look like.
 */
export const BOSS_IMPOSTOR_FOG_CEILING = 0.68;

/** The two atlas views bracketing `relBearing`, and how far between them to blend. */
export function bossImpostorFrame(relBearing: number): { a: number; b: number; blend: number } {
  const turn = (Math.PI * 2) / BOSS_IMPOSTOR_VIEWS;
  // Normalize into [0, VIEWS) rather than into [-pi, pi) first: the wrap has to happen on the
  // INDEX, or the pair straddling the seam blends the front view into the back one.
  let t = relBearing / turn;
  t -= Math.floor(t / BOSS_IMPOSTOR_VIEWS) * BOSS_IMPOSTOR_VIEWS;
  const a = Math.floor(t) % BOSS_IMPOSTOR_VIEWS;
  return { a, b: (a + 1) % BOSS_IMPOSTOR_VIEWS, blend: t - Math.floor(t) };
}

/**
 * Sprite opacity at `dist` yards.
 *
 * Zero while the real rig is still drawn, easing to one across the handoff band. The two
 * representations overlap through the band on purpose: a hard switch at one distance pops,
 * because a baked idle sprite and a running rig never line up frame for frame.
 */
export function bossImpostorAlpha(dist: number): number {
  if (dist <= BOSS_IMPOSTOR_FADE_START) return 0;
  if (dist >= BOSS_IMPOSTOR_FADE_END) return 1;
  const t = (dist - BOSS_IMPOSTOR_FADE_START) / (BOSS_IMPOSTOR_FADE_END - BOSS_IMPOSTOR_FADE_START);
  return t * t * (3 - 2 * t); // smoothstep, so neither end of the handoff has a visible knee
}

/** Fog strength the sprite actually applies, given what the scene wants. */
export function bossImpostorFogMix(sceneFog: number): number {
  return Math.min(BOSS_IMPOSTOR_FOG_CEILING, Math.max(0, sceneFog));
}

/**
 * Bearing to use for view selection: where the CAMERA sits around him, in his own frame.
 *
 * Taking his facing out is the whole difference between this and a static impostor. Without
 * it he would always show the same face to a stationary viewer no matter which way he was
 * running, which is exactly the tell that gives a billboard away.
 */
export function bossImpostorBearing(
  camX: number,
  camZ: number,
  subX: number,
  subZ: number,
  subFacing: number,
): number {
  return Math.atan2(camX - subX, camZ - subZ) - subFacing;
}

/**
 * Quad size in world units for a model of `height` world units.
 *
 * Wider than tall-to-square on purpose: the bake frames the widest view (arms out mid-stride
 * on a creature whose arms are most of his silhouette), and a quad cut to the model's height
 * alone clips those off. The cost of the margin is transparent texels, which the alpha test
 * discards.
 */
export function bossImpostorQuadSize(height: number): { w: number; h: number } {
  return { w: height * 1.15, h: height * 1.15 };
}
