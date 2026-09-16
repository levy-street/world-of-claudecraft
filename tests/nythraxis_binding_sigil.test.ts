// Pure-leaf pins for the Binding Sigil (src/sim/nythraxis_binding_sigil.ts):
// the tuning literals the guide quotes, hash placement with an injected floor,
// the placement rules, the fallbacks, the bind test, and the readout.

import { describe, expect, it } from 'vitest';
import { NYTHRAXIS_LAYOUT, NYTHRAXIS_PLATFORM_SIDE_OFFSET } from '../src/sim/dungeon_layout';
import {
  activeNythraxisBindingSigils,
  NYTHRAXIS_ASCENSION_EVERY,
  NYTHRAXIS_BOUND_VULNERABILITY,
  NYTHRAXIS_SIGIL_FIRST_SECONDS,
  NYTHRAXIS_SIGIL_SIDE_OFFSET,
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
  nythraxisSigilSideOf,
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
    // v0.42.2: on the flanking platforms 30 yd to the raid's left or right of
    // the spawn, the same offset the arena layout builds them at.
    expect(NYTHRAXIS_SIGIL_SIDE_OFFSET).toBe(30);
    expect(NYTHRAXIS_SIGIL_SIDE_OFFSET).toBe(NYTHRAXIS_PLATFORM_SIDE_OFFSET);
    expect(NYTHRAXIS_LAYOUT.platforms?.map((pl) => [pl.x, pl.z])).toEqual([
      [-30, NYTHRAXIS_LAYOUT.dais.z],
      [30, NYTHRAXIS_LAYOUT.dais.z],
    ]);
    expect(NYTHRAXIS_LAYOUT.platforms).toEqual([
      { x: -30, z: 96, r: 9.5 },
      { x: 30, z: 96, r: 9.5 },
    ]);
    expect(NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE).toBe(6);
  });

  it('lands on the platform centre on the asked side of the spawn, mirrored across it', () => {
    for (const side of [1, -1] as const) {
      expect(nythraxisSigilCandidate(BOSS, side)).toEqual({
        x: BOSS.x + side * NYTHRAXIS_SIGIL_SIDE_OFFSET,
        z: BOSS.z,
      });
    }
    const right = nythraxisSigilCandidate(BOSS, -1);
    const left = nythraxisSigilCandidate(BOSS, 1);
    expect(right.x - BOSS.x).toBe(-(left.x - BOSS.x));
    expect(right.z).toBe(left.z);
  });

  it('reads the side a placed sigil sits on, so a crossover is what the next cast alternates from', () => {
    expect(nythraxisSigilSideOf(BOSS, nythraxisSigilCandidate(BOSS, 1))).toBe(1);
    expect(nythraxisSigilSideOf(BOSS, nythraxisSigilCandidate(BOSS, -1))).toBe(-1);
    // A fire-forced crossover: asked right, landed left, remembered as left,
    // so the next side is right again rather than left twice.
    const fireOnRight = { ...OPEN, fires: [{ ...nythraxisSigilCandidate(BOSS, -1), radius: 3 }] };
    const landed = nythraxisSigilPlacement(BOSS, -1, 4, fireOnRight, false);
    const landedSide = nythraxisSigilSideOf(BOSS, landed);
    expect(landedSide).toBe(1);
    expect(nythraxisSigilNextSide(landedSide)).toBe(-1);
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

  it('takes the asked platform, the other platform when it is blocked, and the asked one when both are', () => {
    const right = nythraxisSigilCandidate(BOSS, -1);
    const left = nythraxisSigilCandidate(BOSS, 1);
    expect(nythraxisSigilPlacement(BOSS, -1, 4, OPEN, false)).toEqual(right);
    expect(nythraxisSigilPlacement(BOSS, 1, 4, OPEN, false)).toEqual(left);
    // A wardstone on the asked platform sends the sigil across.
    const wardOnRight = { ...OPEN, wardstones: [right] };
    expect(nythraxisSigilPlacement(BOSS, -1, 4, wardOnRight, false)).toEqual(left);
    // ... and mirrored: a ward on the asked LEFT platform sends it right.
    expect(nythraxisSigilPlacement(BOSS, 1, 4, { ...OPEN, wardstones: [left] }, false)).toEqual(
      right,
    );
    // Closed floor on the asked side alone crosses the same way.
    const rightClosed = { ...OPEN, openFloor: (p: { x: number }) => p.x > BOSS.x };
    expect(nythraxisSigilPlacement(BOSS, -1, 4, rightClosed, false)).toEqual(left);
    // Fire on the asked platform does the same on Normal, and nothing on Heroic.
    const fireOnRight = { ...OPEN, fires: [{ ...right, radius: 3 }] };
    expect(nythraxisSigilPlacement(BOSS, -1, 4, fireOnRight, false)).toEqual(left);
    expect(nythraxisSigilPlacement(BOSS, -1, 4, fireOnRight, true)).toEqual(right);
    // Both blocked (or no open floor at all): the asked platform, never under
    // the boss, which would bind him for free.
    const both = { ...OPEN, wardstones: [right, left] };
    expect(nythraxisSigilPlacement(BOSS, -1, 4, both, false)).toEqual(right);
    // Both platforms burning on Normal: the asked one, fire and all (a cast
    // must land somewhere; flagged for the owner).
    const bothFire = {
      ...OPEN,
      fires: [
        { ...right, radius: 3 },
        { ...left, radius: 3 },
      ],
    };
    expect(nythraxisSigilPlacement(BOSS, -1, 4, bothFire, false)).toEqual(right);
    const nowhere = nythraxisSigilPlacement(BOSS, 1, 4, { ...OPEN, openFloor: () => false }, false);
    expect(nowhere).toEqual(left);
    expect(Math.hypot(nowhere.x - BOSS.x, nowhere.z - BOSS.z)).toBe(NYTHRAXIS_SIGIL_SIDE_OFFSET);
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
