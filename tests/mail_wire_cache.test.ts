// The Ravenpost mail revision (src/sim/mail/post_office.ts mailRevFor): the
// change signal the server's snapshot gate polls before paying for a
// mailInfoFor rebuild (the market browseRev shape). Pins three claims:
//   1. the signal is null away from a raven pillar and a number beside one,
//      and holds steady across idle ticks while nothing changes;
//   2. every wire-reachable mutating verb advances it (booking, the delivery
//      landing, take, read, delete, the expiry sweep, the return flight,
//      rekey, purge, load), so a rebuild-only-on-change gate can never serve
//      a stale mailbox;
//   3. the bucketed deliveredFor union serves the same view the old
//      whole-book scan produced, dual-key (legacy name-keyed) letters
//      included, against an independent full-scan oracle.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { MAIL_DELIVERY_SECONDS, MAIL_POSTAGE } from '../src/sim/mail/post_office';
import { Sim } from '../src/sim/sim';
import type { SimEvent, WorldContent } from '../src/sim/types';

// Mailboxes are system-owned and still spawn with this fixture (the mail.test
// convention): ambient camps, NPCs and quest objects are irrelevant to the
// revision signal and would turn every simulated minute into an AI benchmark.
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

// The raw revision counter, position-independent (mailRevFor gates on the
// pillar; the mutation pins must not depend on where the mutating player is).
// biome-ignore lint/suspicious/noExplicitAny: read the module-private counter.
const rawRev = (sim: Sim): number => (sim.postOffice as any).rev;

// biome-ignore lint/suspicious/noExplicitAny: the book is module-internal.
const bookOf = (sim: Sim): any[] => (sim.postOffice as any).mail;

function makeSender(sim: Sim, name = 'Alice'): number {
  const pid = sim.addPlayer('warrior', name);
  const meta = sim.meta(pid);
  if (!meta) throw new Error('no meta');
  meta.copper = 10_000;
  moveToMailbox(sim, pid);
  return pid;
}

describe('the mail revision signal (mailRevFor)', () => {
  it('is null away from a raven pillar and a number beside one', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Postie');
    // The town spawn point sits within mail range of its pillar, so walk out
    // of range first: the null arm must be pinned away from every mailbox.
    moveAwayFromMailboxes(sim, pid);
    expect(sim.mailRevFor(pid)).toBeNull();
    moveToMailbox(sim, pid);
    expect(typeof sim.mailRevFor(pid)).toBe('number');
    expect(sim.mailRevFor(pid)).toBe(rawRev(sim));
    expect(sim.mailRevFor(999_999)).toBeNull(); // unknown pid stays null
  });

  it('holds steady across idle ticks while nothing changes', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Postie');
    moveToMailbox(sim, pid);
    // Settle the welcome letter's announce sweep first (announced is a
    // runtime flag, not a view change, and must not advance the revision).
    tickFor(sim, 2);
    const rev = rawRev(sim);
    tickFor(sim, 5);
    expect(rawRev(sim)).toBe(rev);
  });

  it('advances on booking, on the delivery landing, and on take/read/delete', () => {
    const sim = makeWorld();
    const alice = makeSender(sim);
    const bob = sim.addPlayer('mage', 'Bob');
    tickFor(sim, 2);

    // Booking: the sender pays postage, the letter enters the book in flight.
    let rev = rawRev(sim);
    sim.mailSendResolved({ key: String(bob), name: 'Bob' }, 'Note', 'Words.', 0, [], alice);
    expect(rawRev(sim)).toBeGreaterThan(rev);

    // The landing: no command runs, yet the recipient's view changes the tick
    // the raven arrives, so the revision must move again (the deliverDue arm).
    rev = rawRev(sim);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    expect(rawRev(sim)).toBeGreaterThan(rev);

    // Take (the welcome letter's coin), read, then delete, each from the box.
    moveToMailbox(sim, bob);
    const info = sim.mailInfoFor(bob);
    if (!info) throw new Error('no mailbox view');
    const note = info.messages.find((m) => m.subject === 'Note');
    const welcome = info.messages.find((m) => m.letterId === 'ravenpost_welcome');
    if (!note || !welcome) throw new Error('missing letters');

    rev = rawRev(sim);
    sim.mailTake(welcome.id, bob);
    expect(rawRev(sim)).toBeGreaterThan(rev);

    rev = rawRev(sim);
    sim.mailMarkRead(note.id, bob);
    expect(rawRev(sim)).toBeGreaterThan(rev);
    rev = rawRev(sim);
    sim.mailMarkRead(note.id, bob); // already read: no view change, no bump
    expect(rawRev(sim)).toBe(rev);

    rev = rawRev(sim);
    sim.mailDelete(note.id, bob);
    expect(rawRev(sim)).toBeGreaterThan(rev);
  });

  it('a take that observably moves nothing does not bump (repeat take, refused take)', () => {
    const sim = makeWorld();
    const alice = makeSender(sim);
    const bob = sim.addPlayer('mage', 'Bob');
    sim.mailSendResolved({ key: String(bob), name: 'Bob' }, 'Coin', 'Words.', 40, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    moveToMailbox(sim, bob);
    const info = sim.mailInfoFor(bob);
    const coin = info?.messages.find((m) => m.subject === 'Coin');
    if (!coin) throw new Error('missing letter');

    // First take moves the coin and flips read: one bump.
    let rev = rawRev(sim);
    sim.mailTake(coin.id, bob);
    expect(rawRev(sim)).toBeGreaterThan(rev);

    // Repeat take on the emptied, already-read letter: nothing observable
    // moves, so the realm-global revision must hold (a spammed take must not
    // force inbox rebuilds for every near-pillar viewer).
    rev = rawRev(sim);
    sim.mailTake(coin.id, bob);
    expect(rawRev(sim)).toBe(rev);

    // A refused take (no such letter) holds too.
    rev = rawRev(sim);
    sim.mailTake(999_999, bob);
    expect(rawRev(sim)).toBe(rev);
  });

  it('advances when the sweep expires a letter and when a parcel flies home', () => {
    const sim = makeWorld();
    const alice = makeSender(sim);
    const bob = sim.addPlayer('mage', 'Bob');
    sim.mailSendResolved({ key: String(bob), name: 'Bob' }, 'Plain', 'Words.', 0, [], alice);
    sim.mailSendResolved({ key: String(bob), name: 'Bob' }, 'Coin', 'Yours.', 300, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);

    // Force the bare note past its window: the sweep deletes it.
    const plain = bookOf(sim).find((m) => m.subject === 'Plain');
    if (!plain) throw new Error('missing note');
    plain.expiresAt = sim.time;
    let rev = rawRev(sim);
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.subject === 'Plain')).toBe(false);
    expect(rawRev(sim)).toBeGreaterThan(rev);

    // Force the coin parcel past its attachment window: it flies home to
    // Alice (returnToSender), which changes BOTH mailboxes' views.
    const coin = bookOf(sim).find((m) => m.subject === 'Coin');
    if (!coin) throw new Error('missing parcel');
    coin.expiresAt = sim.time;
    rev = rawRev(sim);
    tickFor(sim, 2);
    expect(bookOf(sim).find((m) => m.subject === 'Coin')?.returned).toBe(true);
    expect(rawRev(sim)).toBeGreaterThan(rev);

    // Third sweep arm: the RETURNED parcel, expired a second time, is the one
    // sanctioned destruction (attachments aboard, return flight already run),
    // and it must bump too.
    const returned = bookOf(sim).find((m) => m.subject === 'Coin');
    if (!returned) throw new Error('missing returned parcel');
    returned.expiresAt = sim.time;
    rev = rawRev(sim);
    tickFor(sim, 2);
    expect(bookOf(sim).some((m) => m.subject === 'Coin')).toBe(false);
    expect(rawRev(sim)).toBeGreaterThan(rev);
  });

  it('a parcel-only take bumps through the items dimension alone (read first, no coin)', () => {
    // Pins the kept-length arm of the conditional take bump: the letter is
    // read BEFORE the take and carries no coin, so neither the read flip nor
    // the coin arm can set `mutated`; only the granted-items dimension can.
    // Without it, the taker's own inbox would keep showing the parcel
    // attached until the staleness backstop.
    const sim = makeWorld();
    const alice = makeSender(sim);
    const bob = sim.addPlayer('mage', 'Bob');
    sim.addItem('wolf_fang', 1, alice);
    sim.mailSendResolved(
      { key: String(bob), name: 'Bob' },
      'Parcel',
      'Yours.',
      0,
      [{ itemId: 'wolf_fang', count: 1 }],
      alice,
    );
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    moveToMailbox(sim, bob);
    const parcel = bookOf(sim).find((m) => m.subject === 'Parcel');
    if (!parcel) throw new Error('missing parcel');
    sim.mailMarkRead(parcel.id, bob);
    expect(parcel.read).toBe(true);
    expect(parcel.copper).toBe(0);

    const rev = rawRev(sim);
    sim.mailTake(parcel.id, bob);
    expect(parcel.items).toHaveLength(0); // granted into Bob's bags
    expect(rawRev(sim)).toBeGreaterThan(rev);
  });

  it('advances on rekey and purge only when something actually changed', () => {
    const sim = makeWorld();
    const alice = makeSender(sim);
    sim.mailSendResolved({ key: 'Ghost', name: 'Ghost' }, 'Hi', 'There.', 0, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);

    let rev = rawRev(sim);
    expect(sim.rekeyMailOwner(777, 'Nobody', 'StillNobody')).toBe(false);
    expect(rawRev(sim)).toBe(rev); // no letter touched: no bump

    rev = rawRev(sim);
    expect(sim.rekeyMailOwner(777, 'Ghost', 'Spook')).toBe(true);
    expect(rawRev(sim)).toBeGreaterThan(rev);

    rev = rawRev(sim);
    expect(sim.purgeMailOwner(888, 'NobodyEither')).toBe(false);
    expect(rawRev(sim)).toBe(rev);

    rev = rawRev(sim);
    expect(sim.purgeMailOwner(777, 'Spook')).toBe(true);
    expect(rawRev(sim)).toBeGreaterThan(rev);
  });

  it('advances on load, and the loaded book serves bucketed reads', () => {
    const sim = makeWorld();
    const alice = makeSender(sim);
    // A legacy name-keyed letter (the pre-stable-id shape a persisted blob can
    // carry): sim2's Bob has a different entity id, so it is the name-bucket
    // half of the rebuilt dual-key union that must find it after the load.
    sim.mailSendResolved({ key: 'Bob', name: 'Bob' }, 'Kept', 'Words.', 0, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));

    const sim2 = makeWorld();
    const bob2 = sim2.addPlayer('mage', 'Bob');
    const rev = rawRev(sim2);
    sim2.loadMail(save);
    expect(rawRev(sim2)).toBeGreaterThan(rev);
    moveToMailbox(sim2, bob2);
    const info = sim2.mailInfoFor(bob2);
    expect(info?.messages.some((m) => m.subject === 'Kept')).toBe(true);
  });
});

describe('bucketed deliveredFor vs the whole-book scan', () => {
  it('serves the same view the old scan produced, dual-key letters included', () => {
    const sim = makeWorld();
    const alice = makeSender(sim);
    const bob = sim.addPlayer('mage', 'Bob');
    const bobMeta = sim.meta(bob);
    if (!bobMeta) throw new Error('no meta');
    // One letter on the stable id key, one legacy letter keyed by display
    // name: the union must show both, the old belongsTo dual-key rule.
    sim.mailSendResolved({ key: String(bob), name: 'Bob' }, 'ById', 'Words.', 0, [], alice);
    sim.mailSendResolved({ key: 'Bob', name: 'Bob' }, 'ByName', 'Words.', 0, [], alice);
    // A stranger's letter must stay invisible to Bob.
    sim.mailSendResolved({ key: 'Someone', name: 'Someone' }, 'Other', 'Words.', 0, [], alice);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 2);

    // The pre-index pipeline, reimplemented as the oracle: filter the whole
    // book on the dual key + delivered, count and collect ids.
    const now = sim.time;
    const key = String(bobMeta.characterId ?? bobMeta.entityId);
    const oracle = bookOf(sim)
      .filter(
        (m) => (m.recipientKey === key || m.recipientKey === bobMeta.name) && now >= m.deliverAt,
      )
      .map((m) => m.id)
      .sort((a, b) => a - b);

    moveToMailbox(sim, bob);
    const info = sim.mailInfoFor(bob);
    if (!info) throw new Error('no mailbox view');
    expect(info.totalCount).toBe(oracle.length);
    expect(info.messages.map((m) => m.id).sort((a, b) => a - b)).toEqual(oracle);
    expect(info.messages.some((m) => m.subject === 'ById')).toBe(true);
    expect(info.messages.some((m) => m.subject === 'ByName')).toBe(true);
    expect(info.messages.some((m) => m.subject === 'Other')).toBe(false);
    // The unread count agrees with the same oracle's unread half.
    expect(sim.mailUnreadFor(bob)).toBe(
      bookOf(sim).filter(
        (m) =>
          (m.recipientKey === key || m.recipientKey === bobMeta.name) &&
          !m.read &&
          now >= m.deliverAt,
      ).length,
    );
    // Postage really was charged per letter (three sends).
    expect(sim.meta(alice)?.copper).toBe(10_000 - 3 * MAIL_POSTAGE);
  });
});
