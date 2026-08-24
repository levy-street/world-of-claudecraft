// $WOC Exchange custody mail (src/sim/mail/post_office.ts mailSystemParcel):
// system letters that carry EXACT item copies, instance payloads intact, for
// the server-side marketplace's escrow returns and buyer deliveries. Pins the
// four load-bearing behaviors: booking preserves the payload without aliasing
// the caller's slot, the take path grants through addItemInstance (never the
// fungible arm), capacity refusal keeps the attachment instead of destroying
// or flattening it, and the persistence round trip keeps the payload (the
// loadMail sanitize used to drop `instance` wholesale).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { WOC_MARKET_DELIVERY_LETTER, WOC_MARKET_RETURN_LETTER } from '../src/sim/content/letters';
import { Sim } from '../src/sim/sim';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';

const makeWorld = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

function moveToMailbox(sim: Sim, pid: number): void {
  const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
  const p = sim.entities.get(pid);
  if (!box || !p) throw new Error('missing mailbox or player');
  p.pos = { ...box.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

const PAYLOAD: ItemInstancePayload = {
  signer: 'Aldric',
  enchant: 'ench_test',
  rolled: { quality: 'epic', stats: { str: 4 }, masterwork: true },
};

function parcelFor(sim: Sim, pid: number, itemId: string): InvSlot {
  const meta = sim.players.get(pid)!;
  sim.postOffice.mailSystemParcel(
    { key: sim.postOffice.mailKeyFor(meta), name: meta.name },
    WOC_MARKET_DELIVERY_LETTER,
    [{ itemId, count: 1, instance: PAYLOAD, slot: 3 }],
  );
  const letter = sim.postOffice.mail.find(
    (m) => m.letterId === WOC_MARKET_DELIVERY_LETTER.letterId,
  );
  if (!letter) throw new Error('parcel not booked');
  return letter.items[0];
}

describe('mailSystemParcel', () => {
  it('books an instant system letter with the exact payload, deep-cloned and cell-stripped', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Buyer');
    const slot = parcelFor(sim, pid, 'rusty_hatchet');
    expect(slot.itemId).toBe('rusty_hatchet');
    expect(slot.count).toBe(1);
    expect(slot.instance).toEqual(PAYLOAD);
    expect(slot.instance).not.toBe(PAYLOAD);
    expect(slot.instance?.rolled?.stats).not.toBe(PAYLOAD.rolled?.stats);
    expect('slot' in slot).toBe(false);
    const letter = sim.postOffice.mail.find(
      (m) => m.letterId === WOC_MARKET_DELIVERY_LETTER.letterId,
    )!;
    expect(letter.kind).toBe('system');
    expect(letter.copper).toBe(0);
    // System parcels hold Infinity expiry while attachments remain: the sweep
    // can never destroy an escrowed copy.
    expect(letter.expiresAt).toBe(Infinity);
    // Instant delivery: visible to the recipient without a raven flight.
    expect(sim.mailUnreadFor(pid)).toBeGreaterThan(0);
  });

  it('reaches a fully offline recipient by stable character key', () => {
    const sim = makeWorld();
    sim.postOffice.mailSystemParcel({ key: '4242', name: 'Sleeper' }, WOC_MARKET_RETURN_LETTER, [
      { itemId: 'rusty_hatchet', count: 1, instance: { signer: 'Sleeper' } },
    ]);
    const letter = sim.postOffice.mail.find(
      (m) => m.letterId === WOC_MARKET_RETURN_LETTER.letterId,
    );
    expect(letter?.recipientKey).toBe('4242');
    expect(letter?.items[0]?.instance).toEqual({ signer: 'Sleeper' });
  });
});

describe('mailSystemParcel refuses rather than booking an empty letter', () => {
  // The escrowed copy is GONE from the seller's bags by the time a parcel is
  // booked, so a letter that silently carries nothing is a destroyed item. The
  // boolean is the only signal the custodian has: it releases its claim on
  // false so the item stays visibly held and a later sweep retries.
  it('returns false and books NOTHING when no offered slot survives validation', () => {
    const sim = makeWorld();
    const booked = sim.postOffice.mailSystemParcel(
      { key: '77', name: 'Buyer' },
      WOC_MARKET_DELIVERY_LETTER,
      [{ itemId: 'no_such_item_id', count: 1 }],
    );
    expect(booked).toBe(false);
    // Not merely "no attachment": no letter at all. A booked-but-empty letter
    // is what marks a settlement delivered against nothing.
    expect(sim.postOffice.mail).toHaveLength(0);
  });

  it.each([
    ['a count of zero', 0],
    ['a fractional count', 0.5],
    ['a negative count', -1],
  ])('refuses %s, which cannot describe a real item', (_label, count) => {
    const sim = makeWorld();
    const booked = sim.postOffice.mailSystemParcel(
      { key: '77', name: 'Buyer' },
      WOC_MARKET_DELIVERY_LETTER,
      [{ itemId: 'rusty_hatchet', count }],
    );
    expect(booked).toBe(false);
    expect(sim.postOffice.mail).toHaveLength(0);
  });

  it('books the surviving slots and drops only the invalid one', () => {
    const sim = makeWorld();
    const booked = sim.postOffice.mailSystemParcel(
      { key: '77', name: 'Buyer' },
      WOC_MARKET_DELIVERY_LETTER,
      [
        { itemId: 'no_such_item_id', count: 1 },
        { itemId: 'rusty_hatchet', count: 1 },
      ],
    );
    // A partial survivor still books: the alternative would strand a real item
    // because an unrelated slot was malformed.
    expect(booked).toBe(true);
    const letter = sim.postOffice.mail.find(
      (m) => m.letterId === WOC_MARKET_DELIVERY_LETTER.letterId,
    );
    expect(letter?.items.map((s) => s.itemId)).toEqual(['rusty_hatchet']);
  });

  it('still books a goods-free notice, which legitimately carries no items', () => {
    // The sold_notice arm passes an empty list on purpose, so "nothing booked"
    // must NOT be read as a refusal when nothing was offered.
    const sim = makeWorld();
    const booked = sim.postOffice.mailSystemParcel(
      { key: '77', name: 'Seller' },
      WOC_MARKET_RETURN_LETTER,
      [],
    );
    expect(booked).toBe(true);
    expect(sim.postOffice.mail).toHaveLength(1);
    expect(sim.postOffice.mail[0].items).toEqual([]);
  });
});

describe('custodyRef book-once dedupe', () => {
  it('answers presence off the index, never a whole-book scan', () => {
    // hasCustodyParcel runs on every Exchange delivery booking and twice per
    // custody retry, on the world loop; on a grown book (the production
    // six-figure-letter class) a this.mail scan is a hot-path walk. The
    // behavior half lives in tests/mail_index.test.ts; this pins that the
    // PostOffice read actually rides it.
    const src = readFileSync(new URL('../src/sim/mail/post_office.ts', import.meta.url), 'utf8');
    const body = /hasCustodyParcel\(custodyRef: string\): boolean \{([\s\S]*?)\n {2}\}/.exec(src);
    expect(body, 'hasCustodyParcel body not found').not.toBeNull();
    expect(body?.[1]).toContain('this.index.hasCustodyRef(custodyRef)');
    expect(body?.[1]).not.toContain('this.mail');
  });

  it('books a referenced parcel once and refuses the duplicate', () => {
    const sim = makeWorld();
    const items: InvSlot[] = [{ itemId: 'rusty_hatchet', count: 1, instance: { signer: 'A' } }];
    const first = sim.postOffice.mailSystemParcel(
      { key: '9', name: 'Buyer' },
      WOC_MARKET_DELIVERY_LETTER,
      items,
      'woc_settlement:41',
    );
    const second = sim.postOffice.mailSystemParcel(
      { key: '9', name: 'Buyer' },
      WOC_MARKET_DELIVERY_LETTER,
      items,
      'woc_settlement:41',
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(sim.postOffice.mail.filter((m) => m.custodyRef === 'woc_settlement:41')).toHaveLength(1);
    expect(sim.postOffice.hasCustodyParcel('woc_settlement:41')).toBe(true);
    expect(sim.postOffice.hasCustodyParcel('woc_settlement:42')).toBe(false);
  });

  it('keeps the reference through the persistence round trip', () => {
    const sim = makeWorld();
    sim.postOffice.mailSystemParcel(
      { key: '9', name: 'Buyer' },
      WOC_MARKET_DELIVERY_LETTER,
      [{ itemId: 'rusty_hatchet', count: 1 }],
      'woc_settlement:41',
    );
    const save = JSON.parse(JSON.stringify(sim.postOffice.serializeMail()));
    const sim2 = makeWorld();
    sim2.postOffice.loadMail(save);
    expect(sim2.postOffice.hasCustodyParcel('woc_settlement:41')).toBe(true);
    // The dedupe holds across the reload: reconciliation after a restart
    // must not book a second copy.
    expect(
      sim2.postOffice.mailSystemParcel(
        { key: '9', name: 'Buyer' },
        WOC_MARKET_DELIVERY_LETTER,
        [{ itemId: 'rusty_hatchet', count: 1 }],
        'woc_settlement:41',
      ),
    ).toBe(false);
  });
});

describe('taking an instanced parcel', () => {
  it('grants the exact copy into the bags (instance survives the take)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Buyer');
    const meta = sim.players.get(pid)!;
    parcelFor(sim, pid, 'rusty_hatchet');
    moveToMailbox(sim, pid);
    const letter = sim.postOffice.mail.find(
      (m) => m.letterId === WOC_MARKET_DELIVERY_LETTER.letterId,
    )!;
    sim.postOffice.mailTake(letter.id, pid);
    expect(letter.items).toHaveLength(0);
    const granted = meta.inventory.find((s) => s.itemId === 'rusty_hatchet' && s.instance);
    expect(granted?.instance).toEqual(PAYLOAD);
  });

  it('keeps the attachment (payload intact) when the bags are full', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Buyer');
    const meta = sim.players.get(pid)!;
    parcelFor(sim, pid, 'rusty_hatchet');
    // Stuff the pooled budget with distinct one-per-slot instanced copies so
    // neither a merge nor a fresh slot can absorb the grant.
    meta.inventory.length = 0;
    const capacity = bagCapacity(meta.bags);
    for (let i = 0; i < capacity; i++) {
      meta.inventory.push({
        itemId: 'rusty_hatchet',
        count: 1,
        instance: { charges: { c: i + 1 } },
      });
    }
    moveToMailbox(sim, pid);
    const letter = sim.postOffice.mail.find(
      (m) => m.letterId === WOC_MARKET_DELIVERY_LETTER.letterId,
    )!;
    sim.postOffice.mailTake(letter.id, pid);
    expect(letter.items).toHaveLength(1);
    expect(letter.items[0].instance).toEqual(PAYLOAD);
    // Still infinity-clocked: an undeliverable custody parcel is never swept.
    expect(letter.expiresAt).toBe(Infinity);
  });
});

describe('persistence round trip', () => {
  it('keeps instance and craftedRecipeId through serializeMail/loadMail', () => {
    const sim = makeWorld();
    sim.postOffice.mailSystemParcel({ key: '77', name: 'Away' }, WOC_MARKET_DELIVERY_LETTER, [
      { itemId: 'rusty_hatchet', count: 1, instance: PAYLOAD, craftedRecipeId: 'r_hatchet' },
    ]);
    const save = JSON.parse(JSON.stringify(sim.postOffice.serializeMail()));
    const sim2 = makeWorld();
    sim2.postOffice.loadMail(save);
    const letter = sim2.postOffice.mail.find(
      (m) => m.letterId === WOC_MARKET_DELIVERY_LETTER.letterId,
    );
    expect(letter?.items[0]?.instance).toEqual(PAYLOAD);
    expect(letter?.items[0]?.craftedRecipeId).toBe('r_hatchet');
    // Never-expires sentinel survives the round trip.
    expect(letter?.expiresAt).toBe(Infinity);
  });

  it('never aliases the live payload into the save blob', () => {
    const sim = makeWorld();
    sim.postOffice.mailSystemParcel({ key: '77', name: 'Away' }, WOC_MARKET_DELIVERY_LETTER, [
      { itemId: 'rusty_hatchet', count: 1, instance: { rolled: { stats: { str: 4 } } } },
    ]);
    const save = sim.postOffice.serializeMail();
    const live = sim.postOffice.mail.find(
      (m) => m.letterId === WOC_MARKET_DELIVERY_LETTER.letterId,
    )!;
    live.items[0].instance!.rolled!.stats!.str = 99;
    expect(
      save.mail.find((m) => m.letterId === WOC_MARKET_DELIVERY_LETTER.letterId)?.items[0]?.instance
        ?.rolled?.stats?.str,
    ).toBe(4);
  });

  it('never aliases the loaded payload back into the save object', () => {
    const sim = makeWorld();
    const save = {
      mail: [
        {
          id: 1,
          recipientKey: '77',
          recipientName: 'Away',
          senderName: 'The Exchange Broker',
          kind: 'system' as const,
          letterId: WOC_MARKET_DELIVERY_LETTER.letterId,
          subject: 's',
          body: 'b',
          copper: 0,
          items: [{ itemId: 'rusty_hatchet', count: 1, instance: { charges: { c: 2 } } }],
          deliverIn: 0,
          secondsLeft: -1,
          read: false,
        },
      ],
      nextMailId: 2,
    };
    sim.postOffice.loadMail(save);
    const loaded = sim.postOffice.mail[sim.postOffice.mail.length - 1];
    loaded.items[0].instance!.charges!.c = 999;
    expect(save.mail[0].items[0].instance.charges.c).toBe(2);
  });
});
