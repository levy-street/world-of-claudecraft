// The Gourdlight kit's geometry bake (src/render/seasonal_decor_assets.ts
// floatGeometry): the optimizer quantizes positions to normalized integers and,
// on a big mesh (the keeper's stall), interleaves them. A bake into either must
// first become plain floats, or a node's dequantizing transform is clamped away
// and the piece draws at its quantized [-1, 1] size.
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
