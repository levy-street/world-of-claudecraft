import { beforeEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import), so GameServer runs
// with no live DB. Live commands stage immutable batches in the session journal
// until saveCharacter commits the character snapshot and ledger effects through
// one mocked transaction call; direct legacy recorder tests keep their insert spies.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => true),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
}));

import {
  BANK_LEDGER_TAIL_MAX_DEPTH,
  BANK_LEDGER_TAIL_MAX_ROWS,
  bankLedgerIdle,
  bankLedgerTailStats,
  diffBankOp,
  diffBankSocketOp,
  recordBankOp,
  resetBankLedgerTailDropLogForTests,
} from '../server/bank_ledger';
import { BankLedgerGrowthLimitExceeded } from '../server/bank_ledger_growth_budget';
import { insertBankLedgerRow, insertBankLedgerRows, saveCharacterState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { REALM } from '../server/realm';
import type { BankInfo, VaultInfo } from '../src/world_api';

const insertMock = vi.mocked(insertBankLedgerRow);
const saveCharacterMock = vi.mocked(saveCharacterState);
// The vault observer writes through the BATCHED sibling (one insert per op,
// however many materials the diff produced); the personal bank and guild arms
// stay on the single-row writer above.
const insertRowsMock = vi.mocked(insertBankLedgerRows);

interface LedgerBatchView {
  readonly rows: readonly Record<string, unknown>[];
}

/** Decode the journal's canonical instanceJson representation back into the
 *  public row shape these assertions predate. Null optional counterparty
 *  fields are omitted exactly like the old personal/vault recorders. */
function decodedLedgerRows(batches: readonly LedgerBatchView[]): Record<string, unknown>[] {
  return batches
    .flatMap((batch) => batch.rows)
    .map((row) => {
      const { instanceJson, counterpartyCopperDelta, counterpartyCount, ...plain } = row;
      return {
        ...plain,
        instance:
          instanceJson === null || instanceJson === undefined
            ? null
            : JSON.parse(String(instanceJson)),
        ...(counterpartyCopperDelta == null ? {} : { counterpartyCopperDelta }),
        ...(counterpartyCount == null ? {} : { counterpartyCount }),
      };
    });
}

function queuedLedgerRows(session: ClientSession): Record<string, unknown>[] {
  return decodedLedgerRows(session.bankLedgerJournal.outbox.snapshot().batches);
}

// A BankInfo with the given slots; capacity/nextExpansionCost are set for realism
// but diffBankOp only reads slots, purchasedSlots, and (for buy) nextExpansionCost.
function info(
  slots: BankInfo['slots'],
  purchasedSlots = 0,
  nextExpansionCost: number | null = 500,
): BankInfo {
  return {
    slots,
    capacity: 24 + purchasedSlots,
    purchasedSlots,
    bonusSlots: 0,
    nextExpansionCost,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1000000,
    generalCapacity: 24 + purchasedSlots,
    materialsCapacity: 0,
    generalUsed: slots.length,
    materialsUsed: 0,
  };
}

describe('diffBankOp (pure)', () => {
  it('a deposit of a new stack yields the deposited count', () => {
    expect(diffBankOp('deposit', info([]), info([{ itemId: 'wolf_fang', count: 3 }]))).toEqual([
      { itemId: 'wolf_fang', count: 3, instance: null, copperDelta: 0, purchasedSlotsAfter: 0 },
    ]);
  });

  it('a deposit merging into an existing stack records the MOVED amount, not the total', () => {
    // before 2, after 5: the ledger records the delta 3 (what moved), never 5.
    // Conservation replay depends on this: an earlier deposit of 2 plus this 3 nets
    // to the resulting 5, whereas recording 5 here would over-count to 7.
    expect(
      diffBankOp(
        'deposit',
        info([{ itemId: 'wolf_fang', count: 2 }]),
        info([{ itemId: 'wolf_fang', count: 5 }]),
      ),
    ).toEqual([
      { itemId: 'wolf_fang', count: 3, instance: null, copperDelta: 0, purchasedSlotsAfter: 0 },
    ]);
  });

  it('a partial withdraw records the withdrawn count', () => {
    expect(
      diffBankOp(
        'withdraw',
        info([{ itemId: 'wolf_fang', count: 5 }]),
        info([{ itemId: 'wolf_fang', count: 3 }]),
      ),
    ).toEqual([
      { itemId: 'wolf_fang', count: 2, instance: null, copperDelta: 0, purchasedSlotsAfter: 0 },
    ]);
  });

  it('an instanced deposit carries the instance payload with count 1', () => {
    const instance = { signer: 'Vaulta', rolled: { quality: 'rare' } };
    expect(
      diffBankOp('deposit', info([]), info([{ itemId: 'signed_blade', count: 1, instance }])),
    ).toEqual([
      { itemId: 'signed_blade', count: 1, instance, copperDelta: 0, purchasedSlotsAfter: 0 },
    ]);
  });

  it('a buy_slots yields one row: negated BEFORE price, item fields null', () => {
    // The first expansion price is 500 (src/sim/bank.ts BANK_EXPANSION_PRICES), read
    // off the BEFORE snapshot; after.purchasedSlots is the new 6.
    expect(diffBankOp('buy_slots', info([], 0, 500), info([], 6, 1000))).toEqual([
      { itemId: null, count: null, instance: null, copperDelta: -500, purchasedSlotsAfter: 6 },
    ]);
  });

  it('identical snapshots (a refused/no-op call) yield no rows', () => {
    const slots = [{ itemId: 'wolf_fang', count: 4 }];
    expect(diffBankOp('deposit', info(slots), info(slots))).toEqual([]);
    expect(diffBankOp('withdraw', info(slots), info(slots))).toEqual([]);
    // A buy that did not raise purchasedSlots is also a no-op.
    expect(diffBankOp('buy_slots', info([], 6, 1000), info([], 6, 1000))).toEqual([]);
  });

  it('a null snapshot on either side (away from a banker) yields no rows', () => {
    expect(diffBankOp('deposit', null, info([{ itemId: 'wolf_fang', count: 1 }]))).toEqual([]);
    expect(diffBankOp('withdraw', info([{ itemId: 'wolf_fang', count: 1 }]), null)).toEqual([]);
    expect(diffBankOp('buy_slots', null, null)).toEqual([]);
  });
});

// A BankInfo with the socket dimensions parameterized; the slot dimensions stay
// at info([])'s defaults so a socket diff can never be confused with a slot one.
function sinfo(o: Partial<BankInfo>): BankInfo {
  return { ...info([]), ...o };
}

describe('diffBankSocketOp (pure)', () => {
  it('an unlock yields one copper row at the negated BEFORE price', () => {
    // purchasedSlots 6 proves purchasedSlotsAfter is the BYSTANDER slot-ladder
    // stamp (the audit monotonicity contract), never the new socket count 1.
    expect(
      diffBankSocketOp(
        sinfo({ socketsUnlocked: 0, nextSocketCost: 1000000, purchasedSlots: 6 }),
        sinfo({ socketsUnlocked: 1, nextSocketCost: 2000000, purchasedSlots: 6 }),
      ),
    ).toEqual([
      {
        op: 'unlock_socket',
        delta: {
          itemId: null,
          count: null,
          instance: null,
          copperDelta: -1000000,
          purchasedSlotsAfter: 6,
        },
      },
    ]);
  });

  it('socketing into an empty socket yields one socket_bag row', () => {
    expect(
      diffBankSocketOp(
        sinfo({ socketsUnlocked: 1, socketBags: [null, null, null, null] }),
        sinfo({ socketsUnlocked: 1, socketBags: ['linen_pouch', null, null, null] }),
      ),
    ).toEqual([
      {
        op: 'socket_bag',
        delta: {
          itemId: 'linen_pouch',
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsAfter: 0,
        },
      },
    ]);
  });

  it('a swap yields exactly its two rows, the displaced bag FIRST', () => {
    // Unsocket-before-socket within the index keeps the audit replay's running
    // socket net from dipping below zero on a legitimate history.
    expect(
      diffBankSocketOp(
        sinfo({ socketsUnlocked: 1, socketBags: ['linen_pouch', null, null, null] }),
        sinfo({ socketsUnlocked: 1, socketBags: ['burlap_reagent_pouch', null, null, null] }),
      ),
    ).toEqual([
      {
        op: 'unsocket_bag',
        delta: {
          itemId: 'linen_pouch',
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsAfter: 0,
        },
      },
      {
        op: 'socket_bag',
        delta: {
          itemId: 'burlap_reagent_pouch',
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsAfter: 0,
        },
      },
    ]);
  });

  it('an unsocket yields one unsocket_bag row', () => {
    expect(
      diffBankSocketOp(
        sinfo({ socketsUnlocked: 1, socketBags: ['linen_pouch', null, null, null] }),
        sinfo({ socketsUnlocked: 1, socketBags: [null, null, null, null] }),
      ),
    ).toEqual([
      {
        op: 'unsocket_bag',
        delta: {
          itemId: 'linen_pouch',
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsAfter: 0,
        },
      },
    ]);
  });

  it('identical snapshots (a refusal, or a same-bag-id swap) yield no rows', () => {
    const held = sinfo({ socketsUnlocked: 2, socketBags: ['linen_pouch', null, null, null] });
    expect(diffBankSocketOp(held, sinfo({ ...held }))).toEqual([]);
  });

  it('a null snapshot on either side yields no rows', () => {
    expect(diffBankSocketOp(null, sinfo({ socketsUnlocked: 1 }))).toEqual([]);
    expect(diffBankSocketOp(sinfo({ socketsUnlocked: 1 }), null)).toEqual([]);
  });

  it('pins the structural ceiling: a hand-built every-index diff yields 4 + 4 + 1 rows', () => {
    // The loop is bounded by the socket count, so the differ's TRUE ceiling is
    // one unsocket plus one socket per index plus the unlock row: 9 for a
    // four-socket bank. Only the sim's one-index-per-command rule makes the
    // real per-command bound 2; a future bulk verb (a socket sort, a bag-set
    // swap) would ride this ceiling and must re-price the retention header
    // (the write-volume rule). This pin is what makes that ceiling explicit
    // rather than an accident of today's commands.
    const rows = diffBankSocketOp(
      sinfo({
        socketsUnlocked: 3,
        socketBags: ['a', 'b', 'c', 'd'],
        nextSocketCost: 5000000,
      }),
      sinfo({
        socketsUnlocked: 4,
        socketBags: ['e', 'f', 'g', 'h'],
        nextSocketCost: null,
      }),
    );
    expect(rows).toHaveLength(9);
    expect(rows.filter((r) => r.op === 'unlock_socket')).toHaveLength(1);
    expect(rows.filter((r) => r.op === 'unsocket_bag')).toHaveLength(4);
    expect(rows.filter((r) => r.op === 'socket_bag')).toHaveLength(4);
  });
});

// ── GameServer dispatch integration ───────────────────────────────────────────

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}

// Distinct accountId (7) and characterId (42) so a swapped-field bug in the row
// mapping is caught (equal ids would hide it).
function joinLedger(server: GameServer, fw: ReturnType<typeof fakeWs>, name: string) {
  const s = server.join(fw.ws as any, 7, 42, name, 'warrior', null) as any;
  if ('error' in s) throw new Error(s.error);
  s.blockListLoaded = true;
  return s;
}

function send(server: GameServer, session: any, msg: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
}

function bringBankerToPlayer(sim: any, pid: number): any {
  const banker = sim.entities.get(sim.bankerIds[0]);
  const p = sim.entities.get(pid);
  banker.pos = { ...p.pos };
  banker.prevPos = { ...banker.pos };
  return banker;
}

function wolfFangIndex(sim: any, pid: number): number {
  return sim.players.get(pid).inventory.findIndex((s: any) => s.itemId === 'wolf_fang');
}

describe('bank ledger dispatch integration', () => {
  beforeEach(async () => {
    // Drain direct-recorder work from a prior test. Live GameServer commands do
    // not touch that FIFO: they stay in the character-owned journal until save.
    await bankLedgerIdle();
    insertMock.mockClear();
    insertRowsMock.mockClear();
    saveCharacterMock.mockReset();
    saveCharacterMock.mockResolvedValue(true);
  });

  it('deposit, withdraw, and buy stage exact rows until the matching character snapshot commits', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinLedger(server, fw, 'Ledgera');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.addItem('wolf_fang', 5, pid);

    // 1) deposit 2 of 5: one queued deposit row, count 2, no copper, 0 purchased slots.
    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 2 });
    expect(queuedLedgerRows(s)).toEqual([
      {
        realm: REALM,
        characterId: 42,
        accountId: 7,
        op: 'deposit',
        itemId: 'wolf_fang',
        count: 2,
        instance: null,
        copperDelta: 0,
        purchasedSlotsAfter: 0,
        container: 'personal',
        containerId: null,
      },
    ]);

    // 2) withdraw 1: a second immutable command batch follows the deposit.
    send(server, s, { cmd: 'bank_withdraw', slot: 0, count: 1 });
    expect(queuedLedgerRows(s)[1]).toEqual({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'withdraw',
      itemId: 'wolf_fang',
      count: 1,
      instance: null,
      copperDelta: 0,
      purchasedSlotsAfter: 0,
      container: 'personal',
      containerId: null,
    });

    // 3) buy the first expansion: one buy_slots row, copperDelta -500, +6
    // slots, stamped with the gold rail (Bank Storage phase 11 paid-with).
    sim.players.get(pid).copper = 1000;
    send(server, s, { cmd: 'bank_buy_slots' });
    expect(queuedLedgerRows(s)[2]).toEqual({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: { paidWith: 'gold' },
      copperDelta: -500,
      purchasedSlotsAfter: 6,
      container: 'personal',
      containerId: null,
    });

    // No legacy insert can race ahead of the character blob. The one save call
    // receives the final blob and the exact three-batch prefix together.
    expect(insertMock).not.toHaveBeenCalled();
    expect(insertRowsMock).not.toHaveBeenCalled();
    expect(saveCharacterMock).not.toHaveBeenCalled();
    const snapshot = s.bankLedgerJournal.outbox.snapshot();
    expect(snapshot.batches).toHaveLength(3);
    await expect(server.saveCharacter(s)).resolves.toBe(true);
    expect(saveCharacterMock).toHaveBeenCalledTimes(1);
    const saveCall = saveCharacterMock.mock.calls[0];
    expect(saveCall[2]).toMatchObject({
      bank: {
        inventory: [{ itemId: 'wolf_fang', count: 1 }],
        purchasedSlots: 6,
      },
    });
    expect(saveCall[5]).toEqual({ owner: snapshot.owner, batches: snapshot.batches });
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
  });

  it('the socket trio retains bounded command batches: unlock one, socket one, swap two, refusals zero', async () => {
    // A swap's two rows share one immutable command batch, so the eventual
    // character transaction can never commit half of it.
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinLedger(server, fw, 'Ledgersock');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    const meta = sim.players.get(pid);
    meta.copper = 1000000; // exactly the first socket price (src/sim/bank.ts)
    sim.addItem('linen_pouch', 1, pid);
    sim.addItem('burlap_reagent_pouch', 1, pid);

    // 1) the unlock: ONE retained batch of ONE copper-only row at the negated table
    // price, with the slot-ladder bystander stamp (purchasedSlots is 0 here).
    send(server, s, { cmd: 'bank_unlock_socket' });
    expect(s.bankLedgerJournal.outbox.snapshot().batches).toHaveLength(1);
    expect(queuedLedgerRows(s)).toEqual([
      {
        realm: REALM,
        characterId: 42,
        accountId: 7,
        op: 'unlock_socket',
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -1000000,
        purchasedSlotsAfter: 0,
        container: 'personal',
        containerId: null,
      },
    ]);

    // 2) socketing a carried bag: ONE more batch of ONE socket_bag row.
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch' });
    expect(s.bankLedgerJournal.outbox.snapshot().batches).toHaveLength(2);
    expect(queuedLedgerRows(s)[1]).toMatchObject({
      op: 'socket_bag',
      itemId: 'linen_pouch',
      count: 1,
      copperDelta: 0,
      container: 'personal',
    });

    // 3) a swap into the occupied socket 0: ONE batch of exactly TWO rows,
    // the displaced bag's unsocket_bag first, then the incoming socket_bag.
    send(server, s, { cmd: 'bank_socket_bag', item: 'burlap_reagent_pouch', socket: 0 });
    const staged = s.bankLedgerJournal.outbox.snapshot();
    expect(staged.batches).toHaveLength(3);
    const swapRows = decodedLedgerRows([staged.batches[2]]);
    expect(swapRows).toHaveLength(2);
    expect(swapRows[0]).toMatchObject({ op: 'unsocket_bag', itemId: 'linen_pouch', count: 1 });
    expect(swapRows[1]).toMatchObject({
      op: 'socket_bag',
      itemId: 'burlap_reagent_pouch',
      count: 1,
    });

    // 4) refusals write nothing: an unaffordable unlock (copper is spent), an
    // unsocket of an empty socket, and socketing into a locked index.
    send(server, s, { cmd: 'bank_unlock_socket' });
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 3 });
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch', socket: 2 });
    expect(s.bankLedgerJournal.outbox.snapshot().batches).toHaveLength(3);

    // 5) the real unsocket: ONE batch of ONE unsocket_bag row.
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 0 });
    const finalSnapshot = s.bankLedgerJournal.outbox.snapshot();
    expect(finalSnapshot.batches).toHaveLength(4);
    expect(decodedLedgerRows([finalSnapshot.batches[3]])[0]).toMatchObject({
      op: 'unsocket_bag',
      itemId: 'burlap_reagent_pouch',
      count: 1,
    });
    await expect(server.saveCharacter(s)).resolves.toBe(true);
    const effects = saveCharacterMock.mock.calls[0][5];
    expect(effects?.batches.map((batch) => batch.rows.length)).toEqual([1, 1, 2, 1]);
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
    expect(insertMock).not.toHaveBeenCalled();
    expect(insertRowsMock).not.toHaveBeenCalled();
  });

  it('a refused op away from every banker writes zero rows', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinLedger(server, fw, 'Ledgerc');
    const pid = s.pid;
    const sim = server.sim as any;
    const banker = bringBankerToPlayer(sim, pid);
    const p = sim.entities.get(pid);
    sim.addItem('wolf_fang', 5, pid);

    // Move the only banker far away: the proximity gate refuses and bankInfoFor
    // returns null on both sides, so the diff is empty and nothing is written.
    banker.pos = { x: p.pos.x + 1000, y: p.pos.y, z: p.pos.z + 1000 };
    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 1 });
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
    expect(saveCharacterMock).not.toHaveBeenCalled();
  });

  it('an op refused AT the banker writes zero rows (identical non-null snapshots)', async () => {
    // The other refusal arm: the player IS at the banker, so bankInfoFor is
    // non-null on both sides, and the refusal must surface as an empty diff.
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinLedger(server, fw, 'Ledgerd');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);

    // Withdrawing from an empty bank slot changes nothing.
    send(server, s, { cmd: 'bank_withdraw', slot: 0, count: 1 });
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);

    // An unaffordable slot purchase changes nothing.
    sim.players.get(pid).copper = 0;
    send(server, s, { cmd: 'bank_buy_slots' });
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
    expect(saveCharacterMock).not.toHaveBeenCalled();
  });

  it('a rejected transaction retains its exact prefix and the next save commits it with later work', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinLedger(server, fw, 'Ledgerd');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.addItem('wolf_fang', 5, pid);

    // Dispatch never observes the database failure because it only stages the
    // immutable command. The attempted save propagates, and acknowledges none.
    const ledgerDown = new Error('ledger down');
    saveCharacterMock.mockRejectedValueOnce(ledgerDown);
    expect(() =>
      send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 2 }),
    ).not.toThrow();
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(1);
    await expect(server.saveCharacter(s)).rejects.toBe(ledgerDown);
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(1);

    send(server, s, { cmd: 'bank_withdraw', slot: 0, count: 1 });
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(2);
    await expect(server.saveCharacter(s)).resolves.toBe(true);
    expect(saveCharacterMock).toHaveBeenCalledTimes(2);
    expect(
      decodedLedgerRows(saveCharacterMock.mock.calls[1][5]?.batches ?? []).map((row) => row.op),
    ).toEqual(['deposit', 'withdraw']);
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
  });

  it('direct recording and live dispatch are both non-blocking at their persistence seams', async () => {
    // Directly: a diffed op returns undefined (not a promise).
    expect(
      recordBankOp(
        'deposit',
        { characterId: 42, accountId: 7 },
        info([]),
        info([{ itemId: 'wolf_fang', count: 1 }]),
      ),
    ).toBeUndefined();
    await bankLedgerIdle();
    insertMock.mockClear();

    // Through dispatch, the command stages synchronously. Even when the later
    // character transaction stays pending, the mutation is already visible.
    let releasePending: () => void = () => {};
    saveCharacterMock.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (releasePending = () => resolve(true))),
    );
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinLedger(server, fw, 'Ledgere');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.addItem('wolf_fang', 3, pid);

    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 2 });
    expect(sim.players.get(pid).bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(1);
    expect(saveCharacterMock).not.toHaveBeenCalled();

    const pendingSave = server.saveCharacter(s);
    await vi.waitFor(() => expect(saveCharacterMock).toHaveBeenCalledTimes(1));
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(1);
    releasePending();
    await expect(pendingSave).resolves.toBe(true);
    expect(s.bankLedgerJournal.outbox.snapshot().rowCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Materials Vault rows (Bank Storage Phase 2): the pure vault differ and its
// recorder on the shared FIFO tail. VaultInfo fixtures mirror info() above.
// The wire-level integration (dispatch, refusals, owner-only delta) lives in
// tests/vault_wire.test.ts; this block owns the pure diff contract.
// ---------------------------------------------------------------------------

import { diffVaultOp, recordVaultOp, vaultSpecialLedgerIdentity } from '../server/bank_ledger';
import {
  noopGameMetricsCounters,
  setGameMetricsCounters,
  type VaultLedgerIncident,
} from '../server/http/game_signals';

// perMaterialCap follows VAULT_BASE_CAP + VAULT_UPGRADE_STEP * (upgrades - 1)
// for realism, but diffVaultOp reads only stock, upgrades, and (for a buy)
// nextUpgradeCost.
function vinfo(
  stock: Record<string, number>,
  upgrades = 1,
  nextUpgradeCost: number | null = 50000,
  special: VaultInfo['special'] = [],
): VaultInfo {
  return {
    stock,
    special,
    upgrades,
    perMaterialCap: upgrades > 0 ? 40 + 40 * (upgrades - 1) : 0,
    nextUpgradeCost,
  };
}

describe('diffVaultOp (pure)', () => {
  it('a deposit of a new material yields the deposited count with a null instance', () => {
    expect(diffVaultOp('deposit', vinfo({}), vinfo({ copper_ore: 3 }))).toEqual([
      { itemId: 'copper_ore', count: 3, instance: null, copperDelta: 0, purchasedSlotsAfter: 1 },
    ]);
  });

  it('a deposit onto an existing count records the MOVED amount, not the total', () => {
    // before 2, after 5: the ledger records the delta 3. Conservation replay
    // depends on this: an earlier deposit of 2 plus this 3 nets to the resulting
    // 5, whereas recording 5 here would over-count to 7.
    expect(diffVaultOp('deposit', vinfo({ copper_ore: 2 }), vinfo({ copper_ore: 5 }))).toEqual([
      { itemId: 'copper_ore', count: 3, instance: null, copperDelta: 0, purchasedSlotsAfter: 1 },
    ]);
  });

  it('diffs special rows by versioned full identity without merging them into pooled stock', () => {
    const ada = {
      itemId: 'copper_ore',
      count: 1,
      instance: { signer: 'Ada', rolled: { quality: 'rare' as const } },
      craftedRecipeId: 'smelt_copper',
    };
    const after = vinfo({ copper_ore: 2 }, 1, 50000, [ada, { ...ada, count: 2 }]);

    expect(diffVaultOp('deposit', vinfo({}), after)).toEqual([
      {
        itemId: 'copper_ore',
        count: 2,
        instance: null,
        copperDelta: 0,
        purchasedSlotsAfter: 1,
      },
      {
        itemId: 'copper_ore',
        count: 3,
        instance: {
          vaultSpecial: 1,
          instance: { signer: 'Ada', rolled: { quality: 'rare' } },
          craftedRecipeId: 'smelt_copper',
        },
        copperDelta: 0,
        purchasedSlotsAfter: 1,
      },
    ]);
  });

  it('keeps a sanitizer-demoted special row distinct with an all-null wrapper', () => {
    const slot = { itemId: 'copper_ore', count: 2 };
    expect(vaultSpecialLedgerIdentity(slot)).toEqual({
      vaultSpecial: 1,
      instance: null,
      craftedRecipeId: null,
    });
    expect(diffVaultOp('withdraw', vinfo({}, 1, 50000, [slot]), vinfo({}))).toEqual([
      {
        itemId: 'copper_ore',
        count: 2,
        instance: { vaultSpecial: 1, instance: null, craftedRecipeId: null },
        copperDelta: 0,
        purchasedSlotsAfter: 1,
      },
    ]);
  });

  it('a partial withdraw records the withdrawn count', () => {
    expect(diffVaultOp('withdraw', vinfo({ copper_ore: 5 }), vinfo({ copper_ore: 3 }))).toEqual([
      { itemId: 'copper_ore', count: 2, instance: null, copperDelta: 0, purchasedSlotsAfter: 1 },
    ]);
  });

  it('a full withdraw records the whole before-count even though the key is DELETED', () => {
    // vaultWithdraw deletes the row rather than leaving a zero, so the after
    // snapshot has no key at all. A differ that walked only the after keys would
    // silently record nothing here and leave the audit short by the whole stack.
    expect(diffVaultOp('withdraw', vinfo({ copper_ore: 7 }), vinfo({}))).toEqual([
      { itemId: 'copper_ore', count: 7, instance: null, copperDelta: 0, purchasedSlotsAfter: 1 },
    ]);
  });

  it('a key that reached zero without being deleted is still a full withdraw', () => {
    expect(diffVaultOp('withdraw', vinfo({ copper_ore: 4 }), vinfo({ copper_ore: 0 }))).toEqual([
      { itemId: 'copper_ore', count: 4, instance: null, copperDelta: 0, purchasedSlotsAfter: 1 },
    ]);
  });

  it('emits multiple changed keys in SORTED id order, not insertion order', () => {
    // Vault stock round-trips through JSONB, whose key order Postgres does not
    // preserve, so an insertion-ordered walk would make row order depend on how
    // the snapshot happened to be built. The `after` fixture is deliberately in
    // reverse-sorted insertion order.
    const after = vinfo({ tin_ore: 2, copper_ore: 4, arcanite_bar: 1 });
    expect(diffVaultOp('deposit', vinfo({}), after).map((d) => d.itemId)).toEqual([
      'arcanite_bar',
      'copper_ore',
      'tin_ore',
    ]);
  });

  it('a deposit ignores keys that FELL and a withdraw ignores keys that ROSE', () => {
    // Direction gating: only the op's own direction produces rows, so a
    // mis-labelled op can never mint a row of the opposite sign.
    expect(diffVaultOp('deposit', vinfo({ copper_ore: 5 }), vinfo({ copper_ore: 2 }))).toEqual([]);
    expect(diffVaultOp('withdraw', vinfo({ copper_ore: 2 }), vinfo({ copper_ore: 5 }))).toEqual([]);
  });

  it('reads a prototype-named key on the missing side as zero, not NaN', () => {
    // A tolerated save can hold dormant stock under an inherited name; a plain
    // index would reach Object.prototype.constructor on the side that lacks the
    // OWN key and make the delta NaN, which fails every > 0 test and silently
    // drops the row.
    const after = vinfo(Object.fromEntries([['constructor', 3]]));
    expect(diffVaultOp('deposit', vinfo({}), after)).toEqual([
      { itemId: 'constructor', count: 3, instance: null, copperDelta: 0, purchasedSlotsAfter: 1 },
    ]);
  });

  it('a non-finite stored count reads as ZERO on its side of the diff', () => {
    // A garbage count from a tampered save would otherwise turn the delta into
    // NaN, which fails both direction gates and silently drops the ledger row;
    // the isFinite arm turns the garbage side into an honest zero instead. The
    // two arms red in OPPOSITE directions if the guard is deleted: the deposit
    // would emit nothing (NaN delta) and the withdraw would emit an Infinity.
    expect(
      diffVaultOp(
        'deposit',
        vinfo({ copper_ore: 'garbage' as unknown as number }),
        vinfo({ copper_ore: 3 }),
      ),
    ).toEqual([
      { itemId: 'copper_ore', count: 3, instance: null, copperDelta: 0, purchasedSlotsAfter: 1 },
    ]);
    expect(diffVaultOp('withdraw', vinfo({ copper_ore: Infinity }), vinfo({}))).toEqual([]);
  });

  it('a buy_slots yields one row: negated BEFORE price, item fields null, rung after', () => {
    // The rung is priced from the BEFORE snapshot's nextUpgradeCost (50000),
    // never the new next price (100000) the after snapshot advertises.
    expect(diffVaultOp('buy_slots', vinfo({}, 1, 50000), vinfo({}, 2, 100000))).toEqual([
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -50000,
        purchasedSlotsAfter: 2,
      },
    ]);
  });

  it('the UNLOCK (rung 0 -> 1) is priced at the 20000 copper table entry', () => {
    expect(diffVaultOp('buy_slots', vinfo({}, 0, 20000), vinfo({}, 1, 50000))).toEqual([
      { itemId: null, count: null, instance: null, copperDelta: -20000, purchasedSlotsAfter: 1 },
    ]);
  });

  it('carries the vault RUNG as purchased_slots_after on item rows too', () => {
    // The column is the container's monotonic ladder analogue, so an item row
    // must report the rung in force, not 0.
    const rows = diffVaultOp('deposit', vinfo({}, 3), vinfo({ iron_ore: 2 }, 3));
    expect(rows).toHaveLength(1);
    expect(rows[0].purchasedSlotsAfter).toBe(3);
  });

  it('the unreachable null-price buy arm emits copperDelta -0, never a clamp or a skip', () => {
    // The comment beside `before.nextUpgradeCost ?? 0` forbids silencing this
    // arm: a null price on a SUCCESSFUL climb is a broken invariant, and the
    // NEGATED zero it produces is exactly what trips the audit's
    // nonnegative_buy_cost alarm (-0 >= 0). A clamp to a positive price or a
    // skipped row here would hide the broken invariant from the audit.
    const rows = diffVaultOp('buy_slots', vinfo({}, 4, null), vinfo({}, 5, null));
    expect(rows).toEqual([
      { itemId: null, count: null, instance: null, copperDelta: -0, purchasedSlotsAfter: 5 },
    ]);
    expect(Object.is(rows[0].copperDelta, -0)).toBe(true);
  });

  it('identical snapshots (a refused/no-op call) yield no rows', () => {
    const stock = { copper_ore: 4 };
    expect(diffVaultOp('deposit', vinfo(stock), vinfo(stock))).toEqual([]);
    expect(diffVaultOp('withdraw', vinfo(stock), vinfo(stock))).toEqual([]);
    // A buy that did not raise the rung is also a no-op (the purchase cap).
    expect(diffVaultOp('buy_slots', vinfo({}, 5, null), vinfo({}, 5, null))).toEqual([]);
  });

  it('a null snapshot on either side (away from a banker) yields no rows', () => {
    expect(diffVaultOp('deposit', null, vinfo({ copper_ore: 1 }))).toEqual([]);
    expect(diffVaultOp('withdraw', vinfo({ copper_ore: 1 }), null)).toEqual([]);
    expect(diffVaultOp('buy_slots', null, null)).toEqual([]);
  });
});

describe('the bounded insert FIFO (tail cap)', () => {
  beforeEach(async () => {
    await bankLedgerIdle();
    insertMock.mockClear();
    // The drop-log latch (TAIL_DROP_LOG_LIMIT, budget 5) is module-lifetime and
    // shared by every drop this FILE produces, so without this reset the exact
    // console.error counts below would depend on how many drops sibling tests
    // logged first: a new drop-producing test above them would exhaust the
    // budget and red them for a reason unrelated to their own claim.
    resetBankLedgerTailDropLogForTests();
  });

  it('admits to the cap, drops and counts past it, and recovers after a drain', async () => {
    // The literal cap: the 10s shutdown drain (BANK_LEDGER_SHUTDOWN_DRAIN_MS)
    // settles 2,000 inserts at a conservative 200/s, the comment's own
    // arithmetic; a silent cap edit moves that trade and must red here.
    expect(BANK_LEDGER_TAIL_MAX_DEPTH).toBe(2_000);
    const baselineDropped = bankLedgerTailStats().droppedRows;
    let release!: () => void;
    // Wedge the chain: the first insert stays pending, so every later insert
    // queues behind it and depth grows while no db call resolves. release()
    // rides a finally so a failing assertion cannot leave the module-global
    // tail wedged for every later bankLedgerIdle() in this file.
    insertMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const who = { characterId: 42, accountId: 7 };
    const deposit = () =>
      recordBankOp('deposit', who, info([]), info([{ itemId: 'wolf_fang', count: 1 }]));
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const incidents: string[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      vaultLedgerIncident: (kind) => incidents.push(kind),
    });
    try {
      for (let i = 0; i < BANK_LEDGER_TAIL_MAX_DEPTH; i++) deposit();
      expect(bankLedgerTailStats().depth).toBe(BANK_LEDGER_TAIL_MAX_DEPTH);
      // The DEPTH cap is the cap that fires below: every queued op above is
      // a single row, so the rows column sits at exactly the depth, strictly
      // under its own cap. Without this pin, lowering
      // BANK_LEDGER_TAIL_MAX_ROWS to or below the depth cap would quietly
      // turn this into a second rows-cap test and leave the depth cap
      // untested; it reds here first instead.
      expect(bankLedgerTailStats().rows).toBe(BANK_LEDGER_TAIL_MAX_DEPTH);
      expect(BANK_LEDGER_TAIL_MAX_DEPTH).toBeLessThan(BANK_LEDGER_TAIL_MAX_ROWS);

      // Past the cap the op is dropped, counted in ROWS (the audit's unit),
      // and the depth stays pinned instead of growing without bound.
      deposit();
      expect(bankLedgerTailStats().depth).toBe(BANK_LEDGER_TAIL_MAX_DEPTH);
      expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped + 1);
      expect(errs).toHaveBeenCalledTimes(1);
      expect(String(errs.mock.calls[0][0])).toContain('cap');

      // A MULTI-row drop counts every row, never one per op (the decisive
      // arm for the rows-not-ops claim), and the vault site's drop gets the
      // SAME per-row incident accounting its rejected insert gets: a cap
      // drop is the same audit hole.
      recordVaultOp('deposit', who, vinfo({}), vinfo({ copper_ore: 2, iron_ore: 1, tin_ore: 4 }));
      expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped + 4);
      expect(incidents).toEqual([
        'ledger_write_failed',
        'ledger_write_failed',
        'ledger_write_failed',
      ]);
    } finally {
      setGameMetricsCounters(noopGameMetricsCounters);
      errs.mockRestore();
      // One microtask turn first: the wedge insert runs off the chain's
      // .then, so `release` is only assigned once the chain head executed.
      await Promise.resolve();
      release();
    }

    // Releasing the wedge drains the whole backlog and the FIFO recovers:
    // depth returns to zero and a new op is admitted and actually writes.
    await bankLedgerIdle();
    expect(bankLedgerTailStats().depth).toBe(0);
    deposit();
    await bankLedgerIdle();
    expect(bankLedgerTailStats().depth).toBe(0);
    expect(insertMock).toHaveBeenCalledTimes(BANK_LEDGER_TAIL_MAX_DEPTH + 1);
    expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped + 4);
  });

  it('caps queued ROWS independently of depth, so batched sweeps cannot hide behind the op count', async () => {
    // The literal rows cap: 4,000 holds even a full-depth tail to an average
    // batch of 2 rows, keeping the shutdown drain's 200 inserts/s arithmetic
    // honest for batched statements; a silent edit moves that trade and must
    // red here.
    expect(BANK_LEDGER_TAIL_MAX_ROWS).toBe(4_000);
    const baselineDropped = bankLedgerTailStats().droppedRows;
    insertRowsMock.mockClear();
    let release!: () => void;
    // Wedge the chain on the BATCHED writer: every op in this test is a
    // 100-row vault sweep, so the rows cap fills at depth 40, nowhere near
    // the 2,000-op depth cap, which is exactly the two-cap claim.
    insertRowsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const who = { characterId: 42, accountId: 7 };
    const sweepStock = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`mat_${String(i).padStart(3, '0')}`, 1]),
    );
    const sweep = () => recordVaultOp('deposit', who, vinfo({}), vinfo(sweepStock));
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const incidents: string[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      vaultLedgerIncident: (kind) => incidents.push(kind),
    });
    try {
      for (let i = 0; i < BANK_LEDGER_TAIL_MAX_ROWS / 100; i++) sweep();
      expect(bankLedgerTailStats().depth).toBe(40);
      expect(bankLedgerTailStats().rows).toBe(BANK_LEDGER_TAIL_MAX_ROWS);
      expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped);

      // The next sweep would cross the rows cap: dropped, counted per ROW
      // (the audit's unit), and the vault site books the same per-row
      // incident hole its rejected batch does.
      sweep();
      expect(bankLedgerTailStats().depth).toBe(40);
      expect(bankLedgerTailStats().rows).toBe(BANK_LEDGER_TAIL_MAX_ROWS);
      expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped + 100);
      expect(incidents).toHaveLength(100);
      expect(new Set(incidents)).toEqual(new Set(['ledger_write_failed']));
      expect(errs).toHaveBeenCalledTimes(1);
      expect(String(errs.mock.calls[0][0])).toContain('rows queued');

      // Even a SINGLE row is refused at the exact cap: the bound is "queued
      // rows never exceed the cap", not "admit one more op then stop". The
      // personal arm has no incident family, so only the drop count moves.
      recordBankOp('deposit', who, info([]), info([{ itemId: 'wolf_fang', count: 1 }]));
      expect(bankLedgerTailStats().rows).toBe(BANK_LEDGER_TAIL_MAX_ROWS);
      expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped + 101);
      expect(incidents).toHaveLength(100);
    } finally {
      setGameMetricsCounters(noopGameMetricsCounters);
      errs.mockRestore();
      // One microtask turn first: the wedge insert runs off the chain's
      // .then, so `release` is only assigned once the chain head executed.
      await Promise.resolve();
      release();
    }

    // Draining returns BOTH occupancy counters to zero and re-admits work;
    // the drop total stays where the overload left it.
    await bankLedgerIdle();
    expect(bankLedgerTailStats().depth).toBe(0);
    expect(bankLedgerTailStats().rows).toBe(0);
    expect(insertRowsMock).toHaveBeenCalledTimes(40);
    sweep();
    await bankLedgerIdle();
    expect(bankLedgerTailStats().rows).toBe(0);
    expect(insertRowsMock).toHaveBeenCalledTimes(41);
    expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped + 101);
  });

  it('drops a STRADDLING batch whole below the cap, and still admits one that fits exactly', async () => {
    // The admission is the SUM comparison tailRows + rowCount > MAX, not an
    // at-capacity check: a fixture that only ever reaches the cap exactly
    // (the sibling test's 40 x 100) cannot tell the two apart, so a rewrite
    // to `tailRows >= MAX` would survive it. Fill to 3,950 (39 hundred-row
    // sweeps plus one 50-row op), then prove a 100-row sweep is refused
    // WHOLE (4,050 would cross; the queue stays at 3,950, never partially
    // admitted) while a 50-row op still admits (4,000 does not EXCEED the
    // cap); together the arms pin the sum, its comparand, and its strictness.
    const baselineDropped = bankLedgerTailStats().droppedRows;
    insertRowsMock.mockClear();
    let release!: () => void;
    insertRowsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const who = { characterId: 42, accountId: 7 };
    const stockOf = (n: number): Record<string, number> =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`mat_${String(i).padStart(3, '0')}`, 1]),
      );
    const sweep100 = () => recordVaultOp('deposit', who, vinfo({}), vinfo(stockOf(100)));
    const sweep50 = () => recordVaultOp('deposit', who, vinfo({}), vinfo(stockOf(50)));
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let i = 0; i < 39; i++) sweep100();
      sweep50();
      expect(bankLedgerTailStats().rows).toBe(3_950);
      expect(bankLedgerTailStats().depth).toBe(40);
      expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped);

      // Straddle: 3,950 queued + 100 offered crosses 4,000. Refused whole.
      sweep100();
      expect(bankLedgerTailStats().rows).toBe(3_950);
      expect(bankLedgerTailStats().depth).toBe(40);
      expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped + 100);

      // Exact fit: 3,950 + 50 = 4,000 does not exceed the cap, so it admits.
      sweep50();
      expect(bankLedgerTailStats().rows).toBe(BANK_LEDGER_TAIL_MAX_ROWS);
      expect(bankLedgerTailStats().depth).toBe(41);
      expect(bankLedgerTailStats().droppedRows).toBe(baselineDropped + 100);
    } finally {
      errs.mockRestore();
      // One microtask turn first: the wedge insert runs off the chain's
      // .then, so `release` is only assigned once the chain head executed.
      await Promise.resolve();
      release();
    }

    await bankLedgerIdle();
    expect(bankLedgerTailStats().depth).toBe(0);
    expect(bankLedgerTailStats().rows).toBe(0);
    expect(insertRowsMock).toHaveBeenCalledTimes(41);
  });
});

describe('recordVaultOp (the shared FIFO writer)', () => {
  beforeEach(async () => {
    await bankLedgerIdle();
    insertMock.mockClear();
    insertRowsMock.mockClear();
  });

  it('writes container=vault rows with a null container_id and the caller identity', async () => {
    recordVaultOp(
      'deposit',
      { characterId: 42, accountId: 7 },
      vinfo({}),
      vinfo({ copper_ore: 6 }),
    );
    await bankLedgerIdle();
    expect(insertRowsMock).toHaveBeenCalledTimes(1);
    expect(insertRowsMock.mock.calls[0][0]).toEqual([
      {
        realm: REALM,
        characterId: 42,
        accountId: 7,
        op: 'deposit',
        itemId: 'copper_ore',
        count: 6,
        instance: null,
        copperDelta: 0,
        purchasedSlotsAfter: 1,
        container: 'vault',
        containerId: null,
      },
    ]);
    // No counterparty side is stamped: the vault is a personal container, and
    // the audit must SKIP an unrecorded side rather than read it as balanced.
    expect(insertRowsMock.mock.calls[0][0][0]).not.toHaveProperty('counterpartyCopperDelta');
    expect(insertRowsMock.mock.calls[0][0][0]).not.toHaveProperty('counterpartyCount');
    // Never the single-row writer: the vault arm batches (the Phase 03 ruling),
    // and a silent fallback to per-row inserts would re-open the write
    // amplification the batch exists to close.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('batches every changed key into ONE insert, in the differ SORTED order', async () => {
    recordVaultOp(
      'deposit',
      { characterId: 42, accountId: 7 },
      vinfo({}),
      vinfo({ tin_ore: 1, copper_ore: 2 }),
    );
    await bankLedgerIdle();
    // One WRITE for the whole diff (the deposit-all shape): the row order
    // inside the batch is the differ's sorted key union.
    expect(insertRowsMock).toHaveBeenCalledTimes(1);
    expect(insertRowsMock.mock.calls[0][0].map((r) => r.itemId)).toEqual(['copper_ore', 'tin_ore']);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('an empty diff (a refusal) writes nothing', async () => {
    const stock = { copper_ore: 4 };
    recordVaultOp('deposit', { characterId: 42, accountId: 7 }, vinfo(stock), vinfo(stock));
    recordVaultOp('withdraw', { characterId: 42, accountId: 7 }, null, vinfo(stock));
    await bankLedgerIdle();
    expect(insertRowsMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('is fire-and-forget: a rejecting insert never throws and the next op still writes', async () => {
    insertRowsMock.mockRejectedValueOnce(new Error('vault ledger down'));
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      recordVaultOp(
        'deposit',
        { characterId: 42, accountId: 7 },
        vinfo({}),
        vinfo({ iron_ore: 1 }),
      ),
    ).not.toThrow();
    await bankLedgerIdle();
    // The message must NAME the character: the incident metric never carries
    // the id (unbounded label), so this line is the identifying detail the
    // VAULT_LEDGER_INCIDENTS docblock promises an operator.
    expect(errs).toHaveBeenCalled();
    expect(String(errs.mock.calls[0][0])).toContain('vault write failed for character 42');

    // The FIFO survived the rejection: the next op still lands.
    recordVaultOp('deposit', { characterId: 42, accountId: 7 }, vinfo({}), vinfo({ iron_ore: 2 }));
    await bankLedgerIdle();
    expect(insertRowsMock).toHaveBeenCalledTimes(2);
    errs.mockRestore();
  });

  it('counts a rejecting insert on the vault ledger incident series', async () => {
    // A rejected insert is a HOLE in a keep-forever audit trail, so it has to
    // reach production alerting and not only stderr: that character's vault
    // will reconcile as a permanent ledger_state_mismatch, and a real dupe
    // investigation would come up clean. Its own series rather than a
    // guild-bank kind, because a guild alert rule must never fire on a
    // personal per-character store.
    const kinds: VaultLedgerIncident[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      vaultLedgerIncident: (kind) => kinds.push(kind),
    });
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    // try/finally, not a trailing restore pair: a failing expect below throws,
    // and a leaked counter sink plus a swallowed console.error would follow this
    // file's later tests around as a silent cross-test contamination.
    try {
      insertRowsMock.mockRejectedValueOnce(new Error('vault ledger down'));
      recordVaultOp(
        'deposit',
        { characterId: 42, accountId: 7 },
        vinfo({}),
        vinfo({ iron_ore: 1 }),
      );
      await bankLedgerIdle();
      // A single-row batch that fails counts ONE incident: the counter is per
      // LOST ROW (the multi-row arm below pins the distinction), and this
      // batch lost one.
      expect(kinds).toEqual(['ledger_write_failed']);

      // A LANDING insert counts nothing. The series means "a hole exists", so a
      // healthy write moving it would make `> 0` alerting useless.
      recordVaultOp(
        'deposit',
        { characterId: 42, accountId: 7 },
        vinfo({}),
        vinfo({ iron_ore: 2 }),
      );
      await bankLedgerIdle();
      expect(kinds).toEqual(['ledger_write_failed']);

      // The PERSONAL bank arm is deliberately still log-only (a recorded
      // follow-up, not an oversight): pinned here so the asymmetry is a decision
      // somebody sees rather than a gap somebody assumes is covered.
      insertMock.mockRejectedValueOnce(new Error('bank ledger down'));
      recordBankOp(
        'deposit',
        { characterId: 42, accountId: 7 },
        info([]),
        info([{ itemId: 'wolf_fang', count: 1 }]),
      );
      await bankLedgerIdle();
      expect(kinds).toEqual(['ledger_write_failed']);

      // A rejected MULTI-ROW batch (the deposit-all shape) counts once per
      // LOST ROW, preserving the per-row phase-02 alert baseline: the series
      // sizes the audit-trail hole, and one increment for a two-row hole
      // would under-read it.
      insertRowsMock.mockRejectedValueOnce(new Error('vault ledger down'));
      recordVaultOp(
        'deposit',
        { characterId: 42, accountId: 7 },
        vinfo({}),
        vinfo({ copper_ore: 2, iron_ore: 1 }),
      );
      await bankLedgerIdle();
      expect(kinds).toEqual(['ledger_write_failed', 'ledger_write_failed', 'ledger_write_failed']);
    } finally {
      setGameMetricsCounters(noopGameMetricsCounters);
      errs.mockRestore();
    }
  });

  it('a synchronously THROWING snapshot never escapes into dispatch and counts the incident', async () => {
    // The outer try/catch is the observer's last line: diffVaultOp reads every
    // stocked count through property access, so a hostile getter on a snapshot
    // can throw SYNCHRONOUSLY, before any insert is enqueued. The dispatch path
    // must survive it, the incident series must see it (this is the second
    // emission site, distinct from the per-insert .catch above), and no row may
    // be written.
    const kinds: VaultLedgerIncident[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      vaultLedgerIncident: (kind) => kinds.push(kind),
    });
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hostileStock: Record<string, number> = {};
      Object.defineProperty(hostileStock, 'copper_ore', {
        enumerable: true,
        get(): number {
          throw new Error('hostile getter');
        },
      });
      expect(() =>
        recordVaultOp(
          'deposit',
          { characterId: 42, accountId: 7 },
          vinfo(hostileStock),
          vinfo({ copper_ore: 3 }),
        ),
      ).not.toThrow();
      await bankLedgerIdle();
      expect(kinds).toEqual(['ledger_write_failed']);
      expect(insertRowsMock).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
      // The OUTER arm's message names the character too, and its distinct
      // prefix pins WHICH arm fired (the sync guard, not the per-insert catch).
      expect(errs).toHaveBeenCalled();
      expect(String(errs.mock.calls[0][0])).toContain('recordVaultOp failed for character 42');
    } finally {
      setGameMetricsCounters(noopGameMetricsCounters);
      errs.mockRestore();
    }
  });

  it('the drain budget clamps to a whole-millisecond floor of at least 1', async () => {
    // A fractional setTimeout delay can fire EARLY (the integer-delay note in
    // the deadline test below) and a zero or negative budget would otherwise
    // hand the timer an immediate delay: the clamp gives it a real integer of
    // at least 1. Pin the exact delay the timer receives, which is the only
    // non-flaky way to red on a deleted clamp.
    let releaseInsert: () => void = () => {};
    insertRowsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseInsert = () => resolve();
        }),
    );
    recordVaultOp('deposit', { characterId: 42, accountId: 7 }, vinfo({}), vinfo({ iron_ore: 1 }));
    // Let the tail actually START the wedged insert before any assertion can
    // throw: the mock body is what assigns releaseInsert, and a sync expect
    // failure before the first await would otherwise leave it the no-op,
    // wedging the module FIFO for every later test in this file.
    await bankLedgerIdle(1);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      // 2.7 pins the Math.floor half of the clamp (2.7 floors to 2; Math.max
      // alone would hand the timer the fractional 2.7); the other three all
      // reach 1 and pin the Math.max half.
      for (const [budget, expected] of [
        [0.5, 1],
        [0, 1],
        [-30, 1],
        [2.7, 2],
      ] as const) {
        const callsBefore = timeoutSpy.mock.calls.length;
        const drained = bankLedgerIdle(budget);
        // The executor runs synchronously, so the timer registered between the
        // two reads is exactly this call's; nothing can interleave.
        expect(timeoutSpy.mock.calls.slice(callsBefore).map((c) => c[1])).toEqual([expected]);
        await expect(drained).resolves.toBe(false);
      }
    } finally {
      timeoutSpy.mockRestore();
      releaseInsert();
      await bankLedgerIdle();
    }
  });

  it('bankLedgerIdle(deadline) resolves false when the tail outlives the budget', async () => {
    // The shutdown drain's whole point (server/main.ts passes
    // BANK_LEDGER_SHUTDOWN_DRAIN_MS): a database that accepts the connection and
    // never answers must not hold the process past the supervisor's kill grace.
    // The insert below is never resolved WHILE the deadline runs (the wedge the
    // deadline exists for); it is released afterwards rather than left dangling
    // so the module-wide FIFO every other test in this file awaits stays clean.
    let releaseInsert: () => void = () => {};
    insertRowsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseInsert = () => resolve();
        }),
    );
    recordVaultOp('deposit', { characterId: 42, accountId: 7 }, vinfo({}), vinfo({ iron_ore: 1 }));
    // Integer delay: a fractional setTimeout delay can fire EARLY, which would
    // make a sub-millisecond budget prove nothing.
    await expect(bankLedgerIdle(50)).resolves.toBe(false);
    // The abandoned insert is still in flight, exactly the transient hole the
    // deadline accepts: the drain returned without it landing.
    expect(insertRowsMock).toHaveBeenCalledTimes(1);

    releaseInsert();
    // Now the same finite budget drains cleanly, so `false` above was the
    // deadline firing and not the bounded form always reporting failure.
    await expect(bankLedgerIdle(50)).resolves.toBe(true);
    // And the unbounded form (every other await in this file) reports true.
    await expect(bankLedgerIdle()).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guild bank rows (Guild Bank Phase 3): the pure guild differ and the shared
// FIFO recorder. GuildBankInfo fixtures mirror the info() helper above.
// ---------------------------------------------------------------------------

import {
  diffGuildBankOp,
  GUILD_BANK_ESCROW_DEFICIT_OP,
  type GuildBankLedgerOp,
  guildCreateFeeDelta,
  recordGuildBankDeltas,
  recordGuildBankEscrowRollback,
} from '../server/bank_ledger';
import type { GuildBankOpDelta } from '../src/sim/guild_bank';
import type { GuildBankInfo } from '../src/world_api';

function ginfo(
  treasury: number,
  slots: GuildBankInfo['slots'] = [],
  purchasedSlots = 0,
  nextExpansionPrice: number | null = 50000,
): GuildBankInfo {
  return {
    treasury,
    slots,
    capacity: 12 + purchasedSlots,
    purchasedSlots,
    nextExpansionPrice,
    canEdit: true,
  };
}

describe('diffGuildBankOp (pure)', () => {
  it('deposit_gold records the positive treasury delta', () => {
    expect(diffGuildBankOp('deposit_gold', ginfo(1000), ginfo(3500))).toEqual([
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: 2500,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
  });

  it('withdraw_gold records the negative treasury delta', () => {
    expect(diffGuildBankOp('withdraw_gold', ginfo(3500), ginfo(1000))).toEqual([
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -2500,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
  });

  it('a gold op whose treasury moved the WRONG direction records nothing', () => {
    // Direction-checked per op: a mislabeled call can never fabricate a row.
    expect(diffGuildBankOp('deposit_gold', ginfo(3500), ginfo(1000))).toEqual([]);
    expect(diffGuildBankOp('withdraw_gold', ginfo(1000), ginfo(3500))).toEqual([]);
  });

  it('an item deposit/withdraw diffs the book multiset like the personal bank', () => {
    expect(
      diffGuildBankOp('deposit', ginfo(0, []), ginfo(0, [{ itemId: 'wolf_fang', count: 3 }])),
    ).toEqual([
      {
        itemId: 'wolf_fang',
        count: 3,
        instance: null,
        craftedRecipeId: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    expect(
      diffGuildBankOp(
        'withdraw',
        ginfo(0, [{ itemId: 'wolf_fang', count: 3 }]),
        ginfo(0, [{ itemId: 'wolf_fang', count: 1 }]),
      ),
    ).toEqual([
      {
        itemId: 'wolf_fang',
        count: 2,
        instance: null,
        craftedRecipeId: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
  });

  it('keys crafted and plain copies of one item SEPARATELY (the revert-path contract)', () => {
    // The guild key has three dimensions (itemId, instance, craftedRecipeId):
    // withdrawing the plain copy while a crafted copy sits in the book must
    // record the PLAIN provenance, or the revert would mint provenance the
    // moved copy never had.
    const both = [
      { itemId: 'iron_sword', count: 1, craftedRecipeId: 'smith_iron_sword' },
      { itemId: 'iron_sword', count: 1 },
    ];
    const craftedOnly = [{ itemId: 'iron_sword', count: 1, craftedRecipeId: 'smith_iron_sword' }];
    expect(diffGuildBankOp('withdraw', ginfo(0, both), ginfo(0, craftedOnly))).toEqual([
      {
        itemId: 'iron_sword',
        count: 1,
        instance: null,
        craftedRecipeId: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
  });

  it('pins the sim and server guild-op vocabularies in lockstep (both ways)', () => {
    // GuildBankOpDelta['op'] (src/sim/guild_bank.ts) and GuildBankLedgerOp
    // (server/bank_ledger.ts) redeclare the same five literals (the sim never
    // imports server code). An op added on one side without the other would
    // otherwise compile and silently never revert (or never record).
    type SimOp = GuildBankOpDelta['op'];
    type AssertBothWays = [SimOp] extends [GuildBankLedgerOp]
      ? [GuildBankLedgerOp] extends [SimOp]
        ? true
        : never
      : never;
    const lockstep: AssertBothWays = true;
    expect(lockstep).toBe(true);
  });

  it('item deltas carry the moved slot craft provenance for the revert path', () => {
    // craftedRecipeId is NOT a ledger column (insertBankLedgerRow picks its
    // columns explicitly); it rides the delta so Sim.revertGuildBankDeltas can
    // restore a reverted withdraw byte-identically.
    expect(
      diffGuildBankOp(
        'withdraw',
        ginfo(0, [{ itemId: 'iron_sword', count: 1, craftedRecipeId: 'smith_iron_sword' }]),
        ginfo(0, []),
      ),
    ).toEqual([
      {
        itemId: 'iron_sword',
        count: 1,
        instance: null,
        craftedRecipeId: 'smith_iron_sword',
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
  });

  it('buy_slots negates the BEFORE table price the treasury paid', () => {
    expect(
      diffGuildBankOp('buy_slots', ginfo(60000, [], 24, 25000), ginfo(35000, [], 30, 50000)),
    ).toEqual([
      {
        itemId: null,
        count: null,
        instance: null,
        // ABSOLUTE: the guild escrow log replays a slot op as "raise the
        // ladder to at least 30, but only from 24", never as a relative +6.
        copperDelta: -25000,
        purchasedSlotsBefore: 24,
        purchasedSlotsAfter: 30,
      },
    ]);
  });

  it('open_bank (rung 0) negates the BEFORE table price the officer PURSE paid', () => {
    // The 0 -> 24 opening: the row records the purse copper (the treasury
    // never moved between the snapshots), and the audit's treasury replay
    // excludes the op like create_fee.
    expect(
      diffGuildBankOp('open_bank', ginfo(60000, [], 0, 90000), ginfo(60000, [], 24, 25000)),
    ).toEqual([
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -90000,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 24,
      },
    ]);
  });

  it('ALWAYS sets the ladder before-witness on every guild delta it emits', () => {
    // The escrow log replays slot ops absolutely, so a delta without a before
    // witness would replay onto the wrong base. GameServer carries a defensive
    // `?? 0`; this is the pin that keeps that fallback dead code.
    const cases: ReturnType<typeof diffGuildBankOp>[] = [
      diffGuildBankOp('deposit_gold', ginfo(0), ginfo(1500)),
      diffGuildBankOp('withdraw_gold', ginfo(1500), ginfo(0)),
      diffGuildBankOp('deposit', ginfo(0, []), ginfo(0, [{ itemId: 'wolf_fang', count: 1 }])),
      diffGuildBankOp('withdraw', ginfo(0, [{ itemId: 'wolf_fang', count: 1 }]), ginfo(0, [])),
      diffGuildBankOp('buy_slots', ginfo(60000, [], 24, 25000), ginfo(35000, [], 30, 50000)),
      diffGuildBankOp('open_bank', ginfo(0, [], 0, 90000), ginfo(0, [], 24, 25000)),
    ];
    for (const deltas of cases) {
      expect(deltas.length).toBe(1);
      expect(typeof deltas[0].purchasedSlotsBefore).toBe('number');
    }
  });

  it('identical or null snapshots (refusals) record nothing', () => {
    expect(diffGuildBankOp('deposit_gold', ginfo(500), ginfo(500))).toEqual([]);
    expect(diffGuildBankOp('deposit', null, ginfo(500))).toEqual([]);
    expect(diffGuildBankOp('withdraw', ginfo(500), null)).toEqual([]);
    expect(diffGuildBankOp('buy_slots', ginfo(500, [], 30), ginfo(500, [], 30))).toEqual([]);
    expect(diffGuildBankOp('open_bank', ginfo(500, [], 0), ginfo(500, [], 0))).toEqual([]);
    // The ITEM arms under identical non-null snapshots: exactly the shape a
    // plain MEMBER's refused deposit/withdraw takes since the v0.35 read-only
    // view (the membership-gated read answers, the op refuses rank-side and
    // moves nothing), so no ledger row and no dirty mark may come of it.
    const slot = { itemId: 'wolf_fang', count: 3 };
    expect(diffGuildBankOp('deposit', ginfo(500, [slot], 30), ginfo(500, [slot], 30))).toEqual([]);
    expect(diffGuildBankOp('withdraw', ginfo(500, [slot], 30), ginfo(500, [slot], 30))).toEqual([]);
  });
});

describe('recordGuildBankDeltas + guildCreateFeeDelta (the FIFO writer)', () => {
  beforeEach(() => {
    insertMock.mockClear();
    insertMock.mockResolvedValue(undefined);
  });

  it('a tail-cap drop counts the guild incident, the same audit hole a rejected insert is', async () => {
    await bankLedgerIdle();
    let release!: () => void;
    insertMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const incidents: string[] = [];
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      guildBankIncident: (kind) => incidents.push(kind),
    });
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Wedge, fill to the cap with personal rows, then a guild delta at the
      // cap must drop AND count its incident (one per row at this site).
      recordBankOp(
        'deposit',
        { characterId: 42, accountId: 7 },
        info([]),
        info([{ itemId: 'wolf_fang', count: 1 }]),
      );
      for (let i = 1; i < BANK_LEDGER_TAIL_MAX_DEPTH; i++) {
        recordBankOp(
          'deposit',
          { characterId: 42, accountId: 7 },
          info([]),
          info([{ itemId: 'wolf_fang', count: 1 }]),
        );
      }
      expect(bankLedgerTailStats().depth).toBe(BANK_LEDGER_TAIL_MAX_DEPTH);
      recordGuildBankDeltas('deposit_gold', { characterId: 42, accountId: 7 }, 913, [
        {
          itemId: null,
          count: null,
          instance: null,
          copperDelta: 2500,
          purchasedSlotsBefore: 0,
          purchasedSlotsAfter: 0,
          counterpartyCopperDelta: -2500,
        },
      ]);
      expect(incidents).toEqual(['ledger_write_failed']);
    } finally {
      setGameMetricsCounters(noopGameMetricsCounters);
      errs.mockRestore();
      await Promise.resolve();
      release();
    }
    await bankLedgerIdle();
    expect(bankLedgerTailStats().depth).toBe(0);
  });

  it('writes container=guild rows with the guild id and the caller identity', async () => {
    recordGuildBankDeltas(
      'deposit_gold',
      { characterId: 42, accountId: 7 },
      913,
      diffGuildBankOp('deposit_gold', ginfo(0), ginfo(1500)),
    );
    await bankLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'deposit_gold',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: 1500,
      purchasedSlotsAfter: 0,
      container: 'guild',
      containerId: 913,
      // The differ sees only the BOOK, so an unstamped delta carries no
      // counterparty side and the columns bind NULL. The stamp is the dispatch
      // observer's job (server/game.ts runGuildBankOp), pinned end to end in
      // tests/bank_counterparty.test.ts.
      counterpartyCopperDelta: null,
      counterpartyCount: null,
    });
  });

  it('the create_fee row negates the charged purse copper with zero slots', async () => {
    recordGuildBankDeltas('create_fee', { characterId: 42, accountId: 7 }, 913, [
      guildCreateFeeDelta(100000, -100000),
    ]);
    await bankLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      op: 'create_fee',
      copperDelta: -100000,
      purchasedSlotsAfter: 0,
      container: 'guild',
      containerId: 913,
      // The counterparty IS the founder's purse and it paid exactly the
      // recorded fee, so the two halves plus the fee's burn sum to zero.
      counterpartyCopperDelta: -100000,
      counterpartyCount: 0,
    });
  });

  it('an empty delta list (a refusal) writes nothing', async () => {
    recordGuildBankDeltas('withdraw', { characterId: 1, accountId: 1 }, 913, []);
    await bankLedgerIdle();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('records ONE aggregate anomaly row per rollback, with SIGNED direction', async () => {
    // One row per EVENT, never per delta: the log holds up to
    // GUILD_BANK_UNFLUSHED_OP_CAP entries and bank_ledger is keep-forever, so
    // per-delta rows are an unbounded write amplifier on a table nothing prunes.
    const gold = (copperDelta: number) => ({
      op: copperDelta > 0 ? 'deposit_gold' : 'withdraw_gold',
      itemId: null,
      count: null,
      copperDelta,
    });
    recordGuildBankEscrowRollback(
      { characterId: 42, accountId: 7 },
      913,
      [gold(1_000), gold(-40_000)],
      { itemId: null },
    );
    await bankLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: GUILD_BANK_ESCROW_DEFICIT_OP,
      itemId: null,
      count: null,
      instance: null,
      // NEGATIVE: the discarded work was taking copper OUT of the book, which
      // is the shape that would have minted had it been allowed to commit. An
      // abandoned DEPOSIT reads positive, so the two are distinguishable.
      copperDelta: -39_000,
      purchasedSlotsAfter: 0,
      container: 'guild',
      containerId: 913,
      // Mirrored from the acting character's side: the discarded work would
      // have moved 39_000 INTO that purse, which is the direction an operator
      // reads first. Derived from the discarded op log, not snapshotted (the
      // ops are long gone), so it is a report and takes no part in the audit's
      // per-op balance identity.
      counterpartyCopperDelta: 39_000,
      counterpartyCount: null,
    });
  });

  it('signs the ITEM movement the same way, so a mint and a loss differ', async () => {
    const item = (op: 'deposit' | 'withdraw', count: number) => ({
      op,
      itemId: 'wolf_fang',
      count,
      copperDelta: 0,
    });
    recordGuildBankEscrowRollback({ characterId: 42, accountId: 7 }, 913, [item('withdraw', 4)], {
      itemId: 'wolf_fang',
    });
    recordGuildBankEscrowRollback({ characterId: 42, accountId: 7 }, 913, [item('deposit', 4)], {
      itemId: 'wolf_fang',
    });
    await bankLedgerIdle();
    const counts = insertMock.mock.calls.map(
      (c) => (c[0] as unknown as { count: number | null }).count,
    );
    expect(counts).toEqual([-4, 4]);
  });

  it('is fire-and-forget: returns void and a rejecting insert never throws', async () => {
    insertMock.mockRejectedValueOnce(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      recordGuildBankDeltas('deposit', { characterId: 1, accountId: 1 }, 913, [
        {
          itemId: 'wolf_fang',
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsBefore: 0,
          purchasedSlotsAfter: 0,
        },
      ]),
    ).toBeUndefined();
    await bankLedgerIdle();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    // The chain survives: the next write still lands in order.
    recordGuildBankDeltas('deposit', { characterId: 1, accountId: 1 }, 913, [
      {
        itemId: 'wolf_fang',
        count: 2,
        instance: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    await bankLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// The growth-refusal log budget: one latch SHARED across the five insert arms.
// Once the database-wide ceiling refuses, every later insert on per-bank-op
// and per-craft-tick paths fails identically, so the log prints the first few
// lines plus one budget notice and the counters carry the rest. LAST in this
// file on purpose: the latch is module-global and this block consumes its
// whole budget.
// ---------------------------------------------------------------------------

describe('growth-refusal log budget (the shared latch)', () => {
  beforeEach(async () => {
    await bankLedgerIdle();
    insertMock.mockClear();
    insertRowsMock.mockClear();
  });

  it('prints five refusals plus one budget notice, keeps counting, and stays unbounded for other errors', async () => {
    const growthError = new BankLedgerGrowthLimitExceeded(10_000_000, 1, 10_000_000);
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
    let refusals = 0;
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      bankLedgerGrowthLimitRefused: () => {
        refusals += 1;
      },
    });
    try {
      // Six refusals through the vault arm: one past the 5-line budget.
      for (let i = 0; i < 6; i++) {
        insertRowsMock.mockRejectedValueOnce(growthError);
        recordVaultOp(
          'deposit',
          { characterId: 42, accountId: 7 },
          vinfo({}),
          vinfo({ copper_ore: i + 1 }),
        );
      }
      await bankLedgerIdle();

      const lines = errs.mock.calls.map((call) => String(call[0]));
      expect(lines.filter((l) => l.includes('vault write failed for character 42'))).toHaveLength(
        5,
      );
      // The last budgeted line is followed by the counted-only notice naming
      // the series an operator alerts on.
      const notices = lines.filter((l) => l.includes('reached the log budget'));
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('woc_bank_ledger_growth_limit_refusals_total');
      // The LOG is bounded; the COUNTER never is. All six refusals counted.
      expect(refusals).toBe(6);

      // The latch is shared across arms: a growth refusal on the personal
      // bank arm is now suppressed too, without consuming anything new.
      insertMock.mockRejectedValueOnce(growthError);
      recordBankOp(
        'deposit',
        { characterId: 42, accountId: 7 },
        info([]),
        info([{ itemId: 'wolf_fang', count: 3 }]),
      );
      await bankLedgerIdle();
      expect(
        errs.mock.calls.map((call) => String(call[0])).filter((l) => l.includes('write failed')),
      ).toHaveLength(5);
      expect(refusals).toBe(7);

      // Non-refusal errors keep unbounded logging: each one is individually
      // meaningful, not a standing condition.
      insertRowsMock.mockRejectedValueOnce(new Error('vault ledger down'));
      recordVaultOp('deposit', { characterId: 42, accountId: 7 }, vinfo({}), vinfo({ tin_ore: 1 }));
      await bankLedgerIdle();
      const after = errs.mock.calls.map((call) => String(call[0]));
      expect(after.filter((l) => l.includes('vault write failed for character 42'))).toHaveLength(
        6,
      );
    } finally {
      setGameMetricsCounters(noopGameMetricsCounters);
      errs.mockRestore();
    }
  });
});
