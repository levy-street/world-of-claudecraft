// The shared dequantizer behind the GLB geometry bakes (foliage, dungeon kits,
// the Sowfield): meshopt-quantized (normalized-integer) and interleaved sources
// must come out as plain float32 attributes, and already-plain float32
// attributes must come out as independent copies.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { toFloatAttribute } from '../src/render/attribute_float';

describe('toFloatAttribute', () => {
  it('copies a plain non-normalized float32 attribute (fast path)', () => {
    const src = new THREE.BufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6]), 3);
    const out = toFloatAttribute(src);
    expect(out).not.toBe(src);
    expect(out.array).toBeInstanceOf(Float32Array);
    expect(out.itemSize).toBe(3);
    expect(out.count).toBe(2);
    expect(out.normalized).toBe(false);
    expect(Array.from(out.array as Float32Array)).toEqual([1, 2, 3, 4, 5, 6]);
    // Independent storage: the callers applyMatrix4/merge the result, which
    // must never write back into the shared GLB cache.
    (out.array as Float32Array)[0] = 99;
    expect((src.array as Float32Array)[0]).toBe(1);
  });

  it('denormalizes a normalized uint16 attribute into [0, 1] floats', () => {
    const src = new THREE.BufferAttribute(new Uint16Array([0, 65535, 32768, 16384]), 2, true);
    const out = toFloatAttribute(src);
    expect(out.array).toBeInstanceOf(Float32Array);
    expect(out.normalized).toBe(false);
    const a = out.array as Float32Array;
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(1);
    expect(a[2]).toBeCloseTo(32768 / 65535, 6);
    expect(a[3]).toBeCloseTo(16384 / 65535, 6);
  });

  it('flattens an interleaved source into a plain attribute', () => {
    // Two vertices of [x, y, z, u, v]; the uv attribute reads at offset 3.
    const buf = new THREE.InterleavedBuffer(
      new Float32Array([1, 2, 3, 0.5, 0.25, 4, 5, 6, 0.75, 0.125]),
      5,
    );
    const uv = new THREE.InterleavedBufferAttribute(buf, 2, 3);
    const out = toFloatAttribute(uv);
    expect(out).toBeInstanceOf(THREE.BufferAttribute);
    expect(out.itemSize).toBe(2);
    expect(out.count).toBe(2);
    expect(Array.from(out.array as Float32Array)).toEqual([0.5, 0.25, 0.75, 0.125]);
  });

  it('denormalizes and flattens a normalized interleaved uint16 source (the meshopt shape)', () => {
    const buf = new THREE.InterleavedBuffer(new Uint16Array([0, 65535, 9999, 65535, 0, 9999]), 3);
    const pos = new THREE.InterleavedBufferAttribute(buf, 2, 0, true);
    const out = toFloatAttribute(pos);
    expect(out.array).toBeInstanceOf(Float32Array);
    expect(out.itemSize).toBe(2);
    expect(out.count).toBe(2);
    const a = out.array as Float32Array;
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(1);
    expect(a[2]).toBe(1);
    expect(a[3]).toBe(0);
  });
});
