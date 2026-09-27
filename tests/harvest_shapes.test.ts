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

    it('keeps a narrow cutting band across more than ten units of reach', () => {
      expect(box.max.x - box.min.x).toBeGreaterThan(10);
      expect(box.max.y - box.min.y).toBeLessThan(1.6);
      expect((box.max.x - box.min.x) / (box.max.y - box.min.y)).toBeGreaterThan(7);
      const middleLeadingEdge = 32 * 13;
      expect(pos.getX(middleLeadingEdge)).toBeCloseTo(0);
      expect(pos.getY(middleLeadingEdge)).toBeCloseTo(0, 1);
      expect(pos.getZ(middleLeadingEdge)).toBeCloseTo(0);
    });

    it('has separate open sheet edges and nonzero interior normals, never closed tubes', () => {
      const uv = geo.getAttribute('uv');
      let checked = 0;
      for (let i = 0; i < pos.count; i++) {
        const along = (Math.floor(i / 13) % 65) / 64;
        if (along < 0.03 || along > 0.97) continue;
        expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 5);
        if (uv.getY(i) !== 0) continue;
        const last = i + 12;
        expect(uv.getY(last)).toBe(1);
        const gap = Math.hypot(
          pos.getX(i) - pos.getX(last),
          pos.getY(i) - pos.getY(last),
          pos.getZ(i) - pos.getZ(last),
        );
        expect(gap).toBeGreaterThan(0.01);
        expect(gap).toBeLessThan(1.25);
        checked++;
      }
      expect(checked).toBeGreaterThan(400);
    });

    it('width spans at least 6 units', () => {
      expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(6);
    });

    it('uses short uneven trailing patches rather than seven parallel full-width ribbons', () => {
      const uv = geo.getAttribute('uv');
      const count = pos.count / 7;
      const starts = new Set<number>();
      expect(uv.getX(0)).toBe(0);
      expect(uv.getX(count - 1)).toBe(1);
      for (let layer = 1; layer < 7; layer++) {
        const start = uv.getX(layer * count);
        const end = uv.getX((layer + 1) * count - 1);
        starts.add(start);
        expect(end - start).toBeGreaterThan(0.1);
        expect(end - start).toBeLessThan(0.4);
      }
      expect(starts.size).toBe(6);
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
