import { describe, expect, it } from 'vitest';
import {
  BG_MATCH_DROP_RADIUS,
  BG_MATCH_INTEREST_RADIUS,
  bgWideInterestApplies,
  canObserveEntity,
  INTEREST_DROP_RADIUS,
  INTEREST_QUERY_RADIUS,
  INTEREST_RADIUS,
  inSameBgSlot,
  interestLimitSq,
  isStealthed,
  NPC_DROP_RADIUS,
  NPC_INTEREST_RADIUS,
  type StealthObservationWorld,
  SUMMON_COMBAT_REVEAL_SECONDS,
  stealthSubject,
  summonIsFighting,
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

describe('stealth observation (players and the summons they own)', () => {
  // ids: 1 the sneak, 2 their pet, 3 a hostile viewer, 4 a neutral viewer,
  // 5 a party mate, 6 a wild mob
  const sneak = ent({ id: 1, level: 20, stealthed: true, pos: { x: 0, y: 0, z: 0 } });
  const pet = ent({
    id: 2,
    kind: 'mob',
    ownerId: 1,
    inCombat: false,
    combatTimer: 99,
    pos: { x: 2, y: 0, z: 0 },
  });
  const foe = ent({ id: 3, level: 20, pos: { x: 5, y: 0, z: 0 } });
  const neutral = ent({ id: 4, level: 20, pos: { x: 10, y: 0, z: 0 } });
  const mate = ent({ id: 5, level: 20, pos: { x: 80, y: 0, z: 0 } });
  const wild = ent({ id: 6, kind: 'mob', ownerId: null, pos: { x: 1, y: 0, z: 0 } });
  const roster = (...es: Entity[]) => new Map(es.map((e) => [e.id, e]));
  const world = (overrides: Partial<StealthObservationWorld> = {}): StealthObservationWorld => ({
    entities: roster(sneak, pet, foe, neutral, mate, wild),
    isHostileTo: (a, b) => (a.id === 3 && b.id === 1) || (a.id === 1 && b.id === 3),
    partyOf: (pid) => (pid === 1 || pid === 5 ? { members: [1, 5] } : null),
    duelFor: () => null,
    ...overrides,
  });
  const d2 = (a: Entity, b: Entity) => (a.pos.x - b.pos.x) ** 2 + (a.pos.z - b.pos.z) ** 2;

  it('stealthSubject: a player answers for themselves, a summon for its stealthed owner', () => {
    const w = world();
    expect(stealthSubject(sneak, w.entities)).toBe(sneak);
    expect(stealthSubject(foe, w.entities)).toBeNull();
    expect(stealthSubject(pet, w.entities)).toBe(sneak);
    expect(stealthSubject(wild, w.entities)).toBeNull();
    // the owner is visible: the pet is not concealed
    const shown = ent({ ...sneak, stealthed: false });
    expect(stealthSubject(pet, roster(shown, pet))).toBeNull();
    // a fighting pet is never concealed, whatever its owner does
    expect(stealthSubject(ent({ ...pet, inCombat: true }), w.entities)).toBeNull();
    // a pet struck (or striking) inside the reveal window is never concealed...
    expect(SUMMON_COMBAT_REVEAL_SECONDS).toBe(5);
    expect(stealthSubject(ent({ ...pet, combatTimer: 4.95 }), w.entities)).toBeNull();
    // ...and conceals again once the window has passed
    expect(stealthSubject(ent({ ...pet, combatTimer: 5 }), w.entities)).toBe(sneak);
    // a guardian is an attack summon: never concealed, even before its first hit
    const guardian = ent({ ...pet, guardianState: {} as Entity['guardianState'] });
    expect(summonIsFighting(guardian)).toBe(true);
    expect(stealthSubject(guardian, w.entities)).toBeNull();
    expect(summonIsFighting(pet)).toBe(false);
    // an owner who left the roster conceals nothing
    expect(stealthSubject(pet, roster(pet))).toBeNull();
  });

  it('a hostile viewer sees neither the stealthed owner nor the idle pet at point blank', () => {
    const w = world();
    expect(canObserveEntity(w, foe, sneak, d2(foe, sneak))).toBe(false);
    expect(canObserveEntity(w, foe, pet, d2(foe, pet))).toBe(false);
    // the same viewer still sees an unowned mob and a fighting pet
    expect(canObserveEntity(w, foe, wild, d2(foe, wild))).toBe(true);
    const fighting = ent({ ...pet, inCombat: true });
    expect(canObserveEntity(w, foe, fighting, d2(foe, fighting))).toBe(true);
  });

  it('the owner always sees their own pet; a party mate sees both at any range', () => {
    const w = world();
    expect(canObserveEntity(w, sneak, pet, d2(sneak, pet))).toBe(true);
    expect(canObserveEntity(w, mate, sneak, d2(mate, sneak))).toBe(true);
    expect(canObserveEntity(w, mate, pet, d2(mate, pet))).toBe(true);
    // ...unless the two are dueling: then the mate falls back to detection range
    const dueling = world({ duelFor: (pid) => (pid === 5 ? { a: 5, b: 1 } : null) });
    expect(canObserveEntity(dueling, mate, sneak, d2(mate, sneak))).toBe(false);
    expect(canObserveEntity(dueling, mate, pet, d2(mate, pet))).toBe(false);
  });

  it('a neutral viewer detects the pet only when it detects the OWNER, measured to the owner', () => {
    // equal levels: radius = INTEREST_RADIUS * 0.25 = 22.5yd
    const w = world();
    expect(canObserveEntity(w, neutral, pet, d2(neutral, pet))).toBe(true);
    // pet right beside the viewer, owner beyond detection: the pet stays hidden,
    // because the distance that counts is the one to the owner, not the summon
    const farSneak = ent({ ...sneak, pos: { x: 40, y: 0, z: 0 } });
    const nearPet = ent({ ...pet, pos: { x: 11, y: 0, z: 0 } });
    const w2 = world({ entities: roster(farSneak, nearPet, neutral) });
    expect(canObserveEntity(w2, neutral, nearPet, d2(neutral, nearPet))).toBe(false);
    expect(canObserveEntity(w2, neutral, farSneak, d2(neutral, farSneak))).toBe(false);
  });
});
