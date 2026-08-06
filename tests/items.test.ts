import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import * as items from '../src/sim/items';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Entity, type ItemDef, POTION_COOLDOWN, type SimEvent } from '../src/sim/types';

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
  // Start from empty bags: these tests pin absolute counts, and fresh
  // characters now carry starter rations.
  meta.inventory.length = 0;
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

  it('a second food use while already eating is rejected, not a wasted second item (#2565)', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('baked_bread', 2, pid);

    items.useItem(ctx, 'baked_bread', pid);
    const firstConsuming = p.eating;
    expect(sim.countItem('baked_bread', pid)).toBe(1);

    sim.drainEvents();
    items.useItem(ctx, 'baked_bread', pid);
    expect(errorTexts(sim.drainEvents() as SimEvent[])).toContain('You are already eating.');
    // the in-flight slot is untouched and the second copy was never spent
    expect(p.eating).toBe(firstConsuming);
    expect(sim.countItem('baked_bread', pid)).toBe(1);
  });

  it('a second drink use while already drinking is rejected the same way, independent of the eating slot', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('spring_water', 2, pid);

    items.useItem(ctx, 'spring_water', pid);
    const firstConsuming = p.drinking;
    sim.drainEvents();
    items.useItem(ctx, 'spring_water', pid);
    expect(errorTexts(sim.drainEvents() as SimEvent[])).toContain('You are already drinking.');
    expect(p.drinking).toBe(firstConsuming);
    expect(sim.countItem('spring_water', pid)).toBe(1);
  });

  it('sitting down to eat/drink emits an immediate sound-only heal (source + sfxTick), before any regen tick', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('baked_bread', 1, pid);
    sim.addItem('spring_water', 1, pid);

    sim.drainEvents();
    items.useItem(ctx, 'baked_bread', pid);
    const eatHeals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal');
    expect(eatHeals).toHaveLength(1);
    expect(eatHeals[0]).toMatchObject({ source: 'food', sfxTick: true, amount: 0 });

    sim.drainEvents();
    items.useItem(ctx, 'spring_water', pid);
    const drinkHeals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal');
    expect(drinkHeals).toHaveLength(1);
    expect(drinkHeals[0]).toMatchObject({ source: 'drink', sfxTick: true, amount: 0 });
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

  it('a potion heal emits source:potion (distinct from a generic heal_impact)', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('minor_healing_potion', 1, pid);
    p.hp = p.maxHp - 50;

    sim.drainEvents();
    items.useItem(ctx, 'minor_healing_potion', pid);
    const heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({ source: 'potion', amount: 50 });
  });

  it('a pure-mana potion still emits source:potion, amount 0 (sound-only, no floating heal number)', () => {
    const sim = makeWorld();
    const { pid, p } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('minor_mana_potion', 1, pid);
    p.resourceType = 'mana';
    p.resource = p.maxResource - 50;
    p.hp = p.maxHp; // full: no hp portion of this potion applies

    sim.drainEvents();
    items.useItem(ctx, 'minor_mana_potion', pid);
    const heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({ source: 'potion', amount: 0 });
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
    const aura = p.auras.find((a) => a.id === 'elixir_buff_sta');
    expect(aura).toBeTruthy();
    expect(aura!.kind).toBe('buff_sta');
    expect(aura!.value).toBe(12);
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

  it("sellItem spares the seller's self-signed charm copy (the copy-choice rule, vendor arm)", () => {
    // The trade arm already consumed foreign copies first (phase 14); the
    // phase 18 whole-branch review found the vendor and discard arms still
    // took the highest-index copy, which after a fresh craft is the
    // seller's own self-signed one, silently retiring the R48 recharge
    // discount. Foreign first, self-signed only when nothing else remains.
    const sim = makeWorld();
    const { pid, meta } = vendorPlayer(sim);
    sim.addItemInstance('gatherers_cache', { signer: 'Cedric' }, pid, 1);
    sim.addItemInstance('gatherers_cache', { signer: 'Aleph' }, pid, 1); // highest index
    items.sellItem(ctxOf(sim), 'gatherers_cache', 1, pid);
    const buyback = meta.vendorBuyback as { instance?: { signer?: string } }[];
    expect(buyback[0]?.instance?.signer, 'the FOREIGN copy sold').toBe('Cedric');
    const kept = (meta.inventory as { itemId: string; instance?: { signer?: string } }[]).filter(
      (s) => s.itemId === 'gatherers_cache',
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.instance?.signer, 'the self-signed copy stays').toBe('Aleph');
  });

  it('discardItem spares the self-signed charm copy the same way', () => {
    const sim = makeWorld();
    const { pid, meta } = vendorPlayer(sim);
    sim.addItemInstance('gatherers_cache', { signer: 'Cedric' }, pid, 1);
    sim.addItemInstance('gatherers_cache', { signer: 'Aleph' }, pid, 1);
    items.discardItem(ctxOf(sim), 'gatherers_cache', 1, pid);
    const kept = (meta.inventory as { itemId: string; instance?: { signer?: string } }[]).filter(
      (s) => s.itemId === 'gatherers_cache',
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.instance?.signer, 'the self-signed copy survives the discard').toBe('Aleph');
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

  it('buys FURY gear with honor without changing lifetime honor', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Veteran');
    const meta = sim.meta(pid)!;
    const fury = [...sim.entities.values()].find((entity) => entity.templateId === 'fury')!;
    const player = sim.entities.get(pid)!;
    player.pos.x = fury.pos.x;
    player.pos.z = fury.pos.z;
    meta.inventory.length = 0;
    meta.honor = 1_000;
    meta.lifetimeHonor = 2_000;

    items.buyItem(ctxOf(sim), fury.id, 'final_argument_greatblade', pid);

    expect(sim.countItem('final_argument_greatblade', pid)).toBe(1);
    expect(meta.honor).toBe(200);
    expect(meta.lifetimeHonor).toBe(2_000);
    expect(meta.copper).toBe(0);
  });

  it('can destroy duplicate soulbound FURY purchases without making them transferable', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Collector');
    const meta = sim.meta(pid)!;
    const fury = [...sim.entities.values()].find((entity) => entity.templateId === 'fury')!;
    const player = sim.entities.get(pid)!;
    player.pos.x = fury.pos.x;
    player.pos.z = fury.pos.z;
    meta.inventory.length = 0;
    meta.honor = 1_600;

    items.buyItem(ctxOf(sim), fury.id, 'final_argument_greatblade', pid);
    items.buyItem(ctxOf(sim), fury.id, 'final_argument_greatblade', pid);
    expect(sim.countItem('final_argument_greatblade', pid)).toBe(2);
    expect(ITEMS.final_argument_greatblade.soulbound).toBe(true);

    items.discardItem(ctxOf(sim), 'final_argument_greatblade', 2, pid);
    expect(sim.countItem('final_argument_greatblade', pid)).toBe(0);
  });

  it('checks dual copper/honor prices and bag space before either debit', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'DualBuyer');
    const meta = sim.meta(pid)!;
    const fury = [...sim.entities.values()].find((entity) => entity.templateId === 'fury')!;
    const player = sim.entities.get(pid)!;
    player.pos.x = fury.pos.x;
    player.pos.z = fury.pos.z;
    meta.inventory.length = 0;
    const testId = 'test_warfare_rations';
    ITEMS[testId] = {
      id: testId,
      name: 'Test Warfare Rations',
      kind: 'food',
      foodHp: 100,
      buyValue: 10,
      priceHonor: 7,
      sellValue: 1,
    };
    fury.vendorItems.push(testId);

    try {
      meta.copper = 49;
      meta.honor = 7;
      items.buyItem(ctxOf(sim), fury.id, testId, pid);
      expect(meta.copper).toBe(49);
      expect(meta.honor).toBe(7);
      expect(sim.countItem(testId, pid)).toBe(0);

      meta.copper = 50;
      meta.honor = 6;
      items.buyItem(ctxOf(sim), fury.id, testId, pid);
      expect(meta.copper).toBe(50);
      expect(meta.honor).toBe(6);
      expect(sim.countItem(testId, pid)).toBe(0);

      meta.honor = 7;
      items.buyItem(ctxOf(sim), fury.id, testId, pid);
      expect(meta.copper).toBe(0);
      expect(meta.honor).toBe(0);
      expect(sim.countItem(testId, pid)).toBe(5);

      meta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'worn_sword', count: 1 }));
      meta.copper = 0;
      meta.honor = 800;
      items.buyItem(ctxOf(sim), fury.id, 'final_argument_greatblade', pid);
      expect(meta.copper).toBe(0);
      expect(meta.honor).toBe(800);
      expect(sim.countItem('final_argument_greatblade', pid)).toBe(0);
    } finally {
      fury.vendorItems.splice(fury.vendorItems.indexOf(testId), 1);
      delete ITEMS[testId];
    }
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

  it('buyItem bulk purchase buys the full stack size when fully affordable', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    // minor_healing_potion: buyValue 40, no explicit stackSize (default 20).
    meta.copper = 40 * 20;
    items.buyItem(ctx, wilkes.id, 'minor_healing_potion', pid, { bulk: true });
    expect(sim.countItem('minor_healing_potion', pid)).toBe(20);
    expect(meta.copper).toBe(0);
  });

  it('buyItem bulk purchase buys a floor-affordable quantity when short on copper', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 250; // floor(250 / 40) = 6
    items.buyItem(ctx, wilkes.id, 'minor_healing_potion', pid, { bulk: true });
    expect(sim.countItem('minor_healing_potion', pid)).toBe(6);
    expect(meta.copper).toBe(250 - 6 * 40); // 10
  });

  it('buyItem bulk purchase still refuses (never buys zero) when even one unit is unaffordable', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 5; // less than the 40-copper unit price
    sim.drainEvents();
    items.buyItem(ctx, wilkes.id, 'minor_healing_potion', pid, { bulk: true });
    expect(errorTexts(sim.drainEvents())).toContain('Not enough money.');
    expect(sim.countItem('minor_healing_potion', pid)).toBe(0);
    expect(meta.copper).toBe(5);
  });

  it('buyItem bulk purchase leaves food/drink at the ordinary single-unit price per unit', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 100_000;
    items.buyItem(ctx, wilkes.id, 'baked_bread', pid, { bulk: true });
    // baked_bread: buyValue 25, kind food (vendorStackSize 5 normally, but a
    // bulk request overrides that with the real bag stack size, DEFAULT_STACK
    // 20), paid per-unit at the same listed price either way.
    expect(sim.countItem('baked_bread', pid)).toBe(20);
    expect(meta.copper).toBe(100_000 - 25 * 20);
  });

  it('buyItem bulk purchase is a no-op multiplier for an Honor-priced item (stays exactly 1)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'HonorBulkBuyer');
    const meta = sim.meta(pid)!;
    const fury = [...sim.entities.values()].find((entity) => entity.templateId === 'fury')!;
    const player = sim.entities.get(pid)!;
    player.pos.x = fury.pos.x;
    player.pos.z = fury.pos.z;
    meta.inventory.length = 0;
    meta.honor = 10_000;

    items.buyItem(ctxOf(sim), fury.id, 'final_argument_greatblade', pid, { bulk: true });

    expect(sim.countItem('final_argument_greatblade', pid)).toBe(1);
    expect(meta.honor).toBe(10_000 - 800);
  });

  it('buyItem bulk purchase force-1s a soulbound copper-priced stackable, matching the count path (Q23)', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    const testId = 'test_soulbound_rations';
    ITEMS[testId] = {
      id: testId,
      name: 'Test Soulbound Rations',
      kind: 'food',
      foodHp: 50,
      buyValue: 10,
      soulbound: true,
      sellValue: 1,
    };
    wilkes.vendorItems.push(testId);

    try {
      // Ample gold: a plain copper-priced food row would bulk-buy the full
      // bag stack size (20). Soulbound must instead fall through to the
      // ordinary single-purchase path (vendorCountForced force-1), granting
      // exactly one vendorStackSize-of-food purchase (5 units) at the
      // per-unit price, never the bulk-multiplied quantity.
      meta.copper = 10_000;
      items.buyItem(ctx, wilkes.id, testId, pid, { bulk: true });
      expect(sim.countItem(testId, pid)).toBe(5);
      expect(meta.copper).toBe(10_000 - 10 * 5);
    } finally {
      wilkes.vendorItems.splice(wilkes.vendorItems.indexOf(testId), 1);
      delete ITEMS[testId];
    }
  });

  it('buyItem bulk purchase never buys more than one mount, even with ample gold', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'MountBulkBuyer');
    sim.setPlayerLevel(20);
    const meta = sim.meta(pid)!;
    meta.inventory.length = 0;
    meta.ridingTrained = true;
    meta.copper = 100_000_000; // vastly more than the item's own bag stack size
    const marla = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'stablemaster_marla',
    )!;
    const player = sim.entities.get(pid)!;
    player.pos.x = marla.pos.x;
    player.pos.z = marla.pos.z;

    items.buyItem(ctxOf(sim), marla.id, 'reins_valorsteed', pid, { bulk: true });

    expect(sim.countItem('reins_valorsteed', pid)).toBe(1);
    expect(meta.copper).toBe(100_000_000 - 100_000); // reins_valorsteed buyValue 100_000
  });

  it('buyItem bulk purchase is still gated by bag capacity (refuses, never partial)', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 40 * 20; // enough to afford the full stack of 20
    // Fill every bag slot with an unrelated item so there is no room left for
    // a fresh minor_healing_potion stack.
    meta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'worn_sword', count: 1 }));
    sim.drainEvents();
    items.buyItem(ctx, wilkes.id, 'minor_healing_potion', pid, { bulk: true });
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');
    expect(sim.countItem('minor_healing_potion', pid)).toBe(0);
    expect(meta.copper).toBe(40 * 20);
  });

  it('buyItem count N buys N row units atomically at the per-unit price (phase 21)', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    // Food row: 5 purchases of the 5-unit bread stack, 25 units at 25c each.
    meta.copper = 1_000;
    items.buyItem(ctx, wilkes.id, 'baked_bread', pid, { count: 5 });
    expect(sim.countItem('baked_bread', pid)).toBe(25);
    expect(meta.copper).toBe(1_000 - 25 * 25);
    // Single-unit row: 3 potions at 40c each.
    meta.copper = 200;
    items.buyItem(ctx, wilkes.id, 'minor_healing_potion', pid, { count: 3 });
    expect(sim.countItem('minor_healing_potion', pid)).toBe(3);
    expect(meta.copper).toBe(200 - 3 * 40);
  });

  it('buyItem count 1 and an empty options bag reproduce the plain buy exactly (acceptance a)', () => {
    const runs = [undefined, {}, { count: 1 }] as const;
    const results = runs.map((opts) => {
      const sim = makeWorld();
      const { pid, wilkes, meta } = vendorPlayer(sim);
      meta.copper = 500;
      items.buyItem(ctxOf(sim), wilkes.id, 'baked_bread', pid, opts);
      return { count: sim.countItem('baked_bread', pid), copper: meta.copper };
    });
    for (const r of results) expect(r).toEqual({ count: 5, copper: 500 - 125 });
  });

  it('buyItem count with insufficient funds refuses WHOLE with the money toast (Q20)', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    // One copper short of the 5-count total: nothing is granted, nothing
    // debited. A clamp-to-affordable here would be the bulk verb's semantics
    // leaking into the count path.
    meta.copper = 25 * 25 - 1;
    sim.drainEvents();
    items.buyItem(ctx, wilkes.id, 'baked_bread', pid, { count: 5 });
    expect(errorTexts(sim.drainEvents())).toContain('Not enough money.');
    expect(sim.countItem('baked_bread', pid)).toBe(0);
    expect(meta.copper).toBe(25 * 25 - 1);
  });

  it('buyItem count with partial bag fit refuses WHOLE with the bags-full toast (Q20)', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 10_000;
    // Leave exactly one free slot: 25 bread units need 2 (stack 20 + 5), so
    // 20 would fit and 5 would not; the buy must refuse whole, not grant 20.
    meta.inventory = Array.from({ length: 15 }, () => ({ itemId: 'worn_sword', count: 1 }));
    sim.drainEvents();
    items.buyItem(ctx, wilkes.id, 'baked_bread', pid, { count: 5 });
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');
    expect(sim.countItem('baked_bread', pid)).toBe(0);
    expect(meta.copper).toBe(10_000);
  });

  it('buyItem denies every hostile count with a toast and zero state change (Q20, acceptance c)', () => {
    for (const hostile of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2.5]) {
      const sim = makeWorld();
      const { pid, wilkes, meta } = vendorPlayer(sim);
      meta.copper = 1_000;
      sim.drainEvents();
      items.buyItem(ctxOf(sim), wilkes.id, 'baked_bread', pid, { count: hostile });
      expect(errorTexts(sim.drainEvents()), `count ${hostile}`).toContain(
        'That item is not for sale.',
      );
      expect(sim.countItem('baked_bread', pid), `count ${hostile}`).toBe(0);
      expect(meta.copper, `count ${hostile}`).toBe(1_000);
    }
  });

  it('a dead buyer with a hostile count hears the dead refusal, not the sanitize toast (refusal order)', () => {
    // The fix round placed sanitize BELOW the dead/range gates on purpose;
    // this pin keeps a refactor from hoisting it back above them, which
    // would swap which refusal a dead buyer hears.
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    meta.copper = 1_000;
    sim.entities.get(pid)!.dead = true;
    sim.drainEvents();
    items.buyItem(ctxOf(sim), wilkes.id, 'baked_bread', pid, { count: 0 });
    const errors = errorTexts(sim.drainEvents());
    expect(errors).toContain("You can't do that while dead.");
    expect(errors).not.toContain('That item is not for sale.');
    expect(sim.countItem('baked_bread', pid)).toBe(0);
    expect(meta.copper).toBe(1_000);
  });

  it('an out-of-range buyer with a hostile count hears the range refusal, not the sanitize toast', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    meta.copper = 1_000;
    const player = sim.entities.get(pid)!;
    player.pos.x = wilkes.pos.x + 100;
    sim.drainEvents();
    items.buyItem(ctxOf(sim), wilkes.id, 'baked_bread', pid, { count: 0 });
    const errors = errorTexts(sim.drainEvents());
    expect(errors).toContain('Too far away.');
    expect(errors).not.toContain('That item is not for sale.');
    expect(sim.countItem('baked_bread', pid)).toBe(0);
    expect(meta.copper).toBe(1_000);
  });

  it('a hostile count on a mount row denies with zero state change (Q20 on every row)', () => {
    // Sanitize sits ABOVE the riding delegation and the mount gates: a
    // hostile count must deny on EVERY row, including the two that force-1 a
    // VALID count. The riding twin lives in tests/mounts_training.test.ts
    // beside its rig. This arm passes every mount gate, so it pins that
    // mount rows sanitize AT ALL; the ordering arm is the untrained one
    // below.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'MountHostileBuyer');
    sim.setPlayerLevel(20);
    const meta = sim.meta(pid)!;
    meta.ridingTrained = true;
    meta.copper = 100_000_000;
    const marla = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'stablemaster_marla',
    )!;
    const player = sim.entities.get(pid)!;
    player.pos.x = marla.pos.x;
    player.pos.z = marla.pos.z;
    sim.drainEvents();
    items.buyItem(ctxOf(sim), marla.id, 'reins_valorsteed', pid, { count: 0 });
    expect(errorTexts(sim.drainEvents())).toContain('That item is not for sale.');
    expect(sim.countItem('reins_valorsteed', pid)).toBe(0);
    expect(meta.copper).toBe(100_000_000);
  });

  it('an UNTRAINED buyer with a hostile count on a mount row hears the sanitize deny first (ordering)', () => {
    // The refusal-order consequence of the hoist, recorded as a pin: sanitize
    // now beats the mount gates, so a crafted hostile-count frame from an
    // untrained buyer hears the not-for-sale deny rather than the riding
    // hint. Legit frames (count absent or 1) pass sanitize and keep today's
    // gate order untouched.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'UntrainedMountHostile');
    sim.setPlayerLevel(20);
    const meta = sim.meta(pid)!;
    meta.copper = 100_000_000;
    const marla = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'stablemaster_marla',
    )!;
    const player = sim.entities.get(pid)!;
    player.pos.x = marla.pos.x;
    player.pos.z = marla.pos.z;
    sim.drainEvents();
    items.buyItem(ctxOf(sim), marla.id, 'reins_valorsteed', pid, { count: 0 });
    const errors = errorTexts(sim.drainEvents());
    expect(errors).toContain('That item is not for sale.');
    expect(errors).not.toContain('You must learn to ride first. Find a riding trainer.');
    expect(meta.copper).toBe(100_000_000);
  });

  it('a count purchase emits exactly ONE vendor event carrying no count (Q25)', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    meta.copper = 1_000;
    sim.drainEvents();
    items.buyItem(ctxOf(sim), wilkes.id, 'baked_bread', pid, { count: 5 });
    const vendorEvents = sim.drainEvents().filter((e) => e.type === 'vendor');
    // The exact event shape: one emit per command, no quantity field. A count
    // field appearing here, or an emit moved inside a per-purchase loop,
    // must fail this pin (the settled Q25: FCT/log stay quantity-blind).
    expect(vendorEvents).toEqual([{ type: 'vendor', action: 'buy', itemId: 'baked_bread', pid }]);
  });

  it('bulk still wins when a crafted frame pairs it with a HOSTILE count (no deny, the bulk buy runs)', () => {
    // The bulk-wins rule discards the count BEFORE sanitize, so the crafted
    // probe shape {bulk, count: 0} is a plain bulk purchase, not a deny.
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    meta.copper = 250;
    sim.drainEvents();
    items.buyItem(ctxOf(sim), wilkes.id, 'minor_healing_potion', pid, { bulk: true, count: 0 });
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(sim.countItem('minor_healing_potion', pid)).toBe(6);
    expect(meta.copper).toBe(250 - 6 * 40);
  });

  it('buyItem denies a safe-integer magnitude attack with the money toast, minting nothing', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    // 1e15 passes sanitize (a safe integer), then 25c x 5e15 units overflows
    // the safe range and the totals guard refuses with the money toast: no
    // mint, no grant. This arm alone cannot distinguish the guard from the
    // plain balance compare (both answer the same toast here); the DECISIVE
    // guard arm is the free-vendor units overflow in
    // tests/ptr_dev_vendor.test.ts, where the two paths answer differently.
    meta.copper = 1_000;
    sim.drainEvents();
    items.buyItem(ctxOf(sim), wilkes.id, 'baked_bread', pid, { count: 1e15 });
    expect(errorTexts(sim.drainEvents())).toContain('Not enough money.');
    expect(sim.countItem('baked_bread', pid)).toBe(0);
    expect(meta.copper).toBe(1_000);
  });

  it('buyItem count on a non-stacking row buys N copies into N slots (the row-unit model)', () => {
    // Q23's settled model is row-unit purchases with an enumerated force-1
    // set (honor, soulbound, mount, riding); stackability is NOT in it, so a
    // 3x handaxe click is 3 one-unit purchases, unlike the bulk verb, which
    // deliberately requires a stacking row. Pinned so the choice is explicit
    // behavior, not an accident; whether non-stackables should join force-1
    // is recorded as an open maintainer item in the phase 21 build record.
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    meta.copper = 100;
    items.buyItem(ctxOf(sim), wilkes.id, 'handaxe', pid, { count: 3 });
    expect(sim.countItem('handaxe', pid)).toBe(3);
    // Three one-per-slot copies, not one stack of three.
    expect(meta.inventory.filter((s) => s.itemId === 'handaxe').length).toBe(3);
    expect(meta.copper).toBe(100 - 3 * 20);
  });

  it('buyItem bulk wins over count on a crafted frame carrying both (the shipped verb)', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    // Bulk semantics: floor(250 / 40) = 6 potions for 240c. The count-5 path
    // would have bought 5 for 200c, so both outcomes distinguish the arms.
    meta.copper = 250;
    items.buyItem(ctxOf(sim), wilkes.id, 'minor_healing_potion', pid, { bulk: true, count: 5 });
    expect(sim.countItem('minor_healing_potion', pid)).toBe(6);
    expect(meta.copper).toBe(250 - 6 * 40);
  });

  it('buyItem count on an Honor-priced row is forced to one purchase (Q23)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'HonorCountBuyer');
    const meta = sim.meta(pid)!;
    const fury = [...sim.entities.values()].find((entity) => entity.templateId === 'fury')!;
    const player = sim.entities.get(pid)!;
    player.pos.x = fury.pos.x;
    player.pos.z = fury.pos.z;
    meta.inventory.length = 0;
    meta.honor = 10_000;

    items.buyItem(ctxOf(sim), fury.id, 'final_argument_greatblade', pid, { count: 5 });

    // One purchase, one per-purchase honor debit: never 5 x 800.
    expect(sim.countItem('final_argument_greatblade', pid)).toBe(1);
    expect(meta.honor).toBe(10_000 - 800);
  });

  it('buyItem count on a dual-price row is forced to one purchase charging both currencies once', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'DualPriceCountBuyer');
    const meta = sim.meta(pid)!;
    const fury = [...sim.entities.values()].find((entity) => entity.templateId === 'fury')!;
    const player = sim.entities.get(pid)!;
    player.pos.x = fury.pos.x;
    player.pos.z = fury.pos.z;
    meta.inventory.length = 0;
    const testId = 'test_warfare_rations_count';
    ITEMS[testId] = {
      id: testId,
      name: 'Test Warfare Rations Count',
      kind: 'food',
      foodHp: 100,
      buyValue: 10,
      priceHonor: 7,
      sellValue: 1,
    };
    fury.vendorItems.push(testId);
    try {
      meta.copper = 500;
      meta.honor = 70;
      items.buyItem(ctxOf(sim), fury.id, testId, pid, { count: 5 });
      // Forced to one purchase: 5 food units, 50 copper (10 x 5 units), 7
      // honor (per purchase, once). A multiplied honor debit here is the
      // duplicate-soulbound class Q23 exists to prevent.
      expect(sim.countItem(testId, pid)).toBe(5);
      expect(meta.copper).toBe(500 - 50);
      expect(meta.honor).toBe(70 - 7);
    } finally {
      fury.vendorItems.splice(fury.vendorItems.indexOf(testId), 1);
      delete ITEMS[testId];
    }
  });

  it('buyItem count never buys more than one mount (Q23)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'MountCountBuyer');
    sim.setPlayerLevel(20);
    const meta = sim.meta(pid)!;
    meta.inventory.length = 0;
    meta.ridingTrained = true;
    meta.copper = 100_000_000;
    const marla = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'stablemaster_marla',
    )!;
    const player = sim.entities.get(pid)!;
    player.pos.x = marla.pos.x;
    player.pos.z = marla.pos.z;

    items.buyItem(ctxOf(sim), marla.id, 'reins_valorsteed', pid, { count: 5 });

    expect(sim.countItem('reins_valorsteed', pid)).toBe(1);
    expect(meta.copper).toBe(100_000_000 - 100_000);
  });

  it('buyback stays one unit per click beside the count path (Q18 exclusion)', () => {
    const sim = makeWorld();
    const { pid, wilkes, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 1_000;
    items.buyItem(ctx, wilkes.id, 'baked_bread', pid);
    items.sellItem(ctx, 'baked_bread', 5, pid);
    expect(sim.countItem('baked_bread', pid)).toBe(0);
    // One redemption call restores exactly ONE unit off the 5-count row: the
    // count widening must not leak into the index-addressed buyback shape.
    items.buyBackItem(ctx, 'baked_bread', 0, pid);
    expect(sim.countItem('baked_bread', pid)).toBe(1);
    expect(meta.vendorBuyback[0]?.count).toBe(4);
  });

  it('buyItem count drive lands identical state across two same-seed sims (stability smoke)', () => {
    const run = () => {
      const sim = makeWorld();
      const { pid, wilkes, meta } = vendorPlayer(sim);
      const ctx = ctxOf(sim);
      meta.copper = 5_000;
      items.buyItem(ctx, wilkes.id, 'baked_bread', pid, { count: 3 });
      items.buyItem(ctx, wilkes.id, 'minor_healing_potion', pid, { count: 7 });
      items.buyItem(ctx, wilkes.id, 'baked_bread', pid, { count: 999 }); // refused whole (unaffordable)
      items.buyItem(ctx, wilkes.id, 'minor_healing_potion', pid);
      return {
        copper: meta.copper,
        inventory: JSON.parse(JSON.stringify(meta.inventory)) as unknown,
      };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.copper).toBe(5_000 - 3 * 125 - 7 * 40 - 40);
  });

  it('sellAllJunk bulk-sells only gray items, records each stack, emits one summary line', () => {
    const sim = makeWorld();
    const { pid, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    meta.copper = 0;
    // wolf_fang is a crafting reagent now (quality common, never
    // swept), so this sweep uses mudfin_scale as its gray fodder.
    sim.addItem('mudfin_scale', 2, pid); // poor, sellValue 5 -> 10
    sim.addItem('bandit_bandana', 1, pid); // poor, sellValue 6
    sim.addItem('wolf_fang', 1, pid); // reagent (common, white) -> kept
    sim.addItem('apprentice_staff', 1, pid); // not poor -> kept
    sim.drainEvents();

    items.sellAllJunk(ctx, pid);
    expect(sim.countItem('mudfin_scale', pid)).toBe(0);
    expect(sim.countItem('bandit_bandana', pid)).toBe(0);
    expect(sim.countItem('wolf_fang', pid)).toBe(1);
    expect(sim.countItem('apprentice_staff', pid)).toBe(1);
    expect(meta.copper).toBe(2 * 5 + 6); // 16
    expect(meta.vendorBuyback.some((s) => s.itemId === 'mudfin_scale' && s.count === 2)).toBe(true);
    const summary = sim
      .drainEvents()
      .filter((e) => e.type === 'loot' && /^Sold \d+ junk item/.test((e as { text: string }).text));
    expect(summary).toHaveLength(1);
  });

  it('junkSellableSlot is the one sweep rule: every arm decides, and the HUD preview consumes it', () => {
    // The predicate is shared by sellAllJunk and the vendor preview in
    // hud.ts renderVendor; per-arm decisiveness here plus the source pin
    // below keep the two surfaces from ever drifting apart again.
    const gray: ItemDef = ITEMS.mudfin_scale;
    const slot = { count: 1 };
    expect(items.junkSellableSlot(gray, slot)).toBe(true);
    expect(items.junkSellableSlot(undefined, slot)).toBe(false);
    expect(items.junkSellableSlot(ITEMS.wolf_fang, slot)).toBe(false); // common, not poor
    expect(items.junkSellableSlot({ ...gray, kind: 'quest' } as ItemDef, slot)).toBe(false);
    expect(items.junkSellableSlot({ ...gray, noVendorSell: true }, slot)).toBe(false);
    expect(items.junkSellableSlot({ ...gray, soulbound: true }, slot)).toBe(false);
    expect(items.junkSellableSlot(gray, { count: 0 })).toBe(false);
    expect(items.junkSellableSlot(gray, { count: 1, instance: { boundTo: 7 } })).toBe(false);
    expect(items.junkSellableSlot(gray, { count: 1, instance: { signer: 'Ana' } })).toBe(true);

    // The preview consumer moved behind the pure core at the merge
    // settlement: hud.ts renderVendor reads sellJunkButtonState
    // (hud/vendor/vendor_view.ts), and THAT is where the shared predicate
    // is consumed, so the chain is pinned at both links.
    const hud = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    expect(hud).toContain('sellJunkButtonState(this.sim.inventory, ITEMS)');
    const vendorView = readFileSync(
      path.resolve(process.cwd(), 'src/ui/hud/vendor/vendor_view.ts'),
      'utf8',
    );
    expect(vendorView).toContain('junkSellableSlot(items[slot.itemId], slot)');
  });

  it('buyBackItem repurchases via the silent add, spends copper, and clears the buyback slot', () => {
    const sim = makeWorld();
    const { pid, meta } = vendorPlayer(sim);
    const ctx = ctxOf(sim);
    sim.addItem('apprentice_staff', 1, pid);
    items.sellItem(ctx, 'apprentice_staff', 1, pid); // copper + 120, records buyback
    const copperAfterSell = meta.copper;

    items.buyBackItem(ctx, 'apprentice_staff', undefined, pid);
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
      items.buyBackItem(ctx, 'wolf_fang', undefined, pid);
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
