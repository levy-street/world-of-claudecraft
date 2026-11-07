// The Islands of the Wind's walkable floors (the Guardian of the Breath,
// docs/design/raid/smith_heart.md section 7.2; Jose's call of 2026-11-04: the
// isles' tops read as a flat round disc because the floor was one). Each
// isle's floor is now an organic outline: a landing apron toward the Cornice
// (the Homeward Gale's circle stands on it), bays bitten in, broad
// promontories and one narrow rock tongue reaching out, ragged all round;
// and one or two low ledges (a terrace a stride up, under MAX_STEP_HEIGHT and
// the field's cliffStep, so a body walks up it and no wall is built) out on a
// promontory. The renderer's sculpt (docs/design/raid/kit/breath_isles.py
// ISLE_WALKS, ISLE_LEDGES) is these very polygons, pinned by
// tests/smith_heart_breath_kit.test.ts.
//
// Pure data and shape: no SimContext, no rng (a fixed hash for the ragged
// edge), no DOM. Instance-local yards; bearings are compass degrees
// (clockwise from +z), every lobe given RELATIVE to the bearing from the isle
// toward the Cornice so the apron always faces the riders' way home.

import type { FieldPolySurface } from '../instances/authored_field/types';

/** A swell (out > 0: a promontory or a tongue) or a bite (out < 0: a bay) of
 *  the rim: centred `rel` degrees clockwise from the Cornice's bearing, `half`
 *  degrees to either side, `out` yards at its middle (a cosine-squared
 *  window, so a narrow half makes a pointed tongue). */
export interface IsleLobe {
  rel: number;
  out: number;
  half: number;
}

/** A ledge a stride up: the outline's reach past `from` yards within `half`
 *  degrees of `rel`, its floor `rise` yards over the isle's (a crescent whose
 *  inner edge curls out to the rim at its ends). Later ledges stand on
 *  earlier ones (give them a higher rise). */
export interface IsleLedge {
  rel: number;
  half: number;
  from: number;
  rise: number;
}

export interface IsleFloorSpec {
  /** The rim's mean reach before its lobes (yards). */
  base: number;
  lobes: readonly IsleLobe[];
  ledges: readonly IsleLedge[];
  /** Seeds the rim's ragged hash. */
  seed: number;
}

/** The rim's bearing step (degrees): fine enough for a tongue two yards wide. */
export const ISLE_RIM_STEP = 2.5;

/** The tallest ledge's rise: a stride (MAX_STEP_HEIGHT is 0.9; the field's
 *  cliffStep 1.1), never a wall. */
export const ISLE_LEDGE_MAX_RISE = 0.9;

/** Each isle's floor, by its BREATH_ISLES id. A (south-east): the taller,
 *  narrower isle (its arch's promontory, one deep bay, a tongue east of the
 *  apron, a ledge on its far promontory). B (south-west): broad and squat
 *  (its tree's promontory, a tongue west, a deep bay, a broad far promontory
 *  climbing in two ledges). */
export const ISLE_FLOOR_SPECS: Readonly<Record<string, IsleFloorSpec>> = {
  breath_isle_southeast: {
    base: 9.4,
    seed: 71,
    lobes: [
      { rel: 0, out: 0.8, half: 40 },
      { rel: 62, out: -2.5, half: 24 },
      { rel: 100, out: 3.4, half: 10 },
      { rel: 148, out: 1.8, half: 26 },
      { rel: 200, out: -2.2, half: 20 },
      { rel: 248, out: 1.6, half: 20 },
      { rel: 298, out: -1.7, half: 15 },
    ],
    ledges: [{ rel: 150, half: 24, from: 7.4, rise: 0.55 }],
  },
  breath_isle_southwest: {
    base: 9.4,
    seed: 43,
    lobes: [
      { rel: 0, out: 0.8, half: 36 },
      { rel: 298, out: -1.6, half: 14 },
      { rel: 265, out: 3.6, half: 9 },
      { rel: 225, out: -2.6, half: 22 },
      { rel: 180, out: 2.2, half: 34 },
      { rel: 118, out: -2.0, half: 18 },
      { rel: 68, out: 1.4, half: 20 },
    ],
    ledges: [
      { rel: 178, half: 30, from: 7.2, rise: 0.45 },
      { rel: 184, half: 17, from: 8.9, rise: 0.9 },
    ],
  },
};

function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Signed degrees from `b` to `a`, in -180..180. */
function degOff(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/** A smooth hashed wobble of the rim (yards, about -1..1) at bearing `deg`:
 *  a long swell every 30 degrees and a short one every 10. */
function wobble(seed: number, deg: number): number {
  const at = (period: number, salt: number): number => {
    const u = (((deg % 360) + 360) % 360) / period;
    const n = Math.round(360 / period);
    const k = Math.floor(u);
    const t = u - k;
    const s = t * t * (3 - 2 * t);
    const a = hash01(k % n, seed * 7 + salt) * 2 - 1;
    const b = hash01((k + 1) % n, seed * 7 + salt) * 2 - 1;
    return a + (b - a) * s;
  };
  return 0.7 * at(30, 1) + 0.3 * at(10, 2);
}

/** The bearing (compass degrees) from (x, z) toward (tx, tz). */
export function bearingDeg(x: number, z: number, tx: number, tz: number): number {
  return ((Math.atan2(tx - x, tz - z) * 180) / Math.PI + 360) % 360;
}

/** How far the isle's rim reaches along compass bearing `deg` (yards from
 *  its centre), `toward` the bearing to the Cornice. */
export function isleRimRadius(spec: IsleFloorSpec, toward: number, deg: number): number {
  let r = spec.base + 0.32 * wobble(spec.seed, deg);
  for (const l of spec.lobes) {
    const off = Math.abs(degOff(deg, toward + l.rel));
    if (off >= l.half) continue;
    const w = Math.cos((off / l.half) * (Math.PI / 2));
    r += l.out * w * w;
  }
  // A last hashed nick per vertex (a few centimetres), never a spike.
  const k = Math.round((((deg % 360) + 360) % 360) / ISLE_RIM_STEP);
  return r + 0.1 * (hash01(k, spec.seed + 900) * 2 - 1);
}

function pointAt(cx: number, cz: number, deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + Math.sin(a) * r, cz + Math.cos(a) * r];
}

/** The rim's bearings, ISLE_RIM_STEP apart, from north clockwise. */
function rimBearings(): number[] {
  const out: number[] = [];
  for (let d = 0; d < 360 - 1e-9; d += ISLE_RIM_STEP) out.push(d);
  return out;
}

/** The ledge's inner edge at bearing offset `off` (degrees from its middle):
 *  `from` (ragged) in its middle, curling out to the rim at its ends. */
function ledgeInner(
  spec: IsleFloorSpec,
  l: IsleLedge,
  deg: number,
  off: number,
  rim: number,
): number {
  const e = (Math.abs(off) / l.half) ** 3;
  const ragged = l.from + 0.35 * wobble(spec.seed + 17, deg * 1.7);
  return Math.min(rim - 0.6, ragged + (rim - ragged) * e);
}

/**
 * An isle's floor surfaces: the whole outline at the isle's height (id the
 * isle's), then each ledge (id `<isle>_ledge_<n>`, from 1) a stride up.
 * Hidden: the fight draws the floating rock. The lip lies open (the field's
 * `lipOpenings` take the isle, smith_heart_layout.ts): a body that walks off
 * falls to the void.
 */
export function isleFloorSurfaces(
  isle: { id: string; x: number; z: number; h: number },
  toward: number,
): FieldPolySurface[] {
  const spec = ISLE_FLOOR_SPECS[isle.id];
  if (!spec) throw new Error(`no floor spec for ${isle.id}`);
  const bearings = rimBearings();
  const rim = bearings.map((d) => isleRimRadius(spec, toward, d));
  const points = bearings.map((d, k) => pointAt(isle.x, isle.z, d, rim[k]));
  const out: FieldPolySurface[] = [
    { kind: 'poly', id: isle.id, points, h: isle.h, hidden: true, edge: 'rock', ground: 'scoured' },
  ];
  spec.ledges.forEach((l, n) => {
    const mid = toward + l.rel;
    const inSector: number[] = [];
    bearings.forEach((d, k) => {
      if (Math.abs(degOff(d, mid)) <= l.half + 1e-9) inSector.push(k);
    });
    // Clockwise order through the sector, starting at its anticlockwise end.
    inSector.sort((a, b) => degOff(bearings[a], mid) - degOff(bearings[b], mid));
    const pts: [number, number][] = inSector.map((k) => points[k]);
    for (let j = inSector.length - 2; j >= 1; j--) {
      const k = inSector[j];
      const d = bearings[k];
      pts.push(pointAt(isle.x, isle.z, d, ledgeInner(spec, l, d, degOff(d, mid), rim[k])));
    }
    out.push({
      kind: 'poly',
      id: `${isle.id}_ledge_${n + 1}`,
      points: pts,
      h: isle.h + l.rise,
      hidden: true,
      edge: 'rock',
      ground: 'scoured',
    });
  });
  return out;
}

/** Is a field surface id one of the isle `isleId`'s floors (its outline or a
 *  ledge)? */
export function isIsleFloorOf(surfaceId: string, isleId: string): boolean {
  return surfaceId === isleId || surfaceId.startsWith(`${isleId}_ledge_`);
}
