// Pure plan for the Smith's Heart's portal moments (heart_portal.ts paints
// them): the ring crystal bursting open into the portal, the living portal, the
// portal hop's arrival on either side, and the return portal in the Heart.
//
//   the opening (one shot, from the moment the slot's seal memory sees the
//     portal bit, set the moment a player breaks the crystal): the crystal
//     overloads and goes white-hot (`charge`, the crystal's own look:
//     ring_crystal_core.ts), shatters into a blinding pillar standing up off
//     the seal (`flash`), a four-colour shockwave races out over the floor and
//     across the void to the Ring (`ring`), and the vortex grows out of the
//     place it stood (`swirl`; its pieces fly and settle into an orbit round
//     it: ring_crystal_core.ts);
//   the living portal: a floor vortex of four spiral arms, one per vein's
//     colour, round a white-gold eye, and a funnel of light standing over it
//     (visible from every point of the Ring), with motes spiralling up it;
//   the hop: when the camera crosses from one area to the other in one frame
//     (the sim set its player down), an arrival burst stands at the landing
//     (a column, a floor ring) and a short white-gold flash washes the view.
//
// Readable at every tier: the vortex, the funnel and the burst draw on every
// preset (they are where the route goes); only the motes thin on the low
// tier (cosmetic). Three-free, DOM-free, deterministic.

import {
  HEART_ARRIVAL,
  inSmithHeartRoom,
  RING_PORTAL_LANDING,
} from '../../sim/content/smith_heart_layout';
import { HEART_SEAL_ARRIVAL } from './heart_seal_core';

/** The opening's timeline (seconds from the portal bit's first sighting). */
export const HEART_PORTAL_OPEN = {
  /** The crystal overloads and whitens (short: a raider has just stepped onto the
   *  dais, and the shatter must answer their arrival). */
  charge: 0.55,
  /** The flash pillar's fade, from the charge's end (short: the shatter must read
   *  through it). */
  flash: 0.8,
  /** The shockwave's run, from the charge's end. */
  ring: 1.9,
  /** The vortex's growth, from a little after the charge. */
  swirl: 2.2,
} as const;
/** How far the shockwave runs (yards from the seal: across the void to the
 *  Ring's outer edge). */
export const HEART_PORTAL_RING_REACH = 82;
/** The camera's jolts (phase 2F, presentation only: the renderer's shake
 *  sink honours reduced motion, the caller scales them by distance): as the
 *  crystal breaks, a tremor through the overload, the heavy jolt on the flash,
 *  an aftershock as the pieces climb; as a vein's light reaches the seal, a
 *  thud. Seconds on each moment's own clock. */
export const HEART_PORTAL_SHAKES: readonly { at: number; amount: number }[] = [
  { at: HEART_PORTAL_OPEN.charge * 0.5, amount: 0.16 },
  { at: HEART_PORTAL_OPEN.charge, amount: 0.8 },
  { at: HEART_PORTAL_OPEN.charge + 0.7, amount: 0.3 },
];
export const HEART_ARRIVAL_SHAKES: readonly { at: number; amount: number }[] = [
  { at: HEART_SEAL_ARRIVAL, amount: 0.22 },
];

/** The jolt due as a moment's clock moved from `prev` to `now` (seconds;
 *  a clock first seen, prev null, is never due: a moment met long done
 *  never shakes). */
export function heartShakeDue(
  schedule: readonly { at: number; amount: number }[],
  prev: number | null,
  now: number,
): number {
  if (prev === null || now < 0 || (prev < 0 && now < 0)) return 0;
  let sum = 0;
  for (const s of schedule) if (s.at > prev && s.at <= now) sum += s.amount;
  return sum;
}

/** How tall the portal's beam to the sky stands (yards over the dais: past
 *  the storm's cloud floor). */
export const HEART_PORTAL_SKY_BEAM = 420;
/** The floor vortex's radius and the funnel's height and radii (yards). */
export const HEART_PORTAL_SIZE = {
  vortexR: 8.4,
  funnelHeight: 26,
  funnelFoot: 3.2,
  funnelTop: 8.5,
} as const;
/** The return portal's size in the Heart (yards). */
export const HEART_RETURN_SIZE = {
  vortexR: 3.8,
  funnelHeight: 9,
  funnelFoot: 1.5,
  funnelTop: 3.2,
} as const;

/** The opening's stages at `since` seconds (-1 while shut). A portal met
 *  already open (`since` far past the timeline) is whole, no burst. */
export interface HeartPortalStage {
  charge: number;
  flash: number;
  ring: number;
  swirl: number;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function ease(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Write the opening's stages at `since` into `out` (allocation-free). */
export function heartPortalStage(
  since: number,
  out: HeartPortalStage = { charge: 0, flash: 0, ring: 0, swirl: 0 },
): HeartPortalStage {
  if (since < 0) {
    out.charge = 0;
    out.flash = 0;
    out.ring = 0;
    out.swirl = 0;
    return out;
  }
  const O = HEART_PORTAL_OPEN;
  const after = since - O.charge;
  // The charge swells, then hands over to the flash.
  out.charge = after < 0 ? ease(since / O.charge) : clamp01(1 - after / 0.5);
  out.flash = after < 0 ? 0 : Math.min(1, after / 0.08) * (1 - clamp01(after / O.flash)) ** 2;
  // The ring runs 0 to 1, then reads 0 (gone) past its run.
  out.ring = after < 0 || after > O.ring ? 0 : Math.max(0.001, after / O.ring);
  out.swirl = ease((after - 0.15) / O.swirl);
  return out;
}

/** The hop's arrival burst at `since` seconds after the hop (-1: none). */
export interface HeartHopStage {
  column: number;
  ring: number;
  flash: number;
}

/** Seconds the arrival burst lasts. */
export const HEART_HOP_SECONDS = 1.6;

export function heartHopStage(
  since: number,
  out: HeartHopStage = { column: 0, ring: 0, flash: 0 },
): HeartHopStage {
  if (since < 0 || since > HEART_HOP_SECONDS) {
    out.column = 0;
    out.ring = 0;
    out.flash = 0;
    return out;
  }
  out.column = Math.min(1, since / 0.1) * (1 - since / HEART_HOP_SECONDS) ** 1.4;
  out.ring = Math.max(0.001, clamp01(since / 1.1));
  out.flash = (1 - clamp01(since / 0.65)) ** 2;
  return out;
}

/** Which side a hop landed on, or null for any ordinary frame: the camera
 *  (instance-local) jumped further than any run or charge can carry it, out
 *  of one area into the other. */
export function heartHopLanding(
  prev: { x: number; z: number } | null,
  cur: { x: number; z: number },
): 'heart' | 'ring' | null {
  if (!prev) return null;
  if (Math.hypot(cur.x - prev.x, cur.z - prev.z) < 60) return null;
  const was = inSmithHeartRoom(prev.x, prev.z);
  const now = inSmithHeartRoom(cur.x, cur.z);
  if (was === now) return null;
  return now ? 'heart' : 'ring';
}

/** Where the arrival burst stands for a landing side (instance-local). */
export function heartHopSpot(side: 'heart' | 'ring'): { x: number; z: number } {
  return side === 'heart'
    ? { x: HEART_ARRIVAL.x, z: HEART_ARRIVAL.z }
    : { x: RING_PORTAL_LANDING.x, z: RING_PORTAL_LANDING.z };
}

/** The portal's motes by the static effects preset (never the FPS governor):
 *  a cosmetic shed. */
export function heartPortalMoteCount(lowGfx: boolean): number {
  return lowGfx ? 48 : 180;
}

/** How fast the sky and the area grade cross over after a hop (per second). */
export const HEART_AREA_BLEND_RATE = 0.9;

/** Ease the area blend (0 the main map, 1 the Heart) toward the camera's area
 *  over `dt` seconds; a jump of more than a few seconds snaps. */
export function heartAreaBlend(current: number, inHeart: boolean, dt: number): number {
  const target = inHeart ? 1 : 0;
  if (dt > 3) return target;
  const step = HEART_AREA_BLEND_RATE * Math.max(0, dt);
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

/** The Heart's exit portal (the team's review of 2026-11-17: the way out once
 *  the final boss falls): the return portal's rig, a size larger so it reads
 *  across the platform. */
export const HEART_EXIT_SIZE = {
  vortexR: 4.6,
  funnelHeight: 14,
  funnelFoot: 1.8,
  funnelTop: 4.2,
} as const;
/** Seconds the exit portal takes to whirl open after the fall. */
export const HEART_EXIT_OPEN_SECONDS = 2.5;

/** How open the exit portal stands (0 shut, 1 whole) `since` seconds after
 *  the final boss fell (-1: still standing): eased out, a portal first seen
 *  already open (a late arrival) whole at once. Pure. */
export function heartExitOpen(since: number): number {
  if (since < 0) return 0;
  const t = Math.min(1, since / HEART_EXIT_OPEN_SECONDS);
  return 1 - (1 - t) * (1 - t);
}
