// The Heroic Quartermaster: the item-level/budget pins for the jewelry stock,
// the server-authoritative buy path (marks debit from bags, range, stock,
// space refusals), the pure shop view, and the daily income gate on
// awardHeroicMarks. The equip mechanics of the jewelry itself live in
// tests/equip_jewelry.test.ts.

import { describe, expect, it } from 'vitest';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { HEROIC_VENDOR_ITEMS, HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ITEMS, NPCS } from '../src/sim/data';
import { awardHeroicMarks, enterDungeon } from '../src/sim/instances/dungeons';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { buildHeroicVendorView } from '../src/ui/heroic_vendor_view';

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

describe('heroic marks daily income gate', () => {
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

  function markSlots(mob: AnyEntity): any[] {
    return ((mob.loot?.items ?? []) as any[]).filter((s) => s.itemId === HEROIC_MARK_ITEM_ID);
  }

  it('pays once per dungeon per UTC day and resets on the next day', () => {
    const sim = makeSim(21);
    sim.utcDay = '2026-07-07';
    const pid = sim.addPlayer('warrior', 'Daily');
    const meta = sim.players.get(pid) as any;

    const morthen = killHeroicMorthen(sim, pid);
    expect(markSlots(morthen)).toHaveLength(1);
    expect(meta.heroicDaily.date).toBe('2026-07-07');
    expect([...meta.heroicDaily.marked]).toEqual(['hollow_crypt']);

    // A second same-day kill of the same boss pays nothing (simulated by
    // re-running the award hub against the same corpse).
    awardHeroicMarks(sim.ctx, morthen, [meta]);
    expect(markSlots(morthen)).toHaveLength(1);

    // The next UTC day resets the gate.
    sim.utcDay = '2026-07-08';
    awardHeroicMarks(sim.ctx, morthen, [meta]);
    expect(markSlots(morthen)).toHaveLength(2);
    expect(meta.heroicDaily.date).toBe('2026-07-08');
  });

  it('gates per dungeon: another heroic dungeon still pays the same day', () => {
    const sim = makeSim(22);
    sim.utcDay = '2026-07-07';
    const pid = sim.addPlayer('warrior', 'Tourist');
    const meta = sim.players.get(pid) as any;
    killHeroicMorthen(sim, pid);

    // Same day, different dungeon: the award hub still pays.
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, 'sunken_bastion', pid);
    const inst = (sim.instances as any[]).find(
      (i) => i.dungeonId === 'sunken_bastion' && i.partyKey !== null,
    );
    const vael = inst.mobIds
      .map((id: number) => sim.entities.get(id))
      .find((e: AnyEntity | undefined) => e?.templateId === 'vael_the_mistcaller') as AnyEntity;
    awardHeroicMarks(sim.ctx, vael, [meta]);
    expect(markSlots(vael)).toHaveLength(1);
    expect([...meta.heroicDaily.marked].sort()).toEqual(['hollow_crypt', 'sunken_bastion']);
  });

  it('round-trips heroicDaily through character save/load', () => {
    const sim = makeSim(23);
    sim.utcDay = '2026-07-07';
    const pid = sim.addPlayer('warrior', 'Saver');
    killHeroicMorthen(sim, pid);

    const state = sim.serializeCharacter(pid);
    expect(state?.heroicDaily).toEqual({ date: '2026-07-07', marked: ['hollow_crypt'] });

    const sim2 = makeSim(24);
    sim2.utcDay = '2026-07-07';
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state: state! });
    const meta2 = sim2.players.get(pid2) as any;
    expect(meta2.heroicDaily.date).toBe('2026-07-07');
    expect(meta2.heroicDaily.marked.has('hollow_crypt')).toBe(true);
  });
});
