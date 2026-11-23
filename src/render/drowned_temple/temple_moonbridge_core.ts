// Pure timeline of the Moonbridge forming (the Temple encounter pass): when
// the Tideglass Colossus falls, the prism in its chest charges and fires a
// beam of moonlight west to the Altar Landing, and the bridge's slabs build
// along the beam, each one appearing with a flash as the beam's front passes
// it; the balustrades rise once the last slab has settled. The gate rig
// (temple_gates.ts) and the beam layer (temple_moonbridge_fx.ts) both read
// this one timeline off the gate memory's reveal clock (seconds since the
// gate opened), so the slabs and the beam always agree.
//
// Three-free, DOM-free, deterministic.

import { MOONBRIDGE, PRISM_PLINTH } from '../../sim/content/drowned_temple_layout';

/** How many slabs the bridge builds from. */
export const MOONBRIDGE_PLANKS = 22;

/** The moment's beats, in seconds from the gate opening. */
export const MOONBRIDGE_MOMENT = {
  /** The prism charges in the fallen Colossus's chest. */
  charge: 0.45,
  /** The beam's front runs from the prism to the Altar Landing. */
  travel: 1.3,
  /** A slab rises into place this long after the front passes it. */
  rise: 0.28,
  /** A slab's flash fades over this long. */
  flash: 0.7,
  /** The beam holds at full strength this long after reaching the landing. */
  hold: 1.4,
  /** Then it fades out over this long. */
  fade: 1.6,
} as const;

/** Where the beam starts (instance-local x: the Colossus's plinth). */
export const MOONBRIDGE_BEAM_FROM_X = PRISM_PLINTH.x;
/** Where the beam ends (instance-local x: the Altar Landing's edge). */
export const MOONBRIDGE_BEAM_TO_X = MOONBRIDGE.toX;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Seconds after the gate opens when the beam's front reaches local x. */
export function moonbridgeBeamReaches(x: number): number {
  const M = MOONBRIDGE_MOMENT;
  const f = (MOONBRIDGE_BEAM_FROM_X - x) / (MOONBRIDGE_BEAM_FROM_X - MOONBRIDGE_BEAM_TO_X);
  return M.charge + M.travel * clamp01(f);
}

/** How far along its run the beam's front is (0 at the prism, 1 at the
 *  landing). */
export function moonbridgeBeamFront(since: number): number {
  const M = MOONBRIDGE_MOMENT;
  return clamp01((since - M.charge) / M.travel);
}

/** The beam's strength: it swells while the prism charges, holds while it
 *  runs and a beat after, then fades. 0 outside the moment. */
export function moonbridgeBeamStrength(since: number): number {
  const M = MOONBRIDGE_MOMENT;
  if (since < 0) return 0;
  if (since < M.charge) return 0.35 * (since / M.charge);
  const full = M.charge + M.travel + M.hold;
  if (since <= full) return 1;
  return clamp01(1 - (since - full) / M.fade);
}

/** The prism's charge glow in the fallen chest (peaks as the beam fires). */
export function moonbridgePrismGlow(since: number): number {
  const M = MOONBRIDGE_MOMENT;
  if (since < 0) return 0;
  if (since < M.charge) return (since / M.charge) ** 2;
  return clamp01(1 - (since - M.charge) / (M.travel + M.hold));
}

/** The whole moment, beam faded included. */
export const MOONBRIDGE_MOMENT_SECONDS =
  MOONBRIDGE_MOMENT.charge +
  MOONBRIDGE_MOMENT.travel +
  MOONBRIDGE_MOMENT.hold +
  MOONBRIDGE_MOMENT.fade;

/** Slab i's middle (local x along the drawn span from fromX to toX). */
export function moonbridgePlankX(i: number, fromX: number, toX: number): number {
  return fromX + ((toX - fromX) * (i + 0.5)) / MOONBRIDGE_PLANKS;
}

/** Seconds after the gate opens when slab i appears (the front passes it). */
export function moonbridgePlankAppears(i: number, fromX: number, toX: number): number {
  return moonbridgeBeamReaches(moonbridgePlankX(i, fromX, toX));
}

/** How far slab i has risen into place (0 unmade, 1 laid). */
export function moonbridgePlankRise(i: number, fromX: number, toX: number, since: number): number {
  const t = since - moonbridgePlankAppears(i, fromX, toX);
  return clamp01(t / MOONBRIDGE_MOMENT.rise);
}

/** Slab i's flash (1 the instant it appears, gone after `flash`). */
export function moonbridgePlankFlash(i: number, fromX: number, toX: number, since: number): number {
  const t = since - moonbridgePlankAppears(i, fromX, toX);
  if (t < 0) return 0;
  return clamp01(1 - t / MOONBRIDGE_MOMENT.flash);
}

/** Seconds after the gate opens when the last slab has settled (the
 *  balustrades rise then). */
export function moonbridgeLaid(fromX: number, toX: number): number {
  return moonbridgePlankAppears(MOONBRIDGE_PLANKS - 1, fromX, toX) + MOONBRIDGE_MOMENT.rise;
}

/** The one-shot beats of the moment (sound, camera, burst), as bits. */
export const MOONBRIDGE_BEAT = { fire: 1, arrive: 2, laid: 4 } as const;

/** Which beats fall in (prev, now], as MOONBRIDGE_BEAT bits: each fires once
 *  as the clock crosses it (allocation-free, read every frame of the moment). */
export function moonbridgeBeatsBetween(
  prev: number,
  now: number,
  fromX: number,
  toX: number,
): number {
  const M = MOONBRIDGE_MOMENT;
  const B = MOONBRIDGE_BEAT;
  const crossed = (t: number): boolean => prev < t && now >= t;
  return (
    (crossed(M.charge) ? B.fire : 0) |
    (crossed(M.charge + M.travel) ? B.arrive : 0) |
    (crossed(moonbridgeLaid(fromX, toX)) ? B.laid : 0)
  );
}
