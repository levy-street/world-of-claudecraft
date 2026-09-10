import type * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildHarvestShape } from '../src/render/ability_vfx/harvest_shapes';

describe('buildHarvestShape', () => {
  describe('non-eruption', () => {
    const geo = buildHarvestShape(false);
    afterAll(() => geo.dispose());

    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const idx = geo.getIndex()!;
    geo.computeBoundingBox();
    const box = geo.boundingBox!;

    it('positions are fully finite', () => {
      for (let i = 0; i < pos.array.length; i++)
        expect(Number.isFinite(pos.array[i]), `position[${i}]`).toBe(true);
    });

    it('normals are fully finite after computeVertexNormals', () => {
      for (let i = 0; i < nrm.array.length; i++)
        expect(Number.isFinite(nrm.array[i]), `normal[${i}]`).toBe(true);
    });

    it('all indices are non-negative and within vertex count', () => {
      const n = pos.count;
      for (let i = 0; i < idx.count; i++) {
        const v = idx.getX(i);
        expect(v, `index[${i}]`).toBeGreaterThanOrEqual(0);
        expect(v, `index[${i}]`).toBeLessThan(n);
      }
    });

    it('has real depth along Z axis greater than 0.2', () => {
      expect(box.max.z - box.min.z).toBeGreaterThan(0.2);
    });

    it('disposes cleanly without throwing', () => {
      expect(() => buildHarvestShape(false).dispose()).not.toThrow();
    });
  });

  describe('eruption', () => {
    const geo = buildHarvestShape(true);
    afterAll(() => geo.dispose());

    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const idx = geo.getIndex()!;
    geo.computeBoundingBox();
    const box = geo.boundingBox!;

    it('positions are fully finite', () => {
      for (let i = 0; i < pos.array.length; i++)
        expect(Number.isFinite(pos.array[i]), `position[${i}]`).toBe(true);
    });

    it('normals are fully finite after computeVertexNormals', () => {
      for (let i = 0; i < nrm.array.length; i++)
        expect(Number.isFinite(nrm.array[i]), `normal[${i}]`).toBe(true);
    });

    it('all indices are non-negative and within vertex count', () => {
      const n = pos.count;
      for (let i = 0; i < idx.count; i++) {
        const v = idx.getX(i);
        expect(v, `index[${i}]`).toBeGreaterThanOrEqual(0);
        expect(v, `index[${i}]`).toBeLessThan(n);
      }
    });

    it('has real depth along Z axis greater than 0.2', () => {
      expect(box.max.z - box.min.z).toBeGreaterThan(0.2);
    });

    it('height spans at least 6 units', () => {
      expect(box.max.y - box.min.y).toBeGreaterThanOrEqual(6);
    });

    it('width spans at least 6 units', () => {
      expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(6);
    });

    it('lobes occupy distinct vertex blocks with no cross-lobe index references', () => {
      const ERUPTION_LOBES = 7;
      expect(pos.count % ERUPTION_LOBES).toBe(0);
      const vertsPerLobe = pos.count / ERUPTION_LOBES;
      for (let i = 0; i < idx.count; i += 3) {
        const l0 = Math.floor(idx.getX(i) / vertsPerLobe);
        const l1 = Math.floor(idx.getX(i + 1) / vertsPerLobe);
        const l2 = Math.floor(idx.getX(i + 2) / vertsPerLobe);
        expect(l1, `triangle ${i / 3}: vertex-lobe ${l0} vs ${l1}`).toBe(l0);
        expect(l2, `triangle ${i / 3}: vertex-lobe ${l0} vs ${l2}`).toBe(l0);
      }
    });

    it('disposes cleanly without throwing', () => {
      expect(() => buildHarvestShape(true).dispose()).not.toThrow();
    });
  });
});
