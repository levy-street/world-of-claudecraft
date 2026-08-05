import { describe, expect, it } from 'vitest';
import {
  BLESSING_OF_MIGHT_ID,
  CONSECRATION_ID,
  CRUSADER_STRIKE_ID,
  DEVOTION_AURA_ID,
  EXORCISM_ID,
  isDamageAbility,
  pickAbility,
  pickGoldCombatAbility,
  pickGoldMaintainBuff,
  RETRIBUTION_AURA_ID,
} from '../farmbot/rotation';
import type { ResolvedAbility } from '../src/sim/sim';
import type { AbilityDef, AbilityEffect, Aura, Entity } from '../src/sim/types';

function ability(
  id: string,
  over: { def?: Partial<AbilityDef>; effects?: AbilityEffect[]; cost?: number } = {},
): ResolvedAbility {
  const def: AbilityDef = {
    id,
    name: id,
    class: 'warrior',
    cost: 10,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    ...over.def,
  } as AbilityDef;
  return {
    def,
    rank: 1,
    cost: over.cost ?? def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: over.effects ?? [{ type: 'weaponStrike', bonus: 0 }],
    threatFlat: 0,
    threatMult: 1,
  } as ResolvedAbility;
}

function entity(over: Partial<Entity> = {}): Entity {
  return {
    pos: { x: 0, y: 0, z: 0 },
    resource: 100,
    maxResource: 100,
    resourceType: 'rage',
    cooldowns: new Map<string, number>(),
    gcdRemaining: 0,
    auras: [],
    ...over,
  } as Entity;
}

function aura(id: string): Aura {
  return { id, name: id, kind: 'buff_ap_pct', remaining: 60, duration: 1800, value: 10, sourceId: 1, school: 'holy' } as Aura;
}

const TARGET = entity();

const GOLD_KNOWN = [
  ability(EXORCISM_ID, {
    def: { range: 30, requiresTarget: true },
    effects: [{ type: 'directDamage', min: 1, max: 2 }],
    cost: 55,
  }),
  ability(CRUSADER_STRIKE_ID, { cost: 30 }),
  ability(CONSECRATION_ID, {
    def: { requiresTarget: false },
    effects: [{ type: 'groundAoE', min: 1, max: 2, radius: 8, duration: 10, interval: 2 }],
    cost: 60,
  }),
  ability(BLESSING_OF_MIGHT_ID, {
    def: { requiresTarget: true, targetType: 'friendly', range: 30 },
    effects: [{ type: 'buffTarget', kind: 'buff_ap_pct', value: 10, duration: 1800, party: true }],
    cost: 25,
  }),
  ability(RETRIBUTION_AURA_ID, {
    def: { requiresTarget: false },
    effects: [{ type: 'selfBuff', kind: 'thorns', value: 5, duration: 1800 }],
    cost: 0,
  }),
  ability(DEVOTION_AURA_ID, {
    def: { requiresTarget: false },
    effects: [{ type: 'buffTarget', kind: 'buff_armor_pct', value: 10, duration: 1800, party: true }],
    cost: 0,
  }),
];

describe('farmbot pickAbility', () => {
  it('picks the first ready damage ability in slot order', () => {
    const known = [ability('a'), ability('b')];
    expect(pickAbility(known, entity(), TARGET)).toEqual({ slot: 0, id: 'a' });
  });

  it('skips passives, non-targeted abilities, and non-damage abilities', () => {
    const known = [
      ability('passive', { def: { passive: true } }),
      ability('selfbuff', { def: { requiresTarget: false } }),
      ability('heal', { effects: [{ type: 'heal', min: 1, max: 2 }] }),
      ability('strike'),
    ];
    expect(isDamageAbility(known[2])).toBe(false);
    expect(pickAbility(known, entity(), TARGET)).toEqual({ slot: 3, id: 'strike' });
  });

  it('skips abilities on cooldown or behind the GCD', () => {
    const known = [ability('a'), ability('b')];
    const onCd = entity({ cooldowns: new Map([['a', 3]]) });
    expect(pickAbility(known, onCd, TARGET)).toEqual({ slot: 1, id: 'b' });
    const gcd = entity({ gcdRemaining: 1.2 });
    expect(pickAbility(known, gcd, TARGET)).toBeNull();
  });

  it('skips abilities the player cannot afford', () => {
    const known = [ability('a', { cost: 30 }), ability('b', { cost: 5 })];
    expect(pickAbility(known, entity({ resource: 10 }), TARGET)).toEqual({ slot: 1, id: 'b' });
    expect(pickAbility(known, entity({ resource: 4 }), TARGET)).toBeNull();
  });

  it('respects range: melee needs 5 yd, ranged gets its def range', () => {
    const melee = [ability('melee')];
    const near = entity({ pos: { x: 4, y: 0, z: 0 } });
    const far = entity({ pos: { x: 6, y: 0, z: 0 } });
    expect(pickAbility(melee, entity(), near)).toEqual({ slot: 0, id: 'melee' });
    expect(pickAbility(melee, entity(), far)).toBeNull();
    const ranged = [
      ability('shot', { def: { range: 30 }, effects: [{ type: 'directDamage', min: 1, max: 2 }] }),
    ];
    expect(pickAbility(ranged, entity(), far)).toEqual({ slot: 0, id: 'shot' }); // 6 <= 30
    const outranged = entity({ pos: { x: 31, y: 0, z: 0 } });
    expect(pickAbility(ranged, entity(), outranged)).toBeNull();
  });

  it('returns null when nothing is castable (caller auto-attacks)', () => {
    expect(pickAbility([], entity(), TARGET)).toBeNull();
  });
});

describe('farmbot gold combat rotation', () => {
  it('uses crusader strike only on a single attacker (never exorcism)', () => {
    const player = entity({ resource: 100, resourceType: 'mana' });
    const near = entity({ pos: { x: 3, y: 0, z: 0 } });
    expect(pickGoldCombatAbility(GOLD_KNOWN, player, near, 1)).toEqual({
      id: CRUSADER_STRIKE_ID,
      target: 'enemy',
    });
    // Even when exorcism is ready and first in known, gold combat never picks it.
    expect(pickGoldCombatAbility(GOLD_KNOWN, player, near, 1)?.id).not.toBe(EXORCISM_ID);
  });

  it('uses holy ground when two or more attackers, crusader strike otherwise', () => {
    const player = entity({ resource: 100, resourceType: 'mana' });
    const near = entity({ pos: { x: 3, y: 0, z: 0 } });
    expect(pickGoldCombatAbility(GOLD_KNOWN, player, near, 2)).toEqual({
      id: CONSECRATION_ID,
      target: 'none',
    });
    // Consecration on cooldown: fall through to crusader strike.
    const onCd = entity({
      resource: 100,
      resourceType: 'mana',
      cooldowns: new Map([[CONSECRATION_ID, 5]]),
    });
    expect(pickGoldCombatAbility(GOLD_KNOWN, onCd, near, 3)).toEqual({
      id: CRUSADER_STRIKE_ID,
      target: 'enemy',
    });
  });

  it('returns null out of melee or when mana/GCD blocks the kit (auto-attack only)', () => {
    const far = entity({ pos: { x: 20, y: 0, z: 0 } });
    expect(pickGoldCombatAbility(GOLD_KNOWN, entity({ resource: 100 }), far, 1)).toBeNull();
    expect(
      pickGoldCombatAbility(GOLD_KNOWN, entity({ resource: 10, resourceType: 'mana' }), TARGET, 1),
    ).toBeNull();
    expect(
      pickGoldCombatAbility(GOLD_KNOWN, entity({ resource: 100, gcdRemaining: 1 }), TARGET, 2),
    ).toBeNull();
  });

  it('refreshes oath of iron first, then one paladin aura (requital preferred)', () => {
    const player = entity({ resource: 100, resourceType: 'mana', auras: [] });
    expect(pickGoldMaintainBuff(GOLD_KNOWN, player)).toEqual({
      id: BLESSING_OF_MIGHT_ID,
      target: 'self',
    });
    const hasOath = entity({
      resource: 100,
      resourceType: 'mana',
      auras: [aura(BLESSING_OF_MIGHT_ID)],
    });
    expect(pickGoldMaintainBuff(GOLD_KNOWN, hasOath)).toEqual({
      id: RETRIBUTION_AURA_ID,
      target: 'none',
    });
    // Exclusive auras: with Requital up, do not thrash into Steadfast.
    const bothOk = entity({
      resource: 100,
      resourceType: 'mana',
      auras: [aura(BLESSING_OF_MIGHT_ID), aura(RETRIBUTION_AURA_ID)],
    });
    expect(pickGoldMaintainBuff(GOLD_KNOWN, bothOk)).toBeNull();
    // Steadfast already up counts as the aura slot filled.
    const steadfast = entity({
      resource: 100,
      resourceType: 'mana',
      auras: [aura(BLESSING_OF_MIGHT_ID), aura(DEVOTION_AURA_ID)],
    });
    expect(pickGoldMaintainBuff(GOLD_KNOWN, steadfast)).toBeNull();
  });

  it('falls back to steadfast aura when requital is unknown', () => {
    const known = GOLD_KNOWN.filter((a) => a.def.id !== RETRIBUTION_AURA_ID);
    const hasOath = entity({
      resource: 100,
      resourceType: 'mana',
      auras: [aura(BLESSING_OF_MIGHT_ID)],
    });
    expect(pickGoldMaintainBuff(known, hasOath)).toEqual({
      id: DEVOTION_AURA_ID,
      target: 'none',
    });
  });
});
