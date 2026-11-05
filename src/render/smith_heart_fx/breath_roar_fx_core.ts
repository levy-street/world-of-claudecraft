// Pure look of the Summit Roar and the indrawn breath before it (the
// Guardian of the Breath, the third pass of 2026-11-03; breath_roar_fx.ts
// paints it; the sim: encounters/smith_heart/breath_roar.ts). The wave's
// front is the sim's own (BREATH_TUNING.roarSpeed from where the exhale
// left the maw), so the ring on the floor reaches each body as the sim
// strikes it. Three-free, DOM-free, deterministic.
//
// Readability (binding): the wave's ring and wall and the hit's impact draw
// on EVERY tier (the raid reads the blow coming); the debris, the dust on
// the front, the trails' grit and the screen's wind thin on the low tier,
// and the screen's wind and the shakes go under reduced motion.

import { inBreathArena } from '../../sim/encounters/smith_heart/breath_geometry';
import { BREATH_DIFFICULTY, BREATH_TUNING as T } from '../../sim/encounters/smith_heart/breath_ids';
import { breathGuardianKit } from './breath_fx_core';

/** How far the wave runs (the guardian's reach: the Cornice from its maw)
 *  and how fast (the sim's). */
export function roarReach(): number {
  const k = breathGuardianKit();
  return k.gustRadius + k.gustShove * 0.8;
}
export const ROAR_SPEED = T.roarSpeed;

/** The wave `elapsed` seconds after the exhale: its front's radius (the
 *  sim's), the wall's height (tall as it leaves, a knee by the rim), its
 *  strength, and the two trailing rings' radii (the air still rippling). */
export function roarWaveLook(
  elapsed: number,
  reach: number = roarReach(),
): { front: number; height: number; alpha: number; trail1: number; trail2: number } {
  const t = Math.max(0, elapsed);
  const front = Math.min(reach, t * ROAR_SPEED);
  const k = reach > 0 ? front / reach : 1;
  const span = reach / ROAR_SPEED;
  const after = Math.max(0, t - span);
  return {
    front,
    height: 9 * (1 - k) + 2.4,
    alpha: elapsed < 0 ? 0 : Math.max(0, 1 - after / 0.6) * (0.75 + 0.25 * (1 - k)),
    trail1: Math.max(0, front - 5),
    trail2: Math.max(0, front - 11),
  };
}

/** The Roar's longest throw on any tier (the client cannot tell the tier,
 *  so the landing it shows is the farthest one: a spot that reads safe is). */
export const ROAR_THROW = Math.max(
  BREATH_DIFFICULTY.normal.gustThrow,
  BREATH_DIFFICULTY.heroic.gustThrow,
  BREATH_DIFFICULTY.mythic.gustThrow,
);

/** Where the Roar throws a body standing at claim-local (px, pz) with the
 *  guardian at (gx, gz): straight away from the guardian, `ROAR_THROW` yards
 *  (the sim's own rule, breath_roar.ts), and whether that spot lies off the
 *  Cornice (over the void). The local player's landing marker while it draws
 *  breath (the Heroic readability pass of 2026-11-05: nothing showed where
 *  the blow flings you, so a body by an open lip read as safe). */
export function roarLanding(
  px: number,
  pz: number,
  gx: number,
  gz: number,
  throwYd: number = ROAR_THROW,
): { x: number; z: number; overVoid: boolean } {
  const dx = px - gx;
  const dz = pz - gz;
  const d = Math.hypot(dx, dz);
  const ux = d > 1e-3 ? dx / d : 0;
  const uz = d > 1e-3 ? dz / d : 1;
  const x = px + ux * throwYd;
  const z = pz + uz * throwYd;
  // The whole path, not just its end: a throw over a bay lands in the void.
  let overVoid = false;
  for (let k = 1; k <= 6 && !overVoid; k++) {
    const f = k / 6;
    if (!inBreathArena(px + ux * throwYd * f, pz + uz * throwYd * f)) overVoid = true;
  }
  return { x, z, overVoid };
}

/** Seconds a struck body's trail streams behind it (its slide, and a
 *  moment more). */
export const ROAR_TRAIL_SECONDS = T.roarSlide + 0.35;

/** The screen's wind at its strongest: held well under full so the floor,
 *  the landing marker and the rim stay readable through the indrawn breath
 *  (the Heroic readability pass of 2026-11-05: at full it washed them out). */
export const INHALE_SCREEN_MAX = 0.6;

/** The screen's wind while the guardian draws breath: 0 when not, rising
 *  with the bar to INHALE_SCREEN_MAX by the end (only for a body on the Cornice). */
export function inhaleScreenWind(fill: number, drawing: boolean): number {
  if (!drawing) return 0;
  const f = Math.max(0, Math.min(1, fill));
  return 0.2 + (INHALE_SCREEN_MAX - 0.2) * f * f;
}
