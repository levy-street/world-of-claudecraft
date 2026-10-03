// The Gravewyrm Sanctum rework's loot (docs/design/dungeon-rework/
// gravewyrm_sanctum.md section 9; items in src/sim/content/
// gravewyrm_sanctum_items.ts, trinkets in content/trinkets.ts): Korgath and
// Velkhar each pay a guaranteed piece of their own archetype trio on a normal
// kill (Korzul keeps the shipped trio), and every heroic partition carries the
// design's new epic or trinket at its design weight, the shipped rows keeping
// their ratios. Stat lines are checked against the budget formulas.
import { describe, expect, it } from 'vitest';
import { GRAVEWYRM_SANCTUM_ITEMS } from '../src/sim/content/gravewyrm_sanctum_items';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';

const HEAVY = ['warrior', 'paladin', 'shaman'];
const AGILE = ['rogue', 'hunter'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'];

const TRIOS = {
  korgath_the_bound: {
    group: 'korgath_guaranteed_uncommon',
    ids: ['foremans_grips', 'serac_stride_boots', 'seal_rune_mantle'],
  },
  grand_necromancer_velkhar: {
    group: 'velkhar_guaranteed_uncommon',
    ids: ['thawbound_legguards', 'pyre_tenders_hood', 'meltwater_cord'],
  },
  korzul_the_gravewyrm: {
    group: 'korzul_guaranteed_uncommon',
    ids: ['boneplate_vest', 'revenant_silk_robe', 'nightwalk_jerkin'],
  },
} as const;

/** The design weights (9.2) of the new heroic rows, and the share the shipped
 *  partition keeps. */
const HEROIC = {
  korgath_the_bound: {
    group: 'korgath_the_bound_heroic',
    fresh: { foremans_last_link: 0.2, hammer_of_the_open_lock: 0.25 },
    shipped: 0.55,
    anchor: ['boneplate_vest', 'zealotsbane_blade'],
  },
  grand_necromancer_velkhar: {
    group: 'grand_necromancer_velkhar_heroic',
    fresh: { phial_of_the_tithe: 0.2, vestments_of_the_waking_rite: 0.25 },
    shipped: 0.55,
    anchor: ['boneplate_vest', 'emberwood_staff'],
  },
  korzul_the_gravewyrm: {
    group: 'korzul_heroic',
    fresh: { quenchwater_flask: 0.15 },
    shipped: 0.85,
    anchor: ['boneplate_vest', 'cultist_flayer'],
  },
} as const;

describe('Gravewyrm Sanctum rework: normal boss tables', () => {
  it.each(Object.entries(TRIOS))(
    '%s drops one guaranteed piece of its own trio, Heavy 0.34 / Agile 0.33 / Caster 0.33',
    (bossId, { group, ids }) => {
      const rows = MOBS[bossId].loot.filter((entry) => entry.rollGroup === group);
      expect(rows.map((entry) => [entry.itemId, entry.chance])).toEqual([
        [ids[0], 0.34],
        [ids[1], 0.33],
        [ids[2], 0.33],
      ]);
      expect(rows.every((entry) => entry.normalOnly === true)).toBe(true);
      // The two new trios are archetype-gated (Korzul's shipped trio predates
      // the archetype groups and keeps its own gates).
      if (bossId !== 'korzul_the_gravewyrm')
        expect(ids.map((id) => ITEMS[id].requiredClass)).toEqual([HEAVY, AGILE, CASTER]);
    },
  );

  it('no two Sanctum bosses share a guaranteed trio any more', () => {
    const korgath = new Set<string>(TRIOS.korgath_the_bound.ids);
    const velkhar = new Set<string>(TRIOS.grand_necromancer_velkhar.ids);
    for (const id of TRIOS.korzul_the_gravewyrm.ids) {
      expect(korgath.has(id)).toBe(false);
      expect(velkhar.has(id)).toBe(false);
    }
  });

  it('every new piece sits on its item level and its exact stat budget', () => {
    for (const [id, item] of Object.entries(GRAVEWYRM_SANCTUM_ITEMS)) {
      expect(ITEMS[id], id).toBe(item);
      expect(itemLevel(item), id).toBe(item.quality === 'epic' ? 31 : 21);
      expect(primaryStatSum(item), id).toBe(expectedStatBudget(item));
    }
  });
});

describe('Gravewyrm Sanctum rework: heroic partitions', () => {
  it.each(Object.entries(HEROIC))(
    '%s pays its new rows at the design weights, the shipped rows keeping their ratios',
    (bossId, { group, fresh, shipped, anchor }) => {
      const rows = HEROIC_BOSS_LOOT[bossId].filter((entry) => entry.rollGroup === group);
      const chance = (id: string) => rows.find((entry) => entry.itemId === id)?.chance ?? 0;
      for (const [id, weight] of Object.entries(fresh)) {
        expect(chance(id), id).toBeCloseTo(weight, 9);
        expect(ITEMS[id]?.quality, id).toBe('epic');
      }
      const total = rows.reduce((sum, entry) => sum + entry.chance, 0);
      expect(total).toBeCloseTo(1, 9);
      const freshIds = new Set(Object.keys(fresh));
      const shippedTotal = rows
        .filter((entry) => !freshIds.has(entry.itemId ?? ''))
        .reduce((sum, entry) => sum + entry.chance, 0);
      expect(shippedTotal).toBeCloseTo(shipped, 9);
      // The shipped ratio between two of its rows is unchanged.
      const [a, b] = anchor;
      const shippedRatio: Record<string, number> = {
        korgath_the_bound: 0.34 / 0.19,
        grand_necromancer_velkhar: 0.34 / 0.2,
        korzul_the_gravewyrm: 0.34 / 0.1,
      };
      expect(chance(a) / chance(b)).toBeCloseTo(shippedRatio[bossId], 9);
    },
  );
});
