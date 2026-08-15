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
