// Itemization gap fill: pins the class/spec coverage this change adds so the
// gaps cannot silently return. Before it, leather caster armor was two pieces
// in the whole game (a druid balance/restoration player was forced into
// cloth), mail caster had no leveling line below item level 23 (holy paladin
// and elemental/restoration shaman had no on-weight options), and no
// two-handed feral weapon existed above item level 16. The pins below are
// decisive about the new pieces (exact ids, item levels, and budgets) and use
// existence predicates over the whole table for the per-band coverage, so
// future additions grow the table without breaking the pins.
import { describe, expect, it } from 'vitest';
import { DUNGEONS, ITEMS, MOBS } from '../src/sim/data';
import { canEquipItem, isShieldItem, weaponArchetypeForItem } from '../src/sim/equipment_rules';
import { weaponDpsBudget } from '../src/sim/item_budget';
import {
  expectedStatBudget,
  itemLevel,
  itemSourceLevel,
  primaryStatSum,
  TWOHAND_DPS_MULT,
} from '../src/sim/item_level';
import type { ItemDef, PlayerClass } from '../src/sim/types';

// Every item this change ships, with the item level its acquisition source
// derives (source level + the quality bump + the raid bonus for Nythraxis).
const NEW_ITEMS: ReadonlyArray<readonly [string, number]> = [
  // Druid caster leather line (int/spi, one piece per armor slot ladder).
  ['mosshide_vest', 5],
  ['thornling_grips', 7],
  ['fenbark_leggings', 11],
  ['mirebloom_treads', 11],
  ['duskthorn_mantle', 13],
  ['wildgrove_cinch', 15],
  ['moonbark_vestments', 18],
  ['stormroot_cowl', 20],
  ['thornpeak_wildwraps', 22],
  ['cryptbloom_shoulderguards', 23],
  ['vestments_of_the_waking_grove', 26],
  // Shaman/paladin caster mail leveling line (int/spi).
  ['acolyte_chain_grips', 5],
  ['votive_chain_belt', 7],
  ['fenwarden_sabatons', 11],
  ['marshlight_hauberk', 13],
  ['cragward_pauldrons', 15],
  ['stormchant_gauntlets', 17],
  ['peaksong_helm', 18],
  ['thunderward_legguards', 20],
  ['stormvotive_hauberk', 22],
  // The 17-22 band padding: cloth caster and leather melee.
  ['tidehymn_slippers', 17],
  ['cragprowl_belt', 17],
  ['revenantstep_treads', 20],
  ['shardfang_grips', 21],
  ['shardsong_mantle', 22],
  ['wyrmcult_spellgrips', 22],
  // The int/spi shield and the low-level held offhand.
  ['pearlward_aegis', 19],
  ['valefire_lantern', 7],
  // Endgame leather caster line (instanced sources, ilvl 26 and 31).
  ['wildgrowth_leggings', 26],
  ['grovewardens_grips', 26],
  ['verdant_walkers', 26],
  ['lunarward_cinch', 31],
  ['dreamroot_boots', 31],
  ['stormbark_mantle', 31],
];

// The feral two-handed ladder: druid-only weapons with real 2H dps plus
// str/agi/sta, from the zone-1 rare elite up to the raid boss.
const FERAL_LADDER: ReadonlyArray<readonly [string, number]> = [
  ['briarroot_staff', 8],
  ['fenshadow_maul', 13],
  ['cragthorn_greatstaff', 17],
  ['gravewyrm_thornmaul', 23],
  ['nightfangs_greatstaff', 26],
  ['maul_of_the_scourged_wilds', 29],
  ['wildsoul_maul', 31],
];

const ALL_NEW_IDS = [...NEW_ITEMS, ...FERAL_LADDER].map(([id]) => id);

// Item-level bands matching the zone/dungeon tiers: zone1, zone2, the zone3
// approach, the 17-22 zone3 band, and the dungeon/raid endgame.
const BANDS: ReadonlyArray<readonly [number, number]> = [
  [1, 7],
  [8, 13],
  [14, 16],
  [17, 22],
  [23, 31],
];

function authoredCasterPieces(
  armorType: 'cloth' | 'leather' | 'mail',
  cls: PlayerClass,
  minIlvl: number,
  maxIlvl: number,
): ItemDef[] {
  return Object.values(ITEMS).filter((item) => {
    if (item.heroicOf) return false; // generated variants: pin authored coverage
    if (item.kind !== 'armor' || item.armorType !== armorType) return false;
    if ((item.stats?.int ?? 0) <= 0 || (item.stats?.spi ?? 0) <= 0) return false;
    const level = itemLevel(item);
    if (level === undefined || level < minIlvl || level > maxIlvl) return false;
    return canEquipItem(cls, item);
  });
}

describe('itemization coverage: every new item is sourced, leveled, and on budget', () => {
  it('has all 41 new items in the merged table', () => {
    expect(ALL_NEW_IDS.length).toBe(41);
    expect(new Set(ALL_NEW_IDS).size).toBe(41);
    for (const id of ALL_NEW_IDS) expect(ITEMS[id], id).toBeTruthy();
  });

  it.each(ALL_NEW_IDS)('%s: derives its pinned item level from a real acquisition source', (id) => {
    const pinned = [...NEW_ITEMS, ...FERAL_LADDER].find(([itemId]) => itemId === id)?.[1];
    const item = ITEMS[id];
    expect(itemSourceLevel(id), `${id} has a loot/quest source`).not.toBeUndefined();
    expect(itemLevel(item), `${id} item level`).toBe(pinned);
  });

  it.each(ALL_NEW_IDS)('%s: carries exactly its item-level stat budget', (id) => {
    const item = ITEMS[id];
    const budget = expectedStatBudget(item);
    expect(budget, `${id} has a derivable budget`).not.toBeUndefined();
    expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(budget);
  });
});

describe('itemization coverage: the druid caster leather line', () => {
  it('gives druid an on-weight (leather) int/spi option in every item-level band', () => {
    for (const [min, max] of BANDS) {
      const pieces = authoredCasterPieces('leather', 'druid', min, max);
      expect(pieces.length, `leather caster piece in band ${min}-${max}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('covers all seven armor slots across the line', () => {
    const slots = new Set(authoredCasterPieces('leather', 'druid', 1, 40).map((item) => item.slot));
    for (const slot of ['chest', 'legs', 'helmet', 'shoulder', 'waist', 'gloves', 'feet']) {
      expect(slots.has(slot as ItemDef['slot']), `leather caster ${slot}`).toBe(true);
    }
  });

  it('keeps the line on-weight: every new leather piece equips on a druid', () => {
    const leatherIds = [
      'mosshide_vest',
      'thornling_grips',
      'fenbark_leggings',
      'mirebloom_treads',
      'duskthorn_mantle',
      'wildgrove_cinch',
      'moonbark_vestments',
      'stormroot_cowl',
      'thornpeak_wildwraps',
      'cryptbloom_shoulderguards',
      'vestments_of_the_waking_grove',
      'wildgrowth_leggings',
      'grovewardens_grips',
      'verdant_walkers',
      'lunarward_cinch',
      'dreamroot_boots',
      'stormbark_mantle',
    ];
    for (const id of leatherIds) {
      const item = ITEMS[id];
      expect(item.armorType, id).toBe('leather');
      expect(canEquipItem('druid', item), id).toBe(true);
    }
  });

  it('has an obtainable leather caster rung at item level 26 and 31', () => {
    const obtainable = Object.values(ITEMS).filter(
      (item) =>
        item.kind === 'armor' &&
        item.armorType === 'leather' &&
        (item.stats?.int ?? 0) > 0 &&
        (item.stats?.spi ?? 0) > 0 &&
        !item.heroicOf &&
        itemSourceLevel(item.id) !== undefined,
    );
    expect(obtainable.some((item) => itemLevel(item) === 26)).toBe(true);
    expect(obtainable.some((item) => itemLevel(item) === 31)).toBe(true);
  });
});

describe('itemization coverage: the shaman/paladin caster mail line', () => {
  it.each(['shaman', 'paladin'] as const)(
    'gives %s an on-weight (mail) int/spi option in every item-level band',
    (cls) => {
      for (const [min, max] of BANDS) {
        const pieces = authoredCasterPieces('mail', cls, min, max);
        expect(
          pieces.length,
          `mail caster piece for ${cls} in band ${min}-${max}`,
        ).toBeGreaterThanOrEqual(1);
      }
    },
  );

  it.each(['shaman', 'paladin'] as const)('covers all seven armor slots for %s', (cls) => {
    const slots = new Set(authoredCasterPieces('mail', cls, 1, 40).map((item) => item.slot));
    for (const slot of ['chest', 'legs', 'helmet', 'shoulder', 'waist', 'gloves', 'feet']) {
      expect(slots.has(slot as ItemDef['slot']), `mail caster ${slot} for ${cls}`).toBe(true);
    }
  });
});

describe('itemization coverage: the feral two-handed weapon ladder', () => {
  it.each(FERAL_LADDER)(
    '%s: a druid-only two-hander at item level %i on the dps curve',
    (id, ilvl) => {
      const item = ITEMS[id];
      if (item.kind !== 'weapon') throw new Error(`${id} must be a weapon`);
      expect(item.hand, id).toBe('twohand');
      expect(item.requiredClass, id).toEqual(['druid']);
      // The bespoke druid-only lock is not a proficiency group, so the archetype
      // lookup returns null and equipping falls through to the literal list.
      expect(weaponArchetypeForItem(item), id).toBeNull();
      expect(canEquipItem('druid', item), `${id} equippable by druid`).toBe(true);
      for (const denied of [
        'warrior',
        'rogue',
        'hunter',
        'mage',
        'priest',
        'shaman',
        'paladin',
        'warlock',
      ] as const) {
        expect(canEquipItem(denied, item), `${id} denied to ${denied}`).toBe(false);
      }
      // Feral stats: strength and/or agility, with real two-handed dps on the
      // weaponDpsBudget x TWOHAND_DPS_MULT curve for its item level.
      expect((item.stats?.str ?? 0) + (item.stats?.agi ?? 0), id).toBeGreaterThan(0);
      const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
      const target = weaponDpsBudget(ilvl) * TWOHAND_DPS_MULT;
      expect(
        Math.abs(dps - target),
        `${id} dps ${dps.toFixed(2)} vs ${target.toFixed(2)}`,
      ).toBeLessThan(0.35);
    },
  );

  it('ladder spans leveling through the heroic tier (7 rungs, top at item level 31)', () => {
    const ladderLevels = FERAL_LADDER.map(([, ilvl]) => ilvl);
    expect(ladderLevels).toEqual([8, 13, 17, 23, 26, 29, 31]);
    // The whole table now holds at least the ladder: a druid never again has
    // fewer than these seven two-handed feral options.
    const druidTwoHanders = Object.values(ITEMS).filter(
      (item) =>
        item.kind === 'weapon' &&
        item.hand === 'twohand' &&
        !item.heroicOf &&
        ((item.stats?.str ?? 0) > 0 || (item.stats?.agi ?? 0) > 0) &&
        canEquipItem('druid', item),
    );
    expect(druidTwoHanders.length).toBeGreaterThanOrEqual(7);
    const endgame = druidTwoHanders.filter((item) => (itemLevel(item) ?? 0) >= 23);
    expect(endgame.length, 'feral 2H options at item level 23+').toBeGreaterThanOrEqual(4);
  });
});

describe('itemization coverage: the int/spi shield and the low-level held offhand', () => {
  it('pearlward_aegis is the first caster shield (paladin + shaman only)', () => {
    const shield = ITEMS.pearlward_aegis;
    expect(isShieldItem(shield)).toBe(true);
    expect((shield.stats?.int ?? 0) > 0 && (shield.stats?.spi ?? 0) > 0).toBe(true);
    expect(canEquipItem('paladin', shield)).toBe(true);
    expect(canEquipItem('shaman', shield)).toBe(true);
    expect(canEquipItem('warrior', shield)).toBe(false);
    expect(canEquipItem('druid', shield)).toBe(false);
  });

  it('valefire_lantern opens the held-offhand slot below the epic tier', () => {
    const lantern = ITEMS.valefire_lantern;
    expect(lantern.kind).toBe('held_offhand');
    for (const cls of ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'] as const) {
      expect(canEquipItem(cls, lantern), cls).toBe(true);
    }
    expect(canEquipItem('warrior', lantern)).toBe(false);
  });
});

describe('itemization coverage: heroic variants are only built from heroic-eligible instances', () => {
  it('every heroic variant has its base in a heroic-eligible mob loot table', () => {
    const heroicInstanceIds = new Set([
      'hollow_crypt',
      'sunken_bastion',
      'drowned_temple',
      'gravewyrm_sanctum',
      'nythraxis_boss_arena',
    ]);
    const heroicEligibleMobs = new Set<string>();
    for (const def of Object.values(DUNGEONS)) {
      if (!heroicInstanceIds.has(def.id)) continue;
      for (const spawn of def.spawns) heroicEligibleMobs.add(spawn.mobId);
    }
    for (const item of Object.values(ITEMS)) {
      if (!item.heroicOf) continue;
      const baseId = item.heroicOf;
      const hasEligibleSource = Object.values(MOBS).some(
        (mob) =>
          heroicEligibleMobs.has(mob.id) &&
          (mob.loot ?? []).some((entry) => entry.itemId === baseId),
      );
      expect(
        hasEligibleSource,
        `${item.id} (base ${baseId}) drops in a heroic-eligible instance`,
      ).toBe(true);
    }
  });
});
