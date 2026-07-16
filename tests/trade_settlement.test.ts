// Drives the real settlement orchestrator against a REAL Sim instance (two live
// players in one world) with stubbed IO boundaries (db + Claudium + $WOC modules).
// The sim and the orchestrator logic are never mocked; only the system boundaries
// (persistence, the economy service, the chain RPC) are stubbed.

import { describe, expect, it, vi } from 'vitest';
import type { ClaudiumTrade } from '../server/claudium_trade';
import type { TradeSettlementRow } from '../server/trade_db';
import type { TradeRailsConfig } from '../server/trade_rails_boot';
import type { SettlementDb, TradeSettlementsDeps, WocTradeApi } from '../server/trade_settlement';
import { TradeSettlements } from '../server/trade_settlement';
import type { VerifyWocResult, WocTradeConfig } from '../server/woc_trade';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeSim(): Sim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    // Both rails available so the sim accepts external pledges and parks in
    // 'settling'. The orchestrator does the authoritative work below.
    tradeRails: () => ({
      claudium: { available: true, balance: 100_000 },
      woc: { available: true, linked: true },
    }),
  });
}

function teleport(sim: Sim, pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

const WOC_CFG: WocTradeConfig = {
  rpcUrl: 'http://rpc.test',
  mint: 'Woc11111111111111111111111111111111111111',
  timeoutMs: 180_000,
  pollMs: 5000,
  minConfirm: 'finalized',
};

// The stale-recovery reclaim window (server-side interval '10 minutes'), mirrored
// here so the in-memory claim mock can model the recovering_since gate (R1).
const RECOVERY_STALE_MS = 10 * 60 * 1000;

interface StubState {
  rows: Map<number, TradeSettlementRow & { resolved: boolean; recoveringSince?: number }>;
  ledger: Array<{
    settlementId: number | null;
    charAName: string;
    claudiumA: number;
    claudiumB: number;
    wocA: string;
    wocB: string;
  }>;
  executeCalls: Array<{ dir: 'a' | 'b'; from: number; to: number; amount: number }>;
  refundCalls: Array<{ dir: 'a' | 'b'; from: number; to: number; amount: number }>;
  wocResults: Map<string, VerifyWocResult>;
  clock: { value: number };
  refs: string[];
}

interface Harness {
  sim: Sim;
  orch: TradeSettlements;
  state: StubState;
  db: SettlementDb;
  forceSave: ReturnType<typeof vi.fn>;
  savePairAndLedger: ReturnType<typeof vi.fn>;
  walletPubkeyFor: ReturnType<typeof vi.fn>;
  claudiumRefresh: ReturnType<typeof vi.fn>;
}

// Flush pending microtasks + one macrotask so a fire-and-forget async path
// (requestCancel -> cancelSettlement) settles before assertions.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildOrchestrator(
  sim: Sim,
  opts: {
    openRows?: TradeSettlementRow[];
    claudiumFail?: (dir: 'a' | 'b') => boolean;
    startTicker?: boolean;
    cfg?: TradeRailsConfig;
    insertReturnsNull?: boolean;
    missingSession?: (pid: number) => boolean;
    walletFor?: (accountId: number) => string | null;
  } = {},
): Harness {
  const state: StubState = {
    rows: new Map(),
    ledger: [],
    executeCalls: [],
    refundCalls: [],
    wocResults: new Map(),
    clock: { value: 1_000_000 },
    refs: [],
  };
  let nextId = 1;
  let refCounter = 0;

  // Seed provided open rows so the atomic recovery claim + subsequent mark operate
  // on the same in-memory rows the recovery pass reads (mirrors the DB).
  for (const row of opts.openRows ?? []) {
    state.rows.set(row.id, {
      ...row,
      resolved: false,
      // a row seeded as already-'recovering' models a live peer that just claimed it,
      // so it carries a fresh recovering_since and is excluded from reclaim in-window.
      recoveringSince: row.status === 'recovering' ? state.clock.value : undefined,
    });
    nextId = Math.max(nextId, row.id + 1);
  }

  const db: SettlementDb = {
    async insertSettlementAndSaveBoth(input, _sideA, _sideB) {
      if (opts.insertReturnsNull) return null;
      const id = nextId++;
      state.rows.set(id, {
        id,
        realm: input.realm,
        status: input.status,
        charAId: input.charAId,
        charBId: input.charBId,
        accountAId: input.accountAId,
        accountBId: input.accountBId,
        charAName: input.charAName,
        charBName: input.charBName,
        escrowA: input.escrowA,
        escrowB: input.escrowB,
        claudiumA: input.claudiumA,
        claudiumB: input.claudiumB,
        claudiumExecA: false,
        claudiumExecB: false,
        wocA: input.wocA,
        wocB: input.wocB,
        wocARef: input.wocARef,
        wocBRef: input.wocBRef,
        wocASig: null,
        wocBSig: null,
        wocAPayer: input.wocAPayer,
        wocARecipient: input.wocARecipient,
        wocBPayer: input.wocBPayer,
        wocBRecipient: input.wocBRecipient,
        failReason: null,
        resolved: false,
      });
      return id;
    },
    async markTradeSettlement(id, status, patch = {}) {
      const row = state.rows.get(id);
      if (!row) return;
      row.status = status;
      if (patch.wocASig !== undefined && patch.wocASig !== null) row.wocASig = patch.wocASig;
      if (patch.wocBSig !== undefined && patch.wocBSig !== null) row.wocBSig = patch.wocBSig;
      if (patch.claudiumExecA === true) row.claudiumExecA = true;
      if (patch.claudiumExecB === true) row.claudiumExecB = true;
      if (patch.failReason !== undefined && patch.failReason !== null)
        row.failReason = patch.failReason;
      if (status === 'completed' || status === 'refunded') row.resolved = true;
    },
    async loadOpenTradeSettlements() {
      return opts.openRows ?? [];
    },
    async claimTradeSettlementForRecovery(id) {
      // Model the atomic claim + the recovering_since stale-window gate (R1): a fresh
      // escrowed/claudium_done row is claimable; a row already in 'recovering' is
      // reclaimable only once its recovering_since predates the stale window (or is
      // unset, a pre-column row). A resolved row never claims. A win stamps
      // recovering_since = now(), so a second claim in-window returns null.
      const row = state.rows.get(id);
      if (!row || row.resolved) return null;
      const fresh = row.status === 'escrowed' || row.status === 'claudium_done';
      const staleRecovering =
        row.status === 'recovering' &&
        (row.recoveringSince === undefined ||
          state.clock.value - row.recoveringSince >= RECOVERY_STALE_MS);
      if (!fresh && !staleRecovering) return null;
      row.status = 'recovering';
      row.recoveringSince = state.clock.value;
      const { resolved: _resolved, recoveringSince: _recoveringSince, ...rest } = row;
      return { ...rest };
    },
    async insertTradeLedger(row) {
      state.ledger.push({
        settlementId: row.settlementId,
        charAName: row.charAName,
        claudiumA: row.claudiumA,
        claudiumB: row.claudiumB,
        wocA: row.wocA,
        wocB: row.wocB,
      });
    },
  };

  const claudiumRefresh = vi.fn(async () => {});
  const claudiumTrade: ClaudiumTrade = {
    async executeClaudiumLeg(_id, dir, from, to, amount) {
      state.executeCalls.push({ dir, from, to, amount });
      return opts.claudiumFail?.(dir) ? { ok: false, reason: 'declined' } : { ok: true };
    },
    async refundClaudiumLeg(_id, dir, from, to, amount) {
      state.refundCalls.push({ dir, from, to, amount });
      return { ok: true };
    },
    claudiumBalanceFor() {
      return 0;
    },
    refresh: claudiumRefresh,
  };

  const wocTrade: WocTradeApi = {
    makeReference() {
      const ref = `ref${refCounter++}`;
      state.refs.push(ref);
      return ref;
    },
    solanaPayUri(recipient, amountUi, reference) {
      return `solana:${recipient}?amount=${amountUi}&reference=${reference}`;
    },
    async verifyWocPayment(_cfg, inputArg) {
      return state.wocResults.get(inputArg.amountUi) ?? 'pending';
    },
  };

  const cfg: TradeRailsConfig = opts.cfg ?? { claudium: true, woc: WOC_CFG };
  const forceSave = vi.fn(async () => {});
  const savePairAndLedger = vi.fn(async () => {});
  const walletFor = opts.walletFor ?? ((accountId: number) => `wallet-${accountId}`);
  const walletPubkeyFor = vi.fn(async (accountId: number) => walletFor(accountId));

  const deps: TradeSettlementsDeps = {
    sim,
    realm: 'test-realm',
    cfg,
    db,
    claudiumTrade,
    wocTrade,
    walletPubkeyFor,
    sessionFor: (pid) =>
      opts.missingSession?.(pid)
        ? undefined
        : { accountId: pid + 1000, characterId: pid, name: `P${pid}` },
    saveSideFor: (pid) =>
      opts.missingSession?.(pid)
        ? null
        : { characterId: pid, level: 1, state: {} as never, leaseNonce: undefined },
    forceSave,
    savePairAndLedger,
    claudiumConfigured: () => true,
    now: () => state.clock.value,
    startTicker: opts.startTicker ?? false,
  };

  return {
    sim,
    orch: new TradeSettlements(deps),
    state,
    db,
    forceSave,
    savePairAndLedger,
    walletPubkeyFor,
    claudiumRefresh,
  };
}

interface Baseline {
  wfA: number;
  wfB: number;
  brA: number;
  brB: number;
  copA: number;
  copB: number;
}

// Set up two adjacent players with stock, and return their pids plus the baseline
// item/copper counts (class starting kits vary, so assertions compare deltas).
function twoTraders(sim: Sim): { a: number; b: number; base: Baseline } {
  const a = sim.addPlayer('warrior', 'Alice');
  const b = sim.addPlayer('mage', 'Bob');
  teleport(sim, a, 0, -40);
  teleport(sim, b, 3, -40);
  sim.addItem('wolf_fang', 3, a);
  sim.addItem('baked_bread', 2, b);
  sim.meta(a)!.copper = 200;
  sim.meta(b)!.copper = 200;
  const base: Baseline = {
    wfA: sim.countItem('wolf_fang', a),
    wfB: sim.countItem('wolf_fang', b),
    brA: sim.countItem('baked_bread', a),
    brB: sim.countItem('baked_bread', b),
    copA: sim.meta(a)!.copper,
    copB: sim.meta(b)!.copper,
  };
  return { a, b, base };
}

interface Offer {
  items: InvSlot[];
  copper: number;
  claudium: number;
  woc: string;
}

function confirmTrade(sim: Sim, a: number, b: number, offerA: Offer, offerB: Offer): void {
  sim.tradeRequest(b, a);
  sim.tradeAccept(b);
  sim.tradeSetOffer(offerA.items, offerA.copper, offerA.claudium, offerA.woc, a);
  sim.tradeSetOffer(offerB.items, offerB.copper, offerB.claudium, offerB.woc, b);
  sim.tradeConfirm(a);
  sim.tradeConfirm(b);
}

// Drain the sim's emitted events and feed any tradeLedger event to the
// orchestrator (mirrors game.ts routeEvents). Advances one tick.
async function pumpLedger(sim: Sim, orch: TradeSettlements): Promise<void> {
  const events = sim.tick();
  for (const ev of events) if (ev.type === 'tradeLedger') await orch.onTradeLedger(ev);
}

describe('TradeSettlements orchestrator', () => {
  it('claudium-only both directions: transfers with dedupe legs, completes, delivers goods, writes ledger', async () => {
    const sim = makeSim();
    const { a, b, base } = twoTraders(sim);
    const { orch, state } = buildOrchestrator(sim);
    confirmTrade(
      sim,
      a,
      b,
      { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 30, claudium: 100, woc: '0' },
      { items: [{ itemId: 'baked_bread', count: 1 }], copper: 10, claudium: 40, woc: '0' },
    );
    expect(sim.tradeFor(a)?.phase).toBe('settling');

    await orch.onTradeSettle({ a, b });
    await pumpLedger(sim, orch);

    // both legs executed with the right from/to and amounts
    expect(state.executeCalls).toEqual([
      { dir: 'a', from: a + 1000, to: b + 1000, amount: 100 },
      { dir: 'b', from: b + 1000, to: a + 1000, amount: 40 },
    ]);
    expect(state.refundCalls).toEqual([]);
    // goods delivered crosswise
    expect(sim.countItem('wolf_fang', a)).toBe(base.wfA - 2);
    expect(sim.countItem('wolf_fang', b)).toBe(base.wfB + 2);
    expect(sim.countItem('baked_bread', a)).toBe(base.brA + 1);
    expect(sim.countItem('baked_bread', b)).toBe(base.brB - 1);
    expect(sim.meta(a)?.copper).toBe(base.copA - 30 + 10);
    expect(sim.meta(b)?.copper).toBe(base.copB - 10 + 30);
    // ledger row written with the settlement id, settlement resolved completed
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0].settlementId).toBe(1);
    expect(state.rows.get(1)?.status).toBe('completed');
    expect(state.rows.get(1)?.resolved).toBe(true);
  });

  it('woc leg: pending polls then a verified signature completes the trade', async () => {
    const sim = makeSim();
    const { a, b, base } = twoTraders(sim);
    const { orch, state } = buildOrchestrator(sim);
    confirmTrade(
      sim,
      a,
      b,
      { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 0, claudium: 0, woc: '1.5' },
      { items: [{ itemId: 'baked_bread', count: 1 }], copper: 0, claudium: 0, woc: '0' },
    );

    await orch.onTradeSettle({ a, b });
    // still open, awaiting the $WOC payment
    expect(state.rows.get(1)?.resolved).toBe(false);
    const pay = orch.wocPayFor(a);
    expect(pay?.amountUi).toBe('1.5');
    expect(pay?.uri).toContain(`wallet-${b + 1000}`);
    expect(orch.settleStatusFor(a)?.wocMine).toBe('pending');

    // the payment lands on chain; the next poll finds it and completes
    state.wocResults.set('1.5', { signature: 'sigA' });
    await orch.pollOnce();
    await pumpLedger(sim, orch);

    expect(sim.countItem('wolf_fang', b)).toBe(base.wfB + 2);
    expect(sim.countItem('baked_bread', a)).toBe(base.brA + 1);
    expect(state.rows.get(1)?.wocASig).toBe('sigA');
    expect(state.rows.get(1)?.status).toBe('completed');
    expect(state.ledger).toHaveLength(1);
  });

  it('timeout: escrow returned to bags, claudium refunded, settlement refunded', async () => {
    const sim = makeSim();
    const { a, b, base } = twoTraders(sim);
    const { orch, state } = buildOrchestrator(sim);
    confirmTrade(
      sim,
      a,
      b,
      { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 30, claudium: 100, woc: '1.5' },
      { items: [{ itemId: 'baked_bread', count: 1 }], copper: 10, claudium: 0, woc: '0' },
    );

    await orch.onTradeSettle({ a, b });
    // claudium leg executed, waiting on the (never-arriving) $WOC payment
    expect(state.executeCalls).toEqual([{ dir: 'a', from: a + 1000, to: b + 1000, amount: 100 }]);

    // wall clock advances past the timeout; the next poll unwinds
    state.clock.value += WOC_CFG.timeoutMs + 1;
    await orch.pollOnce();

    // bags + copper restored to both sides
    expect(sim.countItem('wolf_fang', a)).toBe(base.wfA);
    expect(sim.countItem('baked_bread', b)).toBe(base.brB);
    expect(sim.meta(a)?.copper).toBe(base.copA);
    expect(sim.meta(b)?.copper).toBe(base.copB);
    // the executed claudium leg was reversed
    expect(state.refundCalls).toEqual([{ dir: 'a', from: a + 1000, to: b + 1000, amount: 100 }]);
    expect(state.rows.get(1)?.status).toBe('refunded');
    expect(state.rows.get(1)?.failReason).toBe('timeout');
  });

  it('requestCancel unwinds during escrowed, and the final verify refuses the pay-then-cancel race', async () => {
    // (1) cancel while escrowed (no leg verified) unwinds
    {
      const sim = makeSim();
      const { a, b, base } = twoTraders(sim);
      const { orch, state } = buildOrchestrator(sim);
      confirmTrade(
        sim,
        a,
        b,
        { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 0, claudium: 0, woc: '1.5' },
        { items: [{ itemId: 'baked_bread', count: 1 }], copper: 0, claudium: 0, woc: '0' },
      );
      await orch.onTradeSettle({ a, b });
      expect(orch.requestCancel(a)).toBe(true);
      await flush();
      expect(sim.countItem('wolf_fang', a)).toBe(base.wfA);
      expect(state.rows.get(1)?.status).toBe('refunded');
      expect(state.rows.get(1)?.failReason).toBe('cancelled');
    }
    // (2) the pay-then-cancel race: the payment lands after the last poll but before
    // the cancel; the cancel's FINAL on-chain verify finds it, refuses the cancel,
    // and completes the trade instead of losing the payment (fix F1b/r2#3).
    {
      const sim = makeSim();
      const { a, b, base } = twoTraders(sim);
      const { orch, state } = buildOrchestrator(sim);
      confirmTrade(
        sim,
        a,
        b,
        { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 0, claudium: 0, woc: '1.5' },
        { items: [{ itemId: 'baked_bread', count: 1 }], copper: 0, claudium: 0, woc: '0' },
      );
      // first poll finds nothing (payment not yet landed); the trade stays open
      await orch.onTradeSettle({ a, b });
      expect(state.rows.get(1)?.resolved).toBe(false);
      // the payment lands; now the player cancels, but the final verify catches it
      state.wocResults.set('1.5', { signature: 'sigRace' });
      expect(orch.requestCancel(a)).toBe(true);
      await flush();
      await pumpLedger(sim, orch);
      expect(state.rows.get(1)?.status).toBe('completed');
      expect(state.rows.get(1)?.wocASig).toBe('sigRace');
      expect(state.refundCalls).toEqual([]);
      expect(sim.countItem('wolf_fang', b)).toBe(base.wfB + 2);
    }
  });

  it('claudium service failure mid-legs: the executed leg is refunded and the trade unwinds', async () => {
    const sim = makeSim();
    const { a, b, base } = twoTraders(sim);
    const { orch, state } = buildOrchestrator(sim, { claudiumFail: (dir) => dir === 'b' });
    confirmTrade(
      sim,
      a,
      b,
      { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 0, claudium: 100, woc: '0' },
      { items: [{ itemId: 'baked_bread', count: 1 }], copper: 0, claudium: 40, woc: '0' },
    );

    await orch.onTradeSettle({ a, b });

    // leg a executed, leg b failed -> only leg a refunded
    expect(state.executeCalls.map((c) => c.dir)).toEqual(['a', 'b']);
    expect(state.refundCalls).toEqual([{ dir: 'a', from: a + 1000, to: b + 1000, amount: 100 }]);
    // escrow returned
    expect(sim.countItem('wolf_fang', a)).toBe(base.wfA);
    expect(sim.countItem('baked_bread', b)).toBe(base.brB);
    expect(state.rows.get(1)?.status).toBe('refunded');
    expect(state.rows.get(1)?.failReason).toBe('claudium');
  });

  it('recovery: a woc-verified open row completes delivery by mail; an unpaid row refunds by mail', async () => {
    const sim = makeSim();
    const letters = vi.spyOn(sim, 'sendTradeLetter');
    const paidRow: TradeSettlementRow = {
      id: 10,
      realm: 'test-realm',
      status: 'escrowed',
      charAId: 501,
      charBId: 502,
      accountAId: 1501,
      accountBId: 1502,
      charAName: 'Alice',
      charBName: 'Bob',
      escrowA: { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 30 },
      escrowB: { items: [{ itemId: 'baked_bread', count: 1 }], copper: 10 },
      claudiumA: 0,
      claudiumB: 0,
      claudiumExecA: false,
      claudiumExecB: false,
      wocA: '1.5',
      wocB: '0',
      wocARef: 'refA',
      wocBRef: null,
      wocASig: 'sigA',
      wocBSig: null,
      wocAPayer: 'pk-a',
      wocARecipient: 'pk-b',
      wocBPayer: null,
      wocBRecipient: null,
      failReason: null,
    };
    const unpaidRow: TradeSettlementRow = {
      ...paidRow,
      id: 11,
      charAId: 601,
      charBId: 602,
      wocA: '0',
      wocARef: null,
      wocASig: null,
      wocAPayer: null,
      wocARecipient: null,
      claudiumA: 100,
      // the claudium leg had executed before the crash, so recovery reverses it
      claudiumExecA: true,
      accountAId: 1601,
      accountBId: 1602,
    };
    const { orch, state } = buildOrchestrator(sim, { openRows: [paidRow, unpaidRow] });

    await orch.recoverOpenSettlements();

    // paid row: two delivery letters (A's escrow to B, B's escrow to A) + a ledger row + completed
    // unpaid row: two refund letters (each side's own escrow) + a claudium reversal + refunded
    // (flavor is the 3rd sendTradeLetter arg now that fromName was dropped, F7c)
    const flavors = letters.mock.calls.map((c) => c[2]);
    expect(flavors).toEqual(['delivery', 'delivery', 'refund', 'refund']);
    // A's escrow (wolf_fang) delivered to B (mail key = B's character id)
    expect(letters.mock.calls[0][0]).toBe('502');
    expect(state.ledger.some((l) => l.settlementId === 10)).toBe(true);
    expect(state.refundCalls).toEqual([{ dir: 'a', from: 1601, to: 1602, amount: 100 }]);
    // both rows resolved by the claimed-and-recovered pass
    expect(state.rows.get(10)?.status).toBe('completed');
    expect(state.rows.get(11)?.status).toBe('refunded');
  });

  it('final verify on a timed-out poll completes instead of unwinding (F1b)', async () => {
    const sim = makeSim();
    const { a, b, base } = twoTraders(sim);
    const { orch, state } = buildOrchestrator(sim);
    confirmTrade(
      sim,
      a,
      b,
      { items: [{ itemId: 'wolf_fang', count: 2 }], copper: 0, claudium: 0, woc: '1.5' },
      { items: [{ itemId: 'baked_bread', count: 1 }], copper: 0, claudium: 0, woc: '0' },
    );
    await orch.onTradeSettle({ a, b });
    expect(state.rows.get(1)?.resolved).toBe(false);

    // the wall clock passes the timeout AND the payment has now landed: the timed-out
    // poll runs the final verify first and completes rather than unwinding.
    state.clock.value += WOC_CFG.timeoutMs + 1;
    state.wocResults.set('1.5', { signature: 'sigLate' });
    await orch.pollOnce();
    await pumpLedger(sim, orch);

    expect(state.rows.get(1)?.status).toBe('completed');
    expect(state.rows.get(1)?.wocASig).toBe('sigLate');
    expect(state.refundCalls).toEqual([]);
    expect(sim.countItem('wolf_fang', b)).toBe(base.wfB + 2);
  });

  it('the single-$WOC-leg rule is enforced at the sim: a second pledge is dropped (F1a belt)', () => {
    const sim = makeSim();
    const { a, b } = twoTraders(sim);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    sim.tradeSetOffer([], 0, 0, '1.5', a);
    sim.tradeSetOffer([], 0, 0, '2', b);
    const t = sim.tradeFor(a);
    expect(t?.offerA.woc).toBe('1.5');
    expect(t?.offerB.woc).toBe('0');
  });

  it('recovery runs a final verify per leg: a leg that lands at boot completes, an unverified one refunds (F1c)', async () => {
    const sim = makeSim();
    const letters = vi.spyOn(sim, 'sendTradeLetter');
    const baseRow: TradeSettlementRow = {
      id: 30,
      realm: 'test-realm',
      status: 'escrowed',
      charAId: 701,
      charBId: 702,
      accountAId: 1701,
      accountBId: 1702,
      charAName: 'Cara',
      charBName: 'Dane',
      escrowA: { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 5 },
      escrowB: { items: [{ itemId: 'baked_bread', count: 1 }], copper: 0 },
      claudiumA: 0,
      claudiumB: 0,
      claudiumExecA: false,
      claudiumExecB: false,
      wocA: '1.5',
      wocB: '0',
      wocARef: 'refLand',
      wocBRef: null,
      wocASig: null,
      wocBSig: null,
      wocAPayer: 'pk-a',
      wocARecipient: 'pk-b',
      wocBPayer: null,
      wocBRecipient: null,
      failReason: null,
    };
    const landsRow = { ...baseRow };
    const staysRow: TradeSettlementRow = {
      ...baseRow,
      id: 31,
      charAId: 801,
      charBId: 802,
      wocA: '2',
      wocARef: 'refStay',
    };
    const { orch, state } = buildOrchestrator(sim, { openRows: [landsRow, staysRow] });
    // the '1.5' payment is now visible on-chain; '2' never landed
    state.wocResults.set('1.5', { signature: 'sigBoot' });

    await orch.recoverOpenSettlements();

    // row 30: final verify finds the signature -> completed (two delivery letters + ledger)
    // row 31: still unverified -> refunded (two refund letters, no ledger)
    expect(state.rows.get(30)?.status).toBe('completed');
    expect(state.rows.get(31)?.status).toBe('refunded');
    expect(state.ledger.some((l) => l.settlementId === 30)).toBe(true);
    expect(state.ledger.some((l) => l.settlementId === 31)).toBe(false);
    const row30Flavors = letters.mock.calls
      .filter((c) => c[0] === '701' || c[0] === '702')
      .map((c) => c[2]);
    expect(row30Flavors).toEqual(['delivery', 'delivery']);
    const row31Flavors = letters.mock.calls
      .filter((c) => c[0] === '801' || c[0] === '802')
      .map((c) => c[2]);
    expect(row31Flavors).toEqual(['refund', 'refund']);
  });

  it('recovery claims each row atomically and skips one already claimed by another process (F3)', async () => {
    const sim = makeSim();
    const letters = vi.spyOn(sim, 'sendTradeLetter');
    const freshRow: TradeSettlementRow = {
      id: 40,
      realm: 'test-realm',
      status: 'escrowed',
      charAId: 901,
      charBId: 902,
      accountAId: 1901,
      accountBId: 1902,
      charAName: 'Eda',
      charBName: 'Finn',
      escrowA: { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 0 },
      escrowB: { items: [], copper: 0 },
      claudiumA: 0,
      claudiumB: 0,
      claudiumExecA: false,
      claudiumExecB: false,
      wocA: '0',
      wocB: '0',
      wocARef: null,
      wocBRef: null,
      wocASig: null,
      wocBSig: null,
      wocAPayer: null,
      wocARecipient: null,
      wocBPayer: null,
      wocBRecipient: null,
      failReason: null,
    };
    // this row is already being recovered by another process (status 'recovering'),
    // so the atomic claim returns nothing and this pass must not touch it.
    const alreadyClaimed: TradeSettlementRow = {
      ...freshRow,
      id: 41,
      status: 'recovering',
      charAId: 903,
      charBId: 904,
    };
    const { orch, state } = buildOrchestrator(sim, { openRows: [freshRow, alreadyClaimed] });

    await orch.recoverOpenSettlements();

    // only the fresh row was claimed + resolved; the already-claimed row is untouched
    expect(state.rows.get(40)?.status).toBe('refunded');
    expect(state.rows.get(41)?.status).toBe('recovering');
    const touchedIds = letters.mock.calls.map((c) => c[0]);
    expect(touchedIds).toContain('901');
    expect(touchedIds).not.toContain('903');
  });

  it('recovery claim does not double-claim a row a live peer just entered recovering (R1)', async () => {
    const sim = makeSim();
    const row: TradeSettlementRow = {
      id: 50,
      realm: 'test-realm',
      status: 'escrowed',
      charAId: 111,
      charBId: 112,
      accountAId: 1111,
      accountBId: 1112,
      charAName: 'Ivy',
      charBName: 'Jon',
      escrowA: { items: [], copper: 0 },
      escrowB: { items: [], copper: 0 },
      claudiumA: 0,
      claudiumB: 0,
      claudiumExecA: false,
      claudiumExecB: false,
      wocA: '0',
      wocB: '0',
      wocARef: null,
      wocBRef: null,
      wocASig: null,
      wocBSig: null,
      wocAPayer: null,
      wocARecipient: null,
      wocBPayer: null,
      wocBRecipient: null,
      failReason: null,
    };
    const { db, state } = buildOrchestrator(sim, { openRows: [row] });

    // first claim wins: flips escrowed -> recovering and stamps recovering_since = now()
    const first = await db.claimTradeSettlementForRecovery(50);
    expect(first?.id).toBe(50);
    expect(state.rows.get(50)?.status).toBe('recovering');
    // a second concurrent claim inside the stale window returns nothing: the fresh
    // recovering_since excludes it, so the same row is never recovered twice (R1).
    expect(await db.claimTradeSettlementForRecovery(50)).toBe(null);
    // once the stale window elapses, a genuinely abandoned recovery is reclaimable
    state.clock.value += RECOVERY_STALE_MS;
    const reclaimed = await db.claimTradeSettlementForRecovery(50);
    expect(reclaimed?.id).toBe(50);
  });

  it('recovery refund of a row with an executed claudium leg writes a trade_ledger row (R2)', async () => {
    const sim = makeSim();
    const row: TradeSettlementRow = {
      id: 60,
      realm: 'test-realm',
      status: 'claudium_done',
      charAId: 121,
      charBId: 122,
      accountAId: 1121,
      accountBId: 1122,
      charAName: 'Kai',
      charBName: 'Lena',
      escrowA: { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 5 },
      escrowB: { items: [], copper: 0 },
      claudiumA: 100,
      claudiumB: 0,
      // the a->b claudium leg executed before the crash; the $WOC leg never verified
      claudiumExecA: true,
      claudiumExecB: false,
      wocA: '1.5',
      wocB: '0',
      wocARef: 'refRefund',
      wocBRef: null,
      wocASig: null,
      wocBSig: null,
      wocAPayer: 'pk-a',
      wocARecipient: 'pk-b',
      wocBPayer: null,
      wocBRecipient: null,
      failReason: null,
    };
    const { orch, state } = buildOrchestrator(sim, { openRows: [row] });
    // the '1.5' payment never landed (no wocResults entry) -> recovery refunds

    await orch.recoverOpenSettlements();

    // (a) the executed claudium leg was reversed (forward + reverse: two real transfers)
    expect(state.refundCalls).toEqual([{ dir: 'a', from: 1121, to: 1122, amount: 100 }]);
    // (b) a trade_ledger row was written for the *refunded* settlement -- the gap R2
    // closes. Before the fix only the completed recovery branch wrote a ledger row.
    const led = state.ledger.find((l) => l.settlementId === 60);
    expect(led).toBeDefined();
    // it records the reversed claudium leg, zeroes the unexecuted one, and zeroes the
    // unpaid $WOC leg -- exactly the live writeUnwindLedger convention.
    expect(led?.claudiumA).toBe(100);
    expect(led?.claudiumB).toBe(0);
    expect(led?.wocA).toBe('0');
    expect(state.rows.get(60)?.status).toBe('refunded');
  });

  it('refreshAccount is a no-op with both rails off and cooldown-throttled otherwise (F4)', async () => {
    // both rails off: neither the wallet lookup nor the economy-service refresh fires
    {
      const sim = makeSim();
      const { orch, walletPubkeyFor, claudiumRefresh } = buildOrchestrator(sim, {
        cfg: { claudium: false, woc: null },
      });
      await orch.refreshAccount(1234);
      expect(walletPubkeyFor).not.toHaveBeenCalled();
      expect(claudiumRefresh).not.toHaveBeenCalled();
    }
    // rails on: the first refresh runs, a second within the cooldown is a no-op,
    // and one past the cooldown runs again
    {
      const sim = makeSim();
      const { orch, state, walletPubkeyFor, claudiumRefresh } = buildOrchestrator(sim);
      await orch.refreshAccount(1234);
      await orch.refreshAccount(1234);
      expect(walletPubkeyFor).toHaveBeenCalledTimes(1);
      expect(claudiumRefresh).toHaveBeenCalledTimes(1);
      state.clock.value += 60_000;
      await orch.refreshAccount(1234);
      expect(walletPubkeyFor).toHaveBeenCalledTimes(2);
      expect(claudiumRefresh).toHaveBeenCalledTimes(2);
    }
  });

  it('onTradeSettle fails unavailable when a party is no longer a live session (F6d)', async () => {
    const sim = makeSim();
    const { a, b } = twoTraders(sim);
    const { orch } = buildOrchestrator(sim, { missingSession: (pid) => pid === b });
    confirmTrade(
      sim,
      a,
      b,
      { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 0, claudium: 100, woc: '0' },
      { items: [], copper: 0, claudium: 0, woc: '0' },
    );
    const fail = vi.spyOn(sim, 'tradeSettleFail');
    await orch.onTradeSettle({ a, b });
    expect(fail).toHaveBeenCalledWith(a, 'unavailable');
    // nothing was persisted
    expect(orch.settleStatusFor(a)).toBe(null);
  });

  it('onTradeSettle fails unavailable when a pledged woc leg has no linked wallet (F6d/r4#4)', async () => {
    const sim = makeSim();
    const { a, b } = twoTraders(sim);
    // A pledges $WOC, but A's own linked wallet (the payer) resolves to null
    const { orch, state } = buildOrchestrator(sim, {
      walletFor: (accountId) => (accountId === a + 1000 ? null : `wallet-${accountId}`),
    });
    confirmTrade(
      sim,
      a,
      b,
      { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 0, claudium: 0, woc: '1.5' },
      { items: [], copper: 0, claudium: 0, woc: '0' },
    );
    const fail = vi.spyOn(sim, 'tradeSettleFail');
    await orch.onTradeSettle({ a, b });
    expect(fail).toHaveBeenCalledWith(a, 'unavailable');
    expect(state.rows.size).toBe(0);
  });

  it('onTradeSettle fails unavailable when the atomic anchor save misses its lease fence (F2)', async () => {
    const sim = makeSim();
    const { a, b } = twoTraders(sim);
    const { orch } = buildOrchestrator(sim, { insertReturnsNull: true });
    confirmTrade(
      sim,
      a,
      b,
      { items: [{ itemId: 'wolf_fang', count: 1 }], copper: 0, claudium: 100, woc: '0' },
      { items: [], copper: 0, claudium: 0, woc: '0' },
    );
    const fail = vi.spyOn(sim, 'tradeSettleFail');
    await orch.onTradeSettle({ a, b });
    expect(fail).toHaveBeenCalledWith(a, 'unavailable');
    expect(orch.settleStatusFor(a)).toBe(null);
  });
});
