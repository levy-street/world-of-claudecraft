// Pure plan for the Sledge Tusker's bait rework (tusker_bait_fx.ts): the ice
// outcrops' three looks off their template ids, the shape of an outcrop (a
// cluster of glacier fangs, the tallest three times a player) and of the stump
// it leaves, the shudder and the cracks of an outcrop the tusks are buried in,
// the soulfire trail's life (it races down the lane as the charge runs,
// stands, and gutters over its last seconds), the gold ring under a stuck
// Tusker and the ring round the outcrop a painted lane will end in.
//
// Three-free, DOM-free, deterministic.

import {
  SANCTUM_ICE_OUTCROP,
  SANCTUM_ICE_OUTCROP_BROKEN,
  SANCTUM_ICE_OUTCROP_STRUCK,
  TUSKER_TUNING,
} from '../../sim/encounters/gravewyrm_sanctum/ids';

// ---- the outcrops ----------------------------------------------------------------

export type OutcropPhase = 'whole' | 'struck' | 'broken';

/** An outcrop object's look off its template id, or null for any other object. */
export function outcropPhase(templateId: string): OutcropPhase | null {
  if (templateId === SANCTUM_ICE_OUTCROP) return 'whole';
  if (templateId === SANCTUM_ICE_OUTCROP_STRUCK) return 'struck';
  if (templateId === SANCTUM_ICE_OUTCROP_BROKEN) return 'broken';
  return null;
}

/** A player stands 2.6 yd: the tallest fang stands three of them. */
export const OUTCROP_HEIGHT = 7.8;

/** One fang of the cluster: where its foot stands off the outcrop's centre
 *  (yards), its foot's radius, its height, how far its tip leans (yards, x
 *  and z), how many sides it is cut with and its twist (radians). */
export interface OutcropFang {
  x: number;
  z: number;
  r: number;
  h: number;
  leanX: number;
  leanZ: number;
  sides: number;
  twist: number;
}

/** The cluster: one great fang, three shoulders and a rim of teeth. Every foot
 *  stands inside the 2 yd body the sim tests (TUSKER_TUNING.outcropRadius). */
export const OUTCROP_FANGS: readonly OutcropFang[] = [
  { x: 0.1, z: 0, r: 1.25, h: OUTCROP_HEIGHT, leanX: 0.5, leanZ: -0.3, sides: 6, twist: 0.2 },
  { x: -0.95, z: 0.55, r: 0.95, h: 5.6, leanX: -1.0, leanZ: 0.5, sides: 5, twist: 0.9 },
  { x: 0.85, z: 0.8, r: 0.85, h: 4.7, leanX: 0.9, leanZ: 1.1, sides: 5, twist: 1.7 },
  { x: 0.35, z: -1.05, r: 0.8, h: 4.1, leanX: 0.4, leanZ: -1.3, sides: 5, twist: 2.6 },
  { x: -1.15, z: -0.6, r: 0.6, h: 2.7, leanX: -0.9, leanZ: -0.6, sides: 4, twist: 0.4 },
  { x: 1.3, z: -0.25, r: 0.55, h: 2.3, leanX: 0.9, leanZ: -0.2, sides: 4, twist: 1.2 },
  { x: -0.3, z: 1.35, r: 0.5, h: 1.9, leanX: -0.2, leanZ: 0.8, sides: 4, twist: 2.1 },
];

/** The stump a burst outcrop leaves: the fangs' feet, snapped off low and
 *  jagged, and the blocks that fell round them (x, z, radius, height, tilt). */
export const OUTCROP_STUMPS: readonly {
  x: number;
  z: number;
  r: number;
  h: number;
  tilt: number;
  sides: number;
}[] = [
  { x: 0.1, z: 0, r: 1.25, h: 1.5, tilt: 0.28, sides: 6 },
  { x: -0.95, z: 0.55, r: 0.95, h: 1.05, tilt: -0.34, sides: 5 },
  { x: 0.85, z: 0.8, r: 0.85, h: 0.8, tilt: 0.4, sides: 5 },
  { x: 0.35, z: -1.05, r: 0.8, h: 0.95, tilt: -0.22, sides: 5 },
  { x: -1.15, z: -0.6, r: 0.6, h: 0.55, tilt: 0.3, sides: 4 },
  // Fallen blocks, lying on the snow round the stump.
  { x: 2.3, z: 0.9, r: 0.5, h: 0.5, tilt: 1.2, sides: 4 },
  { x: -2.1, z: -1.4, r: 0.6, h: 0.45, tilt: -1.3, sides: 5 },
  { x: -0.6, z: 2.4, r: 0.42, h: 0.4, tilt: 1.45, sides: 4 },
  { x: 1.7, z: -2.0, r: 0.38, h: 0.36, tilt: -1.1, sides: 4 },
];

/** Every fang's foot stands inside the body the sim tests. */
export function outcropFootprint(): number {
  let reach = 0;
  for (const f of OUTCROP_FANGS) reach = Math.max(reach, Math.hypot(f.x, f.z) + f.r);
  return reach;
}

/** Seconds the white flash of an impact (the tusks going in, the burst) lasts. */
export const OUTCROP_FLASH_SECONDS = 0.45;

/** The flash `t` seconds after an impact: 1 at once, gone by OUTCROP_FLASH_SECONDS. */
export function outcropFlash(t: number): number {
  if (t < 0 || t >= OUTCROP_FLASH_SECONDS) return 0;
  const k = 1 - t / OUTCROP_FLASH_SECONDS;
  return k * k;
}

/**
 * An outcrop the tusks are buried in, `held` seconds into the hold with
 * `left` to go: how far it is shoved off its foot (yards, along the charge),
 * how hard it shudders (yards of jitter) and how bright its cracks burn
 * (0..1). The slam shoves it and dies away; the cracks spread through the
 * hold; over the last second the beast heaves and it shudders hard again.
 */
export function struckOutcrop(
  held: number,
  left: number,
  out: { shove: number; jitter: number; cracks: number } = { shove: 0, jitter: 0, cracks: 0 },
): { shove: number; jitter: number; cracks: number } {
  const t = Math.max(0, held);
  const slam = Math.exp(-t * 3.2);
  const heave = left < 1.2 ? (1.2 - Math.max(0, left)) / 1.2 : 0;
  out.shove = 0.45 * slam;
  out.jitter = 0.05 + 0.16 * slam + 0.14 * heave * heave;
  out.cracks = Math.min(1, 0.55 + 0.25 * Math.min(1, t / 2) + 0.2 * heave);
  return out;
}

/** The ice-blue ring round the outcrop a painted Trample lane will end in
 *  (yards): a step wider than the fangs' feet and its floor circle
 *  (tusker_aim_fx_core.ts), so it reads round the ice from above. */
export const BAIT_RING_RADIUS = TUSKER_TUNING.outcropRadius + 1.6;

// ---- the stuck Tusker ---------------------------------------------------------------

/** The gesture that plays the Tusker pawing the ice while its tusks are stuck
 *  (characters/sanctum_creature_looks.ts maps it to its TrampleWindup clip). */
export const TUSKER_STRAIN_GESTURE = 'sanctum_tusker_strain';

/** The gold ring under a Tusker stuck in the ice (yards): wider than its
 *  flanks (its coat stands 3 yd either side). */
export const STUCK_RING_RADIUS = 7;

/** The window's floor ring: its fill is the share of the window left (it
 *  drains to nothing as the beast wrenches free) and it beats faster as it
 *  ends. The Sunstruck ring's own law, so every damage window reads alike. */
export function stuckRing(
  remaining: number,
  duration: number,
  t: number,
): { fill: number; fade: number } {
  const left = duration > 0 ? Math.min(1, Math.max(0, remaining / duration)) : 0;
  const rate = 7 + 9 * (1 - left);
  return { fill: left, fade: 0.78 + 0.22 * Math.sin(t * rate) };
}

// ---- the soulfire trail ---------------------------------------------------------------

export const TRAIL_LOOK = {
  /** The flames stand well over a player (2.6 yd). */
  flameHeight: 4.6,
  /** The fire races down the lane as the charge runs it. */
  igniteSeconds: TUSKER_TUNING.trampleRun + 0.25,
  /** It gutters over its last seconds (the flames shrink; the edge holds
   *  until the sim puts it out). */
  gutterSeconds: 3,
  /** The cross walls of flame along a trail (the strip's volume). */
  crossWalls: 12,
} as const;

/**
 * A trail's look `age` seconds after the painter first saw it, with
 * `remaining` of `total` seconds left on its own clock: how far down the lane
 * the fire has caught (0..1), how tall the flames stand (0..1) and how bright
 * the floor edge is (it never fades while the trail still burns: the edge is
 * the edge the sim tests).
 */
export function trailPresence(
  age: number,
  remaining: number,
  total: number,
  out: { front: number; flames: number; edge: number } = { front: 0, flames: 0, edge: 0 },
): { front: number; flames: number; edge: number } {
  // A trail the painter meets already burning (a late view) is lit end to end.
  const burned = total - remaining;
  const lit = Math.max(age, burned);
  out.front = Math.min(1, Math.max(0, lit / TRAIL_LOOK.igniteSeconds));
  const gutter = Math.min(1, Math.max(0, remaining / TRAIL_LOOK.gutterSeconds));
  out.flames = 0.3 + 0.7 * gutter;
  out.edge = remaining > 0 ? 1 : 0;
  return out;
}

/** How many of each pooled look the painter builds: every outcrop of the road
 *  and one spare; the two trails that can burn at once and one spare. */
export const BAIT_POOLS = { outcrops: 6, trails: 3 } as const;
