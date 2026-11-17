// The Gyre's storm-rock pillars (src/render/gyre_storm_rock.ts): four GLBs that share one painted
// cliff tile and ship NO texture of their own, held to a triangle and byte budget. A pillar
// re-exported under another material name would silently lose its texture (the prop kit converter
// binds the shared tile by name), and one re-exported with its atlas back would cost VRAM again.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isStormRockMaterial,
  STORM_ROCK_BUDGET,
  STORM_ROCK_MATERIAL,
} from '../src/render/gyre_storm_rock';

const root = join(__dirname, '..');

interface GlbJson {
  materials?: { name?: string }[];
  images?: unknown[];
  textures?: unknown[];
  accessors?: { count: number; type: string }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  extensionsUsed?: string[];
}

/** The JSON chunk of a GLB (12 byte header, then the first chunk is JSON). */
function glbJson(path: string): { json: GlbJson; bytes: number } {
  const buf = readFileSync(join(root, path));
  expect(buf.readUInt32LE(0), `${path} magic`).toBe(0x46546c67);
  const len = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16), `${path} first chunk`).toBe(0x4e4f534a);
  return {
    json: JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as GlbJson,
    bytes: buf.length,
  };
}

const KEYS = ['spire', 'bluff', 'arch', 'stone'] as const;

describe('the storm-rock material name rule', () => {
  it('names exactly the four pillars', () => {
    for (const k of KEYS) expect(isStormRockMaterial(`gyre_storm_${k}`)).toBe(true);
    expect(STORM_ROCK_MATERIAL.test('gyre_storm_spire')).toBe(true);
  });

  it('leaves the wall modules (own masonry atlas) and every other kit material alone', () => {
    for (const other of [
      'gyre_storm_wall_a',
      'gyre_storm_wall_b',
      'gyre_storm_spire_2',
      'xgyre_storm_stone',
      'council_seat_gate',
      'council_plaza_paving',
      '',
    ]) {
      expect(isStormRockMaterial(other), other).toBe(false);
    }
  });
});

describe.each(KEYS)('the %s pillar GLB', (key) => {
  const path = `public/models/props/gyre_storm_${key}.glb`;
  const { json, bytes } = glbJson(path);
  const prim = json.meshes?.[0]?.primitives[0];

  it('has one material, named so the shared cliff tile binds to it', () => {
    expect(json.materials?.length).toBe(1);
    expect(isStormRockMaterial(json.materials?.[0]?.name ?? '')).toBe(true);
  });

  it('ships no texture of its own: the tile is shared, so VRAM holds one image for all four', () => {
    expect(json.images ?? []).toEqual([]);
    expect(json.textures ?? []).toEqual([]);
    expect(json.extensionsUsed ?? []).not.toContain('KHR_texture_basisu');
  });

  it('carries what the projection and the shading need: normals, uvs, vertex colours', () => {
    expect(json.meshes?.length).toBe(1);
    expect(json.meshes?.[0]?.primitives.length).toBe(1);
    for (const attr of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) {
      expect(prim?.attributes[attr], `${key} ${attr}`).toBeTypeOf('number');
    }
  });

  it('is flat-shaded geometry, three vertices to a triangle, inside its triangle budget', () => {
    // no index buffer: every triangle owns its vertices (face normal and projection per triangle)
    expect(prim?.indices).toBeUndefined();
    const verts = json.accessors?.[prim?.attributes.POSITION ?? -1]?.count ?? 0;
    expect(verts % 3).toBe(0);
    const tris = verts / 3;
    expect(tris).toBeGreaterThan(300);
    expect(tris).toBeLessThanOrEqual(STORM_ROCK_BUDGET[key].tris);
  });

  it('is inside its byte budget (the raid-cut original was 290 to 880 KB with an atlas)', () => {
    expect(bytes).toBeLessThanOrEqual(STORM_ROCK_BUDGET[key].bytes);
  });
});

describe('the wall modules', () => {
  it('keep their own masonry atlas, so the shared tile is not bound to them', () => {
    for (const w of ['a', 'b']) {
      const { json } = glbJson(`public/models/props/gyre_storm_wall_${w}.glb`);
      expect(json.materials?.length).toBe(1);
      expect(isStormRockMaterial(json.materials?.[0]?.name ?? '')).toBe(false);
      expect((json.images ?? []).length).toBe(1);
    }
  });
});
