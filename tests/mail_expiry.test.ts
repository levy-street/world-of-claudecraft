// Mail expiry (src/sim/mail/post_office.ts). Three rules:
//  - a letter with attachments aboard (coin or items) is NEVER auto-deleted:
//    an unclaimed player parcel rides a 30-day sim-time window, flies home to
//    its sender exactly once when it lapses, and then holds Infinity like a
//    system/npc parcel (exempt by construction, and the sweep filters on kind
//    and the returned flag besides);
//  - an emptied or bare letter that is UNREAD is deleted 30 sim-days after
//    booking, except an Exchange Broker letter, which waits until read;
//  - a READ emptied letter is deleted 3 sim-days after the read flip.
// Pure sim tests: construct a Sim, advance fixed ticks, no rng drawn by the post.

import { describe, expect, it } from 'vitest';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import {
  HEROIC_MARK_LETTER,
  MASTERY_RESET_LETTER,
  QUEST_LETTERS,
  WELCOME_LETTER,
  WOC_MARKET_DELIVERY_LETTER,
  WOC_MARKET_LETTER_IDS,
  WOC_MARKET_RETURN_LETTER,
  WOC_MARKET_SOLD_LETTER,
} from '../src/sim/content/letters';
import {
  MAIL_ATTACHMENT_EXPIRY_SECONDS,
  MAIL_DELIVERY_SECONDS,
  MAIL_ESCROW_COPPER_MIN,
  MAIL_EXCHANGE_UNREAD_EXPIRY_SECONDS,
  MAIL_READ_EXPIRY_SECONDS,
  MAIL_UNREAD_EXPIRY_SECONDS,
  mailHoldsEscrow,
} from '../src/sim/mail/post_office';
import { Sim } from '../src/sim/sim';
import { DT, type SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Attachment-expiry cases only need PostOffice + players + mailbox positions.
// Strip ambient camps/NPCs/objects so delivery ticks stay cheap (subsystem-world
// pattern; mailboxes remain via BUILTIN_WORLD.services on EMPTY_TEST_WORLD).
const makeWorld = () =>
  new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });

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
  it('gives a player parcel the 30-day clock; a bare note takes the 30-day unread window', () => {
    const { sim, alice, sentAt, raw } = setupParcel();
    expect(MAIL_ATTACHMENT_EXPIRY_SECONDS).toBe(30 * 24 * 3600);
    expect(MAIL_UNREAD_EXPIRY_SECONDS).toBe(30 * 24 * 3600);
    expect(MAIL_READ_EXPIRY_SECONDS).toBe(3 * 24 * 3600);
    expect(raw.expiresAt).toBe(sentAt + MAIL_ATTACHMENT_EXPIRY_SECONDS);
    // Coin alone is an attachment too, from exactly one silver up.
    const t1 = sim.time;
    expect(MAIL_ESCROW_COPPER_MIN).toBe(100);
    sim.mailSend('Bob', 'Coin only', 'x', MAIL_ESCROW_COPPER_MIN, [], alice);
    const coin = bookOf(sim).find((m) => m.subject === 'Coin only');
    expect(coin.expiresAt).toBe(t1 + MAIL_ATTACHMENT_EXPIRY_SECONDS);
    // Under a silver it is a note with pocket change: the unread window.
    sim.mailSend('Bob', 'Small change', 'x', MAIL_ESCROW_COPPER_MIN - 1, [], alice);
    const change = bookOf(sim).find((m) => m.subject === 'Small change');
    expect(change.copper).toBe(MAIL_ESCROW_COPPER_MIN - 1);
    // The unread and attachment windows are both 30 days, so pin the ROUTING
    // (not escrow) beside the value; the sub-silver suite covers the sweep.
    expect(mailHoldsEscrow(change)).toBe(false);
    expect(mailHoldsEscrow(coin)).toBe(true);
    expect(change.expiresAt).toBe(t1 + MAIL_UNREAD_EXPIRY_SECONDS);
    // A bare note is unread at booking: the unread window from booking.
    sim.mailSend('Bob', 'Note', 'x', 0, [], alice);
    const note = bookOf(sim).find((m) => m.subject === 'Note');
    expect(note.expiresAt).toBe(t1 + MAIL_UNREAD_EXPIRY_SECONDS);
  });
});

describe('the return flight', () => {
  it('returns the unclaimed parcel AT the expiry boundary, through the normal delivery path', () => {
    const { sim, alice, bob, aliceMeta, raw } = setupParcel();
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
    // Re-keyed onto the sender's stable id (never their mutable name), the
    // display names swapped honestly.
    expect(raw.recipientKey).toBe(sim.postOffice.mailKeyFor(aliceMeta));
    expect(raw.recipientName).toBe('Alice');
    expect(raw.senderName).toBe('Bob');
    // Attachments ride home intact and the letter flies fresh.
    expect(raw.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(raw.copper).toBe(500);
    expect(raw.read).toBe(false);
    expect(raw.announced).toBe(false);
    expect(raw.deliverAt).toBe(boundary + MAIL_DELIVERY_SECONDS);
    // Home for good: no second window, the returned parcel is never
    // auto-deleted while its attachments remain.
    expect(raw.expiresAt).toBe(Infinity);

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

  it('still reaches the sender by stable id if they renamed while the parcel was in flight', () => {
    // Regression for the data-loss bug: the return flight used to re-key onto
    // the sender's DISPLAY NAME captured at send time. If the sender renamed
    // before the still-unclaimed parcel expired, the return could never find
    // them again (belongsTo/mailInfoFor match on the stable id or the CURRENT
    // name, neither of which is the stale pre-rename name), orphaning the
    // coin and items forever.
    const { sim, alice, aliceMeta, raw } = setupParcel();

    // Alice is renamed while her still-unclaimed parcel to Bob is in flight.
    // rekeyMailOwner migrates Alice's OWN inbox (e.g. her welcome letter, which
    // is keyed by her own stable id already) but must leave the Parcel letter
    // alone: Alice is only its SENDER, never its recipient, exactly like the
    // real rename flow (server/characters.ts calls rekeyMailOwner with the
    // renaming character's own stable key, which never matches a letter she
    // only sent).
    const recipientKeyBeforeRename = raw.recipientKey;
    sim.rekeyMailOwner(alice, 'Alice', 'Alicia');
    expect(raw.recipientKey).toBe(recipientKeyBeforeRename);
    aliceMeta.name = 'Alicia';

    // Bob never claims it; the parcel expires and flies home.
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    raw.expiresAt = sim.time;
    tickFor(sim, 2); // the return cycle runs
    expect(raw.returned).toBe(true);

    // The return flight lands; the renamed Alice must still be able to see and
    // collect it.
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    moveToMailbox(sim, alice);
    const info = sim.mailInfoFor(alice);
    const back = info?.messages.find((m) => m.subject === 'Parcel');
    expect(back).toBeDefined();
    expect(back?.copper).toBe(500);
    expect(back?.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);

    const coinBefore = aliceMeta.copper;
    if (back) sim.mailTake(back.id, alice);
    expect(aliceMeta.copper).toBe(coinBefore + 500);
    expect(sim.countItem('roasted_boar', alice)).toBe(2);
  });

  it('never deletes an un-returned parcel: expiry without the flag always bounces', () => {
    const { sim, bob, raw } = setupParcel();
    const bobMeta = sim.meta(bob);
    if (!bobMeta) throw new Error('no meta');
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
    // It bounced back the other way: recipient and sender swapped again, still
    // keyed by the stable id on both legs.
    expect(raw.recipientKey).toBe(sim.postOffice.mailKeyFor(bobMeta));
    expect(raw.senderName).toBe('Alice');
  });

  it('never deletes the returned letter: it holds Infinity, and a forced expiry leaves it be', () => {
    const { sim, alice, aliceMeta, raw } = setupParcel();
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    const id = raw.id;
    raw.expiresAt = sim.time;
    tickFor(sim, 2); // the return cycle runs
    expect(raw.returned).toBe(true);
    expect(raw.expiresAt).toBe(Infinity);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2); // lands unread at Alice's
    const unread = sim.mailUnreadFor(alice);
    // Even a forced finite expiry is no deletion: attachments aboard, the
    // sweep's only verb is the return flight, and that has already run, so
    // the parcel neither bounces again nor leaves the book.
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.id === id)).toBe(true);
    expect(raw.returned).toBe(true);
    expect(raw.recipientKey).toBe(sim.postOffice.mailKeyFor(aliceMeta));
    expect(raw.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(raw.copper).toBe(500);
    expect(sim.mailUnreadFor(alice)).toBe(unread);
  });
});

// A bare note from Alice to Bob, landed and unread, with Bob at a raven pillar
// so the read verbs resolve. Returns the live raw letter.
function setupNote() {
  const sim = makeWorld();
  const alice = sim.addPlayer('warrior', 'Alice');
  const bob = sim.addPlayer('mage', 'Bob');
  const aliceMeta = sim.meta(alice);
  if (!aliceMeta) throw new Error('no meta');
  aliceMeta.copper = 10_000; // postage only
  moveToMailbox(sim, alice);
  const sentAt = sim.time;
  sim.mailSend('Bob', 'Note', 'Words.', 0, [], alice);
  const raw = bookOf(sim).find((m) => m.subject === 'Note');
  if (!raw) throw new Error('note not booked');
  tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
  moveToMailbox(sim, bob);
  sim.drainEvents();
  return { sim, alice, bob, sentAt, raw };
}

// Books an Exchange Broker letter to `pid` through the real custody path.
function bookExchangeLetter(
  sim: Sim,
  pid: number,
  letter: typeof WOC_MARKET_SOLD_LETTER,
  items: { itemId: string; count: number }[] = [],
) {
  const meta = sim.meta(pid);
  if (!meta) throw new Error('no meta');
  sim.postOffice.mailSystemParcel(
    { key: sim.postOffice.mailKeyFor(meta), name: meta.name },
    letter,
    items,
  );
  const raw = bookOf(sim).find((m) => m.letterId === letter.letterId);
  if (!raw) throw new Error('exchange letter not booked');
  return raw;
}

describe('the emptied-letter clocks: unread 30 days, read 3 days', () => {
  it('an unread note rides the 30-day window from booking, and the sweep deletes it there', () => {
    const { sim, bob, sentAt, raw } = setupNote();
    expect(raw.read).toBe(false);
    expect(raw.expiresAt).toBe(sentAt + MAIL_UNREAD_EXPIRY_SECONDS);
    const unread = sim.mailUnreadFor(bob);
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.id === raw.id)).toBe(false);
    expect(sim.mailUnreadFor(bob)).toBe(unread - 1);
  });

  it('reading a note (mailMarkRead) moves it onto the 3-day read clock, once', () => {
    const { sim, bob, raw } = setupNote();
    tickFor(sim, 100);
    sim.mailMarkRead(raw.id, bob);
    expect(raw.read).toBe(true);
    const readAt = sim.time;
    expect(raw.expiresAt).toBe(readAt + MAIL_READ_EXPIRY_SECONDS);
    // The flip fires once: a repeat read never extends the clock.
    tickFor(sim, 100);
    sim.mailMarkRead(raw.id, bob);
    expect(raw.expiresAt).toBe(readAt + MAIL_READ_EXPIRY_SECONDS);
    // And the sweep collects it from there.
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.id === raw.id)).toBe(false);
  });

  it('the take that first reads a bare note starts the read clock; a repeat take never extends it', () => {
    const { sim, bob, raw } = setupNote();
    tickFor(sim, 100);
    sim.mailTake(raw.id, bob);
    expect(raw.read).toBe(true);
    const readAt = sim.time;
    expect(raw.expiresAt).toBe(readAt + MAIL_READ_EXPIRY_SECONDS);
    tickFor(sim, 100);
    sim.mailTake(raw.id, bob);
    expect(raw.expiresAt).toBe(readAt + MAIL_READ_EXPIRY_SECONDS);
  });

  it('a read parcel keeps its attachment clock until the take empties it, then rides the read clock', () => {
    const { sim, bob, sentAt, raw } = setupParcel();
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    moveToMailbox(sim, bob);
    sim.mailMarkRead(raw.id, bob);
    expect(raw.read).toBe(true);
    // Attachments aboard: reading changes nothing about its clock.
    expect(raw.expiresAt).toBe(sentAt + MAIL_ATTACHMENT_EXPIRY_SECONDS);
    tickFor(sim, 100);
    sim.mailTake(raw.id, bob);
    expect(raw.items).toEqual([]);
    expect(raw.copper).toBe(0);
    expect(raw.expiresAt).toBe(sim.time + MAIL_READ_EXPIRY_SECONDS);
  });
});

describe('sub-silver coin is not escrow', () => {
  it('pins the predicate: any item counts, coin only from one silver', () => {
    expect(mailHoldsEscrow({ copper: 0, items: [] })).toBe(false);
    expect(mailHoldsEscrow({ copper: MAIL_ESCROW_COPPER_MIN - 1, items: [] })).toBe(false);
    expect(mailHoldsEscrow({ copper: MAIL_ESCROW_COPPER_MIN, items: [] })).toBe(true);
    expect(mailHoldsEscrow({ copper: 0, items: [{ itemId: 'roasted_boar', count: 1 }] })).toBe(
      true,
    );
  });

  it('an unread letter with 99 copper is swept at the unread window, coin and all, with no return flight', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Tip', 'For the ale.', MAIL_ESCROW_COPPER_MIN - 1, [], alice);
    const raw = bookOf(sim).find((m) => m.subject === 'Tip');
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    const unread = sim.mailUnreadFor(bob);
    const unreadAlice = sim.mailUnreadFor(alice);
    const aliceCoin = aliceMeta.copper;
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.id === raw.id)).toBe(false);
    expect(sim.mailUnreadFor(bob)).toBe(unread - 1);
    // Gone with the letter: nothing bounced home to Alice (her own inbox,
    // welcome letter included, is untouched).
    expect(aliceMeta.copper).toBe(aliceCoin);
    expect(sim.mailUnreadFor(alice)).toBe(unreadAlice);
    expect(bookOf(sim).some((m) => m.subject === 'Tip')).toBe(false);
  });

  it('reading a small-change letter starts the read clock; the take still pays the coin', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    const bobMeta = sim.meta(bob);
    if (!aliceMeta || !bobMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Tip', 'For the ale.', 42, [], alice);
    const raw = bookOf(sim).find((m) => m.subject === 'Tip');
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    moveToMailbox(sim, bob);
    sim.mailMarkRead(raw.id, bob);
    const readAt = sim.time;
    expect(raw.expiresAt).toBe(readAt + MAIL_READ_EXPIRY_SECONDS);
    tickFor(sim, 100);
    const before = bobMeta.copper;
    sim.mailTake(raw.id, bob);
    expect(bobMeta.copper).toBe(before + 42);
    expect(raw.copper).toBe(0);
    // Already read and never escrow: the take does not restart the clock.
    expect(raw.expiresAt).toBe(readAt + MAIL_READ_EXPIRY_SECONDS);
  });

  it('a system letter with sub-silver coin takes the unread window; one with a silver holds Infinity', () => {
    const sim = makeWorld();
    const bookedAt = sim.time;
    const pid = sim.addPlayer('warrior', 'Keeper');
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    // The shipped welcome letter carries 50 copper: pocket change, so it ages
    // out unread on the exact note window (its coin goes with it).
    expect(WELCOME_LETTER.copper).toBeGreaterThan(0);
    expect(WELCOME_LETTER.copper).toBeLessThan(MAIL_ESCROW_COPPER_MIN);
    const welcome = bookOf(sim).find((m) => m.letterId === WELCOME_LETTER.letterId);
    expect(welcome.expiresAt).toBe(bookedAt + MAIL_UNREAD_EXPIRY_SECONDS);
    // The same authored path with exactly one silver is escrow: no clock.
    sim.postOffice.sendLetter(
      sim.postOffice.mailKeyFor(meta),
      meta.name,
      { ...MASTERY_RESET_LETTER, letterId: 'test_one_silver', copper: MAIL_ESCROW_COPPER_MIN },
      'system',
    );
    const silver = bookOf(sim).find((m) => m.letterId === 'test_one_silver');
    expect(silver.copper).toBe(MAIL_ESCROW_COPPER_MIN);
    expect(silver.expiresAt).toBe(Infinity);
  });

  it('the read flip and the emptying take both reach the persisted partition row', () => {
    // The countdown must survive a restart: the read flip in mailMarkRead
    // writes expiresAt AFTER index.markRead has dirtied the recipient row,
    // and the take's tail write sits under the mutated markDirty. Pin it on
    // the drained row itself rather than trusting the ordering (this module's
    // own history is a missed dirty mark, see the #3561 comment in mailTake).
    const { sim, bob, raw } = setupNote();
    const bobMeta = sim.meta(bob);
    if (!bobMeta) throw new Error('no meta');
    const bobKey = sim.postOffice.mailKeyFor(bobMeta);
    sim.takeDirtyMailPartitions(); // drain the booking and landing
    sim.mailMarkRead(raw.id, bob);
    const afterRead = sim
      .takeDirtyMailPartitions()
      .find((p) => p.recipientKey === bobKey)
      ?.letters.find((m) => m.subject === 'Note');
    expect(afterRead?.read).toBe(true);
    expect(afterRead?.secondsLeft).toBe(MAIL_READ_EXPIRY_SECONDS);

    // A small-change letter emptied by an already-read take: the coin leaves
    // the row and the read countdown is what persists.
    const alice = sim.addPlayer('warrior', 'Alicia');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Tip', 'x', 42, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    const tip = bookOf(sim).find((m) => m.subject === 'Tip');
    moveToMailbox(sim, bob);
    sim.mailMarkRead(tip.id, bob);
    tickFor(sim, 10);
    sim.takeDirtyMailPartitions();
    sim.mailTake(tip.id, bob);
    const afterTake = sim
      .takeDirtyMailPartitions()
      .find((p) => p.recipientKey === bobKey)
      ?.letters.find((m) => m.subject === 'Tip');
    expect(afterTake?.copper).toBe(0);
    expect(afterTake?.read).toBe(true);
    expect(afterTake?.secondsLeft).toBe(Math.round(tip.expiresAt - sim.time));
    expect(afterTake?.secondsLeft).toBeLessThanOrEqual(MAIL_READ_EXPIRY_SECONDS);
  });

  it('at load, a persisted small-change row rides the emptied model, a one-silver row keeps escrow', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    sim.addPlayer('mage', 'Bob');
    const aliceMeta = sim.meta(alice);
    if (!aliceMeta) throw new Error('no meta');
    aliceMeta.copper = 10_000;
    moveToMailbox(sim, alice);
    sim.mailSend('Bob', 'Tip', 'x', MAIL_ESCROW_COPPER_MIN - 1, [], alice);
    sim.mailSend('Bob', 'Silver', 'x', MAIL_ESCROW_COPPER_MIN, [], alice);
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));
    const tip = save.mail.find((m: { subject: string }) => m.subject === 'Tip');
    const silver = save.mail.find((m: { subject: string }) => m.subject === 'Silver');
    // A read small-change row persisted under a long window collapses to the
    // read clock; the silver row's never sentinel starts the attachment window.
    tip.read = true;
    tip.secondsLeft = 20 * 24 * 3600;
    silver.secondsLeft = -1;
    const sim2 = makeWorld();
    const t2 = sim2.time;
    sim2.loadMail(save);
    expect(bookOf(sim2).find((m) => m.subject === 'Tip').expiresAt).toBe(
      t2 + MAIL_READ_EXPIRY_SECONDS,
    );
    expect(bookOf(sim2).find((m) => m.subject === 'Silver').expiresAt).toBe(
      t2 + MAIL_ATTACHMENT_EXPIRY_SECONDS,
    );
  });
});

describe('the Exchange Broker exemption', () => {
  it('pins the exempt id set to the three broker letters, as the persisted string literals', () => {
    // Letter ids are persisted tokens: a booked row carries its letterId
    // forever, so a coordinated rename of the defs AND the set would pass a
    // def-based pin while every row already in a mailbox silently lost the
    // exemption. Pin the strings themselves, and the defs against them.
    expect([...WOC_MARKET_LETTER_IDS].sort()).toEqual([
      'woc_market_delivery',
      'woc_market_return',
      'woc_market_sold',
    ]);
    expect(WOC_MARKET_DELIVERY_LETTER.letterId).toBe('woc_market_delivery');
    expect(WOC_MARKET_RETURN_LETTER.letterId).toBe('woc_market_return');
    expect(WOC_MARKET_SOLD_LETTER.letterId).toBe('woc_market_sold');
  });

  it('an unread sold notice waits 90 days (the ceiling), and reading it starts the 3-day read clock', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Seller');
    const bookedAt = sim.time;
    const raw = bookExchangeLetter(sim, pid, WOC_MARKET_SOLD_LETTER);
    expect(raw.kind).toBe('system');
    expect(raw.items).toEqual([]);
    expect(raw.copper).toBe(0);
    expect(MAIL_EXCHANGE_UNREAD_EXPIRY_SECONDS).toBe(90 * 24 * 3600);
    expect(MAIL_EXCHANGE_UNREAD_EXPIRY_SECONDS).toBeGreaterThan(MAIL_UNREAD_EXPIRY_SECONDS);
    expect(raw.expiresAt).toBe(bookedAt + MAIL_EXCHANGE_UNREAD_EXPIRY_SECONDS);
    // Past the ordinary unread window it is still there ...
    tickFor(sim, 1);
    raw.expiresAt = sim.time + 1; // one sim-second short of the ceiling
    tickFor(sim, 0.5);
    expect(bookOf(sim)).toContain(raw);
    // ... and reading it moves it onto the read clock like any other letter.
    moveToMailbox(sim, pid);
    sim.mailMarkRead(raw.id, pid);
    expect(raw.read).toBe(true);
    expect(raw.expiresAt).toBe(sim.time + MAIL_READ_EXPIRY_SECONDS);
  });

  it('the ceiling is real: an unread sold notice nobody ever opens is swept at it', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Seller');
    const raw = bookExchangeLetter(sim, pid, WOC_MARKET_SOLD_LETTER);
    tickFor(sim, 1);
    const unread = sim.mailUnreadFor(pid);
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.id === raw.id)).toBe(false);
    expect(sim.mailUnreadFor(pid)).toBe(unread - 1);
  });

  it('a delivery parcel holds Infinity through the read flip and takes the read clock once emptied', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Buyer');
    const raw = bookExchangeLetter(sim, pid, WOC_MARKET_DELIVERY_LETTER, [
      { itemId: 'roasted_boar', count: 1 },
    ]);
    expect(raw.expiresAt).toBe(Infinity);
    tickFor(sim, 1);
    moveToMailbox(sim, pid);
    sim.mailMarkRead(raw.id, pid);
    expect(raw.read).toBe(true);
    expect(raw.expiresAt).toBe(Infinity);
    sim.mailTake(raw.id, pid);
    expect(sim.countItem('roasted_boar', pid)).toBe(1);
    expect(raw.items).toEqual([]);
    expect(raw.expiresAt).toBe(sim.time + MAIL_READ_EXPIRY_SECONDS);
  });

  it('every other unread authored note takes the ordinary 30-day unread window', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Crafter');
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    const t = sim.time;
    sim.postOffice.sendLetter(
      sim.postOffice.mailKeyFor(meta),
      meta.name,
      MASTERY_RESET_LETTER,
      'system',
    );
    const raw = bookOf(sim).find((m) => m.letterId === MASTERY_RESET_LETTER.letterId);
    expect(raw.items).toEqual([]);
    expect(raw.copper).toBe(0);
    expect(raw.expiresAt).toBe(t + MAIL_UNREAD_EXPIRY_SECONDS);
  });
});

describe('the system and npc exemption', () => {
  it('gives authored parcels no clock at all through the real send paths', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Keeper');
    const welcome = bookOf(sim).find((m) => m.letterId === WELCOME_LETTER.letterId);
    expect(welcome.kind).toBe('system');
    // The welcome letter's courtesy coin is under a silver: pocket change, not
    // escrow, so it rides the unread window like a note (see the sub-silver
    // suite); the exemption below is for real parcels.
    expect(welcome.copper).toBeGreaterThan(0);
    expect(welcome.copper).toBeLessThan(MAIL_ESCROW_COPPER_MIN);
    expect(Number.isFinite(welcome.expiresAt)).toBe(true);
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
    expect(bookOf(sim)).toContain(marks);
    // The welcome letter's sub-silver coin is no escrow: swept, coin and all.
    expect(bookOf(sim)).not.toContain(welcome);
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
    // The system welcome letters in the same save (sub-silver coin, so the
    // emptied model) keep a finite countdown, never the attachment window.
    const wel2 = bookOf(sim2).find((m) => m.letterId === WELCOME_LETTER.letterId);
    expect(Number.isFinite(wel2.expiresAt)).toBe(true);
    expect(wel2.expiresAt).toBeLessThanOrEqual(loadT + MAIL_UNREAD_EXPIRY_SECONDS);

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

  it('round-trips the returned flag with the never sentinel, and lifts a legacy second window to Infinity', () => {
    const { sim, raw } = setupParcel();
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(raw.returned).toBe(true);
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));
    const row = save.mail.find((m: { subject: string }) => m.subject === 'Parcel');
    expect(row.returned).toBe(true);
    expect(row.secondsLeft).toBe(-1);
    // An un-returned row serializes with no flag at all (additive save shape).
    const welcomeRow = save.mail.find(
      (m: { letterId?: string }) => m.letterId === WELCOME_LETTER.letterId,
    );
    expect(welcomeRow.returned).toBeUndefined();

    const sim2 = makeWorld();
    sim2.loadMail(save);
    const raw2 = bookOf(sim2).find((m) => m.subject === 'Parcel');
    expect(raw2.returned).toBe(true);
    expect(raw2.expiresAt).toBe(Infinity);
    const wel2 = bookOf(sim2).find((m) => m.letterId === WELCOME_LETTER.letterId);
    expect(wel2.returned).toBe(false);

    // A returned row persisted under the old model carried a finite second
    // window; at load it is lifted back to Infinity (attachments aboard are
    // never auto-deleted, whatever the row on disk says).
    const legacy = JSON.parse(JSON.stringify(save));
    legacy.mail.find((m: { subject: string }) => m.subject === 'Parcel').secondsLeft = 1234;
    const sim3 = makeWorld();
    sim3.loadMail(legacy);
    const raw3 = bookOf(sim3).find((m) => m.subject === 'Parcel');
    expect(raw3.returned).toBe(true);
    expect(raw3.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(raw3.expiresAt).toBe(Infinity);
  });

  it('caps an emptied row at load: a read letter under a longer persisted window collapses to the read clock', () => {
    const { sim, raw } = setupNote();
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));
    const row = save.mail.find((m: { subject: string }) => m.subject === 'Note');
    expect(row.read).toBe(false);
    expect(row.secondsLeft).toBeGreaterThan(0);
    expect(row.secondsLeft).toBeLessThanOrEqual(MAIL_UNREAD_EXPIRY_SECONDS);
    expect(raw.expiresAt).toBeGreaterThan(sim.time);

    // An unread row keeps its (shorter) countdown verbatim.
    row.secondsLeft = 1234;
    const sim2 = makeWorld();
    const t2 = sim2.time;
    sim2.loadMail(save);
    expect(bookOf(sim2).find((m) => m.subject === 'Note').expiresAt).toBe(t2 + 1234);

    // A read row persisted with a countdown longer than the read window (the
    // old 14-day model, say) collapses to the read clock from this load.
    row.read = true;
    row.secondsLeft = 10 * 24 * 3600;
    const sim3 = makeWorld();
    const t3 = sim3.time;
    sim3.loadMail(save);
    const raw3 = bookOf(sim3).find((m) => m.subject === 'Note');
    expect(raw3.read).toBe(true);
    expect(raw3.expiresAt).toBe(t3 + MAIL_READ_EXPIRY_SECONDS);

    // A read row with a countdown already inside the read window keeps it.
    row.secondsLeft = 600;
    const sim4 = makeWorld();
    const t4 = sim4.time;
    sim4.loadMail(save);
    expect(bookOf(sim4).find((m) => m.subject === 'Note').expiresAt).toBe(t4 + 600);
  });

  it('an unread Exchange notice persists its ceiling countdown, which load caps but never extends', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Seller');
    bookExchangeLetter(sim, pid, WOC_MARKET_SOLD_LETTER);
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));
    const row = save.mail.find(
      (m: { letterId?: string }) => m.letterId === WOC_MARKET_SOLD_LETTER.letterId,
    );
    expect(row.read).toBe(false);
    expect(row.secondsLeft).toBe(MAIL_EXCHANGE_UNREAD_EXPIRY_SECONDS);

    // The live countdown round-trips verbatim.
    const sim2 = makeWorld();
    const t2 = sim2.time;
    sim2.loadMail(save);
    const raw2 = bookOf(sim2).find((m) => m.letterId === WOC_MARKET_SOLD_LETTER.letterId);
    expect(raw2.expiresAt).toBe(t2 + MAIL_EXCHANGE_UNREAD_EXPIRY_SECONDS);

    // Persisted under the old 14-day model with a shorter countdown: load
    // caps, never extends (an extension would re-arm on every boot), so the
    // shorter countdown is kept. A one-time deploy artifact, no worse than
    // the status quo it replaces.
    row.secondsLeft = 1234;
    const sim3 = makeWorld();
    const t3 = sim3.time;
    sim3.loadMail(save);
    const raw3 = bookOf(sim3).find((m) => m.letterId === WOC_MARKET_SOLD_LETTER.letterId);
    expect(raw3.expiresAt).toBe(t3 + 1234);

    // A never-sentinel row (no countdown at all) starts the ceiling at load.
    row.secondsLeft = -1;
    const sim4 = makeWorld();
    const t4 = sim4.time;
    sim4.loadMail(save);
    const raw4 = bookOf(sim4).find((m) => m.letterId === WOC_MARKET_SOLD_LETTER.letterId);
    expect(raw4.expiresAt).toBe(t4 + MAIL_EXCHANGE_UNREAD_EXPIRY_SECONDS);

    // Once read, it is an ordinary emptied letter: the read clock, capped.
    row.read = true;
    row.secondsLeft = 20 * 24 * 3600;
    const sim5 = makeWorld();
    const t5 = sim5.time;
    sim5.loadMail(save);
    const raw5 = bookOf(sim5).find((m) => m.letterId === WOC_MARKET_SOLD_LETTER.letterId);
    expect(raw5.expiresAt).toBe(t5 + MAIL_READ_EXPIRY_SECONDS);
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
    expect(raw.recipientKey).toBe(sim.postOffice.mailKeyFor(aliceMeta));
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

describe('a full-bags player parcel keeps its real deadline', () => {
  it('does not pause the attachment clock: an elapsed expiresAt is still eligible for return-to-sender', () => {
    // Regression pin: a comment on the mailTake bags-full branch used to claim
    // the expiry clock stays paused (Infinity) whenever a letter is kept for
    // lack of room, but that is only true for system/npc mail. A player
    // parcel's real MAIL_ATTACHMENT_EXPIRY_SECONDS deadline is untouched by
    // that branch and keeps ticking, so it can still fly home to its sender.
    const { sim, bob, raw } = setupParcel();
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    moveToMailbox(sim, bob);

    // Fill Bob's bags so the attached stack cannot fit.
    const bobMeta = sim.meta(bob);
    if (!bobMeta) throw new Error('no meta');
    bobMeta.bags = [null, null, null, null];
    bobMeta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'roasted_boar', count: 20 }));

    const gift = sim.mailInfoFor(bob)?.messages.find((m) => m.subject === 'Parcel');
    if (!gift) throw new Error('parcel not delivered');
    sim.drainEvents();
    sim.mailTake(gift.id, bob);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    // The coin collected but the stack stayed attached, kept on the letter.
    expect(raw.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);

    // NOT Infinity: a player parcel's clock is never paused by the bags-full
    // branch, unlike system/npc mail.
    expect(Number.isFinite(raw.expiresAt)).toBe(true);

    // An elapsed expiresAt (the real deadline already reached) is still swept
    // into the return-to-sender flight, exactly as any other unclaimed parcel.
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(raw.returned).toBe(true);
    expect(raw.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect(raw.copper).toBe(0); // already collected before the bags-full branch
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
    // Emptied and read: the letter leaves Infinity for the 3-day read clock,
    // and the EMPTY prune arm collects it from there.
    expect(raw.expiresAt).toBe(sim.time + MAIL_READ_EXPIRY_SECONDS);
    raw.expiresAt = sim.time;
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.id === raw.id)).toBe(false);
    // The goods survived the whole cycle: they sit in the bags.
    expect(sim.countItem('roasted_boar', alice)).toBe(2);
  });
});
