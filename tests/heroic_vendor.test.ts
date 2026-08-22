// The Heroic Quartermaster: the item-level/budget pins for the jewelry stock,
// the server-authoritative buy path (marks debit from bags, range, stock,
// space refusals), the pure shop view, and the realm-reset reward and deed
// telemetry contract on awardHeroicMarks. The equip mechanics of the jewelry itself live in
// tests/equip_jewelry.test.ts.

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING, HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { HEROIC_VENDOR_ITEMS, HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { APEX_CONSUMABLE_RECIPES, FARM_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, NPCS } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { buildHeroicVendorView } from '../src/ui/hud/vendor/heroic_vendor_view';
import { VENDOR_TEST_WORLD } from './sim_shared';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 5): AnySim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: VENDOR_TEST_WORLD,
  }) as AnySim;
}

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function atQuartermaster(sim: AnySim, pid: number): void {
  const pos = NPCS.heroic_quartermaster.pos;
  teleport(sim, sim.entities.get(pid) as AnyEntity, pos.x + 1, pos.z);
}

function errorTexts(sim: AnySim): string[] {
  return (sim.drainEvents() as any[]).flatMap((e) => (e.type === 'error' ? [e.text] : []));
}

describe('heroic vendor stock: item-level and budget pins', () => {
  // Masterwrought phase 04 re-cut this pin deliberately: the stock gained the
  // wyrmfall_core material row (the masterwrought R8 catch-up valve), so the
  // gear-shape assertions now run over the stock MINUS that row, and the
  // material row gets its own pins below. Phase 11 re-cut it again: the eight
  // APEX_CONSUMABLE pattern rows joined (kind 'recipe', excluded from the
  // gear loop by KIND) and get their own describe below. The exact-count
  // floors keep every slice honest: a new gear, material, or pattern row
  // moves a literal.
  //
  // PHASE 11f re-cut it a third time, 19 -> 33: six farming patterns (kind
  // 'recipe', already excluded) and EIGHT SEED rows, which are kind 'junk' and
  // would otherwise have fallen straight into the gear loop below. The
  // exclusion is extended BY KIND, never by a growing id list: gear on this
  // counter is kind 'armor' and nothing else, so the loop now says what it
  // means instead of naming the rows it happens not to want.
  it('every gear offer is a real epic level-20 jewelry item at item level 26', () => {
    expect(HEROIC_VENDOR_STOCK.length).toBe(33);
    const gearOffers = HEROIC_VENDOR_STOCK.filter((o) => ITEMS[o.itemId]?.kind === 'armor');
    expect(gearOffers.length).toBe(10);
    // The partition is exhaustive: every row is gear, the one material, a
    // pattern, or a seed. Without this, a row of some FOURTH kind would simply
    // fall out of every sweep in this file and be pinned by nothing.
    const nonGear = HEROIC_VENDOR_STOCK.filter((o) => ITEMS[o.itemId]?.kind !== 'armor');
    for (const offer of nonGear) {
      expect(
        ['junk', 'recipe'],
        `${offer.itemId} is neither gear, a material, a pattern nor a seed`,
      ).toContain(ITEMS[offer.itemId]?.kind);
    }
    expect(nonGear.length, 'one core plus fourteen patterns plus eight seeds').toBe(23);
    for (const offer of gearOffers) {
      const item = ITEMS[offer.itemId];
      expect(item, offer.itemId).toBeTruthy();
      expect(item.quality, offer.itemId).toBe('epic');
      expect(item.requiredLevel, offer.itemId).toBe(20);
      expect(['ring', 'neck']).toContain(item.slot);
      expect(offer.marks).toBeGreaterThan(0);
      expect(itemLevel(item), offer.itemId).toBe(26);
    }
  });

  it('sells the Wyrmfall Core catch-up row at the ring price point', () => {
    const core = HEROIC_VENDOR_STOCK.find((o) => o.itemId === 'wyrmfall_core');
    expect(core?.marks).toBe(12);
    expect(ITEMS.wyrmfall_core.kind).toBe('junk');
    expect(ITEMS.wyrmfall_core.quality).toBe('rare');
    expect(ITEMS.wyrmfall_core.soulbound).toBeUndefined();
    // A material is not item-level eligible: the stock source-level bump must
    // stay a no-op for it (no phantom item-level line in the tooltip).
    expect(itemLevel(ITEMS.wyrmfall_core)).toBeUndefined();
  });

  it('the material row BUYS: 12 marks debit, one core lands (the one new vendor behavior)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'CoreBuyer');
    atQuartermaster(sim, pid);
    sim.addItem(HEROIC_MARK_ITEM_ID, 13, pid);
    sim.buyHeroicVendorItem('wyrmfall_core', pid);
    expect(sim.countItem('wyrmfall_core', pid)).toBe(1);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(1);
    // Short one mark: refused, nothing granted, nothing debited.
    sim.buyHeroicVendorItem('wyrmfall_core', pid);
    expect(sim.countItem('wyrmfall_core', pid)).toBe(1);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(1);
  });

  // Masterwrought phase 11 (masterwrought R8's deterministic pillar): the eight
  // APEX_CONSUMABLE patterns are SOLD here for Heroic Marks, day one. The
  // vendor is the valve: patterns are tradable, so duplicates are purchasable
  // BY DESIGN and the vendor price is the market ceiling; the six skill-100
  // patterns sit at the ring price point, the two capstones at the neck point.
  describe('the pattern rows across both packets (the masterwrought R8 deterministic valve)', () => {
    // Re-cut by Phase 11f, which put every FARMING pattern on the same counter
    // at the ring point. The table is now fourteen rows across two packets, and
    // the split is what the arms below check: the apex set spans both mark
    // points because it reaches skill 125, the farm set is uniformly 12 because
    // nothing farming owns reaches that rung.
    const APEX_PATTERN_PRICES: Record<string, number> = {
      pattern_ironhusk_flask: 12,
      pattern_warboar_flask: 12,
      pattern_runewater_flask: 12,
      pattern_stonepot_stew: 12,
      pattern_warspice_skewers: 12,
      pattern_sageleaf_chowder: 12,
      pattern_grand_cauldron: 16,
      pattern_laden_hearth: 16,
    };
    const FARM_PATTERN_PRICES: Record<string, number> = {
      pattern_highwatch_gourd_soup: 12,
      pattern_highwatch_barley_porridge: 12,
      pattern_evergarden_sunmelon_tart: 12,
      pattern_evergarden_harvest_platter: 12,
      pattern_evergarden_braised_greens: 12,
      pattern_harvest_feast: 12,
    };
    const PATTERN_PRICES: Record<string, number> = {
      ...APEX_PATTERN_PRICES,
      ...FARM_PATTERN_PRICES,
    };

    it('sells the eight apex patterns (six at 12, two at 16) and all six farming patterns at 12', () => {
      // The kind read, not an id prefix: a pattern row whose def vanished
      // from ITEMS must fall out of this census and red the exact-set pin.
      const patternOffers = HEROIC_VENDOR_STOCK.filter((o) => ITEMS[o.itemId]?.kind === 'recipe');
      expect(patternOffers.map((o) => o.itemId).sort()).toEqual(Object.keys(PATTERN_PRICES).sort());
      for (const offer of patternOffers) {
        expect(offer.marks, offer.itemId).toBe(PATTERN_PRICES[offer.itemId]);
      }
      // The mark family has exactly TWO points and this counter uses only
      // those: a third price appearing anywhere here is a maintainer decision
      // over the whole family, not something a content phase takes.
      expect([...new Set(HEROIC_VENDOR_STOCK.map((o) => o.marks))].sort((a, b) => a - b)).toEqual([
        12, 16,
      ]);
    });

    it('no farming row sits at the 16 (neck) point, because none reaches rung 125', () => {
      // Derived from the recipe table rather than from the price map, so the
      // claim is about the RUNG the row teaches and not about the literal
      // above agreeing with itself.
      for (const [itemId, marks] of Object.entries(FARM_PATTERN_PRICES)) {
        const def = ITEMS[itemId];
        if (def?.kind !== 'recipe') throw new Error(`${itemId} must be a kind-'recipe' def`);
        const taught = FARM_RECIPES.find((r) => r.id === def.teachesRecipeId);
        expect(taught, `${itemId} must teach a farm recipe`).toBeDefined();
        expect(taught?.skillReq, `${itemId} rung`).toBeLessThan(125);
        expect(marks, `${itemId} price`).toBe(12);
      }
    });

    it('every pattern row is a recipe def whose quality tracks what it teaches', () => {
      const apexRecipeIds = new Set(APEX_CONSUMABLE_RECIPES.map((r) => r.id));
      const farmRecipeIds = new Set(FARM_RECIPES.map((r) => r.id));
      for (const itemId of Object.keys(PATTERN_PRICES)) {
        const def = ITEMS[itemId];
        expect(def, itemId).toBeTruthy();
        if (def?.kind !== 'recipe') throw new Error(`${itemId} must be a kind-'recipe' def`);
        const isApex = apexRecipeIds.has(def.teachesRecipeId);
        expect(
          isApex || farmRecipeIds.has(def.teachesRecipeId),
          `${itemId} -> ${def.teachesRecipeId} belongs to neither packet's table`,
        ).toBe(true);
        // Quality is NOT uniform across this counter any more, and that is the
        // ruling: recipe rarity tracks the power of what it teaches, so the
        // apex patterns are epic and the farm patterns carry their dish's own
        // quality. Derived from the taught output, never restated.
        const taught = [...APEX_CONSUMABLE_RECIPES, ...FARM_RECIPES].find(
          (r) => r.id === def.teachesRecipeId,
        );
        expect(def.quality, `${itemId} quality must equal its taught output's`).toBe(
          ITEMS[taught?.resultItemId ?? '']?.quality,
        );
        // A pattern is not item-level eligible (no slot): the stock
        // source-level bump must stay a no-op for it, like wyrmfall_core.
        expect(itemLevel(def), itemId).toBeUndefined();
      }
    });

    it('a pattern row BUYS: 12 marks debit, one pattern lands (no kind gate on the buy path)', () => {
      const sim = makeSim();
      const pid = sim.addPlayer('warrior', 'PatternBuyer');
      atQuartermaster(sim, pid);
      sim.addItem(HEROIC_MARK_ITEM_ID, 13, pid);
      sim.buyHeroicVendorItem('pattern_ironhusk_flask', pid);
      expect(sim.countItem('pattern_ironhusk_flask', pid)).toBe(1);
      expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(1);
      // Short one mark: refused, nothing granted, nothing debited. The
      // refusal is affordability only; owning a copy never blocks a second
      // purchase (duplicates are purchasable BY DESIGN, see the stock note).
      sim.buyHeroicVendorItem('pattern_ironhusk_flask', pid);
      expect(sim.countItem('pattern_ironhusk_flask', pid)).toBe(1);
      expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(1);
    });
  });

  // Masterwrought phase 11f: the eight upper-tier SEED rows. Additive reach for
  // a raider, never the bootstrap: the copper counters at farmer_hollis and
  // farmer_verbena are the everyday route and are untouched by this phase
  // (pinned in tests/farmer_vendor_purchase.test.ts).
  describe('the phase 11f seed rows (marks reach, not the bootstrap)', () => {
    // DERIVED from the crop catalog, not listed: a new tier-3 or tier-4 crop
    // must join this counter or red here, rather than quietly shipping a seed
    // the marks route cannot reach.
    const upperSeedIds = Object.values(FARM_CROPS)
      .filter((crop) => crop.tier >= 3)
      .map((crop) => crop.seedItemId)
      .sort();

    it('sells every tier-3 and tier-4 seed at the ring point, and nothing lower-tier', () => {
      const seedIds = new Set(Object.values(FARM_CROPS).map((crop) => crop.seedItemId));
      const seedOffers = HEROIC_VENDOR_STOCK.filter((o) => seedIds.has(o.itemId));
      expect(seedOffers.map((o) => o.itemId).sort()).toEqual(upperSeedIds);
      expect(seedOffers, 'four tier-3 plus four tier-4 seeds').toHaveLength(8);
      for (const offer of seedOffers) expect(offer.marks, offer.itemId).toBe(12);
      // The tier 1/2 seeds stay OFF this counter: they are the starter supply
      // and have never needed an endgame currency route.
      const lowerSeedIds = Object.values(FARM_CROPS)
        .filter((crop) => crop.tier <= 2)
        .map((crop) => crop.seedItemId);
      expect(lowerSeedIds.length).toBeGreaterThan(0);
      for (const id of lowerSeedIds) {
        expect(
          HEROIC_VENDOR_STOCK.some((o) => o.itemId === id),
          `${id} is a starter seed and must not be on the marks counter`,
        ).toBe(false);
      }
    });

    it('a seed row is a kind-junk def that the stock item-level bump no-ops for', () => {
      for (const id of upperSeedIds) {
        const def = ITEMS[id];
        expect(def, id).toBeTruthy();
        expect(def.kind, id).toBe('junk');
        // Same reason wyrmfall_core is pinned this way: junk carries no slot,
        // so the source-level bump must not mint a phantom item-level line.
        expect(itemLevel(def), id).toBeUndefined();
        expect(def.soulbound, `${id} must stay tradable`).toBeUndefined();
      }
    });

    it('a seed row BUYS: 12 marks debit, one seed lands', () => {
      const sim = makeSim();
      const pid = sim.addPlayer('warrior', 'SeedBuyer');
      atQuartermaster(sim, pid);
      sim.addItem(HEROIC_MARK_ITEM_ID, 13, pid);
      sim.buyHeroicVendorItem(upperSeedIds[0], pid);
      expect(sim.countItem(upperSeedIds[0], pid)).toBe(1);
      expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(1);
      // Short one mark: refused, nothing granted, nothing debited.
      sim.buyHeroicVendorItem(upperSeedIds[0], pid);
      expect(sim.countItem(upperSeedIds[0], pid)).toBe(1);
      expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(1);
    });
  });

  it('pins the ring and neck stat budgets (11 and 12) and every stat sum matches', () => {
    expect(expectedStatBudget(ITEMS.seal_of_the_nine_oaths)).toBe(11);
    expect(expectedStatBudget(ITEMS.yumis_keepsake_locket)).toBe(12);
    for (const id of Object.keys(HEROIC_VENDOR_ITEMS)) {
      expect(primaryStatSum(ITEMS[id]), id).toBe(expectedStatBudget(ITEMS[id]));
    }
  });

  it('marks stack so a vendor price fits in the bags', () => {
    expect(ITEMS[HEROIC_MARK_ITEM_ID].stackSize).toBe(20);
  });
});

describe('heroic vendor buy path', () => {
  it('debits the marks from the bags and grants the item', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Buyer');
    atQuartermaster(sim, pid);
    sim.addItem(HEROIC_MARK_ITEM_ID, 15, pid);
    sim.drainEvents();

    sim.buyHeroicVendorItem('seal_of_the_nine_oaths', pid);

    expect(sim.countItem('seal_of_the_nine_oaths', pid)).toBe(1);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(3); // 15 - 12
    expect(
      (sim.drainEvents() as any[]).some(
        (e) => e.type === 'vendor' && e.action === 'buy' && e.itemId === 'seal_of_the_nine_oaths',
      ),
    ).toBe(true);
  });

  it('refuses when the buyer cannot afford the price, without debiting', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Broke');
    atQuartermaster(sim, pid);
    sim.addItem(HEROIC_MARK_ITEM_ID, 11, pid);
    sim.drainEvents();

    sim.buyHeroicVendorItem('seal_of_the_nine_oaths', pid);

    expect(sim.countItem('seal_of_the_nine_oaths', pid)).toBe(0);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(11);
    expect(errorTexts(sim)).toContain('You need 12 Heroic Marks to buy Seal of the Nine Oaths.');
  });

  it('refuses away from the quartermaster and for junk item ids', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Faraway');
    sim.addItem(HEROIC_MARK_ITEM_ID, 20, pid);
    sim.drainEvents();

    // Spawn position is nowhere near Highwatch.
    sim.buyHeroicVendorItem('seal_of_the_nine_oaths', pid);
    expect(sim.countItem('seal_of_the_nine_oaths', pid)).toBe(0);
    expect(errorTexts(sim)).toContain('Too far away.');

    atQuartermaster(sim, pid);
    sim.buyHeroicVendorItem('healing_potion', pid); // real item, not in stock
    sim.buyHeroicVendorItem('no_such_item', pid);
    expect(errorTexts(sim)).toContain('That item is not sold here.');
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(20);
  });

  it('refuses with full bags and keeps the marks', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Packrat');
    atQuartermaster(sim, pid);
    sim.addItem(HEROIC_MARK_ITEM_ID, 12, pid);
    // Fill every remaining bag slot with non-stacking items.
    for (let i = 0; i < 40 && sim.canAddItem('worn_sword', 1, pid); i++)
      sim.addItem('worn_sword', 1, pid);
    expect(sim.canAddItem('seal_of_the_nine_oaths', 1, pid)).toBe(false);
    sim.drainEvents();

    sim.buyHeroicVendorItem('seal_of_the_nine_oaths', pid);

    expect(sim.countItem('seal_of_the_nine_oaths', pid)).toBe(0);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(12);
  });
});

describe('heroic vendor shop view (pure)', () => {
  it('resolves stock rows with affordability and drops unknown ids', () => {
    const view = buildHeroicVendorView(
      [...HEROIC_VENDOR_STOCK, { itemId: 'no_such_item', marks: 1 }],
      ITEMS,
      12,
    );
    // The literal, not HEROIC_VENDOR_STOCK.length: both sides of that compare
    // move together, so a vanished row would pass it (the unknown-id drop is
    // what this fixture proves; the row census literal is pinned above).
    expect(view.rows.length).toBe(33);
    expect(view.balance).toBe(12);
    const ring = view.rows.find((r) => r.itemId === 'seal_of_the_nine_oaths');
    const neck = view.rows.find((r) => r.itemId === 'yumis_keepsake_locket');
    expect(ring?.affordable).toBe(true); // 12 >= 12
    expect(neck?.affordable).toBe(false); // 12 < 16
  });
});

describe('heroic mark reward persistence', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function killHeroicMorthen(sim: AnySim, pid: number): AnyEntity {
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const inst = (sim.instances as any[]).find(
      (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
    );
    const morthen = inst.mobIds
      .map((id: number) => sim.entities.get(id))
      .find((e: AnyEntity | undefined) => e?.templateId === 'morthen') as AnyEntity;
    const p = sim.entities.get(pid) as AnyEntity;
    teleport(sim, p, morthen.pos.x + 1, morthen.pos.z);
    sim.dealDamage(p, morthen, morthen.hp + 10, false, 'physical', null, 'hit');
    expect(morthen.dead).toBe(true);
    return morthen;
  }

  it('persists a kill-time mark and its deed telemetry without depending on the corpse', () => {
    const sim = makeSim(21);
    sim.utcDay = '2026-07-07';
    const pid = sim.addPlayer('warrior', 'Daily');
    const morthen = killHeroicMorthen(sim, pid);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(1);
    expect(
      ((morthen.loot?.items ?? []) as any[]).some((s) => s.itemId === HEROIC_MARK_ITEM_ID),
    ).toBe(false);

    const state = sim.serializeCharacter(pid);
    expect(state?.inventory).toEqual(
      expect.arrayContaining([expect.objectContaining({ itemId: HEROIC_MARK_ITEM_ID, count: 1 })]),
    );
    // Deed telemetry persists beside the mark but never gates mark income.
    expect(state?.heroicDaily).toEqual({ date: 'reset:1', marked: ['hollow_crypt'] });
  });

  it('resets deed telemetry at the next authoritative reset even within one UTC day', () => {
    let now = 0;
    let nextReset = DAY_MS;
    const sim = new Sim({
      seed: 22,
      playerClass: 'warrior',
      noPlayer: true,
      world: VENDOR_TEST_WORLD,
      lockoutNowMs: () => now,
      raidResetMs: () => nextReset,
    }) as AnySim;
    sim.utcDay = '2026-07-07';
    const pid = sim.addPlayer('warrior', 'Resetter');
    const morthen = killHeroicMorthen(sim, pid);
    const meta = sim.players.get(pid)!;
    meta.heroicDaily.marked.add('sunken_bastion');
    expect(meta.heroicDaily.date).toBe('reset:1');

    now = nextReset;
    nextReset += DAY_MS;
    sim.awardHeroicMarks(morthen, [meta]);

    expect(sim.utcDay).toBe('2026-07-07');
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, pid)).toBe(2);
    expect(meta.heroicDaily.date).toBe('reset:2');
    expect([...meta.heroicDaily.marked]).toEqual(['hollow_crypt']);
  });

  it('unlocks the Full Circuit deed from four distinct rewards in one reset window', () => {
    const sim = makeSim(25);
    const pid = sim.addPlayer('warrior', 'Circuit');
    const meta = sim.players.get(pid)!;
    const circuit = [
      'hollow_crypt',
      'sunken_bastion',
      'drowned_temple',
      'gravewyrm_sanctum',
    ] as const;

    sim.setDungeonDifficulty('heroic', pid);
    for (const dungeonId of circuit) {
      enterDungeon(sim.ctx, dungeonId, pid);
      const inst = (sim.instances as any[]).find(
        (candidate) => candidate.dungeonId === dungeonId && candidate.partyKey !== null,
      );
      const boss = inst.mobIds
        .map((id: number) => sim.entities.get(id))
        .find(
          (entity: AnyEntity | undefined) =>
            entity?.templateId === HEROIC_DUNGEON_TUNING[dungeonId].finalBossId,
        ) as AnyEntity;
      sim.awardHeroicMarks(boss, [meta]);
    }
    sim.tick();

    expect(meta.heroicDaily.date).toBe('reset:1');
    expect(meta.heroicDaily.marked).toEqual(new Set(circuit));
    expect(meta.deedsEarned.has('dgn_mark_circuit')).toBe(true);
  });

  it('continues to load and preserve a pre-hotfix heroicDaily payload', () => {
    const sim = makeSim(23);
    const pid = sim.addPlayer('warrior', 'Saver');
    const state = sim.serializeCharacter(pid)!;
    state.heroicDaily = { date: '2026-07-07', marked: ['hollow_crypt'] };

    const sim2 = makeSim(24);
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state });
    const meta2 = sim2.players.get(pid2) as any;
    expect(meta2.heroicDaily.date).toBe('2026-07-07');
    expect(meta2.heroicDaily.marked.has('hollow_crypt')).toBe(true);
    expect(sim2.serializeCharacter(pid2)?.heroicDaily).toEqual({
      date: '2026-07-07',
      marked: ['hollow_crypt'],
    });
  });
});
