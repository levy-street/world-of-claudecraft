// End-to-end pins for the bind-on-pickup party trade window through a REAL
// Sim: the trade offer/confirm path (src/sim/social/trade.ts) and the
// equip-ends-it rule (src/sim/items.ts equipmentPayloadFor). The window's
// pure semantics live in tests/bop_trade_window.test.ts and the award-time
// stamping in tests/loot_roll.test.ts; here the copies move between players.
import { describe, expect, it } from 'vitest';
import { BOP_PARTY_TRADE_MS } from '../src/sim/loot/bop_trade_window';
import { grantAwardedLootItem } from '../src/sim/loot/loot_roll';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const HELM = 'slagbreaker_helmet'; // soulbound epic warrior tier piece

function tradeSim() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const alice = sim.addPlayer('warrior', 'Alice');
  const bob = sim.addPlayer('warrior', 'Bob');
  const cara = sim.addPlayer('warrior', 'Cara');
  // Co-locate everyone: trade requires TRADE_RANGE (10 yd).
  for (const pid of [alice, bob, cara]) {
    const e = sim.entities.get(pid);
    if (!e) throw new Error('missing player entity');
    e.pos = { x: 0, y: 0, z: 0 };
    e.prevPos = { x: 0, y: 0, z: 0 };
    sim.rebucket(e);
  }
  return { sim, alice, bob, cara };
}

function meta(sim: Sim, pid: number): PlayerMeta {
  const m = sim.ctx.players.get(pid);
  if (!m) throw new Error(`expected player ${pid}`);
  return m;
}

function windowFor(sim: Sim, eligible: string[]): ItemInstancePayload {
  return {
    partyTrade: { untilMs: Math.floor(sim.time * 1000) + BOP_PARTY_TRADE_MS, eligible },
  };
}

function openTrade(sim: Sim, from: number, to: number): void {
  sim.tradeRequest(to, from);
  sim.tradeAccept(to);
}

function runTrade(sim: Sim, from: number, to: number, itemId: string): void {
  openTrade(sim, from, to);
  sim.tradeSetOffer([{ itemId, count: 1 }], 0, from);
  sim.tradeConfirm(from);
  sim.tradeConfirm(to);
}

describe('BoP party trade window: the trade path', () => {
  it('trades a windowed soulbound copy to a drop-moment member, window riding intact', () => {
    const { sim, alice, bob } = tradeSim();
    const instance = windowFor(sim, ['Alice', 'Bob']);
    sim.addItemInstance(HELM, instance, alice);

    runTrade(sim, alice, bob, HELM);

    expect(sim.countItem(HELM, alice)).toBe(0);
    const received = expectDefined(meta(sim, bob).inventory.find((s) => s.itemId === HELM));
    // The window RIDES the copy: same deadline, same drop-moment snapshot, so
    // the recipient can pass it on within the same window.
    expect(received.instance?.partyTrade).toEqual(instance.partyTrade);
  });

  it('never offers the copy to a player outside the drop-moment snapshot', () => {
    const { sim, alice, cara } = tradeSim();
    sim.addItemInstance(HELM, windowFor(sim, ['Alice', 'Bob']), alice);

    runTrade(sim, alice, cara, HELM);

    expect(sim.countItem(HELM, alice)).toBe(1);
    expect(sim.countItem(HELM, cara)).toBe(0);
  });

  it('never offers a copy whose window has expired, even to a drop-moment member', () => {
    const { sim, alice, bob } = tradeSim();
    sim.addItemInstance(HELM, { partyTrade: { untilMs: 0, eligible: ['Alice', 'Bob'] } }, alice);

    runTrade(sim, alice, bob, HELM);

    expect(sim.countItem(HELM, alice)).toBe(1);
    expect(sim.countItem(HELM, bob)).toBe(0);
  });

  it('never offers a plain soulbound copy that carries no window at all', () => {
    const { sim, alice, bob } = tradeSim();
    sim.addItem(HELM, 1, alice);

    runTrade(sim, alice, bob, HELM);

    expect(sim.countItem(HELM, alice)).toBe(1);
    expect(sim.countItem(HELM, bob)).toBe(0);
  });

  it('the recipient can pass the copy onward, but only within the same drop-moment snapshot', () => {
    const { sim, alice, bob, cara } = tradeSim();
    sim.addItemInstance(HELM, windowFor(sim, ['Alice', 'Bob']), alice);
    runTrade(sim, alice, bob, HELM);
    expect(sim.countItem(HELM, bob)).toBe(1);

    // Cara was not in the party at the drop moment: refused.
    runTrade(sim, bob, cara, HELM);
    expect(sim.countItem(HELM, bob)).toBe(1);
    expect(sim.countItem(HELM, cara)).toBe(0);

    // Back to Alice, who was: allowed.
    runTrade(sim, bob, alice, HELM);
    expect(sim.countItem(HELM, bob)).toBe(0);
    expect(sim.countItem(HELM, alice)).toBe(1);
  });

  it('a windowed copy never launders a plain soulbound stack through the walk', () => {
    const { sim, alice, bob } = tradeSim();
    // One plain (windowless) copy AND one windowed copy of the same id: only
    // the windowed copy may ever ship, and offering two clamps to one.
    sim.addItem(HELM, 1, alice);
    const instance = windowFor(sim, ['Alice', 'Bob']);
    sim.addItemInstance(HELM, instance, alice);

    openTrade(sim, alice, bob);
    sim.tradeSetOffer([{ itemId: HELM, count: 2 }], 0, alice);
    sim.tradeConfirm(alice);
    sim.tradeConfirm(bob);

    expect(sim.countItem(HELM, alice)).toBe(1);
    const kept = meta(sim, alice).inventory.find((s) => s.itemId === HELM);
    expect(kept?.instance).toBeUndefined(); // the plain copy stayed home
    const received = meta(sim, bob).inventory.find((s) => s.itemId === HELM);
    expect(received?.instance?.partyTrade).toEqual(instance.partyTrade);
  });
});

describe('BoP party trade window: equipping ends it', () => {
  it('strips the window on equip, so the unequipped copy can no longer be traded', () => {
    const { sim, alice, bob } = tradeSim();
    const aliceMeta = meta(sim, alice);
    const aliceEntity = expectDefined(sim.entities.get(alice));
    aliceEntity.level = 25; // the equip level gate reads the entity; the helm requires 20
    sim.addItemInstance(HELM, windowFor(sim, ['Alice', 'Bob']), alice);

    sim.equipItem(HELM, alice);
    expect(aliceMeta.equipment.helmet).toBe(HELM);
    // The worn payload never carries the window (the payload collapses to
    // nothing here: the window was its only field).
    expect(aliceMeta.equipmentInstance?.helmet?.partyTrade).toBeUndefined();

    sim.unequipItem('helmet', alice);
    const benched = expectDefined(aliceMeta.inventory.find((s) => s.itemId === HELM));
    expect(benched.instance?.partyTrade).toBeUndefined();

    // And the trade path agrees: the copy is now permanently soulbound.
    runTrade(sim, alice, bob, HELM);
    expect(sim.countItem(HELM, alice)).toBe(1);
    expect(sim.countItem(HELM, bob)).toBe(0);
  });
});

describe('BoP party trade window: award and refusal details', () => {
  it('a windowed grant never auto-equips: equipping would strip the window on arrival', () => {
    const { sim, alice } = tradeSim();
    const aliceMeta = meta(sim, alice);
    const aliceEntity = expectDefined(sim.entities.get(alice));
    aliceEntity.level = 25;
    aliceMeta.autoEquip = true;

    grantAwardedLootItem(sim.ctx, HELM, alice, { names: ['Alice', 'Bob'], characterIds: [] });

    expect(aliceMeta.equipment.helmet).toBeUndefined();
    const slot = expectDefined(aliceMeta.inventory.find((s) => s.itemId === HELM));
    expect(slot.instance?.partyTrade?.eligible).toEqual(['Alice', 'Bob']);
  });

  it('tells the player when a windowed copy cannot go to THIS counterparty', () => {
    const { sim, alice, cara } = tradeSim();
    sim.addItemInstance(HELM, windowFor(sim, ['Alice', 'Bob']), alice);
    sim.drainEvents();

    openTrade(sim, alice, cara);
    sim.tradeSetOffer([{ itemId: HELM, count: 1 }], 0, alice);

    const refusal = sim
      .drainEvents()
      .find(
        (event) =>
          event.type === 'error' &&
          event.text === 'That can only be traded to players who shared its drop.',
      );
    expect(refusal).toBeDefined();
  });

  it('stays silent for a plain windowless soulbound copy (the historical posture)', () => {
    const { sim, alice, bob } = tradeSim();
    sim.addItem(HELM, 1, alice);
    sim.drainEvents();

    openTrade(sim, alice, bob);
    sim.tradeSetOffer([{ itemId: HELM, count: 1 }], 0, alice);

    expect(sim.drainEvents().some((event) => event.type === 'error')).toBe(false);
  });
});

describe('BoP party trade window: stable ids beat names across a rename', () => {
  function idTradeSim() {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const alice = sim.addPlayer('warrior', 'Alice', { characterId: 11 });
    const bob = sim.addPlayer('warrior', 'Bob', { characterId: 22 });
    const mallory = sim.addPlayer('warrior', 'Mallory', { characterId: 99 });
    for (const pid of [alice, bob, mallory]) {
      const e = sim.entities.get(pid);
      if (!e) throw new Error('missing player entity');
      e.pos = { x: 0, y: 0, z: 0 };
      e.prevPos = { x: 0, y: 0, z: 0 };
      sim.rebucket(e);
    }
    return { sim, alice, bob, mallory };
  }

  function idWindowFor(sim: Sim): ItemInstancePayload {
    return {
      partyTrade: {
        untilMs: Math.floor(sim.time * 1000) + BOP_PARTY_TRADE_MS,
        eligible: ['Alice', 'Bob'],
        eligibleIds: [11, 22],
      },
    };
  }

  it('a renamed drop-mate can still receive the copy: the id matches, the name no longer does', () => {
    const { sim, alice, bob } = idTradeSim();
    meta(sim, bob).name = 'Bobrenamed';
    sim.addItemInstance(HELM, idWindowFor(sim), alice);

    runTrade(sim, alice, bob, HELM);

    expect(sim.countItem(HELM, bob)).toBe(1);
  });

  it('a stranger who took a freed drop-mate name is refused: name matches, id does not', () => {
    const { sim, alice, mallory } = idTradeSim();
    meta(sim, mallory).name = 'Bob'; // squats the freed name inside the window
    sim.addItemInstance(HELM, idWindowFor(sim), alice);

    runTrade(sim, alice, mallory, HELM);

    expect(sim.countItem(HELM, alice)).toBe(1);
    expect(sim.countItem(HELM, mallory)).toBe(0);
  });
});
