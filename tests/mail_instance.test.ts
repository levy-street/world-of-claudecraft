// Ravenpost instanced attachments (issue 1165 completion): a signed / enchanted
// copy that is NOT transfer-locked attaches as a single-copy parcel and its
// payload survives send, flight, claim, the return-to-sender flight, the
// soulbound-return sweep, and the JSONB save round trip byte-equal. Armed
// (bindOnTrade) and bound (boundTo) copies are refused with the noMailBound
// code. Non-material fungible mail stays byte-identical; material pools retain
// their exact source composition. Probes the REAL Sim delegates plus the
// mocked-db GameServer wire.

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
  insertBankLedgerRows: vi.fn(async () => {}),
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
import type { Entity, InvSlot, ItemInstancePayload, SimEvent } from '../src/sim/types';
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
  (sim.postOffice as unknown as { mail: { expiresAt: number; items: InvSlot[] }[] }).mail;

// A legacy `signer` is no longer a payload field on a MATERIAL: it projects
// into the stack's source buckets, and the payload keeps only what is not
// provenance. These two read the buckets, so the assertions below still pin the
// exact ownership they always did, by unit count, at its new home.
type SourceCarrier = {
  materialSources?: readonly { source: { signer?: string }; count: number }[];
};

/** signer -> unit count over a row's buckets; unrecorded units key as `-`. */
function signerCounts(row: SourceCarrier | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bucket of row?.materialSources ?? []) {
    const key = bucket.source.signer ?? '-';
    out[key] = (out[key] ?? 0) + bucket.count;
  }
  return out;
}

/** Signer counts summed over several rows (a claim that may now share a stack). */
function signerCountsAcross(rows: readonly SourceCarrier[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const [signer, count] of Object.entries(signerCounts(row))) {
      out[signer] = (out[signer] ?? 0) + count;
    }
  }
  return out;
}

// A non-material stackable and a non-material unstackable, for the controls
// that must prove the material arm changed nothing outside its own taxonomy.
const BREAD = 'baked_bread';
const SWORD = 'worn_sword';

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
  it('mails a canonical mixed-source material pool in bulk, including premium units', () => {
    const { sim, sender } = mailSetup();
    sim.addItem(HIDE, 3, sender, {
      materialSources: [
        { source: {}, count: 1 },
        {
          source: { gatherer: { kind: 'character', id: sender, name: 'Sender' } },
          count: 1,
        },
        { source: { signer: 'Sender' }, count: 1 },
      ],
    });

    sim.mailSend('Rex', 'all', 'mixed sources', 0, [{ itemId: HIDE, count: 3 }], sender);

    expect(mailCodes(sim.drainEvents())).toContain('sent');
    expect(slotsOf(sim, sender, HIDE)).toHaveLength(0);
    const letter = bookOf(sim).find((m) => m.items.length > 0);
    expect(letter?.items).toHaveLength(1);
    expect(letter?.items[0].count).toBe(3);
    expect(signerCounts(letter?.items[0])).toEqual({ '-': 2, Sender: 1 });
  });

  it('matches canonical material payload independently from its source signer', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(HIDE, { enchant: 'ench_stat_str' }, sender, 2, {
      materialSources: [
        { source: { signer: 'Ana' }, count: 1 },
        { source: { signer: 'Bru' }, count: 1 },
      ],
    });

    sim.mailSend(
      'Rex',
      'one',
      'same enchant',
      0,
      [{ itemId: HIDE, count: 1, instance: { enchant: 'ench_stat_str' } }],
      sender,
    );

    expect(mailCodes(sim.drainEvents())).toContain('sent');
    const letter = bookOf(sim).find((m) => m.items.length > 0);
    expect(letter?.items[0].instance).toEqual({ enchant: 'ench_stat_str' });
    expect(letter?.items[0].materialSources).toHaveLength(1);
    expect(slotsOf(sim, sender, HIDE).reduce((n, slot) => n + slot.count, 0)).toBe(1);
  });

  it('refuses overlapping plain and legacy-signer requests before charging or escrowing', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, sender);
    const before = structuredClone(slotsOf(sim, sender, HIDE));

    sim.mailSend(
      'Rex',
      'twice',
      'one unit',
      0,
      [
        { itemId: HIDE, count: 1 },
        { itemId: HIDE, count: 1, instance: SIGNED },
      ],
      sender,
    );

    const codes = mailCodes(sim.drainEvents());
    expect(codes).toContain('notEnoughItems');
    expect(codes).not.toContain('sent');
    expect(slotsOf(sim, sender, HIDE)).toEqual(before);
    expect(sim.players.get(sender)!.copper).toBe(10000);
    expect(bookOf(sim).some((letter) => letter.items.length > 0)).toBe(false);
  });

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
    // Two parcels, two units, both still Sender's. The signature now lives in
    // the source buckets, and byte-equal material may share ONE stack on the
    // way in, so the ownership claim is counted across the slots rather than
    // asserted per slot.
    expect(signerCountsAcross(got)).toEqual({ Sender: 2 });
    for (const s of got) expect(s.instance?.signer).toBeUndefined();
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

  it('the SAME payload minus bindOnTrade rides the raven: the flag is the cause', () => {
    // The control for the refusal above, and the reason it is worth a case of
    // its own: without it, "noMailBound" could be coming from anything about
    // the fixture. Ravenpost is one of the anonymous pipes the exchange rules
    // name as siblings (market escrow, guild bank), so the armed state has to
    // be refused HERE, at the same staging check, and only the armed state.
    const { sim, sender, recipient } = mailSetup();
    const disarmed: ItemInstancePayload = { signer: 'Sender' };
    sim.addItemInstance(HIDE, { ...ARMED, ...disarmed }, sender);
    sim.mailSend(
      'Rex',
      'armed',
      'nope',
      0,
      [{ itemId: HIDE, count: 1, instance: { ...ARMED, ...disarmed } }],
      sender,
    );
    expect(mailCodes(sim.drainEvents())).toContain('noMailBound');
    expect(slotsOf(sim, sender, HIDE)).toHaveLength(1);

    sim.addItemInstance(HIDE, { ...disarmed }, sender);
    sim.mailSend(
      'Rex',
      'clean',
      'yours',
      0,
      [{ itemId: HIDE, count: 1, instance: disarmed }],
      sender,
    );
    const codes = mailCodes(sim.drainEvents());
    expect(codes).toContain('sent');
    expect(codes).not.toContain('noMailBound');
    // The armed copy stayed behind while its disarmed twin left, which is the
    // whole claim: same item, same sender, same mailbox, one flag apart.
    const kept = slotsOf(sim, sender, HIDE);
    expect(kept).toHaveLength(1);
    // The ARMING flag is payload state and stays on the payload; only the
    // signature moved into the bucket. That split is the point of the case:
    // the flag the refusal keyed on is exactly where it was.
    expect(kept[0].instance).toEqual({ ...ARMED });
    expect(signerCounts(kept[0])).toEqual({ Sender: 1 });

    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, recipient);
    sim.mailTake(firstPlayerLetterId(sim, recipient), recipient);
    const got = slotsOf(sim, recipient, HIDE);
    expect(got).toHaveLength(1);
    expect(got[0].instance?.bindOnTrade).toBeUndefined();
    expect(signerCounts(got[0])).toEqual({ Sender: 1 });
  });

  it('a forged needle naming a payload the sender does not hold escrows nothing', () => {
    const { sim, sender } = mailSetup();
    sim.addItemInstance(HIDE, { signer: 'SomeoneElse' }, sender);
    sim.mailSend('Rex', 'forge', 'fake', 0, [{ itemId: HIDE, count: 1, instance: SIGNED }], sender);
    const codes = mailCodes(sim.drainEvents());
    // The REFUSAL is the claim and is unchanged: a needle naming a signature
    // the sender does not hold matches nothing and escrows nothing.
    expect(codes).toContain('notEnoughItems');
    expect(codes).not.toContain('sent');
    const held = slotsOf(sim, sender, HIDE);
    expect(held).toHaveLength(1);
    expect(held[0].count).toBe(1);
    // The held copy is untouched, and it is still SomeoneElse's unit: the
    // forged needle neither consumed it nor relabelled its ownership.
    expect(signerCounts(held[0])).toEqual({ SomeoneElse: 1 });
    expect(held[0].instance?.signer).toBeUndefined();
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
    const row = letter?.items[0] as (SourceCarrier & { itemId: string; count: number }) | undefined;
    // The CLAIM is unchanged: no instance key on a plain parcel row. A material
    // additionally carries the exact provenance of the units escrowed, which is
    // three unrecorded units here and nothing invented.
    expect(row?.itemId).toBe(SCALE);
    expect(row?.count).toBe(3);
    expect('instance' in (row ?? {})).toBe(false);
    expect(signerCounts(row)).toEqual({ '-': 3 });
    expect(row?.materialSources).toEqual([{ source: {}, count: 3 }]);
  });

  it('a NON-material plain parcel row still carries neither key', () => {
    // The control for the row above: outside the material taxonomy the escrow
    // row is byte-identical to what it always was, with no source list at all.
    const { sim, sender } = mailSetup();
    sim.addItem(BREAD, 5, sender);
    sim.mailSend('Rex', 'lunch', 'bread', 0, [{ itemId: BREAD, count: 3 }], sender);
    expect(mailCodes(sim.drainEvents())).toContain('sent');
    const letter = bookOf(sim).find((m) => m.items.length > 0);
    expect(letter?.items).toEqual([{ itemId: BREAD, count: 3 }]);
  });
});

describe('mailTake: instanced capacity modeling', () => {
  /** Fill every remaining backpack slot with copies that genuinely occupy one
   *  slot each. Deliberately a NON-material unstackable: filling with signed
   *  material would now merge into a single stack and never reach the cap. */
  function fillBackpack(sim: Sim, pid: number): void {
    const meta = metaOf(sim, pid);
    while (meta.inventory.length < 16) sim.addItem(SWORD, 1, pid);
  }

  it('a signed MATERIAL parcel lands in a compatible stack a full bag still has', () => {
    // This case used to prove "instanced room is not plain room". For a
    // material that distinction is exactly what the shared-stack rule removes:
    // a Sender-signed unit and an unrecorded unit are compatible, so the plain
    // hide stack really does have room and the take really can deliver. The
    // enchanted control below keeps the original claim where it still holds.
    const { sim, sender, recipient } = mailSetup();
    sim.addItemInstance(HIDE, { ...SIGNED }, sender);
    sim.mailSend('Rex', 'gift', 'hide', 0, [{ itemId: HIDE, count: 1, instance: SIGNED }], sender);
    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, recipient);
    const recipientMeta = metaOf(sim, recipient);
    recipientMeta.inventory.length = 0;
    sim.addItem(HIDE, 1, recipient);
    fillBackpack(sim, recipient);
    expect(recipientMeta.inventory).toHaveLength(16);

    const letterId = firstPlayerLetterId(sim, recipient);
    sim.drainEvents();
    sim.mailTake(letterId, recipient);

    // No refusal, no new slot, and the unit kept its owner.
    expect(errorTexts(sim.drainEvents())).not.toContain('Your bags are full.');
    expect(recipientMeta.inventory).toHaveLength(16);
    const hide = slotsOf(sim, recipient, HIDE);
    expect(hide).toHaveLength(1);
    expect(hide[0].count).toBe(2);
    expect(signerCounts(hide[0])).toEqual({ '-': 1, Sender: 1 });
  });

  it('an ENCHANTED parcel still needs its own slot and stays attached until one frees', () => {
    // The control that keeps the original capacity claim: an enchanted payload
    // is NOT compatible with a plain stack (the merge rule is unchanged there),
    // so the parcel still needs a free slot whatever its source says.
    const { sim, sender, recipient } = mailSetup();
    sim.addItemInstance(HIDE, { ...ENCHANTED }, sender);
    sim.mailSend(
      'Rex',
      'gift',
      'hide',
      0,
      [{ itemId: HIDE, count: 1, instance: ENCHANTED }],
      sender,
    );
    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, recipient);
    const recipientMeta = metaOf(sim, recipient);
    recipientMeta.inventory.length = 0;
    sim.addItem(HIDE, 1, recipient);
    fillBackpack(sim, recipient);

    const letterId = firstPlayerLetterId(sim, recipient);
    sim.drainEvents();
    sim.mailTake(letterId, recipient);
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');
    expect(slotsOf(sim, recipient, HIDE).some((s) => s.instance?.enchant)).toBe(false);

    // Free a slot: the retry delivers the payload intact.
    recipientMeta.inventory.pop();
    sim.mailTake(letterId, recipient);
    const got = slotsOf(sim, recipient, HIDE).filter((s) => s.instance?.enchant);
    expect(got).toHaveLength(1);
    expect(got[0].instance).toEqual(ENCHANTED);
  });

  it('a NON-material instanced parcel needs instanced room, exactly as before', () => {
    // The taxonomy control: outside materials the capacity model is untouched,
    // signature and all.
    const { sim, sender, recipient } = mailSetup();
    sim.addItemInstance(BREAD, { ...SIGNED }, sender);
    sim.mailSend(
      'Rex',
      'gift',
      'bread',
      0,
      [{ itemId: BREAD, count: 1, instance: SIGNED }],
      sender,
    );
    tickFor(sim, MAIL_DELIVERY_SECONDS + 1);
    moveToMailbox(sim, recipient);
    const recipientMeta = metaOf(sim, recipient);
    recipientMeta.inventory.length = 0;
    sim.addItem(BREAD, 1, recipient);
    fillBackpack(sim, recipient);

    const letterId = firstPlayerLetterId(sim, recipient);
    sim.drainEvents();
    sim.mailTake(letterId, recipient);
    expect(errorTexts(sim.drainEvents())).toContain('Your bags are full.');

    recipientMeta.inventory.pop();
    sim.mailTake(letterId, recipient);
    const got = slotsOf(sim, recipient, BREAD).filter((s) => s.instance);
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
    // attachment itself survives as plain recoverable data. The bound is what
    // is on trial, so the signer must be gone from BOTH homes: not on the
    // payload, and not laundered into a source bucket either.
    expect(letter?.items[0]).toEqual({
      itemId: 'wolf_fang',
      count: 1,
      materialSources: [{ source: {}, count: 1 }],
    });
    expect(signerCounts(letter?.items[0] as SourceCarrier)).toEqual({ '-': 1 });
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
    // The rename follows the signature into its new home: the owner's escrowed
    // unit re-keys in the SOURCE bucket, one unit, and the stranger's parcel is
    // untouched. Renaming the owned scope only is the whole claim.
    expect(signerCounts(own?.items[0] as SourceCarrier)).toEqual({ Newname: 1 });
    expect(signerCounts(foreign?.items[0] as SourceCarrier), 'stranger parcel untouched').toEqual({
      Oldname: 1,
    });
    expect((own?.items[0] as { instance?: ItemInstancePayload })?.instance?.signer).toBeUndefined();
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
    // Every field of a pre-payload row survives untouched. A MATERIAL row now
    // also states the provenance those units always had and nobody recorded:
    // two unrecorded units, exactly the count the row holds. That projection is
    // additive and lossless, so the row is asserted whole rather than loosened.
    expect(reserialized.mail).toEqual([
      {
        ...oldSave.mail[0],
        items: [{ itemId: HIDE, count: 2, materialSources: [{ source: {}, count: 2 }] }],
      },
    ]);
    // Nothing was invented: no gatherer, no signature, on a save that had none.
    expect(signerCounts(reserialized.mail[0].items[0])).toEqual({ '-': 2 });
  });

  it('a NON-material v0.31 row round-trips byte-identically, source list and all', () => {
    // The control for the projection above: outside the material taxonomy a
    // pre-payload row is still byte-for-byte what it was, with no new key.
    const oldSave = {
      mail: [
        {
          id: 4,
          recipientKey: '9',
          recipientName: 'Rex',
          senderName: 'Old Sender',
          kind: 'player' as const,
          subject: 'old',
          body: 'plain parcel',
          copper: 5,
          items: [{ itemId: BREAD, count: 2 }],
          deliverIn: 0,
          secondsLeft: 1000,
          read: false,
          returned: false,
        },
      ],
      nextMailId: 5,
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
    const row = letter?.items[0];
    // The two halves of this case are unchanged in substance. The DISPLAY still
    // shows who signed it and still never wires charges; the signature simply
    // reaches the client in the source bucket now that the payload does not
    // carry it. `charges` staying off the wire is the security half.
    expect(signerCounts(row as SourceCarrier)).toEqual({ Sender: 1 });
    expect(row?.instance?.charges).toBeUndefined();
    expect(row?.instance?.signer).toBeUndefined();

    sim.mailTake(letter!.id, recipient);
    // The BOOK kept the full payload for the take: charges survive intact, and
    // the signature is still Sender's, counted in the bucket.
    const claimed = slotsOf(sim, recipient, HIDE)[0];
    expect(claimed.instance).toEqual({ charges: { zap: 2 } });
    expect(signerCounts(claimed)).toEqual({ Sender: 1 });
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
