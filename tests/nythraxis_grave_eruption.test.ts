// Pure-leaf pins for Grave Eruption and Grave Flame (src/sim/nythraxis_grave_eruption.ts):
// the tuning literals the guide and the avoidable-damage table quote, the
// hash-placed pattern (no shared rng), the target order, the circle footprint,
// the flame cap, and the reconnect-safe readouts.

import { describe, expect, it } from 'vitest';
import {
  activeNythraxisGraveEruptions,
  activeNythraxisGraveFlames,
  igniteNythraxisGraveFlames,
  NYTHRAXIS_GRAVE_ERUPTION_IMPALED_CLEARANCE,
  NYTHRAXIS_GRAVE_ERUPTION_MIN_SEPARATION,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS,
  NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  NYTHRAXIS_GRAVE_FLAME_CAP,
  type NythraxisGraveFlame,
  type NythraxisGravePoint,
  nythraxisGraveEruptionCadence,
  nythraxisGraveEruptionCount,
  nythraxisGraveEruptionDamageMaxHp,
  nythraxisGraveEruptionId,
  nythraxisGraveEruptionPattern,
  nythraxisGraveEruptionTargetOrder,
  nythraxisGraveFlameId,
  nythraxisGraveFlameSeconds,
  nythraxisGraveFlameTickMaxHp,
  pointInNythraxisGraveCircle,
} from '../src/sim/nythraxis_grave_eruption';
import {
  admitNythraxisSoulfireTick,
  igniteNythraxisSoulfire,
  NYTHRAXIS_SOULFIRE_CAP,
  nythraxisSoulfireGroupCentroids,
} from '../src/sim/nythraxis_soulfire';

const ORIGIN = { x: 0, z: 96 };

describe('Nythraxis Grave Eruption', () => {
  it('pins the player-facing tuning literally on both difficulties', () => {
    expect([
      nythraxisGraveEruptionCadence('normal'),
      nythraxisGraveEruptionCadence('heroic'),
    ]).toEqual([15, 12]);
    expect([nythraxisGraveEruptionCount('normal'), nythraxisGraveEruptionCount('heroic')]).toEqual([
      4, 6,
    ]);
    expect([
      nythraxisGraveEruptionDamageMaxHp('normal'),
      nythraxisGraveEruptionDamageMaxHp('heroic'),
    ]).toEqual([0.45, 0.75]);
    // Heroic durations are shorter than Normal's, and finite (not the old
    // permanent-until-reset patches).
    expect([nythraxisGraveFlameSeconds('normal'), nythraxisGraveFlameSeconds('heroic')]).toEqual([
      12, 8,
    ]);
    expect([
      nythraxisGraveFlameTickMaxHp('normal'),
      nythraxisGraveFlameTickMaxHp('heroic'),
    ]).toEqual([0.06, 0.09]);
    expect(NYTHRAXIS_GRAVE_ERUPTION_RADIUS).toBe(3);
    expect(NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS).toBe(2.5);
    expect(NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS).toBe(0.75);
    expect(NYTHRAXIS_SOULFIRE_CAP).toBe(12);
    expect(NYTHRAXIS_GRAVE_FLAME_CAP).toBe(24);
  });

  it('places a circle under every ordered target when they fit, deterministically', () => {
    const targets = [
      { id: 7, x: 4, z: 80 },
      { id: 3, x: -12, z: 84 },
      { id: 9, x: 15, z: 90 },
      { id: 5, x: -3, z: 70 },
    ];
    const first = nythraxisGraveEruptionPattern(1234, ORIGIN, 4, targets);
    const again = nythraxisGraveEruptionPattern(1234, ORIGIN, 4, targets);
    expect(again).toEqual(first);
    expect(first).toHaveLength(4);
    // Attempt zero is the anchor itself: the hands burst exactly underfoot.
    first.forEach((point, index) => {
      expect(point.x).toBeCloseTo(targets[index].x);
      expect(point.z).toBeCloseTo(targets[index].z);
    });
    const other = nythraxisGraveEruptionPattern(4321, ORIGIN, 4, []);
    expect(other).not.toEqual(first);
  });

  it('scatters colliding anchors apart and never closer than the separation floor', () => {
    const stacked = [1, 2, 3, 4].map((id) => ({ id, x: 0, z: 80 }));
    const points = nythraxisGraveEruptionPattern(99, ORIGIN, 4, stacked);
    expect(points).toHaveLength(4);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        expect(
          Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z),
        ).toBeGreaterThanOrEqual(NYTHRAXIS_GRAVE_ERUPTION_MIN_SEPARATION - 1e-9);
      }
    }
    // The first slot still lands on the anchor; only the collisions move.
    expect(points[0]).toEqual({ x: 0, z: 80 });
  });

  it('moves a circle off an avoided point without starving the slot, deterministically', () => {
    const targets = [{ id: 7, x: 4, z: 80 }];
    // Exactly the anchor: unsafe on attempt zero (the exact-underfoot case
    // above), so the scatter search must find a safe neighbour instead.
    const avoid: NythraxisGravePoint[] = [{ x: 4, z: 80 }];
    const first = nythraxisGraveEruptionPattern(1234, ORIGIN, 1, targets, avoid);
    const again = nythraxisGraveEruptionPattern(1234, ORIGIN, 1, targets, avoid);
    expect(again).toEqual(first);
    expect(first).toHaveLength(1);
    expect(Math.hypot(first[0].x - avoid[0].x, first[0].z - avoid[0].z)).toBeGreaterThanOrEqual(
      NYTHRAXIS_GRAVE_ERUPTION_IMPALED_CLEARANCE - 1e-9,
    );
    // An empty avoid list is a no-op: byte-identical to the pre-existing
    // (no-impaled) behavior pinned above.
    expect(nythraxisGraveEruptionPattern(1234, ORIGIN, 1, targets, [])).toEqual([{ x: 4, z: 80 }]);
  });

  it('skips a slot rather than ever placing fire in a densely avoided area', () => {
    // A grid dense enough (spacing well under twice the clearance radius)
    // that every reachable candidate -- the anchor itself, every scattered
    // attempt, and the free-candidate retry across the whole MAX_RANGE disk
    // -- lands within clearance of SOME avoid point: total exhaustion for
    // the one slot, engineered black-box (no coupling to the internal hash
    // formula) rather than reproducing it.
    const origin = { x: 0, z: 0 };
    const avoid: NythraxisGravePoint[] = [];
    for (let x = -60; x <= 60; x += 8) {
      for (let z = -60; z <= 60; z += 8) avoid.push({ x, z });
    }
    const targets = [{ id: 1, x: 10, z: 10 }];
    const points = nythraxisGraveEruptionPattern(555, origin, 1, targets, avoid);
    // Never a circle inside the avoided grid: the slot is skipped (fewer
    // circles) rather than placing fire somewhere the caller marked unsafe.
    expect(points).toHaveLength(0);
  });

  it('sorts the aggro holder last so the tank is only targeted when nobody else is left', () => {
    const targets = [
      { id: 1, x: 0, z: 0 },
      { id: 2, x: 1, z: 0 },
      { id: 3, x: 2, z: 0 },
      { id: 4, x: 3, z: 0 },
      { id: 5, x: 4, z: 0 },
    ];
    const picked = nythraxisGraveEruptionTargetOrder(77, targets, 3, 4);
    expect(picked).toHaveLength(4);
    expect(picked.map((t) => t.id)).not.toContain(3);
    const all = nythraxisGraveEruptionTargetOrder(77, targets, 3, 5);
    expect(all.at(-1)?.id).toBe(3);
  });

  it('owns the exact circular footprint edge', () => {
    const circle = { x: 10, z: 10 };
    expect(pointInNythraxisGraveCircle(circle, { x: 13, z: 10 })).toBe(true);
    expect(pointInNythraxisGraveCircle(circle, { x: 13.01, z: 10 })).toBe(false);
    expect(pointInNythraxisGraveCircle(circle, { x: 10, z: 7 })).toBe(true);
  });

  it('caps the live flames at the oldest-first ceiling', () => {
    const flames: NythraxisGraveFlame[] = [];
    let seq = 0;
    for (let wave = 0; wave < 8; wave++) {
      seq = igniteNythraxisGraveFlames(
        flames,
        [0, 1, 2, 3].map((i) => ({ x: wave * 10 + i, z: 0 })),
        seq,
        12,
      );
    }
    expect(seq).toBe(32);
    expect(flames).toHaveLength(NYTHRAXIS_GRAVE_FLAME_CAP);
    expect(flames[0].seq).toBe(32 - NYTHRAXIS_GRAVE_FLAME_CAP);
    expect(flames.at(-1)?.seq).toBe(31);
    expect(flames.every((f) => f.remaining === 12 && f.tickTimer === 1)).toBe(true);
  });

  it('projects the warning window and the flames with stable ids and clamped timers', () => {
    const state = {
      eruptionCastKey: 55,
      eruptionImpactRemaining: 1.2,
      eruptionPoints: [
        { x: 1, z: 2 },
        { x: 3, z: 4 },
      ],
      graveFlames: [
        { seq: 4, kind: 'grave' as const, radius: 3, x: 5, z: 6, remaining: 20, tickTimer: 0.5 },
        { seq: 5, kind: 'grave' as const, radius: 3, x: 7, z: 8, remaining: 0, tickTimer: 0.5 },
        { seq: 6, kind: 'soul' as const, radius: 4, x: 9, z: 10, remaining: 7, tickTimer: 0.5 },
      ],
    };
    expect(activeNythraxisGraveEruptions(9, state)).toEqual([
      {
        id: nythraxisGraveEruptionId(9, 55, 0),
        x: 1,
        z: 2,
        radius: 3,
        duration: 2.5,
        remaining: 1.2,
        warningLead: 0.75,
      },
      {
        id: '9:ge:55:1',
        x: 3,
        z: 4,
        radius: 3,
        duration: 2.5,
        remaining: 1.2,
        warningLead: 0.75,
      },
    ]);
    expect(activeNythraxisGraveEruptions(9, { ...state, eruptionImpactRemaining: 0 })).toEqual([]);
    // A flame past its duration clamps to the duration; an expired one is dropped;
    // a Soulfire pool carries its own kind, radius, and 15 s duration.
    expect(activeNythraxisGraveFlames(9, state, 'normal')).toEqual([
      {
        id: nythraxisGraveFlameId(9, 4),
        sourceId: 9,
        kind: 'grave',
        x: 5,
        z: 6,
        radius: 3,
        duration: 12,
        remaining: 12,
      },
      {
        id: nythraxisGraveFlameId(9, 6),
        sourceId: 9,
        kind: 'soul',
        x: 9,
        z: 10,
        radius: 4,
        duration: 15,
        remaining: 7,
      },
    ]);
    // Heroic durations are shorter than Normal's and still finite: a flame
    // past its heroic duration clamps to it (seq 4's remaining: 20 exceeds
    // the 8 s heroic Grave Flame duration), one under it does not (seq 6's
    // remaining: 7 is under the 12 s heroic Soulfire duration).
    const heroicRows = activeNythraxisGraveFlames(9, state, 'heroic');
    expect(heroicRows[0]).toMatchObject({ duration: 8, remaining: 8 });
    expect(heroicRows[1]).toMatchObject({ kind: 'soul', duration: 12, remaining: 7 });
  });

  it('caps Grave Flame and Soulfire separately in the shared list', () => {
    const flames: NythraxisGraveFlame[] = [];
    let seq = igniteNythraxisGraveFlames(
      flames,
      Array.from({ length: NYTHRAXIS_GRAVE_FLAME_CAP }, (_, i) => ({ x: i, z: 0 })),
      0,
      12,
    );
    seq = igniteNythraxisSoulfire(
      flames,
      Array.from({ length: NYTHRAXIS_SOULFIRE_CAP + 2 }, (_, i) => ({ x: 100 + i, z: 0 })),
      [],
      seq,
    );
    expect(flames.filter((f) => f.kind === 'grave')).toHaveLength(NYTHRAXIS_GRAVE_FLAME_CAP);
    expect(flames.filter((f) => f.kind === 'soul')).toHaveLength(NYTHRAXIS_SOULFIRE_CAP);
    // The two oldest Soulfire pools left, never a Grave Flame.
    expect(flames.filter((f) => f.kind === 'soul')[0].x).toBe(102);
    // Another Grave Flame wave evicts only Grave Flame.
    igniteNythraxisGraveFlames(flames, [{ x: 50, z: 0 }], seq, 12);
    expect(flames.filter((f) => f.kind === 'grave')).toHaveLength(NYTHRAXIS_GRAVE_FLAME_CAP);
    expect(flames.filter((f) => f.kind === 'soul')).toHaveLength(NYTHRAXIS_SOULFIRE_CAP);
  });

  it('never leaves Soulfire beside a wardstone', () => {
    const flames: NythraxisGraveFlame[] = [];
    const ward = { x: 40, z: 79 };
    igniteNythraxisSoulfire(
      flames,
      [
        { x: 40, z: 79 },
        { x: 45, z: 79 },
        { x: 46.5, z: 79 },
      ],
      [ward],
      0,
    );
    expect(flames.map((f) => f.x)).toEqual([46.5]);
    expect(flames[0]).toMatchObject({ kind: 'soul', radius: 4, remaining: 15 });
  });
});

describe('nythraxisSoulfireGroupCentroids (heroic: one pool per stacked group)', () => {
  const STACK_RANGE = 5;

  it('keeps an isolated mark as its own pool', () => {
    const points = [{ x: 10, z: 20 }];
    expect(nythraxisSoulfireGroupCentroids(points, STACK_RANGE)).toEqual([{ x: 10, z: 20 }]);
  });

  it('merges a stacked group into one centroid and keeps a separated mark apart', () => {
    const stacked = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 4, z: 0 },
    ];
    const isolated = { x: 100, z: 100 };
    const centroids = nythraxisSoulfireGroupCentroids([...stacked, isolated], STACK_RANGE);
    expect(centroids).toHaveLength(2);
    expect(centroids).toContainEqual({ x: 2, z: 0 });
    expect(centroids).toContainEqual(isolated);
  });

  it('chains transitively: A-B and B-C in range groups all three even though A-C is not', () => {
    const a = { x: 0, z: 0 };
    const b = { x: 4, z: 0 };
    const c = { x: 8, z: 0 };
    expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeGreaterThan(STACK_RANGE);
    const centroids = nythraxisSoulfireGroupCentroids([a, b, c], STACK_RANGE);
    expect(centroids).toEqual([{ x: 4, z: 0 }]);
  });

  it('groups six players stacked on one point into a single pool', () => {
    const points = Array.from({ length: 6 }, () => ({ x: 7, z: -3 }));
    expect(nythraxisSoulfireGroupCentroids(points, STACK_RANGE)).toEqual([{ x: 7, z: -3 }]);
  });

  it('keeps two far-apart groups separate', () => {
    const groupA = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ];
    const groupB = [
      { x: 50, z: 50 },
      { x: 52, z: 50 },
    ];
    const centroids = nythraxisSoulfireGroupCentroids([...groupA, ...groupB], STACK_RANGE);
    expect(centroids).toHaveLength(2);
    expect(centroids).toContainEqual({ x: 0.5, z: 0 });
    expect(centroids).toContainEqual({ x: 51, z: 50 });
  });

  it('groups the same regardless of input order, drawing no rng', () => {
    const points = [
      { x: 8, z: 8 },
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 50, z: 50 },
    ];
    const forward = nythraxisSoulfireGroupCentroids(points, STACK_RANGE);
    const reordered = nythraxisSoulfireGroupCentroids([...points].reverse(), STACK_RANGE);
    expect(reordered).toEqual(forward);
  });

  it('sums fractional coordinates in a fixed order, so every permutation gives a bit-identical centroid', () => {
    const points = [
      { x: 0.1, z: 0.7 },
      { x: 0.2, z: 0.7 },
      { x: 0.3, z: 0.7 },
      { x: 0.4, z: 0.7 },
    ];
    const base = nythraxisSoulfireGroupCentroids(points, STACK_RANGE);
    const permutations = [
      [points[3], points[0], points[2], points[1]],
      [points[1], points[3], points[0], points[2]],
      [points[2], points[1], points[3], points[0]],
    ];
    for (const permuted of permutations) {
      expect(nythraxisSoulfireGroupCentroids(permuted, STACK_RANGE)).toEqual(base);
    }
    // The caller's array is never mutated.
    expect(points).toEqual([
      { x: 0.1, z: 0.7 },
      { x: 0.2, z: 0.7 },
      { x: 0.3, z: 0.7 },
      { x: 0.4, z: 0.7 },
    ]);
  });

  it('returns nothing for no points', () => {
    expect(nythraxisSoulfireGroupCentroids([], STACK_RANGE)).toEqual([]);
  });
});

describe('admitNythraxisSoulfireTick (heroic: at most one tick per player per second)', () => {
  it('admits the first tick for a player and records it', () => {
    const marks: { playerId: number; at: number }[] = [];
    expect(admitNythraxisSoulfireTick(marks, 1, 5)).toBe(true);
    expect(marks).toEqual([{ playerId: 1, at: 5 }]);
  });

  it('refuses a second tick inside the same second, even from a different pool', () => {
    const marks: { playerId: number; at: number }[] = [];
    expect(admitNythraxisSoulfireTick(marks, 1, 5)).toBe(true);
    expect(admitNythraxisSoulfireTick(marks, 1, 5.4)).toBe(false);
    expect(marks).toEqual([{ playerId: 1, at: 5 }]);
  });

  it('admits again once a full second has elapsed', () => {
    const marks: { playerId: number; at: number }[] = [];
    admitNythraxisSoulfireTick(marks, 1, 5);
    expect(admitNythraxisSoulfireTick(marks, 1, 6)).toBe(true);
    expect(marks).toEqual([{ playerId: 1, at: 6 }]);
  });

  it('tracks players independently', () => {
    const marks: { playerId: number; at: number }[] = [];
    expect(admitNythraxisSoulfireTick(marks, 1, 5)).toBe(true);
    expect(admitNythraxisSoulfireTick(marks, 2, 5.2)).toBe(true);
    expect(admitNythraxisSoulfireTick(marks, 1, 5.2)).toBe(false);
  });

  it('keeps each boss instance independent: state lives on the caller-owned marks array', () => {
    const bossA: { playerId: number; at: number }[] = [];
    const bossB: { playerId: number; at: number }[] = [];
    admitNythraxisSoulfireTick(bossA, 1, 5);
    expect(admitNythraxisSoulfireTick(bossB, 1, 5.2)).toBe(true);
    expect(admitNythraxisSoulfireTick(bossA, 1, 5.2)).toBe(false);
  });
});
