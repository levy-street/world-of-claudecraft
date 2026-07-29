import { describe, expect, it } from 'vitest';
import {
  boxProjectUvInto,
  buildOccluderIndex,
  ORM_CENTER,
  occlusionAt,
  periodicFbm2,
  periodicNoise2,
  SURFACE_TUNING,
  shadeSurfaceInto,
  UV_SCALE,
} from '../scripts/assets/terrorspark_groundshaker/surface_shading.mjs';

/** One up-facing unit quad (two triangles) at height y, offset by `at` in x/z. */
function upFacingQuad(y: number, atX = 0, atZ = 0, span = 1): [Float32Array, Float32Array] {
  const corners: [number, number][] = [
    [atX, atZ],
    [atX + span, atZ],
    [atX + span, atZ + span],
    [atX, atZ],
    [atX + span, atZ + span],
    [atX, atZ + span],
  ];
  const positions = new Float32Array(corners.flatMap(([x, z]) => [x, y, z]));
  const normals = new Float32Array(corners.flatMap(() => [0, 1, 0]));
  return [positions, normals];
}

function box(
  min: [number, number, number],
  max: [number, number, number],
  ownerId: number,
): { min: [number, number, number]; max: [number, number, number]; ownerId: number } {
  return { min, max, ownerId };
}

describe('tank surface shading: periodic noise', () => {
  it('tiles exactly at the period boundary', () => {
    for (const periodX of [4, 12, 48]) {
      for (const periodY of [4, 7, 48]) {
        for (const t of [0, 0.19, 0.63]) {
          expect(
            periodicNoise2(0, t * periodY, periodX, periodY, 7),
            `noise ${periodX}x${periodY} wrap in u at ${t}`,
          ).toBe(periodicNoise2(periodX, t * periodY, periodX, periodY, 7));
          expect(
            periodicNoise2(t * periodX, 0, periodX, periodY, 7),
            `noise ${periodX}x${periodY} wrap in v at ${t}`,
          ).toBe(periodicNoise2(t * periodX, periodY, periodX, periodY, 7));
        }
      }
    }
    // The fractal stack has to wrap on every octave, not just the base one, and
    // on BOTH axes even when a band is stretched along one of them: wrapping a
    // stretched band on a single shared period left a visible seam in the
    // brushed-grain and grime-run maps.
    for (const aspect of [1, 5, 0.18]) {
      for (const t of [0, 0.31, 0.77]) {
        expect(periodicFbm2(0, t, 6, 4, 11, aspect), `fbm aspect ${aspect} u wrap`).toBe(
          periodicFbm2(1, t, 6, 4, 11, aspect),
        );
        expect(periodicFbm2(t, 0, 6, 4, 11, aspect), `fbm aspect ${aspect} v wrap`).toBe(
          periodicFbm2(t, 1, 6, 4, 11, aspect),
        );
      }
    }
  });

  it('varies inside the tile rather than returning a constant', () => {
    const samples = new Set<number>();
    for (let step = 0; step < 32; step++) samples.add(periodicFbm2(step / 32, 0.4, 6, 4, 11));
    expect(samples.size).toBeGreaterThan(24);
    const values = [...samples];
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.15);
  });

  it('is reproducible across calls (no hidden state, no Math.random)', () => {
    const first = Array.from({ length: 16 }, (_, index) => periodicFbm2(index / 16, 0.2, 8, 3, 3));
    const second = Array.from({ length: 16 }, (_, index) => periodicFbm2(index / 16, 0.2, 8, 3, 3));
    expect(first).toEqual(second);
  });
});

describe('tank surface shading: world-space box projection', () => {
  it('refuses anything but a non-indexed triangle soup', () => {
    expect(() =>
      boxProjectUvInto(new Float32Array(12), new Float32Array(12), new Float32Array(8), 1),
    ).toThrow(/non-indexed triangle soup/);
  });

  it('keeps texel density fixed in world units regardless of part size', () => {
    const scale = 2;
    const spans: number[] = [];
    for (const span of [0.25, 1, 3]) {
      const [positions, normals] = upFacingQuad(0.5, 0, 0, span);
      const uv = new Float32Array((positions.length / 3) * 2);
      boxProjectUvInto(positions, normals, uv, scale);
      let min = Infinity;
      let max = -Infinity;
      for (let index = 0; index < uv.length; index += 2) {
        min = Math.min(min, uv[index]);
        max = Math.max(max, uv[index]);
      }
      spans.push((max - min) / span);
    }
    // Every quad spends the same number of repeats per world yard.
    for (const perYard of spans) expect(perYard).toBeCloseTo(scale, 6);
  });

  it('folds a distant part back to the origin by WHOLE repeats only', () => {
    const scale = UV_SCALE.leather;
    const [positions, normals] = upFacingQuad(1.9, -7.35, 4.6, 0.4);
    const uv = new Float32Array((positions.length / 3) * 2);
    boxProjectUvInto(positions, normals, uv, scale);

    let min = Infinity;
    for (let index = 0; index < uv.length; index += 2) min = Math.min(min, uv[index]);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(min).toBeLessThan(1);

    // An integer shift samples the same texels on a repeating sampler, so the
    // fold is only legal if every offset is a whole number.
    for (let vertex = 0; vertex < positions.length / 3; vertex++) {
      const rawU = positions[vertex * 3] * scale;
      const rawV = positions[vertex * 3 + 2] * scale;
      expect(uv[vertex * 2] - rawU).toBeCloseTo(Math.round(uv[vertex * 2] - rawU), 5);
      expect(uv[vertex * 2 + 1] - rawV).toBeCloseTo(Math.round(uv[vertex * 2 + 1] - rawV), 5);
    }
  });

  it('projects each triangle from its dominant axis and stays continuous across a shared edge', () => {
    // Two coplanar up-facing triangles share the diagonal; a per-triangle fold
    // would tear it, a per-group fold must not.
    const [positions, normals] = upFacingQuad(0.5, 2.4, -1.7, 1.5);
    const uv = new Float32Array((positions.length / 3) * 2);
    boxProjectUvInto(positions, normals, uv, 1.3);
    // Vertices 0 and 3 are the same world corner, as are 2 and 4.
    expect([uv[0], uv[1]]).toEqual([uv[6], uv[7]]);
    expect([uv[4], uv[5]]).toEqual([uv[8], uv[9]]);
  });

  it('uses the x/y plane for a z-facing triangle', () => {
    const positions = new Float32Array([0, 0, 5, 1, 0, 5, 1, 2, 5]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uv = new Float32Array(6);
    boxProjectUvInto(positions, normals, uv, 1);
    // v tracks world y, so the vertical extent of the triangle is 2 repeats.
    expect(uv[5] - uv[1]).toBeCloseTo(2, 6);
    expect(uv[2] - uv[0]).toBeCloseTo(1, 6);
  });
});

describe('tank surface shading: cavity occlusion', () => {
  const neighbour = box([-1, 0, -1], [1, 2, 1], 1);

  it('occludes a face pointing straight into a neighbouring part', () => {
    const index = buildOccluderIndex([neighbour]);
    expect(occlusionAt(index, 0, 1, -1.02, 0, 0, 1, 0)).toBeGreaterThan(0.5);
  });

  it('leaves a face pointing away from every part unoccluded', () => {
    const index = buildOccluderIndex([neighbour]);
    expect(occlusionAt(index, 0, 1, -1.02, 0, 0, -1, 0)).toBe(0);
  });

  it('never lets a part occlude itself', () => {
    const index = buildOccluderIndex([box([-1, 0, -1], [1, 2, 1], 4)]);
    expect(occlusionAt(index, 0, 1, -1.02, 0, 0, 1, 4)).toBe(0);
    expect(occlusionAt(index, 0, 1, -1.02, 0, 0, 1, 5)).toBeGreaterThan(0.5);
  });

  it('reports no occlusion with an empty occluder set', () => {
    expect(occlusionAt(buildOccluderIndex([]), 0, 1, 0, 0, 1, 0, 0)).toBe(0);
  });

  it('falls off with distance, and stops entirely past the sample reach', () => {
    const index = buildOccluderIndex([neighbour]);
    const touching = occlusionAt(index, 0, 1, -1.02, 0, 0, 1, 0);
    const nearby = occlusionAt(index, 0, 1, -1.15, 0, 0, 1, 0);
    expect(nearby).toBeGreaterThan(0);
    expect(nearby).toBeLessThan(touching);
    // The longest sample ray reaches 0.34 yards, so a wider gap reads as open.
    expect(occlusionAt(index, 0, 1, -1.4, 0, 0, 1, 0)).toBe(0);
  });
});

describe('tank surface shading: the baked macro pass', () => {
  const tint: [number, number, number] = [0.8, 0.6, 0.5];

  function shade(
    y: number,
    normal: [number, number, number],
    extra: Record<string, unknown> = {},
  ): number[] {
    const positions = new Float32Array([0, y, 0]);
    const normals = new Float32Array(normal);
    const out = new Float32Array(3);
    shadeSurfaceInto(positions, normals, out, { tint, variation: 0, ...extra });
    return [...out];
  }

  it('passes the tint through untouched when every band is switched off', () => {
    const flat = shade(1.5, [0, 1, 0], {
      weights: {
        midtone: 1,
        occlusion: 0,
        contact: 0,
        grime: 0,
        dust: 0,
        wear: 0,
        mottle: 0,
      },
    });
    for (let channel = 0; channel < 3; channel++) {
      expect(flat[channel]).toBeCloseTo(tint[channel], 6);
    }
  });

  it('never brightens past the zone tint, and never crushes past the floor', () => {
    for (const y of [0, 0.3, 1.2, 2.4]) {
      for (const normal of [
        [0, 1, 0],
        [0, -1, 0],
        [0.577, 0.577, 0.577],
      ] as [number, number, number][]) {
        const shaded = shade(y, normal);
        for (let channel = 0; channel < 3; channel++) {
          expect(shaded[channel]).toBeLessThanOrEqual(tint[channel] + 1e-6);
          expect(shaded[channel]).toBeGreaterThanOrEqual(
            tint[channel] * SURFACE_TUNING.floor - 1e-6,
          );
        }
      }
    }
  });

  it('darkens toward the ground: contact and grime both bite low on the hull', () => {
    const low = shade(0.02, [0, 1, 0])[0];
    const mid = shade(0.9, [0, 1, 0])[0];
    const high = shade(2.3, [0, 1, 0])[0];
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it('gives grime a warm cast rather than a neutral darkening', () => {
    const grimy = shade(0.05, [0, 1, 0]);
    const clean = shade(2.3, [0, 1, 0]);
    // Blue loses proportionally more than red where the dust settles.
    expect(grimy[2] / clean[2]).toBeLessThan(grimy[0] / clean[0]);
  });

  it('wears the paint thinner on a top bevel than on the flat face beside it', () => {
    const flat = shade(1.6, [0, 1, 0])[0];
    const bevel = shade(1.6, [0.577, 0.577, 0.577])[0];
    expect(bevel).toBeGreaterThan(flat);
  });

  it('turns the sideways and downward fillets into seams instead of wear', () => {
    const flat = shade(1.6, [0, 1, 0])[0];
    const upBevel = shade(1.6, [0.577, 0.577, 0.577])[0];
    const sideBevel = shade(1.6, [0.707, 0, 0.707])[0];
    const downBevel = shade(1.6, [0.577, -0.577, 0.577])[0];
    // A plate's own outline: the fillets light does not reach go darker than the
    // face, while the up-facing fillet still reads as thinned paint.
    expect(sideBevel).toBeLessThan(flat);
    expect(downBevel).toBeLessThan(flat);
    expect(upBevel).toBeGreaterThan(sideBevel);
    expect(upBevel).toBeGreaterThan(downBevel);
  });

  it('leaves a fillet at the crossover angle neutral', () => {
    // The wear and seam bands are two signs of ONE term, so neither may double
    // up on the same fillet; halfway between they cancel.
    const flat = shade(1.6, [0, 1, 0])[0];
    const crossover = shade(1.6, [0.7071, 0.5, 0.5])[0];
    expect(Math.abs(crossover - flat)).toBeLessThan(flat * 0.02);
  });

  it('darkens a vertex facing into a neighbouring part', () => {
    const occluders = buildOccluderIndex([box([-1, 0.5, -0.5], [1, 2.5, -0.06], 1)]);
    const open = shade(1.5, [0, 0, -1])[0];
    const cramped = shade(1.5, [0, 0, -1], { occluders, ownerId: 0 })[0];
    expect(cramped).toBeLessThan(open * 0.95);
  });

  it('is reproducible for the same inputs', () => {
    const run = () => shade(1.1, [0.4, 0.8, 0.45], { variation: 0.05, seed: 17 });
    expect(run()).toEqual(run());
  });

  it('applies mottle only when a part asks for it', () => {
    const plain = shade(1.4, [0, 1, 0], { variation: 0 });
    const mottled = shade(1.4, [0, 1, 0], { variation: 0.08, seed: 5 });
    expect(mottled).not.toEqual(plain);
  });
});

describe('tank surface tuning', () => {
  it('leaves the worn-bevel lift short of the material base colour', () => {
    // A zone whose tint is already 1 would otherwise land on the material's own
    // base colour and read as a painted-on white outline instead of thin paint.
    expect(SURFACE_TUNING.midtone * (1 + SURFACE_TUNING.wear)).toBeLessThan(1);
  });

  it('keeps the seam band deeper than the wear band', () => {
    // A plate outline that is subtler than its own worn edge does not read as an
    // outline at all.
    expect(SURFACE_TUNING.seam).toBeGreaterThan(SURFACE_TUNING.wear * 2);
  });

  it('pins the surface families every material samples at', () => {
    expect(UV_SCALE).toEqual({
      creamPaint: 1.15,
      violetPaint: 1.3,
      darkIron: 1.75,
      bronze: 2.6,
      leather: 5.2,
      textile: 7.5,
    });
  });

  it('pins the ORM midtone the exported material factors divide by', () => {
    expect(ORM_CENTER).toBeCloseTo(230 / 255, 10);
  });
});
