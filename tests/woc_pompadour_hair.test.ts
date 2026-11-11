// The pompadour hairstyle (scripts/assets/woc_character/build_pompadour_hair.mjs): built in
// the repo by sculpting the shipped mohawk (combed to a sleek cap, the front raised over the
// forehead). Pins what the sculpt decides and nothing else checks: the comb holds the
// hairline and takes spikes down, the raise is strongest at the front of the top and leaves
// the back, the sides and the hairline alone, the scalp clearance, the paint, and the shipped
// files' own names and texture. The file set, codecs, sizes and triangle counts are held by
// the library-wide suites.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MULLET_TOP_ID } from '../scripts/assets/woc_character/build_mullet_hair.mjs';
import {
  clearHead,
  combSurface,
  POMP_PATCH,
  POMP_SHAPE,
  POMPADOUR_ID,
  pompUv,
  pompWeight,
  raisePomp,
  weldSurface,
} from '../scripts/assets/woc_character/build_pompadour_hair.mjs';
import { WOC_HEAD_TYPES, wocHeadPieceUrl } from '../src/render/characters/woc_head_catalog';
import { WOC_HEAD_TINT_TABLE } from '../src/render/characters/woc_head_look_core';

const ROOT = path.resolve(__dirname, '..');
const TYPES = ['a', 'b'] as const;

/** A fan of four triangles: a ring of four corners round a middle one, as soup corners. */
function fan(mid: number[], ring: number[][]): { p: number[] }[] {
  return ring.flatMap((a, k) => [mid, a, ring[(k + 1) % 4]].map((p) => ({ p: [...p] })));
}

function glb(url: string): {
  json: {
    nodes: { name?: string; mesh?: number }[];
    meshes: { primitives: unknown[] }[];
    materials: { name: string }[];
    images: { name?: string; bufferView: number }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  bin: Buffer;
} {
  const buf = readFileSync(path.join(ROOT, 'public', url));
  const jsonLength = buf.readUInt32LE(12);
  const binAt = 20 + jsonLength;
  return {
    json: JSON.parse(buf.subarray(20, binAt).toString('utf8')),
    bin: buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt)),
  };
}

function imageBytes(file: ReturnType<typeof glb>): Buffer {
  expect(file.json.images).toHaveLength(1);
  const view = file.json.bufferViews[file.json.images[0].bufferView];
  const at = view.byteOffset ?? 0;
  return file.bin.subarray(at, at + view.byteLength);
}

describe('the pompadour hairstyle build', () => {
  it('is offered on both head types', () => {
    for (const type of TYPES) {
      expect(WOC_HEAD_TYPES[type].slots.hair.map((v) => v.id)).toContain(POMPADOUR_ID);
    }
  });

  it('welds a soup into one surface and finds its open edge', () => {
    const ring = [
      [-1, 0, -1],
      [1, 0, -1],
      [1, 0, 1],
      [-1, 0, 1],
    ];
    const surface = weldSurface(fan([0, 0, 0], ring));
    expect(surface.positions).toHaveLength(5);
    expect(surface.triangles).toHaveLength(4);
    // the middle is interior; the four ring corners are the edge
    expect(surface.edge).toEqual([false, true, true, true, true]);
  });

  it('combs a spike down and holds the hairline where it is', () => {
    const ring = [
      [-1, 0, -1],
      [1, 0, -1],
      [1, 0, 1],
      [-1, 0, 1],
    ];
    const surface = combSurface(weldSurface(fan([0, 4, 0], ring)), 3);
    // each pass halves the spike's height over the ring's plane: 4 -> 2 -> 1 -> 0.5
    expect(surface.positions[0]).toEqual([0, 0.5, 0]);
    expect(surface.positions.slice(1)).toEqual(ring);
  });

  it('raises the front of the top, and nothing at the back, the sides or below', () => {
    const s = POMP_SHAPE;
    const top = s.topY1 + 0.01;
    expect(pompWeight([0, top, s.frontZ + 0.01], s)).toBe(1);
    expect(pompWeight([0, top, s.crownZ - 0.01], s)).toBe(0);
    expect(pompWeight([s.halfWidth, top, s.frontZ], s)).toBe(0);
    expect(pompWeight([0, s.topY0 - 0.01, s.frontZ], s)).toBe(0);
    // it falls away across the head and toward the crown
    const centre = pompWeight([0, top, s.frontZ], s);
    expect(pompWeight([s.halfWidth / 2, top, s.frontZ], s)).toBeLessThan(centre);
    expect(pompWeight([0, top, (s.frontZ + s.crownZ) / 2], s)).toBeLessThan(centre);
  });

  it('lifts an interior vertex up and forward, wider, and never moves the edge', () => {
    const s = POMP_SHAPE;
    const y = s.topY1 + 0.01;
    const z = s.frontZ + 0.01;
    const ring = [
      [-0.02, y, z - 0.01],
      [0.02, y, z - 0.01],
      [0.02, y, z + 0.01],
      [-0.02, y, z + 0.01],
    ];
    const surface = raisePomp(weldSurface(fan([0.01, y, z], ring)), s);
    const w = pompWeight([0.01, y, z], s);
    expect(surface.positions[0][1]).toBeCloseTo(y + s.rise * w + s.crownLift, 9);
    expect(surface.positions[0][2]).toBeCloseTo(z + s.reach * w, 9);
    expect(surface.positions[0][0]).toBeCloseTo(0.01 * (1 + s.swell * w), 9);
    expect(surface.positions.slice(1)).toEqual(ring);
  });

  it('pushes a vertex inside the clearance back out to it, and leaves the rest', () => {
    // the "head" is everything below y = 0: distance is the height
    const surface = {
      positions: [
        [0, -0.002, 0],
        [0, 0.001, 0],
        [0, 0.02, 0],
      ],
      triangles: [],
      edge: [false, false, false],
    };
    const moved = clearHead(surface, (p) => p[1], POMP_SHAPE.clearance);
    expect(moved).toBe(2);
    expect(surface.positions[0][1]).toBeCloseTo(POMP_SHAPE.clearance, 9);
    expect(surface.positions[1][1]).toBeCloseTo(POMP_SHAPE.clearance, 9);
    expect(surface.positions[2]).toEqual([0, 0.02, 0]);
  });

  it('paints inside the texture patch: across the head in u, front to back in v', () => {
    const s = POMP_SHAPE;
    for (const p of [
      [-1, 0, -1],
      [1, 0, 1],
      [0, 0, 0],
    ]) {
      const [u, v] = pompUv(p, s);
      expect(u).toBeGreaterThanOrEqual(POMP_PATCH.u0);
      expect(u).toBeLessThanOrEqual(POMP_PATCH.u1);
      expect(v).toBeGreaterThanOrEqual(POMP_PATCH.v0);
      expect(v).toBeLessThanOrEqual(POMP_PATCH.v1);
    }
    expect(pompUv([0, 0, s.spanZ[1]], s)).toEqual([
      (POMP_PATCH.u0 + POMP_PATCH.u1) / 2,
      POMP_PATCH.v0,
    ]);
    expect(pompUv([0, 0, s.spanZ[0]], s)[1]).toBe(POMP_PATCH.v1);
    expect(pompUv([0.02, 0, 0], s)[0]).toBeGreaterThan(pompUv([-0.02, 0, 0], s)[0]);
  });

  it('tints as the mohawk does', () => {
    for (const type of TYPES) {
      expect(WOC_HEAD_TINT_TABLE[type][`hair_${POMPADOUR_ID}`]).toEqual(
        WOC_HEAD_TINT_TABLE.a[`hair_${MULLET_TOP_ID}`],
      );
    }
  });

  it('ships one piece per type: one primitive, on the mohawk texture byte for byte', () => {
    const top = glb(wocHeadPieceUrl('a', 'hair', MULLET_TOP_ID) as string);
    for (const type of TYPES) {
      const url = wocHeadPieceUrl(type, 'hair', POMPADOUR_ID);
      expect(url).toBe(`models/chars/players/woc/head_type_${type}_hair_pompadour.glb`);
      const file = glb(url as string);
      const drawn = file.json.nodes.filter((n) => n.mesh !== undefined);
      expect(drawn.map((n) => n.name)).toEqual([`WocHead_${type.toUpperCase()}_hair_pompadour`]);
      expect(file.json.meshes[drawn[0].mesh as number].primitives).toHaveLength(1);
      expect(file.json.materials.map((m) => m.name)).toEqual(['hair_pompadour']);
      expect(imageBytes(file).equals(imageBytes(top))).toBe(true);
    }
  });
});
