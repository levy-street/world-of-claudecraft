import { describe, expect, it } from 'vitest';
import {
  BG_MATCH_DROP_RADIUS,
  BG_MATCH_INTEREST_RADIUS,
  bgWideInterestApplies,
  INTEREST_DROP_RADIUS,
  INTEREST_QUERY_RADIUS,
  INTEREST_RADIUS,
  inSameBgSlot,
  interestLimitSq,
  isStealthed,
  NPC_DROP_RADIUS,
  NPC_INTEREST_RADIUS,
} from '../server/interest_policy';
import { battlegroundOrigin } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

// Direct pins for the extracted interest-policy leaf (formerly private
// helpers in server/game.ts; the broadcast-pass behavior stays pinned by
// tests/interest_candidates.test.ts, tests/bandwidth.test.ts and
// tests/battleground_wire.test.ts through the real snapshot path).

function ent(overrides: Partial<Entity>): Entity {
  return {
    kind: 'player',
    id: 1,
    pos: { x: 0, y: 0, z: 0 },
    ownerId: null,
    stealthed: false,
    ...overrides,
  } as Entity;
}

describe('interest_policy', () => {
  it('pins the radii to their exact literals (the hysteresis ladder)', () => {
    // Enter below persist below query; the ladder ordering is what prevents
    // create/destroy churn at the boundary, so pin the literals, not just
    // the ordering.
    expect(INTEREST_RADIUS).toBe(90);
    expect(INTEREST_DROP_RADIUS).toBe(100);
    expect(NPC_INTEREST_RADIUS).toBe(120);
    expect(NPC_DROP_RADIUS).toBe(130);
    expect(INTEREST_QUERY_RADIUS).toBe(130);
    expect(BG_MATCH_INTEREST_RADIUS).toBe(300);
    expect(BG_MATCH_DROP_RADIUS).toBe(320);
  });

  it('interestLimitSq: npcs ride the legacy radii, everything else the player pair', () => {
    const npc = ent({ kind: 'npc' });
    expect(interestLimitSq(npc, false)).toBe(120 * 120);
    expect(interestLimitSq(npc, true)).toBe(130 * 130);
    const mob = ent({ kind: 'mob' });
    expect(interestLimitSq(mob, false)).toBe(90 * 90);
    expect(interestLimitSq(mob, true)).toBe(100 * 100);
  });

  it('isStealthed reads the sim-cached flag only', () => {
    expect(isStealthed(ent({ stealthed: true }))).toBe(true);
    expect(isStealthed(ent({ stealthed: false }))).toBe(false);
  });

  it('bgWideInterestApplies: same-slot teammates and unowned entities only', () => {
    const bg = battlegroundOrigin(0);
    const at = (slotZ: number, overrides: Partial<Entity>) =>
      ent({ ...overrides, pos: { x: bg.x, y: 0, z: slotZ } });
    const viewer = at(bg.z, { id: 10 });
    const teammate = at(bg.z, { id: 11 });
    const enemy = at(bg.z, { id: 12 });
    const flag = at(bg.z, { kind: 'object', id: 13, ownerId: null });
    const enemyPet = at(bg.z, { kind: 'mob', id: 14, ownerId: 12 });
    const team = [10, 11];
    expect(bgWideInterestApplies(viewer, teammate, team)).toBe(true);
    expect(bgWideInterestApplies(viewer, flag, team)).toBe(true);
    // An enemy player, and anything an enemy owns, falls back to open-world
    // radii: the raised band must never ship an enemy position by proxy.
    expect(bgWideInterestApplies(viewer, enemy, team)).toBe(false);
    expect(bgWideInterestApplies(viewer, enemyPet, team)).toBe(false);
    // Not in a match at all: nothing widens.
    expect(bgWideInterestApplies(viewer, teammate, null)).toBe(false);
    // Cross-slot pairs never widen, whatever the team list says.
    const nextSlot = at(battlegroundOrigin(1).z, { id: 11 });
    expect(inSameBgSlot(viewer, nextSlot)).toBe(false);
    expect(bgWideInterestApplies(viewer, nextSlot, team)).toBe(false);
    // Open-world endpoints are never same-slot.
    expect(inSameBgSlot(ent({ id: 20 }), ent({ id: 21 }))).toBe(false);
  });
});
