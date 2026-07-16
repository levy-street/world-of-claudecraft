// Drives the real MarketSettlements orchestrator against a REAL Sim (the
// trade_settlement.test.ts harness pattern): the sim and the orchestrator logic
// are never mocked; only the system boundaries (the Claudium service transfer,
// the chain verifier, the ledger insert, the wallet/account lookups, and the
// market/character saves) are stubbed.

import { describe, expect, it, vi } from 'vitest';
import type { ClaudiumTransferResult } from '../server/claudium_proxy';
import { MarketSettlements, type MarketSettlementsDeps } from '../server/market_settlement';
import type { TradeRailsConfig } from '../server/trade_rails_boot';
import type { WocTradeApi } from '../server/trade_settlement';
import type { VerifyWocResult, WocTradeConfig } from '../server/woc_trade';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const WOC_CFG: WocTradeConfig = {
  rpcUrl: 'http://rpc.test',
  mint: 'Woc11111111111111111111111111111111111111',
  timeoutMs: 180_000,
  pollMs: 5000,
  minConfirm: 'finalized',
};

function makeSim(): Sim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    tradeRails: () => ({
      claudium: { available: true, balance: 100_000 },
      woc: { available: true, linked: true },
    }),
  });
}

function merchant(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

function standAtMerchant(sim: Sim, pid: number) {
  const m = merchant(sim);
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function collections(sim: Sim) {
  return (
    sim.market as unknown as {
      marketCollections: Map<
        string,
        { copper: number; items: { itemId: string; count: number }[] }
      >;
    }
  ).marketCollections;
}

interface LedgerRecord {
  settlementId: number | null;
  context: string | null;
  charAName: string;
  charBName: string;
  itemsB: { itemId: string; count: number }[];
  claudiumA: number;
  wocA: string;
  accountAId: number | null;
  accountBId: number | null;
}

interface StubState {
  ledger: LedgerRecord[];
  transferCalls: Array<{ from: number; to: number; amount: number; dedupeKey: string }>;
  // dedupeKey -> the FIRST outcome; a replay of the same key returns it again
  // (the economy service's exactly-once contract).
  transferOutcomes: Map<string, ClaudiumTransferResult>;
  transferFail: boolean;
  wocResults: Map<string, VerifyWocResult>;
  clock: { value: number };
  refs: string[];
}

interface Harness {
  sim: Sim;
  orch: MarketSettlements;
  state: StubState;
  saveMarket: ReturnType<typeof vi.fn>;
  forceSave: ReturnType<typeof vi.fn>;
}

function buildOrchestrator(
  sim: Sim,
  opts: {
    cfg?: TradeRailsConfig;
    transferFail?: boolean;
    walletFor?: (accountId: number) => string | null;
    missingSession?: (pid: number) => boolean;
  } = {},
): Harness {
  const state: StubState = {
    ledger: [],
    transferCalls: [],
    transferOutcomes: new Map(),
    transferFail: opts.transferFail ?? false,
    wocResults: new Map(),
    clock: { value: 1_000_000 },
    refs: [],
  };
  let refCounter = 0;

  const wocTrade: WocTradeApi = {
    makeReference() {
      const ref = `ref${refCounter++}`;
      state.refs.push(ref);
      return ref;
    },
    solanaPayUri(recipient, amountUi, reference) {
      return `solana:${recipient}?amount=${amountUi}&reference=${reference}`;
    },
    async verifyWocPayment(_cfg, input) {
      return state.wocResults.get(input.amountUi) ?? 'pending';
    },
  };

  const saveMarket = vi.fn(async () => {});
  const forceSave = vi.fn(async () => {});
  const walletFor = opts.walletFor ?? ((accountId: number) => `wallet-${accountId}`);

  const deps: MarketSettlementsDeps = {
    sim,
    realm: 'test-realm',
    cfg: opts.cfg ?? { claudium: true, woc: WOC_CFG },
    db: {
      async insertTradeLedger(row) {
        state.ledger.push({
          settlementId: row.settlementId,
          context: row.context ?? null,
          charAName: row.charAName,
          charBName: row.charBName,
          itemsB: row.itemsB,
          claudiumA: row.claudiumA,
          wocA: row.wocA,
          accountAId: row.accountAId,
          accountBId: row.accountBId,
        });
      },
    },
    async transferClaudium(from, to, amount, dedupeKey) {
      state.transferCalls.push({ from, to, amount, dedupeKey });
      const prior = state.transferOutcomes.get(dedupeKey);
      if (prior) return prior; // idempotent replay: the original outcome
      const outcome: ClaudiumTransferResult = state.transferFail
        ? { ok: false, reason: 'declined' }
        : { ok: true };
      state.transferOutcomes.set(dedupeKey, outcome);
      return outcome;
    },
    wocTrade,
    walletPubkeyFor: async (accountId) => walletFor(accountId),
    accountIdForCharacter: async (characterId) => characterId + 1000,
    sessionFor: (pid) =>
      opts.missingSession?.(pid)
        ? undefined
        : { accountId: pid + 1000, characterId: pid, name: `P${pid}` },
    saveMarket,
    forceSave,
    now: () => state.clock.value,
    startTicker: false,
  };

  return { sim, orch: new MarketSettlements(deps), state, saveMarket, forceSave };
}

// A seller with `count` bone fragments listed in `denom`, plus a buyer at the
// Merchant. Returns pids + the listing id.
function listAndBuyer(
  sim: Sim,
  denom: 'claudium' | 'woc',
  opts: { count?: number; pricePerUnit?: number; priceWoc?: string } = {},
): { seller: number; buyer: number; listingId: number } {
  const seller = sim.addPlayer('warrior', 'Seller');
  standAtMerchant(sim, seller);
  const count = opts.count ?? 2;
  sim.addItem('bone_fragments', count, seller);
  sim.players.get(seller)!.copper = 1000;
  sim.marketList('bone_fragments', count, opts.pricePerUnit ?? 10, seller, {
    denom,
    priceWoc: opts.priceWoc ?? (denom === 'woc' ? '1.5' : undefined),
  });
  const listing = sim.marketListings.find((l) => l.sellerKey === String(seller));
  if (!listing) throw new Error(`no ${denom} listing was created`);
  const buyer = sim.addPlayer('mage', 'Buyer');
  standAtMerchant(sim, buyer);
  sim.players.get(buyer)!.copper = 1000;
  return { seller, buyer, listingId: listing.id };
}

// marketBuy, then hand the sim's marketPurchaseStart event to the orchestrator
// (mirrors game.ts routeEvents' swallow-and-dispatch).
async function startPurchase(
  sim: Sim,
  orch: MarketSettlements,
  listingId: number,
  buyer: number,
  quantity?: number,
): Promise<void> {
  sim.marketBuy(listingId, quantity, buyer);
  const ev = sim.events.find((e) => e.type === 'marketPurchaseStart') as
    | Extract<SimEvent, { type: 'marketPurchaseStart' }>
    | undefined;
  if (!ev) {
    const errs = sim.events
      .filter((e) => e.type === 'error')
      .map((e) => (e as { text: string }).text);
    throw new Error(`marketBuy did not start a purchase: ${errs.join('; ')}`);
  }
  sim.events.length = 0;
  await orch.onMarketPurchaseStart(ev);
}

describe('MarketSettlements: claudium purchases', () => {
  it('transfers with the market dedupe key, completes, delivers to the collection box, and writes the ledger', async () => {
    const sim = makeSim();
    const { seller, buyer, listingId } = listAndBuyer(sim, 'claudium', {
      count: 3,
      pricePerUnit: 10,
    });
    const { orch, state, saveMarket, forceSave } = buildOrchestrator(sim);

    await startPurchase(sim, orch, listingId, buyer, 2);

    // one idempotent service transfer, buyer account -> seller account
    expect(state.transferCalls).toEqual([
      { from: buyer + 1000, to: seller + 1000, amount: 20, dedupeKey: `market-${listingId}-1` },
    ]);
    // goods in the BUYER'S collection box; deposit refund (2 x 4c) to the seller
    expect(collections(sim).get(String(buyer))?.items).toEqual([
      { itemId: 'bone_fragments', count: 2 },
    ]);
    expect(collections(sim).get(String(seller))?.copper).toBe(8);
    const listing = sim.marketListings.find((l) => l.id === listingId)!;
    expect(listing.count).toBe(1);
    expect(listing.pending).toBeUndefined();
    // ledger: buyer = A (paid claudium), seller = B (gave goods), market marker
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({
      settlementId: null,
      context: `market-${listingId}-1`,
      charAName: 'Buyer',
      charBName: 'Seller',
      itemsB: [{ itemId: 'bone_fragments', count: 2 }],
      claudiumA: 20,
      wocA: '0',
      accountAId: buyer + 1000,
      accountBId: seller + 1000,
    });
    // the anchor persisted BEFORE the transfer, then the terminal save
    expect(saveMarket.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(forceSave).toHaveBeenCalledWith(buyer);
  });

  it('a refused transfer fails the pending closed: lot unlocked, nothing delivered, no ledger row', async () => {
    const sim = makeSim();
    const { buyer, listingId } = listAndBuyer(sim, 'claudium', { count: 2, pricePerUnit: 10 });
    const { orch, state } = buildOrchestrator(sim, { transferFail: true });

    await startPurchase(sim, orch, listingId, buyer, 2);

    const listing = sim.marketListings.find((l) => l.id === listingId)!;
    expect(listing.pending).toBeUndefined();
    expect(listing.count).toBe(2);
    expect(collections(sim).get(String(buyer))).toBeUndefined();
    expect(state.ledger).toEqual([]);
    // the buyer learned the purchase died
    expect(sim.events.some((e) => e.type === 'marketPaymentExpired')).toBe(true);
  });

  it('a missing buyer session fails the pending without ever touching the service', async () => {
    const sim = makeSim();
    const { buyer, listingId } = listAndBuyer(sim, 'claudium', { count: 2, pricePerUnit: 10 });
    const { orch, state } = buildOrchestrator(sim, { missingSession: (pid) => pid === buyer });

    await startPurchase(sim, orch, listingId, buyer, 1);

    expect(state.transferCalls).toEqual([]);
    expect(sim.marketListings.find((l) => l.id === listingId)?.pending).toBeUndefined();
  });
});

describe('MarketSettlements: woc purchases', () => {
  it('anchors reference + wallets, enriches the payment request, and completes on a verified payment', async () => {
    const sim = makeSim();
    const { seller, buyer, listingId } = listAndBuyer(sim, 'woc', { count: 2, priceWoc: '1.5' });
    const { orch, state } = buildOrchestrator(sim);

    await startPurchase(sim, orch, listingId, buyer);

    // the sim persisted the settlement identity (crash-recovery anchor)
    const rec = sim.marketPendingRecord(listingId)!;
    expect(rec).toMatchObject({
      denom: 'woc',
      costWoc: '1.5',
      reference: 'ref0',
      buyerWallet: `wallet-${buyer + 1000}`,
      sellerWallet: `wallet-${seller + 1000}`,
      buyerAccountId: buyer + 1000,
      sellerAccountId: seller + 1000,
    });
    // the marketWire enrichment: buyer-scoped, recipient = SELLER's wallet
    const pay = orch.wocPayFor(buyer, listingId);
    expect(pay).toEqual({
      uri: `solana:wallet-${seller + 1000}?amount=1.5&reference=ref0`,
      reference: 'ref0',
      amountUi: '1.5',
    });
    expect(orch.wocPayFor(seller, listingId)).toBeNull(); // never anyone else's

    // the payment lands; the next poll completes the whole lot
    state.wocResults.set('1.5', { signature: 'sigA' });
    await orch.pollOnce();

    expect(sim.marketListings.some((l) => l.id === listingId)).toBe(false); // spliced
    expect(collections(sim).get(String(buyer))?.items).toEqual([
      { itemId: 'bone_fragments', count: 2 },
    ]);
    expect(collections(sim).get(String(seller))?.copper).toBe(8); // deposit only
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({
      context: `market-${listingId}-1`,
      wocA: '1.5',
      claudiumA: 0,
    });
    expect(orch.wocPayFor(buyer, listingId)).toBeNull(); // request retired
  });

  it('times out into a fail, but the FINAL verify on the timed-out pass completes a late payment instead', async () => {
    // (1) a never-paid purchase unlocks at timeout
    {
      const sim = makeSim();
      const { buyer, listingId } = listAndBuyer(sim, 'woc', { count: 2, priceWoc: '1.5' });
      const { orch, state } = buildOrchestrator(sim);
      await startPurchase(sim, orch, listingId, buyer);
      state.clock.value += WOC_CFG.timeoutMs + 1;
      await orch.pollOnce();
      const listing = sim.marketListings.find((l) => l.id === listingId)!;
      expect(listing.pending).toBeUndefined();
      expect(listing.count).toBe(2);
      expect(state.ledger).toEqual([]);
      expect(sim.events.some((e) => e.type === 'marketPaymentExpired')).toBe(true);
    }
    // (2) the payment landed in the last poll interval: the timed-out pass
    // verifies FIRST and completes rather than unlocking a lot the buyer paid for
    {
      const sim = makeSim();
      const { buyer, listingId } = listAndBuyer(sim, 'woc', { count: 2, priceWoc: '1.5' });
      const { orch, state } = buildOrchestrator(sim);
      await startPurchase(sim, orch, listingId, buyer);
      state.clock.value += WOC_CFG.timeoutMs + 1;
      state.wocResults.set('1.5', { signature: 'sigLate' });
      await orch.pollOnce();
      expect(sim.marketListings.some((l) => l.id === listingId)).toBe(false);
      expect(collections(sim).get(String(buyer))?.items).toEqual([
        { itemId: 'bone_fragments', count: 2 },
      ]);
      expect(state.ledger).toHaveLength(1);
    }
  });

  it('the concurrency cap refuses a fresh purchase by failing its pending immediately', async () => {
    const sim = makeSim();
    const { buyer, listingId } = listAndBuyer(sim, 'woc', { count: 2, priceWoc: '1.5' });
    const { orch, state } = buildOrchestrator(sim);
    // model 32 already-open purchases holding every slot
    (orch as unknown as { wocReservations: number }).wocReservations = 32;

    await startPurchase(sim, orch, listingId, buyer);

    const listing = sim.marketListings.find((l) => l.id === listingId)!;
    expect(listing.pending).toBeUndefined(); // unlocked, buyer can retry later
    expect(state.refs).toEqual([]); // no payment request was ever minted
    expect(sim.events.some((e) => e.type === 'marketPaymentExpired')).toBe(true);
  });

  it('a missing wallet link on either side fails the pending before any request renders', async () => {
    const sim = makeSim();
    const { seller, buyer, listingId } = listAndBuyer(sim, 'woc', { count: 1, priceWoc: '2' });
    const { orch, state } = buildOrchestrator(sim, {
      walletFor: (accountId) => (accountId === seller + 1000 ? null : `wallet-${accountId}`),
    });

    await startPurchase(sim, orch, listingId, buyer);

    expect(sim.marketListings.find((l) => l.id === listingId)?.pending).toBeUndefined();
    expect(state.refs).toEqual([]);
  });
});

describe('MarketSettlements: boot recovery from the persisted market blob', () => {
  // Rebuild a fresh sim + orchestrator from a save carrying a pending purchase
  // (the crash model: the process died mid-payment).
  function reboot(
    save: ReturnType<Sim['serializeMarket']>,
    opts: Parameters<typeof buildOrchestrator>[1] = {},
  ): Harness {
    const sim2 = makeSim();
    sim2.loadMarket(save);
    return buildOrchestrator(sim2, opts);
  }

  it('a woc pending whose payment landed pre-crash completes at boot; an unpaid one fails (unlocks)', async () => {
    // paid: verified via the PERSISTED reference + wallet pubkeys
    const simA = makeSim();
    const a = listAndBuyer(simA, 'woc', { count: 2, priceWoc: '1.5' });
    const harnessA = buildOrchestrator(simA);
    await startPurchase(simA, harnessA.orch, a.listingId, a.buyer);
    const bootA = reboot(simA.serializeMarket());
    bootA.state.wocResults.set('1.5', { signature: 'sigBoot' });
    await bootA.orch.recoverPendingPurchases();
    expect(bootA.sim.marketListings.some((l) => l.id === a.listingId)).toBe(false);
    expect(collections(bootA.sim).get(String(a.buyer))?.items).toEqual([
      { itemId: 'bone_fragments', count: 2 },
    ]);
    expect(bootA.state.ledger).toHaveLength(1);
    expect(bootA.state.ledger[0]).toMatchObject({
      wocA: '1.5',
      context: `market-${a.listingId}-1`,
    });

    // unpaid: never resumes a wait across a restart; the lot unlocks
    const simB = makeSim();
    const b = listAndBuyer(simB, 'woc', { count: 2, priceWoc: '2' });
    const harnessB = buildOrchestrator(simB);
    await startPurchase(simB, harnessB.orch, b.listingId, b.buyer);
    const bootB = reboot(simB.serializeMarket());
    await bootB.orch.recoverPendingPurchases();
    const listingB = bootB.sim.marketListings.find((l) => l.id === b.listingId)!;
    expect(listingB.pending).toBeUndefined();
    expect(listingB.count).toBe(2);
    expect(bootB.state.ledger).toEqual([]);
  });

  it('a woc pending that crashed BEFORE the anchor (no reference) fails outright', async () => {
    const sim = makeSim();
    const { buyer, listingId } = listAndBuyer(sim, 'woc', { count: 1, priceWoc: '3' });
    // pending set by the buy, but the orchestrator never attached (pre-anchor crash)
    sim.marketBuy(listingId, undefined, buyer);
    const boot = reboot(sim.serializeMarket());
    boot.state.wocResults.set('3', { signature: 'sigGhost' }); // even a would-be match

    await boot.orch.recoverPendingPurchases();

    const listing = boot.sim.marketListings.find((l) => l.id === listingId)!;
    expect(listing.pending).toBeUndefined();
    expect(boot.state.ledger).toEqual([]);
  });

  it('a claudium pending re-issues the SAME dedupe key at boot and completes on the replayed ok', async () => {
    const sim = makeSim();
    const { seller, buyer, listingId } = listAndBuyer(sim, 'claudium', {
      count: 2,
      pricePerUnit: 10,
    });
    // Crash model: the anchor persisted (attach) and the transfer EXECUTED, but
    // the process died before marketPendingComplete. The service remembers the
    // dedupe key, so the boot replay returns the original ok without moving
    // money twice.
    sim.marketBuy(listingId, 2, buyer);
    sim.marketPendingAttach(listingId, {
      buyerAccountId: buyer + 1000,
      sellerAccountId: seller + 1000,
    });
    const boot = reboot(sim.serializeMarket());
    boot.state.transferOutcomes.set(`market-${listingId}-1`, { ok: true });

    await boot.orch.recoverPendingPurchases();

    expect(boot.state.transferCalls).toEqual([
      { from: buyer + 1000, to: seller + 1000, amount: 20, dedupeKey: `market-${listingId}-1` },
    ]);
    expect(boot.sim.marketListings.some((l) => l.id === listingId)).toBe(false); // whole stack sold
    expect(collections(boot.sim).get(String(buyer))?.items).toEqual([
      { itemId: 'bone_fragments', count: 2 },
    ]);
    expect(boot.state.ledger).toHaveLength(1);
    expect(boot.state.ledger[0]).toMatchObject({
      claudiumA: 20,
      context: `market-${listingId}-1`,
    });
  });

  it('a claudium pending that never anchored (no account ids) fails at boot without a transfer', async () => {
    const sim = makeSim();
    const { buyer, listingId } = listAndBuyer(sim, 'claudium', { count: 2, pricePerUnit: 10 });
    sim.marketBuy(listingId, 1, buyer); // pending, never attached
    const boot = reboot(sim.serializeMarket());

    await boot.orch.recoverPendingPurchases();

    expect(boot.state.transferCalls).toEqual([]);
    const listing = boot.sim.marketListings.find((l) => l.id === listingId)!;
    expect(listing.pending).toBeUndefined();
    expect(listing.count).toBe(2);
  });
});
