import { describe, expect, it } from 'vitest';
import { generateCaveRigNodes } from '../src/editor/cave_gen_core';

// The Caves tool's rig generator: a terrain-BLIND spline through the authored
// control points. What you model is what you get ? the mouths land exactly on
// their rig points at exactly their authored size, and translating the whole
// rig translates the generated cave rigidly (the whole-cave Move contract).

describe('generateCaveRigNodes (terrain-independent rig)', () => {
  it('routes through every control point (waypoints visited)', () => {
    const rig = [
      { x: 0, y: 5, z: 0 },
      { x: 40, y: 5, z: 30 },
      { x: 80, y: 5, z: 0 },
    ];
    const nodes = generateCaveRigNodes(rig, 5);
    expect(nodes.length).toBeGreaterThan(10);
    for (const cp of rig) {
      const nearest = Math.min(...nodes.map((n) => Math.hypot(n.x - cp.x, n.z - cp.z)));
      expect(nearest).toBeLessThan(4);
    }
  });

  it('mouths land EXACTLY on the first/last rig points at the authored girth', () => {
    const nodes = generateCaveRigNodes(
      [
        { x: 0, y: 12, z: 0, r: 1 },
        { x: 30, y: -6, z: 40 },
        { x: 90, y: 3, z: 10, r: 2 },
      ],
      5,
      { variance: 1, seed: 7 },
    );
    expect(nodes[0].x).toBeCloseTo(0, 5);
    expect(nodes[0].z).toBeCloseTo(0, 5);
    expect(nodes[0].y).toBeCloseTo(12, 5);
    expect(nodes[0].radius).toBeCloseTo(5, 5);
    const last = nodes[nodes.length - 1];
    expect(last.x).toBeCloseTo(90, 5);
    expect(last.z).toBeCloseTo(10, 5);
    expect(last.y).toBeCloseTo(3, 5);
    expect(last.radius).toBeCloseTo(10, 5);
  });

  it('floor runs exactly through authored heights (no terrain, no clamps)', () => {
    // A deep dive mid-path: the old generator would have clamped this to the
    // surface/grade; the rebuilt one obeys the model verbatim.
    const nodes = generateCaveRigNodes(
      [
        { x: 0, y: 0, z: 0 },
        { x: 40, y: -30, z: 0 },
        { x: 80, y: 0, z: 0 },
      ],
      4,
    );
    const mid = nodes.reduce((best, n) => (Math.abs(n.x - 40) < Math.abs(best.x - 40) ? n : best));
    expect(mid.y).toBeLessThan(-25);
  });

  it('translating the whole rig translates the cave rigidly (whole-cave move)', () => {
    const rig = [
      { x: 0, y: 4, z: 0, r: 1 },
      { x: 35, y: -8, z: 25, r: 2.2 },
      { x: 90, y: 2, z: 5, r: 1 },
    ];
    const moved = rig.map((p) => ({ ...p, x: p.x + 137, y: p.y - 21, z: p.z - 64 }));
    const a = generateCaveRigNodes(rig, 5, { variance: 1, seed: 11 });
    const b = generateCaveRigNodes(moved, 5, { variance: 1, seed: 11 });
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].x).toBeCloseTo(a[i].x + 137, 4);
      expect(b[i].y).toBeCloseTo(a[i].y - 21, 4);
      expect(b[i].z).toBeCloseTo(a[i].z - 64, 4);
      expect(b[i].radius).toBeCloseTo(a[i].radius, 4);
    }
  });

  it('variance bends the path deterministically and wobbles the radius', () => {
    const rig = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
    ];
    const straight = generateCaveRigNodes(rig, 5, { variance: 0 });
    const bent = generateCaveRigNodes(rig, 5, { variance: 1, seed: 3 });
    const bent2 = generateCaveRigNodes(rig, 5, { variance: 1, seed: 3 });
    // Deterministic: same seed, same nodes.
    expect(bent).toEqual(bent2);
    // Straight bore stays on the axis; the bent one leaves it somewhere.
    expect(Math.max(...straight.map((n) => Math.abs(n.z)))).toBeLessThan(0.001);
    expect(Math.max(...bent.map((n) => Math.abs(n.z)))).toBeGreaterThan(1);
    // Radius wobbles but stays within the sim clamps.
    const radii = new Set(bent.map((n) => Math.round(n.radius * 100)));
    expect(radii.size).toBeGreaterThan(1);
    for (const n of bent) {
      expect(n.radius).toBeGreaterThanOrEqual(1.5);
      expect(n.radius).toBeLessThanOrEqual(20);
    }
  });

  it('per-point girth interpolates along the path', () => {
    const bulged = generateCaveRigNodes(
      [
        { x: 0, y: 0, z: 0, r: 1 },
        { x: 30, y: 0, z: 0, r: 2.5 },
        { x: 60, y: 0, z: 0, r: 1 },
      ],
      4,
    );
    const mid = bulged.reduce((best, n) => (Math.abs(n.x - 30) < Math.abs(best.x - 30) ? n : best));
    expect(mid.radius).toBeGreaterThan(8);
    expect(bulged[0].radius).toBeCloseTo(4, 5);
  });

  it('rejects degenerate spans', () => {
    expect(
      generateCaveRigNodes(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        4,
      ),
    ).toHaveLength(0);
    expect(generateCaveRigNodes([{ x: 0, y: 0, z: 0 }], 4)).toHaveLength(0);
  });
});
