import { describe, expect, it } from 'vitest';
import {
  CREVASSE_OFFSET_MAX,
  CREVASSE_OFFSET_MIN,
  planQuarteredLandmarkDressing,
  SHELF_DRY_MARGIN,
  SHELF_FISSURE_CLEAR,
  SHELF_ROAD_CLEAR,
  SHELF_SCALE_MAX,
  SHELF_SCALE_MIN,
  SHELF_SPIRE_TARGET,
  SHELF_SPOT_CLEAR,
  shelfSpireRadius,
} from '../src/render/quartered_landmark_dressing_core';
import { QUARTERED_ISLE_ROADS, QUARTERED_ISLE_ZONE } from '../src/sim/content/quartered_isle';
import { CHALLENGERS_RING } from '../src/sim/quartered_isle_terrain';
import {
  HOARSHELF_CREVASSES,
  QUARTERED_FROZEN_LAKES,
  quarteredLandmarkClears,
  RIMEGLASS_TARN,
} from '../src/sim/quartered_landmarks';
import { dominantQuarterAt } from '../src/sim/quartered_quarters';
import { isleFissureAt, placedSpots } from '../src/sim/quartered_shatter';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

type Pt = { readonly x: number; readonly z: number };

function distToPolyline(line: readonly Pt[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (a.x + dx * u), z - (a.z + dz * u)));
  }
  return best;
}

// A gently tilted plane: flat enough that nothing is cut as sea, sloped enough
// that a centre-only seat would differ from the lowest-probe seat.
const tilted = (x: number, z: number): number => 4 + x * 0.02 + z * 0.01 - 2000 * 0.01;
const finished = (x: number, z: number): number => terrainHeight(x, z, 0);

describe('Quartered Isle landmark dressing placement', () => {
  it('places one spire per crevasse, and no crystal ring round the lakes', () => {
    const plan = planQuarteredLandmarkDressing(tilted);
    // the lakes' rims are the generated snow outcrops (content/quartered_spires.ts)
    expect(plan.spires.filter((s) => s.cluster === 'lake')).toEqual([]);
    const crevasse = plan.spires.filter((s) => s.cluster === 'crevasse');
    expect(crevasse.length).toBe(HOARSHELF_CREVASSES.length);
    // every crack gets its own 2 or 3: nearest-crack attribution per spire
    const perCrack = HOARSHELF_CREVASSES.map(() => 0);
    for (const s of crevasse) {
      const d = HOARSHELF_CREVASSES.map((line) => distToPolyline(line, s.x, s.z));
      perCrack[d.indexOf(Math.min(...d))]++;
    }
    for (const n of perCrack) expect(n).toBe(1);
  });

  it('stands no spire on or round any lake: their rims are the snow outcrops', () => {
    const plan = planQuarteredLandmarkDressing(finished);
    for (const s of plan.spires) {
      for (const lake of QUARTERED_FROZEN_LAKES) {
        expect(Math.hypot(s.x - lake.x, s.z - lake.z)).toBeGreaterThan(lake.r);
      }
      expect(s.lake).toBe(-1);
    }
  });

  it('is deterministic: two calls return equal plans', () => {
    expect(planQuarteredLandmarkDressing(tilted)).toEqual(planQuarteredLandmarkDressing(tilted));
    expect(planQuarteredLandmarkDressing(finished)).toEqual(
      planQuarteredLandmarkDressing(finished),
    );
  });

  it('keeps every placement inside the quartered_isle zone rect', () => {
    expect(QUARTERED_ISLE_ZONE).toMatchObject({ xMin: -250, xMax: 250, zMin: 1960, zMax: 2420 });
    const plan = planQuarteredLandmarkDressing(finished);
    for (const p of plan.spires) {
      expect(p.x).toBeGreaterThanOrEqual(-250);
      expect(p.x).toBeLessThanOrEqual(250);
      expect(p.z).toBeGreaterThanOrEqual(1960);
      expect(p.z).toBeLessThanOrEqual(2420);
    }
  });

  it('keeps every spire off the ice: clear of the tarn, the shelf clear of the cracks', () => {
    const plan = planQuarteredLandmarkDressing(finished);
    for (const s of plan.spires) {
      const fromTarn = Math.hypot(s.x - RIMEGLASS_TARN.x, s.z - RIMEGLASS_TARN.z);
      expect(fromTarn).toBeGreaterThan(RIMEGLASS_TARN.r);
      // the open-shelf field has its own rules (pinned below)
      if (s.cluster === 'shelfWest' || s.cluster === 'shelfEast') continue;
      if (s.cluster === 'crevasse') {
        const d = Math.min(...HOARSHELF_CREVASSES.map((line) => distToPolyline(line, s.x, s.z)));
        expect(d).toBeGreaterThanOrEqual(CREVASSE_OFFSET_MIN - 1e-9);
        expect(d).toBeLessThanOrEqual(CREVASSE_OFFSET_MAX + 1e-9);
      }
    }
  });

  it('alternates crevasse spires from side to side of their crack', () => {
    const plan = planQuarteredLandmarkDressing(tilted);
    const crevasse = plan.spires.filter((s) => s.cluster === 'crevasse');
    for (const line of HOARSHELF_CREVASSES) {
      const a = line[0];
      const b = line[line.length - 1];
      const mine = crevasse
        .filter((s) => {
          const d = HOARSHELF_CREVASSES.map((l) => distToPolyline(l, s.x, s.z));
          return HOARSHELF_CREVASSES[d.indexOf(Math.min(...d))] === line;
        })
        .map((s) => ({
          along: (s.x - a.x) * (b.x - a.x) + (s.z - a.z) * (b.z - a.z),
          side: Math.sign((b.x - a.x) * (s.z - a.z) - (b.z - a.z) * (s.x - a.x)),
        }))
        .sort((p, q) => p.along - q.along);
      for (let i = 1; i < mine.length; i++) expect(mine[i].side).toBe(-mine[i - 1].side);
    }
  });

  it('seats every piece on the finished ground under it, never floating', () => {
    const plan = planQuarteredLandmarkDressing(tilted);
    for (const s of plan.spires) {
      // buried a hand into the lowest probe of its footprint: at or below the
      // ground at its centre, and never more than the slope plus the sink
      expect(s.y).toBeLessThanOrEqual(tilted(s.x, s.z));
      expect(s.y).toBeGreaterThan(tilted(s.x, s.z) - 0.5);
    }
  });

  it('seats on the real finished terrain the same way', () => {
    const plan = planQuarteredLandmarkDressing(finished);
    for (const s of plan.spires) {
      expect(s.y).toBeLessThanOrEqual(finished(s.x, s.z));
      expect(s.y).toBeGreaterThan(-3.2);
    }
  });
});

describe('the open Hoarshelf spire field', () => {
  const plan = planQuarteredLandmarkDressing(finished);
  const field = plan.spires.filter((s) => s.cluster === 'shelfWest' || s.cluster === 'shelfEast');

  it('stands a sparse few spires across the ice quarter, split west and east', () => {
    expect(field.length).toBeGreaterThanOrEqual(3);
    expect(field.length).toBeLessThanOrEqual(SHELF_SPIRE_TARGET);
    for (const s of field) {
      expect(dominantQuarterAt(s.x, s.z)).toBe('ice');
      expect(s.cluster).toBe(s.x < 0 ? 'shelfWest' : 'shelfEast');
      expect(s.x).toBeGreaterThanOrEqual(-250);
      expect(s.x).toBeLessThanOrEqual(250);
      expect(s.z).toBeGreaterThanOrEqual(1980);
      expect(s.z).toBeLessThanOrEqual(2400);
    }
  });

  it('stands each spire within the shelf scale band, some as towering glacier spikes', () => {
    // sy is the scale times the variant's height stretch (0.86 to 1.12)
    for (const s of field) {
      expect(s.sy).toBeGreaterThanOrEqual(SHELF_SCALE_MIN * 0.86 - 1e-9);
      expect(s.sy).toBeLessThanOrEqual(SHELF_SCALE_MAX * 1.12 + 1e-9);
    }
    expect(Math.max(...field.map((s) => s.sy))).toBeGreaterThan(3.2);
  });

  it('keeps every spire on dry ground, off the roads, fissures, content spots and landmarks', () => {
    const spots = placedSpots();
    for (const s of field) {
      expect(finished(s.x, s.z)).toBeGreaterThan(WATER_LEVEL + SHELF_DRY_MARGIN);
      const road = Math.min(...QUARTERED_ISLE_ROADS.map((line) => distToPolyline(line, s.x, s.z)));
      expect(road).toBeGreaterThanOrEqual(SHELF_ROAD_CLEAR);
      expect(isleFissureAt(s.x, s.z, 1)).toBe(0);
      for (const rr of [1, 2, SHELF_FISSURE_CLEAR]) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          expect(isleFissureAt(s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr, 1)).toBe(0);
        }
      }
      for (const p of spots) {
        expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThanOrEqual(SHELF_SPOT_CLEAR);
      }
      expect(quarteredLandmarkClears(s.x, s.z)).toBe(false);
    }
  });

  it('keeps every spire off the crater ramps, out past the rim foot', () => {
    const ring = CHALLENGERS_RING;
    for (const s of field) {
      const r = shelfSpireRadius(Math.max(s.sx, s.sz));
      for (const deg of ring.ramps) {
        const a = (deg * Math.PI) / 180;
        const along = (s.x - ring.x) * Math.cos(a) + (s.z - ring.z) * Math.sin(a);
        const across = Math.abs(-(s.x - ring.x) * Math.sin(a) + (s.z - ring.z) * Math.cos(a));
        const inRun = along > ring.rampFrom - r && along < ring.rampTo + r;
        expect(inRun && across < ring.rampHalfW + r, `spire at ${s.x},${s.z}`).toBe(false);
      }
    }
  });

  it('spaces the field so no spike fuses with another spire', () => {
    for (const s of field) {
      for (const o of plan.spires) {
        if (o === s) continue;
        expect(Math.hypot(s.x - o.x, s.z - o.z)).toBeGreaterThan(7);
      }
    }
  });
});
