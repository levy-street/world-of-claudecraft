// Store purchase parcels (src/sim/mail/purchase_parcels.ts): the paid membership token and
// the annual mount reins open a loot window when they land, are taken anywhere (no raven
// pillar), and overflow full bags. Every other letter keeps the mailbox and capacity rules.

import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import {
  MEMBERSHIP_ANNUAL_LETTER,
  MEMBERSHIP_TOKEN_LETTER,
  WOC_MARKET_DELIVERY_LETTER,
} from '../src/sim/content/letters';
import {
  isPurchaseParcel,
  overflowsBags,
  purchaseParcelView,
} from '../src/sim/mail/purchase_parcels';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const REINS = 'reins_nightwing_chimera';

/** A member far from every raven pillar, with every bag slot full. */
function fixture() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Member', { characterId: 77 });
  const meta = sim.players.get(pid)!;
  const capacity = bagCapacity(meta.bags);
  meta.inventory = Array.from({ length: capacity }, (_, slot) => ({
    itemId: 'worn_sword',
    count: 1,
    slot,
  }));
  const player = sim.entities.get(pid)!;
  player.pos = { x: 4000, y: 0, z: 4000 };
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
  return { sim, pid, meta, capacity, recipient: { key: '77', name: 'Member' } };
}

/** Runs the world for a sim-second (the mail sweep's cadence) and returns what it emitted. */
function drain(sim: Sim, ticks = 25): SimEvent[] {
  const events: SimEvent[] = [...sim.drainEvents()];
  for (let i = 0; i < ticks; i++) events.push(...sim.tick());
  return events;
}

const purchaseEvents = (events: SimEvent[]) =>
  events.filter(
    (e): e is Extract<SimEvent, { type: 'purchaseParcels' }> & { pid?: number } =>
      e.type === 'purchaseParcels',
  );

describe('store purchase parcels', () => {
  it('recognizes only server custody letters carrying a purchase letter id', () => {
    const base = { kind: 'system', letterId: MEMBERSHIP_TOKEN_LETTER.letterId, custodyRef: 'r' };
    expect(isPurchaseParcel(base)).toBe(true);
    expect(isPurchaseParcel({ ...base, letterId: MEMBERSHIP_ANNUAL_LETTER.letterId })).toBe(true);
    expect(isPurchaseParcel({ ...base, custodyRef: undefined })).toBe(false);
    expect(isPurchaseParcel({ ...base, kind: 'player' })).toBe(false);
    expect(isPurchaseParcel({ ...base, letterId: WOC_MARKET_DELIVERY_LETTER.letterId })).toBe(
      false,
    );
    expect(overflowsBags('membership_token')).toBe(true);
    expect(overflowsBags(REINS)).toBe(true);
    expect(overflowsBags('worn_sword')).toBe(false);
    expect(
      purchaseParcelView({ id: 3, ...base, items: [] }),
      'an emptied parcel offers nothing',
    ).toBeNull();
  });

  it.each([
    [MEMBERSHIP_TOKEN_LETTER, 'membership_token'],
    [MEMBERSHIP_ANNUAL_LETTER, REINS],
  ] as const)('announces %s on arrival and takes it anywhere into full bags', (letter, itemId) => {
    const { sim, pid, meta, capacity, recipient } = fixture();
    const ref = `membership-test:${itemId}`;
    expect(sim.mailSystemParcel(recipient, letter, [{ itemId, count: 1 }], ref)).toBe(true);
    const parcel = sim.postOffice.mail.find((m) => m.custodyRef === ref)!;
    const offered = purchaseEvents(drain(sim));
    expect(offered).toEqual([
      {
        type: 'purchaseParcels',
        parcels: [{ mailId: parcel.id, letterId: letter.letterId, items: [{ itemId, count: 1 }] }],
        pid,
      },
    ]);
    // The loot window's Collect is the ordinary mailTake, far from any raven pillar.
    sim.mailTake(parcel.id, pid);
    const after = drain(sim);
    expect(after.some((e) => e.type === 'mailResult' && e.code === 'tooFar')).toBe(false);
    expect(meta.inventory).toHaveLength(capacity + 1);
    expect(meta.inventory.at(-1)).toMatchObject({ itemId, count: 1 });
    expect(parcel.items).toEqual([]);
    expect(parcel.read).toBe(true);
    // Taken: a later login offers nothing.
    sim.postOffice.announcePurchaseParcels(meta);
    expect(purchaseEvents(drain(sim))).toEqual([]);
  });

  it('keeps the mailbox and capacity rules for every other letter', () => {
    const { sim, pid, meta, capacity, recipient } = fixture();
    sim.mailSystemParcel(
      recipient,
      WOC_MARKET_DELIVERY_LETTER,
      [{ itemId: 'rusty_hatchet', count: 1 }],
      'market:not-a-purchase',
    );
    const parcel = sim.postOffice.mail.find((m) => m.custodyRef === 'market:not-a-purchase')!;
    expect(purchaseEvents(drain(sim))).toEqual([]);
    sim.mailTake(parcel.id, pid);
    const events = drain(sim);
    expect(events.some((e) => e.type === 'mailResult' && e.code === 'tooFar')).toBe(true);
    expect(meta.inventory).toHaveLength(capacity);
    expect(parcel.items).toHaveLength(1);
    // A non-reward item inside a purchase letter still respects bag capacity.
    sim.mailSystemParcel(
      recipient,
      MEMBERSHIP_TOKEN_LETTER,
      [{ itemId: 'rusty_hatchet', count: 1 }],
      'membership-test:stray',
    );
    const stray = sim.postOffice.mail.find((m) => m.custodyRef === 'membership-test:stray')!;
    drain(sim);
    sim.mailTake(stray.id, pid);
    expect(meta.inventory).toHaveLength(capacity);
    expect(stray.items).toEqual([{ itemId: 'rusty_hatchet', count: 1 }]);
  });

  it('re-offers every waiting purchase on login, once each', () => {
    const { sim, pid, recipient } = fixture();
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    sim.mailSystemParcel(
      recipient,
      MEMBERSHIP_TOKEN_LETTER,
      [{ itemId: 'membership_token', count: 1 }],
      'membership-test:a',
    );
    sim.mailSystemParcel(
      recipient,
      MEMBERSHIP_ANNUAL_LETTER,
      [{ itemId: REINS, count: 1 }],
      'membership-test:b',
    );
    drain(sim);
    // The character logs in again on a restarted realm with the same mail book.
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    restored.loadMail(JSON.parse(JSON.stringify(sim.serializeMail())));
    const next = restored.addPlayer('warrior', 'Member', { characterId: 77, state });
    const [event, ...rest] = purchaseEvents(restored.drainEvents());
    expect(rest).toEqual([]);
    expect(event.pid).toBe(next);
    expect(event.parcels.map((p) => p.items[0].itemId).sort()).toEqual(
      ['membership_token', REINS].sort(),
    );
  });
});
