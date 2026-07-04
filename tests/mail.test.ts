// The Ravenpost (src/sim/mail/post_office.ts): welcome letter, player-to-player
// sending with coin/parcel escrow, raven delivery delay, mailbox proximity
// gating, take/delete rules, quest thank-you letters, persistence round-trip,
// and rename rekeying. Pure sim tests: construct a Sim, advance fixed ticks.

import { describe, expect, it } from 'vitest';
import { QUEST_LETTERS, WELCOME_LETTER } from '../src/sim/content/letters';
import { MAILBOXES } from '../src/sim/content/mailboxes';
import {
  MAIL_DELIVERY_SECONDS,
  MAIL_MAX_ATTACHMENTS,
  MAIL_POSTAGE,
} from '../src/sim/mail/post_office';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const makeWorld = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

function moveToMailbox(sim: Sim, pid: number): void {
  const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
  const p = sim.entities.get(pid);
  if (!box || !p) throw new Error('missing mailbox or player');
  p.pos = { ...box.pos };
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

    // Away from any mailbox.
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

  it('does not start the expiry clock while a partially-taken letter still holds parcels', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    sim.addItem('roasted_boar', 2, alice);
    moveToMailbox(sim, alice);
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
    // Attachments remain, so the expiry clock is still paused (Infinity).
    expect(Number.isFinite(raw.expiresAt)).toBe(false);
  });
});

describe('unread index equivalence (finding 4)', () => {
  it('matches the linear scan across sends, deliveries, reads, takes, deletes, renames and expiries', () => {
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
  });

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
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
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
