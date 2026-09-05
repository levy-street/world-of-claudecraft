import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  bestEpicGearFor,
  equipBestInSlotForDev,
  equipReferenceEpicKitForDev,
} from '../src/sim/dev/bis_gear';
import { parseBisGearFor } from '../src/sim/dev/parse_bis_loadouts';
import { canEquipItemInSlot, MASTERWROUGHT_EQUIP_CAP } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import type { EquipSlot, ItemDef } from '../src/sim/types';

// /dev bis: the one-shot best-in-slot outfit for level-cap playtesting.

describe('dev bis gear', () => {
  it.each([
    ['warrior', 'arms', 'crucible_str_mail'],
    ['warrior', 'prot', 'crucible_tank_mail'],
    ['paladin', 'holy', 'crucible_healer_mail'],
    ['shaman', 'elemental', 'crucible_caster_mail'],
  ])('keeps %s/%s collection picks on their authored role', (cls, spec, collection) => {
    const picks = bestEpicGearFor(cls, spec);
    expect(picks.chest).toBe(`${collection}_chest`);
    expect(picks.waist).toBeDefined();
    expect(ITEMS[picks.waist ?? '']?.masterwrought).toBeFalsy();
    expect(ITEMS[picks.feet ?? '']?.masterwrought).toBeFalsy();
  });

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

  it('keeps the reference kit on the item-table scorer, never the parse snapshot', () => {
    // The balance probes and their pinned DPS bands equip through
    // equipReferenceEpicKitForDev; a new parse capture must not move them.
    const sim = new Sim({ seed: 5, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('combat')).toBe(true);
    // The spec has a parse loadout, and it differs from the scorer's picks, so
    // this fixture actually distinguishes the two sources.
    const parse = parseBisGearFor('rogue', 'combat');
    const reference = bestEpicGearFor('rogue', 'combat');
    expect(parse).toBeTruthy();
    expect(parse).not.toEqual(reference);
    const ctx = (sim as unknown as { ctx: Parameters<typeof equipReferenceEpicKitForDev>[0] }).ctx;
    const equipped = equipReferenceEpicKitForDev(ctx, sim.player.id);
    expect(equipped).toBeGreaterThanOrEqual(8);
    const meta = ctx.players.get(sim.player.id);
    // Total equality, not a per-slot subset: a parse-only slot leaking in or a
    // reference slot silently going uncoverable must both fail here.
    expect(meta?.equipment).toEqual(reference);
    expect(sim.player.hp).toBe(sim.player.maxHp);
  });

  it('preserves stale slots the scorer cannot cover, unlike the clearing /dev bis', () => {
    // The reference kit reproduces the pre-parse-loadout equip semantics the
    // pinned DPS bands were minted under: overwrite picks only, never clear.
    // The scorer has no druid offhand pick, so a planted offhand is the one
    // observable that separates the two appliers.
    const sim = new Sim({ seed: 5, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('feral')).toBe(true);
    expect(bestEpicGearFor('druid', 'feral').offhand).toBeUndefined();
    const ctx = (sim as unknown as { ctx: Parameters<typeof equipReferenceEpicKitForDev>[0] }).ctx;
    const meta = ctx.players.get(sim.player.id);
    expect(meta).toBeDefined();
    if (meta) meta.equipment.offhand = 'gnarled_staff';
    equipReferenceEpicKitForDev(ctx, sim.player.id);
    expect(meta?.equipment.offhand).toBe('gnarled_staff');
    equipBestInSlotForDev(ctx, sim.player.id);
    expect(meta?.equipment.offhand).not.toBe('gnarled_staff');
  });

  it('keeps the balance probes equipping through the reference kit', () => {
    // The regression shape that broke the fight-6498 bands was a probe call
    // site drifting onto the /dev bis applier; pin the call sites cheaply so
    // the failure is not deferred to the multi-minute band suites.
    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    for (const file of ['scripts/rogue_dps_probe.ts', 'scripts/druid_balance_probe.ts']) {
      const source = readFileSync(join(repoRoot, file), 'utf8');
      expect(source, `${file} equips via the reference kit`).toContain(
        'equipReferenceEpicKitForDev',
      );
      expect(source, `${file} must not equip via the /dev bis applier`).not.toContain(
        'equipBestInSlotForDev',
      );
    }
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

  it('every class outfit holds the flagged cap with reviewed live-catalog picks', () => {
    for (const cls of CLASSES) {
      const flagged = Object.values(bestEpicGearFor(cls, null)).filter(
        (id) => id && ITEMS[id]?.masterwrought,
      );
      expect(flagged.length, `${cls} flagged picks: ${flagged.join(', ')}`).toBeLessThanOrEqual(
        MASTERWROUGHT_EQUIP_CAP,
      );
    }
    expect(MASTERWROUGHT_EQUIP_CAP).toBe(2);
    // The collection admission is role-aware, but the original raw-stat scorer
    // and weapon preferences are unchanged. Pin both hand choices against that
    // independent derivation instead of forcing newly crafted weapons into BiS.
    const devScore = (item: ItemDef): number => {
      const weapon =
        item.kind === 'weapon' && item.weapon
          ? (((item.weapon.min + item.weapon.max) / 2) * 12) / Math.max(0.1, item.weapon.speed)
          : 0;
      return weapon + Object.values(item.stats ?? {}).reduce((sum, value) => sum + value, 0);
    };
    const warrior = bestEpicGearFor('warrior', null);
    for (const slot of ['mainhand', 'offhand'] as const) {
      const pool = Object.values(ITEMS)
        .filter(
          (item) =>
            item.quality === 'epic' &&
            (slot !== 'mainhand' || (item.kind === 'weapon' && item.hand !== 'twohand')) &&
            canEquipItemInSlot('warrior', item, slot, null),
        )
        .sort((a, b) => devScore(b) - devScore(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      expect(warrior[slot]).toBe(pool[0].id);
      expect(ITEMS[warrior[slot] as string].masterwrought).toBeUndefined();
    }
    const offhand = ITEMS[warrior.offhand as string];
    expect(offhand.kind === 'armor' && 'shield' in offhand && offhand.shield === true).toBe(true);
  });

  it('pins the reviewed collection entries by class, independently of the cap', () => {
    // The approved raid collections now enter the live raw-stat reference kit
    // in mail chests only. The scorer does not model their signature bonuses or
    // combat ratings, so no other slot is forced into a collection to make an
    // item-level claim look like measured BiS. Spec-less means no role choice;
    // the authored class restriction still excludes caster mail for warriors.
    const expected: Record<(typeof CLASSES)[number], string[]> = {
      warrior: ['chest:crucible_str_mail_chest'],
      paladin: ['chest:crucible_healer_mail_chest'],
      shaman: ['chest:crucible_caster_mail_chest'],
      hunter: [],
      rogue: [],
      priest: [],
      mage: [],
      warlock: [],
      druid: [],
    };
    const flaggedFrom = (picks: Partial<Record<EquipSlot, string>>): string[] =>
      Object.entries(picks)
        .filter(([, id]) => id && ITEMS[id]?.masterwrought)
        .map(([slot, id]) => `${slot}:${id}`)
        .sort();
    for (const cls of CLASSES) {
      expect(flaggedFrom(bestEpicGearFor(cls, null)), `${cls} flagged picks`).toEqual(
        expected[cls],
      );
    }
    expect(Object.values(ITEMS).filter((item) => item.masterwrought)).toHaveLength(50);
    expect(flaggedFrom({ chest: 'crucible_tank_mail_chest', neck: 'missing' })).toEqual([
      'chest:crucible_tank_mail_chest',
    ]);
  });

  it('demotes the lowest-scoring flagged pick and refills the slot (synthetic over-cap)', () => {
    // The shipped raw-stat scorer does not push a dev outfit OVER the cap, so drive the
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
    // (allowedRefill's kept.has disjunct). Executing the disjunct takes a
    // three-step shape: the flagged shield demotes through the cap arm and
    // its refill LANDS (the plain offhand below; with no refill candidate
    // the offhand just empties and pairIllegal short-circuits on the
    // undefined offhand, which is exactly how the earlier form of this
    // test silently skipped the disjunct); the refilled offhand beside the
    // kept flagged 2H makes the pair illegal; the re-run then re-selects
    // the mainhand from a pool whose ONLY candidate is the kept flagged
    // 2H, admitted by nothing but the disjunct. Dropping the disjunct
    // leaves the mainhand EMPTY and the plain offhand standing, so every
    // hand assertion below reds.
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
      // Unflagged offhand fodder: scores BELOW the flagged shield (so the
      // initial fill still picks the shield) but gives the shield's cap
      // demotion a refill that LANDS, which is what pushes the illegal
      // 2H-plus-offhand pair into the re-run where the disjunct decides.
      {
        id: 'test_bis_plain_offhand',
        name: 'Test test_bis_plain_offhand',
        kind: 'armor',
        slot: 'offhand',
        shield: true,
        quality: 'epic',
        requiredClass: REQ,
        stats: { sta: 100 },
        sellValue: 1,
      } as ItemDef,
    ];
    for (const def of SYNTH) ITEMS[def.id] = def;
    try {
      const picks = bestEpicGearFor(CLS, null);
      // Kept: the 2H (1200) and the chest (900); the shield (500) demotes
      // and its refill lands the plain offhand, making the pair illegal.
      // The re-run must RE-SELECT the kept flagged 2H (the disjunct) and
      // leave the offhand empty against it: the plain offhand refill is
      // rejected by the displacement filter once the 2H stands again.
      expect(picks.mainhand).toBe('test_bis_mw_2h_kept');
      expect(picks.chest).toBe('test_bis_mw_chest3');
      expect(picks.offhand).toBeUndefined();
      expect(Object.values(picks)).not.toContain('test_bis_plain_offhand');
      const flagged = Object.values(picks).filter((id) => id && ITEMS[id]?.masterwrought);
      expect(flagged.sort()).toEqual(['test_bis_mw_2h_kept', 'test_bis_mw_chest3']);
    } finally {
      for (const def of SYNTH) delete ITEMS[def.id];
    }
  });

  it('the demoted offhand refill LANDS when the kept weapon is one-handed (premise pin)', () => {
    // Companion to the kept-2H disjunct case above, pinning the premise that
    // test rides on: the same fixture family must give the demoted flagged
    // shield a refill that LANDS. With a ONE-hand kept weapon the pair stays
    // legal, so the refilled plain offhand SURVIVES into the picks, which is
    // observable directly; if a fixture edit ever breaks the refill (a
    // renamed id, a class or slot mismatch), this reds while the 2H case
    // above would silently degrade back to the vacuous shape (offhand empty,
    // pairIllegal short-circuits, the disjunct never runs).
    const CLS = 'test_bis_cls3';
    const REQ = [CLS] as unknown as ItemDef['requiredClass'];
    const SYNTH: ItemDef[] = [
      {
        id: 'test_bis_mw_1h_kept',
        name: 'Test test_bis_mw_1h_kept',
        kind: 'weapon',
        slot: 'mainhand',
        hand: 'onehand',
        quality: 'epic',
        masterwrought: true,
        requiredClass: REQ,
        weapon: { min: 100, max: 100, speed: 1 },
        sellValue: 1,
      } as ItemDef,
      {
        id: 'test_bis_mw_shield_b',
        name: 'Test test_bis_mw_shield_b',
        kind: 'armor',
        slot: 'offhand',
        shield: true,
        quality: 'epic',
        masterwrought: true,
        requiredClass: REQ,
        stats: { sta: 500 },
        sellValue: 1,
      } as ItemDef,
      {
        id: 'test_bis_mw_chest4',
        name: 'Test test_bis_mw_chest4',
        kind: 'armor',
        armorType: 'cloth',
        slot: 'chest',
        quality: 'epic',
        masterwrought: true,
        stats: { int: 900 },
        requiredClass: REQ,
        sellValue: 1,
      } as ItemDef,
      {
        id: 'test_bis_plain_offhand_b',
        name: 'Test test_bis_plain_offhand_b',
        kind: 'armor',
        slot: 'offhand',
        shield: true,
        quality: 'epic',
        requiredClass: REQ,
        stats: { sta: 100 },
        sellValue: 1,
      } as ItemDef,
    ];
    for (const def of SYNTH) ITEMS[def.id] = def;
    try {
      const picks = bestEpicGearFor(CLS, null);
      // Kept: the 1H weapon and the chest; the flagged shield demotes and
      // its refill lands the plain offhand, which stays: a 1H beside an
      // offhand is a legal pair, so no re-run strips it.
      expect(picks.mainhand).toBe('test_bis_mw_1h_kept');
      expect(picks.chest).toBe('test_bis_mw_chest4');
      expect(picks.offhand).toBe('test_bis_plain_offhand_b');
      const flagged = Object.values(picks).filter((id) => id && ITEMS[id]?.masterwrought);
      expect(flagged.sort()).toEqual(['test_bis_mw_1h_kept', 'test_bis_mw_chest4']);
    } finally {
      for (const def of SYNTH) delete ITEMS[def.id];
    }
  });
});
