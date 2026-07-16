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
//    (market-<realm>-<listingId>-<purchaseSeq>); a boot-recovery re-issue
//    replays to the original outcome, exactly-once on the service ledger. The
//    key is REALM-SCOPED because listingId and purchaseSeq are both per-realm
//    counters (the market blob lives under market:<realm> and both start at 1
//    in every realm) while the economy service and its dedupe ledger are
//    account-global: two realms sharing one DB would otherwise mint colliding
//    keys and replay each other's outcomes.
//  - An AMBIGUOUS Claudium transfer failure (service unreachable, lost
//    response, timeout: reason 'unavailable') NEVER fails the pending: the
//    transfer may have committed on the service ledger, so unlocking would
//    hand the goods back while the buyer's Claudium is gone. The pending stays
//    locked and anchored, and the SAME dedupe key retries on the shared poll
//    ticker (and idempotently across boots) until the service answers either
//    way; past the woc timeout window it keeps retrying and logs loudly every
//    poll. Only a DEFINITIVE service refusal (ok:false with a concrete reason
//    such as 'insufficient') fails the pending closed.
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

// Cap on concurrent Claudium purchases, the same reservation pattern: each
// start costs an account lookup, two full-blob market writes, and a ledger
// insert against the shared DB pool, so an unthrottled burst can starve
// unrelated requests (r4#1). Past the cap the fresh pending fails immediately.
const MAX_OPEN_CLAUDIUM_PURCHASES = 32;

// Per-buyer cooldown after a $WOC purchase times out UNPAID: starting a
// pending costs the buyer nothing yet locks the lot for the full timeout, so
// without a cooldown one wallet-linked account can re-lock a rival's lot the
// tick after each expiry, forever (r3#3). A pending started during the
// cooldown is immediately failed via the existing busy path.
const MARKET_WOC_RETRY_COOLDOWN_MS = 120_000;
// Bound on the cooldown map so hostile buyerKeys can never grow it without
// limit; expired entries are evicted first, then the oldest live one.
const MAX_WOC_COOLDOWN_ENTRIES = 4096;

// Claudium retry cadence/window fallbacks when the $WOC rail (whose pollMs /
// timeoutMs the retry ticker reuses) is not configured. Same defaults as
// trade_rails_boot's DEFAULT_WOC_TRADE_POLL_MS / DEFAULT_WOC_TRADE_TIMEOUT_MS.
const DEFAULT_CLAUDIUM_RETRY_POLL_MS = 5000;
const DEFAULT_CLAUDIUM_RETRY_WINDOW_MS = 180_000;

// A DEFINITIVE service refusal carries a concrete reason ('insufficient',
// 'declined', ...). Everything else (reason 'unavailable', a missing reason
// from a malformed body, the defensive .catch path) is AMBIGUOUS: the
// transfer may have committed, so the caller must keep the pending locked.
function claudiumRefusalIsDefinitive(result: ClaudiumTransferResult): boolean {
  return !result.ok && typeof result.reason === 'string' && result.reason !== 'unavailable';
}

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
  // The buyer's CURRENT live pid for a stable buyerKey (null when offline):
  // payment requests and completion force-saves must survive a relog, which
  // mints a new pid but keeps the character-id-shaped key (r3#4).
  marketBuyerPid(buyerKey: string): number | null;
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
  buyerKey: string;
  reference: string;
  buyerWallet: string;
  sellerWallet: string;
  amountUi: string;
  createdAt: number;
  polling: boolean;
  terminal: boolean;
}

// A Claudium purchase whose transfer came back AMBIGUOUS (service
// unavailable): the pending stays locked and the SAME dedupe key retries on
// the shared ticker until the service answers either way (see module header).
interface ClaudiumRetry {
  listingId: number;
  buyerPid: number;
  buyerKey: string;
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  dedupeKey: string;
  createdAt: number;
  polling: boolean;
}

// String character-id key -> number, or null for a legacy name-shaped key
// (Number('') is 0, so an empty key is rejected explicitly, never id 0).
function charIdOf(key: string): number | null {
  if (key === '') return null;
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
  // Claudium slots, the same synchronous reservation pattern (r4#1). Parked
  // ambiguous retries (claudiumRetries) count against the cap too.
  private claudiumReservations = 0;
  // listingId -> the parked ambiguous Claudium purchase retrying on the ticker.
  private readonly claudiumRetries = new Map<number, ClaudiumRetry>();
  // buyerKey -> cooldown end (ms) after an unpaid $WOC timeout (r3#3).
  private readonly wocCooldowns = new Map<string, number>();

  constructor(private readonly deps: MarketSettlementsDeps) {
    this.now = deps.now ?? (() => Date.now());
    // The shared poll ticker drives $WOC verification AND ambiguous-Claudium
    // retries, so it runs when EITHER rail is configured.
    if ((deps.cfg.woc || deps.cfg.claudium) && deps.startTicker !== false) {
      this.pollTimer = setInterval(() => {
        void this.pollAll();
      }, deps.cfg.woc?.pollMs ?? DEFAULT_CLAUDIUM_RETRY_POLL_MS);
      this.pollTimer.unref?.();
    }
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  // The buyer's CURRENT live pid for a purchase record: resolved by the
  // stable buyerKey (relog-safe, r3#4), falling back to the pid recorded at
  // purchase start (forceSave no-ops on a gone pid).
  private livePid(buyerKey: string, fallbackPid: number): number {
    return this.deps.sim.marketBuyerPid(buyerKey) ?? fallbackPid;
  }

  // The Claudium dedupe key: realm-scoped (see the module header; listingId
  // and purchaseSeq are per-realm counters, the service ledger is global).
  private claudiumDedupeKey(listingId: number, purchaseSeq: number): string {
    return `market-${this.deps.realm}-${listingId}-${purchaseSeq}`;
  }

  // The marketWire enrichment: the Solana Pay transfer request for THIS buyer's
  // pending $WOC purchase (the trade wocPayFor precedent), or null. Keyed to
  // the buyer's CURRENT session via buyerKey, not the pid recorded at purchase
  // start: a relog inside the payment window mints a new pid and must still
  // receive its payment request (r3#4).
  wocPayFor(
    pid: number,
    listingId: number,
  ): { uri: string; reference: string; amountUi: string } | null {
    const rec = this.purchases.get(listingId);
    if (!rec || rec.terminal || this.livePid(rec.buyerKey, rec.buyerPid) !== pid) return null;
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
    // Concurrency cap (the woc reservation pattern, r4#1): the check and the
    // reservation are SYNCHRONOUS, before any await, so concurrent starts
    // cannot each read below the cap. Parked ambiguous retries hold slots too.
    if (this.claudiumRetries.size + this.claudiumReservations >= MAX_OPEN_CLAUDIUM_PURCHASES) {
      await this.failPending(listingId, ev.buyerPid);
      return;
    }
    this.claudiumReservations++;
    try {
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
      const dedupeKey = this.claudiumDedupeKey(listingId, rec.purchaseSeq);
      const result = await this.deps
        .transferClaudium(session.accountId, sellerAccountId, cost, dedupeKey)
        .catch(() => ({ ok: false, reason: 'unavailable' }) as ClaudiumTransferResult);
      if (result.ok) {
        // Re-read the record BEFORE completing (complete clears the pending) so
        // the ledger row carries the attached account ids.
        const finalRec = this.deps.sim.marketPendingRecord(listingId) ?? rec;
        this.deps.sim.marketPendingComplete(listingId);
        await this.writeLedger(finalRec, { claudium: cost });
      } else if (claudiumRefusalIsDefinitive(result)) {
        this.deps.sim.marketPendingFail(listingId);
      } else {
        // AMBIGUOUS (service unreachable / lost response): the transfer may
        // have committed, so the pending stays locked and anchored; the SAME
        // dedupe key retries on the shared ticker (see the module header).
        this.trackClaudiumRetry({
          listingId,
          buyerPid: ev.buyerPid,
          buyerKey: rec.buyerKey,
          fromAccountId: session.accountId,
          toAccountId: sellerAccountId,
          amount: cost,
          dedupeKey,
        });
        console.error(
          `[market-settle] claudium transfer ambiguous (service unavailable) for ${dedupeKey}; keeping the pending locked and retrying the same dedupe key`,
        );
        return;
      }
      await this.saveAfter(this.livePid(rec.buyerKey, ev.buyerPid));
    } finally {
      this.claudiumReservations--;
    }
  }

  private trackClaudiumRetry(
    retry: Omit<ClaudiumRetry, 'createdAt' | 'polling'> & { createdAt?: number },
  ): void {
    if (this.claudiumRetries.has(retry.listingId)) return;
    this.claudiumRetries.set(retry.listingId, {
      ...retry,
      createdAt: retry.createdAt ?? this.now(),
      polling: false,
    });
  }

  private async startWoc(ev: MarketPurchaseStartEvent): Promise<void> {
    const listingId = ev.listingId;
    const cfg = this.deps.cfg.woc;
    if (!cfg || typeof ev.costWoc !== 'string' || ev.costWoc === '0') {
      await this.failPending(listingId, ev.buyerPid);
      return;
    }
    // Per-buyer cooldown after an unpaid timeout (r3#3): refuse via the same
    // busy path (immediate fail, nothing paid, the lot unlocks).
    if (this.wocCoolingDown(ev.buyerKey)) {
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
        buyerKey: ev.buyerKey,
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

  // -- the woc cooldown bookkeeping (r3#3) ------------------------------------

  private wocCoolingDown(buyerKey: string): boolean {
    const until = this.wocCooldowns.get(buyerKey);
    if (until === undefined) return false;
    if (until <= this.now()) {
      this.wocCooldowns.delete(buyerKey);
      return false;
    }
    return true;
  }

  private noteWocCooldown(buyerKey: string): void {
    const now = this.now();
    if (this.wocCooldowns.size >= MAX_WOC_COOLDOWN_ENTRIES) {
      for (const [key, until] of this.wocCooldowns) {
        if (until <= now) this.wocCooldowns.delete(key);
      }
      // Still saturated with live entries: drop the oldest (insertion order),
      // bounding memory over punishing one more buyer.
      if (this.wocCooldowns.size >= MAX_WOC_COOLDOWN_ENTRIES) {
        const oldest = this.wocCooldowns.keys().next();
        if (!oldest.done) this.wocCooldowns.delete(oldest.value);
      }
    }
    this.wocCooldowns.set(buyerKey, now + MARKET_WOC_RETRY_COOLDOWN_MS);
  }

  // -- $WOC polling + ambiguous-Claudium retries ------------------------------

  async pollOnce(): Promise<void> {
    await this.pollAll();
  }

  private async pollAll(): Promise<void> {
    for (const rec of [...this.purchases.values()]) {
      if (rec.terminal || rec.polling) continue;
      await this.pollPurchase(rec);
    }
    for (const rec of [...this.claudiumRetries.values()]) {
      if (rec.polling) continue;
      await this.retryClaudium(rec);
    }
  }

  // One retry pass for a parked ambiguous Claudium purchase: re-issue the SAME
  // dedupe key (idempotent on the service ledger). ok -> complete; a definitive
  // refusal -> fail closed; still ambiguous -> keep the pending locked, and log
  // loudly every pass once the window has elapsed. NEVER auto-failed: the
  // original transfer may have committed (see the module header).
  private async retryClaudium(rec: ClaudiumRetry): Promise<void> {
    rec.polling = true;
    try {
      const pending = this.deps.sim.marketPendingRecord(rec.listingId);
      if (!pending) {
        // Resolved out from under us (should not happen): stop tracking.
        this.claudiumRetries.delete(rec.listingId);
        return;
      }
      const result = await this.deps
        .transferClaudium(rec.fromAccountId, rec.toAccountId, rec.amount, rec.dedupeKey)
        .catch(() => ({ ok: false, reason: 'unavailable' }) as ClaudiumTransferResult);
      if (result.ok) {
        this.claudiumRetries.delete(rec.listingId);
        this.deps.sim.marketPendingComplete(rec.listingId);
        await this.writeLedger(pending, { claudium: rec.amount });
        await this.saveAfter(this.livePid(rec.buyerKey, rec.buyerPid));
        return;
      }
      if (claudiumRefusalIsDefinitive(result)) {
        this.claudiumRetries.delete(rec.listingId);
        this.deps.sim.marketPendingFail(rec.listingId);
        await this.saveAfter(this.livePid(rec.buyerKey, rec.buyerPid));
        return;
      }
      const windowMs = this.deps.cfg.woc?.timeoutMs ?? DEFAULT_CLAUDIUM_RETRY_WINDOW_MS;
      if (this.now() - rec.createdAt > windowMs) {
        console.error(
          `[market-settle] claudium purchase ${rec.dedupeKey} still unresolved after ${windowMs} ms: the economy service is not answering; the pending stays locked (never auto-failed) and the same dedupe key keeps retrying`,
        );
      }
    } finally {
      rec.polling = false;
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
        await this.saveAfter(this.livePid(rec.buyerKey, rec.buyerPid));
        return;
      }
      if (timedOut) {
        rec.terminal = true;
        this.deps.sim.marketPendingFail(rec.listingId);
        this.purchases.delete(rec.listingId);
        // An unpaid timeout starts the buyer's retry cooldown (r3#3): the
        // pending was a free lock on someone else's lot for the full window.
        this.noteWocCooldown(rec.buyerKey);
        await this.saveAfter(this.livePid(rec.buyerKey, rec.buyerPid));
      }
    } finally {
      rec.polling = false;
    }
  }

  // -- audit ------------------------------------------------------------------

  // Append-only trade_ledger row for a COMPLETED external market sale: A = the
  // buyer (paid claudium/woc), B = the seller (gave the goods). settlement_id
  // stays null (that column is trade-settlement-shaped); the context marker
  // carries the market provenance + dedupe identity instead (realm-scoped,
  // matching the Claudium dedupe key). A failed insert retries ONCE, then logs
  // a LEDGER-GAP marker with the context key so an operator can backfill.
  private async writeLedger(
    rec: MarketPendingRecord,
    moved: { claudium?: number; woc?: string },
  ): Promise<void> {
    const row: TradeLedgerRow = {
      realm: this.deps.realm,
      settlementId: null,
      context: `market-${this.deps.realm}-${rec.listingId}-${rec.purchaseSeq}`,
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
    };
    try {
      await this.deps.db.insertTradeLedger(row);
    } catch {
      try {
        await this.deps.db.insertTradeLedger(row);
      } catch (err) {
        console.error(
          `[market-settle] LEDGER-GAP ${row.context}: ledger insert failed twice; real money moved with no audit row:`,
          err,
        );
      }
    }
  }

  // -- boot recovery ------------------------------------------------------------

  // Resolve every pending external purchase the loaded market blob carries (the
  // blob IS the anchor; no settlement table exists for the market). $WOC with a
  // persisted reference re-verifies ONCE against the persisted wallet pubkeys:
  // verified -> complete, else -> fail (unlock; a $WOC wait never resumes across
  // a restart, the trade doctrine). A pre-anchor $WOC pending (no reference: the
  // crash landed before the payment request ever rendered) fails outright.
  // Claudium re-issues the idempotent transfer with the SAME dedupe key; the
  // service replays to the original outcome, so this is exactly-once. If the
  // service is UNAVAILABLE at boot the pending is KEPT, not failed (the
  // pre-crash transfer may have committed), and keeps retrying on the ticker.
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
      const dedupeKey = this.claudiumDedupeKey(rec.listingId, rec.purchaseSeq);
      const result = await this.deps
        .transferClaudium(rec.buyerAccountId, rec.sellerAccountId, rec.costClaudium, dedupeKey)
        .catch(() => ({ ok: false, reason: 'unavailable' }) as ClaudiumTransferResult);
      if (result.ok) {
        this.deps.sim.marketPendingComplete(rec.listingId);
        await this.writeLedger(rec, { claudium: rec.costClaudium });
        return;
      }
      if (!claudiumRefusalIsDefinitive(result)) {
        // AMBIGUOUS at boot (service down): the pre-crash transfer may have
        // committed, so the pending is KEPT locked and the same dedupe key
        // keeps retrying on the ticker (never auto-failed; module header).
        this.trackClaudiumRetry({
          listingId: rec.listingId,
          buyerPid: this.deps.sim.marketBuyerPid(rec.buyerKey) ?? -1,
          buyerKey: rec.buyerKey,
          fromAccountId: rec.buyerAccountId,
          toAccountId: rec.sellerAccountId,
          amount: rec.costClaudium,
          dedupeKey,
        });
        console.error(
          `[market-settle] claudium recovery ambiguous (service unavailable) for ${dedupeKey}; keeping the pending locked and retrying the same dedupe key`,
        );
        return;
      }
    }
    // Never anchored (no account ids persisted) or the replay refused: unlock.
    this.deps.sim.marketPendingFail(rec.listingId);
  }
}
