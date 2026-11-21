import { describe, expect, it } from 'vitest';
import { clusterGeometry, mulberry32 } from '../src/render/blade_grass';

describe('blade cluster extras (finer blades and a flower)', () => {
  it('leaves the shipped nine blades byte-identical when extras are on', () => {
    const stock = clusterGeometry(mulberry32(7));
    const extras = clusterGeometry(mulberry32(7), 3, true);
    const a = stock.getAttribute('position').array as Float32Array;
    const b = extras.getAttribute('position').array as Float32Array;
    expect(b.length).toBeGreaterThan(a.length);
    expect(Array.from(b.slice(0, a.length))).toEqual(Array.from(a));
    expect(stock.getAttribute('aBladeKind')).toBeUndefined();
  });

  it('tags every vertex: shipped blades 0, extra blades 1, the flower 2', () => {
    const geo = clusterGeometry(mulberry32(7), 3, true);
    const kinds = Array.from(geo.getAttribute('aBladeKind').array as Float32Array);
    const shipped = clusterGeometry(mulberry32(7)).getAttribute('position').count;
    expect(kinds.slice(0, shipped).every((k) => k === 0)).toBe(true);
    expect(kinds.slice(shipped).some((k) => k === 1)).toBe(true);
    expect(kinds.filter((k) => k === 2).length).toBeGreaterThan(3);
    expect(kinds.length).toBe(geo.getAttribute('position').count);
  });

  it('builds extras for the two-segment band tuft too', () => {
    const geo = clusterGeometry(mulberry32(3), 2, true);
    const kinds = Array.from(geo.getAttribute('aBladeKind').array as Float32Array);
    expect(kinds).toContain(1);
    expect(kinds).toContain(2);
  });

  it('marks each vertex across the blade: -1 and +1 edges, 0 at the tip spine', () => {
    const geo = clusterGeometry(mulberry32(7), 3, true);
    const across = Array.from(geo.getAttribute('aBladeAcross').array as Float32Array);
    expect(across.length).toBe(geo.getAttribute('position').count);
    expect(new Set(across)).toEqual(new Set([-1, 0, 1]));
  });

  it('warms the blade tips on the carpet and band geometry only', () => {
    const plain = clusterGeometry(mulberry32(7)).getAttribute('color');
    for (let i = 0; i < plain.count; i++) {
      // the shared cluster (ground bake, card tufts) keeps its grey ramp
      expect(plain.getX(i)).toBe(plain.getY(i));
      expect(plain.getY(i)).toBe(plain.getZ(i));
    }
    const painted = clusterGeometry(mulberry32(7), 3, true);
    const col = painted.getAttribute('color');
    const pos = painted.getAttribute('position');
    let warmTips = 0;
    for (let i = 0; i < col.count; i++) {
      if (pos.getY(i) === 0) {
        // roots stay grey
        expect(col.getX(i)).toBeCloseTo(col.getZ(i), 6);
      } else if (col.getX(i) > col.getY(i) && col.getY(i) > col.getZ(i)) {
        warmTips++;
      }
    }
    expect(warmTips).toBeGreaterThan(0);
  });
});
