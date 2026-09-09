// Pure-leaf pins for the Binding Sigil (src/sim/nythraxis_binding_sigil.ts):
// the tuning literals the guide quotes, hash placement with an injected floor,
// the placement rules, the fallbacks, the bind test, and the readout.

import { describe, expect, it } from 'vitest';
import {
  activeNythraxisBindingSigils,
  NYTHRAXIS_ASCENSION_EVERY,
  NYTHRAXIS_BOUND_VULNERABILITY,
  NYTHRAXIS_SIGIL_FIRST_SECONDS,
  NYTHRAXIS_SIGIL_MAX_DIST,
  NYTHRAXIS_SIGIL_MIN_DIST,
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
    expect([NYTHRAXIS_SIGIL_MIN_DIST, NYTHRAXIS_SIGIL_MAX_DIST]).toEqual([12, 30]);
    expect(NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE).toBe(6);
  });

  it('draws every hash candidate inside the ring band around the boss, deterministically', () => {
    for (let attempt = 0; attempt < 48; attempt++) {
      const p = nythraxisSigilCandidate(77, attempt, BOSS);
      const d = Math.hypot(p.x - BOSS.x, p.z - BOSS.z);
      expect(d).toBeGreaterThanOrEqual(NYTHRAXIS_SIGIL_MIN_DIST - 1e-9);
      expect(d).toBeLessThanOrEqual(NYTHRAXIS_SIGIL_MAX_DIST + 1e-9);
    }
    expect(nythraxisSigilCandidate(77, 3, BOSS)).toEqual(nythraxisSigilCandidate(77, 3, BOSS));
    expect(nythraxisSigilCandidate(77, 3, BOSS)).not.toEqual(nythraxisSigilCandidate(78, 3, BOSS));
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

  it('picks the first valid candidate, then falls back to the first ring candidate', () => {
    const first = nythraxisSigilCandidate(5, 0, BOSS);
    expect(nythraxisSigilPlacement(5, BOSS, 4, OPEN, false)).toEqual(first);
    // A wardstone on the first candidate pushes the pick to the next valid one.
    const blockedFirst = { ...OPEN, wardstones: [first] };
    const pick = nythraxisSigilPlacement(5, BOSS, 4, blockedFirst, false);
    expect(pick).not.toEqual(first);
    expect(nythraxisSigilPlacementValid(pick, 4, blockedFirst, false)).toBe(true);
    // Fire everywhere on normal: fall back to open floor rather than vanish.
    const everywhereFire = { ...OPEN, fires: [{ x: BOSS.x, z: BOSS.z, radius: 1000 }] };
    expect(nythraxisSigilPlacement(5, BOSS, 4, everywhereFire, false)).toEqual(first);
    // No open floor at all: the sigil still lands in the ring band (the first
    // candidate), never under the boss, which would bind him for free.
    const nowhere = nythraxisSigilPlacement(5, BOSS, 4, { ...OPEN, openFloor: () => false }, false);
    expect(nowhere).toEqual(first);
    expect(Math.hypot(nowhere.x - BOSS.x, nowhere.z - BOSS.z)).toBeGreaterThanOrEqual(
      NYTHRAXIS_SIGIL_MIN_DIST - 1e-9,
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
