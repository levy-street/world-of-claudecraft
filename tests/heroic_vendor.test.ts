// The Heroic Quartermaster: the item-level/budget pins for the jewelry stock,
// the server-authoritative buy path (marks debit from bags, range, stock,
// space refusals), the pure shop view, and the realm-reset reward and deed
// telemetry contract on awardHeroicMarks. The equip mechanics of the jewelry itself live in
// tests/equip_jewelry.test.ts.

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING, HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { HEROIC_VENDOR_ITEMS, HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ITEMS, NPCS } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { buildHeroicVendorView } from '../src/ui/hud/vendor/heroic_vendor_view';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 5): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
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
  it('every offer is a real epic level-20 jewelry item at item level 26', () => {
    expect(HEROIC_VENDOR_STOCK.length).toBe(10);
    for (const offer of HEROIC_VENDOR_STOCK) {
      const item = ITEMS[offer.itemId];
      expect(item, offer.itemId).toBeTruthy();
      expect(item.quality, offer.itemId).toBe('epic');
      expect(item.requiredLevel, offer.itemId).toBe(20);
      expect(['ring', 'neck']).toContain(item.slot);
      expect(offer.marks).toBeGreaterThan(0);
      expect(itemLevel(item), offer.itemId).toBe(26);
    }
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
    expect(view.rows.length).toBe(HEROIC_VENDOR_STOCK.length);
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
