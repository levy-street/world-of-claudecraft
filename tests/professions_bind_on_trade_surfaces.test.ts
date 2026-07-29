// The five bind-on-trade resonant reagents vs every item-transfer surface
// OUTSIDE the player trade: player mail (post_office.ts), World Market
// listing (market.ts),
// vendor buy/sell/sellAllJunk/buyback (items.ts), and the character bank
// (bank.ts). Probes the REAL Sim delegates, never internals.
//
// Vocabulary: an ARMED copy carries { bindOnTrade: true } (minted by
// resolveDisenchant); a STAMPED copy additionally carries boundTo (the applied
// lock, stamped by the first trade). Both are per-instance payloads, so the
// #1165 fungible-only escrow on mail/market is the load-bearing wall here.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { MAIL_DELIVERY_SECONDS, MAIL_POSTAGE } from '../src/sim/mail/post_office';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemInstancePayload, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const REAGENTS = [
  'resonant_thread',
  'resonant_hide',
  'resonant_links',
  'resonant_steel',
  'resonant_timber',
] as const;
const R = 'resonant_steel';

const makeWorld = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

function standAt(sim: Sim, pid: number, target: Entity): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing player');
  p.pos = { ...target.pos };
  p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

function mailboxEntity(sim: Sim): Entity {
  const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
  if (!box) throw new Error('no mailbox');
  return box;
}

function merchantEntity(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('no Merchant');
}

function vendorEntity(sim: Sim): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.vendorItems.length > 0) return e;
  }
  throw new Error('no vendor npc');
}

function bankerEntity(sim: Sim): Entity {
  const b = sim.entities.get(sim.bankerIds[0]);
  if (!b) throw new Error('no banker');
  return b;
}

function inv(sim: Sim, pid: number) {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error('no player meta');
  return r.meta.inventory;
}

function copperOf(sim: Sim, pid: number): number {
  return sim.players.get(pid)!.copper;
}

function setCopper(sim: Sim, pid: number, c: number): void {
  sim.players.get(pid)!.copper = c;
}

function slotsOf(sim: Sim, pid: number, itemId: string) {
  return inv(sim, pid).filter((s) => s.itemId === itemId);
}

function mailResults(events: SimEvent[]): Array<{ code: string }> {
  return events.filter((e) => e.type === 'mailResult') as unknown as Array<{ code: string }>;
}

function errorTexts(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function lootTexts(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'loot').map((e) => (e as { text: string }).text);
}

function tickFor(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds * 20); i++) sim.tick();
}

const ARMED: ItemInstancePayload = { bindOnTrade: true };
const STAMPED: ItemInstancePayload = { bindOnTrade: true, boundTo: 999 };

describe('content: the five typed reagents are not purchasable anywhere', () => {
  it('no reagent has a buyValue, honor price, soulbound, or list/sell deny flag', () => {
    for (const id of REAGENTS) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.buyValue, `${id} buyValue`).toBeUndefined();
      expect(def.priceHonor, `${id} priceHonor`).toBeUndefined();
      expect(def.soulbound, `${id} soulbound`).toBeFalsy();
      expect(def.kind, `${id} kind`).toBe('junk');
      expect(def.quality, `${id} quality`).toBe('rare');
      expect(def.sellValue, `${id} sellValue`).toBe(40);
    }
  });

  it('no live vendor stocks a reagent and no house market listing offers one', () => {
    const sim = makeWorld();
    for (const e of sim.entities.values()) {
      if (e.kind !== 'npc' || e.vendorItems.length === 0) continue;
      for (const id of REAGENTS) {
        expect(e.vendorItems, `${e.templateId} stocks ${id}`).not.toContain(id);
      }
    }
    for (const l of sim.marketListings) {
      expect((REAGENTS as readonly string[]).includes(l.itemId), `house listing ${l.itemId}`).toBe(
        false,
      );
    }
  });

  it('buyItem with a reagent id at a live vendor is refused and grants nothing', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Buyer');
    const vendor = vendorEntity(sim);
    standAt(sim, pid, vendor);
    setCopper(sim, pid, 100000);
    sim.drainEvents();
    sim.buyItem(vendor.id, R, pid);
    const events = sim.drainEvents();
    expect(errorTexts(events)).toContain('That item is not sold here.');
    expect(slotsOf(sim, pid, R)).toHaveLength(0);
    expect(copperOf(sim, pid)).toBe(100000);
  });
});

describe('mail: armed and stamped copies can never ride a raven', () => {
  function mailSetup() {
    const sim = makeWorld();
    const sender = sim.addPlayer('warrior', 'Sender');
    const recipient = sim.addPlayer('mage', 'Rex');
    standAt(sim, sender, mailboxEntity(sim));
    setCopper(sim, sender, 10000);
    sim.drainEvents();
    return { sim, sender, recipient };
  }

  it('an armed-unstamped copy (the only copy) is refused: fungible-only escrow', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(R, { ...ARMED }, sender);
    sim.mailSend('Rex', 'gift', 'take it', 0, [{ itemId: R, count: 1 }], sender);
    const codes = mailResults(sim.drainEvents()).map((m) => m.code);
    expect(codes).toContain('notEnoughItems');
    expect(codes).not.toContain('sent');
    const slots = slotsOf(sim, sender, R);
    expect(slots).toHaveLength(1);
    expect(slots[0].instance?.bindOnTrade).toBe(true);
    expect(copperOf(sim, sender)).toBe(10000); // no postage charged on refusal
  });

  it('a stamped (boundTo-locked) copy is refused the same way, payload intact', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(R, { ...STAMPED }, sender);
    sim.mailSend('Rex', 'gift', 'take it', 0, [{ itemId: R, count: 1 }], sender);
    const codes = mailResults(sim.drainEvents()).map((m) => m.code);
    expect(codes).toContain('notEnoughItems');
    const slots = slotsOf(sim, sender, R);
    expect(slots).toHaveLength(1);
    expect(slots[0].instance?.boundTo).toBe(999);
  });

  it('holding 1 plain + 1 stamped: mailing 2 is refused; mailing 1 sweeps ONLY the plain copy', () => {
    const { sim, sender, recipient } = mailSetup();
    sim.addItem(R, 1, sender); // the laundered-plain shape
    sim.addItemInstance(R, { ...STAMPED }, sender);
    sim.mailSend('Rex', 'two', 'both', 0, [{ itemId: R, count: 2 }], sender);
    expect(mailResults(sim.drainEvents()).map((m) => m.code)).toContain('notEnoughItems');

    sim.mailSend('Rex', 'one', 'just one', 0, [{ itemId: R, count: 1 }], sender);
    const codes = mailResults(sim.drainEvents()).map((m) => m.code);
    expect(codes).toContain('sent');
    // The surviving copy is the stamped instance, payload untouched.
    const left = slotsOf(sim, sender, R);
    expect(left).toHaveLength(1);
    expect(left[0].instance?.boundTo).toBe(999);
    expect(left[0].instance?.bindOnTrade).toBe(true);
    expect(copperOf(sim, sender)).toBe(10000 - MAIL_POSTAGE);

    // Delivery: the recipient receives exactly the one plain copy, still plain
    // (no payload was attached, none may be invented in transit).
    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    standAt(sim, recipient, mailboxEntity(sim));
    const info = sim.mailInfoFor(recipient);
    const letter = info?.messages.find(
      (m) => (m as unknown as { kind: string }).kind === 'player',
    ) as unknown as { id: number } | undefined;
    expect(letter).toBeDefined();
    sim.mailTake(letter!.id, recipient);
    const got = slotsOf(sim, recipient, R);
    expect(got).toHaveLength(1);
    expect(got[0].count).toBe(1);
    expect(got[0].instance).toBeUndefined();
  });
});

describe('World Market: armed and stamped copies can never be listed', () => {
  function marketSetup() {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Lister');
    standAt(sim, pid, merchantEntity(sim));
    sim.drainEvents();
    return { sim, pid };
  }

  it('listing an armed copy (the only copy) is refused with no escrow', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(R, { ...ARMED }, pid);
    const before = sim.marketListings.length;
    sim.marketList(R, 1, 100, pid);
    expect(errorTexts(sim.drainEvents())).toContain('You do not have that many to sell.');
    expect(sim.marketListings.length).toBe(before);
    const slots = slotsOf(sim, pid, R);
    expect(slots).toHaveLength(1);
    expect(slots[0].instance?.bindOnTrade).toBe(true);
  });

  it('listing a stamped copy is refused identically, payload intact', () => {
    const { sim, pid } = marketSetup();
    sim.addItemInstance(R, { ...STAMPED }, pid);
    const before = sim.marketListings.length;
    sim.marketList(R, 1, 100, pid);
    expect(errorTexts(sim.drainEvents())).toContain('You do not have that many to sell.');
    expect(sim.marketListings.length).toBe(before);
    expect(slotsOf(sim, pid, R)[0].instance?.boundTo).toBe(999);
  });

  it('1 plain + 1 stamped: listing 2 refused; listing 1 escrows ONLY the plain copy', () => {
    const { sim, pid } = marketSetup();
    sim.addItem(R, 1, pid);
    sim.addItemInstance(R, { ...STAMPED }, pid);
    const before = sim.marketListings.length;
    sim.marketList(R, 2, 100, pid);
    expect(errorTexts(sim.drainEvents())).toContain('You do not have that many to sell.');
    expect(sim.marketListings.length).toBe(before);

    sim.marketList(R, 1, 100, pid);
    sim.drainEvents();
    expect(sim.marketListings.length).toBe(before + 1);
    const left = slotsOf(sim, pid, R);
    expect(left).toHaveLength(1);
    expect(left[0].instance?.boundTo).toBe(999);
  });
});

describe('vendor: plain and armed copies sell, stamped copies are refused (wash closed)', () => {
  function vendorSetup() {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Seller');
    standAt(sim, pid, vendorEntity(sim));
    sim.drainEvents();
    return { sim, pid };
  }

  it('selling a stamped copy (the only copy) IS refused: the bond gates the vendor too', () => {
    // Closes the buyback-plain wash: this arm previously pinned the stamped
    // sell ALLOWED, but sell + buyback
    // stripped boundTo AND bindOnTrade for a 0 copper spread. The bond now
    // gates the vendor exactly like the trade.
    const { sim, pid } = vendorSetup();
    setCopper(sim, pid, 0);
    sim.addItemInstance(R, { ...STAMPED }, pid);
    sim.sellItem(R, 1, pid);
    const events = sim.drainEvents();
    expect(errorTexts(events)).toContain('That item is bound and cannot be sold.');
    expect(copperOf(sim, pid)).toBe(0);
    const kept = slotsOf(sim, pid, R);
    expect(kept).toHaveLength(1);
    expect(kept[0].instance).toEqual({ bindOnTrade: true, boundTo: 999 });
  });

  it('selling an ARMED (not yet stamped) copy stays allowed: only boundTo gates the vendor', () => {
    // The arm/stamp split is load-bearing: bindOnTrade alone is the primed
    // state (never traded yet), and an armed copy has no bond to launder, so
    // it sells exactly like a plain copy.
    const { sim, pid } = vendorSetup();
    setCopper(sim, pid, 0);
    sim.addItemInstance(R, { ...ARMED }, pid);
    sim.sellItem(R, 1, pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    expect(copperOf(sim, pid)).toBe(40);
    expect(slotsOf(sim, pid, R)).toHaveLength(0);
  });

  it('selling one while holding 1 plain + 1 stamped consumes the PLAIN copy first', () => {
    const { sim, pid } = vendorSetup();
    setCopper(sim, pid, 0);
    sim.addItem(R, 1, pid);
    sim.addItemInstance(R, { ...STAMPED }, pid);
    sim.sellItem(R, 1, pid);
    sim.drainEvents();
    expect(copperOf(sim, pid)).toBe(40);
    const left = slotsOf(sim, pid, R);
    expect(left).toHaveLength(1);
    expect(left[0].instance?.boundTo).toBe(999);
  });

  it('sellAllJunk never sweeps a reagent: kind junk but quality rare, not poor', () => {
    const { sim, pid } = vendorSetup();
    setCopper(sim, pid, 0);
    sim.addItem(R, 1, pid);
    sim.addItemInstance(R, { ...STAMPED }, pid);
    sim.sellAllJunk(pid);
    sim.drainEvents();
    expect(copperOf(sim, pid)).toBe(0);
    const left = slotsOf(sim, pid, R);
    expect(left.reduce((n, s) => n + s.count, 0)).toBe(2);
  });

  it('mixed-stack sell emits ONE kept notice beside the sold line, singular form', () => {
    // The ruled replacement for the silent partial: the clamp still sells the
    // unbound copy, and the player is told the bound one was spared.
    const { sim, pid } = vendorSetup();
    setCopper(sim, pid, 0);
    sim.addItem(R, 1, pid);
    sim.addItemInstance(R, { ...STAMPED }, pid);
    sim.sellItem(R, 2, pid);
    const loot = lootTexts(sim.drainEvents());
    expect(loot).toContain(`Sold ${ITEMS[R].name} for 40c.`);
    expect(loot).toContain('Kept 1 bound copy.');
    expect(copperOf(sim, pid)).toBe(40);
    const left = slotsOf(sim, pid, R);
    expect(left).toHaveLength(1);
    expect(left[0].instance?.boundTo).toBe(999);
  });

  it('mixed-stack sell with two spared copies uses the plural form', () => {
    const { sim, pid } = vendorSetup();
    setCopper(sim, pid, 0);
    sim.addItem(R, 1, pid);
    sim.addItemInstance(R, { ...STAMPED }, pid);
    sim.addItemInstance(R, { ...STAMPED }, pid);
    sim.sellItem(R, 3, pid);
    const loot = lootTexts(sim.drainEvents());
    expect(loot).toContain('Kept 2 bound copies.');
    expect(copperOf(sim, pid)).toBe(40);
    expect(slotsOf(sim, pid, R).reduce((n, s) => n + s.count, 0)).toBe(2);
  });

  it('a clean unbound sell stays silent: no kept notice on the happy path', () => {
    const { sim, pid } = vendorSetup();
    setCopper(sim, pid, 0);
    sim.addItem(R, 2, pid);
    sim.sellItem(R, 2, pid);
    const loot = lootTexts(sim.drainEvents());
    expect(loot).toContain(`Sold ${ITEMS[R].name} x2 for 80c.`);
    expect(loot.some((l) => l.startsWith('Kept'))).toBe(false);
    expect(copperOf(sim, pid)).toBe(80);
  });

  it('sellAllJunk spares a bound gray copy: the sweep mirrors the sellItem gate', () => {
    // No poor-quality def binds in shipped content; the arm exists so future
    // content can never reopen the buyback wash through the junk sweep. The
    // bound copy shares its itemId with plain fodder to prove the skip-aware
    // removal never consumes the spared slot.
    const { sim, pid } = vendorSetup();
    setCopper(sim, pid, 0);
    sim.addItem('mudfin_scale', 3, pid);
    sim.addItemInstance('mudfin_scale', { ...STAMPED }, pid);
    sim.sellAllJunk(pid);
    const loot = lootTexts(sim.drainEvents());
    expect(loot).toContain('Sold 3 junk items for 15c.');
    expect(copperOf(sim, pid)).toBe(15);
    const left = slotsOf(sim, pid, 'mudfin_scale');
    expect(left).toHaveLength(1);
    expect(left[0].count).toBe(1);
    expect(left[0].instance).toEqual({ bindOnTrade: true, boundTo: 999 });
  });
});

describe('bank: a stamped copy round-trips payload-intact (self-storage, no transfer)', () => {
  it('deposit then withdraw preserves bindOnTrade AND boundTo byte-for-byte', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Hoarder');
    standAt(sim, pid, bankerEntity(sim));
    sim.addItemInstance(R, { ...STAMPED }, pid);
    sim.drainEvents();

    const idx = inv(sim, pid).findIndex((s) => s.itemId === R);
    expect(idx).toBeGreaterThanOrEqual(0);
    sim.bankDeposit(idx, undefined, pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    expect(slotsOf(sim, pid, R)).toHaveLength(0);
    const bank = sim.ctx.resolve(pid)!.meta.bank.inventory;
    const banked = bank.find((s) => s.itemId === R);
    expect(banked?.instance?.boundTo).toBe(999);
    expect(banked?.instance?.bindOnTrade).toBe(true);

    const bidx = bank.findIndex((s) => s.itemId === R);
    sim.bankWithdraw(bidx, undefined, pid);
    expect(errorTexts(sim.drainEvents())).toHaveLength(0);
    const back = slotsOf(sim, pid, R);
    expect(back).toHaveLength(1);
    expect(back[0].instance?.boundTo).toBe(999);
    expect(back[0].instance?.bindOnTrade).toBe(true);
  });
});
