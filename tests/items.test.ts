import { describe, expect, it } from 'vitest';
import * as items from '../src/sim/items';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Entity, POTION_COOLDOWN, type SimEvent } from '../src/sim/types';

// Direct tests for the extracted inventory/vendor module (W2). They call the module
// functions with the real SimContext the Sim built in its ctor (the same seam the thin
// Sim delegates forward through), exercising the moved bodies, not just "it runs".

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// The live SimContext the Sim assembled in its ctor (private field; reached here so the
// module is tested through the actual seam, with real resolve/emit/error/hub callbacks).
function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

// Add a warrior and stand them at Trader Wilkes so the buy / vendorInRange gates pass.
function vendorPlayer(sim: Sim, name = 'Aleph') {
  const pid = sim.addPlayer('warrior', name);
  const anySim = sim as unknown as {
    entities: Map<number, Entity>;
    players: Map<
      number,
      {
        copper: number;
        equipment: Record<string, string>;
        vendorBuyback: { itemId: string; count: number }[];
        inventory: { itemId: string; count: number }[];
        pendingSkinRank: number | null;
      }
    >;
    rebucket(e: Entity): void;
  };
  const wilkes = [...anySim.entities.values()].find(
    (e) => (e as unknown as { templateId?: string }).templateId === 'trader_wilkes',
  ) as Entity;
  const p = anySim.entities.get(pid) as Entity;
  // dist2d (x,z) is what the proximity gates use; matching x/z is enough.
  p.pos.x = wilkes.pos.x + 2;
  p.pos.z = wilkes.pos.z;
  anySim.rebucket(p);
  const meta = anySim.players.get(pid)!;
  return { pid, wilkes, p, meta };
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('items.equipItem / unequipItem', () => {
  it('swaps the old piece back to the bags via the silent add + recalcPlayerStats', () => {
    const sim = makeWorld();
    const { pid, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('cryptbone_helm', 1, pid);
    sim.addItem('roadwardens_helm', 1, pid);

    items.equipItem(ctx, 'cryptbone_helm', pid); // empty slot: no swap
    expect(meta.equipment.helmet).toBe('cryptbone_helm');
    const armorWithCrypt = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid)!
      .stats.armor;

    items.equipItem(ctx, 'roadwardens_helm', pid); // same slot: SWAP returns the old helm
    expect(meta.equipment.helmet).toBe('roadwardens_helm');
    expect(sim.countItem('cryptbone_helm', pid)).toBe(1); // returned to bags (silent add)
    expect(sim.countItem('roadwardens_helm', pid)).toBe(0);
    // recalc ran: armor reflects the new (weaker) helmet, not the old one
    const armorWithRoad = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid)!
      .stats.armor;
    expect(armorWithRoad).not.toBe(armorWithCrypt);
  });

  it('unequips a piece back to the bags, empties the slot, and is a no-op for an empty slot', () => {
    const sim = makeWorld();
    const { pid, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('cryptbone_helm', 1, pid);
    items.equipItem(ctx, 'cryptbone_helm', pid);

    expect(items.unequipItem(ctx, 'helmet', pid)).toBe(true);
    expect(meta.equipment.helmet).toBeUndefined();
    expect(sim.countItem('cryptbone_helm', pid)).toBe(1);
    expect(items.unequipItem(ctx, 'legs', pid)).toBe(false);
  });
});

describe('items.useItem', () => {
  it('food sits the player, fills the eating slot, and consumes one', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('baked_bread', 1, pid);

    items.useItem(ctx, 'baked_bread', pid);
    expect(p.sitting).toBe(true);
    expect(p.eating?.itemId).toBe('baked_bread');
    expect(sim.countItem('baked_bread', pid)).toBe(0);
  });

  it('drink fills the drinking slot', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('spring_water', 1, pid);

    items.useItem(ctx, 'spring_water', pid);
    expect(p.drinking?.itemId).toBe('spring_water');
    expect(sim.countItem('spring_water', pid)).toBe(0);
  });

  it('potion heals up to the deficit and arms the shared cooldown', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('minor_healing_potion', 1, pid);
    p.hp = p.maxHp - 50;

    items.useItem(ctx, 'minor_healing_potion', pid);
    expect(p.hp).toBe(p.maxHp); // 90 potion clamped to the 50 deficit
    expect(p.potionCooldownUntil).toBeGreaterThan(0);
    expect(sim.countItem('minor_healing_potion', pid)).toBe(0);
  });

  it('shares one 2-minute cooldown across all potions and materializes the remaining timer', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('minor_healing_potion', 1, pid);
    sim.addItem('minor_mana_potion', 1, pid);
    p.hp = p.maxHp - 50;
    p.resourceType = 'mana';
    p.resource = p.maxResource - 50;

    items.useItem(ctx, 'minor_healing_potion', pid);
    // the shared cooldown is the classic 2 minutes, armed off the sim clock, and the
    // remaining time is materialized for the action-bar swipe.
    expect(POTION_COOLDOWN).toBe(120);
    expect(p.potionCooldownUntil).toBeCloseTo(ctx.time + POTION_COOLDOWN, 5);
    expect(p.potionCdRemaining).toBe(POTION_COOLDOWN);

    // a DIFFERENT potion is refused while the shared cooldown runs (not consumed).
    items.useItem(ctx, 'minor_mana_potion', pid);
    expect(sim.countItem('minor_mana_potion', pid)).toBe(1);
    expect(p.resource).toBe(p.maxResource - 50);

    // updateTimers counts the materialized remaining down each tick.
    sim.tick();
    expect(p.potionCdRemaining).toBeLessThan(POTION_COOLDOWN);
    expect(p.potionCdRemaining).toBeGreaterThan(0);
  });

  it('elixir applies the battle-elixir buff aura', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('elixir_of_the_bear', 1, pid);

    items.useItem(ctx, 'elixir_of_the_bear', pid);
    expect(p.auras.some((a) => a.id === 'elixir_elixir_of_the_bear')).toBe(true);
    expect(sim.countItem('elixir_of_the_bear', pid)).toBe(0);
  });

  it('skinSelect rolls a rank and emits the skin event (dispatch to ctx.openSkinSelect)', () => {
    const sim = makeWorld();
    const { pid, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('event_skin_token', 1, pid);
    sim.drainEvents();

    items.useItem(ctx, 'event_skin_token', pid);
    const evs = sim.drainEvents();
    expect(evs.some((e) => e.type === 'skinEvent')).toBe(true);
    expect(meta.pendingSkinRank).not.toBeNull();
  });

  it('fishing routes to ctx.startFishing (in town it reports needing water, pole not consumed)', () => {
    const sim = makeWorld();
    const { pid } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('simple_fishing_pole', 1, pid);
    sim.drainEvents();

    items.useItem(ctx, 'simple_fishing_pole', pid);
    const errs = errorTexts(sim.drainEvents());
    expect(errs.some((t) => /fishable water/.test(t))).toBe(true);
    expect(sim.countItem('simple_fishing_pole', pid)).toBe(1); // a tool is not consumed
  });
});

describe('items.discardItem', () => {
  it('removes only the requested count', () => {
    const sim = makeWorld();
    const { pid } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('wolf_fang', 3, pid);

    items.discardItem(ctx, 'wolf_fang', 1, pid);
    expect(sim.countItem('wolf_fang', pid)).toBe(2);
  });
});

describe('items vendor: buy / sell / sellAllJunk / buyBack', () => {
  it('buyItem spends copper and adds the item; sellItem pays out and records buyback', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 200;

    items.buyItem(ctx, wilkes.id, 'baked_bread', pid);
    expect(sim.countItem('baked_bread', pid)).toBe(5); // food is sold in a stack of 5
    expect(meta.copper).toBe(75); // 200 - 125 (buyValue 25 per unit x the stack of 5)

    sim.addItem('wolf_fang', 2, pid);
    items.sellItem(ctx, 'wolf_fang', 1, pid);
    expect(meta.copper).toBe(79); // + sellValue 4
    expect(sim.countItem('wolf_fang', pid)).toBe(1);
    expect(meta.vendorBuyback[0]).toEqual({ itemId: 'wolf_fang', count: 1 });
  });

  it('buyItem sells drink in a stack of 5 but other goods one at a time, all at the listed price', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 1000;

    items.buyItem(ctx, wilkes.id, 'spring_water', pid);
    expect(sim.countItem('spring_water', pid)).toBe(5); // drink is a staple stack
    expect(meta.copper).toBe(875); // 1000 - 125 (buyValue 25 per unit x the stack of 5)

    items.buyItem(ctx, wilkes.id, 'minor_healing_potion', pid);
    expect(sim.countItem('minor_healing_potion', pid)).toBe(1); // non-staples stay single
  });

  it('buying a food stack then selling it back is a net loss (no vendor arbitrage)', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 500;
    const before = meta.copper;

    // baked_bread: buyValue 25 per unit, sellValue 6 per unit. A stack of 5 must cost
    // more to buy (25 x 5 = 125) than it returns when sold back (6 x 5 = 30), or the
    // vendor would print money. Regression guard for the flat-price stack exploit.
    items.buyItem(ctx, wilkes.id, 'baked_bread', pid);
    expect(sim.countItem('baked_bread', pid)).toBe(5);
    items.sellItem(ctx, 'baked_bread', 5, pid);
    expect(sim.countItem('baked_bread', pid)).toBe(0);
    expect(meta.copper).toBe(before - 125 + 30); // 405: paid 125, recovered 30
    expect(meta.copper).toBeLessThan(before);
  });

  it('sellAllJunk bulk-sells only gray items, records each stack, emits one summary line', () => {
    const sim = makeWorld();
    const { pid, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 0;
    sim.addItem('wolf_fang', 2, pid); // poor, sellValue 4 -> 8
    sim.addItem('bandit_bandana', 1, pid); // poor, sellValue 6
    sim.addItem('apprentice_staff', 1, pid); // not poor -> kept
    sim.drainEvents();

    items.sellAllJunk(ctx, pid);
    expect(sim.countItem('wolf_fang', pid)).toBe(0);
    expect(sim.countItem('bandit_bandana', pid)).toBe(0);
    expect(sim.countItem('apprentice_staff', pid)).toBe(1);
    expect(meta.copper).toBe(2 * 4 + 6); // 14
    expect(meta.vendorBuyback.some((s) => s.itemId === 'wolf_fang' && s.count === 2)).toBe(true);
    const summary = sim
      .drainEvents()
      .filter((e) => e.type === 'loot' && /^Sold \d+ junk item/.test((e as { text: string }).text));
    expect(summary).toHaveLength(1);
  });

  it('buyBackItem repurchases via the silent add, spends copper, and clears the buyback slot', () => {
    const sim = makeWorld();
    const { pid, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('apprentice_staff', 1, pid);
    items.sellItem(ctx, 'apprentice_staff', 1, pid); // copper + 120, records buyback
    const copperAfterSell = meta.copper;

    items.buyBackItem(ctx, 'apprentice_staff', pid);
    expect(sim.countItem('apprentice_staff', pid)).toBe(1);
    expect(meta.copper).toBe(copperAfterSell - 120); // repurchase at sellValue
    expect(meta.vendorBuyback.some((s) => s.itemId === 'apprentice_staff')).toBe(false);
  });
});

describe('items module determinism', () => {
  it('two identical drives produce identical copper / inventory / equipment / vendorBuyback', () => {
    function drive() {
      const sim = makeWorld();
      const { pid, wilkes, meta } = vendorPlayer(sim);
      const ctx = ctxOf(sim);
      meta.copper = 1000;
      items.buyItem(ctx, wilkes.id, 'baked_bread', pid);
      sim.addItem('cryptbone_helm', 1, pid);
      sim.addItem('roadwardens_helm', 1, pid);
      items.equipItem(ctx, 'cryptbone_helm', pid);
      items.equipItem(ctx, 'roadwardens_helm', pid);
      items.unequipItem(ctx, 'helmet', pid);
      sim.addItem('wolf_fang', 3, pid);
      items.discardItem(ctx, 'wolf_fang', 1, pid);
      items.sellItem(ctx, 'wolf_fang', 1, pid);
      sim.addItem('bandit_bandana', 1, pid);
      items.sellAllJunk(ctx, pid);
      items.buyBackItem(ctx, 'wolf_fang', pid);
      return {
        copper: meta.copper,
        inventory: meta.inventory,
        equipment: meta.equipment,
        vendorBuyback: meta.vendorBuyback,
      };
    }
    expect(drive()).toEqual(drive());
  });
});
