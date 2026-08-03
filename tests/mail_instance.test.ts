// Ravenpost instanced attachments (issue 1165 completion): a signed / enchanted
// copy that is NOT transfer-locked attaches as a single-copy parcel and its
// payload survives send, flight, claim, the return-to-sender flight, the
// soulbound-return sweep, and the JSONB save round trip byte-equal. Armed
// (bindOnTrade) and bound (boundTo) copies are refused with the noMailBound
// code; the plain fungible path stays byte-identical. Probes the REAL Sim
// delegates plus the mocked-db GameServer wire.

import { describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  setCharacterHotbarLayout: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import {
  MAIL_ATTACHMENT_EXPIRY_SECONDS,
  MAIL_DELIVERY_SECONDS,
  MAIL_POSTAGE,
} from '../src/sim/mail/post_office';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemInstancePayload, SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const BOOTS = 'oiled_boots';
const HIDE = 'pristine_hide';
const SCALE = 'mudfin_scale';

// Instanced-attachment mail only needs PostOffice + players + mailboxes.
// Strip ambient camps/NPCs/objects (subsystem-world pattern; services stay).
const makeWorld = () =>
  new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });

function moveToMailbox(sim: Sim, pid: number): void {
  const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
  const p = sim.entities.get(pid);
  if (!box || !p) throw new Error('missing mailbox or player');
  p.pos = { ...box.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p as Entity);
}

function metaOf(sim: Sim, pid: number) {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error('no player meta');
  return r.meta;
}

function slotsOf(sim: Sim, pid: number, itemId: string) {
  return metaOf(sim, pid).inventory.filter((s) => s.itemId === itemId);
}

function mailCodes(events: SimEvent[]): string[] {
  return events
    .filter((e) => e.type === 'mailResult')
    .map((e) => (e as unknown as { code: string }).code);
}

function errorTexts(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function tickFor(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds * 20); i++) sim.tick();
}

const bookOf = (sim: Sim) =>
  (sim.postOffice as unknown as { mail: { expiresAt: number; items: { instance?: unknown }[] }[] })
    .mail;

const ENCHANTED: ItemInstancePayload = {
  enchant: 'ench_stat_str',
  rolled: { stats: { str: 2 } },
};
const SIGNED: ItemInstancePayload = { signer: 'Sender' };
const ARMED: ItemInstancePayload = { bindOnTrade: true };
const STAMPED: ItemInstancePayload = { bindOnTrade: true, boundTo: 999 };
const CHARGED: ItemInstancePayload = { signer: 'Sender', charges: { zap: 2 } };

function mailSetup() {
  const sim = makeWorld();
  const sender = sim.addPlayer('warrior', 'Sender');
  const recipient = sim.addPlayer('mage', 'Rex');
  moveToMailbox(sim, sender);
  sim.players.get(sender)!.copper = 10000;
  sim.drainEvents();
  return { sim, sender, recipient };
}

function firstPlayerLetterId(sim: Sim, pid: number): number {
  const info = sim.mailInfoFor(pid);
  const letter = info?.messages.find((m) => m.kind === 'player');
  if (!letter) throw new Error('no delivered player letter');
  return letter.id;
}

describe('mailSend: instanced attachments', () => {
  it('an enchanted piece rides the raven and claims byte-equal', () => {
    const { sim, sender, recipient } = mailSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, sender);
    sim.mailSend(
      'Rex',
      'gift',
      'wear it well',
      0,
      [{ itemId: BOOTS, count: 1, instance: ENCHANTED }],
      sender,
    );
    const codes = mailCodes(sim.drainEvents());
    expect(codes).toContain('sent');
    expect(slotsOf(sim, sender, BOOTS)).toHaveLength(0);
    expect(sim.players.get(sender)!.copper).toBe(10000 - MAIL_POSTAGE);

    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, recipient);
    sim.mailTake(firstPlayerLetterId(sim, recipient), recipient);
    const got = slotsOf(sim, recipient, BOOTS);
    expect(got).toHaveLength(1);
    expect(got[0].instance).toEqual(ENCHANTED);
  });

  it('two byte-equal signed copies attach as two single-copy parcels', () => {
    const { sim, sender, recipient } = mailSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, sender);
    sim.addItemInstance(HIDE, { ...SIGNED }, sender);
    sim.mailSend(
      'Rex',
      'both',
      'take both',
      0,
      [
        { itemId: HIDE, count: 1, instance: SIGNED },
        { itemId: HIDE, count: 1, instance: SIGNED },
      ],
      sender,
    );
    expect(mailCodes(sim.drainEvents())).toContain('sent');
    expect(slotsOf(sim, sender, HIDE)).toHaveLength(0);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, recipient);
    sim.mailTake(firstPlayerLetterId(sim, recipient), recipient);
    const got = slotsOf(sim, recipient, HIDE);
    expect(got.reduce((n, s) => n + s.count, 0)).toBe(2);
    for (const s of got) expect(s.instance).toEqual(SIGNED);
  });

  it('holding one copy but attaching it twice is refused (notEnoughItems)', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, sender);
    sim.mailSend(
      'Rex',
      'greedy',
      'two of one',
      0,
      [
        { itemId: HIDE, count: 1, instance: SIGNED },
        { itemId: HIDE, count: 1, instance: SIGNED },
      ],
      sender,
    );
    const codes = mailCodes(sim.drainEvents());
    expect(codes).toContain('notEnoughItems');
    expect(codes).not.toContain('sent');
    expect(slotsOf(sim, sender, HIDE)).toHaveLength(1);
    expect(sim.players.get(sender)!.copper).toBe(10000);
  });

  it('armed and stamped copies are refused with noMailBound, payload intact', () => {
    for (const locked of [ARMED, STAMPED]) {
      const { sim, sender } = mailSetup();
      sim.addItemInstance(HIDE, { ...locked }, sender);
      sim.mailSend('Rex', 'no', 'nope', 0, [{ itemId: HIDE, count: 1, instance: locked }], sender);
      const codes = mailCodes(sim.drainEvents());
      expect(codes).toContain('noMailBound');
      expect(codes).not.toContain('sent');
      const kept = slotsOf(sim, sender, HIDE);
      expect(kept).toHaveLength(1);
      expect(kept[0].instance).toEqual(locked);
      expect(sim.players.get(sender)!.copper).toBe(10000);
    }
  });

  it('a forged needle naming a payload the sender does not hold escrows nothing', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(HIDE, { signer: 'SomeoneElse' }, sender);
    sim.mailSend('Rex', 'forge', 'fake', 0, [{ itemId: HIDE, count: 1, instance: SIGNED }], sender);
    const codes = mailCodes(sim.drainEvents());
    expect(codes).toContain('notEnoughItems');
    expect(slotsOf(sim, sender, HIDE)[0].instance).toEqual({ signer: 'SomeoneElse' });
  });

  it('a stripped-lock forgery cannot free a bound copy: equality fails, nothing escrows', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(HIDE, { ...STAMPED }, sender);
    // The needle claims the copy is plain-signed; the held copy is stamped.
    sim.mailSend(
      'Rex',
      'launder',
      'strip',
      0,
      [{ itemId: HIDE, count: 1, instance: { bindOnTrade: true } }],
      sender,
    );
    const codes = mailCodes(sim.drainEvents());
    // The needle itself is armed, so the bound denial fires before matching.
    expect(codes).toContain('noMailBound');
    expect(slotsOf(sim, sender, HIDE)[0].instance).toEqual(STAMPED);
  });

  it('an instanced entry with a count other than exactly 1 is refused, never truncated', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, sender);
    sim.addItemInstance(HIDE, { ...SIGNED }, sender);
    sim.mailSend(
      'Rex',
      'greedy',
      'stacked',
      0,
      [{ itemId: HIDE, count: 2, instance: SIGNED }],
      sender,
    );
    expect(mailCodes(sim.drainEvents())).not.toContain('sent');
    expect(slotsOf(sim, sender, HIDE).reduce((n, s) => n + s.count, 0)).toBe(2);
    expect(sim.players.get(sender)!.copper).toBe(10000);
  });

  it('the plain fungible path is unchanged: parcel rows carry no instance key', () => {
    const { sim, sender } = mailSetup();
    sim.addItem(SCALE, 5, sender);
    sim.mailSend('Rex', 'junk', 'scales', 0, [{ itemId: SCALE, count: 3 }], sender);
    expect(mailCodes(sim.drainEvents())).toContain('sent');
    const letter = bookOf(sim).find((m) => m.items.length > 0);
    expect(letter?.items).toEqual([{ itemId: SCALE, count: 3 }]);
  });
});

describe('mailTake: instanced capacity modeling', () => {
  it('an instanced parcel needs instanced room; it stays attached until space frees', () => {
    const { sim, sender, recipient } = mailSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, sender);
    sim.mailSend('Rex', 'gift', 'hide', 0, [{ itemId: HIDE, count: 1, instance: SIGNED }], sender);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, recipient);
    const recipientMeta = metaOf(sim, recipient);
    recipientMeta.inventory.length = 0;
    // A plain hide stack with room would satisfy a PLAIN capacity check; the
    // signed parcel needs its own slot, so the take must keep it attached.
    sim.addItem(HIDE, 1, recipient);
    while (recipientMeta.inventory.length < 16) {
      sim.addItemInstance(SCALE, { signer: `F${recipientMeta.inventory.length}` }, recipient);
    }
    const letterId = firstPlayerLetterId(sim, recipient);
    sim.drainEvents();
    sim.mailTake(letterId, recipient);
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');
    expect(slotsOf(sim, recipient, HIDE).some((s) => s.instance)).toBe(false);
    // Free a slot: the retry delivers the payload intact.
    recipientMeta.inventory.pop();
    sim.mailTake(letterId, recipient);
    const got = slotsOf(sim, recipient, HIDE).filter((s) => s.instance);
    expect(got).toHaveLength(1);
    expect(got[0].instance).toEqual(SIGNED);
  });
});

describe('return flight and persistence', () => {
  it('an unclaimed instanced parcel flies home with its payload', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, sender);
    sim.mailSend(
      'Rex',
      'gift',
      'unclaimed',
      0,
      [{ itemId: BOOTS, count: 1, instance: ENCHANTED }],
      sender,
    );
    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    const letter = bookOf(sim).find((m) => m.items.length > 0)!;
    expect(letter.expiresAt).toBeGreaterThan(0);
    letter.expiresAt = sim.time - 1;
    tickFor(sim, 1 + MAIL_DELIVERY_SECONDS + 1);
    // The letter re-keyed home and landed; the sender claims their copy back.
    sim.drainEvents();
    sim.mailTake(firstPlayerLetterId(sim, sender), sender);
    const back = slotsOf(sim, sender, BOOTS);
    expect(back).toHaveLength(1);
    expect(back[0].instance).toEqual(ENCHANTED);
  });

  it('serializeMail/loadMail round-trips an instanced parcel byte-equal', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, sender);
    sim.mailSend(
      'Rex',
      'gift',
      'saved',
      0,
      [{ itemId: BOOTS, count: 1, instance: ENCHANTED }],
      sender,
    );
    const save = JSON.parse(JSON.stringify(sim.serializeMail()));
    const sim2 = makeWorld();
    sim2.loadMail(save);
    const letter = bookOf(sim2).find((m) => m.items.length > 0);
    expect(letter?.items[0]).toEqual({ itemId: BOOTS, count: 1, instance: ENCHANTED });
    // And the payload survives a second generation unchanged. (Whole-blob
    // equality would trip on the pre-existing returned:undefined -> false
    // materialization across one load, which is not a payload concern.)
    const secondGen = JSON.parse(JSON.stringify(sim2.serializeMail()));
    expect(secondGen.mail[0].items).toEqual(save.mail[0].items);
  });

  it('loadMail runs the shared payload bound on attachments (the whole-branch escrow fix)', () => {
    // The book-level proof the unit arms cannot give: a junk payload on a
    // persisted parcel is bounded ON THE REAL LOAD PATH, so it cannot ride
    // every mail save forever nor be granted into live bags on take.
    const sim = makeWorld();
    sim.loadMail({
      mail: [
        {
          id: 1,
          recipientKey: 'Rex',
          recipientName: 'Rex',
          senderName: 'Sender',
          kind: 'player',
          subject: 'junk',
          body: 'oversized signer',
          copper: 0,
          items: [{ itemId: 'wolf_fang', count: 1, instance: { signer: 'x'.repeat(5000) } }],
          deliverIn: 0,
          secondsLeft: 1000,
          read: false,
        },
      ],
      nextMailId: 2,
    });
    const letter = bookOf(sim).find((m) => m.items.length > 0);
    // The oversized signer dropped and the emptied payload dropped whole; the
    // attachment itself survives as plain recoverable data.
    expect(letter?.items[0]).toEqual({ itemId: 'wolf_fang', count: 1 });
  });

  it('rekeyMailOwner follows the escrowed payload signers on the recipient arm only', () => {
    const sim = makeWorld();
    sim.loadMail({
      mail: [
        {
          id: 1,
          recipientKey: 'Oldname',
          recipientName: 'Oldname',
          senderName: 'Someone',
          kind: 'player',
          subject: 'own',
          body: 'incoming holding',
          copper: 0,
          items: [{ itemId: 'wolf_fang', count: 1, instance: { signer: 'Oldname' } }],
          deliverIn: 0,
          secondsLeft: 1000,
          read: false,
        },
        {
          id: 2,
          recipientKey: 'Stranger',
          recipientName: 'Stranger',
          senderName: 'Oldname',
          kind: 'player',
          subject: 'foreign',
          body: 'a copy in a stranger parcel stays foreign-held',
          copper: 0,
          items: [{ itemId: 'wolf_fang', count: 1, instance: { signer: 'Oldname' } }],
          deliverIn: 0,
          secondsLeft: 1000,
          read: false,
        },
      ],
      nextMailId: 3,
    });
    expect(sim.rekeyMailOwner(9, 'Oldname', 'Newname')).toBe(true);
    const letters = bookOf(sim) as unknown as {
      subject: string;
      recipientKey: string;
      items: { instance?: unknown }[];
    }[];
    const own = letters.find((m) => m.subject === 'own');
    const foreign = letters.find((m) => m.subject === 'foreign');
    expect(own?.recipientKey).toBe('9');
    expect(own?.items[0]?.instance).toEqual({ signer: 'Newname' });
    expect(foreign?.items[0]?.instance, 'stranger parcel untouched').toEqual({
      signer: 'Oldname',
    });
  });

  it('the soulbound-return sweep keeps the returned parcel payload', () => {
    // A payload-carrying parcel whose item became soulbound after it was sent:
    // the load-time migration returns it to the sender WITH the payload.
    const sim = makeWorld();
    sim.loadMail({
      mail: [
        {
          id: 1,
          recipientKey: 'Rex',
          recipientName: 'Rex',
          senderName: 'Sender',
          kind: 'player',
          subject: 'old',
          body: 'pre-soulbound',
          copper: 0,
          items: [{ itemId: 'heroic_mark', count: 1, instance: { signer: 'Sender' } }],
          deliverIn: 0,
          secondsLeft: MAIL_ATTACHMENT_EXPIRY_SECONDS,
          read: false,
        },
      ],
      nextMailId: 2,
    });
    const returned = bookOf(sim).find((m) => m.items.length > 0);
    expect(returned?.items[0]).toEqual({
      itemId: 'heroic_mark',
      count: 1,
      instance: { signer: 'Sender' },
    });
    expect((returned as unknown as { recipientKey: string }).recipientKey).toBe('Sender');
  });
});

describe('persistence: pre-payload saves', () => {
  it('a v0.31-shape mail save (no instance keys) round-trips its rows byte-identically', () => {
    const oldSave = {
      mail: [
        {
          id: 3,
          recipientKey: '9',
          recipientName: 'Rex',
          senderName: 'Old Sender',
          kind: 'player' as const,
          subject: 'old',
          body: 'plain parcel',
          copper: 5,
          items: [{ itemId: HIDE, count: 2 }],
          deliverIn: 0,
          secondsLeft: 1000,
          read: false,
          returned: false,
        },
      ],
      nextMailId: 4,
    };
    const sim = makeWorld();
    sim.loadMail(JSON.parse(JSON.stringify(oldSave)));
    const reserialized = JSON.parse(JSON.stringify(sim.serializeMail()));
    expect(reserialized.mail).toEqual(oldSave.mail);
  });
});

describe('mailInfoFor: display payloads are trimmed', () => {
  it('wires signer and never charges; the book keeps the full payload for the take', () => {
    const { sim, sender, recipient } = mailSetup();
    sim.addItemInstance(HIDE, { ...CHARGED, charges: { zap: 2 } }, sender);
    sim.mailSend(
      'Rex',
      'zap',
      'charged',
      0,
      [{ itemId: HIDE, count: 1, instance: CHARGED }],
      sender,
    );
    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, recipient);
    const info = sim.mailInfoFor(recipient);
    const letter = info?.messages.find((m) => m.items.length > 0);
    expect(letter?.items[0].instance).toEqual({ signer: 'Sender' });
    sim.mailTake(letter!.id, recipient);
    expect(slotsOf(sim, recipient, HIDE)[0].instance).toEqual(CHARGED);
  });
});

describe('wire: instanced mail_send over the mocked-db GameServer', () => {
  it('escrows the actual held copy and delivers it byte-equal', () => {
    const server = new GameServer();
    const mk = (id: number, name: string, cls: string) => {
      const sent: { t: string }[] = [];
      const ws = {
        readyState: 1,
        send: (p: string) => sent.push(JSON.parse(p)),
      } as unknown as WebSocket;
      const session = server.join(ws, id, id, name, cls as never, null);
      if ('error' in session) throw new Error(session.error);
      session.blockListLoaded = true;
      return session;
    };
    const sender = mk(1, 'Sender', 'warrior');
    const recipient = mk(2, 'Rex', 'mage');
    const sim = server.sim;
    moveToMailbox(sim, sender.pid);
    sim.players.get(sender.pid)!.copper = 10000;
    sim.addItemInstance(BOOTS, { ...ENCHANTED, rolled: { stats: { str: 2 } } }, sender.pid);

    server.handleMessage(
      sender,
      JSON.stringify({
        t: 'cmd',
        cmd: 'mail_send',
        to: 'Rex',
        subject: 'gift',
        body: 'over the wire',
        copper: 0,
        items: [{ itemId: BOOTS, count: 1, instance: ENCHANTED }],
      }),
    );
    expect(slotsOf(sim, sender.pid, BOOTS)).toHaveLength(0);
    const letter = bookOf(sim).find((m) => m.items.length > 0);
    expect(letter?.items[0]).toEqual({ itemId: BOOTS, count: 1, instance: ENCHANTED });

    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, recipient.pid);
    sim.mailTake(firstPlayerLetterId(sim, recipient.pid), recipient.pid);
    expect(slotsOf(sim, recipient.pid, BOOTS)[0].instance).toEqual(ENCHANTED);
  });
});
