import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { WARRIOR_TALENTS } from '../src/sim/content/talents_warrior';
import * as equipmentRules from '../src/sim/equipment_rules';
import { ALL_CLASSES } from '../src/sim/types';

const WINNING_WARRIOR_KIT = [
  'heroic_strike',
  'revenge',
  'battle_shout',
  'charge',
  'thunder_clap',
  'hamstring',
  'bloodrage',
  'overpower',
  'raging_gale',
  'raised_guard',
  'pummel',
  'execute',
  'furious_mending',
  'iron_resolve',
  'slam',
  'red_harvest',
  'whirlwind',
  'faultline',
  'heroic_leap',
  'cleave',
  'rallying_cry',
  'emboldening_roar',
  'defiant_bellow',
  'battle_stance',
  'berserker_stance',
  'defensive_stance',
  'demoralizing_shout',
  'intimidating_shout',
  'sunder_armor',
  'taunt',
  'measured_fury',
  'seasoned_soldier',
  'sudden_death',
  'diabolical_twinstrike',
  'cleaving_blows',
  'breachmaker',
  'sweeping_strikes',
  'deep_wounds',
  'enrage_passive',
] as const;

function known(spec: 'arms' | 'fury' | 'prot', abilityId: string) {
  const mods = computeTalentModifiers('warrior', { spec, rows: {} }, 20);
  return abilitiesKnownAt('warrior', 20, mods).find((entry) => entry.def.id === abilityId);
}

describe('v0.26 winning Warrior release contracts', () => {
  it('keeps exactly the canonical nine classes and stable warrior id', () => {
    expect(ALL_CLASSES).toEqual([
      'warrior',
      'paladin',
      'hunter',
      'rogue',
      'priest',
      'shaman',
      'mage',
      'warlock',
      'druid',
    ]);
    expect([...Object.keys(CLASSES)].sort()).toEqual([...ALL_CLASSES].sort());
    expect(CLASSES.warrior.id).toBe('warrior');
  });

  it('installs the complete redesigned kit without the displaced Warrior abilities', () => {
    expect(CLASSES.warrior.abilities).toEqual(WINNING_WARRIOR_KIT);
    expect(CLASSES.warrior.abilities).not.toContain('rend');
    expect(CLASSES.warrior.abilities).not.toContain('commanding_shout');
    expect((CLASSES.warrior as { startOffhand?: string }).startOffhand).toBe('eastbrook_buckler');
  });

  it('keeps winning row presentation names out of the displaced Warrior vocabulary', () => {
    expect(ABILITIES.avatar.name).toBe('Avatar');
    expect(ABILITIES.bladestorm.name).toBe('Bladestorm');
    const reachableText = CLASSES.warrior.abilities
      .map((id) => `${ABILITIES[id].name}\n${ABILITIES[id].description}`)
      .join('\n');
    expect(reachableText).not.toMatch(/\b(?:Siegeborn|Steel Cyclone)\b/);
  });

  it('uses only the winning Warrior specialization masteries', () => {
    expect(
      WARRIOR_TALENTS.specs.map(({ id, signature, mastery }) => ({
        id,
        signature,
        mastery,
      })),
    ).toEqual([
      {
        id: 'arms',
        signature: 'mortal_strike',
        mastery: {
          name: 'Master Armorer',
          description:
            'While wielding a two-handed weapon, all damage you deal is increased by 10%.',
          effect: { global: { masteryTwoHandDmgPct: 0.1 } },
        },
      },
      {
        id: 'fury',
        signature: 'bloodthirst',
        mastery: {
          name: 'Bloodletter',
          description: 'Increases your critical strike chance by 5% and attack power by 10.',
          effect: { stats: { crit: 0.05, ap: 10 } },
        },
      },
      {
        id: 'prot',
        signature: 'shield_slam',
        mastery: {
          name: 'Recompense',
          description:
            'Increases all threat you generate by 30% and your armor by 10%. Vanguard: your Stamina is increased by 40% and you gain armor equal to 70% of your Strength.',
          effect: {
            global: { threatPct: 0.3 },
            stats: { armorPct: 0.1, staPct: 0.4, armorFromStrPct: 0.7 },
          },
        },
      },
    ]);
  });

  it('pins the final Fury resource loop and native charges', () => {
    expect(ABILITIES.overpower).toMatchObject({
      cost: 15,
      maxCharges: 2,
      excludeSpecs: ['fury', 'prot'],
      excludeSpecsAtLevel: 10,
    });
    expect(ABILITIES.overpower.ranks?.[0]?.cost).toBe(15);
    expect(ABILITIES.raging_gale).toMatchObject({
      specs: ['fury'],
      cost: 0,
      cooldown: 8,
      maxCharges: 2,
      effects: [
        { type: 'weaponStrike', bonus: 14, weaponMult: 0.4 },
        { type: 'weaponStrike', bonus: 14, weaponMult: 0.4 },
        // v0.27.1 rage fix: halved from 8; Bloodletting is the generating builder.
        { type: 'gainResource', amount: 4 },
      ],
    });
    expect(ABILITIES.bloodthirst).toMatchObject({
      cooldown: 6,
      effects: [
        { type: 'weaponStrike', bonus: 30, weaponMult: 0.5 },
        { type: 'selfHealPctMax', pct: 0.03 },
        { type: 'gainResource', amount: 12 },
        { type: 'enrageChance', chance: 0.3, duration: 4 },
      ],
    });
    expect(ABILITIES.red_harvest).toMatchObject({
      specs: ['fury'],
      cost: 80,
      cooldown: 0,
      effects: [
        { type: 'weaponStrike', bonus: 25, weaponMult: 0.65 },
        { type: 'weaponStrike', bonus: 25, weaponMult: 0.65 },
        { type: 'weaponStrike', bonus: 25, weaponMult: 0.65 },
        { type: 'enrageChance', chance: 1, duration: 4 },
      ],
    });
    expect(ABILITIES.whirlwind).toMatchObject({
      specs: ['fury'],
      cost: 0,
      cooldown: 10,
      effects: [
        {
          // v0.27.1 rage fix: the spin no longer mints (rageOnHit removed).
          type: 'aoeDamage',
          min: 30,
          max: 42,
          radius: 8,
        },
        {
          type: 'selfBuff',
          kind: 'aoe_echo',
          value: 0,
          duration: 12,
          charges: 2,
          auraId: 'bladed_echo',
          auraName: 'Bladed Echo',
        },
      ],
    });
  });

  it('pins the final per-spec Early Grave behavior', () => {
    expect(known('fury', 'execute')).toMatchObject({ cost: 0, cooldown: 6 });
    expect(known('arms', 'execute')).toMatchObject({ cost: 10, cooldown: 0 });
    expect(known('prot', 'execute')).toMatchObject({ cost: 15, cooldown: 0 });
  });

  it('pins the final Arms builder, cleave, widening arc, and maiming strike', () => {
    expect(ABILITIES.slam).toMatchObject({
      specs: ['arms'],
      cost: 0,
      castTime: 0,
      cooldown: 4,
      effects: [
        { type: 'weaponStrike', bonus: 15, weaponMult: 0.5 },
        { type: 'gainResource', amount: 8 },
      ],
    });
    expect(ABILITIES.cleave).toMatchObject({
      specs: ['arms'],
      cost: 15,
      effects: [{ type: 'aoeDamage', min: 30, max: 38, radius: 5, softCap: 5 }],
    });
    expect(ABILITIES.sweeping_strikes).toMatchObject({
      cost: 0,
      cooldown: 30,
      offGcd: true,
      effects: [{ type: 'selfBuff', kind: 'sweeping_strikes', value: 1, duration: 12 }],
    });
    expect(ABILITIES.mortal_strike).toMatchObject({
      cost: 30,
      cooldown: 6,
      effects: [
        { type: 'weaponStrike', bonus: 50 },
        { type: 'buffTarget', kind: 'mortal_wound', value: 0.5, duration: 10 },
        { type: 'dot', total: 30, duration: 6, interval: 3, auraId: 'deep_wounds' },
      ],
    });
  });

  it('centralizes dual-wield and Titan Grip policy at the equipment boundary', () => {
    const rules = equipmentRules as typeof equipmentRules & {
      canDualWield?: (cls: string, spec: string | null) => boolean;
      canDualWieldTwoHand?: (cls: string, spec: string | null) => boolean;
    };
    expect(rules.canDualWield?.('warrior', 'fury')).toBe(true);
    expect(rules.canDualWieldTwoHand?.('warrior', 'fury')).toBe(true);
    expect(rules.canDualWield?.('warrior', 'arms')).toBe(false);
    expect(rules.canDualWield?.('rogue', null)).toBe(true);
    expect(rules.canDualWieldTwoHand?.('rogue', null)).toBe(false);
  });
});
