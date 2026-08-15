// The COUNTERPARTY (payer/payee) side of a guild bank ledger row.
//
// THE POINT OF THIS FILE. bank_ledger used to record the RECEIVING side only,
// so a guild-side replay was self-consistent by construction and could never
// detect a mint that ends up in a player's purse: value crossing the
// purse/book boundary in one direction leaves the book side perfectly
// explicable. Every dupe this feature had was that shape, and not one of them
// was visible to scripts/bank_audit.mjs.
//
// Two halves below:
//  1. the PURE arithmetic (server/guild_bank_counterparty.ts), unit-tested
//     directly with no server at all;
//  2. the END-TO-END proof, driving the REAL GameServer + Sim through the real
//     dispatch observer with the db layer mocked, then handing the rows the
//     server actually wrote to the REAL scripts/bank_audit.mjs. A known-good
//     session must report CLEAN; a synthetic mint (the acting purse gains,
//     the book does not move) must be CAUGHT. That second test is the entire
//     reason the columns exist.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  saveCharacterState: vi.fn(async (..._args: any[]) => true),
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  saveCharacterAndGuildBankState: vi.fn(async (..._args: any[]) => true),
  // biome-ignore lint/suspicious/noExplicitAny: the hoisted double predates its typed impl
  saveCharacterAndMarketState: vi.fn(async (..._args: any[]) => true),
  // Records every row the observer wrote, in the shape Postgres hands back to
  // the audit script (snake_case), so the audit under test is the real one
  // reading the real rows rather than a fixture of what they might look like.
  rows: [] as Record<string, unknown>[],
  insertBankLedgerRow: vi.fn(async (row: Record<string, unknown>) => {
    dbMock.rows.push({
      id: dbMock.rows.length + 1,
      realm: row.realm,
      character_id: row.characterId,
      account_id: row.accountId,
      op: row.op,
      item_id: row.itemId,
      count: row.count,
      instance: row.instance ?? null,
      copper_delta: row.copperDelta,
      purchased_slots_after: row.purchasedSlotsAfter,
      container: row.container,
      container_id: row.containerId,
      counterparty_copper_delta: row.counterpartyCopperDelta,
      counterparty_count: row.counterpartyCount,
    });
  }),
  loadGuildBankRows: vi.fn(async (): Promise<unknown[]> => []),
}));

// DURABLE guild membership: the escrow carrier is chosen from
// socialDb.guildMembers (a stale session stamp must not put an ex-member on the
// quarantine-and-kick path), so this harness answers that one statement.
// Seeded by officerAtBanker alongside the session stamp.
const guildMemberRows: { id: number; rank: string }[] = [];

vi.mock('../server/db', () => ({
  pool: {
    query: vi.fn(async (text: string) =>
      text.includes('FROM guild_members gm JOIN characters c')
        ? { rows: guildMemberRows }
        : { rows: [] },
    ),
  },
  GUILD_BANK_ROW_MAX_BYTES: 262144,
  saveCharacterState: dbMock.saveCharacterState,
  saveCharacterAndGuildBankState: dbMock.saveCharacterAndGuildBankState,
  saveCharacterAndMarketState: dbMock.saveCharacterAndMarketState,
  insertBankLedgerRow: dbMock.insertBankLedgerRow,
  loadGuildBankRows: dbMock.loadGuildBankRows,
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  releaseCharacterLease: vi.fn(async () => {}),
}));

import {
  auditBank,
  type BankLedgerAuditRow,
  COUNTERPARTY_ORPHAN_OP,
} from '../scripts/bank_audit.mjs';
import {
  bankLedgerIdle,
  GUILD_BANK_COUNTERPARTY_ORPHAN_OP,
  GUILD_BANK_ESCROW_DEFICIT_OP,
  recordGuildBankDeltas,
} from '../server/bank_ledger';
import { type ClientSession, GameServer } from '../server/game';
import {
  type CounterpartyActor,
  type CounterpartyStampTarget,
  counterpartyIdle,
  counterpartyMovement,
  counterpartyOrphan,
  counterpartyOrphanEvidence,
  counterpartySnapshot,
  stampCounterpartyDeltas,
} from '../server/guild_bank_counterparty';
import {
  type GameMetricsCounters,
  type GuildBankIncident,
  noopGameMetricsCounters,
  setGameMetricsCounters,
} from '../server/http/game_signals';

// ---------------------------------------------------------------------------
// 1. The pure arithmetic.
// ---------------------------------------------------------------------------
// Every case goes through counterpartySnapshot, because that is the only way
// the movement arithmetic can be called: PlayerMeta.inventory is a live array
// the sim mutates in place, so a before/after pair holding it twice would be
// two views of ONE array and every item movement would difference to zero.
// Making the snapshot the required input is what makes that unrepresentable.
const actor = (copper: number, inventory: CounterpartyActor['inventory'] = []) =>
  counterpartySnapshot({ copper, inventory });

describe('counterpartyMovement (pure)', () => {
  it('signs copper from the ACTING CHARACTER: negative means the purse paid', () => {
    expect(counterpartyMovement(actor(5_000), actor(3_500)).copper).toBe(-1_500);
    expect(counterpartyMovement(actor(3_500), actor(5_000)).copper).toBe(1_500);
  });

  it('signs bag items the same way and reports only what actually moved', () => {
    const m = counterpartyMovement(
      actor(0, [
        { itemId: 'wolf_fang', count: 7 },
        { itemId: 'copper_ore', count: 3 },
      ]),
      actor(0, [
        { itemId: 'wolf_fang', count: 4 },
        { itemId: 'copper_ore', count: 3 },
      ]),
    );
    expect(m.items.get('wolf_fang')).toBe(-3);
    // copper_ore did not move, so it is absent rather than present as a zero:
    // the movement map is the set of things that changed.
    expect(m.items.has('copper_ore')).toBe(false);
  });

  it('sums duplicate stacks of one id before differencing them', () => {
    const m = counterpartyMovement(
      actor(0, [
        { itemId: 'wolf_fang', count: 2 },
        { itemId: 'wolf_fang', count: 5, instance: { signer: 'A' } },
      ]),
      actor(0, [{ itemId: 'wolf_fang', count: 2 }]),
    );
    // Keyed by ITEM ID alone: an instanced stack and a plain one are one
    // quantity here, because the book side's projected payload need not match
    // the bags side's raw one and a mismatched key would read as a phantom.
    expect(m.items.get('wolf_fang')).toBe(-5);
  });

  it('a missing snapshot on either side is a RECORDED ZERO, not an unknown', () => {
    // The operator purge path: nobody's purse or bags took part in it. A zero
    // is what lets the audit check the op; a null would make it skip.
    expect(counterpartyMovement(null, null)).toEqual({ copper: 0, items: new Map() });
    expect(counterpartyIdle(counterpartyMovement(null, actor(9_999)))).toBe(true);
    expect(counterpartyIdle(counterpartyMovement(actor(1), null))).toBe(true);
  });

  it('counterpartyIdle is false as soon as anything moved', () => {
    expect(counterpartyIdle(counterpartyMovement(actor(10), actor(10)))).toBe(true);
    expect(counterpartyIdle(counterpartyMovement(actor(10), actor(11)))).toBe(false);
    expect(
      counterpartyIdle(
        counterpartyMovement(actor(10), actor(10, [{ itemId: 'wolf_fang', count: 1 }])),
      ),
    ).toBe(false);
  });
});

describe('stampCounterpartyDeltas (pure)', () => {
  it('stamps a copper op onto its single delta', () => {
    const deltas: CounterpartyStampTarget[] = [{ itemId: null }];
    stampCounterpartyDeltas(deltas, counterpartyMovement(actor(5_000), actor(3_500)));
    expect(deltas[0]).toEqual({
      itemId: null,
      counterpartyCopperDelta: -1_500,
      counterpartyCount: 0,
    });
  });

  it('stamps an item op with the bags movement for THAT row s item id', () => {
    const deltas: CounterpartyStampTarget[] = [{ itemId: 'wolf_fang' }];
    stampCounterpartyDeltas(
      deltas,
      counterpartyMovement(actor(0, [{ itemId: 'wolf_fang', count: 9 }]), actor(0, [])),
    );
    expect(deltas[0]).toMatchObject({ counterpartyCopperDelta: 0, counterpartyCount: -9 });
  });

  it('RETURNS the undrained remainder rather than dropping it', () => {
    // Movement no delta claimed balances every written row by construction and
    // would leave no trace at all: the same invisible purse/book crossing this
    // feature exists to surface, arriving from the other side. The caller gives
    // it the orphan treatment, so the stamp must hand it back.
    const deltas: CounterpartyStampTarget[] = [{ itemId: 'wolf_fang' }];
    const left = stampCounterpartyDeltas(
      deltas,
      counterpartyMovement(
        actor(0, [{ itemId: 'wolf_fang', count: 4 }]),
        actor(0, [{ itemId: 'copper_ore', count: 9 }]),
      ),
    );
    expect(deltas[0].counterpartyCount).toBe(-4);
    expect([...left.items.entries()]).toEqual([['copper_ore', 9]]);
    expect(counterpartyIdle(left)).toBe(false);
  });

  it('returns an IDLE remainder when every movement was claimed', () => {
    const deltas: CounterpartyStampTarget[] = [{ itemId: 'wolf_fang' }];
    const left = stampCounterpartyDeltas(
      deltas,
      counterpartyMovement(actor(500, [{ itemId: 'wolf_fang', count: 4 }]), actor(200, [])),
    );
    expect(counterpartyIdle(left)).toBe(true);
  });

  it('DRAINS the movement, so two rows can never book one purse movement twice', () => {
    // A guild op produces exactly one delta in practice; the drain is what
    // makes a future multi-key op unable to report a doubled mint.
    const deltas: CounterpartyStampTarget[] = [
      { itemId: null },
      { itemId: 'wolf_fang' },
      { itemId: 'wolf_fang' },
    ];
    stampCounterpartyDeltas(
      deltas,
      counterpartyMovement(
        actor(1_000, [{ itemId: 'wolf_fang', count: 6 }]),
        actor(400, [{ itemId: 'wolf_fang', count: 2 }]),
      ),
    );
    const copper = deltas.map((d) => d.counterpartyCopperDelta ?? 0);
    const counts = deltas.map((d) => d.counterpartyCount ?? 0);
    expect(copper).toEqual([-600, 0, 0]);
    expect(counts).toEqual([0, -4, 0]);
    // The stamped numbers sum to exactly what moved: nothing invented, nothing
    // double-booked.
    expect(copper.reduce((a, b) => a + b, 0)).toBe(-600);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(-4);
  });

  it('a second row for one item id gets ZERO, not the movement again', () => {
    const deltas: CounterpartyStampTarget[] = [{ itemId: 'wolf_fang' }, { itemId: 'wolf_fang' }];
    const left = stampCounterpartyDeltas(
      deltas,
      counterpartyMovement(actor(0, [{ itemId: 'wolf_fang', count: 6 }]), actor(0, [])),
    );
    expect(deltas.map((d) => d.counterpartyCount)).toEqual([-6, 0]);
    expect(counterpartyIdle(left)).toBe(true);
  });

  it('always stamps NUMBERS, so a null column can only mean pre-feature', () => {
    const deltas: CounterpartyStampTarget[] = [{ itemId: 'copper_ore' }];
    stampCounterpartyDeltas(deltas, counterpartyMovement(actor(0, []), actor(0, [])));
    expect(deltas[0]).toEqual({
      itemId: 'copper_ore',
      counterpartyCopperDelta: 0,
      counterpartyCount: 0,
    });
  });
});

describe('counterpartyOrphan (pure)', () => {
  it('is null when nothing moved', () => {
    expect(counterpartyOrphan(counterpartyMovement(actor(7), actor(7)))).toBeNull();
  });

  it('names the copper movement, and the lowest moved item id, deterministically', () => {
    const m = counterpartyMovement(
      actor(0, []),
      actor(250, [
        { itemId: 'wolf_fang', count: 1 },
        { itemId: 'copper_ore', count: 2 },
      ]),
    );
    expect(counterpartyOrphan(m)).toEqual({ itemId: 'copper_ore', count: 2, copperDelta: 250 });
    // The whole movement rides the evidence payload, so a multi-item orphan is
    // reported in full even though the row's own count names one id.
    expect(counterpartyOrphanEvidence('withdraw', m)).toEqual({
      attemptedOp: 'withdraw',
      copper: 250,
      items: { copper_ore: 2, wolf_fang: 1 },
    });
  });
});

// ---------------------------------------------------------------------------
// 2. The end-to-end proof, against the REAL server and the REAL audit script.
// ---------------------------------------------------------------------------
const GUILD_ID = 913;
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'];

// biome-ignore lint/suspicious/noExplicitAny: the tests span private seams (dispatch, runGuildBankOp)
const priv = (server: GameServer): any => server as any;

function fakeWs(): unknown {
  return { readyState: 1, send: () => {}, close: () => {}, terminate: () => {} };
}

function officerAtBanker(server: GameServer, characterId: number, name: string): ClientSession {
  const session = server.join(fakeWs() as never, characterId, characterId, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  let banker = null;
  for (const e of server.sim.entities.values()) {
    if (e.kind === 'npc' && BANKERS.includes(e.templateId ?? '')) banker = e;
  }
  if (!banker) throw new Error('no banker NPC spawned in the server world');
  const p = server.sim.entities.get(session.pid);
  if (!p) throw new Error('missing player entity');
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  server.sim.rebucket(p);
  server.sim.setPlayerGuildMembership(session.pid, { guildId: GUILD_ID, rank: 'officer' });
  guildMemberRows.push({ id: characterId, rank: 'officer' });
  return session;
}

const dispatch = (server: GameServer, session: ClientSession, msg: Record<string, unknown>) =>
  priv(server).dispatchMessage(session, { t: 'cmd', ...msg }, JSON.stringify(msg), 0);

/** The rows the observer wrote, as the audit script reads them. */
const ledgerRows = () => dbMock.rows as unknown as BankLedgerAuditRow[];

/** Hand the server's own rows and its own live book to the REAL audit. */
function audit(server: GameServer) {
  return auditBank({
    ledgerRows: ledgerRows(),
    characters: [],
    guildBanks: [
      { guild_id: GUILD_ID, realm: 'Claudemoon', data: server.sim.serializeGuildBank(GUILD_ID) },
    ],
  });
}

beforeEach(() => {
  guildMemberRows.length = 0;
  dbMock.rows.length = 0;
  dbMock.insertBankLedgerRow.mockClear();
  dbMock.loadGuildBankRows.mockResolvedValue([]);
  setGameMetricsCounters(noopGameMetricsCounters);
});

describe('the counterparty side, end to end through the dispatch observer', () => {
  it('replays a known-good session and reports CLEAN, with both halves recorded', async () => {
    const server = new GameServer();
    const session = officerAtBanker(server, 1, 'Officer1');
    server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 500_000;
    server.sim.addItem('wolf_fang', 9, session.pid, { silent: true });

    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 40_000 });
    dispatch(server, session, { cmd: 'guild_bank_withdraw_gold', amount: 15_000 });
    const slot = meta.inventory.findIndex((s) => s.itemId === 'wolf_fang');
    dispatch(server, session, { cmd: 'guild_bank_deposit', slot, count: 4 });
    const bookSlot = (server.sim.guildBanks.get(GUILD_ID)?.inventory ?? []).findIndex(
      (s) => s.itemId === 'wolf_fang',
    );
    dispatch(server, session, { cmd: 'guild_bank_withdraw', slot: bookSlot, count: 1 });
    dispatch(server, session, { cmd: 'guild_bank_buy_slots' });
    await bankLedgerIdle();

    // Every guild row carries BOTH halves, and each one balances.
    const ops = ledgerRows().map((r) => r.op);
    expect(ops).toEqual(['deposit_gold', 'withdraw_gold', 'deposit', 'withdraw', 'buy_slots']);
    for (const row of ledgerRows()) {
      expect(`${row.op}:${row.counterparty_copper_delta}`).not.toBe(`${row.op}:undefined`);
      expect(`${row.op}:${row.counterparty_count}`).not.toBe(`${row.op}:undefined`);
    }
    // Each op's two halves, spelled out: the purse is the mirror of the
    // treasury, the bags are the mirror of the book, and a treasury-paid
    // expansion moves the purse not at all.
    expect(ledgerRows().map((r) => [r.op, r.copper_delta, r.counterparty_copper_delta])).toEqual([
      ['deposit_gold', 40_000, -40_000],
      ['withdraw_gold', -15_000, 15_000],
      ['deposit', 0, 0],
      ['withdraw', 0, 0],
      ['buy_slots', -25_000, 0],
    ]);
    expect(ledgerRows().map((r) => [r.op, r.count, r.counterparty_count])).toEqual([
      ['deposit_gold', null, 0],
      ['withdraw_gold', null, 0],
      ['deposit', 4, -4],
      ['withdraw', 1, 1],
      ['buy_slots', null, 0],
    ]);

    expect(audit(server)).toEqual([]);
  });

  it('CATCHES a synthetic mint: the acting purse gains, the book does not move', async () => {
    // The failure mode the whole slice exists for, produced through the REAL
    // observer rather than as a hand-written fixture: runGuildBankOp is handed
    // a mutation that credits the acting character's purse and leaves the book
    // alone, which is exactly what a dupe in a withdraw path looks like.
    // Before the counterparty side, the book diff was empty, NO row was
    // written, and the audit replayed a perfectly self-consistent book forever.
    const server = new GameServer();
    const session = officerAtBanker(server, 1, 'Officer1');
    server.sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 500_000;

    // A legitimate op first, so the ledger is not trivially one anomaly row.
    dispatch(server, session, { cmd: 'guild_bank_deposit_gold', amount: 40_000 });

    const kinds: GuildBankIncident[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      guildBankIncident: (kind: GuildBankIncident) => kinds.push(kind),
    } as GameMetricsCounters);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    priv(server).runGuildBankOp(session, { pid: session.pid }, 'withdraw_gold', () => {
      meta.copper += 12_345; // the mint: purse up, book untouched
    });
    errSpy.mockRestore();
    await bankLedgerIdle();

    // The op wrote its own anomaly row instead of nothing at all.
    const orphans = ledgerRows().filter((r) => r.op === COUNTERPARTY_ORPHAN_OP);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      container: 'guild',
      container_id: GUILD_ID,
      copper_delta: 0, // the book moved nothing, which is the whole problem
      counterparty_copper_delta: 12_345,
    });
    expect(orphans[0].instance).toEqual({
      attemptedOp: 'withdraw_gold',
      copper: 12_345,
      items: {},
    });
    // And it is alertable in production, not only auditable offline.
    expect(kinds).toEqual(['counterparty_orphan']);

    // THE ACCEPTANCE LINE: the real audit script reports the mint.
    const findings = audit(server);
    expect(findings.map((f) => f.kind)).toContain('counterparty_orphan');
    expect(findings.find((f) => f.kind === 'counterparty_orphan')?.detail).toContain(
      '12345 copper',
    );

    // The CONTROL. Strip the counterparty columns from every row (which is
    // exactly the ledger this audit had before this slice) and the SAME mint
    // goes completely quiet: the book still reconciles against the ledger,
    // because the book is not where the value went. That is the structural
    // gap, demonstrated rather than asserted.
    const withoutCounterparty = ledgerRows()
      .filter((r) => r.op !== COUNTERPARTY_ORPHAN_OP)
      .map((r) => ({
        ...r,
        counterparty_copper_delta: null,
        counterparty_count: null,
      }));
    expect(
      auditBank({
        ledgerRows: withoutCounterparty,
        characters: [],
        guildBanks: [
          {
            guild_id: GUILD_ID,
            realm: 'Claudemoon',
            data: server.sim.serializeGuildBank(GUILD_ID),
          },
        ],
      }),
    ).toEqual([]);
  });

  it('CATCHES a partial mint: the book moves, but not by what the purse got', async () => {
    // The other half of the failure family, and the one the orphan row cannot
    // cover: the book DID move, so an ordinary row is written, but the two
    // sides disagree. Only the per-op balance identity sees it.
    const server = new GameServer();
    const session = officerAtBanker(server, 1, 'Officer1');
    server.sim.loadGuildBank(GUILD_ID, { treasury: 100_000, inventory: [], purchasedSlots: 24 });
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 500_000;

    priv(server).runGuildBankOp(session, { pid: session.pid }, 'withdraw_gold', () => {
      const book = server.sim.guildBanks.get(GUILD_ID);
      if (!book) throw new Error('missing book');
      book.treasury -= 1_000; // the book gave up 1_000 ...
      meta.copper += 4_000; // ... and the purse received 4_000
    });
    await bankLedgerIdle();

    const row = ledgerRows().find((r) => r.op === 'withdraw_gold');
    expect(row).toMatchObject({ copper_delta: -1_000, counterparty_copper_delta: 4_000 });
    const findings = audit(server);
    const imbalance = findings.find((f) => f.kind === 'counterparty_copper_imbalance');
    expect(imbalance?.detail).toContain('3000 MINTED');

    // CONTROL: with the counterparty side stripped, the imbalance vanishes and
    // only the pre-existing book-side finding (the treasury replay disagreeing
    // with the book) remains, which says nothing about where the copper went.
    const stripped = auditBank({
      ledgerRows: ledgerRows().map((r) => ({
        ...r,
        counterparty_copper_delta: null,
        counterparty_count: null,
      })),
      characters: [],
      guildBanks: [
        { guild_id: GUILD_ID, realm: 'Claudemoon', data: server.sim.serializeGuildBank(GUILD_ID) },
      ],
    });
    expect(stripped.map((f) => f.kind)).not.toContain('counterparty_copper_imbalance');
  });

  it('CATCHES an item mint: bags gain copies the book never gave up', async () => {
    const server = new GameServer();
    const session = officerAtBanker(server, 1, 'Officer1');
    server.sim.loadGuildBank(GUILD_ID, {
      treasury: 0,
      inventory: [{ itemId: 'wolf_fang', count: 5 }],
      purchasedSlots: 24,
    });
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 500_000;

    priv(server).runGuildBankOp(session, { pid: session.pid }, 'withdraw', () => {
      const book = server.sim.guildBanks.get(GUILD_ID);
      if (!book) throw new Error('missing book');
      book.inventory[0].count -= 1; // the book lost one ...
      server.sim.addItem('wolf_fang', 3, session.pid, { silent: true }); // ... bags gained three
    });
    await bankLedgerIdle();

    const row = ledgerRows().find((r) => r.op === 'withdraw');
    expect(row).toMatchObject({ count: 1, counterparty_count: 3 });
    const findings = audit(server);
    expect(findings.find((f) => f.kind === 'counterparty_item_imbalance')?.detail).toContain(
      '2 MINTED',
    );
  });

  it('the operator purge balances against its own destruction term', async () => {
    // admin_purge has no counterparty at all: the copy is destroyed, not
    // handed over. Recording a ZERO (rather than leaving the columns null) is
    // what lets the audit check a purge instead of skipping it, and the
    // destruction term is what makes it balance.
    const server = new GameServer();
    const session = officerAtBanker(server, 1, 'Officer1');
    server.sim.loadGuildBank(GUILD_ID, {
      treasury: 0,
      // A copy the anonymous-pipe policy refuses in BOTH directions (a bound
      // per-copy transfer lock), which is exactly what the escape hatch is for.
      inventory: [{ itemId: 'wolf_fang', count: 2, instance: { boundTo: 'Someone' } }],
      purchasedSlots: 24,
    });
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 500_000;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await server.adminPurgeGuildBankSlot(GUILD_ID, 0, 'wolf_fang', 4242);
    warnSpy.mockRestore();
    expect(result.ok).toBe(true);
    await bankLedgerIdle();

    const row = ledgerRows().find((r) => r.op === 'admin_purge');
    expect(row).toMatchObject({ count: 2, counterparty_count: 0, counterparty_copper_delta: 0 });
    // The book lost 2, nobody received them, 2 were destroyed: it balances.
    expect(audit(server).filter((f) => f.kind.startsWith('counterparty_'))).toEqual([]);
  });

  it('CATCHES bags moving under an id no ledger row names (the leftover arm)', async () => {
    // The book moved, so an ordinary row IS written and it balances by
    // construction. Only the undrained remainder reveals the extra movement.
    const server = new GameServer();
    const session = officerAtBanker(server, 1, 'Officer1');
    server.sim.loadGuildBank(GUILD_ID, {
      treasury: 0,
      inventory: [{ itemId: 'wolf_fang', count: 5 }],
      purchasedSlots: 24,
    });
    const meta = server.sim.players.get(session.pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = 500_000;

    const kinds: GuildBankIncident[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      guildBankIncident: (kind: GuildBankIncident) => kinds.push(kind),
    } as GameMetricsCounters);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    priv(server).runGuildBankOp(session, { pid: session.pid }, 'withdraw', () => {
      const book = server.sim.guildBanks.get(GUILD_ID);
      if (!book) throw new Error('missing book');
      book.inventory[0].count -= 1;
      server.sim.addItem('wolf_fang', 1, session.pid, { silent: true }); // the honest half
      server.sim.addItem('copper_ore', 8, session.pid, { silent: true }); // the mint
    });
    errSpy.mockRestore();
    await bankLedgerIdle();

    // The withdraw row itself balances: 1 out of the book, 1 into the bags.
    const withdrawRow = ledgerRows().find((r) => r.op === 'withdraw');
    expect(withdrawRow).toMatchObject({ count: 1, counterparty_count: 1 });
    // The copper_ore that appeared from nowhere is the orphan.
    const orphan = ledgerRows().find((r) => r.op === COUNTERPARTY_ORPHAN_OP);
    expect(orphan).toMatchObject({ item_id: 'copper_ore', counterparty_count: 8 });
    expect(kinds).toEqual(['counterparty_orphan']);
    expect(audit(server).map((f) => f.kind)).toContain('counterparty_orphan');
  });

  it('COUNTS a guild row written with no counterparty side at all', async () => {
    // The nullable design rests on "NULL means pre-feature". Nothing in the
    // schema enforces it, so a write site that forgets to stamp must be loud at
    // write time rather than invisible in a keep-forever table forever after.
    const kinds: GuildBankIncident[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      guildBankIncident: (kind: GuildBankIncident) => kinds.push(kind),
    } as GameMetricsCounters);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    recordGuildBankDeltas('deposit_gold', { characterId: 1, accountId: 1 }, GUILD_ID, [
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: 1_500,
        purchasedSlotsBefore: 24,
        purchasedSlotsAfter: 24,
      },
    ]);
    await bankLedgerIdle();
    // Read the spy BEFORE restoring it: mockRestore drops the call record.
    const loggedLoudly = errSpy.mock.calls.length > 0;
    errSpy.mockRestore();
    expect(kinds).toEqual(['counterparty_unstamped']);
    // The counter sits BESIDE the log, never instead of it.
    expect(loggedLoudly).toBe(true);
    // A STAMPED delta is silent, including one stamped with recorded zeros.
    kinds.length = 0;
    recordGuildBankDeltas('admin_purge', { characterId: 1, accountId: 1 }, GUILD_ID, [
      {
        itemId: 'wolf_fang',
        count: 1,
        instance: null,
        copperDelta: 0,
        purchasedSlotsBefore: 24,
        purchasedSlotsAfter: 24,
        counterpartyCopperDelta: 0,
        counterpartyCount: 0,
      },
    ]);
    await bankLedgerIdle();
    expect(kinds).toEqual([]);
  });

  it('the two anomaly op names are pinned in lockstep with the audit script', () => {
    // The .mjs stays dependency-free of the TS server, so the literals are
    // declared twice; a rename on one side must break here rather than
    // silently stop reporting a whole anomaly class.
    expect(COUNTERPARTY_ORPHAN_OP).toBe(GUILD_BANK_COUNTERPARTY_ORPHAN_OP);
    expect(GUILD_BANK_ESCROW_DEFICIT_OP).toBe('escrow_deficit');
    expect(GUILD_BANK_COUNTERPARTY_ORPHAN_OP).toBe('counterparty_orphan');
  });
});
