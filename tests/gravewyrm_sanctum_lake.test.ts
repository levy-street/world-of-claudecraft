// The Wyrm's Hollow's pure plan (src/render/gravewyrm_sanctum/sanctum_lake_core.ts):
// the nineteen plate cells are exactly the nearest-centre partition of
// LAKE_PLATES inside the lake's circle (so what is drawn is what phase B's
// plate floor owns), the pressure ridges sit on the seams, the render-only
// apron never covers a walkable top, and the ripple's clock.

import { describe, expect, it } from 'vitest';
import {
  APRON_CELL,
  apronCovers,
  faceFootZ,
  lakeEdgeDistance,
  lakePlateAt,
  planApronBlocks,
  planLakeCells,
  planLakeSeams,
  planPressureRidges,
  pointInPoly,
  RIPPLE,
  rippleAt,
} from '../src/render/gravewyrm_sanctum/sanctum_lake_core';
import { sanctumFloorAt } from '../src/render/gravewyrm_sanctum/sanctum_plan_core';
import { LAKE_PLATES, WYRMS_HOLLOW } from '../src/sim/content/gravewyrm_sanctum_layout';

const { x: LX, z: LZ, lakeR } = WYRMS_HOLLOW;

describe('the lake plates', () => {
  const cells = planLakeCells();

  it('are nineteen cells, one per plate, in plate order', () => {
    expect(cells).toHaveLength(19);
    expect(cells.map((c) => c.id)).toEqual(LAKE_PLATES.map((p) => p.id));
    for (const c of cells) expect(c.poly.length).toBeGreaterThanOrEqual(3);
  });

  it('each cell contains its own centre and no other plate centre', () => {
    for (const c of cells) {
      expect(pointInPoly(c.cx, c.cz, c.poly), c.id).toBe(true);
      for (const p of LAKE_PLATES) {
        if (p.id === c.id) continue;
        expect(pointInPoly(p.x, p.z, c.poly), `${c.id} holds ${p.id}`).toBe(false);
      }
    }
  });

  it('lie inside the lake circle', () => {
    for (const c of cells) {
      for (const [x, z] of c.poly)
        expect(Math.hypot(x - LX, z - LZ)).toBeLessThanOrEqual(lakeR + 1e-6);
    }
  });

  it('partition the lake by the nearest centre (sampled)', () => {
    let checked = 0;
    for (let x = LX - lakeR; x <= LX + lakeR; x += 1.7) {
      for (let z = LZ - lakeR; z <= LZ + lakeR; z += 1.7) {
        if (Math.hypot(x - LX, z - LZ) > lakeR - 0.6) continue;
        // Off the seams by a hair, so the even-odd test is unambiguous.
        if (lakeEdgeDistance(x, z) < 0.05) continue;
        const owner = lakePlateAt(x, z);
        const holders = cells.filter((c) => pointInPoly(x, z, c.poly)).map((c) => c.index);
        expect(holders, `(${x}, ${z})`).toEqual([owner]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1500);
  });

  it('every seam lies on the bisector of the two plates it parts', () => {
    const seams = planLakeSeams();
    expect(seams.length).toBeGreaterThan(30);
    for (const s of seams) {
      const a = LAKE_PLATES[s.a];
      const b = LAKE_PLATES[s.b];
      for (const [x, z] of [
        [s.ax, s.az],
        [s.bx, s.bz],
        [(s.ax + s.bx) / 2, (s.az + s.bz) / 2],
      ]) {
        expect(Math.abs(Math.hypot(x - a.x, z - a.z) - Math.hypot(x - b.x, z - b.z))).toBeLessThan(
          1e-6,
        );
      }
    }
  });

  it('every pressure ridge runs along a seam, centred on it', () => {
    const seams = planLakeSeams().filter((s) => Math.hypot(s.bx - s.ax, s.bz - s.az) >= 2);
    const ridges = planPressureRidges();
    expect(ridges).toHaveLength(seams.length);
    for (const [i, r] of ridges.entries()) {
      const s = seams[i];
      expect(r.x).toBeCloseTo((s.ax + s.bx) / 2, 6);
      expect(r.z).toBeCloseTo((s.az + s.bz) / 2, 6);
      // three's yaw turns the module's +x to (cos, -sin).
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      expect(Math.cos(r.rot)).toBeCloseTo((s.bx - s.ax) / len, 6);
      expect(-Math.sin(r.rot)).toBeCloseTo((s.bz - s.az) / len, 6);
      // Under a knee: the 0.8 yd module drawn at most about 0.55.
      expect(r.scaleY * 0.8).toBeLessThanOrEqual(0.65);
    }
  });
});

describe('the apron north to the Calving Face', () => {
  it('never covers a walkable top (the lake and the shelf stay clear of it)', () => {
    let covered = 0;
    for (let x = -96; x <= 96; x += APRON_CELL) {
      for (let z = 150; z <= 262; z += APRON_CELL) {
        if (!apronCovers(x, z)) continue;
        covered++;
        expect(sanctumFloorAt(x, z), `(${x}, ${z})`).toBeNull();
        expect(Math.hypot(x - LX, z - LZ)).toBeGreaterThan(WYRMS_HOLLOW.shelfR);
        expect(z).toBeLessThanOrEqual(faceFootZ(x) + 3);
      }
    }
    // It really fills the gap from the shelf to the face.
    expect(covered).toBeGreaterThan(1500);
    expect(apronCovers(0, 246)).toBe(true);
  });

  it('runs to the face foot, whose wings curve 22 yd toward the lake', () => {
    expect(faceFootZ(0)).toBe(256);
    expect(faceFootZ(80)).toBe(234);
    expect(faceFootZ(-80)).toBe(234);
  });

  it('keeps its calved blocks on the apron and off the stage-1 scar', () => {
    const blocks = planApronBlocks(false);
    expect(blocks.length).toBeGreaterThan(60);
    for (const b of blocks) {
      expect(apronCovers(b.x, b.z)).toBe(true);
      expect(Math.abs(b.x + 46) < 16 && faceFootZ(b.x) - b.z < 22).toBe(false);
    }
    expect(planApronBlocks(true).length).toBeLessThan(blocks.length);
  });
});

describe('the ripple', () => {
  it('runs out and fades within its life', () => {
    expect(rippleAt(-0.1).strength).toBe(0);
    expect(rippleAt(RIPPLE.life).strength).toBe(0);
    const early = rippleAt(0.5);
    const late = rippleAt(3);
    expect(late.radius).toBeGreaterThan(early.radius);
    expect(late.strength).toBeLessThan(early.strength);
    expect(rippleAt(RIPPLE.life - 0.01).radius).toBeGreaterThan(110);
  });
});
