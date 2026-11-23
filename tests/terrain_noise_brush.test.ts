import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import {
  NOISE_MESH_SPACING,
  NOISE_SIZE_LIMIT,
  noiseBrushField,
  noiseBrushOctaves,
  noisePlateau,
  noiseStampSpacingIn,
} from '../src/sim/terrain_noise_brush';
import type { HeightStamp, WorldContent } from '../src/sim/types';
import { invalidateTerrainEditIndex, terrainHeight } from '../src/sim/world';

// The Noise sculpt brush (src/sim/terrain_noise_brush.ts): add stamps whose
// delta is scaled by a seeded world-space fractal field, so a stroke paints
// natural undulation across the whole brush instead of one dome in its middle.

const SEED = 1234;

afterEach(() => {
  setActiveWorldContent(null);
  invalidateTerrainEditIndex();
});

function content(edits: HeightStamp[]): WorldContent {
  return { ...BUILTIN_WORLD, terrainEdits: edits };
}

const NO_EDITS: WorldContent = { ...BUILTIN_WORLD, terrainEdits: [] };

function baseHeightAt(x: number, z: number): number {
  setActiveWorldContent(NO_EDITS);
  return terrainHeight(x, z, SEED);
}

function noiseDab(x: number, z: number, radius: number, seed: number): HeightStamp {
  return {
    x,
    z,
    radius,
    delta: 1,
    falloff: 'smooth',
    noiseSize: 6,
    noiseSeed: seed,
    noiseRough: 0.5,
  };
}

describe('noise field', () => {
  it('is zero-centred with a steady spread at every bump size and roughness', () => {
    for (const size of [3, 8, 24]) {
      for (const rough of [0, 0.5, 1]) {
        let sum = 0;
        let sum2 = 0;
        let n = 0;
        for (let i = 0; i < 120; i++) {
          for (let j = 0; j < 120; j++) {
            const v = noiseBrushField(
              i * size * 0.29 + 3.1,
              j * size * 0.31 - 8.7,
              size,
              rough,
              77,
            );
            sum += v;
            sum2 += v * v;
            n++;
          }
        }
        const mean = sum / n;
        const std = Math.sqrt(sum2 / n - mean * mean);
        expect(Math.abs(mean), `size ${size} rough ${rough}`).toBeLessThan(0.03);
        expect(std, `size ${size} rough ${rough}`).toBeGreaterThan(0.38);
        expect(std, `size ${size} rough ${rough}`).toBeLessThan(0.52);
      }
    }
  });

  it('is deterministic and changes with the seed', () => {
    expect(noiseBrushField(12.5, -40.25, 8, 0.5, 9)).toBe(noiseBrushField(12.5, -40.25, 8, 0.5, 9));
    expect(noiseBrushField(12.5, -40.25, 8, 0.5, 9)).not.toBe(
      noiseBrushField(12.5, -40.25, 8, 0.5, 10),
    );
  });

  it('adds finer layers as the bumps grow, down to about a yard and a half', () => {
    expect(noiseBrushOctaves(3)).toBe(2);
    expect(noiseBrushOctaves(8)).toBe(3);
    expect(noiseBrushOctaves(16)).toBe(4);
    expect(noiseBrushOctaves(48)).toBe(5);
  });

  it('weights a dab with a soft plateau that reaches zero at the rim', () => {
    expect(noisePlateau(0)).toBe(1);
    expect(noisePlateau(0.5)).toBeCloseTo(0.84375, 10);
    expect(noisePlateau(1)).toBe(0);
    expect(noisePlateau(1.5)).toBe(0);
    for (let t = 0; t < 1; t += 0.05)
      expect(noisePlateau(t + 0.05)).toBeLessThanOrEqual(noisePlateau(t));
  });
});

describe('noise stamps in the heightfield', () => {
  it('paints bumps and dips across the whole brush, not a dome in the middle', () => {
    const stamp = noiseDab(40, 120, 30, 4242);
    const samples: number[] = [];
    for (let x = 40 - 29.5; x <= 40 + 29.5; x += 0.25) {
      const h0 = baseHeightAt(x, 120);
      setActiveWorldContent(content([stamp]));
      samples.push(terrainHeight(x, 120, SEED) - h0);
    }
    let extrema = 0;
    for (let i = 1; i < samples.length - 1; i++) {
      const a = samples[i] - samples[i - 1];
      const b = samples[i + 1] - samples[i];
      if (a * b < 0) extrema++;
    }
    // The old dab was ONE dome (a single extremum) at the cursor.
    expect(extrema).toBeGreaterThanOrEqual(6);
    expect(samples.some((d) => d > 0.05)).toBe(true);
    expect(samples.some((d) => d < -0.05)).toBe(true);
    // Detail reaches out to the brush edge: the outer band is not flat.
    const outer = samples.filter((_, i) => {
      const t = Math.abs(40 - 29.5 + i * 0.25 - 40) / 30;
      return t > 0.4 && t < 0.7;
    });
    expect(Math.max(...outer.map(Math.abs))).toBeGreaterThan(0.1);
  });

  it('leaves the ground outside the brush untouched', () => {
    const stamp = noiseDab(0, 60, 12, 7);
    const h0 = baseHeightAt(0, 60 + 12.5);
    setActiveWorldContent(content([stamp]));
    expect(terrainHeight(0, 60 + 12.5, SEED)).toBe(h0);
  });

  it('dabs of one stroke share one pattern (coherent, so a drag builds rolling ground)', () => {
    const a = noiseDab(0, 100, 20, 555);
    const b = noiseDab(12, 100, 20, 555);
    const px = 5;
    const pz = 103;
    const h0 = baseHeightAt(px, pz);
    setActiveWorldContent(content([a]));
    const da = terrainHeight(px, pz, SEED) - h0;
    setActiveWorldContent(content([b]));
    const db = terrainHeight(px, pz, SEED) - h0;
    const ta = Math.hypot(px - a.x, pz - a.z) / a.radius;
    const tb = Math.hypot(px - b.x, pz - b.z) / b.radius;
    // Divide out each dab's own falloff: both see the SAME field value.
    expect(da / noisePlateau(ta)).toBeCloseTo(db / noisePlateau(tb), 9);
  });

  it('matches the documented formula exactly, whatever order points and stamps are sampled in', () => {
    const a = noiseDab(-20, 80, 18, 1);
    const b: HeightStamp = { ...noiseDab(-14, 84, 15, 2), noiseSize: 11, noiseRough: 0.9 };
    const points: [number, number][] = [
      [-18, 82],
      [-15, 83],
      [-18, 82],
      [-22, 79.5],
    ];
    const bases = points.map(([x, z]) => baseHeightAt(x, z));
    setActiveWorldContent(content([a, b]));
    const got = points.map(([x, z]) => terrainHeight(x, z, SEED));
    const again = [...points].reverse().map(([x, z]) => terrainHeight(x, z, SEED));
    expect(again.reverse()).toEqual(got);
    points.forEach(([x, z], i) => {
      let want = bases[i];
      for (const s of [a, b]) {
        // world.ts applyStamp's own distance form (sqrt, not hypot: bit-exact).
        const dx = x - s.x;
        const dz = z - s.z;
        const t = Math.sqrt(dx * dx + dz * dz) / s.radius;
        if (t >= 1) continue;
        const f = noiseBrushField(x, z, s.noiseSize ?? 0, s.noiseRough ?? 0.5, s.noiseSeed ?? 0);
        want = want + s.delta * (noisePlateau(t) * f);
      }
      expect(got[i]).toBe(want);
    });
  });
});

describe('noise stamp mesh spacing', () => {
  it('asks for a finer mesh only where a noise stamp reaches', () => {
    const plain: HeightStamp = { x: 0, z: 0, radius: 10, delta: 2, falloff: 'smooth' };
    const noisy = noiseDab(100, 100, 10, 3);
    const edits = [plain, noisy];
    expect(noiseStampSpacingIn(undefined, 1, 0, 0, 60, 60)).toBe(Number.POSITIVE_INFINITY);
    expect(noiseStampSpacingIn(edits, 1, -30, -30, 30, 30)).toBe(Number.POSITIVE_INFINITY);
    expect(noiseStampSpacingIn(edits, 1, 60, 60, 120, 120)).toBe(NOISE_MESH_SPACING);
    // The disc's bounding box touching the rect counts (the chunk carries it).
    expect(noiseStampSpacingIn(edits, 1, 110, 60, 170, 120)).toBe(NOISE_MESH_SPACING);
    expect(noiseStampSpacingIn(edits, 1, 111, 60, 170, 120)).toBe(Number.POSITIVE_INFINITY);
  });

  it('follows a stamp moved in place once the content generation moves', () => {
    const noisy = noiseDab(100, 100, 10, 3);
    const edits = [noisy];
    expect(noiseStampSpacingIn(edits, 5, 60, 60, 120, 120)).toBe(NOISE_MESH_SPACING);
    noisy.x = 400;
    noisy.z = 400;
    expect(noiseStampSpacingIn(edits, 6, 60, 60, 120, 120)).toBe(Number.POSITIVE_INFINITY);
    expect(noiseStampSpacingIn(edits, 6, 380, 380, 440, 440)).toBe(NOISE_MESH_SPACING);
  });

  it('sees each dab of a live stroke, before the pointer-up generation bump', () => {
    // A stroke pushes into the SAME array and bumps the content generation
    // only on release; every dab's chunk rebuild must already mesh fine.
    const plain: HeightStamp = { x: 0, z: 0, radius: 10, delta: 2, falloff: 'smooth' };
    const edits = [plain];
    expect(noiseStampSpacingIn(edits, 11, 180, 180, 300, 300)).toBe(Number.POSITIVE_INFINITY);
    edits.push(noiseDab(240, 245, 14, 4));
    expect(noiseStampSpacingIn(edits, 11, 180, 180, 300, 300)).toBe(NOISE_MESH_SPACING);
  });

  it('ignores level stamps (the noise only rides add stamps)', () => {
    const level: HeightStamp = { ...noiseDab(0, 0, 10, 1), mode: 'level' };
    expect(noiseStampSpacingIn([level], 9, -20, -20, 20, 20)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('noise stamps in saved maps', () => {
  const ZONE = {
    id: 'z',
    name: 'Z',
    zMin: -10,
    zMax: 100,
    hub: { x: 0, z: 0, radius: 5, name: 'H' },
  };
  const docWith = (terrainEdits: unknown[]): Record<string, unknown> => ({
    version: 2,
    meta: { id: 'm1', name: 'Map', seed: 7 },
    content: { zones: [ZONE], camps: [], npcs: {}, objects: [], roads: [] },
    terrainEdits,
    placements: [],
  });

  it('round-trips the noise fields, so a reload keeps the undulation', () => {
    const stamp = noiseDab(4, 5, 12, 9876);
    const doc = sanitizeMapDoc(JSON.parse(JSON.stringify(docWith([stamp]))));
    expect(doc?.terrainEdits[0]).toMatchObject({
      noiseSize: 6,
      noiseSeed: 9876,
      noiseRough: 0.5,
    });
  });

  it('clamps untrusted values', () => {
    const doc = sanitizeMapDoc(
      docWith([
        { ...noiseDab(0, 0, 10, 1), noiseSize: 1e6, noiseSeed: -5.5, noiseRough: 3 },
        { ...noiseDab(0, 0, 10, 1), noiseSize: 0.01, noiseSeed: 12.75 },
      ]),
    );
    expect(doc?.terrainEdits[0]).toMatchObject({
      noiseSize: NOISE_SIZE_LIMIT.max,
      noiseSeed: 0,
      noiseRough: 1,
    });
    expect(doc?.terrainEdits[1]).toMatchObject({ noiseSize: NOISE_SIZE_LIMIT.min, noiseSeed: 12 });
  });

  it('drops noise fields from level stamps and ignores a non-numeric size', () => {
    const doc = sanitizeMapDoc(
      docWith([
        { ...noiseDab(0, 0, 10, 1), mode: 'level' },
        { ...noiseDab(0, 0, 10, 1), noiseSize: 'big' },
      ]),
    );
    expect(doc?.terrainEdits[0].noiseSize).toBeUndefined();
    expect(doc?.terrainEdits[1].noiseSize).toBeUndefined();
    expect(doc?.terrainEdits[1].noiseSeed).toBeUndefined();
  });
});
