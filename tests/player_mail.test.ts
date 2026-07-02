import { describe, expect, it } from 'vitest';
import { emptyMailbox, enqueueMail, normalizeMailbox, normalizeMailItems } from '../src/sim/mail';
import { Sim, type PlayerMeta } from '../src/sim/sim';

function makeWorld() {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
}

function requireMeta(sim: Sim, pid: number): PlayerMeta {
  const meta = sim.meta(pid);
  expect(meta).toBeTruthy();
  return meta as PlayerMeta;
}

describe('player mail core', () => {
  it('normalizes mailbox state and mail item stacks deterministically', () => {
    expect(
      normalizeMailItems([
        { itemId: 'baked_bread', count: 1.9 },
        { itemId: 'baked_bread', count: 2 },
        { itemId: 'wolf_fang', count: 0 },
      ]),
    ).toEqual([
      { itemId: 'baked_bread', count: 3 },
      { itemId: 'wolf_fang', count: 1 },
    ]);

    const mailbox = emptyMailbox();
    enqueueMail(mailbox, {
      fromName: '',
      subject: 'A'.repeat(100),
      body: 'B'.repeat(600),
      copper: 12.7,
      sentAt: 3.5,
    });
    const normalized = normalizeMailbox(mailbox);
    expect(normalized.nextId).toBe(2);
    expect(normalized.inbox[0]).toMatchObject({
      id: 1,
      fromName: 'Unknown',
      subject: 'A'.repeat(80),
      body: 'B'.repeat(500),
      copper: 12,
      sentAt: 3,
      read: false,
      attachmentsTaken: false,
    });
  });

  it('sends copper and item attachments, then collects them once', () => {
    const sim = makeWorld();
    const sender = sim.addPlayer('warrior', 'Sender');
    const recipient = sim.addPlayer('mage', 'Recipient');
    requireMeta(sim, sender).copper = 100;
    sim.addItem('baked_bread', 3, sender);

    const mail = sim.sendMail(sender, recipient, {
      subject: 'Supplies',
      body: 'For you',
      copper: 35,
      items: [{ itemId: 'baked_bread', count: 2 }],
    });
    expect(mail).toBeTruthy();
    const mailId = mail?.id ?? 0;

    expect(requireMeta(sim, sender).copper).toBe(65);
    expect(sim.countItem('baked_bread', sender)).toBe(1);
    expect(sim.mailboxFor(recipient).inbox[0]).toMatchObject({
      id: mailId,
      fromName: 'Sender',
      subject: 'Supplies',
      copper: 35,
      items: [{ itemId: 'baked_bread', count: 2 }],
      read: false,
      attachmentsTaken: false,
    });

    const payload = sim.collectMailAttachments(recipient, mailId);
    expect(payload).toEqual({
      copper: 35,
      items: [{ itemId: 'baked_bread', count: 2 }],
    });
    expect(requireMeta(sim, recipient).copper).toBe(35);
    expect(sim.countItem('baked_bread', recipient)).toBe(2);
    expect(sim.collectMailAttachments(recipient, mailId)).toBeNull();
    expect(sim.mailboxFor(recipient).inbox[0]).toMatchObject({
      copper: 0,
      items: [],
      read: true,
      attachmentsTaken: true,
    });
  });

  it('rejects unaffordable mail and invalid item attachments atomically', () => {
    const sim = makeWorld();
    const sender = sim.addPlayer('warrior', 'Sender');
    const recipient = sim.addPlayer('mage', 'Recipient');
    requireMeta(sim, sender).copper = 5;
    sim.addItem('boar_hide', 1, sender);

    expect(sim.sendMail(sender, recipient, { copper: 10 })).toBeNull();
    expect(requireMeta(sim, sender).copper).toBe(5);
    expect(sim.mailboxFor(recipient).inbox).toEqual([]);

    expect(
      sim.sendMail(sender, recipient, {
        items: [{ itemId: 'boar_hide', count: 1 }],
      }),
    ).toBeNull();
    expect(sim.countItem('boar_hide', sender)).toBe(1);
    expect(sim.mailboxFor(recipient).inbox).toEqual([]);
  });

  it('returns cloned mailbox state for callers', () => {
    const sim = makeWorld();
    const sender = sim.addPlayer('warrior', 'Sender');
    const recipient = sim.addPlayer('mage', 'Recipient');
    const mail = sim.sendMail(sender, recipient, { subject: 'Original' });
    expect(mail).toBeTruthy();

    const external = sim.mailboxFor(recipient);
    external.inbox[0].subject = 'Changed';
    expect(sim.mailboxFor(recipient).inbox[0].subject).toBe('Original');
  });

  it('round-trips through character persistence and defaults legacy saves', () => {
    const sim = makeWorld();
    const sender = sim.addPlayer('warrior', 'Sender');
    const recipient = sim.addPlayer('mage', 'Recipient');
    requireMeta(sim, sender).copper = 50;
    sim.sendMail(sender, recipient, {
      subject: 'Saved',
      copper: 25,
      items: [],
    });

    const saved = sim.serializeCharacter(recipient);
    expect(saved?.mailbox?.inbox[0]).toMatchObject({ subject: 'Saved', copper: 25 });

    const restored = makeWorld();
    const restoredPid = restored.addPlayer('mage', 'Recipient', { state: saved ?? undefined });
    expect(restored.serializeCharacter(restoredPid)?.mailbox).toEqual(saved?.mailbox);

    const legacy = { ...(saved as unknown as Record<string, unknown>) };
    delete legacy.mailbox;
    const legacyWorld = makeWorld();
    const legacyPid = legacyWorld.addPlayer('mage', 'Legacy', { state: legacy as never });
    expect(legacyWorld.mailboxFor(legacyPid)).toEqual(emptyMailbox());
  });
});
