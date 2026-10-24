import { describe, expect, it } from 'vitest';
import { newFlatCustomMap } from '../src/editor/custom_map';
import {
  BAKE_POS_UNIT,
  cavityBakeClear,
  cavityBakeGet,
  cavityBakeInvalidate,
  cavityBakeLoad,
  cavityBakeSerialize,
  cavityBakeStore,
  decodeBakeTile,
  encodeBakeTile,
} from '../src/render/cut_cavity_bake';
import type { CavityMeshArrays } from '../src/render/cut_cavity_core';
import { sanitizeMapDoc } from '../src/sim/map_doc';

// FORK: the baked cave cache and its document codec (Bake caves).

function sampleArrays(n: number): CavityMeshArrays {
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) {
    positions[v * 3] = 32 + (v % 17) * 0.937;
    positions[v * 3 + 1] = -16 + (v % 13) * 1.13;
    positions[v * 3 + 2] = 48 + (v % 11) * 0.71;
    const a = v * 0.37;
    normals[v * 3] = Math.cos(a) * 0.6;
    normals[v * 3 + 1] = Math.sin(a) * 0.6;
    normals[v * 3 + 2] = Math.sqrt(1 - 0.36);
    const tint = 0.3 + (v % 7) * 0.1;
    colors[v * 3] = tint;
    colors[v * 3 + 1] = tint;
    colors[v * 3 + 2] = tint;
  }
  const tris = Math.max(1, Math.floor(n / 3));
  const indices = new Uint32Array(tris * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i % n;
  return { positions, normals, colors, uvs, indices };
}

describe('cut_cavity_bake codec', () => {
  it('round-trips a tile within the quantization steps', () => {
    const a = sampleArrays(500);
    const rec = encodeBakeTile('cav:1:::1111:2,-1,3', { x0: 32, y0: -16, z0: 48 }, a);
    expect(rec.n).toBe(500);
    expect(rec.t).toBe(a.indices.length);
    const back = decodeBakeTile(rec);
    expect(back).not.toBeNull();
    const b = back!.arrays;
    for (let i = 0; i < a.positions.length; i++) {
      expect(Math.abs(b.positions[i] - a.positions[i])).toBeLessThanOrEqual(BAKE_POS_UNIT);
    }
    for (let i = 0; i < a.normals.length; i++) {
      expect(Math.abs(b.normals[i] - a.normals[i])).toBeLessThanOrEqual(1 / 127 + 1e-6);
    }
    for (let v = 0; v < 500; v++) {
      expect(Math.abs(b.colors[v * 3] - a.colors[v * 3])).toBeLessThanOrEqual(1 / 200 + 1e-6);
    }
    expect([...b.indices]).toEqual([...a.indices]);
    // UVs come back from the dominant normal axis
    expect(b.uvs.length).toBe(1000);
  });
  it('uses 32-bit indices past 65535 vertices and rejects mismatched bytes', () => {
    const a = sampleArrays(70000);
    const rec = encodeBakeTile('k', { x0: 0, y0: 0, z0: 0 }, a);
    expect(decodeBakeTile(rec)).not.toBeNull();
    expect(decodeBakeTile({ ...rec, n: 69999 })).toBeNull();
    expect(decodeBakeTile({ ...rec, idx: 'AAAA' })).toBeNull();
  });
  it('the cache invalidates by region and serializes what stands', () => {
    cavityBakeClear();
    const a = sampleArrays(30);
    cavityBakeStore('near', { x0: 0, y0: 0, z0: 0 }, a);
    cavityBakeStore('far', { x0: 160, y0: 0, z0: 160 }, a);
    expect(cavityBakeGet('near')).toBe(a);
    expect(cavityBakeInvalidate({ minX: -1, minZ: -1, maxX: 5, maxZ: 5 }, 16, 1)).toBe(1);
    expect(cavityBakeGet('near')).toBeNull();
    const tiles = cavityBakeSerialize();
    expect(tiles.map((t) => t.key)).toEqual(['far']);
    cavityBakeClear();
    expect(cavityBakeLoad(tiles)).toBe(1);
    expect(cavityBakeGet('far')?.positions.length).toBe(90);
    cavityBakeClear();
  });
  it('map documents exclude the renderer runtime bake cache', () => {
    const a = sampleArrays(12);
    const rec = encodeBakeTile('cav:1:::1111:0,0,0', { x0: 0, y0: 0, z0: 0 }, a);
    const doc = sanitizeMapDoc({
      ...JSON.parse(JSON.stringify(newFlatCustomMap('Bake', 'map_bake', 1700000000000))),
      caveBake: [rec, { key: 'bad' }, 7, { ...rec, key: '' }],
    });
    expect(doc).not.toBeNull();
    expect(doc).not.toHaveProperty('caveBake');
    cavityBakeClear();
    expect(cavityBakeLoad([rec])).toBe(1);
    expect(cavityBakeGet(rec.key)?.positions.length).toBe(36);
    cavityBakeClear();
  });
});
