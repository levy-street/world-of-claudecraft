import { describe, expect, it } from 'vitest';
import {
  advanceInstanceCount,
  cadenceIntervalForProjectedPixels,
  cadenceRefreshDue,
  farFieldDensityFraction,
  projectedPixelSize,
  projectionScalePixels,
  reorderInstanceDataByStableRank,
} from '../src/render/perceptual_lod_core';

function instanceData(points: readonly (readonly [number, number, number])[]): {
  matrices: Float32Array;
  colors: Float32Array;
} {
  const matrices = new Float32Array(points.length * 16);
  const colors = new Float32Array(points.length * 3);
  for (let index = 0; index < points.length; index++) {
    const [x, z, id] = points[index];
    for (let component = 0; component < 16; component++) {
      matrices[index * 16 + component] = id * 100 + component * 0.25;
    }
    matrices[index * 16 + 12] = x;
    matrices[index * 16 + 13] = id * 0.375;
    matrices[index * 16 + 14] = z;
    colors[index * 3] = id;
    colors[index * 3 + 1] = id * 0.125;
    colors[index * 3 + 2] = id * 0.25;
  }
  return { matrices, colors };
}

function orderedIds(data: { colors: Float32Array }): number[] {
  return Array.from(data.colors.filter((_, index) => index % 3 === 0));
}

describe('perceptual LOD projection', () => {
  it('derives focal pixels from the live projection and drawing-buffer height', () => {
    const projectionY = 1 / Math.tan(Math.PI / 6);
    expect(projectionScalePixels(projectionY, 720)).toBeCloseTo(623.54, 2);
    expect(projectionScalePixels(projectionY, 2160)).toBeCloseTo(1870.61, 2);
    expect(projectedPixelSize(0.8, 80, projectionScalePixels(projectionY, 720))).toBeCloseTo(
      6.24,
      2,
    );
  });

  it('fails closed for invalid projection inputs', () => {
    expect(projectionScalePixels(Number.NaN, 720)).toBe(0);
    expect(projectedPixelSize(1, 0, 600)).toBe(Number.POSITIVE_INFINITY);
    expect(projectedPixelSize(1, 20, Number.NaN)).toBe(Number.POSITIVE_INFINITY);
  });

  it('responds to live FOV as well as drawing-buffer resolution', () => {
    const narrow = projectionScalePixels(1 / Math.tan(Math.PI / 8), 720);
    const standard = projectionScalePixels(1 / Math.tan(Math.PI / 6), 720);
    const wide = projectionScalePixels(1 / Math.tan(Math.PI / 4), 720);
    expect(narrow).toBeGreaterThan(standard);
    expect(standard).toBeGreaterThan(wide);
    expect(projectedPixelSize(0.8, 80, narrow)).toBeGreaterThan(projectedPixelSize(0.8, 80, wide));
  });
});

describe('far-field density policy', () => {
  const input = {
    nearDistance: 70,
    activeRadius: 80,
    projectedPixels: 6,
    minKeepFraction: 0.55,
  };

  it('keeps the close field exact and removes chunks only after the fade is complete', () => {
    expect(farFieldDensityFraction({ ...input, nearDistance: 68 })).toBe(1);
    expect(farFieldDensityFraction({ ...input, nearDistance: 68.001 })).toBeGreaterThan(0.999);
    expect(farFieldDensityFraction({ ...input, nearDistance: 80 })).toBe(0);
    expect(farFieldDensityFraction({ ...input, nearDistance: 81 })).toBe(0);
  });

  it('uses a smooth, nested projected-size ladder inside the protected far band', () => {
    const fractions = [4, 6, 8, 10, 12].map((projectedPixels) =>
      farFieldDensityFraction({ ...input, nearDistance: 79.999, projectedPixels }),
    );
    expect(fractions[0]).toBeCloseTo(0.55, 5);
    expect(fractions[1]).toBeCloseTo(0.55, 5);
    expect(fractions[2]).toBeCloseTo(0.775, 5);
    expect(fractions[3]).toBe(1);
    expect(fractions[4]).toBe(1);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
  });

  it('slews by elapsed time, preserves zero-time state, and ignores one-instance chatter', () => {
    expect(advanceInstanceCount(100, 60, 100, 0)).toEqual({ count: 100, carry: 0 });
    expect(advanceInstanceCount(70, 71, 100, 1)).toEqual({ count: 70, carry: 0 });
    expect(advanceInstanceCount(70, 72, 100, 1)).toEqual({ count: 72, carry: 0 });

    const oneStep = advanceInstanceCount(100, 0, 100, 1);
    let split = { count: 100, carry: 0 };
    for (let frame = 0; frame < 60; frame++) {
      split = advanceInstanceCount(split.count, 0, 100, 1 / 60, split.carry);
    }
    expect(split.count).toBe(oneStep.count);
    expect(split.carry).toBeCloseTo(oneStep.carry, 10);
  });
});

describe('stable ranked instance prefixes', () => {
  it('produces the same world-identity order from shuffled build order', () => {
    const points = [
      [4.25, 8.5, 1],
      [-12.75, 3.5, 2],
      [19.5, -7.25, 3],
      [0.5, 1.25, 4],
      [31.75, 22.5, 5],
    ] as const;
    const shuffled = [points[3], points[0], points[4], points[1], points[2]];
    const a = instanceData(points);
    const b = instanceData(shuffled);

    reorderInstanceDataByStableRank(a.matrices, a.colors, points.length, 20_061, 17);
    reorderInstanceDataByStableRank(b.matrices, b.colors, points.length, 20_061, 17);

    expect(orderedIds(a)).toEqual(orderedIds(b));
    expect(new Set(orderedIds(a).slice(0, 3)).size).toBe(3);
  });

  it('keeps matrix and color payloads paired and varies families by salt', () => {
    const points = Array.from(
      { length: 12 },
      (_, index) => [index * 2.125 - 9, index * -1.75 + 4, index + 1] as const,
    );
    const grass = instanceData(points);
    const flowers = instanceData(points);
    const expectedPayload = new Map(
      points.map((point, index) => [
        point[2],
        {
          matrix: Array.from(grass.matrices.slice(index * 16, (index + 1) * 16)),
          color: Array.from(grass.colors.slice(index * 3, (index + 1) * 3)),
        },
      ]),
    );
    reorderInstanceDataByStableRank(grass.matrices, grass.colors, points.length, 7, 17);
    reorderInstanceDataByStableRank(flowers.matrices, flowers.colors, points.length, 7, 53);

    for (let index = 0; index < points.length; index++) {
      const id = grass.colors[index * 3];
      const expected = expectedPayload.get(id);
      expect(expected).toBeDefined();
      expect(Array.from(grass.matrices.slice(index * 16, (index + 1) * 16))).toEqual(
        expected?.matrix,
      );
      expect(Array.from(grass.colors.slice(index * 3, (index + 1) * 3))).toEqual(expected?.color);
    }
    expect(orderedIds(grass)).not.toEqual(orderedIds(flowers));
  });
});

describe('small-scenery cadence', () => {
  it('keeps readable motion full-rate and lowers only small projected details', () => {
    expect(cadenceIntervalForProjectedPixels(12)).toBe(0);
    expect(cadenceIntervalForProjectedPixels(10)).toBe(0);
    expect(cadenceIntervalForProjectedPixels(9.99)).toBe(1 / 20);
    expect(cadenceIntervalForProjectedPixels(4)).toBe(1 / 20);
    expect(cadenceIntervalForProjectedPixels(3.99)).toBe(1 / 10);
  });

  it('uses elapsed time rather than frame modulo and refreshes first use immediately', () => {
    expect(cadenceRefreshDue(4, Number.NEGATIVE_INFINITY, 0.1)).toBe(true);
    expect(cadenceRefreshDue(4.05, 4, 0.1)).toBe(false);
    expect(cadenceRefreshDue(4.1, 4, 0.1)).toBe(true);
    expect(cadenceRefreshDue(4.001, 4, 0)).toBe(true);
  });
});
