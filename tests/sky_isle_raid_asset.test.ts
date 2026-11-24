// The raid isle's model (public/models/props/sky_isle_raid.glb, the raid's outside hung north
// of the Gyre, quartered_floating_debris_core.ts's 'raid' model): one generated mesh held to a
// triangle, texture and byte budget, its textures GPU-compressed, and its native box the one the
// layout core scales and lifts it by. A re-export that grew the mesh, shipped a raw WebP or PNG
// texture, or changed its size without the core would ship unnoticed without this pin.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISLE_MODELS } from '../src/render/quartered_floating_debris_core';

const root = join(__dirname, '..');
const PATH = 'public/models/props/sky_isle_raid.glb';

interface GlbJson {
  images?: { mimeType?: string; name?: string; bufferView?: number }[];
  bufferViews?: { byteOffset?: number }[];
  textures?: { source?: number; extensions?: Record<string, { source?: number }> }[];
  materials?: { emissiveTexture?: { index: number }; emissiveFactor?: number[] }[];
  nodes?: { mesh?: number; translation?: number[]; scale?: number[] }[];
  accessors?: { count: number; min?: number[]; max?: number[]; normalized?: boolean }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  extensionsUsed?: string[];
}

function glbJson(): { json: GlbJson; bytes: number } {
  const buf = readFileSync(join(root, PATH));
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  const len = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a);
  return {
    json: JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as GlbJson,
    bytes: buf.length,
  };
}

/** The budget: the one hero isle of the view, about four sky isles' worth of
 *  mesh, every texture at 512 (the sky isles' own size) so the file stays under
 *  a megabyte. */
const MAX_TRIS = 8000;
const MAX_BYTES = 1024 * 1024;

describe('the raid isle model', () => {
  const { json, bytes } = glbJson();

  it('is one mesh within its triangle and byte budget', () => {
    expect(json.meshes).toHaveLength(1);
    let tris = 0;
    for (const prim of json.meshes?.[0].primitives ?? []) {
      const idx = prim.indices;
      expect(idx).toBeDefined();
      tris += (json.accessors?.[idx as number].count ?? 0) / 3;
    }
    expect(tris).toBeGreaterThan(3000);
    expect(tris).toBeLessThanOrEqual(MAX_TRIS);
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('ships its textures GPU-compressed (KTX2) and its mesh meshopt-packed', () => {
    expect(json.images?.length).toBeGreaterThan(0);
    for (const image of json.images ?? []) expect(image.mimeType).toBe('image/ktx2');
    // every texture at 512 or under: a KTX2 header's pixelWidth and pixelHeight
    // sit at bytes 20 and 24 of the image
    const buf = readFileSync(join(root, PATH));
    const binStart = 20 + buf.readUInt32LE(12) + 8;
    for (const image of json.images ?? []) {
      const offset = binStart + (json.bufferViews?.[image.bufferView ?? -1]?.byteOffset ?? 0);
      expect(buf.readUInt32LE(offset + 20)).toBeLessThanOrEqual(512);
      expect(buf.readUInt32LE(offset + 24)).toBeLessThanOrEqual(512);
    }
    expect(json.extensionsUsed).toContain('KHR_texture_basisu');
    expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
  });

  it('carries its own glow map, so only its hot paint lights itself', () => {
    // the heart, the lava and the ice glow through the GLB's emissive map; a
    // re-export without it (or one that glows the whole colour map instead)
    // either loses the heart at night or lights the whole isle like day
    const material = json.materials?.[0];
    expect(material?.emissiveTexture).toBeDefined();
    expect(material?.emissiveFactor).toEqual([1, 1, 1]);
    const texture = json.textures?.[material?.emissiveTexture?.index ?? -1];
    const source = texture?.extensions?.KHR_texture_basisu?.source ?? texture?.source;
    expect(json.images?.[source ?? -1]?.name).toBe('raid_isle_glow');
  });

  it('is the native box the layout core plans it by, its tip at y 0', () => {
    // the POSITION bounds (quantized: normalized shorts) through the mesh
    // node's scale and translation give the model's real box
    const node = json.nodes?.find((n) => n.mesh === 0);
    const position = json.accessors?.[json.meshes?.[0].primitives[0].attributes.POSITION ?? -1];
    expect(node && position?.min && position.max).toBeTruthy();
    if (!node || !position?.min || !position.max) return;
    const q = position.normalized ? 32767 : 1;
    const s = node.scale ?? [1, 1, 1];
    const t = node.translation ?? [0, 0, 0];
    const lo = position.min.map((v, k) => (v / q) * s[k] + t[k]);
    const hi = position.max.map((v, k) => (v / q) * s[k] + t[k]);
    const spec = ISLE_MODELS.raid;
    expect(hi[0] - lo[0]).toBeCloseTo(spec.w, 1);
    expect(hi[2] - lo[2]).toBeCloseTo(spec.d, 1);
    expect(hi[1] - lo[1]).toBeCloseTo(spec.h, 1);
    expect(lo[1]).toBeCloseTo(0, 2);
    expect(spec.filler).toBe(false);
  });
});
