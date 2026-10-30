// The render-only settled-shape field for procedural town geometry
// (src/render/town_shape_imperfection_core.ts). Pinned here:
//  - deterministic: the same building id gives the same field on every host,
//    and two ids give two different fields;
//  - zero at and below the footprint base, so footings stay on their ground
//    and the sim's collision footprint (never read or written) still matches;
//  - bounded: no point moves further than the field's own bound, and that
//    bound is a few centimetres to a sixth of a yard for the shipped presets;
//  - the shapes it claims: the sag is deepest mid-ridge and nothing at the
//    gable ends, the bow is outward at a wall's middle and nothing at its
//    corners, the lean is a shear that grows with height;
//  - the vertex pass: counts unchanged, shared points stay shared, normals
//    stay unit and turn with the shear.
import { describe, expect, it } from 'vitest';
import {
  applyShapeImperfection,
  createShapeImperfection,
  NO_SHAPE_IMPERFECTION,
  type ShapeImperfectionAmplitudes,
  type ShapeImperfectionFrame,
  shapeImperfectionSeed,
  TOWN_BUILDING_IMPERFECTION,
  TOWN_PROP_IMPERFECTION,
} from '../src/render/town_shape_imperfection_core';

const FRAME: ShapeImperfectionFrame = {
  centerX: 10,
  centerZ: -4,
  yaw: 0.6,
  halfWidth: 7,
  halfDepth: 6,
  baseY: 2,
  height: 12,
  eaveY: 2 + 8,
  ridgeAxis: 'z',
};

function displacement(
  field: ReturnType<typeof createShapeImperfection>,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const out = [0, 0, 0];
  field.displace(x, y, z, out);
  return [out[0], out[1], out[2]];
}

/** A point given in the frame's own (unturned) axes, as a world point. */
function framePoint(lx: number, h: number, lz: number): [number, number, number] {
  const cos = Math.cos(FRAME.yaw);
  const sin = Math.sin(FRAME.yaw);
  return [
    FRAME.centerX + cos * lx + sin * lz,
    FRAME.baseY + h,
    FRAME.centerZ - sin * lx + cos * lz,
  ];
}

function sampleGrid(callback: (x: number, y: number, z: number) => void): void {
  for (let lx = -8; lx <= 8; lx += 1.6)
    for (let lz = -7; lz <= 7; lz += 1.4)
      for (let h = -2; h <= 14; h += 0.8) callback(...framePoint(lx, h, lz));
}

describe('shape imperfection seed', () => {
  it('is a stable 32-bit hash of the building id', () => {
    expect(shapeImperfectionSeed('eastbrook_weekly_vault')).toBe(
      shapeImperfectionSeed('eastbrook_weekly_vault'),
    );
    expect(shapeImperfectionSeed('')).toBe(0x811c9dc5);
    expect(shapeImperfectionSeed('a')).toBe(0xe40c292c);
    expect(shapeImperfectionSeed('stall_a')).not.toBe(shapeImperfectionSeed('stall_b'));
  });
});

describe('the field', () => {
  const field = createShapeImperfection(
    shapeImperfectionSeed('eastbrook_weekly_vault'),
    FRAME,
    TOWN_BUILDING_IMPERFECTION,
  );

  it('is deterministic per id and differs between ids', () => {
    const again = createShapeImperfection(
      shapeImperfectionSeed('eastbrook_weekly_vault'),
      FRAME,
      TOWN_BUILDING_IMPERFECTION,
    );
    const other = createShapeImperfection(
      shapeImperfectionSeed('eastbrook_bank'),
      FRAME,
      TOWN_BUILDING_IMPERFECTION,
    );
    let differs = 0;
    sampleGrid((x, y, z) => {
      expect(displacement(again, x, y, z)).toEqual(displacement(field, x, y, z));
      const a = displacement(field, x, y, z);
      const b = displacement(other, x, y, z);
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-4) differs++;
    });
    expect(differs).toBeGreaterThan(100);
  });

  it('moves nothing at or below the footprint base', () => {
    for (let lx = -8; lx <= 8; lx += 0.5)
      for (let lz = -7; lz <= 7; lz += 0.5)
        for (const h of [0, -0.01, -1, -3]) {
          expect(displacement(field, ...framePoint(lx, h, lz))).toEqual([0, 0, 0]);
        }
  });

  it('stays inside its own bound, and the bound is small', () => {
    let largest = 0;
    sampleGrid((x, y, z) => {
      const [dx, dy, dz] = displacement(field, x, y, z);
      largest = Math.max(largest, Math.hypot(dx, dy, dz));
    });
    expect(largest).toBeGreaterThan(0.02);
    expect(largest).toBeLessThanOrEqual(field.maxDisplacement);
    // lean (<= 0.012 rad over 12 yd) + bow + sag + wobble
    expect(field.maxDisplacement).toBeLessThan(0.45);
    const prop = createShapeImperfection(
      shapeImperfectionSeed('eastbrook_market_stall_world_market'),
      { ...FRAME, halfWidth: 1.4, halfDepth: 1.1, height: 2.7, eaveY: FRAME.baseY + 2 },
      TOWN_PROP_IMPERFECTION,
    );
    expect(prop.maxDisplacement).toBeLessThan(0.15);
  });

  it('sags a ridge most at mid-span and not at the gable ends', () => {
    const sagOnly: ShapeImperfectionAmplitudes = {
      leanRadians: 0,
      bowYards: 0,
      sagYards: 0.15,
      wobbleYards: 0,
      wobbleWavelength: 7,
    };
    const sag = createShapeImperfection(1234, FRAME, sagOnly);
    const ridgeTop = 11;
    const mid = displacement(sag, ...framePoint(0, ridgeTop, 0))[1];
    expect(mid).toBeLessThan(-0.15 * 0.6 + 1e-9);
    expect(mid).toBeGreaterThanOrEqual(-0.15 - 1e-9);
    // the gable ends (the ridge axis is z) rest on their walls
    expect(Math.abs(displacement(sag, ...framePoint(0, ridgeTop, 6))[1])).toBeLessThan(1e-9);
    expect(Math.abs(displacement(sag, ...framePoint(0, ridgeTop, -6))[1])).toBeLessThan(1e-9);
    // an eave parallel to the ridge keeps a share of it
    const eave = displacement(sag, ...framePoint(7, ridgeTop, 0))[1];
    expect(eave).toBeLessThan(0);
    expect(eave).toBeGreaterThan(mid);
    // below the eave band the walls do not sag
    expect(displacement(sag, ...framePoint(0, 4, 0))[1]).toBe(0);
  });

  it('bows a tall wall outward at its middle and holds its corners', () => {
    const bowOnly: ShapeImperfectionAmplitudes = {
      leanRadians: 0,
      bowYards: 0.06,
      sagYards: 0,
      wobbleYards: 0,
      wobbleWavelength: 7,
    };
    const bow = createShapeImperfection(99, { ...FRAME, yaw: 0 }, bowOnly);
    const atWallMiddle = [0, 0, 0];
    bow.displace(FRAME.centerX + 7, FRAME.baseY + 6, FRAME.centerZ, atWallMiddle);
    expect(atWallMiddle[0]).toBeGreaterThan(0.015);
    expect(atWallMiddle[0]).toBeLessThanOrEqual(0.06 + 1e-9);
    const atCorner = [0, 0, 0];
    bow.displace(FRAME.centerX + 7, FRAME.baseY + 6, FRAME.centerZ + 6, atCorner);
    expect(Math.hypot(atCorner[0], atCorner[2])).toBeLessThan(1e-9);
    const oppositeWall = [0, 0, 0];
    bow.displace(FRAME.centerX - 7, FRAME.baseY + 6, FRAME.centerZ, oppositeWall);
    expect(oppositeWall[0]).toBeLessThan(0);
  });

  it('leans as a shear: the offset grows with height and stops at the top', () => {
    const leanOnly: ShapeImperfectionAmplitudes = {
      leanRadians: 0.0175,
      bowYards: 0,
      sagYards: 0,
      wobbleYards: 0,
      wobbleWavelength: 7,
    };
    const lean = createShapeImperfection(7, FRAME, leanOnly);
    const at = (h: number) => displacement(lean, ...framePoint(1, h, 1));
    const low = at(3);
    const high = at(9);
    expect(high[0] / low[0]).toBeCloseTo(3, 6);
    expect(high[2] / low[2]).toBeCloseTo(3, 6);
    expect(Math.hypot(high[0], high[2]) / 9).toBeLessThanOrEqual(Math.tan(0.0175) + 1e-12);
    // above the building's height a spire is carried, not leaned further
    expect(at(14)).toEqual(at(12));
  });
});

describe('the vertex pass', () => {
  const field = createShapeImperfection(42, FRAME, TOWN_BUILDING_IMPERFECTION);

  it('moves every vertex by the field, keeps counts, and keeps shared points shared', () => {
    const positions = new Float32Array([
      ...framePoint(1, 5, 1),
      ...framePoint(1, 5, 1),
      ...framePoint(-3, 0, 2),
      ...framePoint(2, 11, -1),
    ]);
    const original = Float32Array.from(positions);
    applyShapeImperfection(positions, null, field);
    expect(positions).toHaveLength(12);
    expect(Array.from(positions.slice(0, 3))).toEqual(Array.from(positions.slice(3, 6)));
    // the base vertex stays exactly where it was
    expect(Array.from(positions.slice(6, 9))).toEqual(Array.from(original.slice(6, 9)));
    const moved = displacement(field, original[9], original[10], original[11]);
    expect(positions[9]).toBeCloseTo(original[9] + moved[0], 5);
    expect(positions[10]).toBeCloseTo(original[10] + moved[1], 5);
  });

  it('keeps normals unit and turns them with the shear', () => {
    const leanOnly = createShapeImperfection(7, FRAME, {
      leanRadians: 0.0175,
      bowYards: 0,
      sagYards: 0,
      wobbleYards: 0,
      wobbleWavelength: 7,
    });
    const lean = displacement(leanOnly, ...framePoint(0, 4, 0));
    const along = Math.hypot(lean[0], lean[2]);
    // a wall facing the way the building leans tips its normal down; a floor
    // stays level (a shear carries horizontal planes to horizontal planes)
    const positions = new Float32Array([...framePoint(0, 4, 0), ...framePoint(0, 4, 0)]);
    const normals = new Float32Array([lean[0] / along, 0, lean[2] / along, 0, 1, 0]);
    applyShapeImperfection(positions, normals, leanOnly);
    expect(Math.hypot(normals[0], normals[1], normals[2])).toBeCloseTo(1, 6);
    expect(Math.hypot(normals[3], normals[4], normals[5])).toBeCloseTo(1, 6);
    expect(normals[1]).toBeLessThan(-0.005);
    expect(normals[1]).toBeGreaterThan(-0.02);
    expect(normals[4]).toBeCloseTo(1, 9);
  });

  it('does nothing for the identity field', () => {
    const positions = new Float32Array(framePoint(3, 6, 2));
    const before = Array.from(positions);
    applyShapeImperfection(positions, null, NO_SHAPE_IMPERFECTION);
    expect(Array.from(positions)).toEqual(before);
  });
});
