import type * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildWarriorBlade,
  warriorBladePoint,
} from '../src/render/ability_vfx/warrior_blade_shape';

describe('buildWarriorBlade geometry', () => {
  const geo = buildWarriorBlade();
  afterAll(() => geo.dispose());
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
  const idx = geo.getIndex()!;
  geo.computeBoundingBox();
  const box = geo.boundingBox!;

  it('positions are fully finite', () => {
    for (let i = 0; i < pos.array.length; i++)
      expect(Number.isFinite(pos.array[i]), `position[${i}]`).toBe(true);
  });

  it('uvs are fully finite', () => {
    for (let i = 0; i < uv.array.length; i++)
      expect(Number.isFinite(uv.array[i]), `uv[${i}]`).toBe(true);
  });

  it('normals are fully finite after computeVertexNormals', () => {
    for (let i = 0; i < normal.array.length; i++)
      expect(Number.isFinite(normal.array[i]), `normal[${i}]`).toBe(true);
  });

  it('all indices are non-negative and within vertex count', () => {
    const n = pos.count;
    for (let i = 0; i < idx.count; i++) {
      const v = idx.getX(i);
      expect(v, `index[${i}]`).toBeGreaterThanOrEqual(0);
      expect(v, `index[${i}]`).toBeLessThan(n);
    }
  });

  it('bounding box is nondegenerate in all three axes', () => {
    expect(box.max.x - box.min.x).toBeGreaterThan(2);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.3);
    expect(box.max.z - box.min.z).toBeGreaterThan(0.8);
  });

  it('front and back faces have solid nonzero z thickness', () => {
    const cols = 36;
    const faceCount = 5 * (cols + 1);
    const innerRow = 1;
    const midCol = 18;
    const backVtx = innerRow * (cols + 1) + midCol;
    const frontVtx = faceCount + innerRow * (cols + 1) + midCol;
    expect(pos.getZ(frontVtx) - pos.getZ(backVtx)).toBeGreaterThan(0.1);
  });

  it('triangle count is at most 1000', () => {
    expect(idx.count / 3).toBeLessThanOrEqual(1000);
  });

  it('leading seam agrees with warriorBladePoint at sampled vertices within 0.012 offset', () => {
    const cols = 36;
    const faceCount = 5 * (cols + 1);
    const pt = { x: 0, y: 0, z: 0 };

    for (let col = 0; col <= cols; col += 4) {
      const u = col / cols;
      warriorBladePoint(u, 0, pt);
      const zBevel = 0.012 * Math.sin(u * Math.PI);

      const vNeg = col;
      expect(pos.getX(vNeg)).toBeCloseTo(pt.x, 5);
      expect(pos.getY(vNeg)).toBeCloseTo(pt.y, 5);
      expect(pos.getZ(vNeg)).toBeCloseTo(pt.z - zBevel, 5);

      const vPos = faceCount + col;
      expect(pos.getX(vPos)).toBeCloseTo(pt.x, 5);
      expect(pos.getY(vPos)).toBeCloseTo(pt.y, 5);
      expect(pos.getZ(vPos)).toBeCloseTo(pt.z + zBevel, 5);
    }
  });
});
