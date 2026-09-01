// Unit tests for applySelfCombatScalars (src/net/combat_scalar_wire.ts):
// the delta-guard fallback contract (an omitted wire key keeps the prior
// mirrored value, never zero, except rangedPower which falls back to 0) and
// the offhandWeapon null-vs-undefined presence rule that lets a real
// unequip clear the mirror instead of getting silently kept forever.

import { describe, expect, it } from 'vitest';
import { applySelfCombatScalars } from '../src/net/combat_scalar_wire';
import type { Entity } from '../src/sim/types';

function entity(over: Partial<Entity> = {}): Entity {
  return {
    attackPower: 100,
    rangedPower: 0,
    spellPower: 50,
    spellHaste: 0,
    critChance: 0.1,
    dodgeChance: 0.05,
    blockChance: 0,
    blockValue: 0,
    critRating: 10,
    hasteRating: 5,
    hitRating: 3,
    weapon: { min: 1, max: 2, speed: 2 },
    offhandWeapon: null,
    dualWielding: false,
    ...over,
  } as Entity;
}

describe('applySelfCombatScalars: delta-guard fallback (omitted key keeps the prior value)', () => {
  it('keeps every prior scalar when the wire record carries no keys at all', () => {
    const e = entity({ attackPower: 250, critRating: 42 });
    applySelfCombatScalars(e, {});
    expect(e.attackPower).toBe(250);
    expect(e.critRating).toBe(42);
    expect(e.weapon).toEqual({ min: 1, max: 2, speed: 2 });
  });

  it('overwrites only the scalars the wire record actually carries', () => {
    const e = entity({ attackPower: 250, spellPower: 50 });
    applySelfCombatScalars(e, { ap: 300 });
    expect(e.attackPower).toBe(300);
    expect(e.spellPower).toBe(50); // untouched: not in the wire record
  });

  it('rangedPower is the one exception: falls back to 0, not the prior value', () => {
    const e = entity({ rangedPower: 77 });
    applySelfCombatScalars(e, {});
    expect(e.rangedPower).toBe(0);
  });
});

describe('applySelfCombatScalars: offhandWeapon presence vs. weapon fallback', () => {
  it('an omitted offhandWeapon key keeps the prior mirrored weapon (unchanged, not cleared)', () => {
    const e = entity({ offhandWeapon: { min: 3, max: 6, speed: 1.8 }, dualWielding: true });
    applySelfCombatScalars(e, {});
    expect(e.offhandWeapon).toEqual({ min: 3, max: 6, speed: 1.8 });
    expect(e.dualWielding).toBe(true);
  });

  it('an explicit null offhandWeapon clears the mirror (a real unequip)', () => {
    const e = entity({ offhandWeapon: { min: 3, max: 6, speed: 1.8 }, dualWielding: true });
    applySelfCombatScalars(e, { offhandWeapon: null });
    expect(e.offhandWeapon).toBeNull();
    expect(e.dualWielding).toBe(false);
  });

  it('a new offhandWeapon both mirrors the weapon and derives dualWielding true', () => {
    const e = entity();
    applySelfCombatScalars(e, { offhandWeapon: { min: 2, max: 4, speed: 1.5 } });
    expect(e.offhandWeapon).toEqual({ min: 2, max: 4, speed: 1.5 });
    expect(e.dualWielding).toBe(true);
  });

  it('dualWielding is derived fresh every call, never read off the wire record', () => {
    // Even if a caller (or a stale/unexpected upstream) sent a dualWielding
    // key on the wire, this function must ignore it and derive from
    // offhandWeapon alone -- the wire has no such key by design.
    const e = entity({ offhandWeapon: null, dualWielding: true });
    applySelfCombatScalars(e, { dualWielding: false } as unknown as Record<string, unknown>);
    expect(e.dualWielding).toBe(false); // derived from offhandWeapon (null), not the injected key
  });
});
