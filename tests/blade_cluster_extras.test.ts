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

  it('keeps every cluster on the grey base-to-tip ramp the shader reads back', () => {
    // the painted meadow's warm tips live in the shader behind paintTip
    // (BLADE_COMB_GLSL), so the geometry stays grey for every look, the ground
    // bake and the card tufts alike; roots at 0.86, tips at 1.1
    for (const geo of [clusterGeometry(mulberry32(7)), clusterGeometry(mulberry32(7), 3, true)]) {
      const col = geo.getAttribute('color');
      const kind = geo.getAttribute('aBladeKind');
      const pos = geo.getAttribute('position');
      for (let i = 0; i < col.count; i++) {
        if (kind && kind.getX(i) > 1.5) continue; // the flower has its own colours
        expect(col.getX(i)).toBe(col.getY(i));
        expect(col.getY(i)).toBe(col.getZ(i));
        expect(col.getY(i)).toBeGreaterThanOrEqual(0.86 - 1e-6);
        expect(col.getY(i)).toBeLessThanOrEqual(1.1 + 1e-6);
        if (pos.getY(i) === 0) expect(col.getY(i)).toBeCloseTo(0.86, 6);
      }
    }
  });
});
