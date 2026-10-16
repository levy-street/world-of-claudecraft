import { describe, expect, it } from 'vitest';
import { buildRailMesh, RAIL_GAUGE, sampleRailLine } from '../src/render/rail_tracks_core';

const bend = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 20, y: 2, z: 8 },
  { x: 24, y: 4, z: 20 },
];

describe('spline railway', () => {
  it('resamples the spline at an even step through every authored point', () => {
    const line = sampleRailLine(bend, 0.75);
    expect(line.length).toBeGreaterThan(40);
    for (let i = 0; i + 2 < line.length; i++) {
      const d = Math.hypot(
        line[i + 1].x - line[i].x,
        line[i + 1].y - line[i].y,
        line[i + 1].z - line[i].z,
      );
      expect(d).toBeGreaterThan(0.55);
      expect(d).toBeLessThan(0.9);
    }
    expect(line[0]).toEqual(bend[0]);
    const end = line[line.length - 1];
    expect(Math.hypot(end.x - 24, end.z - 20)).toBeLessThan(0.8);
  });

  it('sweeps two continuous rails a gauge apart that follow the bend and the grade', () => {
    const mesh = buildRailMesh(bend);
    expect(mesh).not.toBeNull();
    const m = mesh!;
    expect(m.indices.length % 3).toBe(0);
    expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3);
    // the track climbs with the line
    let maxY = -Infinity;
    for (let v = 0; v < m.positions.length / 3; v++) maxY = Math.max(maxY, m.positions[v * 3 + 1]);
    expect(maxY).toBeGreaterThan(4);
    expect(maxY).toBeLessThan(4.6);
    // on a straight run, rail steel sits +-gauge/2 off the centreline
    const straight = buildRailMesh([
      { x: 0, y: 0, z: 0 },
      { x: 30, y: 0, z: 0 },
    ])!;
    const zs: number[] = [];
    for (let v = 0; v < straight.positions.length / 3; v++) {
      if (straight.colors[v * 3 + 2] > 0.45) zs.push(straight.positions[v * 3 + 2]);
    }
    expect(Math.min(...zs)).toBeCloseTo(-RAIL_GAUGE / 2 - 0.065, 2);
    expect(Math.max(...zs)).toBeCloseTo(RAIL_GAUGE / 2 + 0.065, 2);
  });

  it('re-seats the line on the floor sampler', () => {
    const flat = [
      { x: 0, y: 5, z: 0 },
      { x: 30, y: 5, z: 0 },
    ];
    const m = buildRailMesh(flat, { floorAt: () => 4 })!;
    let minY = Infinity;
    for (let v = 0; v < m.positions.length / 3; v++) minY = Math.min(minY, m.positions[v * 3 + 1]);
    expect(minY).toBeCloseTo(4.03, 2);
  });

  it('returns null for a degenerate line', () => {
    expect(buildRailMesh([{ x: 0, y: 0, z: 0 }])).toBeNull();
  });
});
