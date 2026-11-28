// PURE: the Heat's set round its hall (the dressed arena concept of 2026-11-10, the owner's
// "make it as close as possible"): the hall an island over a crusted magma lake, the
// tiers of basalt (heat_env_plan_core.ts `HEAT_ENV_TIERS`) rising out of it, molten falls
// pouring down the cliffs into it, a hot spot and a glow where each lands, smoke climbing
// between the tiers. The painter is heat_env_set.ts; all of it is drawn only from the Heat
// (env_area_clip.ts), where the rock between the hall and the tiers is opened down to a
// breath over the lake. Three-free, DOM-free, deterministic.

import { HEAT } from '../../sim/content/smith_heart_layout';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash } from './heart_plan_core';
import {
  HEAT_ENV_OPEN,
  HEAT_ENV_RING,
  HEAT_ENV_TIERS,
  heatEnvFallPlacements,
  heatEnvRockMeasure,
  planHeatEnvRing,
} from './heat_env_plan_core';

/** The magma lake round the hall: a flat annulus at `y` (under the floor, over the open
 *  region's floor `HEAT_ENV_OPEN.y0` less a breath, so the cut rock meets it) from `r0`
 *  (under the hall's lip) to `r1` (behind the far crown's feet), never down the way in
 *  (`eastDeg` either side of due east, where the old rock still stands), `rings` by
 *  `segs` cells. */
export const HEAT_ENV_LAKE = { y: -5, r0: 44, r1: 170, eastDeg: 50, rings: 24, segs: 120 } as const;

/** Is (x, z) over the lake? */
export function onHeatLake(x: number, z: number): boolean {
  const L = HEAT_ENV_LAKE;
  const dx = x - HEAT.forge.x;
  const dz = z - HEAT.forge.z;
  const r = Math.hypot(dx, dz);
  if (r < L.r0 || r > L.r1) return false;
  let b = Math.abs((Math.atan2(dx, dz) * 180) / Math.PI - 90);
  b = Math.min(b, 360 - b);
  return b >= L.eastDeg;
}

/** The lake's mesh (instance-local): `positions` x, y, z per vertex, `indices` triangles. */
export function heatLakeMesh(): { positions: number[]; indices: number[] } {
  const L = HEAT_ENV_LAKE;
  const positions: number[] = [];
  const indices: number[] = [];
  // From the way in's north edge round the west to its south edge (bearings from north).
  const a0 = 90 + L.eastDeg;
  const a1 = 90 - L.eastDeg + 360;
  for (let j = 0; j <= L.rings; j++) {
    const r = L.r0 + (L.r1 - L.r0) * (j / L.rings);
    for (let i = 0; i <= L.segs; i++) {
      const a = ((a0 + (a1 - a0) * (i / L.segs)) * Math.PI) / 180;
      positions.push(HEAT.forge.x + Math.sin(a) * r, L.y, HEAT.forge.z + Math.cos(a) * r);
    }
  }
  const row = L.segs + 1;
  for (let j = 0; j < L.rings; j++)
    for (let i = 0; i < L.segs; i++) {
      const a = j * row + i;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  return { positions, indices };
}

/** A molten fall's flowing ribbon: from its ledge `top` down to the lake at `foot`
 *  (instance-local), `half` yards either side across `side`, `out` the way its face looks. */
export interface HeatFallRibbon {
  top: { x: number; y: number; z: number };
  foot: { x: number; y: number; z: number };
  side: { x: number; z: number };
  out: { x: number; z: number };
  half: number;
}

/** Where a fall's painted river runs on its piece (measured off the shipped models, the
 *  kit's frame: its foot on y 0, its front on z 0, the body behind): `across` the share of
 *  its width off its middle, `ledge` the share of its height it pours from, `half` the
 *  share of its width either side, `back` the share of its depth behind the front plane
 *  (the river runs deep in the cliff's notch, the columns either side standing proud of it:
 *  the flowing ribbon lies on the river, never out in the air in front of the cliff).
 *  Measured with tmp tooling sampling each triangle's texels (river_probe). */
export const HEAT_FALL_RIBBON: Readonly<
  Record<string, { across: number; ledge: number; half: number; back: number }>
> = {
  Env_MoltenFall: { across: -0.05, ledge: 0.82, half: 0.045, back: 0.38 },
  Env_GreatFall: { across: -0.022, ledge: 0.75, half: 0.06, back: 0.49 },
};

/** How far in front of the painted river its ribbon lies (yards: clear of the paint). */
const RIBBON_CLEAR = 0.6;

/** One fall's ribbon. */
export function heatFallRibbon(p: HeartKitPlacement): HeatFallRibbon {
  const F = HEAT_FALL_RIBBON[p.piece.replace(/Far$/, '')] ?? HEAT_FALL_RIBBON.Env_MoltenFall;
  const m = heatEnvRockMeasure(p.piece);
  const s = p.scale ?? 1;
  const out = { x: Math.sin(p.rot), z: Math.cos(p.rot) };
  const side = { x: Math.cos(p.rot), z: -Math.sin(p.rot) };
  const ax = F.across * m.w * s;
  const depth = RIBBON_CLEAR - F.back * m.d * s;
  const x = p.x + side.x * ax + out.x * depth;
  const z = p.z + side.z * ax + out.z * depth;
  return {
    top: { x, y: p.y + m.h * s * (p.rise ?? 1) * F.ledge, z },
    foot: { x, y: HEAT_ENV_LAKE.y, z },
    side,
    out,
    half: Math.max(1.2, F.half * m.w * s),
  };
}

/** Every fall's ribbon round the hall. */
export function heatFallRibbons(): HeatFallRibbon[] {
  return heatEnvFallPlacements().map(heatFallRibbon);
}

/** A soft card (instance-local, its size in yards). */
export interface HeatSetCard {
  x: number;
  y: number;
  z: number;
  size: number;
}

/** A plume of smoke climbing (its foot, how far it climbs, its puffs' size). */
export interface HeatSetPlume {
  x: number;
  y: number;
  z: number;
  rise: number;
  size: number;
}

export interface HeatSetPlan {
  falls: HeatFallRibbon[];
  /** The glow where each fall lands, and round the cliffs' feet. */
  glows: HeatSetCard[];
  smoke: HeatSetPlume[];
}

/** The smoke between the tiers: a plume every `step` degrees at each of `rings` (radius,
 *  foot), climbing `rise` (plus a share), `size` its puffs; never down the way in. */
export const HEAT_SET_SMOKE = {
  rings: [
    [92, HEAT_ENV_LAKE.y],
    [112, 20],
    [134, 60],
  ] as const,
  step: 13,
  rise: 64,
  size: 24,
} as const;

/** The set's plan. `density` thins the smoke (1 full, the low tier a third). */
export function planHeatSet(density = 1): HeatSetPlan {
  const falls = heatFallRibbons();
  const glows: HeatSetCard[] = [];
  for (const f of falls) glows.push({ x: f.foot.x, y: f.foot.y + 3, z: f.foot.z, size: 26 });
  // The lake's light up the feet of the cliffs standing in it.
  const near = HEAT_ENV_TIERS[0].r;
  for (const p of planHeatEnvRing()) {
    const r = Math.hypot(p.x - HEAT_ENV_RING.x, p.z - HEAT_ENV_RING.z);
    if (r > near + 35 || p.piece === 'Env_MoltenFall') continue;
    const k = heartHash(Math.round(p.x * 3), Math.round(p.z * 3) + 4600);
    if (k > 0.6) continue;
    glows.push({
      x: p.x + Math.sin(p.rot) * 4,
      y: HEAT_ENV_LAKE.y + 2.5,
      z: p.z + Math.cos(p.rot) * 4,
      size: 14 + k * 10,
    });
  }
  const S = HEAT_SET_SMOKE;
  const smoke: HeatSetPlume[] = [];
  let i = 0;
  for (const [r, foot] of S.rings) {
    for (let deg = -180; deg < 180; deg += S.step, i++) {
      if (Math.abs(deg - 90) < HEAT_ENV_OPEN.eastDeg + 4) continue;
      if (heartHash(i, 4700) > density) continue;
      const a = ((deg + (heartHash(i, 4701) - 0.5) * S.step) * Math.PI) / 180;
      smoke.push({
        x: HEAT_ENV_RING.x + Math.sin(a) * r,
        y: foot,
        z: HEAT_ENV_RING.z + Math.cos(a) * r,
        rise: S.rise * (0.8 + heartHash(i, 4702) * 0.5),
        size: S.size * (0.8 + heartHash(i, 4703) * 0.5),
      });
    }
  }
  // Steam off the lake where each fall lands.
  for (const f of falls)
    smoke.push({ x: f.foot.x, y: f.foot.y, z: f.foot.z, rise: 40, size: S.size * 0.7 });
  return { falls, glows, smoke };
}
