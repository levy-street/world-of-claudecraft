import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { bestEpicGearFor, equipBestInSlotForDev } from '../src/sim/dev/bis_gear';
import { canEquipItemInSlot, MASTERWROUGHT_EQUIP_CAP } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import type { EquipSlot, ItemDef } from '../src/sim/types';

// /dev bis: the one-shot best-in-slot outfit for level-cap playtesting.

describe('dev bis gear', () => {
  it('picks a legal epic for every coverable slot, deterministically', () => {
    const first = bestEpicGearFor('rogue', 'assassination');
    const second = bestEpicGearFor('rogue', 'assassination');
    expect(second).toEqual(first);
    const entries = Object.entries(first) as [EquipSlot, string][];
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const [slot, id] of entries) {
      const item = ITEMS[id];
      expect(item?.quality).toBe('epic');
      expect(canEquipItemInSlot('rogue', item, slot, 'assassination')).toBe(true);
    }
    // No duplicate piece across slots (ring1/ring2 must differ).
    expect(new Set(entries.map(([, id]) => id)).size).toBe(entries.length);
  });

  it('gives dagger specs a dagger mainhand and dual-wields two one-handers', () => {
    // A spec-less rogue must also get a dagger (Craven Thrust and the openers
    // require one; only committed Thuggery trades it away).
    const specless = bestEpicGearFor('rogue', null);
    const speclessMh = ITEMS[specless.mainhand ?? ''];
    expect(speclessMh?.kind === 'weapon' && speclessMh.weapon?.dagger === true).toBe(true);
    const knifework = bestEpicGearFor('rogue', 'assassination');
    const knifeMh = ITEMS[knifework.mainhand ?? ''];
    expect(knifeMh?.kind === 'weapon' && knifeMh.weapon?.dagger === true).toBe(true);
    expect(knifework.offhand).toBeDefined();
    const thuggery = bestEpicGearFor('rogue', 'combat');
    const thugMh = ITEMS[thuggery.mainhand ?? ''];
    expect(thugMh?.kind === 'weapon' && thugMh.hand !== 'twohand').toBe(true);
    expect(thuggery.offhand).toBeDefined();
  });

  it('equips the caller and raises their attack power', () => {
    const sim = new Sim({ seed: 5, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('assassination')).toBe(true);
    const before = sim.player.stats.agi + sim.player.stats.sta;
    const equipped = equipBestInSlotForDev(
      (sim as unknown as { ctx: Parameters<typeof equipBestInSlotForDev>[0] }).ctx,
      sim.player.id,
    );
    expect(equipped).toBeGreaterThanOrEqual(8);
    expect(sim.player.stats.agi + sim.player.stats.sta).toBeGreaterThan(before);
    expect(sim.player.hp).toBe(sim.player.maxHp);
  });
});

describe('dev bis gear: Masterwrought cap (phase 08)', () => {
  const CLASSES = [
    'warrior',
    'paladin',
    'hunter',
    'rogue',
    'priest',
    'shaman',
    'mage',
    'warlock',
    'druid',
  ] as const;

  it('every class outfit stays inside the counted-family cap', () => {
    // equipBestInSlotForDev writes equipment directly and never runs
    // masterwroughtConflictSlot, so the picker itself must hold the cap.
    // FORWARD NET, not present-tense coverage: against the shipped catalog
    // every class picks ZERO flagged pieces today (the score ignores
    // ratings, so apex pieces tie their references and the tiebreak
    // decides), so this sweep asserts 0 <= cap at rest; the synthetic
    // demotion arm below carries the live coverage of the cap arm itself.
    for (const cls of CLASSES) {
      const picks = bestEpicGearFor(cls, null);
      const flagged = Object.values(picks).filter((id) => id && ITEMS[id]?.masterwrought);
      expect(
        flagged.length,
        `${cls} dev bis exceeds the Masterwrought cap: ${flagged.join(', ')}`,
      ).toBeLessThanOrEqual(MASTERWROUGHT_EQUIP_CAP);
    }
  });

  it('demotes the lowest-scoring flagged pick and refills the slot (synthetic over-cap)', () => {
    // The shipped catalog cannot push a dev outfit over the cap yet (the
    // score ignores ratings, so apex pieces tie their references), so drive
    // the demotion arm the way masterwrought_cap.test.ts drives the equip
    // rule: three synthetic flagged epics injected into the live ITEMS table
    // that out-score everything in their slots, removed afterward.
    const IDS = ['test_bis_mw_chest', 'test_bis_mw_legs', 'test_bis_mw_waist'] as const;
    const SLOTS: Record<(typeof IDS)[number], EquipSlot> = {
      test_bis_mw_chest: 'chest',
      test_bis_mw_legs: 'legs',
      test_bis_mw_waist: 'waist',
    };
    const STATS: Record<(typeof IDS)[number], number> = {
      test_bis_mw_chest: 900,
      test_bis_mw_legs: 800,
      test_bis_mw_waist: 700,
    };
    for (const id of IDS) {
      ITEMS[id] = {
        id,
        name: `Test ${id}`,
        kind: 'armor',
        armorType: 'cloth',
        slot: SLOTS[id],
        quality: 'epic',
        masterwrought: true,
        stats: { int: STATS[id] },
        sellValue: 1,
      } as ItemDef;
    }
    try {
      const picks = bestEpicGearFor('mage', null);
      // The two cap-highest scoring flagged picks stay; the waist (lowest
      // synthetic score) demotes and its slot refills with a real, unflagged
      // epic rather than emptying.
      expect(picks.chest).toBe('test_bis_mw_chest');
      expect(picks.legs).toBe('test_bis_mw_legs');
      expect(picks.waist).toBeTruthy();
      expect(picks.waist).not.toBe('test_bis_mw_waist');
      expect(ITEMS[picks.waist as string]?.masterwrought).toBeFalsy();
      const flagged = Object.values(picks).filter((id) => id && ITEMS[id]?.masterwrought);
      expect(flagged.length).toBe(MASTERWROUGHT_EQUIP_CAP);
    } finally {
      for (const id of IDS) delete ITEMS[id];
    }
  });
});
