// The Guardian of the Quench's holes in the ice, read as real holes (the
// owner's heroic run of 2026-11-17: "it barely shows and does not feel like a
// hole"). Pure: the measures the shader and the painter share, the shards of
// broken ice heaved up round a hole's lip, and the moments a hole and a fall
// into it play (QuenchFightFx paints them; quench_hole_glsl.ts draws the
// sunken water and the ice walls falling to it by parallax, so the hole has
// depth from any camera without cutting the lake's floor).
//
// Three-free, DOM-free, deterministic (hashed, never rng).

/** The hole's disc reaches this far past the hole's own radius: the broken
 *  ice and its cracks round the lip draw on the lake past the edge. */
export const HOLE_DISC_SCALE = 1.45;
/** The hole's edge in the disc's own units (0..1): the sim's radius. */
export const HOLE_EDGE = 1 / HOLE_DISC_SCALE;
/** How deep the water lies under the ice (yards): the walls fall this far. */
export const HOLE_DEPTH = 1.6;
/** Shards of broken ice heaved up round each hole's lip. */
export const HOLE_SHARDS = 9;
/** Mist breathing off the open water: puffs a second at full density. */
export const HOLE_MIST_RATE = 3;

/** The break's shards and water that draw on EVERY preset (the low tier sheds
 *  only what is past this): the team's playtest of 2026-11-25 asked the ice
 *  giving way to be a moment a raid sees whatever its settings. */
export const HOLE_BREAK_FLOOR = 10;

function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface HoleShard {
  /** Offset from the hole's centre (yards). */
  x: number;
  z: number;
  /** Its height, width, its lean outward (radians) and its yaw. */
  h: number;
  w: number;
  lean: number;
  yaw: number;
}

/** Shard `k` of the hole with seed `seed` and radius `r`: on the lip, a
 *  little outside it, leaning out away from the water as ice heaves. Fills
 *  `out`. */
export function holeShard(seed: number, k: number, r: number, out: HoleShard): HoleShard {
  const a = ((k + 0.35 * hash(seed, k)) / HOLE_SHARDS) * Math.PI * 2;
  const d = r * (1.02 + 0.16 * hash(seed, k + 31));
  out.x = Math.sin(a) * d;
  out.z = Math.cos(a) * d;
  out.h = 0.35 + 0.75 * hash(seed, k + 57);
  out.w = 0.45 + 0.4 * hash(seed, k + 89);
  out.lean = 0.35 + 0.45 * hash(seed, k + 113);
  out.yaw = a;
  return out;
}

/** The break's rise: shards burst up out of the ice over the hole's first
 *  moments (0 flat, 1 heaved). */
export function holeHeave(elapsed: number): number {
  const t = Math.max(0, Math.min(1, elapsed / 0.45));
  return 1 - (1 - t) * (1 - t) * (1 - t);
}
