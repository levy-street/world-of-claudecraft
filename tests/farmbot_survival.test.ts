import { describe, expect, it } from 'vitest';
import { DIVINE_PROTECTION_ID, LAY_ON_HANDS_ID, pickEmergencyAction } from '../farmbot/survival';
import type { ResolvedAbility } from '../src/sim/sim';
import type { AbilityDef, Entity, InvSlot, ItemDef } from '../src/sim/types';

function known(id: string): ResolvedAbility {
  return {
    def: {
      id,
      name: id,
      class: 'paladin',
      cost: 0,
      castTime: 0,
      cooldown: 0,
      range: 0,
      school: 'holy',
      requiresTarget: id !== DIVINE_PROTECTION_ID,
    } as AbilityDef,
    rank: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    effects: [],
    threatFlat: 0,
    threatMult: 1,
  } as unknown as ResolvedAbility;
}

function player(over: Partial<Entity> = {}): Entity {
  return {
    id: 1,
    hp: 100,
    maxHp: 100,
    resource: 200,
    maxResource: 200,
    resourceType: 'mana',
    cooldowns: new Map<string, number>(),
    gcdRemaining: 0,
    ...over,
  } as Entity;
}

const POTION_DEFS: Record<string, ItemDef> = {
  minor_health_potion: {
    id: 'minor_health_potion',
    name: 'Minor Health Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 90,
  } as unknown as ItemDef,
  greater_health_potion: {
    id: 'greater_health_potion',
    name: 'Greater Health Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 250,
  } as unknown as ItemDef,
  copper_ore: { id: 'copper_ore', name: 'Copper Ore', kind: 'junk' } as unknown as ItemDef,
};
const itemDef = (id: string): ItemDef | undefined => POTION_DEFS[id];

const PALADIN_KNOWN = [known(DIVINE_PROTECTION_ID), known(LAY_ON_HANDS_ID)];

describe('farmbot pickEmergencyAction', () => {
  it('fires Ward of Faith below 40% hp', () => {
    expect(pickEmergencyAction(PALADIN_KNOWN, player({ hp: 39 }), [], itemDef, 0, 0)).toEqual({
      kind: 'cast',
      id: DIVINE_PROTECTION_ID,
      selfTarget: false,
    });
    expect(pickEmergencyAction(PALADIN_KNOWN, player({ hp: 40 }), [], itemDef, 0, 0)).toBeNull();
  });

  it('prefers Ward of Faith over Last Rite when both triggers apply', () => {
    const action = pickEmergencyAction(PALADIN_KNOWN, player({ hp: 19 }), [], itemDef, 0, 0);
    expect(action?.id).toBe(DIVINE_PROTECTION_ID);
  });

  it('falls to Last Rite below 20% when Ward of Faith is on cooldown', () => {
    const p = player({ hp: 19, cooldowns: new Map([[DIVINE_PROTECTION_ID, 60]]) });
    expect(pickEmergencyAction(PALADIN_KNOWN, p, [], itemDef, 0, 0)).toEqual({
      kind: 'cast',
      id: LAY_ON_HANDS_ID,
      selfTarget: true, // friendly-targeted: needs castAbilityOn(self)
    });
  });

  it('gates Last Rite on the GCD but never Ward of Faith (offGcd)', () => {
    const onGcd = player({ hp: 19, gcdRemaining: 1.2 });
    const action = pickEmergencyAction(PALADIN_KNOWN, onGcd, [], itemDef, 0, 0);
    expect(action?.id).toBe(DIVINE_PROTECTION_ID); // offGcd ignores the GCD
    const blocked = pickEmergencyAction(
      [known(LAY_ON_HANDS_ID)],
      player({ hp: 19, gcdRemaining: 1.2 }),
      [],
      itemDef,
      0,
      0,
    );
    expect(blocked).toBeNull(); // GCD-gated cast skipped while on GCD
  });

  it('skips casts the player does not know', () => {
    expect(pickEmergencyAction([], player({ hp: 10 }), [], itemDef, 0, 0)).toBeNull();
  });

  it('picks the best potionHp potion below 35% hp', () => {
    const inv: InvSlot[] = [
      { itemId: 'minor_health_potion', count: 1 },
      { itemId: 'greater_health_potion', count: 1 },
      { itemId: 'copper_ore', count: 5 },
    ];
    expect(pickEmergencyAction([], player({ hp: 34 }), inv, itemDef, 0, 120_000)).toEqual({
      kind: 'use',
      id: 'greater_health_potion',
      selfTarget: false,
    });
    expect(pickEmergencyAction([], player({ hp: 36 }), inv, itemDef, 0, 120_000)).toBeNull();
  });

  it('honors the shared 120s potion cooldown', () => {
    const inv: InvSlot[] = [{ itemId: 'greater_health_potion', count: 1 }];
    expect(pickEmergencyAction([], player({ hp: 30 }), inv, itemDef, 100_000, 100_000)).toBeNull();
    expect(
      pickEmergencyAction([], player({ hp: 30 }), inv, itemDef, 100_000, 100_000 + 119_000),
    ).toBeNull();
    expect(
      pickEmergencyAction([], player({ hp: 30 }), inv, itemDef, 100_000, 100_000 + 120_000),
    ).toEqual({ kind: 'use', id: 'greater_health_potion', selfTarget: false });
  });

  it('gives non-paladins the potion arm only', () => {
    const warriorKnown: ResolvedAbility[] = [];
    const inv: InvSlot[] = [{ itemId: 'greater_health_potion', count: 1 }];
    expect(pickEmergencyAction(warriorKnown, player({ hp: 10 }), inv, itemDef, 0, 120_000)).toEqual(
      { kind: 'use', id: 'greater_health_potion', selfTarget: false },
    );
    expect(
      pickEmergencyAction(warriorKnown, player({ hp: 10 }), [], itemDef, 0, 120_000),
    ).toBeNull();
  });
});
