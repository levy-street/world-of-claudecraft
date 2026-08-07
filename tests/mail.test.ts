// The Ravenpost (src/sim/mail/post_office.ts): welcome letter, player-to-player
// sending with coin/parcel escrow, raven delivery delay, mailbox proximity
// gating, take/delete rules, quest thank-you letters, persistence round-trip,
// and rename rekeying. Pure sim tests: construct a Sim, advance fixed ticks.

import { describe, expect, it } from 'vitest';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { HEROIC_MARK_LETTER, QUEST_LETTERS, WELCOME_LETTER } from '../src/sim/content/letters';
import { MAILBOXES } from '../src/sim/content/mailboxes';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  MAIL_ATTACHMENT_EXPIRY_SECONDS,
  MAIL_DELIVERY_SECONDS,
  MAIL_MAX_ATTACHMENTS,
  MAIL_POSTAGE,
} from '../src/sim/mail/post_office';
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
    expect((sim.postOffice as any).unreadIndex.get('Doomed')).toBe(1);
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
    expect((sim.postOffice as any).unreadIndex.has('Doomed')).toBe(false);
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
    const undelivered = (sim.postOffice as any).undelivered as Set<unknown>;
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
