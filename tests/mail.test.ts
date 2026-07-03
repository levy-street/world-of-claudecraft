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
