import { describe, expect, it } from 'vitest';
import {
  buildColliderCellIndex,
  colliderBounds,
  colliderCellAt,
  MAX_BODY_RADIUS,
} from '../src/sim/collider_cells';
import {
  allocRiftCollisionToken,
  clearRiftRegion,
  isBlocked,
  lineOfSightClear,
  resolvePosition,
  setRiftRegion,
} from '../src/sim/colliders';
import { RIFT_REGION_HALF_X, RIFT_REGION_HALF_Z, riftInstanceOrigin } from '../src/sim/data';
import { layoutColliders } from '../src/sim/dungeon_layout';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';

// The rift collision arms read a cell subset of the floor's collider list
// instead of scanning it whole. These suites pin the load-bearing claim: the
// subset resolution is EXACTLY the full-list resolution, on real generated
// floors, across the whole region, for every live radius. The reference token
// publishes the same colliders into ONE cell covering every finite coordinate,
// which reproduces the pre-index full-list scan (same list, same order)
// through the same public API, so any divergence is the index's fault by
// construction.

const WORLD_SEED = 1;
// The reference token's cell size MUST be Infinity, not merely huge: rift
// local coordinates straddle 0 on both axes, so any FINITE size splits the
// region into four quadrant cells around the origin and an interior sample
// resolves against roughly half the floor's colliders instead of all of them.
// With Infinity, Math.floor(x / cellSize) is +/-0 for every finite coordinate
// and cellKey's integer bias collapses -0 onto 0, so build and lookup both
// land in a single cell holding the whole list in input order. The
// construction guard suite below PROVES that premise per fixture rather than
// assuming it.
const FULL_LIST_CELL = Number.POSITIVE_INFINITY;

// Deterministic jitter without Math.random (the test asserts exact positions,
// so its own inputs must be reproducible run to run).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface FloorFixture {
  label: string;
  origin: { x: number; z: number };
  indexed: number;
  reference: number;
}

function publishFloor(seed: number, baseLevel: number, floorIndex: number, slot: number) {
  const plan = generateRiftFloor(seed, baseLevel, floorIndex);
  const colliders = layoutColliders(plan.layout);
  expect(colliders.length).toBeGreaterThan(0);
  const origin = riftInstanceOrigin(slot, floorIndex);
  const indexed = allocRiftCollisionToken();
  const reference = allocRiftCollisionToken();
  setRiftRegion(indexed, origin.x, origin.z, colliders);
  setRiftRegion(reference, origin.x, origin.z, colliders, FULL_LIST_CELL);
  return {
    fixture: {
      label: `seed ${seed} level ${baseLevel} floor ${floorIndex}`,
      origin,
      indexed,
      reference,
    } as FloorFixture,
    colliders,
  };
}

function samplePoints(origin: { x: number; z: number }, rand: () => number) {
  const points: Array<{ x: number; z: number }> = [];
  for (let lx = -RIFT_REGION_HALF_X; lx <= RIFT_REGION_HALF_X; lx += 2.3) {
    for (let lz = -RIFT_REGION_HALF_Z; lz <= RIFT_REGION_HALF_Z; lz += 4.1) {
      points.push({
        x: origin.x + lx + (rand() - 0.5) * 1.9,
        z: origin.z + lz + (rand() - 0.5) * 1.9,
      });
    }
  }
  return points;
}

describe('rift collider cell index', () => {
  const floors = [
    publishFloor(20061, 14, 0, 0),
    publishFloor(48271, 35, 2, 1),
    publishFloor(90210, 58, 5, 2),
  ];

  it('reference arm: one infinite cell holds the whole list, checked not assumed', () => {
    // buildColliderCellIndex is pure, so rebuilding with the fixture's inputs
    // reproduces exactly the index setRiftRegion stored for the reference
    // token. If this ever splits (a finite cell size quietly quadrants around
    // the local origin), the equivalence suites above stop being full-list
    // comparisons, so fail loudly here instead.
    for (const { colliders } of floors) {
      const ref = buildColliderCellIndex(colliders, FULL_LIST_CELL);
      expect(ref.cells.size).toBe(1);
      const all = ref.cells.values().next().value;
      expect(all).toBeDefined();
      expect(all?.length).toBe(colliders.length);
      for (let i = 0; i < colliders.length; i++) expect(all?.[i]).toBe(colliders[i]);
      // The finite-size failure mode is a quadrant split: a sample in every
      // local-frame quadrant must read the SAME single full list.
      for (const [qx, qz] of [
        [-5, -50],
        [-5, 50],
        [5, -50],
        [5, 50],
      ] as const) {
        expect(colliderCellAt(ref, qx, qz)).toBe(all);
      }
    }
  });

  it('registers every collider reachable from a point into that point cell', () => {
    for (const { colliders } of floors) {
      const index = buildColliderCellIndex(colliders);
      const rand = lcg(7);
      for (let i = 0; i < 400; i++) {
        const x = (rand() - 0.5) * 2 * (RIFT_REGION_HALF_X + 4);
        const z = (rand() - 0.5) * 2 * (RIFT_REGION_HALF_Z + 4);
        const cell = colliderCellAt(index, x, z) ?? [];
        for (const c of colliders) {
          const b = colliderBounds(c);
          const withinReach =
            x >= b.minX - MAX_BODY_RADIUS &&
            x <= b.maxX + MAX_BODY_RADIUS &&
            z >= b.minZ - MAX_BODY_RADIUS &&
            z <= b.maxZ + MAX_BODY_RADIUS;
          if (withinReach) expect(cell).toContain(c);
        }
      }
    }
  });

  it('keeps each cell list in the original list order', () => {
    for (const { colliders } of floors) {
      const order = new Map(colliders.map((c, i) => [c, i]));
      const index = buildColliderCellIndex(colliders);
      for (const list of index.cells.values()) {
        for (let i = 1; i < list.length; i++) {
          const prev = order.get(list[i - 1]);
          const next = order.get(list[i]);
          expect(prev).toBeDefined();
          expect(next).toBeDefined();
          expect((prev as number) < (next as number)).toBe(true);
        }
      }
    }
  });

  it('resolves every sampled position identically to the full-list scan', () => {
    for (const { fixture } of floors) {
      const rand = lcg(11);
      const points = samplePoints(fixture.origin, rand);
      for (const p of points) {
        // 1.0 exceeds MAX_BODY_RADIUS: the movement arm must fall back to the
        // full floor list (the boulder push resolves at r = 1.0, and a
        // single-cell read at that radius could miss a wall 0.8-1.0 yd out).
        for (const r of [0.05, 0.3, 0.5, MAX_BODY_RADIUS, 1.0]) {
          const fast = resolvePosition(
            WORLD_SEED,
            p.x,
            p.z,
            r,
            false,
            undefined,
            undefined,
            fixture.indexed,
          );
          const full = resolvePosition(
            WORLD_SEED,
            p.x,
            p.z,
            r,
            false,
            undefined,
            undefined,
            fixture.reference,
          );
          expect(fast.x, `${fixture.label} r=${r} at ${p.x},${p.z}`).toBe(full.x);
          expect(fast.z, `${fixture.label} r=${r} at ${p.x},${p.z}`).toBe(full.z);
        }
      }
    }
  });

  it('answers every sampled sight line identically to the full-list scan', () => {
    for (const { fixture } of floors) {
      const rand = lcg(23);
      let checkedBlocked = 0;
      let checkedClear = 0;
      for (let i = 0; i < 220; i++) {
        const from = {
          x: fixture.origin.x + (rand() - 0.5) * 2 * RIFT_REGION_HALF_X,
          z: fixture.origin.z + (rand() - 0.5) * 2 * RIFT_REGION_HALF_Z,
        };
        const to = {
          x: fixture.origin.x + (rand() - 0.5) * 2 * RIFT_REGION_HALF_X,
          z: from.z + (rand() - 0.5) * 60,
        };
        const fast = lineOfSightClear(WORLD_SEED, from, to, 0.05, undefined, fixture.indexed);
        const full = lineOfSightClear(WORLD_SEED, from, to, 0.05, undefined, fixture.reference);
        expect(fast, `${fixture.label} ${from.x},${from.z} -> ${to.x},${to.z}`).toBe(full);
        if (full) checkedClear++;
        else checkedBlocked++;
      }
      // The sample must exercise BOTH outcomes or the equivalence is vacuous.
      expect(checkedBlocked).toBeGreaterThan(0);
      expect(checkedClear).toBeGreaterThan(0);
    }
  });

  it('resolves floor 0 identically at slot 0 and a later slot, negative local z included', () => {
    // The regression this pins: the O(1) region lookup derived its candidate
    // origin with riftOriginAt, whose slot-major floor() maps a z just SOUTH
    // of a slot's floor 0 into the previous slot's top floor, so floor 0 of
    // every slot past 0 silently lost collision on its south half (the entry
    // area at local z -11 included). Same collider list, two slots: every
    // local-frame answer must match, and the sweep must hit real colliders
    // in the negative-z window.
    const plan = generateRiftFloor(777001, 25, 0);
    const colliders = layoutColliders(plan.layout);
    const o0 = riftInstanceOrigin(0, 0);
    const o5 = riftInstanceOrigin(5, 0);
    const t0 = allocRiftCollisionToken();
    const t5 = allocRiftCollisionToken();
    setRiftRegion(t0, o0.x, o0.z, colliders);
    setRiftRegion(t5, o5.x, o5.z, colliders);
    let movedNegativeZ = 0;
    for (let lx = -RIFT_REGION_HALF_X; lx <= RIFT_REGION_HALF_X; lx += 1.7) {
      for (let lz = -RIFT_REGION_HALF_Z; lz <= RIFT_REGION_HALF_Z; lz += 2.9) {
        const a = resolvePosition(
          WORLD_SEED,
          o0.x + lx,
          o0.z + lz,
          0.5,
          false,
          undefined,
          undefined,
          t0,
        );
        const b = resolvePosition(
          WORLD_SEED,
          o5.x + lx,
          o5.z + lz,
          0.5,
          false,
          undefined,
          undefined,
          t5,
        );
        expect(b.x - o5.x, `lx=${lx} lz=${lz}`).toBeCloseTo(a.x - o0.x, 9);
        expect(b.z - o5.z, `lx=${lx} lz=${lz}`).toBeCloseTo(a.z - o0.z, 9);
        if (lz < 0 && (Math.abs(a.x - (o0.x + lx)) > 1e-4 || Math.abs(a.z - (o0.z + lz)) > 1e-4))
          movedNegativeZ++;
      }
    }
    // Vacuousness guard: the south half must contain real pushes, or the
    // parity above proves nothing about the regression window.
    expect(movedNegativeZ).toBeGreaterThan(0);
    // Sight parity through the south wall, the exact live symptom.
    const from = { x: o5.x, z: o5.z - 25 };
    const to = { x: o5.x, z: o5.z + 5 };
    const at0 = lineOfSightClear(
      WORLD_SEED,
      { x: o0.x, z: o0.z - 25 },
      { x: o0.x, z: o0.z + 5 },
      0.05,
      undefined,
      t0,
    );
    expect(lineOfSightClear(WORLD_SEED, from, to, 0.05, undefined, t5)).toBe(at0);
  });

  it('still pushes a wide body off a wall past the registration margin', () => {
    // The boulder-push shape: r = 1.0 against a wall whose surface sits
    // between MAX_BODY_RADIUS and r away from the sample point. The
    // single-cell contract cannot see that wall; the wide-radius fallback
    // must. Probe real walls: walk points 0.9 yd off every box collider face
    // and require at least some of them to resolve away at r = 1.0.
    const { fixture, colliders } = publishFloor(24601, 30, 0, 5);
    let pushed = 0;
    for (const c of colliders) {
      if (c.type !== 'obb') continue;
      const p = {
        x: fixture.origin.x + c.x + (c.hw + 0.9) * Math.cos(c.rot),
        z: fixture.origin.z + c.z + (c.hw + 0.9) * Math.sin(c.rot),
      };
      const res = resolvePosition(
        WORLD_SEED,
        p.x,
        p.z,
        1.0,
        false,
        undefined,
        undefined,
        fixture.indexed,
      );
      if (Math.abs(res.x - p.x) > 1e-4 || Math.abs(res.z - p.z) > 1e-4) pushed++;
    }
    expect(pushed).toBeGreaterThan(0);
  });

  it('detects the region only inside the half-extent box, edges inclusive', () => {
    const { fixture } = publishFloor(31337, 22, 1, 3);
    const { origin, indexed } = fixture;
    // A wall always spans the room edge; probe against the region box instead
    // of collider luck: outside the box the arm must return the input
    // untouched for ANY point, colliders or not.
    const outsideZ = resolvePosition(
      WORLD_SEED,
      origin.x,
      origin.z + RIFT_REGION_HALF_Z + 0.2,
      0.5,
      false,
      undefined,
      undefined,
      indexed,
    );
    expect(outsideZ).toEqual({ x: origin.x, z: origin.z + RIFT_REGION_HALF_Z + 0.2 });
    const outsideX = resolvePosition(
      WORLD_SEED,
      origin.x + RIFT_REGION_HALF_X + 10,
      origin.z,
      0.5,
      false,
      undefined,
      undefined,
      indexed,
    );
    expect(outsideX).toEqual({ x: origin.x + RIFT_REGION_HALF_X + 10, z: origin.z });
  });

  it('clears a region so its colliders stop resolving', () => {
    const { fixture, colliders } = publishFloor(555, 18, 0, 4);
    // Find a point a collider actually pushes on, then clear and re-probe.
    const rand = lcg(31);
    let probe: { x: number; z: number } | null = null;
    for (let i = 0; i < 4000 && !probe; i++) {
      const c = colliders[Math.floor(rand() * colliders.length)];
      const b = colliderBounds(c);
      const p = {
        x: fixture.origin.x + (b.minX + b.maxX) / 2,
        z: fixture.origin.z + (b.minZ + b.maxZ) / 2,
      };
      if (isBlocked(WORLD_SEED, p.x, p.z, 0.5, false, undefined, fixture.indexed)) probe = p;
    }
    expect(probe).not.toBeNull();
    const p = probe as { x: number; z: number };
    clearRiftRegion(fixture.indexed, fixture.origin.x, fixture.origin.z);
    expect(isBlocked(WORLD_SEED, p.x, p.z, 0.5, false, undefined, fixture.indexed)).toBe(false);
  });
});
