import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { baggedCopyAnchor } from '../src/sim/item_copy_anchor';
import { MAIL_DELIVERY_SECONDS } from '../src/sim/mail/post_office';
import { Sim } from '../src/sim/sim';
import { tradeInfoFor } from '../src/sim/social/trade';
import type { Entity, ItemInstancePayload } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const ITEM = 'greyjaw_hide_boots';
const first: ItemInstancePayload = {
  lootQuality: { version: 1, tier: 4, weights: [4, 900, 200, 6, 7] },
};
const second: ItemInstancePayload = {
  lootQuality: { version: 1, tier: 4, weights: [4, 200, 900, 6, 7] },
};
const makeWorld = () =>
  new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: { ...BUILTIN_WORLD, camps: [], groundObjects: [] },
  });
const meta = (sim: Sim, pid: number) => expectDefined(sim.players.get(pid));
const copies = (sim: Sim, pid: number) => meta(sim, pid).inventory.filter((s) => s.itemId === ITEM);

function standAt(sim: Sim, pid: number, target: Entity) {
  const player = expectDefined(sim.entities.get(pid));
  player.pos = { ...target.pos };
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
}
function npc(sim: Sim, templateId: string) {
  return expectDefined([...sim.entities.values()].find((e) => e.templateId === templateId));
}
function mailbox(sim: Sim, pid: number) {
  standAt(sim, pid, expectDefined(sim.entities.get(sim.postOffice.mailboxIds[0])));
}
function setup() {
  const sim = makeWorld();
  const owner = sim.addPlayer('warrior', 'Owner');
  const recipient = sim.addPlayer('mage', 'Recipient');
  meta(sim, owner).copper = 100000;
  meta(sim, recipient).copper = 100000;
  sim.addItemInstance(ITEM, structuredClone(first), owner);
  sim.addItemInstance(ITEM, structuredClone(second), owner);
  expect(copies(sim, owner).map((s) => s.instance)).toEqual([first, second]);
  return { sim, owner, recipient };
}

describe('loot quality survives real item custody commands', () => {
  it('deposits the selected copy, persists both containers and withdraws the same allocation', () => {
    const { sim, owner } = setup();
    standAt(sim, owner, npc(sim, 'bursar_fernando'));
    const index = meta(sim, owner).inventory.findIndex(
      (s) => s.instance?.lootQuality?.weights[1] === 900,
    );
    sim.bankDeposit(index, 1, owner);
    expect(meta(sim, owner).bank.inventory.map((s) => s.instance)).toEqual([first]);
    expect(copies(sim, owner).map((s) => s.instance)).toEqual([second]);
    const saved = JSON.parse(JSON.stringify(sim.serializeCharacter(owner)));
    const restored = makeWorld();
    const pid = restored.addPlayer('warrior', 'Owner', { state: saved });
    expect(meta(restored, pid).bank.inventory[0].instance).toEqual(first);
    expect(copies(restored, pid)[0].instance).toEqual(second);
    standAt(restored, pid, npc(restored, 'bursar_fernando'));
    restored.bankWithdraw(0, 1, pid);
    expect(copies(restored, pid).map((s) => s.instance)).toEqual([second, first]);
    expect(meta(restored, pid).bank.inventory).toHaveLength(0);
    const received = expectDefined(copies(restored, pid)[1].instance?.lootQuality);
    received.weights[1] = 1;
    expect(saved.bank.inventory[0].instance).toEqual(first);
    expect(copies(restored, pid)[0].instance).toEqual(second);
  });

  it('escrows, saves, reloads and claims an exact mailed copy while its id-mate stays home', () => {
    const { sim, owner, recipient } = setup();
    mailbox(sim, owner);
    sim.mailSend(
      'Recipient',
      'Equipment',
      'A gift.',
      0,
      [{ itemId: ITEM, count: 1, instance: first }],
      owner,
    );
    expect(copies(sim, owner).map((s) => s.instance)).toEqual([second]);
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));
    expect(
      save.mail.find((m: { items: unknown[] }) => m.items.length > 0).items[0].instance,
    ).toEqual(first);
    sim.loadMail(save);
    for (let tick = 0; tick < (MAIL_DELIVERY_SECONDS + 1) * 20; tick++) sim.tick();
    mailbox(sim, recipient);
    const letter = expectDefined(
      sim.mailInfoFor(recipient)?.messages.find((m) => m.kind === 'player'),
    );
    sim.mailTake(letter.id, recipient);
    expect(copies(sim, recipient).map((s) => s.instance)).toEqual([first]);
    expect(copies(sim, owner).map((s) => s.instance)).toEqual([second]);
    expect(
      sim.mailInfoFor(recipient)?.messages.find((m) => m.id === letter.id)?.items,
    ).toHaveLength(0);
  });

  it('lists both allocations separately, reloads escrow and buys the named listing', () => {
    const { sim, owner, recipient } = setup();
    const merchant = npc(sim, 'the_merchant');
    standAt(sim, owner, merchant);
    standAt(sim, recipient, merchant);
    sim.marketListInstance(ITEM, 500, first, owner);
    sim.marketListInstance(ITEM, 700, second, owner);
    expect(copies(sim, owner)).toHaveLength(0);
    const save = JSON.parse(JSON.stringify(sim.serializeMarket()));
    const restored = makeWorld();
    const seller = restored.addPlayer('warrior', 'Owner', {
      state: expectDefined(sim.serializeCharacter(owner)),
    });
    const buyer = restored.addPlayer('mage', 'Recipient', {
      state: expectDefined(sim.serializeCharacter(recipient)),
    });
    restored.loadMarket(save);
    standAt(restored, seller, npc(restored, 'the_merchant'));
    standAt(restored, buyer, npc(restored, 'the_merchant'));
    const listings = restored.marketListings.filter((l) => !l.house);
    expect(listings.map((l) => l.instance)).toEqual([first, second]);
    restored.marketBuy(listings[1].id, buyer);
    expect(copies(restored, buyer).map((s) => s.instance)).toEqual([second]);
    expect(restored.marketListings.filter((l) => !l.house).map((l) => l.instance)).toEqual([first]);
    restored.marketCancel(listings[0].id, seller);
    restored.marketCollect(seller);
    expect(copies(restored, seller).map((s) => s.instance)).toEqual([first]);
  });

  it('trades the authoritative previewed allocation and keeps the other copy unchanged', () => {
    const { sim, owner, recipient } = setup();
    standAt(sim, recipient, expectDefined(sim.entities.get(owner)));
    sim.tradeRequest(recipient, owner);
    sim.tradeAccept(recipient);
    sim.tradeSetOffer([{ itemId: ITEM, count: 1 }], 0, owner);
    expect(tradeInfoFor(sim.ctx, recipient)?.theirOffer.items).toEqual([
      { itemId: ITEM, count: 1, instance: second },
    ]);
    sim.tradeConfirm(owner);
    sim.tradeConfirm(recipient);
    expect(copies(sim, recipient).map((s) => s.instance)).toEqual([second]);
    expect(copies(sim, owner).map((s) => s.instance)).toEqual([first]);
  });

  it('refuses to substitute another allocation if the staged trade copy disappears', () => {
    const { sim, owner, recipient } = setup();
    standAt(sim, recipient, expectDefined(sim.entities.get(owner)));
    sim.tradeRequest(recipient, owner);
    sim.tradeAccept(recipient);
    sim.tradeSetOffer([{ itemId: ITEM, count: 1 }], 0, owner);
    expect(tradeInfoFor(sim.ctx, recipient)?.theirOffer.items[0].instance).toEqual(second);
    sim.removeItem(ITEM, 1, owner);
    sim.tradeConfirm(owner);
    sim.tradeConfirm(recipient);
    expect(copies(sim, recipient)).toHaveLength(0);
    expect(copies(sim, owner).map((s) => s.instance)).toEqual([first]);
  });

  it('sells a named copy and buys it back after relog without merging its id-mate', () => {
    const { sim, owner } = setup();
    const vendor = expectDefined(
      [...sim.entities.values()].find((e) => e.kind === 'npc' && e.vendorItems.length > 0),
    );
    standAt(sim, owner, vendor);
    const inventory = meta(sim, owner).inventory;
    const index = inventory.findIndex((s) => s.instance?.lootQuality?.weights[1] === 900);
    const anchor = expectDefined(baggedCopyAnchor(inventory, ITEM, index) ?? undefined);
    sim.sellItem(ITEM, 1, owner, index, anchor);
    expect(copies(sim, owner).map((s) => s.instance)).toEqual([second]);
    expect(meta(sim, owner).vendorBuyback[0].instance).toEqual(first);
    const save = JSON.parse(JSON.stringify(sim.serializeCharacter(owner)));
    const restored = makeWorld();
    const pid = restored.addPlayer('warrior', 'Owner', { state: save });
    standAt(restored, pid, npc(restored, vendor.templateId));
    restored.buyBackItem(ITEM, 0, first, pid);
    expect(copies(restored, pid).map((s) => s.instance)).toEqual([second, first]);
    expect(meta(restored, pid).vendorBuyback).toHaveLength(0);
  });
});
