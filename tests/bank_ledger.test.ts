import { beforeEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import), the bank_wire.test.ts
// block plus insertBankLedgerRow, so GameServer runs with no live DB and the
// fire-and-forget ledger writer is a spy we can assert against.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
}));

import { bankLedgerIdle, diffBankOp, recordBankOp } from '../server/bank_ledger';
import { insertBankLedgerRow } from '../server/db';
import { GameServer } from '../server/game';
import { REALM } from '../server/realm';
import type { BankInfo } from '../src/world_api';

const insertMock = vi.mocked(insertBankLedgerRow);

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
    // Drain any pending writes from a prior test, then clear the call history but
    // keep the default async impl.
    await bankLedgerIdle();
    insertMock.mockClear();
  });

  it('deposit, withdraw, and buy each write exactly one row with the right fields', async () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinLedger(server, fw, 'Ledgera');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.addItem('wolf_fang', 5, pid);

    // 1) deposit 2 of 5: one deposit row, count 2, no copper, 0 purchased slots.
    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 2 });
    await bankLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toEqual({
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
    });

    // 2) withdraw 1: one withdraw row, count 1.
    send(server, s, { cmd: 'bank_withdraw', slot: 0, count: 1 });
    await bankLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock.mock.calls[1][0]).toEqual({
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

    // 3) buy the first expansion: one buy_slots row, copperDelta -500, +6 slots.
    sim.players.get(pid).copper = 1000;
    send(server, s, { cmd: 'bank_buy_slots' });
    await bankLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(3);
    expect(insertMock.mock.calls[2][0]).toEqual({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -500,
      purchasedSlotsAfter: 6,
      container: 'personal',
      containerId: null,
    });
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
    await bankLedgerIdle();
    expect(insertMock).not.toHaveBeenCalled();
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
    await bankLedgerIdle();
    expect(insertMock).not.toHaveBeenCalled();

    // An unaffordable slot purchase changes nothing.
    sim.players.get(pid).copper = 0;
    send(server, s, { cmd: 'bank_buy_slots' });
    await bankLedgerIdle();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('a rejecting insert neither throws into dispatch nor stops the next op writing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinLedger(server, fw, 'Ledgerd');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.addItem('wolf_fang', 5, pid);

    // The first insert rejects; the second uses the default resolving impl.
    insertMock.mockRejectedValueOnce(new Error('ledger down'));
    expect(() =>
      send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 2 }),
    ).not.toThrow();
    await bankLedgerIdle();

    send(server, s, { cmd: 'bank_withdraw', slot: 0, count: 1 });
    await bankLedgerIdle();

    // Both ops enqueued their insert; the rejection was logged, not thrown.
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledWith('bank_ledger write failed:', expect.any(Error));
    errSpy.mockRestore();
  });

  it('recordBankOp is fire-and-forget: returns void and never blocks the loop', async () => {
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

    // Through dispatch, with an insert that stays pending: the deposit still lands
    // in the sim and dispatch returns synchronously (the loop never awaits the
    // write). Release the pending insert afterward so the shared FIFO drains.
    let releasePending: () => void = () => {};
    insertMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releasePending = resolve)),
    );
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinLedger(server, fw, 'Ledgere');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.addItem('wolf_fang', 3, pid);

    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 2 });
    // The non-blocking proof: send() returned and the sim already applied the
    // deposit, even though the enqueued insert will never settle. dispatch did not
    // await the writer (recordBankOp returned void and the FIFO runs off-loop).
    expect(sim.players.get(pid).bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 2 }]);

    // Let the FIFO microtask fire the enqueued (still-pending) insert, then release
    // it so the shared tail drains rather than poisoning later suites.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(insertMock).toHaveBeenCalledTimes(1);
    releasePending();
    await bankLedgerIdle();
  });
});
