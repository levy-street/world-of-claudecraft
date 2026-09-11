// Pure-leaf pins for the Binding Sigil (src/sim/nythraxis_binding_sigil.ts):
// the tuning literals the guide quotes, hash placement with an injected floor,
// the placement rules, the fallbacks, the bind test, and the readout.

import { describe, expect, it } from 'vitest';
import {
  activeNythraxisBindingSigils,
  NYTHRAXIS_ASCENSION_EVERY,
  NYTHRAXIS_BOUND_VULNERABILITY,
  NYTHRAXIS_SIGIL_FIRST_SECONDS,
  NYTHRAXIS_SIGIL_SIDE_NUDGES_Z,
  NYTHRAXIS_SIGIL_SIDE_OFFSET,
  NYTHRAXIS_SIGIL_SIDE_OFFSET_NEAR,
  NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE,
  type NythraxisSigilFloor,
  nythraxisAscensionPerStack,
  nythraxisBossOnSigil,
  nythraxisBoundSeconds,
  nythraxisBoundStunSeconds,
  nythraxisSigilBindSeconds,
  nythraxisSigilCadence,
  nythraxisSigilCandidate,
  nythraxisSigilId,
  nythraxisSigilMayLandInFire,
  nythraxisSigilNextSide,
  nythraxisSigilPlacement,
  nythraxisSigilPlacementValid,
  nythraxisSigilRadius,
  nythraxisUnboundDamageBonus,
  nythraxisUnboundHitMaxHp,
} from '../src/sim/nythraxis_binding_sigil';

const BOSS = { x: 0, z: 96 };
const OPEN: NythraxisSigilFloor = { openFloor: () => true, wardstones: [], fires: [] };

describe('Nythraxis Binding Sigil', () => {
  it('pins the player-facing tuning literally on both difficulties', () => {
    expect(NYTHRAXIS_SIGIL_FIRST_SECONDS).toBe(30);
    expect([nythraxisSigilCadence('normal'), nythraxisSigilCadence('heroic')]).toEqual([45, 40]);
    expect([nythraxisSigilRadius('normal'), nythraxisSigilRadius('heroic')]).toEqual([4, 3]);
    expect([nythraxisSigilBindSeconds('normal'), nythraxisSigilBindSeconds('heroic')]).toEqual([
      15, 12,
    ]);
    expect([nythraxisAscensionPerStack('normal'), nythraxisAscensionPerStack('heroic')]).toEqual([
      0.04, 0.05,
    ]);
    expect(NYTHRAXIS_ASCENSION_EVERY).toBe(2);
    expect([nythraxisBoundStunSeconds('normal'), nythraxisBoundStunSeconds('heroic')]).toEqual([
      4, 3,
    ]);
    expect(NYTHRAXIS_BOUND_VULNERABILITY).toBe(0.25);
    expect([nythraxisBoundSeconds('normal'), nythraxisBoundSeconds('heroic')]).toEqual([10, 8]);
    expect([nythraxisUnboundHitMaxHp('normal'), nythraxisUnboundHitMaxHp('heroic')]).toEqual([
      0.4, 0.6,
    ]);
    expect([nythraxisUnboundDamageBonus('normal'), nythraxisUnboundDamageBonus('heroic')]).toEqual([
      0.2, 0.25,
    ]);
    expect([nythraxisSigilMayLandInFire('normal'), nythraxisSigilMayLandInFire('heroic')]).toEqual([
      false,
      true,
    ]);
    // v0.42.2: beside the boss on the raid's left or right, not a hash ring.
    expect([NYTHRAXIS_SIGIL_SIDE_OFFSET, NYTHRAXIS_SIGIL_SIDE_OFFSET_NEAR]).toEqual([22, 16]);
    expect(NYTHRAXIS_SIGIL_SIDE_NUDGES_Z).toEqual([0, 6, -6, 12, -12, 18, -18]);
    expect(NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE).toBe(6);
  });

  it('lays the side ladder: the offset spot first, z nudges next, then the near offset', () => {
    for (const side of [1, -1] as const) {
      const first = nythraxisSigilCandidate(0, BOSS, side);
      expect(first).toEqual({ x: BOSS.x + side * NYTHRAXIS_SIGIL_SIDE_OFFSET, z: BOSS.z });
      NYTHRAXIS_SIGIL_SIDE_NUDGES_Z.forEach((nudge, attempt) => {
        expect(nythraxisSigilCandidate(attempt, BOSS, side)).toEqual({
          x: BOSS.x + side * NYTHRAXIS_SIGIL_SIDE_OFFSET,
          z: BOSS.z + nudge,
        });
        expect(
          nythraxisSigilCandidate(attempt + NYTHRAXIS_SIGIL_SIDE_NUDGES_Z.length, BOSS, side),
        ).toEqual({ x: BOSS.x + side * NYTHRAXIS_SIGIL_SIDE_OFFSET_NEAR, z: BOSS.z + nudge });
      });
    }
    // The two sides mirror each other across the boss in x and share z.
    for (let attempt = 0; attempt < NYTHRAXIS_SIGIL_SIDE_NUDGES_Z.length * 2; attempt++) {
      const right = nythraxisSigilCandidate(attempt, BOSS, -1);
      const left = nythraxisSigilCandidate(attempt, BOSS, 1);
      expect(right.x - BOSS.x).toBe(-(left.x - BOSS.x));
      expect(right.z).toBe(left.z);
    }
  });

  it("alternates sides every cast, starting on the raid's right (world -x)", () => {
    expect(nythraxisSigilNextSide(null)).toBe(-1);
    expect(nythraxisSigilNextSide(-1)).toBe(1);
    expect(nythraxisSigilNextSide(1)).toBe(-1);
  });

  it('rejects blocked floor, wardstone clearance, and (on normal) live fire', () => {
    const point = { x: 10, z: 100 };
    expect(nythraxisSigilPlacementValid(point, 4, OPEN, false)).toBe(true);
    expect(nythraxisSigilPlacementValid(point, 4, { ...OPEN, openFloor: () => false }, false)).toBe(
      false,
    );
    const nearWard = {
      ...OPEN,
      wardstones: [{ x: 10 + NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE - 0.1, z: 100 }],
    };
    expect(nythraxisSigilPlacementValid(point, 4, nearWard, false)).toBe(false);
    const farWard = {
      ...OPEN,
      wardstones: [{ x: 10 + NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE, z: 100 }],
    };
    expect(nythraxisSigilPlacementValid(point, 4, farWard, false)).toBe(true);
    // Fire within radius + sigil radius blocks on normal and is allowed on heroic.
    const fire = { ...OPEN, fires: [{ x: 16, z: 100, radius: 3 }] };
    expect(nythraxisSigilPlacementValid(point, 4, fire, false)).toBe(false);
    expect(nythraxisSigilPlacementValid(point, 4, fire, true)).toBe(true);
    expect(
      nythraxisSigilPlacementValid(
        point,
        4,
        { ...OPEN, fires: [{ x: 17.1, z: 100, radius: 3 }] },
        false,
      ),
    ).toBe(true);
  });

  it('picks the first valid ladder spot, then falls back to open floor, then to the primary spot', () => {
    const first = nythraxisSigilCandidate(0, BOSS, 1);
    expect(nythraxisSigilPlacement(BOSS, 1, 4, OPEN, false)).toEqual(first);
    // A wardstone on the primary spot pushes the pick down the ladder, same side.
    const blockedFirst = { ...OPEN, wardstones: [first] };
    const pick = nythraxisSigilPlacement(BOSS, 1, 4, blockedFirst, false);
    expect(pick).not.toEqual(first);
    expect(pick.x).toBe(first.x);
    expect(nythraxisSigilPlacementValid(pick, 4, blockedFirst, false)).toBe(true);
    // Fire everywhere on normal: fall back to open floor rather than vanish.
    const everywhereFire = { ...OPEN, fires: [{ x: BOSS.x, z: BOSS.z, radius: 1000 }] };
    expect(nythraxisSigilPlacement(BOSS, 1, 4, everywhereFire, false)).toEqual(first);
    // No open floor at all: the sigil still lands on the primary side spot,
    // never under the boss, which would bind him for free.
    const nowhere = nythraxisSigilPlacement(BOSS, 1, 4, { ...OPEN, openFloor: () => false }, false);
    expect(nowhere).toEqual(first);
    expect(Math.hypot(nowhere.x - BOSS.x, nowhere.z - BOSS.z)).toBe(NYTHRAXIS_SIGIL_SIDE_OFFSET);
    // The other side mirrors.
    expect(nythraxisSigilPlacement(BOSS, -1, 4, OPEN, false)).toEqual(
      nythraxisSigilCandidate(0, BOSS, -1),
    );
    // Every rung at the full offset blocked by a wardstone: the pick steps in
    // to the near offset on the same side, at the boss's own z.
    const outerBlocked = {
      ...OPEN,
      wardstones: NYTHRAXIS_SIGIL_SIDE_NUDGES_Z.map((_, attempt) =>
        nythraxisSigilCandidate(attempt, BOSS, 1),
      ),
    };
    expect(nythraxisSigilPlacement(BOSS, 1, 4, outerBlocked, false)).toEqual({
      x: BOSS.x + NYTHRAXIS_SIGIL_SIDE_OFFSET_NEAR,
      z: BOSS.z,
    });
    // The whole asked side closed (the boss parked against that wall): the
    // mirrored ladder on the other side lands the sigil instead of stranding
    // the bind on an unreachable point.
    const rightWall = { ...OPEN, openFloor: (p: { x: number }) => p.x < BOSS.x + 1 };
    expect(nythraxisSigilPlacement(BOSS, 1, 4, rightWall, false)).toEqual(
      nythraxisSigilCandidate(0, BOSS, -1),
    );
  });

  it('binds when the boss stands inside the radius, edge inclusive', () => {
    const sigil = { x: 10, z: 10 };
    expect(nythraxisBossOnSigil({ x: 14, z: 10 }, sigil, 4)).toBe(true);
    expect(nythraxisBossOnSigil({ x: 14.01, z: 10 }, sigil, 4)).toBe(false);
    expect(nythraxisBossOnSigil({ x: 13, z: 10 }, sigil, 3)).toBe(true);
  });

  it('projects the live sigil with a stable id and a clamped countdown', () => {
    const sigil = { castKey: 42, x: 3, z: 4, remaining: 9, ascensionTimer: 1, ascensionStacks: 2 };
    expect(activeNythraxisBindingSigils(9, sigil, 'normal')).toEqual([
      {
        id: nythraxisSigilId(9, 42),
        sourceId: 9,
        x: 3,
        z: 4,
        radius: 4,
        duration: 15,
        remaining: 9,
      },
    ]);
    expect(activeNythraxisBindingSigils(9, sigil, 'heroic')[0]).toMatchObject({
      radius: 3,
      duration: 12,
      remaining: 9,
    });
    expect(
      activeNythraxisBindingSigils(9, { ...sigil, remaining: 99 }, 'normal')[0].remaining,
    ).toBe(15);
    expect(activeNythraxisBindingSigils(9, null, 'normal')).toEqual([]);
    expect(activeNythraxisBindingSigils(9, { ...sigil, remaining: 0 }, 'normal')).toEqual([]);
    expect(nythraxisSigilId(9, 42)).toBe('9:sig:42');
  });
});
