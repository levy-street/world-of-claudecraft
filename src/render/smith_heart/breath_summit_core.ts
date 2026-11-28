// Pure plan of the Storm Cornice's open sky (the Breath's third pass of
// 2026-11-03; breath_summit.ts paints it): the Cornice is the mountain's
// summit, its shoulders falling away on every open bearing
// (heart_walls_core.ts heartSummitOpen), and past them a sea of cloud far
// below and the far peaks of the range standing out of it to the north.
//
//  - the cloud sea: two decks of slow cloud, the upper one well under the
//    Cornice's floor, laid out north of the Breath's walks (never over a
//    walked floor, never over the Heart), thinning toward its edges so it
//    meets the sky with no line;
//  - the far peaks: the rock kit's needles (Kit_RockNeedleA, B) stood far
//    out in the north arc, sunk in the cloud and scaled up into a range, so
//    the open air has depth and a horizon.
// Cosmetic scenery: nothing here is a telegraph or touches a walk (two draws
// for the sea, the low tier one; a few instances for the peaks). Both reach
// past the instance slot's band (local z 250) into the sky beyond the map:
// render only, never a floor or a collider, drawn by the client's own slot.
// Three-free, DOM-free, deterministic (a hash, never rng).

import { BREATH, SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash } from './heart_plan_core';

/** A deck of the cloud sea: a rectangle (instance-local) at height `y`, its
 *  noise scale and drift speed. */
export interface BreathCloudDeck {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  scale: number;
  drift: number;
  alpha: number;
}

/** The two decks: the upper one 48 yd under the Cornice's floor, a second a
 *  little lower and slower under it (the sea's depth). North of the Breath's
 *  walks and west of the Heart's crown. */
export const BREATH_CLOUD_SEA: readonly BreathCloudDeck[] = [
  {
    x0: -320,
    x1: 110,
    z0: 214,
    z1: 660,
    y: BREATH.cornice.h - 48,
    scale: 0.011,
    drift: 0.012,
    alpha: 0.92,
  },
  {
    x0: -320,
    x1: 110,
    z0: 214,
    z1: 660,
    y: BREATH.cornice.h - 62,
    scale: 0.007,
    drift: 0.007,
    alpha: 0.8,
  },
];

/** The far peaks' arc: bearings (degrees from the Cornice's centre, 0 north)
 *  and distances (yards). */
export const BREATH_FAR_PEAKS = {
  count: 7,
  fromDeg: -58,
  toDeg: 52,
  near: 300,
  far: 430,
} as const;

/** The far peaks (the rock kit's needles), instance-local: sunk in the cloud
 *  sea and scaled up into a range. */
export function planBreathFarPeaks(): HeartKitPlacement[] {
  const C = BREATH.cornice;
  const P = BREATH_FAR_PEAKS;
  const out: HeartKitPlacement[] = [];
  for (let i = 0; i < P.count; i++) {
    const t = (i + 0.5) / P.count;
    const deg = P.fromDeg + (P.toDeg - P.fromDeg) * t + (heartHash(i, 401) - 0.5) * 9;
    const a = (deg * Math.PI) / 180;
    const d = P.near + (P.far - P.near) * heartHash(i, 409);
    const scale = 1.7 + heartHash(i, 419) * 1.1;
    out.push({
      piece: i % 2 ? 'Kit_RockNeedleB' : 'Kit_RockNeedleA',
      x: C.x + Math.sin(a) * d,
      // The foot well down in the sea, so only the peak stands out of it.
      y: BREATH_CLOUD_SEA[1].y - 40,
      z: C.z + Math.cos(a) * d,
      rot: heartHash(i, 431) * Math.PI * 2,
      scale,
      noShadow: true,
      cosmetic: false,
    });
  }
  return out;
}

/** Is (x, z) under the cloud sea's upper deck (instance-local)? */
export function underCloudSea(x: number, z: number): boolean {
  const d = BREATH_CLOUD_SEA[0];
  return x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1;
}

/** Does the cloud sea's upper deck lie under every walked floor it spreads
 *  over (sampled every few yards across its whole rectangle; the floating
 *  isles float over it by design)? */
export function breathSeaClearOfWalks(step = 4): boolean {
  const d = BREATH_CLOUD_SEA[0];
  const F = SMITH_HEART_FIELD;
  for (let x = d.x0; x <= d.x1; x += step)
    for (let z = d.z0; z <= d.z1; z += step) {
      const s = authoredFieldSurfaceAt(F, x, z);
      if (!s || s.hidden) continue;
      if (authoredFieldHeight(F, x, z) <= d.y + 4) return false;
    }
  return true;
}
