import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { MEMBERSHIP_TOKEN_LETTER, WOC_MARKET_DELIVERY_LETTER } from '../src/sim/content/letters';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

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
  const mailbox = sim.entities.get(sim.postOffice.mailboxIds[0])!;
  const player = sim.entities.get(pid)!;
  player.pos = { ...mailbox.pos };
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
  return { sim, pid, meta, capacity, recipient: { key: '77', name: 'Member' } };
}

describe('membership token mail overflow', () => {
  it.each([MEMBERSHIP_TOKEN_LETTER, WOC_MARKET_DELIVERY_LETTER])(
    'takes a token from $letterId into full bags without admitting other attachments',
    (letter) => {
      const { sim, pid, meta, capacity, recipient } = fixture();
      const token: InvSlot = {
        itemId: 'membership_token',
        count: 2,
        instance: { signer: 'Token Owner' },
      };
      expect(
        sim.mailSystemParcel(
          recipient,
          letter,
          [token, { itemId: 'rusty_hatchet', count: 1 }],
          'membership:overflow:test',
        ),
      ).toBe(true);
      const parcel = sim.postOffice.mail.find(
        (mail) => mail.custodyRef === 'membership:overflow:test',
      )!;
      sim.mailMarkRead(parcel.id, pid);
      sim.takeDirtyMailPartitions();
      const revision = meta.wireRev;
      sim.mailTake(parcel.id, pid);
      expect(meta.inventory).toHaveLength(capacity + 1);
      expect(meta.inventory.at(-1)).toMatchObject(token);
      expect(meta.wireRev).toBeGreaterThan(revision);
      expect(parcel.items).toEqual([{ itemId: 'rusty_hatchet', count: 1 }]);
      const dirty = sim.takeDirtyMailPartitions();
      expect(dirty.map((partition) => partition.recipientKey)).toEqual(['77']);
      expect(dirty[0].letters.find((mail) => mail.id === parcel.id)?.items).toEqual(parcel.items);
      sim.mailTake(parcel.id, pid);
      expect(meta.inventory.filter((slot) => slot.itemId === 'membership_token')).toEqual([
        expect.objectContaining(token),
      ]);
      expect(sim.takeDirtyMailPartitions()).toEqual([]);
    },
  );

  it('preserves overflow tokens and exhausted custody after character and mail reload', () => {
    const { sim, pid, meta, recipient } = fixture();
    const items: InvSlot[] = [{ itemId: 'membership_token', count: 1 }];
    const reference = 'membership:overflow:restart';
    sim.mailSystemParcel(recipient, MEMBERSHIP_TOKEN_LETTER, items, reference);
    const parcel = sim.postOffice.mail.find((mail) => mail.custodyRef === reference)!;
    sim.mailTake(parcel.id, pid);
    expect(meta.inventory.some((slot) => slot.itemId === 'membership_token')).toBe(true);
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    const mail = JSON.parse(JSON.stringify(sim.serializeMail()));
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    restored.loadMail(mail);
    const next = restored.addPlayer('warrior', 'Member', { characterId: 77, state });
    const nextMeta = restored.players.get(next)!;
    expect(nextMeta.inventory).toEqual(meta.inventory);
    expect(nextMeta.inventory.length).toBeGreaterThan(bagCapacity(nextMeta.bags));
    expect(restored.postOffice.mail.find((entry) => entry.id === parcel.id)?.items).toEqual([]);
    expect(restored.mailSystemParcel(recipient, MEMBERSHIP_TOKEN_LETTER, items, reference)).toBe(
      false,
    );
    expect(nextMeta.inventory.filter((slot) => slot.itemId === 'membership_token')).toHaveLength(1);
  });
});
