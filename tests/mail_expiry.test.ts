// Mail attachment expiry (src/sim/mail/post_office.ts): player parcels ride a
// 30-day sim-time window, fly home to their sender exactly once when it lapses,
// and only a RETURNED letter may ever be deleted with attachments aboard (the
// phase's hard invariant). System/npc parcels are exempt by construction
// (expiresAt stays Infinity) and the sweep filters on kind besides. Pure sim
// tests: construct a Sim, advance fixed ticks, no rng drawn by the post.

import { describe, expect, it } from 'vitest';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { HEROIC_MARK_LETTER, QUEST_LETTERS, WELCOME_LETTER } from '../src/sim/content/letters';
import { MAIL_ATTACHMENT_EXPIRY_SECONDS, MAIL_DELIVERY_SECONDS } from '../src/sim/mail/post_office';
import { Sim } from '../src/sim/sim';
import { DT, type SimEvent } from '../src/sim/types';

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

// biome-ignore lint/suspicious/noExplicitAny: reach into the book to drive and inspect raw expiry.
const bookOf = (sim: Sim): any[] => (sim.postOffice as any).mail;

// Alice mails Bob a parcel (2 boars + coin) from a mailbox; returns the live
// raw letter so tests can force its clock without ticking 30 sim-days.
function setupParcel(copper = 500) {
  const sim = makeWorld();
  const alice = sim.addPlayer('warrior', 'Alice');
  const bob = sim.addPlayer('mage', 'Bob');
  const aliceMeta = sim.meta(alice);
  if (!aliceMeta) throw new Error('no meta');
  aliceMeta.copper = 10_000;
  sim.addItem('roasted_boar', 2, alice);
  moveToMailbox(sim, alice);
  const sentAt = sim.time;
  sim.mailSend(
    'Bob',
    'Parcel',
    'Hold this.',
    copper,
    [{ itemId: 'roasted_boar', count: 2 }],
    alice,
  );
  const raw = bookOf(sim).find((m) => m.subject === 'Parcel');
  if (!raw) throw new Error('parcel not booked');
  sim.drainEvents();
  return { sim, alice, bob, aliceMeta, sentAt, raw };
}

describe('the attachment window at send', () => {
  it('gives a player parcel the 30-day clock; a bare note keeps the 14-day model', () => {
    const { sim, alice, sentAt, raw } = setupParcel();
    expect(MAIL_ATTACHMENT_EXPIRY_SECONDS).toBe(30 * 24 * 3600);
    expect(raw.expiresAt).toBe(sentAt + MAIL_ATTACHMENT_EXPIRY_SECONDS);
    // Coin alone is an attachment too.
    const t1 = sim.time;
    sim.mailSend('Bob', 'Coin only', 'x', 100, [], alice);
    const coin = bookOf(sim).find((m) => m.subject === 'Coin only');
    expect(coin.expiresAt).toBe(t1 + MAIL_ATTACHMENT_EXPIRY_SECONDS);
    // A bare note stays on the untouched emptied-letter model.
    sim.mailSend('Bob', 'Note', 'x', 0, [], alice);
    const note = bookOf(sim).find((m) => m.subject === 'Note');
    expect(note.expiresAt).toBe(t1 + 14 * 24 * 3600);
  });
});

describe('the return flight', () => {
  it('returns the unclaimed parcel AT the expiry boundary, through the normal delivery path', () => {
    const { sim, alice, bob, raw } = setupParcel();
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    expect(raw.announced).toBe(true);
    const bobKey = raw.recipientKey;
    const unreadAlice = sim.mailUnreadFor(alice);
    const unreadBob = sim.mailUnreadFor(bob);

    // Align on a sweep tick, then replicate the sim's one-DT-at-a-time float
    // accumulation so the boundary equalities below are bit-exact.
    while (sim.tickCount % 20 !== 0) sim.tick();
    let t = sim.time;
    for (let i = 0; i < 20; i++) t += DT;
    const sweepBefore = t; // the next sweep, strictly before the boundary
    for (let i = 0; i < 20; i++) t += DT;
    const boundary = t; // the sweep after it, exactly AT the expiry
    raw.expiresAt = boundary;

    tickFor(sim, 1); // runs the sweepBefore sweep: now < expiresAt, untouched
    expect(sim.time).toBe(sweepBefore);
    expect(raw.returned).toBeFalsy();
    expect(raw.recipientKey).toBe(bobKey);

    tickFor(sim, 1); // the boundary sweep: now === expiresAt exactly
    expect(sim.time).toBe(boundary);
    expect(raw.returned).toBe(true);
    // Re-keyed onto the sender's name bucket, the names swapped honestly.
    expect(raw.recipientKey).toBe('Alice');
    expect(raw.recipientName).toBe('Alice');
    expect(raw.senderName).toBe('Bob');
    // Attachments ride home intact and the letter flies fresh.
    expect(raw.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(raw.copper).toBe(500);
    expect(raw.read).toBe(false);
    expect(raw.announced).toBe(false);
    expect(raw.deliverAt).toBe(boundary + MAIL_DELIVERY_SECONDS);
    expect(raw.expiresAt).toBe(boundary + MAIL_ATTACHMENT_EXPIRY_SECONDS);

    // Still on the wing: Bob no longer owns it, Alice does not count it yet.
    expect(sim.mailUnreadFor(bob)).toBe(unreadBob - 1);
    expect(sim.mailUnreadFor(alice)).toBe(unreadAlice);
    moveToMailbox(sim, bob);
    expect(sim.mailInfoFor(bob)?.messages.some((m) => m.subject === 'Parcel')).toBe(false);

    // The normal delivery path lands and announces the return to Alice.
    const events = tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    expect(
      events.some((e) => e.type === 'mailArrived' && e.pid === alice && e.senderName === 'Bob'),
    ).toBe(true);
    expect(sim.mailUnreadFor(alice)).toBe(unreadAlice + 1);
    moveToMailbox(sim, alice);
    const back = sim.mailInfoFor(alice)?.messages.find((m) => m.subject === 'Parcel');
    expect(back?.senderName).toBe('Bob');
    expect(back?.kind).toBe('player');
    expect(back?.copper).toBe(500);
    expect(back?.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(back?.read).toBe(false);
  });

  it('never deletes an un-returned parcel: expiry without the flag always bounces', () => {
    const { sim, raw } = setupParcel();
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    const id = raw.id;

    // First forced expiry: the sweep returns, never deletes.
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.id === id)).toBe(true);
    expect(raw.returned).toBe(true);

    // Strip the flag (as far as the sweep can see, no cycle has run) and expire
    // again: structurally still the return arm, never the delete arm, and the
    // attachments are intact both times.
    raw.returned = false;
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.id === id)).toBe(true);
    expect(raw.returned).toBe(true);
    expect(raw.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(raw.copper).toBe(500);
    // It bounced back the other way: recipient and sender swapped again.
    expect(raw.recipientKey).toBe('Bob');
    expect(raw.senderName).toBe('Alice');
  });

  it('deletes the returned letter with its attachments at the second expiry, and only then', () => {
    const { sim, alice, raw } = setupParcel();
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    const id = raw.id;
    raw.expiresAt = sim.time;
    tickFor(sim, 2); // the return cycle runs
    expect(raw.returned).toBe(true);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2); // lands unread at Alice's
    const unread = sim.mailUnreadFor(alice);
    raw.expiresAt = sim.time;
    tickFor(sim, 2); // the one sanctioned destruction
    expect(bookOf(sim).some((m) => m.id === id)).toBe(false);
    expect(sim.mailUnreadFor(alice)).toBe(unread - 1);
  });
});

describe('the system and npc exemption', () => {
  it('gives authored parcels no clock at all through the real send paths', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Keeper');
    const welcome = bookOf(sim).find((m) => m.letterId === WELCOME_LETTER.letterId);
    expect(welcome.kind).toBe('system');
    expect(welcome.copper).toBeGreaterThan(0);
    expect(Number.isFinite(welcome.expiresAt)).toBe(false);
    sim.postOffice.mailHeroicMarks(pid, HEROIC_MARK_ITEM_ID, 3);
    const marks = bookOf(sim).find((m) => m.letterId === HEROIC_MARK_LETTER.letterId);
    expect(Number.isFinite(marks.expiresAt)).toBe(false);
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    sim.postOffice.sendLetter(
      String(meta.characterId ?? meta.entityId),
      meta.name,
      { ...QUEST_LETTERS.q_wolves, items: [{ itemId: 'roasted_boar', count: 1 }] },
      'npc',
    );
    const npc = bookOf(sim).find((m) => m.letterId === QUEST_LETTERS.q_wolves.letterId);
    expect(npc.kind).toBe('npc');
    expect(Number.isFinite(npc.expiresAt)).toBe(false);
  });

  it('the sweep kind filter leaves a non-player parcel alone even past a forced expiry', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Keeper');
    sim.postOffice.mailHeroicMarks(pid, HEROIC_MARK_ITEM_ID, 3);
    tickFor(sim, 1);
    const marks = bookOf(sim).find((m) => m.letterId === HEROIC_MARK_LETTER.letterId);
    const welcome = bookOf(sim).find((m) => m.letterId === WELCOME_LETTER.letterId);
    marks.expiresAt = sim.time;
    welcome.expiresAt = sim.time;
    tickFor(sim, 2);
    // Untouched: not returned, not deleted, attachments intact.
    expect(marks.returned).toBeFalsy();
    expect(marks.items).toEqual([{ itemId: HEROIC_MARK_ITEM_ID, count: 3 }]);
    expect(welcome.returned).toBeFalsy();
    expect(welcome.copper).toBe(WELCOME_LETTER.copper);
    expect(bookOf(sim)).toContain(marks);
    expect(bookOf(sim)).toContain(welcome);
  });
});

describe('persistence', () => {
  it('starts the window at load for a legacy never-sentinel player parcel, keeps a finite one', () => {
    const { sim } = setupParcel();
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));
    const row = save.mail.find((m: { subject: string }) => m.subject === 'Parcel');
    // The live window round-trips as finite seconds-left, never the sentinel.
    expect(row.secondsLeft).toBe(MAIL_ATTACHMENT_EXPIRY_SECONDS);

    // Simulate a save written before the window existed: the never sentinel.
    row.secondsLeft = -1;
    const sim2 = makeWorld();
    const loadT = sim2.time;
    sim2.loadMail(save);
    const raw2 = bookOf(sim2).find((m) => m.subject === 'Parcel');
    expect(raw2.expiresAt).toBe(loadT + MAIL_ATTACHMENT_EXPIRY_SECONDS);
    // The system welcome letters in the same save keep Infinity.
    const wel2 = bookOf(sim2).find((m) => m.letterId === WELCOME_LETTER.letterId);
    expect(Number.isFinite(wel2.expiresAt)).toBe(false);

    // A finite persisted window is honoured, not overwritten by the deploy clock.
    const save3 = JSON.parse(JSON.stringify(sim.serializeMail()));
    const row3 = save3.mail.find((m: { subject: string }) => m.subject === 'Parcel');
    row3.secondsLeft = 1234;
    const sim3 = makeWorld();
    const t3 = sim3.time;
    sim3.loadMail(save3);
    const raw3 = bookOf(sim3).find((m) => m.subject === 'Parcel');
    expect(raw3.expiresAt).toBe(t3 + 1234);

    // A row from before the window field existed at all (the field ABSENT, not
    // the -1 sentinel) starts the deploy clock exactly like the sentinel arm.
    const save4 = JSON.parse(JSON.stringify(sim.serializeMail()));
    const row4 = save4.mail.find((m: { subject: string }) => m.subject === 'Parcel');
    delete row4.secondsLeft;
    const sim4 = makeWorld();
    const t4 = sim4.time;
    sim4.loadMail(save4);
    const raw4 = bookOf(sim4).find((m) => m.subject === 'Parcel');
    expect(raw4.expiresAt).toBe(t4 + MAIL_ATTACHMENT_EXPIRY_SECONDS);
  });

  it('round-trips the returned flag with its second window', () => {
    const { sim, raw } = setupParcel();
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(raw.returned).toBe(true);
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));
    const row = save.mail.find((m: { subject: string }) => m.subject === 'Parcel');
    expect(row.returned).toBe(true);
    // An un-returned row serializes with no flag at all (additive save shape).
    const welcomeRow = save.mail.find(
      (m: { letterId?: string }) => m.letterId === WELCOME_LETTER.letterId,
    );
    expect(welcomeRow.returned).toBeUndefined();

    const sim2 = makeWorld();
    const t2 = sim2.time;
    sim2.loadMail(save);
    const raw2 = bookOf(sim2).find((m) => m.subject === 'Parcel');
    expect(raw2.returned).toBe(true);
    expect(raw2.expiresAt).toBe(t2 + row.secondsLeft);
    const wel2 = bookOf(sim2).find((m) => m.letterId === WELCOME_LETTER.letterId);
    expect(wel2.returned).toBe(false);
  });
});

describe('a full sender mailbox', () => {
  it('still holds the returned letter: the cap is a send-time gate only', () => {
    const { sim, alice, aliceMeta, raw } = setupParcel();
    aliceMeta.copper = 100_000;
    // Fill Alice's box to the cap: the welcome letter plus 99 self-notes.
    for (let i = 0; i < 99; i++) sim.mailSend('Alice', `n${i}`, 'x', 0, [], alice);
    sim.drainEvents();
    sim.mailSend('Alice', 'overflow', 'x', 0, [], alice);
    const refused = sim.drainEvents();
    expect(refused.some((e) => e.type === 'mailResult' && e.code === 'recipientBoxFull')).toBe(
      true,
    );

    // The parcel expires unclaimed in Bob's box and flies home anyway.
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(raw.returned).toBe(true);
    expect(raw.recipientKey).toBe('Alice');
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    moveToMailbox(sim, alice);
    const info = sim.mailInfoFor(alice);
    // 100 stored at the cap, plus the returned letter the cap cannot refuse.
    expect(info?.totalCount).toBe(101);
    const back = info?.messages.find((m) => m.subject === 'Parcel');
    expect(back?.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(back?.copper).toBe(500);
  });
});

describe('taking a returned letter', () => {
  it('hands the attachments back and starts the standard emptied clock', () => {
    const { sim, alice, aliceMeta, raw } = setupParcel();
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    raw.expiresAt = sim.time;
    tickFor(sim, 2); // the return cycle runs
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2); // lands at Alice's
    moveToMailbox(sim, alice);
    const coinBefore = aliceMeta.copper;
    sim.mailTake(raw.id, alice);
    expect(aliceMeta.copper).toBe(coinBefore + 500);
    expect(sim.countItem('roasted_boar', alice)).toBe(2);
    expect(raw.items).toEqual([]);
    expect(raw.copper).toBe(0);
    expect(raw.read).toBe(true);
    // Emptied: the letter leaves the attachment window for the standard 14-day
    // emptied-letter clock, and the EMPTY prune arm collects it from there.
    expect(raw.expiresAt).toBe(sim.time + 14 * 24 * 3600);
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.id === raw.id)).toBe(false);
    // The goods survived the whole cycle: they sit in the bags.
    expect(sim.countItem('roasted_boar', alice)).toBe(2);
  });
});
