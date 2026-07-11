// Soulbound items (the heroic_mark reward token) cannot be traded, mailed,
// listed, or destroyed. This pins the two paths a player hits most directly:
// right-click destroy (discardItem) and player trade (tradeSetOffer), plus the
// flag itself. The mail/market/vendor gates fold into the same def.soulbound
// check at their existing quest/noMarketList/noVendorSell guards.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { type MailSave, Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { tradeSetOffer } from '../src/sim/social/trade';

describe('soulbound: heroic_mark is bound', () => {
  it('flags heroic_mark soulbound (and it is not soulbound for ordinary items)', () => {
    expect(ITEMS.heroic_mark.soulbound).toBe(true);
    expect(ITEMS.minor_healing_potion.soulbound).toBeFalsy();
  });

  it('cannot be destroyed via right-click discard, but ordinary items can', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', autoEquip: true });
    const pid = sim.player.id;
    sim.addItem('heroic_mark', 3, pid);
    sim.addItem('minor_healing_potion', 3, pid);

    sim.discardItem('heroic_mark', 2, pid);
    expect(sim.countItem('heroic_mark', pid)).toBe(3); // soulbound: discard is a no-op

    sim.discardItem('minor_healing_potion', 2, pid);
    expect(sim.countItem('minor_healing_potion', pid)).toBe(1); // control: ordinary item discards
  });

  it('is filtered out of a trade offer, while an ordinary item is accepted', () => {
    const bags = new Map<number, Map<string, number>>([
      [
        1,
        new Map([
          ['heroic_mark', 5],
          ['minor_healing_potion', 5],
        ]),
      ],
    ]);
    const session: any = {
      a: 1,
      b: 2,
      offerA: null,
      offerB: null,
      acceptedA: true,
      acceptedB: true,
    };
    const ctx = {
      resolve: (pid?: number) => (pid === 1 ? { meta: { entityId: 1, copper: 0 }, e: {} } : null),
      trades: new Map<number, any>([[1, session]]),
      countItem: (itemId: string, pid?: number) => bags.get(pid ?? 1)?.get(itemId) ?? 0,
    } as unknown as SimContext;

    tradeSetOffer(
      ctx,
      [
        { itemId: 'heroic_mark', count: 2 },
        { itemId: 'minor_healing_potion', count: 2 },
      ],
      0,
      1,
    );

    const offered = session.offerA.items.map((s: any) => s.itemId);
    expect(offered).toContain('minor_healing_potion');
    expect(offered).not.toContain('heroic_mark');
    // setting an offer resets both accept flags (guard against silent swaps)
    expect(session.acceptedA).toBe(false);
  });

  it('reports a soulbound refusal without calling the mark a quest item', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const sender = sim.addPlayer('warrior', 'Alice');
    const recipient = sim.addPlayer('mage', 'Bob');
    const senderMeta = sim.meta(sender);
    const recipientMeta = sim.meta(recipient);
    const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
    const senderEntity = sim.entities.get(sender);
    if (!senderMeta || !recipientMeta || !box || !senderEntity) {
      throw new Error('missing mail test fixture');
    }
    senderMeta.copper = 1_000;
    sim.addItem('heroic_mark', 1, sender);
    senderEntity.pos = { ...box.pos };
    senderEntity.prevPos = { ...box.pos };
    sim.rebucket(senderEntity);
    sim.drainEvents();

    sim.mailSendResolved(
      { key: String(recipientMeta.characterId ?? recipient), name: recipientMeta.name },
      'Heroic parcel',
      '',
      0,
      [{ itemId: 'heroic_mark', count: 1 }],
      sender,
    );

    const refusal = sim
      .drainEvents()
      .find((event) => event.type === 'mailResult' && event.code === 'noMailSoulbound');
    expect(refusal).toBeDefined();
    expect(sim.countItem('heroic_mark', sender)).toBe(1);
  });

  it('returns a persisted pre-soulbound Heroic Mark parcel to its sender on load', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const sender = sim.addPlayer('warrior', 'Alice');
    const recipient = sim.addPlayer('mage', 'Bob');
    const legacySave: MailSave = {
      mail: [
        {
          id: 71,
          recipientKey: 'Bob',
          recipientName: 'Bob',
          senderName: 'Alice',
          kind: 'player',
          subject: 'Old heroic parcel',
          body: '',
          copper: 0,
          items: [{ itemId: 'heroic_mark', count: 3 }],
          deliverIn: 0,
          secondsLeft: -1,
          read: false,
        },
        {
          id: 72,
          recipientKey: 'Bob',
          recipientName: 'Bob',
          senderName: 'Alice',
          kind: 'player',
          subject: 'Ordinary parcel',
          body: '',
          copper: 0,
          items: [{ itemId: 'minor_healing_potion', count: 1 }],
          deliverIn: 0,
          secondsLeft: -1,
          read: false,
        },
      ],
      nextMailId: 73,
    };

    sim.loadMail(legacySave);
    const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
    const senderEntity = sim.entities.get(sender);
    const recipientEntity = sim.entities.get(recipient);
    if (!box || !senderEntity || !recipientEntity) throw new Error('missing mail test entity');
    for (const player of [senderEntity, recipientEntity]) {
      player.pos = { ...box.pos };
      player.prevPos = { ...player.pos };
      sim.rebucket(player);
    }

    const senderMail = sim.mailInfoFor(sender)?.messages ?? [];
    const recipientMail = sim.mailInfoFor(recipient)?.messages ?? [];
    const hasItem = (messages: typeof senderMail, itemId: string): boolean =>
      messages.some((message) => message.items.some((item) => item.itemId === itemId));

    // MailSave persists only senderName, so the safe recovery route is the
    // sender's name-keyed mailbox. The recipient must never be able to claim the
    // newly soulbound parcel, while an ordinary legacy parcel stays addressed.
    expect({
      heroicReturnedToSender: hasItem(senderMail, 'heroic_mark'),
      heroicStillWithRecipient: hasItem(recipientMail, 'heroic_mark'),
      ordinaryStillWithRecipient: hasItem(recipientMail, 'minor_healing_potion'),
    }).toEqual({
      heroicReturnedToSender: true,
      heroicStillWithRecipient: false,
      ordinaryStillWithRecipient: true,
    });
  });
});
