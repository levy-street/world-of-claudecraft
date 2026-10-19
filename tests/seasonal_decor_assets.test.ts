// The Gourdlight kit's geometry bake (src/render/seasonal_decor_assets.ts
// floatGeometry): the optimizer quantizes positions to normalized integers and,
// on a big mesh (the keeper's stall), interleaves them. A bake into either must
// first become plain floats, or a node's dequantizing transform is clamped away
// and the piece draws at its quantized [-1, 1] size.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floatGeometry } from '../src/render/seasonal_decor_assets';

describe('floatGeometry', () => {
  it('turns an interleaved, normalized position into plain floats that take a bake', () => {
    // two vertices, stride 4 (xyz + pad), int16 normalized
    const raw = new Int16Array([32767, 0, -32767, 0, 0, 16384, 0, 0]);
    const buffer = new THREE.InterleavedBuffer(raw, 4);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0, true));
    const plain = floatGeometry(geometry);
    const pos = plain.getAttribute('position');
    expect(pos).toBeInstanceOf(THREE.BufferAttribute);
    expect((pos as THREE.BufferAttribute).normalized).toBe(false);
    expect(pos.array).toBeInstanceOf(Float32Array);
    expect(pos.getX(0)).toBeCloseTo(1, 4);
    expect(pos.getZ(0)).toBeCloseTo(-1, 4);
    expect(pos.getY(1)).toBeCloseTo(0.5, 3);
    // the node's dequantize (scale 3.5) survives the bake instead of clamping to 1
    plain.applyMatrix4(new THREE.Matrix4().makeScale(3.5, 3.5, 3.5));
    expect(plain.getAttribute('position').getX(0)).toBeCloseTo(3.5, 3);
  });

  it('leaves a plain float attribute alone and converts a normalized one', () => {
    const geometry = new THREE.BufferGeometry();
    const floats = new THREE.BufferAttribute(new Float32Array([1, 2, 3]), 3);
    geometry.setAttribute('position', floats);
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Int8Array([127, 0, -127]), 3, true),
    );
    const plain = floatGeometry(geometry);
    expect(Array.from(plain.getAttribute('position').array)).toEqual([1, 2, 3]);
    const n = plain.getAttribute('normal');
    expect(n.array).toBeInstanceOf(Float32Array);
    expect(n.getX(0)).toBeCloseTo(1, 4);
    expect(n.getZ(0)).toBeCloseTo(-1, 4);
  });
});

// The city dressing's per-piece triangle budget (scripts/assets/gourdlight_eve/model.py,
// stall.py, corn_shock.py). Every piece is instanced across three towns on every graphics
// tier, so a rebuild that fattens one (the volumetric corn shock, about 84 placements)
// must be a deliberate re-pin here, never silent drift.
describe('the Gourdlight decor kit triangle budget', () => {
  const BUDGET: Record<string, number> = {
    corn_shock: 4000,
    hay_bale: 5000,
    pumpkin_lit: 4300,
    pumpkin_small: 3000,
    gourd: 3800,
    lantern: 2400,
    garland_pole: 2700,
    keeper_stall: 42000,
    // the road lantern: a crook post, its hook and chain, a small carved pumpkin
    road_lantern: 3200,
  };
  it('keeps every street piece inside its pinned ceiling', () => {
    const buf = readFileSync(resolve(__dirname, '..', 'public/models/props/gourdlight_decor.glb'));
    const j = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as {
      nodes: Array<{ name?: string; mesh?: number }>;
      meshes: Array<{ primitives: Array<{ indices: number }> }>;
      accessors: Array<{ count: number }>;
    };
    const tris: Record<string, number> = {};
    for (const node of j.nodes) {
      if (node.mesh === undefined || !node.name) continue;
      tris[node.name] = j.meshes[node.mesh].primitives.reduce(
        (sum, p) => sum + j.accessors[p.indices].count / 3,
        0,
      );
    }
    for (const [name, ceiling] of Object.entries(BUDGET)) {
      expect(tris[name], name).toBeGreaterThan(0);
      expect(tris[name], name).toBeLessThanOrEqual(ceiling);
    }
  });
});
