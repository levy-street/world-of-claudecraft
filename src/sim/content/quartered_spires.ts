// The Quartered Isle's standing stone, after the inspiration images: a few
// big landmarks per quarter rather than a field of small rocks.
//  - the Heavestone Wilds: a handful of great stacked sandstone mesas on the
//    open sand, each with a smaller stack and flat fallen slabs at its foot;
//  - the Cinderscar: tall masses of pale blue-grey basalt columns, each with a
//    lesser cluster and broken column rubble, and lava vents along the
//    burnways' banks;
//  - the Hoarshelf: snow floes standing on the dark frozen lakes as stepping
//    stones, and big snowy boulder outcrops on the lakes' banks in back-to-back
//    pairs, so neither shows its flat back;
//  - the Gyre's foot: a sparse scatter of tall storm-worn needles.
//
// Placements are deterministic (integer hashes, no rng stream), on shattered
// plate ground off the roads, the fissures, the landmarks, the town, the
// crater and every placed content spot. Each carries a collider (r) so a rock
// is something to walk round, not through; the low pieces (floes, slabs,
// rubble) carry a standable top so a player steps up onto them instead.

import {
  CINDERSCAR_BURNWAYS,
  cinderscarMeltNear,
  QUARTERED_FROZEN_LAKES,
  quarteredLandmarkClears,
} from '../quartered_landmarks';
import { dominantQuarterAt } from '../quartered_quarters';
import { isleFissureAt, shatterWeight } from '../quartered_shatter';
import type { ZonePropsDef } from '../types';
import { QUARTERED_ISLE_ROADS } from './quartered_isle_ways';

type DecorProp = NonNullable<ZonePropsDef['decorProps']>[number];
type Kind = Omit<DecorProp, 'x' | 'z' | 'rot'>;

function hash3(i: number, j: number, salt: number): number {
  let h = Math.imul(i | 0, 0x2c1b3c6d) ^ Math.imul(j | 0, 0x297a2d39) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const STEP = 12;
const round2 = (v: number) => Math.round(v * 100) / 100;

// The isle kit's footprint (the larger of its x and z extents) and height at
// scale 1, yards (render/prop_natural_size.generated.ts), so each piece's
// collider and height follow the size it is placed at.
export const ISLE_KIT = {
  cinderColumnsTall: { w: 11.34, h: 12 },
  cinderColumnRubble: { w: 1.58, h: 1 },
  cinderLavaVent: { w: 8.11, h: 1.2 },
  frostFloeSlab: { w: 4.78, h: 1.6 },
  frostFloeBroad: { w: 9.29, h: 1.4 },
  frostSnowOutcrop: { w: 10.87, h: 9 },
  heaveStrataLarge: { w: 13.84, h: 14 },
  heaveStrataSmall: { w: 7.72, h: 6 },
  heaveStrataRubble: { w: 9.46, h: 1.5 },
} as const;
type KitKey = keyof typeof ISLE_KIT;

/** A collider that sits inside the piece's ragged outline: the models are
 *  wider at the foot than the body a player bumps into. */
const COLLIDER_SHARE = 0.4;

function kitPiece(key: KitKey, rawScale: number, standable = false): Kind {
  // round first, so the collider and height match the scale the render draws
  const scale = round2(rawScale);
  const k = ISLE_KIT[key];
  const piece: Kind = {
    key,
    scale,
    r: Math.max(0.6, k.w * scale * COLLIDER_SHARE),
    h: k.h * scale,
  };
  if (standable) piece.standableTop = round2(k.h * scale * 0.92);
  return piece;
}

/** True where a piece may stand: well inside the shattered ground (so off the
 *  roads, the town, the crater, the lakes and the placed spots), on a plate's
 *  interior (no fissure within its footprint) and off every landmark. */
function standable(x: number, z: number, footprint: number): boolean {
  if (shatterWeight(x, z, 1) < 0.85) return false;
  if (quarteredLandmarkClears(x, z)) return false;
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    if (isleFissureAt(x + Math.cos(ang) * footprint, z + Math.sin(ang) * footprint, 1) > 0) {
      return false;
    }
  }
  return isleFissureAt(x, z, 1) === 0;
}

function place(kind: Kind, x: number, z: number, rot: number): DecorProp {
  return {
    ...kind,
    scale: round2(kind.scale ?? 1),
    r: round2(kind.r ?? 1),
    h: round2(kind.h ?? 3),
    x: round2(x),
    z: round2(z),
    rot: round2(rot),
  };
}

/** True where a big piece may stand: its centre and a ring at half its
 *  radius (a third out) on shattered plate ground, off every fissure and landmark, and its
 *  whole collider clear of the roads. A big stack may straddle a plate seam
 *  further out (its foot buries the crack), never sit in one. */
function roomFor(x: number, z: number, r: number): boolean {
  if (roadDistance(x, z) < r + ROAD_CLEAR) return false;
  // nothing in the Cinderscar reaches over its melt
  if (cinderscarMeltNear(x, z, r * 0.8)) return false;
  for (let a = -1; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    const d = a < 0 ? 0 : r * 0.3;
    const px = x + Math.cos(ang) * d;
    const pz = z + Math.sin(ang) * d;
    if (shatterWeight(px, pz, 1) < 0.85) return false;
    if (quarteredLandmarkClears(px, pz)) return false;
    if (isleFissureAt(px, pz, 1) > 0) return false;
  }
  return true;
}

/** Each stone quarter's landmark: a few big centrepieces, spaced well apart,
 *  each with its smaller fallen pieces round its foot (the inspiration
 *  images: one great stacked mesa on open sand with broken slabs at its feet;
 *  tall masses of columns along the lava). */
interface StoneQuarter {
  quarter: 'earth' | 'fire';
  /** how many centrepieces the quarter aims for */
  target: number;
  /** centre-to-centre spacing, yards */
  spacing: number;
  centre: (s: number) => Kind;
  /** the pieces round a centrepiece's foot: kind and distance out, as a
   *  share of the centrepiece's collider radius */
  satellites: ((s: number) => { kind: Kind; out: number })[];
}

const STONE_QUARTERS: readonly StoneQuarter[] = [
  {
    quarter: 'earth',
    target: 4,
    spacing: 70,
    centre: (s) => kitPiece('heaveStrataLarge', 1.9 + 0.9 * s),
    satellites: [(s) => ({ kind: kitPiece('heaveStrataRubble', 1.3 + 0.5 * s, true), out: 1.25 })],
  },
  {
    quarter: 'fire',
    target: 6,
    spacing: 55,
    centre: (s) => kitPiece('cinderColumnsTall', 1.3 + 0.8 * s),
    satellites: [(s) => ({ kind: kitPiece('cinderColumnsTall', 0.7 + 0.3 * s), out: 1.05 })],
  },
];

/** A road keeps this much open ground past a piece's collider. */
const ROAD_CLEAR = 4;
/** Candidate spacing for the centrepiece search, yards. */
const SITE_STEP = 10;

function buildLandmarkStone(): DecorProp[] {
  const out: DecorProp[] = [];
  STONE_QUARTERS.forEach((q, qi) => {
    const cand: { x: number; z: number; order: number; s: number }[] = [];
    for (let gi = Math.floor(-250 / SITE_STEP); gi <= Math.floor(250 / SITE_STEP); gi++) {
      for (let gj = Math.floor(1980 / SITE_STEP); gj <= Math.floor(2400 / SITE_STEP); gj++) {
        const x = (gi + 0.2 + 0.6 * hash3(gi, gj, 71 + qi)) * SITE_STEP;
        const z = (gj + 0.2 + 0.6 * hash3(gi, gj, 73 + qi)) * SITE_STEP;
        if (dominantQuarterAt(x, z) !== q.quarter) continue;
        cand.push({ x, z, order: hash3(gi, gj, 75 + qi), s: hash3(gi, gj, 77 + qi) });
      }
    }
    cand.sort((a, b) => a.order - b.order);
    const centres: { x: number; z: number }[] = [];
    for (const c of cand) {
      if (centres.length >= q.target) break;
      if (centres.some((o) => Math.hypot(c.x - o.x, c.z - o.z) < q.spacing)) continue;
      const kind = q.centre(c.s);
      const r = kind.r ?? 2;
      if (!roomFor(c.x, c.z, r)) continue;
      centres.push(c);
      const n = centres.length;
      out.push(place(kind, c.x, c.z, hash3(n, qi, 81) * Math.PI * 2));
      // the fallen pieces round its foot: each tries six bearings from its
      // own start until one lands on plate ground clear of the cracks
      q.satellites.forEach((sat, si) => {
        const piece = sat(hash3(n, si, 83 + qi));
        const pr = piece.kind.r ?? 1;
        const dist = r * piece.out + pr;
        const start = hash3(n, si, 85 + qi) + si * 0.45;
        for (let t = 0; t < 6; t++) {
          const ang = (start + t / 6) * Math.PI * 2;
          const x = c.x + Math.cos(ang) * dist;
          const z = c.z + Math.sin(ang) * dist;
          if (dominantQuarterAt(x, z) !== q.quarter || !roomFor(x, z, pr)) continue;
          out.push(place(piece.kind, x, z, hash3(n, si, 87 + qi) * Math.PI * 2));
          break;
        }
      });
    }
  });
  return out;
}

/** The storm-worn needles at the Gyre's foot: a sparse scatter of the kit
 *  spire, one cell in five. */
function buildWindNeedles(): DecorProp[] {
  const out: DecorProp[] = [];
  for (let gi = Math.floor(-250 / STEP); gi <= Math.floor(250 / STEP); gi++) {
    for (let gj = Math.floor(1980 / STEP); gj <= Math.floor(2400 / STEP); gj++) {
      if (hash3(gi, gj, 1) > 0.12) continue;
      const x = (gi + 0.1 + 0.8 * hash3(gi, gj, 2)) * STEP;
      const z = (gj + 0.1 + 0.8 * hash3(gi, gj, 3)) * STEP;
      if (dominantQuarterAt(x, z) !== 'wind') continue;
      const r = hash3(gi, gj, 4);
      const kind: Kind = { key: 'rockTallH', scale: 3.2 + 2.2 * r, r: 1.6, h: 7.5 + 5 * r };
      if (!standable(x, z, (kind.r ?? 1) + 1.5)) continue;
      out.push(place(kind, x, z, hash3(gi, gj, 5) * Math.PI * 2));
    }
  }
  return out;
}

/** Lava vents along the burnways' banks: up to two off each stretch,
 *  preferring alternate banks, on dry plate ground clear of the melt. */
export const LAVA_VENT_SCALE = 0.5;
/** How far out from its burnway's centre line a vent may stand, nearest
 *  first, yards (the bed and its bank reach 5yd out). */
export const LAVA_VENT_OFFSETS = [8, 10, 12, 14] as const;

function buildLavaVents(): DecorProp[] {
  const out: DecorProp[] = [];
  CINDERSCAR_BURNWAYS.forEach((line, bi) => {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      const vent = kitPiece('cinderLavaVent', LAVA_VENT_SCALE);
      // the first dry spot off this stretch: two places along it, the
      // preferred bank first, a few distances out from the melt
      const first = (i + bi) % 2 === 0 ? 1 : -1;
      let spot: { x: number; z: number } | null = null;
      for (const along of [0.5]) {
        for (const side of [first, -first]) {
          for (const off of LAVA_VENT_OFFSETS) {
            const x = a.x + (b.x - a.x) * along - uz * off * side;
            const z = a.z + (b.z - a.z) * along + ux * off * side;
            if (standable(x, z, (vent.r ?? 1) + 0.5)) {
              spot = { x, z };
              break;
            }
          }
          if (spot) break;
        }
        if (!spot) continue;
        // walk-through: the ring is ankle high and the pool is cosmetic melt
        out.push(place({ ...vent, r: 0 }, spot.x, spot.z, hash3(bi, i, 43) * Math.PI * 2));
        spot = null;
      }
    }
  });
  return out;
}

/** The snow outcrop's depth front to flat back at scale 1, yards (its x
 *  extent, render/prop_natural_size.generated.ts), and the share of half of
 *  it a back-to-back pair's centres stand off their seam: a little under one,
 *  so the two flat backs overlap and no sliver of either shows. */
export const OUTCROP_DEPTH = 8.11 / 2;
export const OUTCROP_BACK_OVERLAP = 0.85;

/** Snow floes on every frozen lake: a ring of stepping stones, slab and broad
 *  alternating, each wholly on the ice. */
export const FLOE_RING_SHARE = 0.55;

function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const line of QUARTERED_ISLE_ROADS) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
    }
  }
  return best;
}

function buildFrost(): DecorProp[] {
  const out: DecorProp[] = [];
  QUARTERED_FROZEN_LAKES.forEach((lake, li) => {
    // the floes: one per 4yd of radius on a ring inside the lake, plus a
    // broad one at the heart of the bigger lakes
    const count = Math.max(1, Math.round(lake.r / 8));
    for (let k = 0; k < count; k++) {
      const broad = k % 2 === 1;
      const piece = broad
        ? kitPiece('frostFloeBroad', 0.55 + 0.2 * hash3(li, k, 51), true)
        : kitPiece('frostFloeSlab', 0.8 + 0.3 * hash3(li, k, 52), true);
      const half = (ISLE_KIT[piece.key as KitKey].w * (piece.scale ?? 1)) / 2;
      const ring = Math.min(lake.r * FLOE_RING_SHARE, lake.r - half - 0.5);
      if (ring <= 0) continue;
      const ang = ((k + (hash3(li, k, 53) - 0.5) * 0.5) / count) * Math.PI * 2;
      out.push(
        place(
          piece,
          lake.x + Math.cos(ang) * ring,
          lake.z + Math.sin(ang) * ring,
          hash3(li, k, 54) * Math.PI * 2,
        ),
      );
    }
    // the outcrops: snowy boulder heaps on the bank, in back-to-back pairs
    // along the bank's normal. The model's back is one flat face (its local
    // -x side, OUTCROP_DEPTH deep), so each pair presses its two flat backs
    // together: the inner heap faces the lake, the outer faces the land, and
    // no flat face shows from anywhere.
    const scale = round2(1.0 + 0.4 * hash3(li, 0, 62));
    const piece = kitPiece('frostSnowOutcrop', scale);
    const half = OUTCROP_DEPTH * scale * OUTCROP_BACK_OVERLAP;
    const ang = (0.25 + (hash3(li, 0, 61) - 0.5) * 0.4) * Math.PI * 2;
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    // the pair's seam a heap's depth past the ice, so the inner heap's front
    // stands at the ice's edge
    const seam = lake.r + half + 1;
    const pair = [
      // inner: its back faces out (+u); rotation.y turns local (-1, 0) to (-cos, sin)
      { x: lake.x + ux * (seam - half), z: lake.z + uz * (seam - half), rot: Math.atan2(uz, -ux) },
      // outer: its back faces in (-u)
      { x: lake.x + ux * (seam + half), z: lake.z + uz * (seam + half), rot: Math.atan2(-uz, ux) },
    ];
    const clear = pair.every(
      (p) =>
        roadDistance(p.x, p.z) >= (piece.r ?? 2) + 4 &&
        !QUARTERED_FROZEN_LAKES.some(
          (o, oi) => oi !== li && Math.hypot(p.x - o.x, p.z - o.z) < o.r + (piece.r ?? 2) + 2,
        ),
    );
    if (clear) for (const p of pair) out.push(place(piece, p.x, p.z, p.rot));
  });
  return out;
}

/** The isle's standing stone, built once at load (a pure function of the
 *  tables). */
export const QUARTERED_ISLE_SPIRES: readonly DecorProp[] = [
  ...buildLandmarkStone(),
  ...buildWindNeedles(),
  ...buildLavaVents(),
  ...buildFrost(),
];
