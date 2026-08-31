// The Ravenpost (src/sim/mail/post_office.ts): welcome letter, player-to-player
// sending with coin/parcel escrow, raven delivery delay, mailbox proximity
// gating, take/delete rules, quest thank-you letters, persistence round-trip,
// and rename rekeying. Pure sim tests: construct a Sim, advance fixed ticks.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import {
  HEROIC_MARK_LETTER,
  QUEST_LETTERS,
  WELCOME_LETTER,
  WOC_MARKET_DELIVERY_LETTER,
} from '../src/sim/content/letters';
import { MAILBOXES } from '../src/sim/content/mailboxes';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  MAIL_ATTACHMENT_EXPIRY_SECONDS,
  MAIL_DELIVERY_SECONDS,
  MAIL_MAX_ATTACHMENTS,
  MAIL_PERSIST_REFRESH_SECONDS,
  MAIL_POSTAGE,
} from '../src/sim/mail/post_office';
import type { MailSave } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimEvent, WorldContent } from '../src/sim/types';

// Mailboxes are system-owned and still spawn with this fixture. Ambient camps,
// NPCs and quest objects are irrelevant to delivery/index invariants and would
// turn every simulated minute into a continent-wide AI benchmark.
const MAIL_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

const makeWorld = () =>
  new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: MAIL_TEST_WORLD });

function moveToMailbox(sim: Sim, pid: number): void {
  const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
  const p = sim.entities.get(pid);
  if (!box || !p) throw new Error('missing mailbox or player');
  p.pos = { ...box.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

function moveAwayFromMailboxes(sim: Sim, pid: number): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing player');
  p.pos = sim.groundPos(50, 0);
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

function tickFor(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.ceil(seconds * 20); i++) out.push(...sim.tick());
  return out;
}

describe('mailboxes in the world', () => {
  it('spawns one interactable mailbox object per town', () => {
    const sim = makeWorld();
    expect(sim.postOffice.mailboxIds).toHaveLength(MAILBOXES.length);
    for (const id of sim.postOffice.mailboxIds) {
      const box = sim.entities.get(id);
      expect(box?.kind).toBe('object');
      expect(box?.templateId).toBe('mailbox');
      expect(box?.lootable).toBe(true);
      expect(box?.objectItemId).toBeNull();
    }
  });

  it('covers every current town hub with a usable Ravenpost mailbox', () => {
    const sim = makeWorld();
    const boxes = sim.postOffice.mailboxIds.map((id) => sim.entities.get(id));
    const missingHubNames: string[] = [];

    for (const zone of BUILTIN_WORLD.zones) {
      const mailbox = boxes.find(
        (box) =>
          box?.kind === 'object' &&
          box.templateId === 'mailbox' &&
          Math.hypot(box.pos.x - zone.hub.x, box.pos.z - zone.hub.z) <= zone.hub.radius,
      );
      if (!mailbox) {
        missingHubNames.push(zone.hub.name);
        continue;
      }

      const pid = sim.addPlayer('warrior', `Postie ${zone.id}`);
      const player = sim.entities.get(pid);
      if (!player) throw new Error(`missing test player for ${zone.id}`);
      player.pos = { ...mailbox.pos };
      player.prevPos = { ...player.pos };
      sim.rebucket(player);

      sim.interact(pid);
      expect(
        sim.drainEvents().some((event) => event.type === 'mailbox' && event.pid === pid),
        zone.hub.name,
      ).toBe(true);
      expect(sim.mailInfoFor(pid), zone.hub.name).not.toBeNull();
    }

    expect(missingHubNames).toEqual([]);
  });

  it('keyboard interact at a mailbox emits the open-mailbox cue', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Postie');
    moveToMailbox(sim, pid);
    sim.interact(pid);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'mailbox' && e.pid === pid)).toBe(true);
  });
});

describe('the welcome letter', () => {
  it('greets a new character exactly once, with the enclosed coin', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Newbie');
    expect(sim.mailUnreadFor(pid)).toBe(1);
    moveToMailbox(sim, pid);
    const info = sim.mailInfoFor(pid);
    expect(info).not.toBeNull();
    expect(info?.messages[0]?.letterId).toBe(WELCOME_LETTER.letterId);
    expect(info?.messages[0]?.copper).toBe(WELCOME_LETTER.copper);
    expect(info?.messages[0]?.kind).toBe('system');
  });

  it('is not re-sent to a character whose save says it was already welcomed', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Veteran');
    const state = sim.serializeCharacter(pid);
    expect(state?.mailWelcomed).toBe(true);
    const sim2 = makeWorld();
    const pid2 = sim2.addPlayer('warrior', 'Veteran', { state: state ?? undefined });
    expect(sim2.mailUnreadFor(pid2)).toBe(0);
  });
});

describe('sending a letter', () => {
  it('escrows coin, parcels and postage, then delivers after the flight', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    sim.addItem('roasted_boar', 3, alice);
    sim.drainEvents();
    moveToMailbox(sim, alice);

    sim.mailSend(
      'Bob',
      'Provisions',
      'Eat well.',
      500,
      [{ itemId: 'roasted_boar', count: 2 }],
      alice,
    );
    const sent = sim.drainEvents();
    expect(sent.some((e) => e.type === 'mailResult' && e.code === 'sent' && e.pid === alice)).toBe(
      true,
    );
    expect(aliceMeta.copper).toBe(10_000 - 500 - MAIL_POSTAGE);
    expect(sim.countItem('roasted_boar', alice)).toBe(1);

    // Still on the wing: only the welcome letter sits in Bob's box.
    expect(sim.mailUnreadFor(bob)).toBe(1);
    const events = tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    expect(sim.mailUnreadFor(bob)).toBe(2);
    expect(
      events.some((e) => e.type === 'mailArrived' && e.pid === bob && e.senderName === 'Alice'),
    ).toBe(true);
  });

  it('streams older delivered mail beyond the first fifty rows so it can be opened', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 100_000;
    moveToMailbox(sim, alice);

    for (let i = 0; i < 60; i++) {
      sim.mailSend('Bob', `Letter ${i}`, `Body ${i}`, 0, [], alice);
    }
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    moveToMailbox(sim, bob);

    const info = sim.mailInfoFor(bob);
    expect(info).not.toBeNull();
    expect(info?.totalCount).toBe(61);
    expect(info?.messages).toHaveLength(61);
    expect(info?.messages.some((m) => m.subject === 'Letter 0')).toBe(true);
    expect(info?.messages.some((m) => m.subject === 'Letter 59')).toBe(true);
  });

  it('refuses what the post refuses', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 5;
    sim.drainEvents();

    const lastCode = () => {
      const events = sim.drainEvents();
      const r = events.filter((e) => e.type === 'mailResult').pop();
      return r && r.type === 'mailResult' ? r.code : null;
    };

    // The rebuilt Eastbrook mailbox is intentionally close to the fresh start,
    // so move to an explicit non-service point for the proximity denial.
    moveAwayFromMailboxes(sim, alice);
    sim.mailSend('Alice', 'x', 'y', 0, [], alice);
    expect(lastCode()).toBe('tooFar');

    moveToMailbox(sim, alice);
    sim.mailSend('', 'x', 'y', 0, [], alice);
    expect(lastCode()).toBe('needRecipient');
    sim.mailSend('Nobody', 'x', 'y', 0, [], alice);
    expect(lastCode()).toBe('noRecipient');
    sim.mailSend('Alice', 'x', 'y', 0, [{ itemId: 'roasted_boar', count: 1 }], alice);
    expect(lastCode()).toBe('notEnoughItems');
    sim.mailSend(
      'Alice',
      'x',
      'y',
      0,
      Array.from({ length: MAIL_MAX_ATTACHMENTS + 1 }, () => ({
        itemId: 'roasted_boar',
        count: 1,
      })),
      alice,
    );
    expect(lastCode()).toBe('tooManyParcels');
    sim.mailSend('Alice', 'x', 'y', 0, [], alice);
    expect(lastCode()).toBe('cantAffordPostage'); // 5c < 30c postage
  });

  it('lets the recipient take the attachments, then discard the letter', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    sim.addItem('roasted_boar', 2, alice);
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Gift', 'For you.', 700, [{ itemId: 'roasted_boar', count: 2 }], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);

    moveToMailbox(sim, bob);
    const info = sim.mailInfoFor(bob);
    const gift = info?.messages.find((m) => m.subject === 'Gift');
    if (!gift) throw new Error('gift letter not delivered');
    const bobCopper = bobMeta.copper;
    sim.drainEvents();

    // A letter with parcels cannot be discarded.
    sim.mailDelete(gift.id, bob);
    let events = sim.drainEvents();
    expect(events.some((e) => e.type === 'mailResult' && e.code === 'takeParcelsFirst')).toBe(true);

    sim.mailTake(gift.id, bob);
    events = sim.drainEvents();
    expect(events.some((e) => e.type === 'mailResult' && e.code === 'collected')).toBe(true);
    expect(bobMeta.copper).toBe(bobCopper + 700);
    expect(sim.countItem('roasted_boar', bob)).toBe(2);

    sim.mailDelete(gift.id, bob);
    expect(sim.mailInfoFor(bob)?.messages.some((m) => m.id === gift.id)).toBe(false);
  });

  it('delivers Rift Essence and Rift Gems: forge currency, not the personal rift gear it is spent on', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    sim.addItem(RIFT_ESSENCE_ITEM_ID, 5, alice);
    for (const gemId of RIFT_GEM_IDS) sim.addItem(gemId, 5, alice);
    moveToMailbox(sim, alice);

    sim.mailSend(
      'Bob',
      'Essence',
      'Spare stock.',
      0,
      [{ itemId: RIFT_ESSENCE_ITEM_ID, count: 5 }],
      alice,
    );
    sim.mailSend(
      'Bob',
      'Gems',
      'One of each.',
      0,
      RIFT_GEM_IDS.map((itemId) => ({ itemId, count: 5 })),
      alice,
    );
    const sent = sim.drainEvents();
    expect(
      sent.filter((e) => e.type === 'mailResult' && e.code === 'sent' && e.pid === alice),
    ).toHaveLength(2);
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID, alice)).toBe(0);
    for (const gemId of RIFT_GEM_IDS) expect(sim.countItem(gemId, alice)).toBe(0);

    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    moveToMailbox(sim, bob);
    const info = sim.mailInfoFor(bob);
    for (const subject of ['Essence', 'Gems']) {
      const letter = info?.messages.find((m) => m.subject === subject);
      if (!letter) throw new Error(`${subject} letter not delivered`);
      sim.mailTake(letter.id, bob);
    }
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID, bob)).toBe(5);
    for (const gemId of RIFT_GEM_IDS) expect(sim.countItem(gemId, bob)).toBe(5);

    // Mirror host: the personal rift rings (RIFT_GEAR_ITEM_IDS) still refuse to
    // ride the raven, unlike the currency above; the fix must not loosen that
    // def-level rule.
    sim.addItem('riftbound_band_of_might', 1, alice);
    sim.drainEvents();
    sim.mailSend(
      'Bob',
      'Ring',
      'Oops.',
      0,
      [{ itemId: 'riftbound_band_of_might', count: 1 }],
      alice,
    );
    const refused = sim.drainEvents();
    expect(refused.some((e) => e.type === 'mailResult' && e.code === 'noMailQuestItems')).toBe(
      true,
    );
    expect(sim.countItem('riftbound_band_of_might', alice)).toBe(1);
  });

  // Review follow-up on PR #2605 (EnriqueGF, medium): mail was a third laundering
  // channel for a crafted item's provenance marker (bags.ts InvSlot.craftedRecipeId),
  // structurally identical to the trade and market paths the PR fixed. Escrowing via
  // removeVendorSellUnits (instead of a blind removeFungibleItem) and re-granting with
  // { craftedRecipeId } on mailTake must keep the marker across the flight.
  it('carries the craftedRecipeId marker through a mailed attachment', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    // One crafted copy and one plain (drop-sourced) copy of the same item id, so the
    // escrow must keep them in separate provenance buckets rather than collapsing them.
    sim.addItem('roasted_boar', 1, alice, { craftedRecipeId: 'r_roasted_boar' });
    sim.addItem('roasted_boar', 1, alice);
    moveToMailbox(sim, alice);
    sim.mailSend(
      'Bob',
      'Provisions',
      'Eat well.',
      0,
      [{ itemId: 'roasted_boar', count: 2 }],
      alice,
    );
    expect(sim.countItem('roasted_boar', alice)).toBe(0);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);

    moveToMailbox(sim, bob);
    const info = sim.mailInfoFor(bob);
    const parcel = info?.messages.find((m) => m.subject === 'Provisions');
    if (!parcel) throw new Error('parcel not delivered');
    // The escrow must have split the attachment into two provenance buckets.
    expect(parcel.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'roasted_boar',
          count: 1,
          craftedRecipeId: 'r_roasted_boar',
        }),
        expect.objectContaining({ itemId: 'roasted_boar', count: 1 }),
      ]),
    );
    expect(parcel.items.find((s) => s.craftedRecipeId !== undefined)?.craftedRecipeId).toBe(
      'r_roasted_boar',
    );

    sim.mailTake(parcel.id, bob);
    const bobMeta2 = sim.meta(bob);
    if (!bobMeta2) throw new Error('no meta');
    const crafted = bobMeta2.inventory.find(
      (s) => s.itemId === 'roasted_boar' && s.craftedRecipeId === 'r_roasted_boar',
    );
    const plain = bobMeta2.inventory.find(
      (s) => s.itemId === 'roasted_boar' && s.craftedRecipeId === undefined,
    );
    expect(crafted?.count).toBe(1);
    expect(plain?.count).toBe(1);
  });
});

describe('instanced attachments (finding 1)', () => {
  it('escrows only the fungible copy, never an instanced slot of the same item', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    // One plain stack + one soulbound (instanced) copy of the same item.
    sim.addItem('roasted_boar', 1, alice);
    sim.addItemInstance('roasted_boar', { boundTo: alice, signer: 'Alice' }, alice);
    sim.drainEvents();
    expect(sim.countItem('roasted_boar', alice)).toBe(2);
    moveToMailbox(sim, alice);

    sim.mailSend('Bob', 'One boar', 'Enjoy.', 0, [{ itemId: 'roasted_boar', count: 1 }], alice);
    const sent = sim.drainEvents();
    expect(sent.some((e) => e.type === 'mailResult' && e.code === 'sent')).toBe(true);

    // The plain copy left; the instanced copy is still in the bags, intact.
    const instanced = aliceMeta.inventory.filter((s) => s.instance);
    expect(instanced).toHaveLength(1);
    expect(instanced[0]?.instance?.boundTo).toBe(alice);
    expect(instanced[0]?.instance?.signer).toBe('Alice');
    expect(sim.countItem('roasted_boar', alice)).toBe(1);
  });

  it('refuses to mail when the only copies are instanced', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    sim.addItemInstance('roasted_boar', { boundTo: alice }, alice);
    sim.drainEvents();
    moveToMailbox(sim, alice);

    sim.mailSend('Bob', 'x', 'y', 0, [{ itemId: 'roasted_boar', count: 1 }], alice);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'mailResult' && e.code === 'notEnoughItems')).toBe(true);
    // Nothing escrowed: the instanced copy is untouched and postage was not taken.
    expect(aliceMeta.inventory.filter((s) => s.instance)).toHaveLength(1);
    expect(aliceMeta.copper).toBe(10_000);
  });
});

describe('taking attachments against bag capacity (finding 2)', () => {
  // Fill a player's bags to the brim: 16 full stacks, no equipped bags (a
  // 16-slot budget), so nothing new fits until a slot is freed.
  const fillBags = (sim: Sim, pid: number): void => {
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.bags = [null, null, null, null];
    meta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'roasted_boar', count: 20 }));
  };

  it('collects coin, leaves unfitting stacks attached, delivers them after space is freed', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    sim.addItem('roasted_boar', 2, alice);
    moveToMailbox(sim, alice);
    sim.mailSend(
      'Bob',
      'Care package',
      'For you.',
      700,
      [{ itemId: 'roasted_boar', count: 2 }],
      alice,
    );
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);

    moveToMailbox(sim, bob);
    fillBags(sim, bob);
    const before = bobMeta.copper;
    sim.drainEvents();

    const gift = sim.mailInfoFor(bob)?.messages.find((m) => m.subject === 'Care package');
    if (!gift) throw new Error('gift not delivered');
    sim.mailTake(gift.id, bob);
    const events = sim.drainEvents();
    // Coin always lands; the stack that does not fit stays attached (bags-full).
    expect(events.some((e) => e.type === 'mailResult' && e.code === 'collected')).toBe(true);
    expect(events.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(bobMeta.copper).toBe(before + 700);
    const still = sim.mailInfoFor(bob)?.messages.find((m) => m.id === gift.id);
    expect(still?.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(still?.copper).toBe(0);

    // Free a slot and take again: the held stack now arrives.
    bobMeta.inventory = bobMeta.inventory.slice(0, 15);
    sim.mailTake(gift.id, bob);
    const empty = sim.mailInfoFor(bob)?.messages.find((m) => m.id === gift.id);
    expect(empty?.items ?? []).toHaveLength(0);
  });

  it('does not start the emptied clock while a partially-taken letter still holds parcels', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    sim.addItem('roasted_boar', 2, alice);
    moveToMailbox(sim, alice);
    const sentAt = sim.time;
    sim.mailSend('Bob', 'Held', 'Wait for room.', 0, [{ itemId: 'roasted_boar', count: 2 }], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);

    moveToMailbox(sim, bob);
    fillBags(sim, bob);
    const gift = sim.mailInfoFor(bob)?.messages.find((m) => m.subject === 'Held');
    if (!gift) throw new Error('gift not delivered');
    sim.mailTake(gift.id, bob);

    // biome-ignore lint/suspicious/noExplicitAny: reach into the book to inspect the raw expiry.
    const raw = (sim.postOffice as any).mail.find((m: { id: number }) => m.id === gift.id);
    expect(raw.items).toHaveLength(1);
    // Attachments remain: the letter stays on its original attachment window,
    // neither emptied-clock started nor window restarted by the partial take.
    expect(raw.expiresAt).toBe(sentAt + MAIL_ATTACHMENT_EXPIRY_SECONDS);
  });

  // Phase 05 made the take POOL-AWARE: mailTake asks canGrantCopies with
  // bagPools(meta.bags), the general/materials split, instead of a flat
  // capacity. The two arms below cover both halves of that: this one the
  // materials-pool-of-zero case (every socket empty), and the mixed-letter test
  // after it the real split, driven through a shipped materialsOnly satchel.
  // The same rule is pinned at the gate itself in tests/bags.test.ts.
  it('keeps a MATERIAL parcel attached too: materials get no free pass without a materials bag', () => {
    // The regression this closes is a take that treats materials as always
    // grantable. linen_scrap is a real member of the derived material set, and
    // with every socket empty the materials pool is 0, so it must be held back
    // exactly like the food parcel above.
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    sim.addItem('linen_scrap', 2, alice);
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Scraps', 'For you.', 0, [{ itemId: 'linen_scrap', count: 2 }], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);

    moveToMailbox(sim, bob);
    fillBags(sim, bob);
    expect(bobMeta.bags).toEqual([null, null, null, null]); // no materials pool
    sim.drainEvents();

    const parcel = sim.mailInfoFor(bob)?.messages.find((m) => m.subject === 'Scraps');
    if (!parcel) throw new Error('parcel not delivered');
    sim.mailTake(parcel.id, bob);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    const still = sim.mailInfoFor(bob)?.messages.find((m) => m.id === parcel.id);
    expect(still?.items).toEqual([{ itemId: 'linen_scrap', count: 2 }]); // kept, not destroyed
    expect(sim.countItem('linen_scrap', bob)).toBe(0);

    // Free one general slot and the same material parcel arrives.
    bobMeta.inventory = bobMeta.inventory.slice(0, 15);
    sim.mailTake(parcel.id, bob);
    const empty = sim.mailInfoFor(bob)?.messages.find((m) => m.id === parcel.id);
    expect(empty?.items ?? []).toHaveLength(0);
    expect(sim.countItem('linen_scrap', bob)).toBe(2);
  });

  it('splits a mixed letter by pool: the material lands, the non-material stays attached', () => {
    // The two-pool contract end to end on shipped content. Bob equips a real
    // materialsOnly satchel, so his general pool is the bare backpack while 12
    // materials slots stand free. One letter carries both kinds: the material
    // parcel is delivered into the materials pool and the food parcel, which
    // can only take general headroom, is kept for a later take.
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    sim.addItem('linen_scrap', 2, alice);
    sim.addItem('roasted_boar', 2, alice);
    moveToMailbox(sim, alice);
    sim.mailSend(
      'Bob',
      'Mixed',
      'Some of each.',
      0,
      [
        { itemId: 'linen_scrap', count: 2 },
        { itemId: 'roasted_boar', count: 2 },
      ],
      alice,
    );
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);

    moveToMailbox(sim, bob);
    sim.addItem('foragers_haversack', 1, bob);
    sim.equipBag('foragers_haversack', 0, bob);
    expect(bobMeta.bags[0]).toBe('foragers_haversack');
    // General exactly full with food stacks at their 20 cap, so the food parcel
    // has neither a free slot nor top-up room; the materials pool is untouched.
    bobMeta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'roasted_boar', count: 20 }));
    sim.drainEvents();

    const letter = sim.mailInfoFor(bob)?.messages.find((m) => m.subject === 'Mixed');
    if (!letter) throw new Error('letter not delivered');
    sim.mailTake(letter.id, bob);
    const events = sim.drainEvents();

    expect(sim.countItem('linen_scrap', bob)).toBe(2); // delivered into the satchel
    const still = sim.mailInfoFor(bob)?.messages.find((m) => m.id === letter.id);
    expect(still?.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]); // kept, not destroyed
    expect(events.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);

    // Free one general slot and the held food parcel arrives on the next take.
    bobMeta.inventory = bobMeta.inventory.slice(0, 15);
    sim.mailTake(letter.id, bob);
    const empty = sim.mailInfoFor(bob)?.messages.find((m) => m.id === letter.id);
    expect(empty?.items ?? []).toHaveLength(0);
  });

  it('asks the fit gate with the two-pool SPLIT, never a flat capacity', () => {
    // The materialsOnly satchels shipped in this same phase, so the Sim-level
    // arms above now discriminate the pool read behaviorally; this source pin
    // stays as the cheap wiring guard beside them (it caught the contract
    // during the phase, and it names the exact call shape), pinned the same
    // way the hud's maxBuyCount call site
    // is in tests/vendor_window_painter.test.ts.
    const source = readFileSync(join(__dirname, '../src/sim/mail/post_office.ts'), 'utf8');
    expect(source).toContain('bagPools(meta.bags),');
    expect(source).not.toContain('bagCapacity(meta.bags)');
  });
});

describe('unread index equivalence (finding 4)', () => {
  // This drives sim.tick() one tick at a time across several full mail-delivery
  // windows, checking the maintained unread index against a linear-scan oracle
  // after EVERY tick. That is a lot of synchronous work for vitest's 5s default
  // under worker-pool CPU contention, though it is sub-second in isolation; give
  // it real headroom instead of flaking.
  const UNREAD_INDEX_TEST_TIMEOUT_MS = 20_000;

  it(
    'matches the linear scan across sends, deliveries, reads, takes, deletes, renames and expiries',
    () => {
      const sim = makeWorld();
      const alice = sim.addPlayer('warrior', 'Alice');
      const bob = sim.addPlayer('mage', 'Bob');
      const aliceMeta = sim.meta(alice);
      const bobMeta = sim.meta(bob);
      if (!aliceMeta || !bobMeta) throw new Error('no meta');
      aliceMeta.copper = 100_000;

      // biome-ignore lint/suspicious/noExplicitAny: read the raw book to replay the old scan.
      const po = sim.postOffice as any;
      // The former linear scan, kept here as the oracle the maintained index must
      // reproduce byte-for-byte.
      const refUnread = (pid: number): number => {
        const meta = sim.meta(pid);
        if (!meta) return 0;
        const now = sim.time;
        const key = String(meta.characterId ?? meta.entityId);
        let n = 0;
        for (const m of po.mail as { read: boolean; deliverAt: number; recipientKey: string }[]) {
          if (
            !m.read &&
            now >= m.deliverAt &&
            (m.recipientKey === key || m.recipientKey === meta.name)
          )
            n++;
        }
        return n;
      };
      const check = (): void => {
        expect(sim.mailUnreadFor(alice)).toBe(refUnread(alice));
        expect(sim.mailUnreadFor(bob)).toBe(refUnread(bob));
      };

      check(); // welcome letters delivered immediately
      moveToMailbox(sim, alice);
      sim.addItem('roasted_boar', 6, alice);

      // Two letters to Bob, still in flight.
      sim.mailSend('Bob', 'A', 'a', 100, [], alice);
      check();
      sim.mailSend('Bob', 'B', 'b', 0, [{ itemId: 'roasted_boar', count: 2 }], alice);
      check();

      // Advance ONE tick at a time across the delivery boundary: the index must be
      // byte-identical to the scan at every tick, including the exact delivery tick.
      for (let i = 0; i < (MAIL_DELIVERY_SECONDS + 2) * 20; i++) {
        sim.tick();
        check();
      }

      moveToMailbox(sim, bob);
      const letterA = sim.mailInfoFor(bob)?.messages.find((m) => m.subject === 'A');
      const letterB = sim.mailInfoFor(bob)?.messages.find((m) => m.subject === 'B');
      if (!letterA || !letterB) throw new Error('letters not delivered');

      sim.mailMarkRead(letterA.id, bob);
      check();
      sim.mailTake(letterA.id, bob); // coin taken, A now empty and read
      check();
      sim.mailDelete(letterA.id, bob); // delete the emptied, read letter
      check();
      sim.mailTake(letterB.id, bob); // takes the boars, marks read
      check();

      // Rename path: a name-keyed offline letter folded onto the stable id key.
      sim.mailSendResolved({ key: 'Ghost', name: 'Ghost' }, 'Ghostly', 'boo', 0, [], alice);
      for (let i = 0; i < (MAIL_DELIVERY_SECONDS + 2) * 20; i++) sim.tick();
      check();
      // Fold the Ghost-keyed letter onto Bob (his mail key is his entity id here).
      expect(sim.rekeyMailOwner(bob, 'Ghost', 'Bob')).toBe(true);
      check();

      // Expiry path: force an unread plain letter to expire and prune.
      sim.mailSend('Bob', 'Expireme', 'bye', 0, [], alice);
      for (let i = 0; i < (MAIL_DELIVERY_SECONDS + 2) * 20; i++) sim.tick();
      check();
      const doomed = po.mail.find((m: { subject: string }) => m.subject === 'Expireme');
      doomed.expiresAt = sim.time + 0.5;
      tickFor(sim, 2);
      expect(po.mail.some((m: { subject: string }) => m.subject === 'Expireme')).toBe(false);
      check();
    },
    UNREAD_INDEX_TEST_TIMEOUT_MS,
  );

  it('rebuilds a byte-identical index after a serialize/load round-trip', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    // One letter already landed at save time, one still on the wing.
    sim.mailSend('Bob', 'Landed', 'hi', 0, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    sim.mailSend('Bob', 'Enroute', 'later', 0, [], alice);
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));

    const sim2 = makeWorld();
    sim2.loadMail(save);
    const bob2 = sim2.addPlayer('mage', 'Bob');
    // biome-ignore lint/suspicious/noExplicitAny: read the reloaded book to replay the old scan.
    const po2 = sim2.postOffice as any;
    const refUnread2 = (): number => {
      const meta = sim2.meta(bob2);
      if (!meta) return 0;
      const now = sim2.time;
      const key = String(meta.characterId ?? meta.entityId);
      let n = 0;
      for (const m of po2.mail as { read: boolean; deliverAt: number; recipientKey: string }[]) {
        if (
          !m.read &&
          now >= m.deliverAt &&
          (m.recipientKey === key || m.recipientKey === meta.name)
        )
          n++;
      }
      return n;
    };
    // The rebuilt index matches the raw scan right after load...
    expect(sim2.mailUnreadFor(bob2)).toBe(refUnread2());
    // ...and once the in-flight letter lands via deliverDue after the load.
    tickFor(sim2, MAIL_DELIVERY_SECONDS + 2);
    expect(sim2.mailUnreadFor(bob2)).toBe(refUnread2());
  });
});

describe('quest thank-you letters', () => {
  it('the giver writes after an authored quest turn-in', () => {
    // QUESTS is a static data table (src/sim/data), not world content, so the
    // dev turn-in and its thank-you letter work in the mailbox-only world too.
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
      world: MAIL_TEST_WORLD,
    });
    const pid = sim.primaryId;
    expect(QUEST_LETTERS.q_wolves).toBeDefined();
    expect(sim.completeQuestForDev('q_wolves', pid)).toBe(true);
    tickFor(sim, (QUEST_LETTERS.q_wolves.delaySeconds ?? 0) + 2);
    moveToMailbox(sim, pid);
    const info = sim.mailInfoFor(pid);
    const letter = info?.messages.find((m) => m.letterId === QUEST_LETTERS.q_wolves.letterId);
    expect(letter).toBeDefined();
    expect(letter?.kind).toBe('npc');
    expect(letter?.copper).toBe(QUEST_LETTERS.q_wolves.copper);
  });
});

describe('the Heroic Marks reward letter (mailHeroicMarks)', () => {
  it('books a system letter carrying the exact mark count as its attachment', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Backline');
    sim.postOffice.mailHeroicMarks(pid, HEROIC_MARK_ITEM_ID, 3);
    tickFor(sim, 1);
    moveToMailbox(sim, pid);
    const info = sim.mailInfoFor(pid);
    const letter = info?.messages.find((m) => m.letterId === HEROIC_MARK_LETTER.letterId);
    expect(letter).toBeDefined();
    expect(letter?.kind).toBe('system');
    expect(letter?.items).toEqual([{ itemId: HEROIC_MARK_ITEM_ID, count: 3 }]);
  });

  it('refuses an unknown recipient and a non-positive count', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Backline');
    const before = (sim.postOffice as any).mail.length;
    sim.postOffice.mailHeroicMarks(999999, HEROIC_MARK_ITEM_ID, 3); // no such player
    sim.postOffice.mailHeroicMarks(pid, HEROIC_MARK_ITEM_ID, 0);
    sim.postOffice.mailHeroicMarks(pid, HEROIC_MARK_ITEM_ID, -2);
    expect((sim.postOffice as any).mail.length).toBe(before);
  });
});

describe('persistence and rename', () => {
  it('round-trips the book through serializeMail/loadMail without re-announcing', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Ping', 'Pong.', 0, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    const save = sim.serializeMail();

    const sim2 = makeWorld();
    sim2.loadMail(JSON.parse(JSON.stringify(save)));
    const bob2 = sim2.addPlayer('mage', 'Bob');
    // Welcome letter arrives fresh (new character in this world) + the loaded one.
    expect(sim2.mailUnreadFor(bob2)).toBe(2);
    // The already-delivered letter never re-toasts after a load.
    const events = tickFor(sim2, 2);
    expect(events.some((e) => e.type === 'mailArrived' && e.senderName === 'Alice')).toBe(false);
  });

  it('bounds a persisted attachment craftedRecipeId like every other marker load', () => {
    // The v0.34.0 merge-audit finding, mail arm: an in-flight attachment row
    // can persist forever with no login to self-heal it, so the release's
    // bare-typeof marker keep (#2605) must take the same drop-only bound as
    // bag/buyback/bank (item_instance_load.ts boundCraftedRecipeIdOnLoad).
    // Driven through the REAL loadMail path.
    const sim = makeWorld();
    sim.loadMail({
      mail: [
        {
          recipientKey: '4242',
          recipientName: 'Later',
          senderName: 'Ghost',
          kind: 'player',
          subject: 'Markers',
          body: 'x',
          copper: 0,
          delaySeconds: 0,
          items: [
            { itemId: 'wolf_fang', count: 1, craftedRecipeId: 'recipe_tough_jerky' },
            { itemId: 'wolf_fang', count: 1, craftedRecipeId: 'r'.repeat(65) },
            { itemId: 'wolf_fang', count: 1, craftedRecipeId: '' },
          ],
        },
      ],
    } as never);
    // biome-ignore lint/suspicious/noExplicitAny: read the raw book directly.
    const letter = (sim.postOffice as any).mail.find(
      (m: { subject: string }) => m.subject === 'Markers',
    );
    if (!letter) throw new Error('missing marker letter');
    expect(letter.items.map((s: { craftedRecipeId?: string }) => s.craftedRecipeId)).toEqual([
      'recipe_tough_jerky',
      undefined,
      undefined,
    ]);
    expect('craftedRecipeId' in letter.items[1]).toBe(false);
    expect('craftedRecipeId' in letter.items[2]).toBe(false);
  });

  it('rekeys name-keyed letters onto the stable character id on rename', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    // Book a letter keyed by NAME (as an offline-resolved recipient would be).
    sim.mailSendResolved({ key: 'Renamed', name: 'Renamed' }, 'Hi', 'There.', 0, [], alice);
    expect(sim.rekeyMailOwner(777, 'Renamed', 'Newname')).toBe(true);
    const save = sim.serializeMail();
    const row = save.mail.find((m) => m.subject === 'Hi');
    expect(row?.recipientKey).toBe('777');
    expect(row?.recipientName).toBe('Newname');
  });
});

// #3561: the incremental autosave seam. A missed dirty mark here is a
// production data-loss bug (a mailbox mutation that never reaches durable
// storage), so these prove EXACT dirty sets, and one end-to-end scenario
// proves the whole partitioned-save/load round trip lands the same book a
// full serializeMail/loadMail cycle would.
describe('takeDirtyMailPartitions (#3561 incremental autosave)', () => {
  it('a fresh player dirties exactly their own welcome-letter partition; the next call is quiet', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const dirty = sim.takeDirtyMailPartitions();
    expect(dirty).toHaveLength(1);
    expect(dirty[0].letters.some((m) => m.subject === WELCOME_LETTER.subject)).toBe(true);
    expect(sim.mailUnreadFor(alice)).toBeGreaterThan(0); // sanity: the welcome letter is real

    // A quiet interval with no further mail activity reports nothing.
    expect(sim.takeDirtyMailPartitions()).toEqual([]);
  });

  it('sending a letter dirties only the actual recipient, not the sender or any bystander', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const carol = sim.addPlayer('rogue', 'Carol');
    sim.takeDirtyMailPartitions(); // drain the three welcome letters

    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Ping', 'Pong.', 500, [], alice);

    const dirty = sim.takeDirtyMailPartitions();
    const dirtyKeys = dirty.map((p) => p.recipientKey);
    expect(dirtyKeys).toHaveLength(1);
    const bobKey = sim.postOffice.mailKeyFor(sim.meta(bob)!);
    const carolKey = sim.postOffice.mailKeyFor(sim.meta(carol)!);
    expect(dirtyKeys).toEqual([bobKey]);
    expect(dirtyKeys).not.toContain(carolKey);
    expect(dirty[0].letters.some((m) => m.subject === 'Ping')).toBe(true);
    void bob;
  });

  it('rekeyMailOwner dirties a letter whose ONLY change is its outgoing sender stamp (recipientKey untouched)', () => {
    const sim = makeWorld();
    // A pre-senderKey legacy letter (no senderKey field): the renaming
    // character sent it to a THIRD party before senderKey existed. Its
    // recipientKey never moves, so index.rekey/track/untrack never sees it;
    // only the explicit markDirty in the sender-stamp branch covers it.
    sim.loadMail({
      mail: [
        {
          recipientKey: 'thirdparty',
          recipientName: 'ThirdParty',
          senderName: 'Ghost',
          kind: 'player',
          subject: 'Old outgoing letter',
          body: 'x',
          copper: 0,
          delaySeconds: 0,
          items: [],
        },
      ],
    } as never);
    expect(sim.takeDirtyMailPartitions()).toEqual([]); // load reconstructs, dirties nothing

    expect(sim.rekeyMailOwner(999, 'Ghost', 'Renamed')).toBe(true);

    const dirty = sim.takeDirtyMailPartitions();
    expect(dirty.map((p) => p.recipientKey)).toEqual(['thirdparty']);
    const letter = dirty[0].letters.find((m) => m.subject === 'Old outgoing letter');
    // Prove the dirty mark was actually necessary: real content changed.
    expect(letter?.senderKey).toBe('999');
    expect(letter?.senderName).toBe('Renamed');
  });

  it('purgeMailOwner dirties a letter whose ONLY change is its outgoing sender stamp', () => {
    const sim = makeWorld();
    sim.loadMail({
      mail: [
        {
          recipientKey: 'thirdparty',
          recipientName: 'ThirdParty',
          senderName: 'Doomed',
          kind: 'player',
          subject: 'Old outgoing letter',
          body: 'x',
          copper: 0,
          delaySeconds: 0,
          items: [],
        },
      ],
    } as never);
    sim.takeDirtyMailPartitions();

    expect(sim.purgeMailOwner(4242, 'Doomed')).toBe(true);

    const dirty = sim.takeDirtyMailPartitions();
    expect(dirty.map((p) => p.recipientKey)).toEqual(['thirdparty']);
    expect(dirty[0].letters[0].senderKey).toBe('4242');
  });

  it('a repeated rename that leaves recipientKey unchanged still dirties the row (the recipientName restamp)', () => {
    const sim = makeWorld();
    // Already id-keyed: a rename already happened in a prior session.
    sim.loadMail({
      mail: [
        {
          recipientKey: '555',
          recipientName: 'OldDisplay',
          senderName: 'System',
          kind: 'system',
          subject: 'Already id-keyed',
          body: 'x',
          copper: 0,
          delaySeconds: 0,
          items: [],
        },
      ],
    } as never);
    expect(sim.takeDirtyMailPartitions()).toEqual([]);

    // index.rekey('555' -> '555') is a documented no-op and marks nothing by
    // itself; only the explicit markDirty after it catches this restamp.
    expect(sim.rekeyMailOwner(555, 'OldDisplay', 'NewDisplay')).toBe(true);

    const dirty = sim.takeDirtyMailPartitions();
    expect(dirty.map((p) => p.recipientKey)).toEqual(['555']);
    expect(dirty[0].letters[0].recipientName).toBe('NewDisplay');
  });

  it('mailTake on an ALREADY-READ letter still dirties the partition (regression: gold/item duplication across a restart)', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Gift', 'For you.', 500, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    sim.takeDirtyMailPartitions(); // drain the send + delivery

    moveToMailbox(sim, bob);
    // biome-ignore lint/suspicious/noExplicitAny: read the live book to find the id.
    const giftId = (sim.postOffice as any).mail.find(
      (m: { subject: string }) => m.subject === 'Gift',
    ).id as number;

    // The ordinary UI flow: opening a letter (mailbox_window.ts) reads it
    // FIRST, as its own separate action; Take is a second, later click.
    sim.mailMarkRead(giftId, bob);
    sim.takeDirtyMailPartitions(); // drain the read flip; Take starts from a clean dirty set

    sim.mailTake(giftId, bob);
    const dirty = sim.takeDirtyMailPartitions();
    const bobKey = sim.postOffice.mailKeyFor(sim.meta(bob)!);
    expect(dirty.map((p) => p.recipientKey)).toEqual([bobKey]);
    const persisted = dirty[0].letters.find((m) => m.id === giftId);
    // The persisted snapshot must actually reflect the take (copper gone),
    // not the stale pre-take state a missed dirty mark would leave behind.
    expect(persisted?.copper).toBe(0);
  });

  it("loadMail's soulbound-return migration keeps BOTH halves dirty (regression: re-runs forever / duplicates the item)", () => {
    const sim = makeWorld();
    // A legacy player parcel carrying a soulbound item: loadMail auto-splits
    // it into a return-to-sender parcel (the item can never stay with a
    // recipient it was mailed to under the modern soulbound rule).
    sim.loadMail({
      mail: [
        {
          recipientKey: '100',
          recipientName: 'Later',
          senderName: 'Ghost',
          senderKey: '200',
          kind: 'player',
          subject: 'Old parcel',
          body: 'x',
          copper: 0,
          delaySeconds: 0,
          items: [{ itemId: 'reins_terrorspark_groundshaker', count: 1 }],
        },
      ],
    } as never);

    const dirty = sim.takeDirtyMailPartitions();
    // '100' (the item stripped off) and '200' (the new return parcel) must
    // BOTH be dirty: neither half of this migration is durable state yet.
    // A missed mark here means it silently re-runs (minting a fresh return
    // parcel with a new id) on every future boot, and can duplicate the item
    // once the other half is later dirtied by something unrelated.
    expect(dirty.map((p) => p.recipientKey).sort()).toEqual(['100', '200']);
    const stripped = dirty
      .find((p) => p.recipientKey === '100')
      ?.letters.find((m) => m.subject === 'Old parcel');
    expect(stripped?.items).toEqual([]);
    const returned = dirty.find((p) => p.recipientKey === '200')?.letters[0];
    expect(returned?.items).toEqual([{ itemId: 'reins_terrorspark_groundshaker', count: 1 }]);
  });

  it('round-trips to the EXACT same book as a full serializeMail, across a realistic mutation sequence', () => {
    // A tiny fake per-recipient store mirroring server/db.ts's
    // saveMailPartitions (write only what's dirty) + loadMailState (union
    // every row back into one book).
    const store = new Map<string, MailSave['mail']>();
    const applyDirty = (): void => {
      for (const { recipientKey, letters } of sim.takeDirtyMailPartitions()) {
        store.set(recipientKey, letters);
      }
    };
    const reconstructed = (): MailSave['mail'] =>
      [...store.values()].flat().sort((a, b) => a.id - b.id);
    const fullBook = (): MailSave['mail'] =>
      [...sim.serializeMail().mail].sort((a, b) => a.id - b.id);
    const assertInSync = (): void => expect(reconstructed()).toEqual(fullBook());

    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    applyDirty();
    assertInSync(); // two welcome letters, two partitions

    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Ping', 'Pong.', 500, [], alice);
    applyDirty();
    assertInSync(); // a fresh send

    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    applyDirty(); // delivery landing persists deliverIn: 0 for the recipient
    assertInSync();

    moveToMailbox(sim, bob);
    // biome-ignore lint/suspicious/noExplicitAny: read the live book to find the id, same idiom as the marker-load test above.
    const pingId = (sim.postOffice as any).mail.find(
      (m: { subject: string }) => m.subject === 'Ping',
    ).id as number;
    sim.mailTake(pingId, bob);
    applyDirty();
    assertInSync(); // take drops the attachment and flips read

    expect(sim.rekeyMailOwner(bob, 'Bob', 'Robert')).toBe(true);
    applyDirty();
    assertInSync(); // rename re-keys Bob's own bucket

    expect(sim.purgeMailOwner(alice, 'Alice')).toBe(true);
    applyDirty();
    assertInSync(); // deletion drops Alice's now-plain welcome letter
  });

  // Ticks one sim-second at a time (the periodic re-dirty arm's own per-second
  // cadence) and drains after each, stopping the moment `recipientKey` shows
  // up dirty: its own stagger slot has fired. Deliberately observes the real
  // trigger rather than precomputing a target tick count from mailId %
  // MAIL_PERSIST_REFRESH_SECONDS and hoping Math.floor(sim.time) lands on it
  // exactly at that tick: repeated DT summation drifts sim.time by enough
  // (confirmed empirically) that a precomputed count is off by one bucket at
  // exactly the boundary. Bounded by one full refresh cadence, so a genuine
  // regression (the recipient never gets re-dirtied) fails loudly instead of
  // hanging.
  function drainUntilRedirtied(
    sim: Sim,
    recipientKey: string,
  ): { recipientKey: string; letters: MailSave['mail'] }[] {
    for (let s = 0; s < MAIL_PERSIST_REFRESH_SECONDS + 1; s++) {
      tickFor(sim, 1);
      const dirty = sim.takeDirtyMailPartitions();
      if (dirty.some((p) => p.recipientKey === recipientKey)) return dirty;
    }
    throw new Error(`${recipientKey} was never re-dirtied within one full refresh cadence`);
  }

  it('an untouched escrow letter is periodically re-dirtied so its persisted secondsLeft never drifts unboundedly', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Gift', 'For you.', 500, [], alice); // carries copper: an escrow
    const sentAtDirty = sim.takeDirtyMailPartitions();
    const bobKey = sim.postOffice.mailKeyFor(sim.meta(bob)!);
    const gift = sentAtDirty
      .find((p) => p.recipientKey === bobKey)
      ?.letters.find((m) => m.subject === 'Gift');
    expect(gift?.secondsLeft).toBeGreaterThan(0);
    const initialSecondsLeft = gift?.secondsLeft as number;

    // No mutation touches Bob's mailbox again: without the periodic
    // re-dirty, this quiet letter's on-disk copy would freeze at
    // initialSecondsLeft forever (until something else about this mailbox
    // changes), understating real elapsed time across a restart.
    const refreshedDirty = drainUntilRedirtied(sim, bobKey);
    const refreshedSecondsLeft = refreshedDirty
      .find((p) => p.recipientKey === bobKey)
      ?.letters.find((m) => m.subject === 'Gift')?.secondsLeft;
    // Strictly less than the send-time value: the countdown actually advanced
    // in the persisted snapshot, not just in the live in-memory letter.
    expect(refreshedSecondsLeft).toBeLessThan(initialSecondsLeft);
  });

  // Regression for the #3613 review finding: the periodic re-dirty arm was
  // gated on `hasEscrow &&`, so a PLAIN (no coin, no items) letter's 14-day
  // read/expiry clock was NEVER re-dirtied after send. secondsLeft was
  // written once at send time; on load expiresAt = ctx.time + secondsLeft, so
  // every server restart handed plain and already-read letters a fresh full
  // 14-day expiry window. Since realms restart far more often than 14 days
  // (every deploy), this meant plain letters effectively never expired, the
  // reclaim sweep stopped working, and the mail book grew unbounded again:
  // exactly the #3560 class this PR exists to prevent. Proven end to end: the
  // persisted countdown advances after a quiet interval (the drain), AND a
  // fresh Sim loaded from ONLY that drained partition (the restart) carries
  // the advanced countdown forward, not a reset one.
  it('a plain (no-escrow) letter is ALSO periodically re-dirtied, so its persisted expiry advances across a drain-then-restart cycle', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000; // postage only; the letter itself carries no coin
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Chat', 'Hey there.', 0, [], alice); // no copper, no items: plain
    const sentAtDirty = sim.takeDirtyMailPartitions();
    const bobKey = sim.postOffice.mailKeyFor(sim.meta(bob)!);
    const chatBefore = sentAtDirty
      .find((p) => p.recipientKey === bobKey)
      ?.letters.find((m) => m.subject === 'Chat');
    expect(chatBefore?.secondsLeft).toBeGreaterThan(0);

    // Same quiet interval as the escrow test above, same recipient, but
    // nothing ever touches this mailbox again: the periodic sweep must NOT
    // skip it, unlike before the fix.
    const refreshedDirty = drainUntilRedirtied(sim, bobKey);
    const chatAfterDrain = refreshedDirty
      .find((p) => p.recipientKey === bobKey)
      ?.letters.find((m) => m.subject === 'Chat');
    expect(chatAfterDrain).toBeDefined();
    // The drain: the persisted snapshot's countdown actually advanced, not
    // just the live in-memory letter's.
    expect(chatAfterDrain?.secondsLeft).toBeLessThan(chatBefore?.secondsLeft as number);

    // The restart: a fresh Sim loaded from EXACTLY what the drain produced
    // (nothing more) must carry that same advanced countdown forward, not
    // hand the letter a fresh 14-day window from a stale secondsLeft.
    const sim2 = makeWorld();
    sim2.loadMail({ mail: [chatAfterDrain!], nextMailId: chatAfterDrain!.id + 1 });
    const reloaded = sim2.serializeMail().mail.find((m) => m.subject === 'Chat');
    expect(reloaded?.secondsLeft).toBe(chatAfterDrain?.secondsLeft);
    expect(reloaded?.secondsLeft).toBeLessThan(chatBefore?.secondsLeft as number);
  });

  it('a dirty write touches only the changed recipient, never the rest of a large book (the #3561 cost claim)', () => {
    const sim = makeWorld();
    // A wide but shallow book: many recipients, one letter each, none of them
    // dirtied by the mutation under test.
    const bystanders = Array.from({ length: 500 }, (_, i) => ({
      recipientKey: `bystander-${i}`,
      recipientName: `Bystander${i}`,
      senderName: 'System',
      kind: 'system' as const,
      subject: 'Filler',
      body: '',
      copper: 0,
      delaySeconds: 0,
      items: [],
    }));
    sim.loadMail({ mail: bystanders } as never);
    sim.takeDirtyMailPartitions();

    const alice = sim.addPlayer('warrior', 'Alice'); // dirties exactly Alice's own welcome letter
    const dirty = sim.takeDirtyMailPartitions();
    expect(dirty).toHaveLength(1); // not 501: cost is proportional to what changed
    void alice;
  });

  it('at 150k-letter production scale, a dirty write is well under the old whole-book serialize cost (#3561 acceptance criterion)', () => {
    // Mirrors the scale issue #3561 measured on prod (134,431 letters, ~250ms
    // JSON.stringify alone) and its own acceptance criterion: "With a
    // synthetic 150k-letter book, the per-cycle main-thread block is under
    // 10ms". Shape: 15,000 recipients x 10 letters each, plain system mail
    // (no escrow), the same "static junk" shape the bot-welcome-letter
    // problem (#3560) actually produced.
    const RECIPIENTS = 15_000;
    const LETTERS_PER_RECIPIENT = 10;
    const bulk: {
      recipientKey: string;
      recipientName: string;
      senderName: string;
      kind: 'system';
      subject: string;
      body: string;
      copper: number;
      delaySeconds: number;
      items: never[];
    }[] = [];
    for (let r = 0; r < RECIPIENTS; r++) {
      for (let n = 0; n < LETTERS_PER_RECIPIENT; n++) {
        bulk.push({
          recipientKey: `bot-${r}`,
          recipientName: `Bot${r}`,
          senderName: 'Ravenpost',
          kind: 'system',
          subject: 'The ravens now fly for you',
          body: 'Welcome to ClaudeCraft. Visit any Raven Pillar to check your mail.',
          copper: 0,
          delaySeconds: 0,
          items: [],
        });
      }
    }
    const sim = makeWorld();
    sim.loadMail({ mail: bulk } as never);
    expect(sim.serializeMail().mail.length).toBe(RECIPIENTS * LETTERS_PER_RECIPIENT);

    // The OLD design's per-cycle cost: re-serialize the ENTIRE book every
    // autosave regardless of what changed.
    const fullStart = performance.now();
    const fullJson = JSON.stringify(sim.serializeMail());
    const fullMs = performance.now() - fullStart;

    // A single real player mutates their OWN mailbox (a plain send): the
    // ONLY thing a real 30s window would actually need to persist. Resolved
    // send (mailSendResolved), not name lookup: 'bot-0' exists only as raw
    // loaded mail data here, not a real Sim character to resolve by name.
    const alice = sim.addPlayer('warrior', 'Alice');
    moveToMailbox(sim, alice);
    sim.meta(alice)!.copper = 100;
    sim.mailSendResolved({ key: 'bot-0', name: 'Bot0' }, 'Hi', 'A note.', 50, [], alice);

    // The NEW design's per-cycle cost: only the dirty partitions.
    const dirtyStart = performance.now();
    const dirty = sim.takeDirtyMailPartitions();
    const dirtyJson = JSON.stringify(dirty);
    const dirtyMs = performance.now() - dirtyStart;

    // Exactly the two recipients this send actually touched (Alice's welcome
    // letter's box, and Bot0's box receiving the new letter), never the
    // other 14,998 untouched mailboxes.
    expect(dirty.map((p) => p.recipientKey).sort()).toEqual([String(alice), 'bot-0'].sort());
    expect(dirtyJson.length).toBeLessThan(fullJson.length / 100); // >100x smaller payload
    expect(dirtyMs).toBeLessThan(10); // the #3561 acceptance bound
    expect(dirtyMs).toBeLessThan(fullMs); // and strictly cheaper than the old approach it replaces
  });

  it('a custody parcel keeps its book-once custodyRef through the incremental partition write', () => {
    // Regression: the extracted serializeLetter() helper this partition write
    // rides (PostOffice.takeDirtyMailPartitions) originally dropped
    // custodyRef, which would have silently un-booked every $WOC Exchange
    // parcel on the next restart and let a retry double-deliver it.
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    sim.takeDirtyMailPartitions(); // drain the welcome letter

    const meta = sim.meta(alice);
    if (!meta) throw new Error('no meta');
    sim.postOffice.mailSystemParcel(
      { key: sim.postOffice.mailKeyFor(meta), name: meta.name },
      WOC_MARKET_DELIVERY_LETTER,
      [{ itemId: 'rusty_hatchet', count: 1, slot: 3 }],
      'woc_ref_test_1',
    );

    const dirty = sim.takeDirtyMailPartitions();
    const letter = dirty
      .flatMap((p) => p.letters)
      .find((m) => m.subject === WOC_MARKET_DELIVERY_LETTER.subject);
    expect(letter?.custodyRef).toBe('woc_ref_test_1');
  });

  it('a delayed never-expiring system parcel dirties only its recipient when delivery lands', () => {
    const sim = makeWorld();
    sim.postOffice.sendLetter(
      'rewardee',
      'Rewardee',
      {
        letterId: 'test_delayed_reward',
        senderName: 'Quartermaster',
        subject: 'Delayed reward',
        body: 'For later.',
        copper: 250,
        delaySeconds: 5,
      },
      'system',
    );
    const sent = sim.takeDirtyMailPartitions();
    expect(sent.map((p) => p.recipientKey)).toEqual(['rewardee']);
    const sentLetter = sent[0].letters.find((m) => m.subject === 'Delayed reward');
    expect(sentLetter?.deliverIn).toBe(5);
    expect(sentLetter?.secondsLeft).toBe(-1);

    sim.postOffice.sendLetter(
      'bystander',
      'Bystander',
      {
        letterId: 'test_other_reward',
        senderName: 'Quartermaster',
        subject: 'Other reward',
        body: 'Still quiet.',
        copper: 100,
        delaySeconds: 500,
      },
      'system',
    );
    sim.takeDirtyMailPartitions();

    tickFor(sim, 6);
    const landed = sim.takeDirtyMailPartitions();
    expect(landed.map((p) => p.recipientKey)).toEqual(['rewardee']);
    const persisted = landed[0].letters.find((m) => m.subject === 'Delayed reward');
    expect(persisted?.deliverIn).toBe(0);
    expect(persisted?.secondsLeft).toBe(-1);
  });
});

// Character deletion (R43): the deleted character's mailbox leaves the book, but
// never at the cost of another player's property. Letters addressed to them can
// carry someone else's escrowed coin and goods, so an unclaimed player parcel
// flies home through the ordinary return flight and only letters with nothing at
// stake are deleted.
describe('purgeMailOwner - deleting a character', () => {
  const DOOMED_ID = 555;
  const DOOMED_KEY = String(DOOMED_ID);

  // biome-ignore lint/suspicious/noExplicitAny: read and seed the raw book directly.
  const bookOf = (sim: Sim): any[] => (sim.postOffice as any).mail;

  function letterBy(sim: Sim, match: (m: { subject: string }) => boolean, label: string) {
    const m = bookOf(sim).find(match);
    if (!m) throw new Error(`missing letter: ${label}`);
    return m;
  }

  // A live sender standing at a mailbox with coin and goods to post.
  function makeSender(sim: Sim): number {
    const pid = sim.addPlayer('warrior', 'Alice');
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.copper = 100_000;
    sim.addItem('roasted_boar', 6, pid);
    moveToMailbox(sim, pid);
    return pid;
  }

  // The former linear scan, the oracle the maintained unread index must match.
  function unreadOracle(sim: Sim, pid: number): number {
    const meta = sim.meta(pid);
    if (!meta) return 0;
    const now = sim.time;
    const key = String(meta.characterId ?? meta.entityId);
    let n = 0;
    for (const m of bookOf(sim)) {
      if (!m.read && now >= m.deliverAt && (m.recipientKey === key || m.recipientKey === meta.name))
        n++;
    }
    return n;
  }

  it('flies live senders their escrow home and deletes the rest, under BOTH keys', () => {
    const sim = makeWorld();
    const alice = makeSender(sim);
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    const aliceKey = sim.postOffice.mailKeyFor(aliceMeta);
    const bystander = sim.addPlayer('mage', 'Bystander');
    const bystanderMeta = sim.meta(bystander);
    if (!bystanderMeta) throw new Error('no meta');

    // Id-keyed parcel (coin + goods), id-keyed bare note, and a LEGACY name-keyed
    // parcel: all three addressed to the character about to be deleted.
    sim.mailSendResolved(
      { key: DOOMED_KEY, name: 'Doomed' },
      'Parcel',
      'Hold this.',
      500,
      [{ itemId: 'roasted_boar', count: 2 }],
      alice,
    );
    sim.mailSendResolved({ key: DOOMED_KEY, name: 'Doomed' }, 'Note', 'Just words.', 0, [], alice);
    // A goods-only parcel (items, zero copper): the items arm of the escrow
    // predicate must fly it home on its own.
    sim.mailSendResolved(
      { key: DOOMED_KEY, name: 'Doomed' },
      'Goods',
      'Take these.',
      0,
      [{ itemId: 'roasted_boar', count: 3 }],
      alice,
    );
    sim.mailSendResolved(
      { key: 'Doomed', name: 'Doomed' },
      'Legacy',
      'Older post.',
      250,
      [],
      alice,
    );
    // An authored parcel: minted by the world, with no live sender to fly home to.
    sim.postOffice.sendLetter(
      DOOMED_KEY,
      'Doomed',
      { ...QUEST_LETTERS.q_wolves, items: [{ itemId: 'roasted_boar', count: 1 }] },
      'npc',
    );
    // A letter to someone else entirely: out of scope for this purge.
    sim.mailSendResolved(
      { key: sim.postOffice.mailKeyFor(bystanderMeta), name: 'Bystander' },
      'Untouched',
      'Hello.',
      10,
      [],
      alice,
    );

    expect(sim.purgeMailOwner(DOOMED_ID, 'Doomed')).toBe(true);

    // The two player parcels flew home to Alice with their escrow intact.
    const parcel = letterBy(sim, (m) => m.subject === 'Parcel', 'parcel');
    expect(parcel.recipientKey).toBe(aliceKey);
    expect(parcel.recipientName).toBe('Alice');
    expect(parcel.senderName).toBe('Doomed');
    expect(parcel.returned).toBe(true);
    expect(parcel.copper).toBe(500);
    expect(parcel.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    const legacy = letterBy(sim, (m) => m.subject === 'Legacy', 'legacy parcel');
    expect(legacy.recipientKey).toBe(aliceKey);
    expect(legacy.copper).toBe(250);
    expect(legacy.returned).toBe(true);
    // The NAME-keyed legacy parcel's return identity is the STABLE id: the
    // purge normalizes the address before the flight, so returnToSender
    // never records a reclaimable display name as the new senderKey.
    expect((legacy as { senderKey?: string }).senderKey).toBe(DOOMED_KEY);
    const goods = letterBy(sim, (m) => m.subject === 'Goods', 'goods-only parcel');
    expect(goods.recipientKey).toBe(aliceKey);
    expect(goods.copper).toBe(0);
    expect(goods.items).toEqual([{ itemId: 'roasted_boar', count: 3 }]);
    expect(goods.returned).toBe(true);

    // The bare note and the authored parcel are gone; the bystander keeps his.
    expect(bookOf(sim).some((m) => m.subject === 'Note')).toBe(false);
    expect(bookOf(sim).some((m) => m.letterId === QUEST_LETTERS.q_wolves.letterId)).toBe(false);
    expect(letterBy(sim, (m) => m.subject === 'Untouched', 'bystander letter').recipientKey).toBe(
      sim.postOffice.mailKeyFor(bystanderMeta),
    );
    // Nothing is left addressed to the deleted character under either key.
    expect(
      bookOf(sim).some((m) => m.recipientKey === DOOMED_KEY || m.recipientKey === 'Doomed'),
    ).toBe(false);

    // The index still matches the scan, and the returns really land: the normal
    // delivery path announces both parcels into Alice's mailbox.
    expect(sim.mailUnreadFor(alice)).toBe(unreadOracle(sim, alice));
    expect(sim.mailUnreadFor(bystander)).toBe(unreadOracle(sim, bystander));
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    expect(sim.mailUnreadFor(alice)).toBe(unreadOracle(sim, alice));
    const inbox = sim.mailInfoFor(alice)?.messages ?? [];
    expect(inbox.find((m) => m.subject === 'Parcel')?.copper).toBe(500);
    expect(inbox.find((m) => m.subject === 'Legacy')?.copper).toBe(250);
  });

  it('purging a DELIVERED unread name-keyed parcel moves its unread count off the name bucket', () => {
    // The wrong-bucket regression: the purge's return arm normalizes the
    // legacy name key to the stable id BEFORE returnToSender, whose own
    // decrement reads the just-overwritten field. Without the index move the
    // name bucket keeps a phantom +1 that the freed name's NEXT holder reads
    // through mailUnreadFor forever (an unread badge with no letter). No
    // current send path books this shape (returns set `returned`, sends key
    // by id); loadMail preserves it verbatim from a legacy blob, which is
    // what the raw-book seed below stands in for.
    const sim = makeWorld();
    const alice = makeSender(sim);
    sim.mailSendResolved(
      { key: DOOMED_KEY, name: 'Doomed' },
      'LegacyDelivered',
      'Old address.',
      250,
      [],
      alice,
    );
    const legacy = letterBy(sim, (m) => m.subject === 'LegacyDelivered', 'legacy parcel');
    legacy.recipientKey = 'Doomed'; // the legacy name-keyed shape, pre-stable-id
    // Deliver it: deliverDue books the unread count under the NAME bucket,
    // exactly where a legacy blob's load would put it. Pin that precondition
    // outright: if delivery ever starts normalizing legacy keys, this test's
    // phantom-producing seed evaporates and the pin below turns vacuous.
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    // biome-ignore lint/suspicious/noExplicitAny: read the raw index directly.
    expect((sim.postOffice as any).index.unread.get('Doomed')).toBe(1);
    expect(sim.purgeMailOwner(DOOMED_ID, 'Doomed')).toBe(true);
    // The parcel flew home to its live sender rather than being destroyed.
    const flown = letterBy(sim, (m) => m.subject === 'LegacyDelivered', 'returned parcel');
    expect(flown.returned).toBe(true);
    expect(flown.copper).toBe(250);
    // The decisive half: the freed name's next holder inherits NO phantom
    // unread, and the maintained index still matches the linear-scan oracle.
    // The purged name's bucket is GONE outright (the phantom would live
    // here), and the next holder of the name reads exactly the truth (their
    // own welcome letter, nothing inherited).
    // biome-ignore lint/suspicious/noExplicitAny: read the raw index directly.
    expect((sim.postOffice as any).index.unread.has('Doomed')).toBe(false);
    const nextHolder = sim.addPlayer('mage', 'Doomed', { characterId: 999 });
    expect(sim.mailUnreadFor(nextHolder)).toBe(unreadOracle(sim, nextHolder));
    expect(sim.mailUnreadFor(alice)).toBe(unreadOracle(sim, alice));
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    expect(sim.mailUnreadFor(nextHolder)).toBe(unreadOracle(sim, nextHolder));
    expect(sim.mailUnreadFor(alice)).toBe(unreadOracle(sim, alice));
  });

  it('a pre-senderKey letter decides its fate by sender NAME, and the purge stamps outgoing mail', () => {
    // At ship time EVERY letter written before #2450 lacks senderKey, so the
    // name fallback is the live path, not an ancient edge. Three arms:
    // (a) a stranger's pre-senderKey parcel still flies home, keyed by their
    //     display name (the dual-key read lets them claim it);
    // (b) a pre-senderKey parcel whose senderName EQUALS the purged name
    //     reads as self-addressed and is deleted (the documented edge);
    // (c) the purge stamps the deleted character's own pre-senderKey
    //     OUTGOING letters with the stable id, so a later return flight
    //     lands on the dead id instead of a future holder of the name.
    const sim = makeWorld();
    sim.addPlayer('warrior', 'Doomed', { characterId: DOOMED_ID });
    const alice = sim.addPlayer('mage', 'Alice', { characterId: 501 });
    const bob = sim.addPlayer('rogue', 'Bob', { characterId: 502 });
    const bobMeta = sim.meta(bob);
    const aliceMeta = sim.meta(alice);
    if (!bobMeta || !aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000; // coin for the escrow and postage
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): the new-character spawn moved
    // to the quay, ~93yd from the mailbox, so the sender must walk to the box
    // (the nearMailbox gate) like every other sending test does.
    moveToMailbox(sim, alice);

    sim.mailSendResolved(
      { key: DOOMED_KEY, name: 'Doomed' },
      'OldParcel',
      'From before the ids.',
      120,
      [],
      alice,
    );
    sim.mailSendResolved(
      { key: DOOMED_KEY, name: 'Doomed' },
      'OldSelf',
      'Mine to mine.',
      80,
      [],
      alice,
    );
    sim.mailSendResolved(
      { key: sim.postOffice.mailKeyFor(bobMeta), name: 'Bob' },
      'OldOutgoing',
      'From Doomed to Bob.',
      60,
      [],
      alice,
    );
    // Rewind all three to the pre-#2450 shape: no senderKey; the self and
    // outgoing arms carry the deleted character's display name as sender.
    for (const m of bookOf(sim)) {
      if (m.subject === 'OldParcel') m.senderKey = undefined;
      if (m.subject === 'OldSelf' || m.subject === 'OldOutgoing') {
        m.senderKey = undefined;
        m.senderName = 'Doomed';
      }
    }

    expect(sim.purgeMailOwner(DOOMED_ID, 'Doomed')).toBe(true);

    // (a) the stranger's parcel flew home by NAME, claimable via dual keys.
    const returned = letterBy(sim, (m) => m.subject === 'OldParcel', 'returned old parcel');
    expect(returned.recipientKey).toBe('Alice');
    expect(returned.returned).toBe(true);
    expect(returned.copper).toBe(120);
    // (b) the name-matched letter read as self-addressed and is gone.
    expect(bookOf(sim).some((m) => m.subject === 'OldSelf')).toBe(false);
    // (c) the outgoing letter survives (it belongs to Bob) with the stable
    // id stamped in place of the reclaimable name.
    const outgoing = letterBy(sim, (m) => m.subject === 'OldOutgoing', 'outgoing letter');
    expect(outgoing.senderKey).toBe(DOOMED_KEY);
    // (d) the returned legacy parcel's new sender identity is the STABLE id,
    // never the reclaimable display name (returnToSender records the
    // outgoing address as senderKey, so the purge normalizes it first).
    const oldParcel = letterBy(sim, (m) => m.subject === 'OldParcel', 'old parcel');
    expect(oldParcel.senderKey).toBe(DOOMED_KEY);
  });

  it('the outgoing stamp is player-kind only: authored mail is never re-attributed', () => {
    // An authored npc letter whose sender NAME matches the purged character
    // must not be stamped (system/npc senderKey is absent by construction
    // and never returns), and a purge that finds nothing else reports no
    // change, so no spurious save fires.
    const sim = makeWorld();
    sim.addPlayer('warrior', 'Doomed', { characterId: DOOMED_ID });
    const bob = sim.addPlayer('rogue', 'Bob', { characterId: 502 });
    const bobMeta = sim.meta(bob);
    if (!bobMeta) throw new Error('no meta');
    sim.postOffice.sendLetter(
      sim.postOffice.mailKeyFor(bobMeta),
      'Bob',
      { ...QUEST_LETTERS.q_wolves },
      'npc',
    );
    for (const m of bookOf(sim)) {
      if ((m as { letterId?: string }).letterId === QUEST_LETTERS.q_wolves.letterId) {
        m.senderName = 'Doomed';
      }
    }

    // First purge clears the join welcome letter; the SECOND finds only the
    // name-matched authored letter, which must count as no change (no
    // stamp, no spurious save).
    sim.purgeMailOwner(DOOMED_ID, 'Doomed');
    expect(sim.purgeMailOwner(DOOMED_ID, 'Doomed')).toBe(false);
    const authored = letterBy(
      sim,
      (m) => (m as { letterId?: string }).letterId === QUEST_LETTERS.q_wolves.letterId,
      'authored letter',
    );
    expect(authored.senderKey).toBeUndefined();
  });

  it('a rename (or name reclaim) stamps the character pre-senderKey outgoing mail', () => {
    // rekeyMailOwner frees oldName for a stranger exactly like the delete
    // purge does, so the same outgoing stamp applies: the letter follows
    // the character (stable id, new display name), not the freed name.
    const sim = makeWorld();
    const alice = sim.addPlayer('mage', 'Alice', { characterId: 501 });
    const bob = sim.addPlayer('rogue', 'Bob', { characterId: 502 });
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): spawn moved to the quay, out
    // of the nearMailbox gate; walk the sender to the box before sending.
    moveToMailbox(sim, alice);
    sim.mailSendResolved(
      { key: sim.postOffice.mailKeyFor(bobMeta), name: 'Bob' },
      'FromAlice',
      'Hello.',
      50,
      [],
      alice,
    );
    for (const m of bookOf(sim)) {
      if (m.subject === 'FromAlice') m.senderKey = undefined; // pre-#2450 shape
    }

    expect(sim.rekeyMailOwner(501, 'Alice', 'Zelda')).toBe(true);
    const letter = letterBy(sim, (m) => m.subject === 'FromAlice', 'outgoing letter');
    expect(letter.senderKey).toBe('501');
    expect(letter.senderName).toBe('Zelda');
  });

  it('deletes a parcel whose return flight already ran rather than sending it round again', () => {
    const sim = makeWorld();
    const doomed = sim.addPlayer('warrior', 'Doomed', { characterId: DOOMED_ID });
    sim.addPlayer('mage', 'Bob');
    const doomedMeta = sim.meta(doomed);
    if (!doomedMeta) throw new Error('no meta');
    doomedMeta.copper = 10_000;
    sim.addItem('roasted_boar', 2, doomed);
    moveToMailbox(sim, doomed);
    // The doomed character's own unclaimed parcel expires and flies home to them.
    sim.mailSend(
      'Bob',
      'Parcel',
      'Hold this.',
      500,
      [{ itemId: 'roasted_boar', count: 2 }],
      doomed,
    );
    letterBy(sim, (m) => m.subject === 'Parcel', 'parcel').expiresAt = sim.time;
    tickFor(sim, 2);
    const returned = letterBy(sim, (m) => m.subject === 'Parcel', 'returned parcel');
    expect(returned.returned).toBe(true);
    expect(returned.recipientKey).toBe(DOOMED_KEY);

    // Deleting them now destroys it: the escrow was theirs and the one sanctioned
    // destruction (the return flight has run) applies exactly as in the sweep.
    expect(sim.purgeMailOwner(DOOMED_ID, 'Doomed')).toBe(true);
    expect(bookOf(sim).some((m) => m.subject === 'Parcel')).toBe(false);
    expect(sim.mailUnreadFor(doomed)).toBe(unreadOracle(sim, doomed));
  });

  it('deletes a self-addressed parcel instead of returning it to the same dead key', () => {
    const sim = makeWorld();
    const doomed = sim.addPlayer('warrior', 'Doomed', { characterId: DOOMED_ID });
    const doomedMeta = sim.meta(doomed);
    if (!doomedMeta) throw new Error('no meta');
    doomedMeta.copper = 10_000;
    sim.addItem('roasted_boar', 2, doomed);
    moveToMailbox(sim, doomed);
    sim.mailSend(
      'Doomed',
      'Selfpost',
      'Mine.',
      500,
      [{ itemId: 'roasted_boar', count: 2 }],
      doomed,
    );
    expect(letterBy(sim, (m) => m.subject === 'Selfpost', 'self parcel').senderKey).toBe(
      DOOMED_KEY,
    );

    expect(sim.purgeMailOwner(DOOMED_ID, 'Doomed')).toBe(true);
    expect(bookOf(sim).some((m) => m.subject === 'Selfpost')).toBe(false);
    expect(sim.mailUnreadFor(doomed)).toBe(unreadOracle(sim, doomed));
  });

  it('drops delivered unread letters out of the unread index', () => {
    const sim = makeWorld();
    // The mailbox owner is live here only so the maintained index is observable;
    // the real delete flow is gated on the character being offline.
    const doomed = sim.addPlayer('warrior', 'Doomed', { characterId: DOOMED_ID });
    const alice = makeSender(sim);
    sim.mailSendResolved({ key: DOOMED_KEY, name: 'Doomed' }, 'Note', 'Just words.', 0, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    // The welcome letter plus the note: both delivered, both unread.
    expect(sim.mailUnreadFor(doomed)).toBe(2);

    expect(sim.purgeMailOwner(DOOMED_ID, 'Doomed')).toBe(true);
    expect(bookOf(sim).some((m) => m.recipientKey === DOOMED_KEY)).toBe(false);
    expect(sim.mailUnreadFor(doomed)).toBe(0);
    expect(unreadOracle(sim, doomed)).toBe(0);
  });

  it('drops an in-flight letter from the in-flight set when it is deleted', () => {
    const sim = makeWorld();
    const alice = makeSender(sim);
    sim.mailSendResolved({ key: DOOMED_KEY, name: 'Doomed' }, 'Note', 'Just words.', 0, [], alice);
    const note = letterBy(sim, (m) => m.subject === 'Note', 'in-flight note');
    expect(sim.time).toBeLessThan(note.deliverAt); // still on the wing

    expect(sim.purgeMailOwner(DOOMED_ID, 'Doomed')).toBe(true);
    // biome-ignore lint/suspicious/noExplicitAny: the in-flight set is module-private.
    const undelivered = (sim.postOffice as any).index.undelivered as Set<unknown>;
    expect(undelivered.has(note)).toBe(false);
    // Flying past the old delivery time must not resurrect it in the unread index.
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    expect(bookOf(sim).some((m) => m.subject === 'Note')).toBe(false);
    expect(sim.mailUnreadFor(alice)).toBe(unreadOracle(sim, alice));
  });

  it('reports no change for a character with no mail, and refuses a non-finite id', () => {
    const sim = makeWorld();
    const alice = makeSender(sim);
    sim.mailSendResolved({ key: 'Doomed', name: 'Doomed' }, 'Legacy', 'Older post.', 0, [], alice);

    expect(sim.purgeMailOwner(999, 'Nobody')).toBe(false);
    expect(bookOf(sim).some((m) => m.subject === 'Legacy')).toBe(true);
    // The guard mirrors rekeyMailOwner: without a real id, the name alone is not
    // enough to purge by.
    expect(sim.purgeMailOwner(Number.NaN, 'Doomed')).toBe(false);
    expect(letterBy(sim, (m) => m.subject === 'Legacy', 'legacy letter').recipientKey).toBe(
      'Doomed',
    );
  });

  it('the rename sweep re-keys the SIGNER inside a parcel addressed to the renamer', () => {
    // Since #2507 an instanced copy rides the raven, and its signer is a
    // separate string the recipient rekey does not touch by itself. Upstream
    // scopes the sweep to the recipient arm; shipped untested, so pinned here.
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.addItemInstance('roasted_boar', { signer: 'Alice' }, alice, 1);
    sim.drainEvents();
    sim.mailSend(
      'Bob',
      'Signed',
      'mine',
      0,
      [{ itemId: 'roasted_boar', count: 1, instance: { signer: 'Alice' } }],
      alice,
    );
    const letter = sim.postOffice.mail.find((m) => m.subject === 'Signed');
    if (!letter) throw new Error('no letter');
    expect(letter.items[0]?.instance?.signer).toBe('Alice');

    // The sweep is scoped to the recipient arm, so address the parcel to the
    // character being renamed. (Alice signed it; the signer is what follows.)
    letter.recipientKey = 'Alice';
    expect(sim.rekeyMailOwner(555, 'Alice', 'Alicia')).toBe(true);
    expect(letter.items[0]?.instance?.signer).toBe('Alicia');
  });

  it('the rename sweep leaves a parcel addressed to a STRANGER alone', () => {
    // The deliberate scope boundary (the accepted craftedBy limitation),
    // pinned so a later widening is a conscious choice rather than drift.
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.addItemInstance('roasted_boar', { signer: 'Alice' }, alice, 1);
    sim.drainEvents();
    sim.mailSend(
      'Bob',
      'Foreign',
      'theirs',
      0,
      [{ itemId: 'roasted_boar', count: 1, instance: { signer: 'Alice' } }],
      alice,
    );
    const letter = sim.postOffice.mail.find((m) => m.subject === 'Foreign');
    if (!letter) throw new Error('no letter');
    letter.recipientKey = 'somebody-else';
    letter.senderKey = 'somebody-else';
    letter.senderName = 'Somebody Else';

    sim.rekeyMailOwner(555, 'Alice', 'Alicia');
    expect(letter.items[0]?.instance?.signer).toBe('Alice');
  });
});
