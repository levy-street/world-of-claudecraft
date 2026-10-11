import type { BufferGeometry } from 'three';
import { expect, it } from 'vitest';
import { buildIronguardShape } from '../src/render/ability_vfx/ironguard_shapes';

/** Recover physical pieces by shared positions, independent of vertex order,
 * triangle grouping or the phase values this test is checking. */
function plates(geometry: BufferGeometry): number[][] {
  const positions = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) throw new Error('Ground plates must retain indexed geometry');
  const parents = Array.from({ length: positions.count }, (_, i) => i);
  function root(i: number): number {
    while (parents[i] !== i) i = parents[i];
    return i;
  }
  function join(a: number, b: number): void {
    parents[root(a)] = root(b);
  }
  const shared = new Map<string, number>();
  for (let i = 0; i < positions.count; i++) {
    const key = `${positions.getX(i)},${positions.getY(i)},${positions.getZ(i)}`;
    const previous = shared.get(key);
    if (previous === undefined) shared.set(key, i);
    else join(previous, i);
  }
  for (let i = 0; i < index.count; i += 3) {
    join(index.getX(i), index.getX(i + 1));
    join(index.getX(i), index.getX(i + 2));
  }
  const pieces = new Map<number, number[]>();
  for (let i = 0; i < positions.count; i++) {
    const owner = root(i);
    let piece = pieces.get(owner);
    if (!piece) {
      piece = [];
      pieces.set(owner, piece);
    }
    piece.push(i);
  }
  return [...pieces.values()];
}

it.each([
  ['iron_quake', 36, 1944, 648],
  ['iron_fault', 26, 1404, 468],
] as const)(
  '%s carries a single finite travel phase across each entire physical plate without growing GPU geometry',
  (kind, pieceCount, vertexBudget, triangleBudget) => {
    const geometry = buildIronguardShape(kind);
    try {
      expect(Object.keys(geometry.attributes).sort()).toEqual(['normal', 'position', 'uv']);
      expect(geometry.getAttribute('position').count).toBeLessThanOrEqual(vertexBudget);
      const index = geometry.getIndex();
      if (!index) throw new Error('Ground plates must retain indexed geometry');
      expect(index.count / 3).toBeLessThanOrEqual(triangleBudget);
      const pieces = plates(geometry);
      expect(pieces).toHaveLength(pieceCount);
      const uv = geometry.getAttribute('uv');
      for (const piece of pieces) {
        const vertices = new Set(piece);
        const edges = new Map<string, number>();
        const position = geometry.getAttribute('position');
        const key = (i: number) => `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
        let triangles = 0;
        for (let i = 0; i < index.count; i += 3) {
          if (!vertices.has(index.getX(i))) continue;
          triangles++;
          for (let edge = 0; edge < 3; edge++) {
            const a = index.getX(i + edge),
              b = index.getX(i + ((edge + 1) % 3));
            expect(vertices.has(a) && vertices.has(b)).toBe(true);
            const pair = [key(a), key(b)].sort().join(':');
            edges.set(pair, (edges.get(pair) ?? 0) + 1);
          }
        }
        // Extra fracture detail must not consume another plate's budget or
        // buy a cheaper mesh by leaving the visible slabs open underneath.
        expect(triangles).toBeLessThanOrEqual(18);
        expect([...edges.values()].every((uses) => uses === 2)).toBe(true);
        const phase = uv.getX(piece[0]);
        expect(Number.isFinite(phase)).toBe(true);
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThanOrEqual(1);
        for (const vertex of piece) expect(uv.getX(vertex)).toBe(phase);
        // Upper faces, narrow wall bevels and deep wall faces retain their
        // material masks while the separate UV.x channel carries timing.
        const masks = [...new Set(piece.map((i) => uv.getY(i)))].sort((a, b) => a - b);
        expect(masks).toHaveLength(3);
        expect(masks[0]).toBe(0);
        expect(masks[1]).toBeCloseTo(0.7, 6);
        expect(masks[2]).toBe(8);
      }
    } finally {
      geometry.dispose();
    }
  },
);

it.each(['iron_quake', 'iron_fault'] as const)(
  '%s raises near plates before middle plates and outer plates while keeping the full footprint',
  (kind) => {
    const geometry = buildIronguardShape(kind);
    try {
      const position = geometry.getAttribute('position');
      const uv = geometry.getAttribute('uv');
      const bands: number[][] = [[], [], []];
      let maximumRadius = 0;
      let minimumAngle = Infinity;
      let maximumAngle = -Infinity;
      let minimumZ = Infinity;
      let maximumHeight = 0;
      for (const piece of plates(geometry)) {
        const radii = piece.map((i) => Math.hypot(position.getX(i), position.getZ(i)));
        const near = Math.min(...radii);
        const far = Math.max(...radii);
        // Arrival belongs to the closest edge of the whole plate. Faultline's
        // broad near slabs extend past three yards without arriving later.
        // Classify from positions, never the UV phase being tested.
        bands[near < 3 ? 0 : near > 6.5 ? 2 : 1].push(uv.getX(piece[0]));
        maximumRadius = Math.max(maximumRadius, far);
        for (const vertex of piece) {
          const x = position.getX(vertex),
            z = position.getZ(vertex);
          expect(Math.hypot(x, z)).toBeLessThanOrEqual(8.000001);
          const angle = Math.atan2(x, z);
          minimumAngle = Math.min(minimumAngle, angle);
          maximumAngle = Math.max(maximumAngle, angle);
          minimumZ = Math.min(minimumZ, z);
          maximumHeight = Math.max(maximumHeight, position.getY(vertex));
          if (kind === 'iron_fault') expect(Math.abs(angle)).toBeLessThanOrEqual(2.200001);
        }
      }
      for (const band of bands) expect(band.length).toBeGreaterThan(0);
      expect(bands.map((band) => band.length)).toEqual(
        kind === 'iron_fault' ? [7, 12, 7] : [12, 12, 12],
      );
      expect(Math.max(...bands[0])).toBeLessThan(Math.min(...bands[1]));
      expect(Math.max(...bands[1])).toBeLessThan(Math.min(...bands[2]));
      expect(maximumRadius).toBeCloseTo(8, 5);
      if (kind === 'iron_fault') {
        expect(minimumAngle).toBeCloseTo(-2.2, 5);
        expect(maximumAngle).toBeCloseTo(2.2, 5);
        expect(maximumHeight).toBeCloseTo(3.54, 5);
        expect(minimumZ).toBeLessThan(-4.6);
      } else {
        expect(minimumZ).toBeCloseTo(-8, 5);
        expect(maximumHeight).toBeCloseTo(1.51, 5);
      }
    } finally {
      geometry.dispose();
    }
  },
);
