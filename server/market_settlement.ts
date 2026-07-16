// The World Market external-denomination settlement orchestrator (AH-P4).
// Server-side only, the trade_settlement.ts precedent scaled down to one-sided
// purchases: the deterministic sim locks a listing behind `pending` and emits
// the server-swallowed marketPurchaseStart event; this class drives the payment
// (an idempotent Claudium service transfer, or a wallet-to-wallet $WOC payment
// verified read-only on-chain) and resolves the pending via the sim's
// marketPendingComplete / marketPendingFail.
//
// Money invariants (the trade lessons, kept):
//  - The persisted market blob is the crash-recovery ANCHOR: the settlement
//    identity (Claudium account ids + dedupe seq, or the $WOC reference + BOTH
//    wallet pubkeys) is attached to the pending and force-saved BEFORE any money
//    can move, so recovery never depends on live sessions or surviving
//    wallet_links rows (R1c).
//  - Claudium moves through ONE dedupe key per purchase
//    (market-<listingId>-<purchaseSeq>); a boot-recovery re-issue replays to the
//    original outcome, exactly-once on the service ledger.
//  - $WOC is verified before ANY fail: every poll verifies first, so a timed-out
//    pass doubles as the final on-chain check (F1b) and a payment landing in the
//    last interval completes instead of unlocking a lot the buyer paid for.
//  - The sim does no WOC arithmetic; amounts stay opaque decimal strings here
//    and convert to BigInt base units only inside woc_trade's verifier.

import type { MarketPendingAttachDetails, MarketPendingRecord } from '../src/sim/market';
import type { ClaudiumTransferResult } from './claudium_proxy';
import type { TradeLedgerRow } from './trade_db';
import type { TradeRailsConfig } from './trade_rails_boot';
import type { SettlementSession, WocTradeApi } from './trade_settlement';
import type { VerifyWocResult } from './woc_trade';

// Cap on concurrently pending $WOC purchases (each polls the chain on the
// shared ticker). A purchase past the cap is refused IN THE ORCHESTRATOR by
// immediately failing the fresh pending (the lot unlocks, the buyer gets the
// payment-expired notice, and can retry once the window drains); the sim stays
// cap-agnostic so the copper path never pays for this bookkeeping.
const MAX_OPEN_WOC_PURCHASES = 32;

// The marketPurchaseStart accounting event the sim emits when a buyer starts an
// external-denomination purchase. Structurally matches the SimEvent variant.
export interface MarketPurchaseStartEvent {
  listingId: number;
  denom: 'claudium' | 'woc';
  buyerPid: number;
  buyerKey: string;
  sellerKey: string;
  quantity: number;
  costClaudium?: number;
  costWoc?: string;
}

// The slice of the Sim this orchestrator drives. A real Sim satisfies it
// structurally; unit tests can spy on it.
export interface MarketSettlementSimBridge {
  marketPendingAttach(listingId: number, details: MarketPendingAttachDetails): boolean;
  marketPendingComplete(listingId: number): boolean;
  marketPendingFail(listingId: number): boolean;
  marketPendingRecord(listingId: number): MarketPendingRecord | null;
  marketPendingPurchases(): MarketPendingRecord[];
}

export interface MarketSettlementsDeps {
  sim: MarketSettlementSimBridge;
  realm: string;
  // The SAME fail-closed rails config the trade orchestrator boots from
  // (trade_rails_boot.ts): the flags now also gate market listings.
  cfg: TradeRailsConfig;
  db: { insertTradeLedger(row: TradeLedgerRow): Promise<void> };
  // The raw idempotent service transfer (claudium_proxy.transferClaudium): the
  // market's dedupe keys are purchase-shaped, not trade-leg-shaped, so the
  // ClaudiumTrade leg wrapper does not fit here.
  transferClaudium(
    fromAccount: number,
    toAccount: number,
    amount: number,
    dedupeKey: string,
  ): Promise<ClaudiumTransferResult>;
  wocTrade: WocTradeApi;
  // accountId -> linked wallet pubkey (or null). One indexed SELECT.
  walletPubkeyFor(accountId: number): Promise<string | null>;
  // characterId -> owning accountId (or null). Resolves OFFLINE sellers, whose
  // listings persist across sessions keyed by character id.
  accountIdForCharacter(characterId: number): Promise<number | null>;
  // pid -> live session identity (the buyer is online at buy time: marketBuy
  // requires Merchant proximity).
  sessionFor(pid: number): SettlementSession | undefined;
  // Force a durable market-blob write (the enqueueMarketWrite queue). MUST
  // propagate failures: a pending whose settlement identity did not persist is
  // failed closed rather than settled unanchored.
  saveMarket(): Promise<void>;
  // Force an immediate durable save of the buyer's character (no-op if gone).
  forceSave(pid: number): Promise<void>;
  // Overridable for tests.
  now?: () => number;
  startTicker?: boolean;
}

interface OpenPurchase {
  listingId: number;
  buyerPid: number;
  reference: string;
  buyerWallet: string;
  sellerWallet: string;
  amountUi: string;
  createdAt: number;
  polling: boolean;
  terminal: boolean;
}

// String character-id key -> number, or null for a legacy name-shaped key.
function charIdOf(key: string): number | null {
  const id = Number(key);
  return Number.isSafeInteger(id) ? id : null;
}

export class MarketSettlements {
  private readonly purchases = new Map<number, OpenPurchase>();
  private readonly now: () => number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  // $WOC slots reserved synchronously between the cap check and track, so
  // concurrent purchase starts cannot each read size < cap and blow past
  // MAX_OPEN_WOC_PURCHASES (the trade F7g fix).
  private wocReservations = 0;

  constructor(private readonly deps: MarketSettlementsDeps) {
    this.now = deps.now ?? (() => Date.now());
    if (deps.cfg.woc && deps.startTicker !== false) {
      this.pollTimer = setInterval(() => {
        void this.pollAll();
      }, deps.cfg.woc.pollMs);
      this.pollTimer.unref?.();
    }
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  // The marketWire enrichment: the Solana Pay transfer request for THIS buyer's
  // pending $WOC purchase (the trade wocPayFor precedent), or null.
  wocPayFor(
    pid: number,
    listingId: number,
  ): { uri: string; reference: string; amountUi: string } | null {
    const rec = this.purchases.get(listingId);
    if (!rec || rec.terminal || rec.buyerPid !== pid) return null;
    const uri = this.deps.wocTrade.solanaPayUri(
      rec.sellerWallet,
      rec.amountUi,
      rec.reference,
      'WoC market',
      this.deps.cfg.woc?.mint,
    );
    return { uri, reference: rec.reference, amountUi: rec.amountUi };
  }

  // -- the purchase entry point (routeEvents hands the swallowed event here) ----

  async onMarketPurchaseStart(ev: MarketPurchaseStartEvent): Promise<void> {
    if (ev.denom === 'claudium') {
      await this.startClaudium(ev);
      return;
    }
    await this.startWoc(ev);
  }

  // Fail a fresh pending closed and persist the unlock + notify the buyer.
  private async failPending(listingId: number, buyerPid: number): Promise<void> {
    this.deps.sim.marketPendingFail(listingId);
    await this.saveAfter(buyerPid);
  }

  private async saveAfter(buyerPid: number): Promise<void> {
    await this.deps
      .saveMarket()
      .catch((err) => console.error('[market-settle] market save failed:', err));
    await this.deps
      .forceSave(buyerPid)
      .catch((err) => console.error('[market-settle] buyer save failed:', err));
  }

  private async startClaudium(ev: MarketPurchaseStartEvent): Promise<void> {
    const listingId = ev.listingId;
    const cost = Math.trunc(ev.costClaudium ?? 0);
    if (!this.deps.cfg.claudium || cost <= 0 || !Number.isSafeInteger(cost)) {
      await this.failPending(listingId, ev.buyerPid);
      return;
    }
    const session = this.deps.sessionFor(ev.buyerPid);
    const rec = session ? this.deps.sim.marketPendingRecord(listingId) : null;
    if (!session || !rec || rec.denom !== 'claudium' || rec.buyerKey !== ev.buyerKey) {
      await this.failPending(listingId, ev.buyerPid);
      return;
    }
    const sellerCharId = charIdOf(rec.sellerKey);
    const sellerAccountId =
      sellerCharId !== null
        ? await this.deps.accountIdForCharacter(sellerCharId).catch(() => null)
        : null;
    if (sellerAccountId === null) {
      await this.failPending(listingId, ev.buyerPid);
      return;
    }
    // Anchor BEFORE the transfer: persist the parties + dedupe identity inside
    // the market blob, so a crash between the service call and the completion
    // resolves at boot by replaying the SAME dedupe key. A failed save fails the
    // purchase closed; an unanchored transfer never executes.
    if (
      !this.deps.sim.marketPendingAttach(listingId, {
        buyerAccountId: session.accountId,
        sellerAccountId,
      })
    ) {
      await this.failPending(listingId, ev.buyerPid);
      return;
    }
    try {
      await this.deps.saveMarket();
    } catch (err) {
      console.error('[market-settle] failed to persist claudium purchase anchor:', err);
      await this.failPending(listingId, ev.buyerPid);
      return;
    }
    const result = await this.deps
      .transferClaudium(
        session.accountId,
        sellerAccountId,
        cost,
        `market-${listingId}-${rec.purchaseSeq}`,
      )
      .catch(() => ({ ok: false }) as ClaudiumTransferResult);
    if (result.ok) {
      // Re-read the record BEFORE completing (complete clears the pending) so
      // the ledger row carries the attached account ids.
      const finalRec = this.deps.sim.marketPendingRecord(listingId) ?? rec;
      this.deps.sim.marketPendingComplete(listingId);
      await this.writeLedger(finalRec, { claudium: cost });
    } else {
      this.deps.sim.marketPendingFail(listingId);
    }
    await this.saveAfter(ev.buyerPid);
  }

  private async startWoc(ev: MarketPurchaseStartEvent): Promise<void> {
    const listingId = ev.listingId;
    const cfg = this.deps.cfg.woc;
    if (!cfg || typeof ev.costWoc !== 'string' || ev.costWoc === '0') {
      await this.failPending(listingId, ev.buyerPid);
      return;
    }
    // Concurrency cap: refuse by failing the fresh pending immediately (the
    // documented 'busy' path); the buyer paid nothing and the lot unlocks.
    if (this.purchases.size + this.wocReservations >= MAX_OPEN_WOC_PURCHASES) {
      await this.failPending(listingId, ev.buyerPid);
      return;
    }
    this.wocReservations++;
    try {
      const session = this.deps.sessionFor(ev.buyerPid);
      const rec = session ? this.deps.sim.marketPendingRecord(listingId) : null;
      if (!session || !rec || rec.denom !== 'woc' || rec.buyerKey !== ev.buyerKey) {
        await this.failPending(listingId, ev.buyerPid);
        return;
      }
      const buyerWallet = await this.deps.walletPubkeyFor(session.accountId).catch(() => null);
      const sellerCharId = charIdOf(rec.sellerKey);
      const sellerAccountId =
        sellerCharId !== null
          ? await this.deps.accountIdForCharacter(sellerCharId).catch(() => null)
          : null;
      const sellerWallet =
        sellerAccountId !== null
          ? await this.deps.walletPubkeyFor(sellerAccountId).catch(() => null)
          : null;
      if (!buyerWallet || !sellerWallet) {
        await this.failPending(listingId, ev.buyerPid);
        return;
      }
      // Anchor BEFORE the payment request ever renders: the reference + BOTH
      // wallet pubkeys (+ account ids for the audit row) persist inside the
      // market blob, so a crash at any later point re-verifies at boot without
      // live sessions or surviving wallet_links (the trade R1c lesson).
      const reference = this.deps.wocTrade.makeReference();
      if (
        !this.deps.sim.marketPendingAttach(listingId, {
          reference,
          buyerWallet,
          sellerWallet,
          buyerAccountId: session.accountId,
          sellerAccountId: sellerAccountId ?? undefined,
        })
      ) {
        await this.failPending(listingId, ev.buyerPid);
        return;
      }
      try {
        await this.deps.saveMarket();
      } catch (err) {
        console.error('[market-settle] failed to persist woc purchase anchor:', err);
        await this.failPending(listingId, ev.buyerPid);
        return;
      }
      this.purchases.set(listingId, {
        listingId,
        buyerPid: ev.buyerPid,
        reference,
        buyerWallet,
        sellerWallet,
        amountUi: ev.costWoc,
        createdAt: this.now(),
        polling: false,
        terminal: false,
      });
      // Verify once now (the payer may be fast); the shared ticker keeps polling.
      await this.pollPurchase(this.purchases.get(listingId) as OpenPurchase);
    } finally {
      this.wocReservations--;
    }
  }

  // -- $WOC polling ---------------------------------------------------------

  async pollOnce(): Promise<void> {
    await this.pollAll();
  }

  private async pollAll(): Promise<void> {
    for (const rec of [...this.purchases.values()]) {
      if (rec.terminal || rec.polling) continue;
      await this.pollPurchase(rec);
    }
  }

  private async pollPurchase(rec: OpenPurchase): Promise<void> {
    const cfg = this.deps.cfg.woc;
    if (!cfg || rec.terminal || rec.polling) return;
    rec.polling = true;
    try {
      const timedOut = this.now() - rec.createdAt > cfg.timeoutMs;
      // Verify FIRST, every pass: on a timed-out pass this doubles as the FINAL
      // on-chain check before unlocking (the trade F1b lesson), so a payment
      // that landed in the last poll interval completes instead of stranding
      // the buyer's money against an unlocked lot.
      const res = await this.deps.wocTrade
        .verifyWocPayment(cfg, {
          reference: rec.reference,
          payerPubkey: rec.buyerWallet,
          recipientPubkey: rec.sellerWallet,
          amountUi: rec.amountUi,
        })
        .catch(() => 'pending' as VerifyWocResult);
      if (typeof res === 'object' && 'signature' in res) {
        rec.terminal = true;
        const pendingRec = this.deps.sim.marketPendingRecord(rec.listingId);
        this.deps.sim.marketPendingComplete(rec.listingId);
        if (pendingRec) await this.writeLedger(pendingRec, { woc: rec.amountUi });
        this.purchases.delete(rec.listingId);
        await this.saveAfter(rec.buyerPid);
        return;
      }
      if (timedOut) {
        rec.terminal = true;
        this.deps.sim.marketPendingFail(rec.listingId);
        this.purchases.delete(rec.listingId);
        await this.saveAfter(rec.buyerPid);
      }
    } finally {
      rec.polling = false;
    }
  }

  // -- audit ------------------------------------------------------------------

  // Append-only trade_ledger row for a COMPLETED external market sale: A = the
  // buyer (paid claudium/woc), B = the seller (gave the goods). settlement_id
  // stays null (that column is trade-settlement-shaped); the context marker
  // carries the market provenance + dedupe identity instead.
  private async writeLedger(
    rec: MarketPendingRecord,
    moved: { claudium?: number; woc?: string },
  ): Promise<void> {
    await this.deps.db
      .insertTradeLedger({
        realm: this.deps.realm,
        settlementId: null,
        context: `market-${rec.listingId}-${rec.purchaseSeq}`,
        charAId: charIdOf(rec.buyerKey),
        charBId: charIdOf(rec.sellerKey),
        accountAId: rec.buyerAccountId ?? null,
        accountBId: rec.sellerAccountId ?? null,
        charAName: rec.buyerName,
        charBName: rec.sellerName,
        itemsA: [],
        copperA: 0,
        itemsB: [{ itemId: rec.itemId, count: rec.quantity }],
        copperB: 0,
        claudiumA: moved.claudium ?? 0,
        claudiumB: 0,
        wocA: moved.woc ?? '0',
        wocB: '0',
      })
      .catch((err) => console.error('[market-settle] market ledger insert failed:', err));
  }

  // -- boot recovery ------------------------------------------------------------

  // Resolve every pending external purchase the loaded market blob carries (the
  // blob IS the anchor; no settlement table exists for the market). $WOC with a
  // persisted reference re-verifies ONCE against the persisted wallet pubkeys:
  // verified -> complete, else -> fail (unlock; a $WOC wait never resumes across
  // a restart, the trade doctrine). A pre-anchor $WOC pending (no reference: the
  // crash landed before the payment request ever rendered) fails outright.
  // Claudium re-issues the idempotent transfer with the SAME dedupe key; the
  // service replays to the original outcome, so this is exactly-once.
  async recoverPendingPurchases(): Promise<void> {
    let pending: MarketPendingRecord[];
    try {
      pending = this.deps.sim.marketPendingPurchases();
    } catch (err) {
      console.error('[market-settle] failed to enumerate pending purchases:', err);
      return;
    }
    for (const rec of pending) {
      try {
        await this.recoverOne(rec);
      } catch (err) {
        console.error(`[market-settle] recovery failed for listing ${rec.listingId}:`, err);
      }
    }
    if (pending.length > 0) {
      await this.deps
        .saveMarket()
        .catch((err) => console.error('[market-settle] recovery market save failed:', err));
    }
  }

  private async recoverOne(rec: MarketPendingRecord): Promise<void> {
    if (rec.denom === 'woc') {
      const cfg = this.deps.cfg.woc;
      if (cfg && rec.reference && rec.buyerWallet && rec.sellerWallet && rec.costWoc) {
        const res = await this.deps.wocTrade
          .verifyWocPayment(cfg, {
            reference: rec.reference,
            payerPubkey: rec.buyerWallet,
            recipientPubkey: rec.sellerWallet,
            amountUi: rec.costWoc,
          })
          .catch(() => 'pending' as VerifyWocResult);
        if (typeof res === 'object' && 'signature' in res) {
          this.deps.sim.marketPendingComplete(rec.listingId);
          await this.writeLedger(rec, { woc: rec.costWoc });
          return;
        }
      }
      this.deps.sim.marketPendingFail(rec.listingId);
      return;
    }
    if (
      this.deps.cfg.claudium &&
      rec.costClaudium !== undefined &&
      Number.isSafeInteger(rec.costClaudium) &&
      rec.costClaudium > 0 &&
      rec.buyerAccountId !== undefined &&
      rec.sellerAccountId !== undefined
    ) {
      const result = await this.deps
        .transferClaudium(
          rec.buyerAccountId,
          rec.sellerAccountId,
          rec.costClaudium,
          `market-${rec.listingId}-${rec.purchaseSeq}`,
        )
        .catch(() => ({ ok: false }) as ClaudiumTransferResult);
      if (result.ok) {
        this.deps.sim.marketPendingComplete(rec.listingId);
        await this.writeLedger(rec, { claudium: rec.costClaudium });
        return;
      }
    }
    // Never anchored (no account ids persisted) or the replay refused: unlock.
    this.deps.sim.marketPendingFail(rec.listingId);
  }
}
