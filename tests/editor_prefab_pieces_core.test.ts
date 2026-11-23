import { describe, expect, it } from 'vitest';
import {
  buildingOriginY,
  explodePrefab,
  PIECE_TARGET,
  type PrefabPiecesDef,
  worldPerModelYard,
} from '../src/editor/prefab_pieces_core';
import type { MapPlacement } from '../src/sim/map_doc';

// A 20-yard-wide, 10-tall building (model yards) whose base sits 0.2 below
// the origin, with one wall piece 5 model yards +x of the origin turned a
// quarter turn, and one upper-storey piece 6 yards up.
const DEF: PrefabPiecesDef = {
  assetId: 'tidehold/test',
  building: 'test',
  maxDim: 20,
  minY: -0.2,
  shell: { assetId: 'tidehold_parts/test/shell', maxDim: 18, minY: 4 },
  pieces: [
    {
      assetId: 'tidehold_parts/test/P001_Wall',
      x: 5,
      y: 0,
      z: 0,
      rotY: Math.PI / 2,
      s: 2,
      sy: 1,
      sz: 1,
      maxDim: 2.5,
      minY: 0,
    },
    {
      assetId: 'tidehold_parts/test/P002_Upper',
      x: 0,
      y: 6,
      z: -4,
      rotY: 0,
      s: 2,
      sy: 1.5,
      sz: 1,
      maxDim: 2.5,
      minY: -0.1,
    },
  ],
};

const building = (over: Partial<MapPlacement> = {}): MapPlacement => ({
  assetId: 'tidehold/test',
  x: 100,
  z: 200,
  rotY: 0,
  scale: 20 / PIECE_TARGET, // one model yard == one world yard
  collide: true,
  ...over,
});

const flat = () => 10;

describe('prefab pieces: explode', () => {
  it('seats the building origin from its ground, scale and lowest point', () => {
    const b = building();
    expect(worldPerModelYard(b.scale, DEF.maxDim)).toBeCloseTo(1, 9);
    // base at ground 10, origin is 0.2 above the base
    expect(buildingOriginY(b, DEF, flat)).toBeCloseTo(10.2, 9);
    // a detached building floats at its frozen ground; the y offset adds
    expect(buildingOriginY(building({ detached: true, groundY: 30, y: 1 }), DEF, flat)).toBeCloseTo(
      31.2,
      9,
    );
  });

  it('places every piece where the building had it', () => {
    const out = explodePrefab(building(), DEF, { groundAt: flat });
    expect(out.map((p) => p.assetId)).toEqual([
      'tidehold_parts/test/shell',
      'tidehold_parts/test/P001_Wall',
      'tidehold_parts/test/P002_Upper',
    ]);
    const [shell, wall, upper] = out;
    // shell: same transform, scale is the maxDim ratio, seated at the origin
    expect(shell.x).toBe(100);
    expect(shell.z).toBe(200);
    expect(shell.scale).toBeCloseTo(18 / PIECE_TARGET, 9);
    expect(shell.detached).toBe(true);
    expect(shell.groundY).toBeCloseTo(10.2 + 4, 9);
    // wall: 5 yards +x, a quarter turn, its 2.5-unit mesh at node scale 2
    expect(wall.x).toBeCloseTo(105, 9);
    expect(wall.z).toBeCloseTo(200, 9);
    expect(wall.rotY).toBeCloseTo(Math.PI / 2, 9);
    expect(wall.scale).toBeCloseTo((2 * 2.5) / PIECE_TARGET, 9);
    expect(wall.groundY).toBeCloseTo(10.2, 9);
    // upper: 6 up, 4 toward -z, stretched 1.5 in y, mesh base 0.1 below its node
    expect(upper.z).toBeCloseTo(196, 9);
    expect(upper.scaleY).toBeCloseTo(1.5, 9);
    expect(upper.groundY).toBeCloseTo(10.2 + 6 + -0.1 * 2 * 1.5, 9);
    for (const p of out) expect(p.collide).toBe(true);
  });

  it('rotates piece offsets with the building yaw and composes the yaws', () => {
    // a quarter turn about +Y takes +x toward -z
    const out = explodePrefab(building({ rotY: Math.PI / 2 }), DEF, { groundAt: flat });
    const wall = out[1];
    expect(wall.x).toBeCloseTo(100, 9);
    expect(wall.z).toBeCloseTo(195, 9);
    expect(wall.rotY).toBeCloseTo(Math.PI, 9);
    const upper = out[2];
    expect(upper.x).toBeCloseTo(96, 9);
    expect(upper.z).toBeCloseTo(200, 9);
  });

  it('scales with the building placement', () => {
    const b = building({ scale: (20 / PIECE_TARGET) * 2 });
    const out = explodePrefab(b, DEF, { groundAt: flat });
    expect(out[1].x).toBeCloseTo(110, 9);
    expect(out[1].scale).toBeCloseTo((2 * 2 * 2.5) / PIECE_TARGET, 9);
    expect(out[0].groundY).toBeCloseTo(10 + 0.4 + 8, 9);
  });

  it('honours the placement cap headroom', () => {
    expect(explodePrefab(building(), DEF, { groundAt: flat, room: 2 })).toHaveLength(2);
    expect(explodePrefab(building(), DEF, { groundAt: flat, room: 0 })).toHaveLength(0);
  });

  it('skips the shell for a pieces-only building', () => {
    const out = explodePrefab(building(), { ...DEF, shell: null }, { groundAt: flat });
    expect(out).toHaveLength(2);
    expect(out[0].assetId).toBe('tidehold_parts/test/P001_Wall');
  });
});
