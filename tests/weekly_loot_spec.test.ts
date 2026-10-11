import { describe, expect, it } from 'vitest';
import { IGNIVAR_SET_ITEMS } from '../src/sim/content/ignivar_loot';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
import { TALENTS } from '../src/sim/content/talents';
import { TRINKET_ITEMS } from '../src/sim/content/trinkets';
import { ITEMS } from '../src/sim/data';
import type { ItemDef, PlayerClass } from '../src/sim/types';
import {
  sanitizeWeeklyLootSpec,
  WEEKLY_LOOT_ITEM_ROLES,
  WEEKLY_LOOT_PROFILES,
  weeklyLootSpecFitsItem,
  weeklyLootSpecForClass,
} from '../src/sim/weekly_loot_spec';
import { weeklyRewardFitsClass } from '../src/sim/weekly_reward_eligibility';
import { weeklyBossLootPool } from '../src/sim/weekly_reward_tables';
import { weeklyLootPool } from '../src/sim/weekly_rewards';

const accepts = (cls: PlayerClass, spec: string | undefined, id: string): boolean => {
  const item = ITEMS[id];
  expect(item, id).toBeDefined();
  return weeklyRewardFitsClass(cls, item) && weeklyLootSpecFitsItem(cls, spec, item);
};

// Literal player-role expectations, independent of the classifier's profile table.
const SPEC_CASES: readonly [PlayerClass, string, string, string, string][] = [
  ['warrior', 'arms', 'slagbreaker_helmet', 'forgefathers_temper', 'heart_of_the_crucible'],
  ['warrior', 'fury', 'emberfury_helmet', 'paired_talons', 'heart_of_the_crucible'],
  ['warrior', 'prot', 'forgewall_helmet', 'heart_of_the_crucible', 'forgefathers_temper'],
  ['paladin', 'holy', 'dawnforged_helmet', 'last_flame_lantern', 'forgefathers_temper'],
  ['paladin', 'protection', 'oathpyre_helmet', 'heart_of_the_crucible', 'forgefathers_temper'],
  ['paladin', 'retribution', 'zealfire_helmet', 'forgefathers_temper', 'last_flame_lantern'],
  [
    'hunter',
    'beast_mastery',
    'packlord_emberhide_helmet',
    'molten_fletching',
    'heart_of_the_crucible',
  ],
  ['hunter', 'marksmanship', 'coldsight_trackers_helmet', 'hunters_tally', 'heart_of_the_crucible'],
  ['hunter', 'survival', 'slagsnare_helmet', 'paired_talons', 'heart_of_the_crucible'],
  ['rogue', 'assassination', 'cinderfang_helmet', 'paired_talons', 'heart_of_the_crucible'],
  ['rogue', 'combat', 'smolderstrike_helmet', 'forgefathers_temper', 'heart_of_the_crucible'],
  ['rogue', 'subtlety', 'ashveil_helmet', 'paired_talons', 'heart_of_the_crucible'],
  ['priest', 'discipline', 'emberscreed_helmet', 'menders_hourglass', 'kindling_orb'],
  ['priest', 'holy', 'benison_dawnweave_helmet', 'wellspring_seed', 'kindling_orb'],
  ['priest', 'shadow', 'vesperash_helmet', 'kindling_orb', 'last_flame_lantern'],
  ['shaman', 'elemental', 'stormkindled_helmet', 'stormjar', 'last_flame_lantern'],
  [
    'shaman',
    'enhancement',
    'warspirit_emberscale_helmet',
    'forgefathers_temper',
    'last_flame_lantern',
  ],
  ['shaman', 'restoration', 'springmender_helmet', 'wellspring_seed', 'kindling_orb'],
  ['mage', 'arcane', 'chronoweave_helmet', 'menders_hourglass', 'kindling_orb'],
  ['mage', 'fire', 'pyroclast_helmet', 'kindling_orb', 'menders_hourglass'],
  ['mage', 'frost', 'frostquench_helmet', 'stormjar', 'last_flame_lantern'],
  ['warlock', 'affliction', 'hexthread_helmet', 'kindling_orb', 'menders_hourglass'],
  ['warlock', 'demonology', 'gravebrand_helmet', 'stormjar', 'last_flame_lantern'],
  ['warlock', 'destruction', 'ruincaller_helmet', 'kindling_orb', 'wellspring_seed'],
  ['druid', 'balance', 'moonscorch_helmet', 'kindling_orb', 'wellspring_seed'],
  ['druid', 'feral', 'wildfang_emberhide_helmet', 'paired_talons', 'last_flame_lantern'],
  ['druid', 'restoration', 'grovespring_helmet', 'last_flame_lantern', 'kindling_orb'],
];

describe('Weekly Vault specialization loot policy', () => {
  it('isolates weapon-hand restrictions from class locks, item roles, sets, and stats', () => {
    const onehand: ItemDef = {
      id: 'neutral_test_weapon',
      name: 'Test',
      kind: 'weapon',
      slot: 'mainhand',
      hand: 'onehand',
      weapon: { min: 1, max: 2, speed: 2 },
      sellValue: 0,
    };
    const twohand: ItemDef = { ...onehand, hand: 'twohand' as const };
    expect(weeklyLootSpecFitsItem('warrior', 'arms', onehand)).toBe(false);
    expect(weeklyLootSpecFitsItem('warrior', 'arms', twohand)).toBe(true);
    for (const [cls, spec] of [
      ['warrior', 'prot'],
      ['paladin', 'protection'],
    ] as const) {
      expect(weeklyLootSpecFitsItem(cls, spec, onehand)).toBe(true);
      expect(weeklyLootSpecFitsItem(cls, spec, twohand)).toBe(false);
    }
    expect(weeklyLootSpecFitsItem('warrior', 'fury', onehand)).toBe(true);
    expect(weeklyLootSpecFitsItem('warrior', 'fury', twohand)).toBe(true);
    expect(weeklyLootSpecFitsItem('rogue', 'combat', onehand)).toBe(true);
    expect(weeklyLootSpecFitsItem('rogue', 'combat', twohand)).toBe(false);
  });

  it('isolates each spell and healing stat from authored item identity and class filtering', () => {
    const neutral: ItemDef = {
      id: 'stat_test_neck',
      name: 'Test',
      kind: 'armor',
      slot: 'neck',
      sellValue: 0,
    };
    for (const item of [
      { ...neutral, stats: { int: 1 } },
      { ...neutral, spellPower: 1 },
    ]) {
      expect(weeklyLootSpecFitsItem('mage', 'fire', item)).toBe(true);
      expect(weeklyLootSpecFitsItem('paladin', 'holy', item)).toBe(true);
      for (const [cls, spec] of [
        ['paladin', 'protection'],
        ['paladin', 'retribution'],
        ['shaman', 'enhancement'],
        ['warrior', 'prot'],
        ['druid', 'feral'],
      ] as const)
        expect(weeklyLootSpecFitsItem(cls, spec, item), `${cls}:${spec}`).toBe(false);
    }
    const healing = { ...neutral, healPower: 1 };
    for (const stat of ['str', 'agi'] as const) {
      const physical = { ...neutral, stats: { [stat]: 1 } };
      for (const [cls, spec] of [
        ['paladin', 'holy'],
        ['shaman', 'elemental'],
        ['shaman', 'restoration'],
        ['druid', 'balance'],
        ['druid', 'restoration'],
      ] as const)
        expect(weeklyLootSpecFitsItem(cls, spec, physical), `${cls}:${spec}:${stat}`).toBe(false);
      expect(weeklyLootSpecFitsItem('druid', 'feral', physical)).toBe(true);
    }
    expect(weeklyLootSpecFitsItem('paladin', 'holy', healing)).toBe(true);
    for (const [cls, spec] of [
      ['mage', 'fire'],
      ['paladin', 'protection'],
      ['paladin', 'retribution'],
      ['shaman', 'enhancement'],
      ['warrior', 'prot'],
      ['druid', 'feral'],
    ] as const)
      expect(weeklyLootSpecFitsItem(cls, spec, healing), `${cls}:${spec}`).toBe(false);
    // Test the two spell-stat branches independently: either one needs hybrid permission.
    for (const mixed of [
      { ...neutral, stats: { str: 1, int: 1 } },
      { ...neutral, stats: { str: 1 }, spellPower: 1 },
    ]) {
      for (const [cls, spec] of [
        ['paladin', 'protection'],
        ['paladin', 'retribution'],
        ['shaman', 'enhancement'],
      ] as const) {
        expect(weeklyLootSpecFitsItem(cls, spec, mixed), `${cls}:${spec}`).toBe(true);
        expect(
          weeklyLootSpecFitsItem(cls, spec, { ...mixed, healPower: 1 }),
          `${cls}:${spec}`,
        ).toBe(false);
      }
      for (const [cls, spec] of [
        ['warrior', 'prot'],
        ['druid', 'feral'],
        ['mage', 'fire'],
        ['paladin', 'holy'],
      ] as const)
        expect(weeklyLootSpecFitsItem(cls, spec, mixed), `${cls}:${spec}`).toBe(false);
    }
  });

  it('isolates worn offhand eligibility from stat, class, and weapon restrictions', () => {
    const held: ItemDef = {
      id: 'offhand_test',
      name: 'Test',
      kind: 'held_offhand',
      slot: 'offhand',
      sellValue: 0,
    };
    const worn: ItemDef = { ...held, occupiesHand: false as const };
    for (const spec of ['beast_mastery', 'marksmanship', 'survival']) {
      expect(weeklyLootSpecFitsItem('hunter', spec, held)).toBe(false);
      expect(weeklyLootSpecFitsItem('hunter', spec, worn)).toBe(true);
    }
    expect(weeklyLootSpecFitsItem('paladin', 'protection', held)).toBe(false);
    expect(weeklyLootSpecFitsItem('paladin', 'holy', held)).toBe(true);
  });

  it.each(['beast_mastery', 'marksmanship', 'survival'])(
    'retains worn quivers for Hunter %s across Normal and Heroic reward sources',
    (spec) => {
      for (const id of [
        'direfang_quiver',
        'heroic_direfang_quiver',
        'gravewyrm_bone_quiver',
        'heroic_gravewyrm_bone_quiver',
      ]) {
        expect(accepts('hunter', spec, id), id).toBe(true);
      }
      expect(weeklyLootPool('world', 'hunter', undefined, spec)).toContain('direfang_quiver');
      expect(
        weeklyBossLootPool('nythraxis_scourge_of_thornpeak', 'raid', 'hunter', spec),
      ).toContain('direfang_quiver');
      expect(
        weeklyBossLootPool('nythraxis_scourge_of_thornpeak', 'raid_heroic', 'hunter', spec),
      ).toContain('heroic_direfang_quiver');
      expect(weeklyBossLootPool('korzul_the_gravewyrm', 'dungeon', 'hunter', spec)).toContain(
        'gravewyrm_bone_quiver',
      );
      expect(
        weeklyBossLootPool('korzul_the_gravewyrm', 'dungeon_heroic', 'hunter', spec),
      ).toContain('heroic_gravewyrm_bone_quiver');
      const heldQuiver: ItemDef = { ...ITEMS.direfang_quiver, occupiesHand: undefined } as ItemDef;
      expect(weeklyLootSpecFitsItem('hunter', spec, heldQuiver)).toBe(false);
    },
  );

  it.each(SPEC_CASES)(
    '%s %s gets its set and suitable trinket, excluding the other role',
    (cls, spec, set, good, bad) => {
      expect(accepts(cls, spec, set)).toBe(true);
      expect(accepts(cls, spec, good)).toBe(true);
      expect(accepts(cls, spec, bad)).toBe(false);
      expect(accepts(cls, spec, 'sundered_prism')).toBe(true);
    },
  );

  it('covers the complete live specialization identity registry without extra profiles', () => {
    const live = Object.entries(TALENTS)
      .flatMap(([cls, tree]) => tree.specs.map((s) => `${cls}:${s.id}`))
      .sort();
    expect(SPEC_CASES.map(([cls, spec]) => `${cls}:${spec}`).sort()).toEqual(live);
    expect(
      Object.entries(WEEKLY_LOOT_PROFILES)
        .flatMap(([cls, profiles]) => Object.keys(profiles).map((spec) => `${cls}:${spec}`))
        .sort(),
    ).toEqual(live);
    for (const [cls, spec] of SPEC_CASES) {
      expect(weeklyLootSpecForClass(cls, spec)).toBe(spec);
      expect(sanitizeWeeklyLootSpec(spec)).toBe(spec);
    }
  });

  it('drops invalid saved identities and refuses foreign-class focus instead of broadening loot', () => {
    for (const raw of [null, '', 'all', 'constructor', '__proto__', 'unknown', {}, [], 1]) {
      expect(sanitizeWeeklyLootSpec(raw)).toBeUndefined();
      expect(weeklyLootSpecForClass('paladin', raw)).toBeUndefined();
    }
    expect(sanitizeWeeklyLootSpec('prot')).toBe('prot');
    expect(weeklyLootSpecForClass('paladin', 'prot')).toBeUndefined();
    expect(weeklyLootSpecFitsItem('paladin', 'prot', ITEMS.bastion_sigil)).toBe(false);
    expect(weeklyLootSpecFitsItem('mage', 'constructor', ITEMS.echoing_lens)).toBe(false);
  });

  it('leaves all-class mode exactly at the existing class filter for every item', () => {
    for (const cls of Object.keys(TALENTS) as PlayerClass[]) {
      for (const item of Object.values(ITEMS)) {
        expect(weeklyLootSpecFitsItem(cls, undefined, item), `${cls}:${item.id}`).toBe(true);
      }
    }
  });

  it('assigns every raid set exactly once and excludes other specs even when the stats match', () => {
    const sets = Object.values(IGNIVAR_SET_ITEMS).map((item) => item.set);
    const owned = Object.values(WEEKLY_LOOT_PROFILES).flatMap((profiles) =>
      Object.values(profiles).flatMap((p) => p.sets),
    );
    expect(new Set(owned).size).toBe(owned.length);
    expect([...new Set(sets)].sort()).toEqual([...owned].sort());
    for (const item of Object.values(IGNIVAR_SET_ITEMS)) {
      const eligible = SPEC_CASES.filter(([cls, spec]) => accepts(cls, spec, item.id));
      expect(eligible, item.id).toHaveLength(1);
    }
    expect(accepts('mage', 'fire', 'frostquench_helmet')).toBe(false);
    expect(accepts('priest', 'holy', 'emberscreed_helmet')).toBe(false);
  });

  it('respects every Season 2 set owner instead of deriving spec from matching stats', () => {
    expect(SEASON2_SETS).toHaveLength(SPEC_CASES.length);
    for (const set of SEASON2_SETS) {
      for (const id of set.itemIds) {
        for (const [cls, spec] of SPEC_CASES) {
          expect(accepts(cls, spec, id), `${cls}:${spec}:${id}`).toBe(
            set.cls === cls && set.spec === spec,
          );
        }
      }
    }
  });

  it('keeps the tank and physical branches of Feral and Warspirit available together', () => {
    for (const id of [
      'wildfang_emberhide_helmet',
      'cinderbark_helmet',
      'cinderbark_cinch',
      'slagstalker_belt',
      'heart_of_the_crucible',
      'paired_talons',
    ]) {
      expect(accepts('druid', 'feral', id), id).toBe(true);
    }
    for (const id of [
      'warspirit_emberscale_helmet',
      'stonehearth_helmet',
      'forgewall_girdle',
      'warforged_waistguard',
      'heart_of_the_crucible',
      'paired_talons',
    ]) {
      expect(accepts('shaman', 'enhancement', id), id).toBe(true);
    }
  });

  it('distinguishes authored tank pieces from damage pieces despite shared Strength and Stamina', () => {
    for (const id of [
      'forgewall_girdle',
      'anvilstance_sabatons',
      'pendant_of_the_first_tempering',
      'seal_of_the_forgewall',
      'anvilguard_blade',
      'bulwark_of_the_inner_crucible',
    ]) {
      expect(accepts('paladin', 'protection', id), id).toBe(true);
      expect(accepts('paladin', 'retribution', id), id).toBe(false);
    }
    for (const id of [
      'warforged_waistguard',
      'furnace_march_greaves',
      'ignivars_ember_choker',
      'band_of_marked_strikes',
      'forgefathers_warhammer',
    ]) {
      expect(accepts('paladin', 'protection', id), id).toBe(false);
      expect(accepts('paladin', 'retribution', id), id).toBe(true);
    }
    for (const id of Object.keys(WEEKLY_LOOT_ITEM_ROLES)) expect(ITEMS[id], id).toBeDefined();
  });

  it('enforces weapon and offhand style while retaining unrestricted Fury and Hunter hands', () => {
    expect(accepts('warrior', 'arms', 'heart_of_the_end_greatblade')).toBe(true);
    expect(accepts('warrior', 'arms', 'forgefathers_warhammer')).toBe(false);
    expect(accepts('warrior', 'fury', 'heart_of_the_end_greatblade')).toBe(true);
    expect(accepts('warrior', 'fury', 'forgefathers_warhammer')).toBe(true);
    expect(accepts('warrior', 'prot', 'heart_of_the_end_greatblade')).toBe(false);
    expect(accepts('paladin', 'protection', 'heart_of_the_end_greatblade')).toBe(false);
    expect(accepts('paladin', 'protection', 'orb_of_the_last_spring')).toBe(false);
    expect(accepts('paladin', 'holy', 'ember_wardens_barrier')).toBe(true);
    expect(accepts('paladin', 'protection', 'ember_wardens_barrier')).toBe(false);
    expect(accepts('rogue', 'combat', 'heart_of_the_end_greatblade')).toBe(false);
    expect(accepts('hunter', 'marksmanship', 'heart_of_the_end_greatblade')).toBe(true);
    expect(accepts('hunter', 'marksmanship', 'cinderfang_kris')).toBe(true);
  });

  it('lets healers use Spell Power but excludes healing-only gear from damage focuses', () => {
    expect(accepts('mage', 'arcane', 'forgefire_spire')).toBe(true);
    expect(accepts('mage', 'arcane', 'staff_of_the_last_spring')).toBe(true);
    expect(accepts('mage', 'fire', 'staff_of_the_last_spring')).toBe(false);
    expect(accepts('druid', 'restoration', 'moonscorch_waistwrap')).toBe(true);
    expect(accepts('druid', 'balance', 'grovetender_belt')).toBe(false);
    expect(accepts('shaman', 'elemental', 'forgewall_girdle')).toBe(false);
    expect(accepts('shaman', 'enhancement', 'stormkindled_chain')).toBe(false);
  });

  it('shares neutral leveling gear and preserves useful mixed Holy/melee stats', () => {
    const neutral: ItemDef = {
      id: 'test_neck',
      name: 'Test',
      kind: 'armor',
      slot: 'neck',
      sellValue: 0,
      stats: { sta: 4 },
    };
    for (const [cls, spec] of SPEC_CASES)
      expect(weeklyLootSpecFitsItem(cls, spec, neutral)).toBe(true);
    const holyTank: ItemDef = { ...neutral, stats: { str: 4, int: 2, sta: 4 }, spellPower: 3 };
    expect(weeklyLootSpecFitsItem('paladin', 'protection', holyTank)).toBe(true);
    expect(weeklyLootSpecFitsItem('paladin', 'retribution', holyTank)).toBe(true);
    expect(weeklyLootSpecFitsItem('shaman', 'enhancement', holyTank)).toBe(true);
    expect(weeklyLootSpecFitsItem('paladin', 'holy', holyTank)).toBe(false);
    expect(weeklyLootSpecFitsItem('druid', 'feral', holyTank)).toBe(false);
    expect(weeklyLootSpecFitsItem('paladin', 'protection', { ...holyTank, healPower: 2 })).toBe(
      false,
    );
  });

  it('classifies all trinkets and keeps unknown mechanics out of focused rolls', () => {
    for (const item of Object.values(TRINKET_ITEMS)) {
      expect(
        SPEC_CASES.some(([cls, spec]) => accepts(cls, spec, item.id)),
        item.id,
      ).toBe(true);
    }
    const unknown: ItemDef = { ...ITEMS.bastion_sigil, id: 'unknown_trinket' };
    expect(weeklyLootSpecFitsItem('warrior', 'prot', unknown)).toBe(false);
    expect(weeklyLootSpecFitsItem('warrior', undefined, unknown)).toBe(true);
    expect(accepts('mage', 'arcane', 'echoing_lens')).toBe(true);
    expect(accepts('mage', 'fire', 'echoing_lens')).toBe(true);
    expect(accepts('paladin', 'protection', 'echoing_lens')).toBe(false);
  });

  it('uses the same suitability for every shipped heroic variant and its base', () => {
    const heroic = Object.values(ITEMS).filter((item) => item.heroicOf);
    expect(heroic.length).toBeGreaterThan(20);
    for (const item of heroic) {
      for (const [cls, spec] of SPEC_CASES) {
        expect(weeklyLootSpecFitsItem(cls, spec, item), `${cls}:${spec}:${item.id}`).toBe(
          weeklyLootSpecFitsItem(cls, spec, ITEMS[item.heroicOf!]),
        );
      }
    }
    const heroicTank = {
      ...ITEMS.seal_of_the_forgewall,
      id: 'test_heroic_ring',
      heroicOf: 'seal_of_the_forgewall',
    };
    expect(weeklyLootSpecFitsItem('paladin', 'protection', heroicTank)).toBe(true);
    expect(weeklyLootSpecFitsItem('paladin', 'retribution', heroicTank)).toBe(false);
  });
});
