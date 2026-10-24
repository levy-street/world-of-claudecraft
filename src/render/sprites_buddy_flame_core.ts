// Pure motion and colour math for the live flame over each of the sprite
// buddy's two orbs (Flicker and Glimmer; the Three half is
// sprites_buddy_flame.ts, the look reference docs/design/sprites-buddy/
// flame_preview.py).
//
// Each orb's flame is a see-through cone that leans away from the orb's real
// motion through the air, on a spring a little under critical damping so it
// overshoots and settles, and stretches with speed. The motion is the orb's
// world-space velocity frame to frame, so it covers the buddy heeling its
// owner (walking, running, turning, stopping) and the orb's own clip motion
// (hops, bounces, the merge) alike. Colour follows the merge: teal's flame
// fades as it sinks inside gold, and gold's turns green with the green shell
// the clip pushes out over it.
//
// Three/DOM-free and deterministic: tests/sprites_buddy_flame_core.test.ts.

/** Lean (tilt tangent) per unit of horizontal speed, in world units/second. */
export const SPRITE_FLAME_LEAN_PER_SPEED = 0.1;
/** Steepest lean, as a tilt tangent (30 degrees). */
export const SPRITE_FLAME_MAX_LEAN = Math.tan((30 * Math.PI) / 180);
/** Lean spring stiffness and damping (a little under critical: it overshoots). */
export const SPRITE_FLAME_STIFFNESS = 90;
export const SPRITE_FLAME_DAMPING = 11;
/** Extra length per unit of speed, and its cap. */
export const SPRITE_FLAME_STRETCH_PER_SPEED = 0.02;
export const SPRITE_FLAME_MAX_STRETCH = 0.12;
/** Above this speed a step is a teleport (respawn, zone-in, pool reuse), not
 *  motion: the flame resets instead of whipping flat. */
export const SPRITE_FLAME_TELEPORT_SPEED = 40;
/** Integration substep, so a slow frame cannot blow the spring up. */
const MAX_STEP = 1 / 120;

export interface SpriteFlameState {
  /** Current lean: horizontal tilt tangents along world X and Z. */
  leanX: number;
  leanZ: number;
  /** Lean rate (the spring's velocity). */
  rateX: number;
  rateZ: number;
  /** Current length multiplier (1 at rest). */
  stretch: number;
  /** The orb's previous world position; `primed` false until the first step. */
  prevX: number;
  prevY: number;
  prevZ: number;
  primed: boolean;
}

export function createSpriteFlameState(): SpriteFlameState {
  return {
    leanX: 0,
    leanZ: 0,
    rateX: 0,
    rateZ: 0,
    stretch: 1,
    prevX: 0,
    prevY: 0,
    prevZ: 0,
    primed: false,
  };
}

/** Advance one orb's flame to the orb's new world position `dt` seconds on. */
export function stepSpriteFlame(
  state: SpriteFlameState,
  x: number,
  y: number,
  z: number,
  dt: number,
): void {
  if (!state.primed || !(dt > 0)) {
    state.prevX = x;
    state.prevY = y;
    state.prevZ = z;
    state.primed = true;
    return;
  }
  const vx = (x - state.prevX) / dt;
  const vy = (y - state.prevY) / dt;
  const vz = (z - state.prevZ) / dt;
  state.prevX = x;
  state.prevY = y;
  state.prevZ = z;
  const speed = Math.hypot(vx, vy, vz);
  if (speed > SPRITE_FLAME_TELEPORT_SPEED) {
    state.leanX = state.leanZ = state.rateX = state.rateZ = 0;
    state.stretch = 1;
    return;
  }
  // Only sideways motion tips the flame; vertical motion only stretches it.
  let targetX = -vx * SPRITE_FLAME_LEAN_PER_SPEED;
  let targetZ = -vz * SPRITE_FLAME_LEAN_PER_SPEED;
  const tilt = Math.hypot(targetX, targetZ);
  if (tilt > SPRITE_FLAME_MAX_LEAN) {
    targetX *= SPRITE_FLAME_MAX_LEAN / tilt;
    targetZ *= SPRITE_FLAME_MAX_LEAN / tilt;
  }
  const targetStretch =
    1 + Math.min(SPRITE_FLAME_STRETCH_PER_SPEED * speed, SPRITE_FLAME_MAX_STRETCH);
  let left = dt;
  while (left > 0) {
    const h = Math.min(left, MAX_STEP);
    left -= h;
    state.rateX +=
      ((targetX - state.leanX) * SPRITE_FLAME_STIFFNESS - state.rateX * SPRITE_FLAME_DAMPING) * h;
    state.rateZ +=
      ((targetZ - state.leanZ) * SPRITE_FLAME_STIFFNESS - state.rateZ * SPRITE_FLAME_DAMPING) * h;
    state.leanX += state.rateX * h;
    state.leanZ += state.rateZ * h;
    state.stretch += (targetStretch - state.stretch) * Math.min(1, 8 * h);
  }
}

/** How deep orb b sits inside orb a: 0 just touching (or apart, below 0), 1
 *  wholly swallowed. Centres in world units, radii likewise. */
export function spriteMergeDepth(
  ax: number,
  ay: number,
  az: number,
  ar: number,
  bx: number,
  by: number,
  bz: number,
  br: number,
): number {
  if (!(br > 0)) return 0;
  return (ar + br - Math.hypot(bx - ax, by - ay, bz - az)) / (2 * br);
}

function smooth01(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

/** Teal's flame opacity at a merge depth: it fades as teal sinks into gold. */
export function tealFlameFade(depth: number): number {
  return 1 - smooth01((depth - 0.45) / 0.4);
}

/** The green shell's rest and fully-shown radii, in sprite radii
 *  (docs/design/sprites-buddy/animate_sprites.py MERGED_HIDE/MERGED_SHOW). */
export const SPRITE_SHELL_HIDE = 0.9;
export const SPRITE_SHELL_SHOW = 1.0055;

/** Gold's flame green mix from the scale of the shell ring a quarter turn from
 *  the seam (`gold_merged_12`): 0 while that band of the shell rests hidden, 1
 *  once it shows, so the flame turns green as the green covers half the orb. */
export function goldFlameGreen(ringScale: number): number {
  const shown = SPRITE_SHELL_SHOW / SPRITE_SHELL_HIDE;
  return smooth01((ringScale - 1) / (shown - 1));
}
