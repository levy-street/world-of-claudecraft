import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { characterDerivedStats, createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { requiredLevelFor } from '../src/sim/item_level_req';

// Gear above the wearer's level is INERT: it stays equipped (still worn and
// rendered) but contributes no stats, armor, spell power, set pieces, or weapon
// damage until the character reaches its required level. This only arises for a
// character loaded wearing gear that was equipped before the level gate existed;
// the equip path itself blocks equipping over-level gear outright.

type Equip = Parameters<typeof characterDerivedStats>[2];

// knight_commanders_greaves: rare cloth legs, stats { armor: 95, sta: 4 }, req level 13.
const LEGS = 'knight_commanders_greaves';
const LEGS_REQ = 13;
// moggers_shiv: rare dagger, weapon { min: 6, max: 11, speed: 1.7, dagger: true }, req level 6.
const DAGGER = 'moggers_shiv';
const DAGGER_REQ = 6;
const UNARMED = { min: 1, max: 2, speed: 2 };

function warrior(level: number, equipment: Record<string, string>) {
  const e = createPlayer(0, 'warrior', { x: 0, y: 0, z: 0 }, 'Tester');
  e.level = level;
  recalcPlayerStats(e, 'warrior', equipment as Equip, undefined, {});
  return e;
}

describe('over-level gear is inert', () => {
  it('the chosen test items really require the expected levels', () => {
    expect(requiredLevelFor(ITEMS[LEGS])).toBe(LEGS_REQ);
    expect(requiredLevelFor(ITEMS[DAGGER])).toBe(DAGGER_REQ);
  });

  it('an armor piece above the wearer level contributes no stats or armor', () => {
    const inert = characterDerivedStats('warrior', LEGS_REQ - 1, { legs: LEGS } as Equip);
    const bare = characterDerivedStats('warrior', LEGS_REQ - 1, {} as Equip);
    expect(inert.stats).toEqual(bare.stats);
    expect(inert.maxHp).toBe(bare.maxHp);
  });

  it('reactivates once the wearer reaches the required level', () => {
    const active = characterDerivedStats('warrior', LEGS_REQ, { legs: LEGS } as Equip);
    const bare = characterDerivedStats('warrior', LEGS_REQ, {} as Equip);
    expect(active.stats.armor).toBe(bare.stats.armor + 95);
    expect(active.stats.sta).toBe(bare.stats.sta + 4);
    expect(active.maxHp).toBeGreaterThan(bare.maxHp);
  });

  it('an over-level weapon deals unarmed damage (no weapon stats, no dagger flag)', () => {
    const e = warrior(DAGGER_REQ - 1, { mainhand: DAGGER });
    expect(e.weapon).toEqual(UNARMED);
    expect(e.weapon.dagger).toBeUndefined();
  });

  it('the weapon becomes live at the required level', () => {
    const e = warrior(DAGGER_REQ, { mainhand: DAGGER });
    expect(e.weapon.min).toBe(6);
    expect(e.weapon.max).toBe(11);
    expect(e.weapon.dagger).toBe(true);
  });

  it('over-level gear stays worn (still mirrored for render) while inert', () => {
    const e = warrior(DAGGER_REQ - 1, { mainhand: DAGGER, legs: LEGS });
    // Render mirrors keep the raw worn set so the gear still shows on the character...
    expect(e.equippedItems.mainhand).toBe(DAGGER);
    expect(e.equippedItems.legs).toBe(LEGS);
    expect(e.mainhandItemId).toBe(DAGGER);
    // ...but none of it applies.
    expect(e.weapon).toEqual(UNARMED);
  });

  it('set bonuses do not count over-level pieces', () => {
    // Two epic deathlord plate pieces grant the 2-piece Strength bonus (+40 attack power).
    const set = { legs: 'deathlord_legguards', chest: 'deathlord_warplate' };
    const inert = warrior(1, set); // level 1: both pieces over-level -> fully inert
    const bare = warrior(1, {});
    expect(inert.attackPower).toBe(bare.attackPower); // no +40 set AP, no piece Strength
    const active = warrior(20, set); // level 20: pieces eligible -> set bonus applies
    const bareAt20 = warrior(20, {});
    expect(active.attackPower).toBeGreaterThanOrEqual(bareAt20.attackPower + 40);
  });

  it('is deterministic (same inputs, same derived block)', () => {
    const a = characterDerivedStats('warrior', 5, { legs: LEGS } as Equip);
    const b = characterDerivedStats('warrior', 5, { legs: LEGS } as Equip);
    expect(a).toEqual(b);
  });
});
