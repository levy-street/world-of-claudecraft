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

import { REALM_MOON_TINT, realmLightTint } from './day_night_core';

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
 * Hardest the horizon may wash him out.
 *
 * A sprite that takes the scene fog at full strength is gone by the distance this exists to
 * cover: the fog wall is closer than the horizon he is supposed to stand on. Capping the mix
 * keeps a legible silhouette at any range while still letting him sit BEHIND the atmosphere
 * rather than being pasted in front of it, which is what a hard zero would look like.
 */
export const BOSS_IMPOSTOR_FOG_CEILING = 0.68;

/**
 * Margin the bake frames around the model's own bounds, on both axes.
 *
 * Shared by the bake camera and the drawn quad, which is the whole reason it is a named
 * constant: the quad has to cover EXACTLY the world-space rectangle each cell was shot in,
 * or the silhouette lands on screen a few percent larger or smaller than the frozen far mesh
 * it replaces, and the switch between them reads as a hop in size.
 */
export const BOSS_IMPOSTOR_FRAME_MARGIN = 1.04;

/**
 * The bake's fixed daylight rig: a white hemisphere over a warm key.
 *
 * Fixed on purpose (the atlas is baked once, on first need) and declared here rather than in
 * the Three module because the night shading below has to know the ratio the two lights
 * were baked in: that ratio is how much of a texel's brightness answers to the ambient half
 * of the live grade and how much to the key half.
 */
export const BOSS_IMPOSTOR_BAKE_SKY = 1.5;
export const BOSS_IMPOSTOR_BAKE_KEY = 2.4;

/**
 * Share of a baked texel's light that came from the key rather than the dome.
 *
 * The dome lands its full intensity on every texel; the key lands `intensity * N.L`, which
 * averages a half over the lit side of a rounded body, so the key counts at half weight.
 * Roughly 0.44 with the shipped intensities. A flat card has no normal to redo this per
 * texel, so one share for the whole sprite is as honest as it gets.
 */
export const BOSS_IMPOSTOR_BAKE_KEY_SHARE =
  (BOSS_IMPOSTOR_BAKE_KEY * 0.5) / (BOSS_IMPOSTOR_BAKE_KEY * 0.5 + BOSS_IMPOSTOR_BAKE_SKY);

/**
 * Moonlight hue the key light cools toward at deepest night, as a luminance-neutral
 * per-channel multiplier, and how far the grade takes it at full night.
 *
 * Mirrors the renderer's own key-light cool (its pale 0x9fb2e0 moon at 0.55 by full night)
 * with the brightness divided out, so it re-colours without a second exposure knob. Level is
 * what keeps a night sprite from glowing; this is what keeps it from being a grey silhouette
 * under a blue sky.
 */
export const BOSS_IMPOSTOR_MOON_COOL: readonly [number, number, number] = [0.898, 1.004, 1.263];
export const BOSS_IMPOSTOR_NIGHT_COOL = 0.55;

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

/** Everything the show/hide decision needs, read off the entity and the renderer. */
export interface BossImpostorShowInput {
  /** True unless the renderer's RANGE band hid his rig this frame. Range only: a rig
   *  hidden by the shader-compile gate or the off-screen cull still counts as shown, or
   *  a boss spawning thirty yards away would flash as a flat sprite while his rig links. */
  rigShown: boolean;
  /** Yards from the viewer (the player, not the camera). */
  dist: number;
  /** The template's far-visibility radius; absent or zero means he is not a landmark. */
  landmarkRange: number | undefined;
  dead: boolean;
  asleep: boolean;
}

/**
 * Whether the sprite draws this frame.
 *
 * Exactly one representation of him is ever on screen, and the sprite is the one that gives
 * way: it draws only while the renderer is NOT drawing his rig. That is deliberately not a
 * second distance curve. The rig hides at 96 yards and re-shows at 80 with hysteresis, and
 * any curve of this module's own would have to reproduce that hysteresis to the frame or
 * open exactly the two bands the first cut shipped with: a ghost sprite over the rig while
 * approaching and an opaque sprite AND the rig while receding. Keyed off the rig's own
 * visibility, the sprite inherits the hysteresis by construction and cannot coexist with it.
 *
 * A sleeping boss is a landmark at his lair, folded into his crater, not a silhouette on the
 * horizon; the rig band covers anyone close enough to see the crater.
 */
export function bossImpostorShows(input: BossImpostorShowInput): boolean {
  if (input.rigShown || input.dead || input.asleep) return false;
  const range = input.landmarkRange ?? 0;
  if (!(range > 0)) return false;
  return input.dist <= range;
}

/**
 * Whether the renderer is drawing this entity's RIG, read off its view.
 *
 * The one input `bossImpostorShows` keys on, and the reason it lives here rather than as a
 * closure on the renderer: which of a view's hide reasons count is a contract, not a detail.
 * Only the RANGE band counts. The compile gate and the frustum cull also hide a rig, but a
 * boss spawning thirty yards away must not flash as a flat sprite while his shader programs
 * link, so those are invisible to the impostor. No view at all (the server sent the landmark
 * but nothing is built yet) is no rig, which is exactly when the sprite should stand in.
 */
export interface BossImpostorRigView {
  readonly rangeHidden: boolean;
  /** Present on the renderer's view and deliberately IGNORED here (see above). */
  readonly compilePending?: boolean;
}

export function rigShownFromView(view: BossImpostorRigView | undefined): boolean {
  return !(view?.rangeHidden ?? true);
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

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * The world-space rectangle every atlas cell was shot in, in the rig's own frame.
 *
 * Units are the far mesh's normalized model units, which are world units at `e.scale = 1`
 * with the feet on the pivot plane (see `prepareVisual`). `w`/`h` are the frame's extent;
 * the centre is where the model's bounding-box middle sits relative to the pivot, and it is
 * the point the bake camera looked at, so it is where the drawn quad's centre has to go.
 */
export interface BossImpostorFrameMetrics {
  w: number;
  h: number;
  cx: number;
  cy: number;
  cz: number;
}

/**
 * Frame the bake from the model's own bounds.
 *
 * Bounds rather than the manifest height: the manifest number is what the rig is SCALED to,
 * and a creature whose arms reach past his head is taller in the bake than the number says.
 * Width takes the LARGER horizontal extent because he spins inside this frame: his depth
 * becomes his width a quarter turn later, and framing on x alone crops his profile.
 */
export function bossImpostorFrameMetrics(bounds: {
  min: Vec3Like;
  max: Vec3Like;
}): BossImpostorFrameMetrics {
  const { min, max } = bounds;
  const spanX = Math.max(max.x - min.x, max.z - min.z);
  return {
    w: spanX * BOSS_IMPOSTOR_FRAME_MARGIN,
    h: (max.y - min.y) * BOSS_IMPOSTOR_FRAME_MARGIN,
    cx: (min.x + max.x) / 2,
    cy: (min.y + max.y) / 2,
    cz: (min.z + max.z) / 2,
  };
}

/** Where the quad goes and how big it is, in world units. */
export interface BossImpostorQuadPlacement {
  w: number;
  h: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Put the quad exactly where the frozen far mesh was.
 *
 * The far mesh is drawn as `T(pos) * Ry(facing) * S(scale) * idleGeo`, so the frame's centre
 * takes the same three transforms and the frame's extent takes the scale. Sharing the
 * derivation with the bake is what makes the cut invisible: the frame the cell was shot in
 * and the rectangle the cell is drawn into are the same numbers, not a guess anchored at
 * `y + h / 2` that put the sprite a fraction of a body off the mesh it replaced.
 */
export function bossImpostorQuadPlacement(
  frame: BossImpostorFrameMetrics,
  scale: number,
  facing: number,
  pos: Vec3Like,
): BossImpostorQuadPlacement {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  // Three's Y rotation: x' = c*x + s*z, z' = -s*x + c*z.
  const ox = (c * frame.cx + s * frame.cz) * scale;
  const oz = (-s * frame.cx + c * frame.cz) * scale;
  return {
    w: frame.w * scale,
    h: frame.h * scale,
    x: pos.x + ox,
    y: pos.y + frame.cy * scale,
    z: pos.z + oz,
  };
}

/** The slice of the frame's day/night grade the sprite needs. */
export interface BossImpostorGradeInput {
  /** Multiplies the key light (1 = authored day). */
  lightScale: number;
  /** Multiplies the ambient half (hemisphere + IBL); sits on a higher night floor. */
  ambientScale: number;
  /** The realm's fog multiplier, which carries its night hue. */
  fog: readonly [number, number, number];
  /** 0 = full day, 1 = deepest night. */
  nightAmt: number;
}

/**
 * Per-channel multiplier that takes the fixed-daylight bake to the frame's live grade.
 *
 * The bake lit him under a fixed noon; the rig he stands in for is lit by the live sun and
 * sky, which the grade scales down after dark. Without this the sprite stays at noon while
 * the world goes to night, and a bright silhouette on a dark horizon reads as a glow, the
 * opposite of a body standing in the dark. Level first: the ambient half of the grade
 * weighted by the dome's share of the bake, the key half by the key's share. Then hue, both
 * halves luminance-neutral so the level is the only exposure knob: the realm's own night
 * tint (the same helper the renderer applies to its lights) and the moonlight cool.
 */
export function bossImpostorLightGrade(grade: BossImpostorGradeInput): [number, number, number] {
  const keyShare = BOSS_IMPOSTOR_BAKE_KEY_SHARE;
  const level = grade.ambientScale * (1 - keyShare) + grade.lightScale * keyShare;
  const night = Math.min(1, Math.max(0, grade.nightAmt));
  const realm = realmLightTint(grade.fog, night * REALM_MOON_TINT);
  const cool = night * BOSS_IMPOSTOR_NIGHT_COOL;
  return [
    level * realm[0] * (1 + (BOSS_IMPOSTOR_MOON_COOL[0] - 1) * cool),
    level * realm[1] * (1 + (BOSS_IMPOSTOR_MOON_COOL[1] - 1) * cool),
    level * realm[2] * (1 + (BOSS_IMPOSTOR_MOON_COOL[2] - 1) * cool),
  ];
}
