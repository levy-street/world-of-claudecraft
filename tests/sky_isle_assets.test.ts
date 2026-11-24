// The six flanking sky isles (public/models/props/sky_isle_*.glb, the floating islets either
// side of the view north from the Gyre, quartered_floating_debris_core.ts): seen only from
// 120 to 330 yards, each is held to a light budget, one small GPU-compressed colour map and no
// normal or ORM map (their detail never reads at that range; the material's flat factors stand
// in, matte stone), and its native box is the one the layout core plans it by. A re-export that
// brought the heavy textures back, or changed a box without the core, would ship unnoticed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISLE_MODELS, type IsleModel } from '../src/render/quartered_floating_debris_core';

const root = join(__dirname, '..');

interface GlbJson {
  images?: { mimeType?: string }[];
  textures?: { source?: number; extensions?: Record<string, { source?: number }> }[];
  nodes?: { mesh?: number; translation?: number[]; scale?: number[] }[];
  accessors?: { count: number; min?: number[]; max?: number[]; normalized?: boolean }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  materials?: {
    pbrMetallicRoughness?: {
      baseColorTexture?: { index: number };
      metallicRoughnessTexture?: { index: number };
      metallicFactor?: number;
    };
    normalTexture?: { index: number };
    occlusionTexture?: { index: number };
  }[];
}

/** The JSON chunk of a GLB and its byte size. */
function glb(model: string): { json: GlbJson; bytes: number } {
  const buf = readFileSync(join(root, `public/models/props/sky_isle_${model}.glb`));
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  const len = buf.readUInt32LE(12);
  return {
    json: JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as GlbJson,
    bytes: buf.length,
  };
}

/** The KTX2 texture's pixel width (its header's pixelWidth, bytes 20..24 of the image). */
function ktx2Width(model: string, json: GlbJson, textureIndex: number): number {
  const buf = readFileSync(join(root, `public/models/props/sky_isle_${model}.glb`));
  const jsonLen = buf.readUInt32LE(12);
  const binStart = 20 + jsonLen + 8;
  const texture = json.textures?.[textureIndex];
  const source = texture?.extensions?.KHR_texture_basisu?.source ?? texture?.source ?? -1;
  const image = (json as { images?: { bufferView?: number }[] }).images?.[source];
  const views = (json as { bufferViews?: { byteOffset?: number }[] }).bufferViews ?? [];
  const offset = binStart + (views[image?.bufferView ?? -1]?.byteOffset ?? 0);
  return buf.readUInt32LE(offset + 20);
}

const MODELS: readonly Exclude<IsleModel, 'raid'>[] = [
  'pines',
  'twin',
  'slab',
  'spire',
  'terraced',
  'crag',
];
const MAX_TRIS = 1700;
const MAX_BYTES = 140 * 1024;
const MAX_TEXTURE = 256;

describe('the flanking sky isles', () => {
  for (const model of MODELS) {
    describe(model, () => {
      const { json, bytes } = glb(model);

      it('is light: few triangles, a small file', () => {
        let tris = 0;
        for (const prim of json.meshes?.flatMap((m) => m.primitives) ?? []) {
          tris += (json.accessors?.[prim.indices ?? -1]?.count ?? 0) / 3;
        }
        expect(tris).toBeGreaterThan(400);
        expect(tris).toBeLessThanOrEqual(MAX_TRIS);
        expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
      });

      it('wears one small GPU-compressed colour map and no normal or ORM map, matte', () => {
        expect(json.images).toHaveLength(1);
        expect(json.images?.[0].mimeType).toBe('image/ktx2');
        const material = json.materials?.[0];
        const base = material?.pbrMetallicRoughness?.baseColorTexture;
        expect(base).toBeDefined();
        expect(ktx2Width(model, json, base?.index ?? -1)).toBeLessThanOrEqual(MAX_TEXTURE);
        expect(material?.normalTexture).toBeUndefined();
        expect(material?.occlusionTexture).toBeUndefined();
        expect(material?.pbrMetallicRoughness?.metallicRoughnessTexture).toBeUndefined();
        // the flat factor that stands in for the dropped map: stone, not metal
        expect(material?.pbrMetallicRoughness?.metallicFactor ?? 1).toBeLessThanOrEqual(0.05);
      });

      it('is the native box the layout core plans it by', () => {
        const node = json.nodes?.find((n) => n.mesh === 0);
        const position = json.accessors?.[json.meshes?.[0].primitives[0].attributes.POSITION ?? -1];
        if (!node || !position?.min || !position.max) throw new Error('no position bounds');
        const q = position.normalized ? 32767 : 1;
        const s = node.scale ?? [1, 1, 1];
        const t = node.translation ?? [0, 0, 0];
        const lo = position.min.map((v, k) => (v / q) * s[k] + t[k]);
        const hi = position.max.map((v, k) => (v / q) * s[k] + t[k]);
        const spec = ISLE_MODELS[model];
        expect(hi[0] - lo[0]).toBeCloseTo(spec.w, 1);
        expect(hi[2] - lo[2]).toBeCloseTo(spec.d, 1);
        expect(hi[1] - lo[1]).toBeCloseTo(spec.h, 1);
      });
    });
  }
});
