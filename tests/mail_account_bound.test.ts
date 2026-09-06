// Account bound gear on the Ravenpost (src/sim/mail/account_bound.ts): a bound
// (def soulbound) item is bound to the ACCOUNT, so it rides mail only between
// characters of one account. The sim never learns account ids: the host stamps
// `sameAccount` on the resolved recipient (the server from its character rows,
// the offline world for a letter to yourself). Pure sim tests plus the leaf
// rule's own table.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  boundAttachmentRefusal,
  boundParcelReturnsOnLoad,
  letterCarriesBoundParcel,
} from '../src/sim/mail/account_bound';
import { MAIL_DELIVERY_SECONDS, MAIL_POSTAGE } from '../src/sim/mail/post_office';
import { Sim } from '../src/sim/sim';
import type { SimEvent, WorldContent } from '../src/sim/types';

const MAIL_TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const makeWorld = () =>
  new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: MAIL_TEST_WORLD });

// A def-level bound item every host ships: the Heroic Mark reward token.
const BOUND_ITEM = 'heroic_mark';

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

function mailCode(events: SimEvent[]): string | undefined {
  const ev = events.find((e) => e.type === 'mailResult');
  return ev && ev.type === 'mailResult' ? ev.code : undefined;
}

// addPlayer books a welcome letter per player, so a test finds ITS letter by
// subject rather than assuming the book holds nothing else.
function letterTitled(sim: Sim, subject: string) {
  return sim.postOffice.mail.find((m) => m.subject === subject);
}

function recipientOf(sim: Sim, pid: number, sameAccount?: boolean) {
  const meta = sim.meta(pid);
  if (!meta) throw new Error('no meta');
  return {
    key: String(meta.characterId ?? pid),
    name: meta.name,
    ...(sameAccount === undefined ? {} : { sameAccount }),
  };
}

describe('the account-bound leaf rule', () => {
  it('refuses a bound def for any recipient that is not the same account', () => {
    expect(boundAttachmentRefusal({ soulbound: true }, {})).toBe('noMailSoulbound');
    expect(boundAttachmentRefusal({ soulbound: true }, { sameAccount: false })).toBe(
      'noMailSoulbound',
    );
    expect(boundAttachmentRefusal({ soulbound: true }, { sameAccount: true })).toBeNull();
  });

  it('never refuses an unbound def, whatever the recipient', () => {
    expect(boundAttachmentRefusal({}, {})).toBeNull();
    expect(boundAttachmentRefusal({ soulbound: false }, { sameAccount: false })).toBeNull();
  });

  it('stamps a letter only when a bound parcel actually rides', () => {
    const defs = { bound: { soulbound: true }, plain: {} };
    expect(letterCarriesBoundParcel([{ itemId: 'plain' }], defs)).toBe(false);
    expect(letterCarriesBoundParcel([{ itemId: 'plain' }, { itemId: 'bound' }], defs)).toBe(true);
    expect(letterCarriesBoundParcel([{ itemId: 'unknown' }], defs)).toBe(false);
  });

  it('returns a bound parcel on load only for an UNSTAMPED player letter', () => {
    const bound = { soulbound: true };
    expect(boundParcelReturnsOnLoad('player', bound, undefined)).toBe(true);
    expect(boundParcelReturnsOnLoad('player', bound, false)).toBe(true);
    expect(boundParcelReturnsOnLoad('player', bound, true)).toBe(false);
    expect(boundParcelReturnsOnLoad('player', {}, undefined)).toBe(false);
    expect(boundParcelReturnsOnLoad('player', undefined, undefined)).toBe(false);
    expect(boundParcelReturnsOnLoad('system', bound, undefined)).toBe(false);
    expect(boundParcelReturnsOnLoad('npc', bound, undefined)).toBe(false);
  });
});

describe("mailing bound gear between one account's characters", () => {
  function seededSender(sim: Sim): number {
    const alice = sim.addPlayer('warrior', 'Alice');
    const meta = sim.meta(alice);
    if (!meta) throw new Error('no meta');
    meta.copper = 10_000;
    sim.addItem(BOUND_ITEM, 1, alice);
    moveToMailbox(sim, alice);
    sim.drainEvents();
    return alice;
  }

  it('refuses a bound parcel to another account with nothing escrowed', () => {
    const sim = makeWorld();
    const alice = seededSender(sim);
    const bob = sim.addPlayer('mage', 'Bob');
    const before = sim.meta(alice)?.copper;
    sim.mailSendResolved(
      recipientOf(sim, bob, false),
      'Mark',
      '',
      0,
      [{ itemId: BOUND_ITEM, count: 1 }],
      alice,
    );
    expect(mailCode(sim.drainEvents())).toBe('noMailSoulbound');
    expect(sim.countItem(BOUND_ITEM, alice)).toBe(1);
    expect(sim.meta(alice)?.copper).toBe(before);
    expect(letterTitled(sim, 'Mark')).toBeUndefined();
  });

  it('treats an unknown account answer as another account (fail closed)', () => {
    const sim = makeWorld();
    const alice = seededSender(sim);
    const bob = sim.addPlayer('mage', 'Bob');
    sim.mailSendResolved(
      recipientOf(sim, bob),
      'Mark',
      '',
      0,
      [{ itemId: BOUND_ITEM, count: 1 }],
      alice,
    );
    expect(mailCode(sim.drainEvents())).toBe('noMailSoulbound');
    expect(sim.countItem(BOUND_ITEM, alice)).toBe(1);
  });

  it('escrows, delivers, and lets the alt take a bound parcel on the same account', () => {
    const sim = makeWorld();
    const alice = seededSender(sim);
    const alt = sim.addPlayer('mage', 'Alicia');
    const before = sim.meta(alice)?.copper ?? 0;
    sim.mailSendResolved(
      recipientOf(sim, alt, true),
      'Your mark',
      'For the alt.',
      0,
      [{ itemId: BOUND_ITEM, count: 1 }],
      alice,
    );
    expect(mailCode(sim.drainEvents())).toBe('sent');
    expect(sim.countItem(BOUND_ITEM, alice)).toBe(0);
    expect(sim.meta(alice)?.copper).toBe(before - MAIL_POSTAGE);
    // The letter is stamped account-bound (the load exemption) and carries the parcel.
    const letter = letterTitled(sim, 'Your mark');
    if (!letter) throw new Error('letter not booked');
    expect(letter.accountBound).toBe(true);
    expect(letter.items).toEqual([{ itemId: BOUND_ITEM, count: 1 }]);

    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, alt);
    sim.drainEvents();
    sim.mailTake(letter.id, alt);
    // 'collected' is the coin toast; a parcel take lands silently in the bags.
    expect(mailCode(sim.drainEvents())).toBeUndefined();
    expect(letter.items).toEqual([]);
    expect(sim.countItem(BOUND_ITEM, alt)).toBe(1);
  });

  it('leaves an ordinary same-account letter unstamped', () => {
    const sim = makeWorld();
    const alice = seededSender(sim);
    sim.addItem('roasted_boar', 2, alice);
    const alt = sim.addPlayer('mage', 'Alicia');
    sim.mailSendResolved(
      recipientOf(sim, alt, true),
      'Boar',
      '',
      0,
      [{ itemId: 'roasted_boar', count: 2 }],
      alice,
    );
    expect(mailCode(sim.drainEvents())).toBe('sent');
    const letter = letterTitled(sim, 'Boar');
    expect(letter?.items).toEqual([{ itemId: 'roasted_boar', count: 2 }]);
    expect('accountBound' in (letter ?? {})).toBe(false);
  });

  it('survives a serialize/load round trip without the bound-return migration bouncing it', () => {
    const sim = makeWorld();
    const alice = seededSender(sim);
    const alt = sim.addPlayer('mage', 'Alicia');
    sim.mailSendResolved(
      recipientOf(sim, alt, true),
      'Your mark',
      '',
      0,
      [{ itemId: BOUND_ITEM, count: 1 }],
      alice,
    );
    sim.drainEvents();
    const save = sim.serializeMail();
    expect(save.mail.find((m) => m.subject === 'Your mark')?.accountBound).toBe(true);

    const reloaded = makeWorld();
    const alice2 = reloaded.addPlayer('warrior', 'Alice');
    const alt2 = reloaded.addPlayer('mage', 'Alicia');
    reloaded.loadMail(save);
    // The letter is still addressed to the alt, parcel intact, marker carried,
    // and no return parcel was split off to the sender.
    const mine = reloaded.postOffice.mail.filter((m) => m.subject === 'Your mark');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.recipientKey).toBe(recipientOf(reloaded, alt2).key);
    expect(mine[0]?.items).toEqual([{ itemId: BOUND_ITEM, count: 1 }]);
    expect(mine[0]?.accountBound).toBe(true);
    expect(reloaded.countItem(BOUND_ITEM, alice2)).toBe(0);
  });

  it('still returns a bound parcel on an UNSTAMPED player letter (the legacy migration)', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('mage', 'Bob');
    const aliceKey = recipientOf(sim, alice).key;
    sim.loadMail({
      mail: [
        {
          id: 7,
          recipientKey: recipientOf(sim, bob).key,
          recipientName: 'Bob',
          senderName: 'Alice',
          senderKey: aliceKey,
          kind: 'player',
          subject: 'Old',
          body: '',
          copper: 0,
          items: [{ itemId: BOUND_ITEM, count: 1 }],
          deliverIn: 0,
          secondsLeft: -1,
          read: false,
        },
      ],
      nextMailId: 8,
    });
    const home = sim.postOffice.mail.find(
      (m) => m.subject === 'Old' && m.recipientKey === aliceKey,
    );
    expect(home?.items).toEqual([{ itemId: BOUND_ITEM, count: 1 }]);
    expect(home?.kind).toBe('system');
    expect(letterTitled(sim, 'Old')?.accountBound).toBeUndefined();
  });
});

describe('the offline world: a letter to yourself is the same account', () => {
  it('lets a player post bound gear to their own mailbox and refuses another player', () => {
    const sim = makeWorld();
    const alice = sim.addPlayer('warrior', 'Alice');
    const meta = sim.meta(alice);
    if (!meta) throw new Error('no meta');
    meta.copper = 10_000;
    sim.addItem(BOUND_ITEM, 2, alice);
    sim.addPlayer('mage', 'Bob');
    moveToMailbox(sim, alice);
    sim.drainEvents();

    sim.mailSend('Bob', 'Mark', '', 0, [{ itemId: BOUND_ITEM, count: 1 }], alice);
    expect(mailCode(sim.drainEvents())).toBe('noMailSoulbound');
    expect(sim.countItem(BOUND_ITEM, alice)).toBe(2);

    sim.mailSend('Alice', 'Mark', '', 0, [{ itemId: BOUND_ITEM, count: 1 }], alice);
    expect(mailCode(sim.drainEvents())).toBe('sent');
    expect(sim.countItem(BOUND_ITEM, alice)).toBe(1);
    expect(letterTitled(sim, 'Mark')?.accountBound).toBe(true);
  });
});
