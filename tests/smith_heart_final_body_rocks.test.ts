// The Masterless Strength's floating Hammer rocks are sculpted pieces of the
// colossus (final_kit_shapes.ts colossusChunk), not a bare 20-face
// polyhedron in one flat colour (it read as a placeholder cube drifting in
// front of the great hammer):
//   - deterministic (no rng: every jitter is hashed);
//   - more facets than an icosahedron, knocked out of round;
//   - split flat on one side;
//   - toned per vertex, a gold vein among them;
//   - the body's effects build their instanced rocks from it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colossusChunk } from '../src/render/smith_heart_fx/final_kit_shapes';

describe("the colossus's floating rocks", () => {
  it('is a deterministic, faceted, out-of-round chunk split flat on one side', () => {
    const a = colossusChunk();
    const b = colossusChunk();
    const pa = a.getAttribute('position').array as Float32Array;
    expect(Array.from(pa)).toEqual(Array.from(b.getAttribute('position').array as Float32Array));
    // Detail 1: 80 triangles, never the bare 20-face icosahedron.
    expect(pa.length / 9).toBe(80);
    const radii: number[] = [];
    let minY = Infinity;
    for (let i = 0; i < pa.length; i += 3) {
      radii.push(Math.hypot(pa[i], pa[i + 1], pa[i + 2]));
      minY = Math.min(minY, pa[i + 1]);
    }
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.3);
    // The split face: the lowest corners share one shallow plane.
    const nearCut = [];
    for (let i = 1; i < pa.length; i += 3) if (pa[i] < minY + 0.05) nearCut.push(pa[i]);
    expect(nearCut.length).toBeGreaterThanOrEqual(6);
  });

  it('is toned per vertex with a gold vein', () => {
    const geo = colossusChunk();
    const c = geo.getAttribute('color').array as Float32Array;
    let gold = 0;
    let dark = 0;
    for (let i = 0; i < c.length; i += 3) {
      if (c[i] > 0.9 && c[i + 2] < 0.3) gold++;
      if (c[i] < 0.3) dark++;
    }
    expect(gold).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(0);
  });

  it('is what the body effects build their rocks from', () => {
    const src = readFileSync('src/render/smith_heart_fx/final_body_fx.ts', 'utf8');
    expect(src).toContain('const rockGeo = colossusChunk();');
    expect(src).toContain('vertexColors: true');
    expect(src).not.toMatch(/IcosahedronGeometry\(1, 0\)/);
  });
});
