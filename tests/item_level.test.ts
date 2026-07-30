import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import {
  RIFT_EPIC_ITEM_IDS,
  RIFT_LEGENDARY_ITEM_IDS,
  RIFT_RARE_ITEM_IDS,
} from '../src/sim/content/rift/items';
import { ITEMS, MOBS } from '../src/sim/data';
import {
  expectedStatBudget,
  itemFromRaid,
  itemLevel,
  itemScore,
  itemSourceLevel,
  normalizePrimaryStats,
  PRIMARY_STATS,
  primaryStatBudget,
  primaryStatSum,
  RAID_ILVL_BONUS,
  RIFT_CLEAR_LOOT_SOURCE_LEVEL,
  RIFT_LEGENDARY_LOOT_SOURCE_LEVEL,
  resetItemLevelCache,
} from '../src/sim/item_level';

// The showcase tiers wired up in src/sim/content/items.ts: two trios, each one
// piece per archetype, dropping from the same place so they share an item level.
const CHEST_TRIO = ['hollowbone_hauberk', 'gravewoven_raiment', 'cryptstalker_jerkin'];
const WEAPON_TRIO = ['gravecaller_blade', 'widowfang_dirk', 'gravecaller_staff'];

describe('item level: source derivation', () => {
  it('derives the drop level from the dropping mob band', () => {
    // The chest trio drops from the level-7 chapel rare elites.
    for (const id of CHEST_TRIO) expect(itemSourceLevel(id), id).toBe(7);
  });

  it('derives a quest reward level from its hardest kill objective (the boss)', () => {
    // The weapon trio is the q_hollow reward for slaying Morthen (level 10).
    for (const id of WEAPON_TRIO) expect(itemSourceLevel(id), id).toBe(10);
  });

  it('returns undefined for items with no drop or quest source', () => {
    // Conjured water is mage-made, never dropped or quest-granted.
    expect(itemSourceLevel('conjured_water')).toBeUndefined();
    expect(itemLevel(ITEMS.conjured_water)).toBeUndefined();
  });

  it('derives collect-gated quest reward levels from the collected item source', () => {
    // q_greyjaw collects Old Greyjaw's fang from a level-4 rare.
    expect(itemSourceLevel('greyjaw_pelt_cloak')).toBe(4);
    expect(itemLevel(ITEMS.greyjaw_pelt_cloak)).toBe(5);

    // q_stalker_pelts collects Ridge Stalker Pelts from level-14 beasts.
    expect(itemSourceLevel('ridgestalker_treads')).toBe(14);
    expect(itemLevel(ITEMS.ridgestalker_treads)).toBe(15);
  });
});

describe('item level: tier number', () => {
  it('adds the rarity bonus to the source level', () => {
    // rare = +3: chest trio 7 -> 10, weapon trio 10 -> 13.
    for (const id of CHEST_TRIO) expect(itemLevel(ITEMS[id]), id).toBe(10);
    for (const id of WEAPON_TRIO) expect(itemLevel(ITEMS[id]), id).toBe(13);
  });
});

describe('item level: stat budget formula', () => {
  it('whites carry no primary-stat budget; rarity and level raise it', () => {
    expect(primaryStatBudget(10, 'common', 'chest')).toBe(0);
    expect(primaryStatBudget(10, 'rare', 'chest')).toBe(6);
    expect(primaryStatBudget(13, 'rare', 'mainhand')).toBe(7);
    // monotonic in level and in quality for a fixed slot.
    expect(primaryStatBudget(20, 'rare', 'chest')).toBeGreaterThan(
      primaryStatBudget(10, 'rare', 'chest'),
    );
    expect(primaryStatBudget(13, 'epic', 'mainhand')).toBeGreaterThan(
      primaryStatBudget(13, 'rare', 'mainhand'),
    );
  });

  it('weights smaller slots below chest/main-hand', () => {
    expect(primaryStatBudget(13, 'rare', 'feet')).toBeLessThan(
      primaryStatBudget(13, 'rare', 'chest'),
    );
  });

  it('a sourceless / slotless item has no expected budget', () => {
    expect(expectedStatBudget(ITEMS.conjured_water)).toBeUndefined();
  });

  it('only assigns item levels and budgets to equippable combat gear', () => {
    const slotBearingTool = {
      id: 'gravecaller_blade',
      name: 'Gravecaller Tuning Fork',
      kind: 'tool',
      slot: 'mainhand',
      sellValue: 0,
    } as const;

    expect(itemSourceLevel(slotBearingTool.id)).toBe(10);
    expect(itemLevel(slotBearingTool)).toBeUndefined();
    expect(expectedStatBudget(slotBearingTool)).toBeUndefined();
  });
});

describe('item level: showcase tiers are normalized to budget', () => {
  it('every showcase item carries exactly its item-level stat budget', () => {
    for (const id of [...CHEST_TRIO, ...WEAPON_TRIO]) {
      const item = ITEMS[id];
      const budget = expectedStatBudget(item);
      expect(budget, `${id} has a derivable budget`).not.toBeUndefined();
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(budget);
    }
  });

  it('items from the same place share one item level and one budget (same tier)', () => {
    const chestLevels = new Set(CHEST_TRIO.map((id) => itemLevel(ITEMS[id])));
    const chestBudgets = new Set(CHEST_TRIO.map((id) => primaryStatSum(ITEMS[id])));
    expect(chestLevels).toEqual(new Set([10]));
    expect(chestBudgets).toEqual(new Set([6]));

    const weaponLevels = new Set(WEAPON_TRIO.map((id) => itemLevel(ITEMS[id])));
    const weaponBudgets = new Set(WEAPON_TRIO.map((id) => primaryStatSum(ITEMS[id])));
    expect(weaponLevels).toEqual(new Set([13]));
    expect(weaponBudgets).toEqual(new Set([7]));
  });

  it('normalization preserved each piece stat identity (no attribute swapped in/out)', () => {
    const ident = (id: string) =>
      PRIMARY_STATS.filter((k) => (ITEMS[id].stats?.[k] ?? 0) > 0).sort();
    expect(ident('hollowbone_hauberk')).toEqual(['sta', 'str']);
    expect(ident('gravewoven_raiment')).toEqual(['int', 'spi']);
    expect(ident('cryptstalker_jerkin')).toEqual(['agi', 'sta']);
    expect(ident('gravecaller_staff')).toEqual(['int', 'spi']);
  });
});

describe('normalizePrimaryStats', () => {
  it('scales to the exact integer budget while keeping the input ratio', () => {
    expect(normalizePrimaryStats({ str: 3, sta: 2 }, 7)).toEqual({ str: 4, sta: 3 });
    expect(normalizePrimaryStats({ int: 4, spi: 2 }, 7)).toEqual({ int: 5, spi: 2 });
    // sum is always exactly the budget.
    const out = normalizePrimaryStats({ agi: 4, sta: 2 }, 6);
    expect((out.agi ?? 0) + (out.sta ?? 0)).toBe(6);
  });

  it('only touches the attributes already present and passes armor through', () => {
    const out = normalizePrimaryStats({ armor: 38, int: 4, spi: 3 }, 6);
    expect(out.armor).toBe(38);
    expect(out.str).toBeUndefined();
    expect((out.int ?? 0) + (out.spi ?? 0)).toBe(6);
  });

  it('is deterministic (ties resolved by a stable order) and idempotent at budget', () => {
    const a = normalizePrimaryStats({ str: 1, agi: 1 }, 3);
    const b = normalizePrimaryStats({ str: 1, agi: 1 }, 3);
    expect(a).toEqual(b);
    expect((a.str ?? 0) + (a.agi ?? 0)).toBe(3);
    // re-normalizing an already-on-budget item is a no-op.
    expect(normalizePrimaryStats({ str: 4, sta: 3 }, 7)).toEqual({ str: 4, sta: 3 });
  });

  it('drops all primary stats at a zero budget but keeps armor', () => {
    expect(normalizePrimaryStats({ armor: 10, str: 3 }, 0)).toEqual({ armor: 10 });
  });
});

describe('itemScore', () => {
  it('counts primary stats, converted armor, and converted weapon dps', () => {
    // Pure stat piece: score is just the stat sum.
    expect(
      itemScore({
        id: 'x',
        name: 'x',
        kind: 'armor',
        slot: 'chest',
        armorType: 'mail',
        sellValue: 0,
        stats: { str: 4, sta: 3 },
      }),
    ).toBe(7);
    // Armor converts at ARMOR_PER_POINT (12): 24 armor -> 2 points.
    expect(
      itemScore({
        id: 'x',
        name: 'x',
        kind: 'armor',
        slot: 'chest',
        armorType: 'mail',
        sellValue: 0,
        stats: { armor: 24 },
      }),
    ).toBe(2);
    // A weapon adds dps weight, so it outscores its raw stat bonus alone.
    const blade = ITEMS.gravecaller_blade;
    expect(itemScore(blade)).toBeGreaterThan(primaryStatSum(blade));
  });
});

describe('item level: raid tier', () => {
  it('flags raid (10-player) drops and not dungeon (5-player) drops', () => {
    // Nythraxis raid loot vs Korzul 5-player dungeon loot, both from level-20 bosses.
    expect(itemFromRaid('crownforged_dreadhelm')).toBe(true);
    expect(itemFromRaid('deathless_heartwood')).toBe(true);
    expect(itemFromRaid('deathlord_warplate')).toBe(false);
    expect(itemFromRaid('boneplate_vest')).toBe(false);
  });

  it('raid loot reads a tier above same-level dungeon loot', () => {
    // Same source level (20) + same quality (epic), but the raid helmet carries the
    // raid item-level bonus, so it is exactly RAID_ILVL_BONUS above the dungeon helmet.
    const raidHelm = itemLevel(ITEMS.crownforged_dreadhelm);
    const dungeonHelm = itemLevel(ITEMS.deathlords_dread_visage);
    expect(itemSourceLevel('crownforged_dreadhelm')).toBe(20);
    expect(itemSourceLevel('deathlords_dread_visage')).toBe(20);
    expect(raidHelm).not.toBeUndefined();
    expect(dungeonHelm).not.toBeUndefined();
    if (raidHelm === undefined || dungeonHelm === undefined)
      throw new Error('raid and dungeon helmets should have item levels');
    expect(raidHelm - dungeonHelm).toBe(RAID_ILVL_BONUS);
    // ...and therefore a strictly larger stat budget for the same slot.
    const raidBudget = expectedStatBudget(ITEMS.crownforged_dreadhelm);
    const dungeonBudget = expectedStatBudget(ITEMS.deathlords_dread_visage);
    expect(raidBudget).not.toBeUndefined();
    expect(dungeonBudget).not.toBeUndefined();
    if (raidBudget === undefined || dungeonBudget === undefined)
      throw new Error('raid and dungeon helmets should have stat budgets');
    expect(raidBudget).toBeGreaterThan(dungeonBudget);
  });
});

describe('item level: heroic boss drops are budget-exact (five-mans 31, raid 33/37)', () => {
  it('every explicit heroic-table drop is at its tier item level with its exact stat budget', () => {
    // The five-man final bosses register at source level 25 (item level 31). The
    // 10-player raid boss (Heroic Nythraxis) is one tier above at source level 27:
    // its explicit table lists the three heroic-only weapons (item level 33) plus
    // the two blue mount reins secondary paths (excluded from budget sweep below).
    // Mount reins (kind 'mount') have no item level; only armor/weapon entries are
    // budget-enforced.
    const isGearEntry = (itemId: string): boolean => {
      const item = ITEMS[itemId];
      return !!item && item.kind !== 'mount';
    };
    const raidIds = new Set(
      (HEROIC_BOSS_LOOT.nythraxis_scourge_of_thornpeak ?? []).flatMap((e) =>
        e.itemId && isGearEntry(e.itemId) ? [e.itemId] : [],
      ),
    );
    expect(raidIds.size).toBe(3); // the three heroic-only raid weapons
    const ids = Object.values(HEROIC_BOSS_LOOT)
      .flat()
      .flatMap((e) => (e.itemId && isGearEntry(e.itemId) ? [e.itemId] : []));
    expect(ids.length).toBeGreaterThanOrEqual(12); // the full five-man heroic set + raid weapons
    for (const id of ids) {
      const item = ITEMS[id];
      const raid = raidIds.has(id);
      expect(item, `${id} is a real item`).toBeTruthy();
      expect(itemSourceLevel(id), `${id} source`).toBe(raid ? 27 : 25);
      expect(item.quality, id).toBe('epic');
      expect(itemLevel(item), `${id} ilvl`).toBe(raid ? 33 : 31);
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(expectedStatBudget(item));
    }
  });

  it('the raid boss set pieces and legendaries upgrade to raid-tier heroic variants (33/37)', () => {
    // These are not listed in the explicit table: they come from the normal-loot
    // heroic swap (heroic_<base>), rescaled to the raid tier (source 27).
    const raidBases = (MOBS.nythraxis_scourge_of_thornpeak?.loot ?? []).flatMap((e: any) => {
      if (!e.itemId) return [];
      const item = ITEMS[e.itemId];
      return item?.slot && (item.kind === 'armor' || item.kind === 'weapon') ? [e.itemId] : [];
    });
    expect(raidBases.length).toBeGreaterThanOrEqual(8);
    let epics = 0;
    let legendaries = 0;
    for (const base of raidBases) {
      const variant = ITEMS[`heroic_${base}`];
      expect(variant, `heroic_${base} exists`).toBeTruthy();
      expect(itemSourceLevel(variant.id), `${variant.id} source`).toBe(27);
      if (variant.quality === 'legendary') {
        legendaries++;
        expect(itemLevel(variant), `${variant.id} ilvl`).toBe(37);
      } else {
        epics++;
        expect(variant.quality, variant.id).toBe('epic');
        expect(itemLevel(variant), `${variant.id} ilvl`).toBe(33);
      }
      expect(primaryStatSum(variant), `${variant.id} stat sum == budget`).toBe(
        expectedStatBudget(variant),
      );
    }
    expect(epics + legendaries).toBe(raidBases.length);
    expect(legendaries).toBe(2); // Deathless Heartwood + Kingsbane, Last Oath
  });
});

describe('item level: every level-20 item is balanced to budget', () => {
  it('all level-20 gear carries exactly its item-level stat budget', () => {
    const offBudget: string[] = [];
    let checked = 0;
    for (const id of Object.keys(ITEMS)) {
      const item = ITEMS[id];
      if (!item.slot || itemSourceLevel(id) !== 20) continue;
      checked++;
      if (primaryStatSum(item) !== expectedStatBudget(item)) {
        offBudget.push(`${id}: have ${primaryStatSum(item)}, want ${expectedStatBudget(item)}`);
      }
    }
    expect(checked).toBeGreaterThan(30); // the full endgame set
    expect(offBudget, offBudget.join('\n')).toEqual([]);
  });

  it('level-20 items of the same item level + slot + hand share one budget', () => {
    const groups = new Map<string, Set<number>>();
    for (const id of Object.keys(ITEMS)) {
      const item = ITEMS[id];
      if (!item.slot || itemSourceLevel(id) !== 20) continue;
      const hand = item.kind === 'weapon' && item.hand === 'twohand' ? 'twohand' : 'onehand';
      const key = `${itemLevel(item)}:${item.quality}:${item.slot}:${hand}`;
      let sums = groups.get(key);
      if (!sums) {
        sums = new Set();
        groups.set(key, sums);
      }
      sums.add(primaryStatSum(item));
    }
    // No group may contain two different budgets.
    const split = [...groups.entries()].filter(([, sums]) => sums.size > 1);
    expect(split.map(([k]) => k)).toEqual([]);
  });

  it('the two legendaries are normalized to the same top-tier budget', () => {
    expect(primaryStatSum(ITEMS.deathless_heartwood)).toBe(
      primaryStatSum(ITEMS.kingsbane_last_oath),
    );
  });
});

describe('item level: purity and determinism', () => {
  it('is a pure function of the static tables across cache rebuilds', () => {
    const before = CHEST_TRIO.map((id) => [itemSourceLevel(id), itemLevel(ITEMS[id])]);
    resetItemLevelCache();
    const after = CHEST_TRIO.map((id) => [itemSourceLevel(id), itemLevel(ITEMS[id])]);
    expect(after).toEqual(before);
  });
});

describe('item level: rift gear is budget-exact (rares ilvl 26, epics ilvl 31, legendaries ilvl 37)', () => {
  it('rift world-drop rares resolve at ilvl 26 with exact budget', () => {
    // Rift mobs have maxLevel 23 (rank retune: max spawn level is 23).
    // Rare quality adds 3, so ilvl = 26.
    // The mob-loot block in buildSourceIndex registers them at source 23.
    for (const id of RIFT_RARE_ITEM_IDS) {
      const item = ITEMS[id];
      expect(item, `${id} is a real item`).toBeTruthy();
      expect(itemSourceLevel(id), `${id} source`).toBe(23);
      expect(item.quality, `${id} quality`).toBe('rare');
      expect(itemLevel(item), `${id} ilvl`).toBe(26);
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(expectedStatBudget(item));
    }
  });

  it('rift clear-time epics resolve at ilvl 31 with exact budget and a combat rating', () => {
    // Clear-time epics are registered at RIFT_CLEAR_LOOT_SOURCE_LEVEL (25).
    // Epic quality adds 6, so ilvl = 31. Each piece carries one combat rating
    // (hitRating / critRating / hasteRating) matching the heroic ilvl-31 floor.
    for (const id of RIFT_EPIC_ITEM_IDS) {
      const item = ITEMS[id];
      expect(item, `${id} is a real item`).toBeTruthy();
      expect(itemSourceLevel(id), `${id} source`).toBe(RIFT_CLEAR_LOOT_SOURCE_LEVEL);
      expect(item.quality, `${id} quality`).toBe('epic');
      expect(itemLevel(item), `${id} ilvl`).toBe(31);
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(expectedStatBudget(item));
      // Every rift epic must carry exactly one combat rating.
      const ratingCount = [item.hitRating, item.critRating, item.hasteRating].filter(
        (r) => r !== undefined && r > 0,
      ).length;
      expect(ratingCount, `${id} carries one combat rating`).toBe(1);
    }
  });

  it('every rift legendary resolves at ilvl 37 with exact budget, and is NOT a raid drop', () => {
    // The S legendaries sit a tier above the clear-time epics, at the raid SOURCE
    // level (27), so legendary quality's +10 puts them at ilvl 37. Iterated over
    // the whole pool, not just the first: the S chase is TWO independent rolls,
    // and a second legendary added off the wrong source level would be the silent
    // way to slip an over-budget chase item in.
    expect(RIFT_LEGENDARY_ITEM_IDS.length, 'the S chase is a pair').toBe(2);
    expect(RIFT_LEGENDARY_LOOT_SOURCE_LEVEL, 'one tier above the clear epics').toBe(
      RIFT_CLEAR_LOOT_SOURCE_LEVEL + 2,
    );
    for (const id of RIFT_LEGENDARY_ITEM_IDS) {
      const item = ITEMS[id];
      expect(item, `${id} is a real item`).toBeTruthy();
      expect(itemSourceLevel(id), `${id} source`).toBe(RIFT_LEGENDARY_LOOT_SOURCE_LEVEL);
      expect(item.quality, `${id} quality`).toBe('legendary');
      expect(itemLevel(item), `${id} ilvl`).toBe(37);
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(expectedStatBudget(item));
      // Sharing the raid SOURCE level must not make it read as raid loot: the two
      // are separate axes and only the level is borrowed.
      expect(itemFromRaid(id), `${id} is not a raid drop`).toBe(false);
    }
  });
});

describe('heroic set: class coverage', () => {
  it('every class can use a broad slot spread of heroic epics', () => {
    const ALL_CLASSES = [
      'warrior',
      'paladin',
      'shaman',
      'rogue',
      'hunter',
      'druid',
      'mage',
      'priest',
      'warlock',
    ] as const;
    const ids = Object.values(HEROIC_BOSS_LOOT)
      .flat()
      .flatMap((e) => (e.itemId ? [e.itemId] : []));
    for (const cls of ALL_CLASSES) {
      const slots = new Set<string>();
      for (const id of ids) {
        const it: any = ITEMS[id];
        const rc: string[] | undefined = it.requiredClass;
        if (!rc || rc.includes(cls)) slots.add(it.slot);
      }
      // Every class reaches at least five of the eight droppable slots.
      expect(slots.size, `${cls}: ${[...slots].sort().join(',')}`).toBeGreaterThanOrEqual(5);
      // Every class has at least one usable weapon.
      expect(slots.has('mainhand'), `${cls} has a weapon`).toBe(true);
    }
  });
});

describe('item level: crafted gear derives its level from the recipe (content/recipes.ts)', () => {
  // The three level-20, hub-gated caster pieces (issue #1965 review): budgeted at
  // ITEM level (recipe level 20 + the rare QUALITY_ILVL_BONUS of 3 = 23), matching
  // the level-20 rares in the same slots (boundstone_helm, gravewyrm_gauntlets,
  // gravewyrm_mantle).
  const CASTER_HUB_IDS = ['wardweave_cowl', 'duskhide_wraps', 'sootscale_mantle'];
  const CASTER_COMMON_IDS = [
    'eastbrook_ritual_vestments',
    'eastbrook_druids_hide',
    'eastbrook_warded_leggings',
  ];

  it('registers a source level for every crafted item with primary stats', () => {
    for (const id of [...CASTER_HUB_IDS, ...CASTER_COMMON_IDS]) {
      expect(itemSourceLevel(id), `${id} has a source level`).not.toBeUndefined();
      expect(itemLevel(ITEMS[id]), `${id} has an item level`).not.toBeUndefined();
    }
  });

  it('the hub caster pieces land at item level 23 and carry their exact stat budget', () => {
    for (const id of CASTER_HUB_IDS) {
      const item = ITEMS[id];
      expect(itemLevel(item), `${id} item level`).toBe(23);
      const budget = expectedStatBudget(item);
      expect(budget, `${id} has a derivable budget`).not.toBeUndefined();
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(budget);
    }
  });

  it('matches the existing level-20 rares sharing its slot (helmet 11, gloves 9, shoulder 10)', () => {
    expect(primaryStatSum(ITEMS.wardweave_cowl)).toBe(primaryStatSum(ITEMS.boundstone_helm));
    expect(primaryStatSum(ITEMS.duskhide_wraps)).toBe(primaryStatSum(ITEMS.gravewyrm_gauntlets));
    expect(primaryStatSum(ITEMS.sootscale_mantle)).toBe(primaryStatSum(ITEMS.gravewyrm_mantle));
  });
});
