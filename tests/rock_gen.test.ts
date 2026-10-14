import { describe, expect, it } from 'vitest';
import { buildRockModel, rockSeed } from '../src/render/rock_gen';
import { sanitizeMapDoc } from '../src/sim/map_doc';

// The Rock Generator: deterministic seeded mesh generation (same placement =>
// same rock on reload), the slider-shaping contract, and the rock* placement
// fields surviving the map sanitizer round trip.

const SEED = 12345;

describe('buildRockModel', () => {
  // rockTex 2 = the bare material (no canvas textures, so this runs in node).
  const P = { rockSeed: 42, rockNoise: 0.6, rockDetail: 0.5, rockSharp: 0.2, rockTex: 2 };

  it('is deterministic for the same params', () => {
    const a = buildRockModel(P).geometry.getAttribute('position');
    const b = buildRockModel(P).geometry.getAttribute('position');
    expect(a.count).toBe(b.count);
    for (let i = 0; i < a.count; i += 17) {
      expect(a.getX(i)).toBeCloseTo(b.getX(i), 10);
      expect(a.getY(i)).toBeCloseTo(b.getY(i), 10);
    }
  });

  it('a different seed grows a different rock', () => {
    const a = buildRockModel(P).geometry.getAttribute('position');
    const b = buildRockModel({ ...P, rockSeed: 43 }).geometry.getAttribute('position');
    let diff = 0;
    for (let i = 0; i < a.count; i += 7) {
      if (Math.abs(a.getX(i) - b.getX(i)) > 1e-6) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('smooth rocks weld to an indexed mesh; sharp rocks stay faceted', () => {
    const smooth = buildRockModel({ ...P, rockSharp: 0 }).geometry;
    const sharp = buildRockModel({ ...P, rockSharp: 1 }).geometry;
    expect(smooth.index).not.toBeNull();
    expect(sharp.index).toBeNull();
    // Faceted mesh owns a vertex per triangle corner: strictly more verts.
    expect(sharp.getAttribute('position').count).toBeGreaterThan(
      smooth.getAttribute('position').count,
    );
  });

  it('noise amount pushes vertices further from the unit sphere', () => {
    const spread = (n: number): number => {
      const pos = buildRockModel({ ...P, rockNoise: n }).geometry.getAttribute('position');
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
        min = Math.min(min, r);
        max = Math.max(max, r);
      }
      return max - min;
    };
    expect(spread(1)).toBeGreaterThan(spread(0));
  });

  it('rockSeed(x, z) is stable for an anchor', () => {
    expect(rockSeed(12.34, -56.78)).toBe(rockSeed(12.34, -56.78));
    expect(rockSeed(12.34, -56.78)).not.toBe(rockSeed(12.35, -56.78));
  });
});

describe('rock placement sanitizer round trip', () => {
  it('keeps (clamped) rock fields on placements', () => {
    const doc = sanitizeMapDoc({
      version: 2,
      meta: { id: 'm1', name: 'rocks', seed: SEED },
      content: {
        zones: [
          { id: 'z', name: 'Z', zMin: -10, zMax: 100, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
        ],
        camps: [],
        npcs: {},
        objects: [],
        roads: [],
      },
      terrainEdits: [],
      placements: [
        {
          assetId: 'rock/generated',
          x: 1,
          z: 2,
          rotY: 0,
          scale: 3,
          collide: false,
          rockSeed: 1234.7,
          rockNoise: 9,
          rockDetail: -1,
          rockSharp: 0.4,
          rockTex: 5,
        },
      ],
    });
    const p = doc?.placements[0];
    expect(p?.rockSeed).toBe(1235);
    expect(p?.rockNoise).toBe(1);
    expect(p?.rockDetail).toBe(0);
    expect(p?.rockSharp).toBe(0.4);
    expect(p?.rockTex).toBe(2);
  });
});
