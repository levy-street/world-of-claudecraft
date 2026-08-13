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

  it('every class outfit picks exactly the cap of flagged pieces', () => {
    // equipBestInSlotForDev writes equipment directly and never runs
    // masterwroughtConflictSlot, so the picker itself must hold the cap.
    // Deliberate EXACT pin, not <= cap: against the shipped phase 09 catalog
    // every class picks exactly 2 flagged pieces (2 is also the current
    // MASTERWROUGHT_EQUIP_CAP, so this sweep sits AT the boundary the cap
    // arm defends). The dev score() counts weapon dps and the raw stat bag
    // and ignores hit/crit/haste ratings, which is what lets the flagged
    // pieces win their slots. A content phase that moves a winner, or a cap
    // retune, re-acknowledges the new number here instead of drifting.
    for (const cls of CLASSES) {
      const picks = bestEpicGearFor(cls, null);
      const flagged = Object.values(picks).filter((id) => id && ITEMS[id]?.masterwrought);
      expect(flagged.length, `${cls} dev bis flagged picks: ${flagged.join(', ')}`).toBe(2);
    }
    // Warrior wears flagged pieces in BOTH hand slots. The winners are NOT
    // pinned by id (the argmax-literal-winner trap: the warblade's margin
    // over gravewyrm_cleaver is 0.46 points on ~214, so any unrelated
    // content retune flips a literal); instead the test re-derives the
    // mainhand argmax with the module's own documented scoring (weapon
    // avg x 12 / speed plus the raw stat sum, ratings invisible) over the
    // same candidate shape (epic, warrior-legal, one-handed preferred), and
    // asserts the pick IS that argmax AND flagged. Today both derive to
    // duskforged_warblade / duskforged_bulwark; a legitimate content change
    // moves the derivation with the pick, while a selection-rule regression
    // splits them.
    const devScore = (item: (typeof ITEMS)[string]): number => {
      let total = 0;
      if (item.kind === 'weapon' && item.weapon)
        total +=
          (((item.weapon.min + item.weapon.max) / 2) * 12) / Math.max(0.1, item.weapon.speed);
      for (const value of Object.values(item.stats ?? {})) total += value as number;
      return total;
    };
    const warrior = bestEpicGearFor('warrior', null);
    const mainhandPool = Object.values(ITEMS)
      .filter(
        (i) =>
          i.quality === 'epic' &&
          i.kind === 'weapon' &&
          i.hand !== 'twohand' &&
          canEquipItemInSlot('warrior', i, 'mainhand', null),
      )
      .sort((a, b) => devScore(b) - devScore(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(warrior.mainhand).toBe(mainhandPool[0].id);
    expect(ITEMS[warrior.mainhand as string].masterwrought).toBe(true);
    const offhand = ITEMS[warrior.offhand as string];
    expect(offhand.masterwrought).toBe(true);
    expect(offhand.kind === 'armor' && 'shield' in offhand && offhand.shield === true).toBe(true);
  });

  it('demotes the lowest-scoring flagged pick and refills the slot (synthetic over-cap)', () => {
    // The shipped catalog cannot push a dev outfit OVER the cap (the flagged
    // winners stop exactly at it: the exact pin above), so drive the
    // demotion arm the way masterwrought_cap.test.ts drives the equip
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

  it('re-pairs the hands after a flagged hand demotion (synthetic 2H refill)', () => {
    // The cross-hand arm: the per-slot refill re-applies slot legality but
    // not the two-hand/offhand exclusion, so a demoted flagged mainhand
    // whose only remaining refill candidate is a two-hander would stand
    // beside the offhand pick, an illegal pair the equip path would break
    // by displacement. A fake class name isolates BOTH hand pools to the
    // synthetic defs below (every real epic weapon, shield, and held
    // offhand carries a requiredClass list naming real classes only), while
    // real cloth epics still fill the armor slots.
    const CLS = 'test_bis_cls';
    const REQ = [CLS] as unknown as ItemDef['requiredClass'];
    const weaponDef = (
      id: string,
      hand: 'onehand' | 'twohand',
      dps: number,
      masterwrought: boolean,
    ): ItemDef =>
      ({
        id,
        name: `Test ${id}`,
        kind: 'weapon',
        slot: 'mainhand',
        hand,
        quality: 'epic',
        masterwrought,
        requiredClass: REQ,
        weapon: { min: dps, max: dps, speed: 1 },
        sellValue: 1,
      }) as ItemDef;
    const SYNTH: ItemDef[] = [
      // The flagged one-hander wins the mainhand (one-hander preference),
      // scores 600, and is the LOWEST of the three heavy flagged picks, so
      // it demotes. score() = dps * 12 at speed 1.
      weaponDef('test_bis_mw_1h', 'onehand', 50, true),
      // Over-cap bait for the refill: flagged, out-scores every other
      // weapon, never worn. Picking it would rebuild a third flagged pick.
      weaponDef('test_bis_mw_2h_bait', 'twohand', 100, true),
      // The only legal refill candidate left for the mainhand: unflagged
      // and two-handed, which is what forces the illegal pair.
      weaponDef('test_bis_2h_plain', 'twohand', 50, false),
      {
        id: 'test_bis_shield_plain',
        name: 'Test test_bis_shield_plain',
        kind: 'armor',
        slot: 'offhand',
        shield: true,
        quality: 'epic',
        requiredClass: REQ,
        stats: { sta: 500 },
        sellValue: 1,
      } as ItemDef,
      // Two flagged armor pieces out-scoring the weapon push the flagged
      // count over the cap and become the kept pair.
      {
        id: 'test_bis_mw_chest2',
        name: 'Test test_bis_mw_chest2',
        kind: 'armor',
        armorType: 'cloth',
        slot: 'chest',
        quality: 'epic',
        masterwrought: true,
        stats: { int: 900 },
        sellValue: 1,
      } as ItemDef,
      {
        id: 'test_bis_mw_legs2',
        name: 'Test test_bis_mw_legs2',
        kind: 'armor',
        armorType: 'cloth',
        slot: 'legs',
        quality: 'epic',
        masterwrought: true,
        stats: { int: 800 },
        sellValue: 1,
      } as ItemDef,
    ];
    for (const def of SYNTH) ITEMS[def.id] = def;
    try {
      const picks = bestEpicGearFor(CLS, null);
      // Kept: chest (900) and legs (800). The mainhand (600) demotes; its
      // refill pool holds only the unflagged two-hander, so the re-pair
      // must keep it and EMPTY the offhand (the shield occupies a hand).
      // A naive per-slot refill leaves the shield standing beside it.
      expect(picks.chest).toBe('test_bis_mw_chest2');
      expect(picks.legs).toBe('test_bis_mw_legs2');
      expect(picks.mainhand).toBe('test_bis_2h_plain');
      expect(picks.offhand).toBeUndefined();
      // The refill never picks another over-cap flagged id: the bait
      // two-hander out-scores the plain one but was demoted unworn.
      expect(Object.values(picks)).not.toContain('test_bis_mw_2h_bait');
      expect(Object.values(picks)).not.toContain('test_bis_mw_1h');
      const flagged = Object.values(picks).filter((id) => id && ITEMS[id]?.masterwrought);
      expect(flagged.sort()).toEqual(['test_bis_mw_chest2', 'test_bis_mw_legs2']);
    } finally {
      for (const def of SYNTH) delete ITEMS[def.id];
    }
  });

  it('a KEPT flagged two-hand mainhand survives the pair re-run (the kept-refill disjunct)', () => {
    // The refill exclusion admits kept flagged ids on purpose
    // (allowedRefill's kept.has disjunct): when a flagged 2H MAINHAND is
    // kept and a flagged OFFHAND demotes, the pair re-run re-picks the
    // mainhand, and dropping the disjunct would silently swap the kept 2H
    // for an unflagged weapon. This is the one shape that executes the
    // disjunct; without this test deleting it is byte-identical on every
    // other scenario.
    const CLS = 'test_bis_cls2';
    const REQ = [CLS] as unknown as ItemDef['requiredClass'];
    const SYNTH: ItemDef[] = [
      {
        id: 'test_bis_mw_2h_kept',
        name: 'Test test_bis_mw_2h_kept',
        kind: 'weapon',
        slot: 'mainhand',
        hand: 'twohand',
        quality: 'epic',
        masterwrought: true,
        requiredClass: REQ,
        weapon: { min: 100, max: 100, speed: 1 },
        sellValue: 1,
      } as ItemDef,
      // No one-handed weapon exists for the class, so the 2H takes the
      // mainhand outright and the initial fill leaves the offhand to the
      // flagged shield, an illegal pair even before the cap fires.
      {
        id: 'test_bis_mw_shield',
        name: 'Test test_bis_mw_shield',
        kind: 'armor',
        slot: 'offhand',
        shield: true,
        quality: 'epic',
        masterwrought: true,
        requiredClass: REQ,
        stats: { sta: 500 },
        sellValue: 1,
      } as ItemDef,
      // Third flagged piece: pushes the count over the cap so the shield
      // (lowest score) demotes through the cap arm, not only the pair rule.
      {
        id: 'test_bis_mw_chest3',
        name: 'Test test_bis_mw_chest3',
        kind: 'armor',
        armorType: 'cloth',
        slot: 'chest',
        quality: 'epic',
        masterwrought: true,
        stats: { int: 900 },
        requiredClass: REQ,
        sellValue: 1,
      } as ItemDef,
    ];
    for (const def of SYNTH) ITEMS[def.id] = def;
    try {
      const picks = bestEpicGearFor(CLS, null);
      // Kept: the 2H (1200) and the chest (900); the shield (500) demotes.
      // The pair re-run must RE-SELECT the kept flagged 2H (the disjunct)
      // and leave the offhand empty against it.
      expect(picks.mainhand).toBe('test_bis_mw_2h_kept');
      expect(picks.chest).toBe('test_bis_mw_chest3');
      expect(picks.offhand).toBeUndefined();
      const flagged = Object.values(picks).filter((id) => id && ITEMS[id]?.masterwrought);
      expect(flagged.sort()).toEqual(['test_bis_mw_2h_kept', 'test_bis_mw_chest3']);
    } finally {
      for (const def of SYNTH) delete ITEMS[def.id];
    }
  });
});
