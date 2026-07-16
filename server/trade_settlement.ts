// The external-lane trade settlement orchestrator (P1). Server-side only; the
// deterministic sim escrows both offers and parks the session in 'settling', then
// this class drives the reversible Claudium legs and the non-custodial $WOC legs
// to completion (deliver escrow crosswise) or unwind (return escrow, refund
// executed Claudium legs). It owns the crash-recovery anchor (a trade_settlements
// row + an immediate forced character save) so a process death at any point
// resolves deterministically from the row on next boot.
//
// State machine per settlement:
//   escrowed -> [claudium legs] -> claudium_done -> [woc legs] -> completed
//   any failure / timeout / pre-commit cancel -> refunded (escrow returned)
// Money invariants: Claudium moves through idempotent dedupe-keyed service
// transfers (reversible); $WOC is verified read-only on-chain (irreversible), so a
// cancel is REFUSED once any $WOC leg is verified. Whole-unit amounts stay
// integers; $WOC UI amounts stay opaque strings until woc_trade converts them to
// BigInt base units for verification.

import type { TradeSession } from '../src/sim/sim';
import { type InvSlot, OFFLINE_TRADE_RAILS, type TradeRailsView } from '../src/sim/types';
import type { TradeSettleStatus } from '../src/world_api/trade';
import { claudiumServiceConfigured } from './claudium_proxy';
import type { ClaudiumTrade } from './claudium_trade';
import type {
  InsertTradeSettlementInput,
  MarkTradeSettlementPatch,
  TradeEscrow,
  TradeLedgerRow,
  TradePairSaveSide,
  TradeSettlementRow,
  TradeSettlementStatus,
} from './trade_db';
import type { TradeRailsConfig } from './trade_rails_boot';
import type { VerifyWocInput, VerifyWocResult, WocTradeConfig } from './woc_trade';

// Cap on concurrently open settlements that hold a $WOC leg (each polls the chain
// on a shared ticker). A trade adding a $WOC pledge past the cap is refused at
// creation and its escrow is returned.
const MAX_OPEN_SETTLEMENTS = 32;

// How often accounts with an open settlement have their cached Claudium balance +
// wallet link refreshed (the sim's synchronous rails view reads only the cache).
// Doubles as the per-account refresh cooldown (fix F4): the ticker fires at this
// cadence and a trade-request-driven refresh within the same window is a no-op.
const ACCOUNT_REFRESH_MS = 60_000;

// Hard cap on the per-account refresh-cooldown map so a long-lived process does
// not accrete one entry per distinct account ever seen (oldest-by-insertion
// eviction, mirroring server/steam/mirror.ts's link cache).
const REFRESH_TRACK_MAX = 8192;

// The tradeLedger accounting event the sim emits after a trade changes goods hands
// (both lanes). Structurally matches the SimEvent variant.
export interface TradeLedgerEvent {
  a: number;
  b: number;
  itemsA: InvSlot[];
  itemsB: InvSlot[];
  copperA: number;
  copperB: number;
  claudiumA: number;
  claudiumB: number;
  wocA: string;
  wocB: string;
}

// Minimal per-pid identity the orchestrator needs (game.ts resolves it from its
// live client map).
export interface SettlementSession {
  accountId: number;
  characterId: number;
  leaseNonce?: string;
  name: string;
}

// The slice of the Sim the orchestrator drives. Kept as an interface so tests pass
// a real Sim (structurally compatible) and unit tests can spy on it.
export interface SettlementSimBridge {
  tradeFor(pid: number): TradeSession | null;
  tradeSettleComplete(pid: number): void;
  tradeSettleFail(pid: number, reason: 'timeout' | 'cancelled' | 'unavailable'): void;
  sendTradeLetter(
    recipientKey: string,
    recipientName: string,
    flavor: 'delivery' | 'refund',
    copper: number,
    items: InvSlot[],
  ): void;
}

export interface SettlementDb {
  // The escrow anchor: INSERT the settlement row AND both post-escrow character
  // rows in one transaction (fix F2). Returns the new id, or null on a lease-fence
  // miss (nothing persisted).
  insertSettlementAndSaveBoth(
    input: InsertTradeSettlementInput,
    sideA: TradePairSaveSide,
    sideB: TradePairSaveSide,
  ): Promise<number | null>;
  markTradeSettlement(
    id: number,
    status: TradeSettlementStatus,
    patch?: MarkTradeSettlementPatch,
  ): Promise<void>;
  loadOpenTradeSettlements(realm: string): Promise<TradeSettlementRow[]>;
  // Atomically claim one open row for recovery (fix F3); null when another process
  // already claimed it.
  claimTradeSettlementForRecovery(id: number): Promise<TradeSettlementRow | null>;
  insertTradeLedger(row: TradeLedgerRow): Promise<void>;
}

export interface WocTradeApi {
  makeReference(): string;
  solanaPayUri(
    recipientPubkey: string,
    amountUi: string,
    reference: string,
    label: string,
    mint?: string,
  ): string;
  verifyWocPayment(cfg: WocTradeConfig, input: VerifyWocInput): Promise<VerifyWocResult>;
}

export interface TradeSettlementsDeps {
  sim: SettlementSimBridge;
  realm: string;
  cfg: TradeRailsConfig;
  db: SettlementDb;
  claudiumTrade: ClaudiumTrade;
  wocTrade: WocTradeApi;
  // accountId -> linked wallet pubkey (or null). One indexed SELECT.
  walletPubkeyFor(accountId: number): Promise<string | null>;
  // pid -> live session identity (or undefined when the pid is not a live client).
  sessionFor(pid: number): SettlementSession | undefined;
  // pid -> a lease-fenced save side (serialized character + level + lease nonce)
  // for the atomic escrow anchor. null when the pid is not a live client. Uses the
  // exact serialization the classic pair-save path uses (game.ts serializeCharacter).
  saveSideFor(pid: number): TradePairSaveSide | null;
  // Force an immediate durable save of the character on this pid (no-op if gone).
  // Used by the terminal transitions (complete/unwind), not the initial anchor.
  forceSave(pid: number): Promise<void>;
  // Classic-lane durable two-row pair save + ledger insert (game.ts serializes).
  savePairAndLedger(a: number, b: number, ledger: TradeLedgerRow): Promise<void>;
  // Overridable for tests.
  claudiumConfigured?: () => boolean;
  now?: () => number;
  startTicker?: boolean;
}

interface OpenSettlement {
  id: number;
  a: number;
  b: number;
  charAId: number | null;
  charBId: number | null;
  accountAId: number;
  accountBId: number;
  charAName: string;
  charBName: string;
  charAKey: string;
  charBKey: string;
  escrowA: TradeEscrow;
  escrowB: TradeEscrow;
  claudiumA: number;
  claudiumB: number;
  wocA: string;
  wocB: string;
  wocARef: string | null;
  wocBRef: string | null;
  wocASig: string | null;
  wocBSig: string | null;
  wocAPayer: string | null;
  wocARecipient: string | null;
  wocBPayer: string | null;
  wocBRecipient: string | null;
  status: TradeSettlementStatus;
  claudiumExecA: boolean;
  claudiumExecB: boolean;
  createdAt: number;
  polling: boolean;
  terminal: boolean;
}

function leg(exists: boolean, done: boolean): 'none' | 'pending' | 'done' {
  if (!exists) return 'none';
  return done ? 'done' : 'pending';
}

// The subset of settlement fields writeUnwindLedger reads. Both the live in-memory
// OpenSettlement and the loaded TradeSettlementRow (recovery) structurally satisfy
// it, so the live unwind and the recovery refund branch record identical rows (R2).
interface UnwindLedgerSource {
  id: number;
  charAId: number | null;
  charBId: number | null;
  accountAId: number | null;
  accountBId: number | null;
  charAName: string;
  charBName: string;
  claudiumExecA: boolean;
  claudiumExecB: boolean;
  claudiumA: number;
  claudiumB: number;
  wocASig: string | null;
  wocBSig: string | null;
  wocA: string;
  wocB: string;
}

export class TradeSettlements {
  private readonly settlements = new Set<OpenSettlement>();
  private readonly byPid = new Map<number, OpenSettlement>();
  private readonly walletCache = new Map<number, string | null>();
  private readonly now: () => number;
  private readonly claudiumConfigured: () => boolean;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  // $WOC settlement slots reserved synchronously between the cap check and track()
  // so N concurrent onTradeSettle calls cannot each read size < cap and blow past
  // MAX_OPEN_SETTLEMENTS before any of them is tracked (fix F7g). A per-account
  // refresh cooldown throttles the trade-request-driven balance/link refresh (F4).
  private wocReservations = 0;
  private readonly lastRefreshMs = new Map<number, number>();

  constructor(private readonly deps: TradeSettlementsDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.claudiumConfigured = deps.claudiumConfigured ?? claudiumServiceConfigured;
    if (deps.cfg.woc && deps.startTicker !== false) {
      this.pollTimer = setInterval(() => {
        void this.pollAll();
      }, deps.cfg.woc.pollMs);
      this.pollTimer.unref?.();
      this.refreshTimer = setInterval(() => {
        void this.refreshOpenAccounts();
      }, ACCOUNT_REFRESH_MS);
      this.refreshTimer.unref?.();
    }
  }

  // Clean shutdown: stop the timers. Recovery covers a crash; a clean shutdown
  // mid-settlement recovers identically on next boot.
  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.pollTimer = null;
    this.refreshTimer = null;
  }

  private track(rec: OpenSettlement): void {
    this.settlements.add(rec);
    this.byPid.set(rec.a, rec);
    this.byPid.set(rec.b, rec);
  }

  private untrack(rec: OpenSettlement): void {
    this.settlements.delete(rec);
    if (this.byPid.get(rec.a) === rec) this.byPid.delete(rec.a);
    if (this.byPid.get(rec.b) === rec) this.byPid.delete(rec.b);
  }

  // -- rails view + settle progress (read by the sim cfg + the trade wire) -------

  tradeRailsView(pid: number): TradeRailsView {
    const session = this.deps.sessionFor(pid);
    if (!session) return OFFLINE_TRADE_RAILS;
    return {
      claudium: {
        available: this.deps.cfg.claudium && this.claudiumConfigured(),
        balance: this.deps.claudiumTrade.claudiumBalanceFor(session.accountId),
      },
      woc: {
        available: this.deps.cfg.woc !== null,
        linked: Boolean(this.walletCache.get(session.accountId)),
      },
    };
  }

  settleStatusFor(pid: number): TradeSettleStatus | null {
    const rec = this.byPid.get(pid);
    if (!rec) return null;
    const claudiumSettled = rec.status !== 'escrowed';
    const mineA = pid === rec.a;
    const claudiumMine = leg((mineA ? rec.claudiumA : rec.claudiumB) > 0, claudiumSettled);
    const claudiumTheirs = leg((mineA ? rec.claudiumB : rec.claudiumA) > 0, claudiumSettled);
    const wocMine = leg(
      (mineA ? rec.wocA : rec.wocB) !== '0',
      Boolean(mineA ? rec.wocASig : rec.wocBSig),
    );
    const wocTheirs = leg(
      (mineA ? rec.wocB : rec.wocA) !== '0',
      Boolean(mineA ? rec.wocBSig : rec.wocASig),
    );
    return { claudiumMine, claudiumTheirs, wocMine, wocTheirs };
  }

  wocPayFor(pid: number): { uri: string; reference: string; amountUi: string } | null {
    const rec = this.byPid.get(pid);
    if (!rec) return null;
    const mineA = pid === rec.a;
    const amount = mineA ? rec.wocA : rec.wocB;
    const sig = mineA ? rec.wocASig : rec.wocBSig;
    const ref = mineA ? rec.wocARef : rec.wocBRef;
    const recipient = mineA ? rec.wocARecipient : rec.wocBRecipient;
    if (amount === '0' || sig !== null || ref === null || recipient === null) return null;
    const label = `Trade with ${mineA ? rec.charBName : rec.charAName}`;
    const uri = this.deps.wocTrade.solanaPayUri(
      recipient,
      amount,
      ref,
      label,
      this.deps.cfg.woc?.mint,
    );
    return { uri, reference: ref, amountUi: amount };
  }

  // -- account cache refresh -----------------------------------------------------

  // Refresh the Claudium balance + wallet-link cache for one account. Called by
  // game.ts on join and on a valid trade request, and by the 60s ticker for
  // accounts with an open settlement.
  //
  // Two gates make this safe against a client spamming trade_req (fix F4/r7#1):
  //   1) both rails off  -> nothing to refresh (neither the wallet_links SELECT nor
  //      the Claudium-service HTTP call ever fires with the feature disabled), and
  //   2) a per-account cooldown so repeated requests within one refresh interval
  //      are no-ops rather than a DB SELECT + an economy-service round trip each.
  async refreshAccount(accountId: number): Promise<void> {
    if (!this.deps.cfg.claudium && !this.deps.cfg.woc) return;
    const now = this.now();
    const last = this.lastRefreshMs.get(accountId);
    if (last !== undefined && now - last < ACCOUNT_REFRESH_MS) return;
    // Bounded insert (mirrors server/steam/mirror.ts LINK_CACHE): only a NEW key at
    // the cap evicts, oldest-by-insertion first, so a long-lived process never
    // accretes one entry per distinct account ever seen.
    if (!this.lastRefreshMs.has(accountId) && this.lastRefreshMs.size >= REFRESH_TRACK_MAX) {
      const oldest = this.lastRefreshMs.keys().next().value;
      if (oldest !== undefined) this.lastRefreshMs.delete(oldest);
    }
    this.lastRefreshMs.set(accountId, now);
    const pubkey = await this.deps.walletPubkeyFor(accountId).catch(() => null);
    this.walletCache.set(accountId, pubkey);
    await this.deps.claudiumTrade.refresh(accountId).catch(() => {});
  }

  private async refreshOpenAccounts(): Promise<void> {
    const accounts = new Set<number>();
    for (const rec of this.settlements) {
      accounts.add(rec.accountAId);
      accounts.add(rec.accountBId);
    }
    for (const accountId of accounts) await this.refreshAccount(accountId);
  }

  // -- the settle entry point ----------------------------------------------------

  async onTradeSettle(ev: { a: number; b: number }): Promise<void> {
    const session = this.deps.sim.tradeFor(ev.a);
    if (
      !session ||
      session.phase !== 'settling' ||
      !session.charA ||
      !session.charB ||
      !session.escrowA ||
      !session.escrowB
    ) {
      return;
    }
    const sessA = this.deps.sessionFor(ev.a);
    const sessB = this.deps.sessionFor(ev.b);
    if (!sessA || !sessB) {
      this.deps.sim.tradeSettleFail(ev.a, 'unavailable');
      return;
    }

    const claudiumA = Math.max(0, Math.trunc(session.offerA.claudium));
    const claudiumB = Math.max(0, Math.trunc(session.offerB.claudium));
    const wocA = session.offerA.woc;
    const wocB = session.offerB.woc;
    const hasWoc = wocA !== '0' || wocB !== '0';

    // Reserve a $WOC settlement slot synchronously, before any await, so several
    // settles firing close together cannot each read size < cap and blow past
    // MAX_OPEN_SETTLEMENTS (fix F7g). track() converts the reservation into a
    // tracked settlement; the finally releases it on every early return/failure.
    if (hasWoc && this.settlements.size + this.wocReservations >= MAX_OPEN_SETTLEMENTS) {
      this.deps.sim.tradeSettleFail(ev.a, 'unavailable');
      return;
    }
    let reserved = false;
    if (hasWoc) {
      this.wocReservations++;
      reserved = true;
    }
    const releaseReservation = (): void => {
      if (reserved) {
        this.wocReservations--;
        reserved = false;
      }
    };

    try {
      // Resolve the linked wallet pubkeys for each $WOC leg (payer + recipient). A
      // missing link on either side of a pledged leg fails the whole settlement.
      let wocAPayer: string | null = null;
      let wocARecipient: string | null = null;
      let wocBPayer: string | null = null;
      let wocBRecipient: string | null = null;
      if (wocA !== '0') {
        wocAPayer = await this.deps.walletPubkeyFor(sessA.accountId).catch(() => null);
        wocARecipient = await this.deps.walletPubkeyFor(sessB.accountId).catch(() => null);
        if (!wocAPayer || !wocARecipient) {
          this.deps.sim.tradeSettleFail(ev.a, 'unavailable');
          return;
        }
      }
      if (wocB !== '0') {
        wocBPayer = await this.deps.walletPubkeyFor(sessB.accountId).catch(() => null);
        wocBRecipient = await this.deps.walletPubkeyFor(sessA.accountId).catch(() => null);
        if (!wocBPayer || !wocBRecipient) {
          this.deps.sim.tradeSettleFail(ev.a, 'unavailable');
          return;
        }
      }

      const wocARef = wocA !== '0' ? this.deps.wocTrade.makeReference() : null;
      const wocBRef = wocB !== '0' ? this.deps.wocTrade.makeReference() : null;

      // Serialize both characters' post-escrow rows the way the classic pair-save
      // path does; the atomic anchor persists the row AND both saves together.
      const sideA = this.deps.saveSideFor(ev.a);
      const sideB = this.deps.saveSideFor(ev.b);
      if (!sideA || !sideB) {
        this.deps.sim.tradeSettleFail(ev.a, 'unavailable');
        return;
      }

      let id: number | null;
      try {
        id = await this.deps.db.insertSettlementAndSaveBoth(
          {
            realm: this.deps.realm,
            status: 'escrowed',
            charAId: sessA.characterId,
            charBId: sessB.characterId,
            accountAId: sessA.accountId,
            accountBId: sessB.accountId,
            charAName: session.charA.name,
            charBName: session.charB.name,
            escrowA: session.escrowA,
            escrowB: session.escrowB,
            claudiumA,
            claudiumB,
            wocA,
            wocB,
            wocARef,
            wocBRef,
            wocAPayer,
            wocARecipient,
            wocBPayer,
            wocBRecipient,
          },
          sideA,
          sideB,
        );
      } catch (err) {
        console.error('[trade-settle] failed to persist settlement anchor:', err);
        this.deps.sim.tradeSettleFail(ev.a, 'unavailable');
        return;
      }
      // A null id is a lease-fence miss: nothing persisted, so the escrow simply
      // returns in memory and the settle fails consistently (fix F2).
      if (id === null) {
        this.deps.sim.tradeSettleFail(ev.a, 'unavailable');
        return;
      }

      const rec: OpenSettlement = {
        id,
        a: ev.a,
        b: ev.b,
        charAId: sessA.characterId,
        charBId: sessB.characterId,
        accountAId: sessA.accountId,
        accountBId: sessB.accountId,
        charAName: session.charA.name,
        charBName: session.charB.name,
        charAKey: session.charA.key,
        charBKey: session.charB.key,
        escrowA: session.escrowA,
        escrowB: session.escrowB,
        claudiumA,
        claudiumB,
        wocA,
        wocB,
        wocARef,
        wocBRef,
        wocASig: null,
        wocBSig: null,
        wocAPayer,
        wocARecipient,
        wocBPayer,
        wocBRecipient,
        status: 'escrowed',
        claudiumExecA: false,
        claudiumExecB: false,
        createdAt: this.now(),
        polling: false,
        terminal: false,
      };
      this.track(rec);
      releaseReservation();

      if (!(await this.runClaudiumLegs(rec))) return;

      if (!hasWoc) {
        await this.complete(rec);
        return;
      }
      // $WOC legs remain: verify once now, then the shared ticker keeps polling.
      await this.pollSettlement(rec);
    } finally {
      releaseReservation();
    }
  }

  private async forceSaveBoth(rec: OpenSettlement): Promise<void> {
    await Promise.all([
      this.deps
        .forceSave(rec.a)
        .catch((err) => console.error('[trade-settle] save a failed:', err)),
      this.deps
        .forceSave(rec.b)
        .catch((err) => console.error('[trade-settle] save b failed:', err)),
    ]);
  }

  // Sequential idempotent Claudium legs (a->b then b->a). Any failure refunds the
  // executed leg and unwinds. Returns false when the settlement was unwound.
  private async runClaudiumLegs(rec: OpenSettlement): Promise<boolean> {
    if (rec.claudiumA > 0) {
      const r = await this.deps.claudiumTrade.executeClaudiumLeg(
        rec.id,
        'a',
        rec.accountAId,
        rec.accountBId,
        rec.claudiumA,
      );
      if (!r.ok) {
        await this.unwind(rec, 'claudium', 'unavailable');
        return false;
      }
      rec.claudiumExecA = true;
      // Persist the executed flag right after the leg lands so recovery reverses
      // ONLY legs that actually ran (fix F7b), never a never-applied transfer.
      await this.deps.db.markTradeSettlement(rec.id, rec.status, { claudiumExecA: true });
    }
    if (rec.claudiumB > 0) {
      const r = await this.deps.claudiumTrade.executeClaudiumLeg(
        rec.id,
        'b',
        rec.accountBId,
        rec.accountAId,
        rec.claudiumB,
      );
      if (!r.ok) {
        await this.unwind(rec, 'claudium', 'unavailable');
        return false;
      }
      rec.claudiumExecB = true;
      await this.deps.db.markTradeSettlement(rec.id, rec.status, { claudiumExecB: true });
    }
    if (rec.claudiumA > 0 || rec.claudiumB > 0) {
      rec.status = 'claudium_done';
      await this.deps.db.markTradeSettlement(rec.id, 'claudium_done');
    }
    return true;
  }

  // -- $WOC polling --------------------------------------------------------------

  async pollOnce(): Promise<void> {
    await this.pollAll();
  }

  private async pollAll(): Promise<void> {
    for (const rec of [...this.settlements]) {
      if (rec.terminal || rec.polling) continue;
      if (rec.wocA === '0' && rec.wocB === '0') continue;
      await this.pollSettlement(rec);
    }
  }

  private async pollSettlement(rec: OpenSettlement): Promise<void> {
    const cfg = this.deps.cfg.woc;
    if (!cfg || rec.terminal || rec.polling) return;
    rec.polling = true;
    try {
      const timedOut = this.now() - rec.createdAt > cfg.timeoutMs;
      // Verify every pledged-but-unverified leg. On a timed-out poll this doubles as
      // the FINAL check before unwinding (fix F1b/r2#3): a payment that landed in
      // the last poll interval still completes instead of losing the payer's money.
      await this.verifyPledgedLegs(rec);
      const aPaid = rec.wocA === '0' || rec.wocASig !== null;
      const bPaid = rec.wocB === '0' || rec.wocBSig !== null;
      if (aPaid && bPaid) {
        await this.complete(rec);
        return;
      }
      if (timedOut) await this.unwind(rec, 'timeout', 'timeout');
    } finally {
      rec.polling = false;
    }
  }

  // Run one on-chain verification for each pledged, still-unverified $WOC leg,
  // recording any signature it finds (in memory + persisted). Shared by the poll,
  // the timeout final-check, the cancel final-check, and boot recovery so all four
  // decide completion from the same per-leg truth.
  private async verifyPledgedLegs(rec: OpenSettlement): Promise<void> {
    const cfg = this.deps.cfg.woc;
    if (!cfg) return;
    if (rec.wocA !== '0' && !rec.wocASig && rec.wocARef && rec.wocAPayer && rec.wocARecipient) {
      const res = await this.deps.wocTrade.verifyWocPayment(cfg, {
        reference: rec.wocARef,
        payerPubkey: rec.wocAPayer,
        recipientPubkey: rec.wocARecipient,
        amountUi: rec.wocA,
      });
      if (typeof res === 'object' && 'signature' in res) {
        rec.wocASig = res.signature;
        await this.deps.db.markTradeSettlement(rec.id, rec.status, { wocASig: res.signature });
      }
    }
    if (rec.wocB !== '0' && !rec.wocBSig && rec.wocBRef && rec.wocBPayer && rec.wocBRecipient) {
      const res = await this.deps.wocTrade.verifyWocPayment(cfg, {
        reference: rec.wocBRef,
        payerPubkey: rec.wocBPayer,
        recipientPubkey: rec.wocBRecipient,
        amountUi: rec.wocB,
      });
      if (typeof res === 'object' && 'signature' in res) {
        rec.wocBSig = res.signature;
        await this.deps.db.markTradeSettlement(rec.id, rec.status, { wocBSig: res.signature });
      }
    }
  }

  // -- terminal transitions ------------------------------------------------------

  private async complete(rec: OpenSettlement): Promise<void> {
    if (rec.terminal) return;
    rec.terminal = true;
    // Deliver escrow crosswise (bags for online recipients, Ravenpost otherwise)
    // and emit tradeDone + the tradeLedger accounting event. The ledger row is
    // written by onTradeLedger (which still finds this record open) with the
    // settlement id attached; the record is left tracked until then.
    this.deps.sim.tradeSettleComplete(rec.a);
    await this.deps.db.markTradeSettlement(rec.id, 'completed');
    await this.forceSaveBoth(rec);
  }

  // Refund any executed Claudium leg (idempotent reverse), record any irreversible
  // movement in the ledger, mark refunded, and have the sim return each side's
  // escrow (bags first, mail as the net).
  private async unwind(
    rec: OpenSettlement,
    failReason: string,
    simReason: 'timeout' | 'cancelled' | 'unavailable',
  ): Promise<void> {
    if (rec.terminal) return;
    rec.terminal = true;
    if (rec.claudiumExecA) {
      await this.deps.claudiumTrade
        .refundClaudiumLeg(rec.id, 'a', rec.accountAId, rec.accountBId, rec.claudiumA)
        .catch((err) => console.error('[trade-settle] claudium refund a failed:', err));
    }
    if (rec.claudiumExecB) {
      await this.deps.claudiumTrade
        .refundClaudiumLeg(rec.id, 'b', rec.accountBId, rec.accountAId, rec.claudiumB)
        .catch((err) => console.error('[trade-settle] claudium refund b failed:', err));
    }
    await this.writeUnwindLedger(rec);
    await this.deps.db.markTradeSettlement(rec.id, 'refunded', { failReason });
    this.deps.sim.tradeSettleFail(rec.a, simReason);
    await this.forceSaveBoth(rec);
    this.untrack(rec);
  }

  // Ledger honesty on an unwind (fix F1d/r6#1, extended for recovery in R2): if any
  // real transfer executed during a settlement that then unwound, write a trade_ledger
  // row recording what actually moved so no real transfer is ever unrecorded. Goods/
  // copper are zeroed (the escrow returns crosswise, net nothing), claudium/woc carry
  // only the executed legs. A pure escrow return (nothing executed) writes no row. A
  // verified $WOC leg here should be unreachable (single-leg rule + final-verify
  // complete instead of unwinding), so this is chiefly the reversed-claudium audit
  // belt. Shared by the live unwind (an in-memory OpenSettlement) and boot recovery's
  // refund branch (a loaded TradeSettlementRow) so both record identical rows.
  private async writeUnwindLedger(rec: UnwindLedgerSource): Promise<void> {
    const wocMoved = rec.wocASig !== null || rec.wocBSig !== null;
    const claudiumMoved = rec.claudiumExecA || rec.claudiumExecB;
    if (!wocMoved && !claudiumMoved) return;
    await this.deps.db
      .insertTradeLedger({
        realm: this.deps.realm,
        settlementId: rec.id,
        charAId: rec.charAId,
        charBId: rec.charBId,
        accountAId: rec.accountAId,
        accountBId: rec.accountBId,
        charAName: rec.charAName,
        charBName: rec.charBName,
        itemsA: [],
        copperA: 0,
        itemsB: [],
        copperB: 0,
        claudiumA: rec.claudiumExecA ? rec.claudiumA : 0,
        claudiumB: rec.claudiumExecB ? rec.claudiumB : 0,
        wocA: rec.wocASig !== null ? rec.wocA : '0',
        wocB: rec.wocBSig !== null ? rec.wocB : '0',
      })
      .catch((err) => console.error('[trade-settle] unwind ledger insert failed:', err));
  }

  // -- player-initiated cancel ---------------------------------------------------

  // True when pid belongs to an open settlement (so game.ts stops here). A cancel
  // unwinds ONLY while it is still safe: no $WOC leg verified yet. Once any $WOC
  // signature exists the money moved on-chain irreversibly, so the trade must
  // complete and the cancel is refused (returns true, does nothing).
  requestCancel(pid: number): boolean {
    const rec = this.byPid.get(pid);
    if (!rec) return false;
    if (rec.terminal) return true;
    // A verified leg already refuses the cancel synchronously (money moved).
    if (rec.wocASig !== null || rec.wocBSig !== null) return true;
    void this.cancelSettlement(rec).catch((err) =>
      console.error('[trade-settle] cancel failed:', err),
    );
    return true;
  }

  // The cancel body: run a FINAL on-chain check before treating the escrow as safe
  // to unwind (fix F1b/r2#3, the pay-then-cancel race). A payer may have signed
  // their $WOC transfer in the gap since the last poll; if that verifies, the cancel
  // is refused and the trade completes instead of losing the payment. Otherwise the
  // escrow unwinds as before.
  private async cancelSettlement(rec: OpenSettlement): Promise<void> {
    if (rec.terminal || rec.polling) return;
    rec.polling = true;
    try {
      await this.verifyPledgedLegs(rec);
      if (rec.wocASig !== null || rec.wocBSig !== null) {
        const aPaid = rec.wocA === '0' || rec.wocASig !== null;
        const bPaid = rec.wocB === '0' || rec.wocBSig !== null;
        if (aPaid && bPaid) await this.complete(rec);
        return;
      }
      await this.unwind(rec, 'cancelled', 'cancelled');
    } finally {
      rec.polling = false;
    }
  }

  // -- ledger event (both lanes) -------------------------------------------------

  // The sim's tradeLedger accounting event. Settling lane: an open settlement
  // matches, so write the ledger row with its settlement id and release the record
  // (the character halves were already force-saved). Classic lane: no settlement,
  // so write the ledger + force the durable two-row pair save in one transaction.
  async onTradeLedger(ev: TradeLedgerEvent): Promise<void> {
    const rec = this.byPid.get(ev.a) ?? this.byPid.get(ev.b);
    if (rec) {
      await this.deps.db
        .insertTradeLedger({
          realm: this.deps.realm,
          settlementId: rec.id,
          charAId: rec.charAId,
          charBId: rec.charBId,
          accountAId: rec.accountAId,
          accountBId: rec.accountBId,
          charAName: rec.charAName,
          charBName: rec.charBName,
          itemsA: ev.itemsA,
          copperA: ev.copperA,
          itemsB: ev.itemsB,
          copperB: ev.copperB,
          claudiumA: ev.claudiumA,
          claudiumB: ev.claudiumB,
          wocA: ev.wocA,
          wocB: ev.wocB,
        })
        .catch((err) => console.error('[trade-settle] settling-lane ledger insert failed:', err));
      this.untrack(rec);
      return;
    }
    // Classic lane: participants + moved detail resolved from the live sessions.
    const sessA = this.deps.sessionFor(ev.a);
    const sessB = this.deps.sessionFor(ev.b);
    const ledger: TradeLedgerRow = {
      realm: this.deps.realm,
      settlementId: null,
      charAId: sessA?.characterId ?? null,
      charBId: sessB?.characterId ?? null,
      accountAId: sessA?.accountId ?? null,
      accountBId: sessB?.accountId ?? null,
      charAName: sessA?.name ?? '?',
      charBName: sessB?.name ?? '?',
      itemsA: ev.itemsA,
      copperA: ev.copperA,
      itemsB: ev.itemsB,
      copperB: ev.copperB,
      claudiumA: ev.claudiumA,
      claudiumB: ev.claudiumB,
      wocA: ev.wocA,
      wocB: ev.wocB,
    };
    await this.deps
      .savePairAndLedger(ev.a, ev.b, ledger)
      .catch((err) => console.error('[trade-settle] classic-lane pair save failed:', err));
  }

  // -- boot recovery -------------------------------------------------------------

  // Resolve every settlement left open by a crash/restart, WITHOUT a live sim
  // session (the escrow JSONB + char ids/names live in the row). Any recorded
  // $WOC signature means the on-chain payment landed, so complete the delivery by
  // mail; otherwise refund by mail (and reverse any executed Claudium leg,
  // idempotently). Never resumes a $WOC wait across a restart.
  async recoverOpenSettlements(): Promise<void> {
    let candidates: TradeSettlementRow[];
    try {
      candidates = await this.deps.db.loadOpenTradeSettlements(this.deps.realm);
    } catch (err) {
      console.error('[trade-settle] failed to load open settlements for recovery:', err);
      return;
    }
    // Claim each candidate atomically before acting so a concurrent same-realm boot
    // cannot both deliver the mail / write the ledger for one row (fix F3).
    for (const candidate of candidates) {
      try {
        const claimed = await this.deps.db.claimTradeSettlementForRecovery(candidate.id);
        if (!claimed) continue;
        await this.recoverOne(claimed);
      } catch (err) {
        console.error(`[trade-settle] recovery failed for settlement ${candidate.id}:`, err);
      }
    }
  }

  private async recoverOne(row: TradeSettlementRow): Promise<void> {
    // A whole-unit amount outside the safe-integer range (parseWhole returned NaN)
    // is a corrupt row: refuse to act rather than mis-round a money leg (fix F7a).
    // Leave it open (still 'recovering') for manual reconciliation.
    if (!Number.isSafeInteger(row.claudiumA) || !Number.isSafeInteger(row.claudiumB)) {
      console.error(
        `[trade-settle] settlement ${row.id} has a corrupt claudium amount; skipping recovery`,
      );
      return;
    }
    const keyA = row.charAId !== null ? String(row.charAId) : null;
    const keyB = row.charBId !== null ? String(row.charBId) : null;

    // Final on-chain verification for any pledged-but-unverified $WOC leg using the
    // payer/recipient pubkeys persisted on the row (so it does not depend on the
    // wallet_links still existing). A leg that landed just before the crash then
    // completes rather than refunds (fix F1c + F1b applied at boot).
    const cfg = this.deps.cfg.woc;
    let wocASig = row.wocASig;
    let wocBSig = row.wocBSig;
    if (cfg) {
      if (
        row.wocA !== '0' &&
        wocASig === null &&
        row.wocARef &&
        row.wocAPayer &&
        row.wocARecipient
      ) {
        const res = await this.deps.wocTrade
          .verifyWocPayment(cfg, {
            reference: row.wocARef,
            payerPubkey: row.wocAPayer,
            recipientPubkey: row.wocARecipient,
            amountUi: row.wocA,
          })
          .catch(() => 'pending' as VerifyWocResult);
        if (typeof res === 'object' && 'signature' in res) {
          wocASig = res.signature;
          await this.deps.db.markTradeSettlement(row.id, row.status, { wocASig: res.signature });
        }
      }
      if (
        row.wocB !== '0' &&
        wocBSig === null &&
        row.wocBRef &&
        row.wocBPayer &&
        row.wocBRecipient
      ) {
        const res = await this.deps.wocTrade
          .verifyWocPayment(cfg, {
            reference: row.wocBRef,
            payerPubkey: row.wocBPayer,
            recipientPubkey: row.wocBRecipient,
            amountUi: row.wocB,
          })
          .catch(() => 'pending' as VerifyWocResult);
        if (typeof res === 'object' && 'signature' in res) {
          wocBSig = res.signature;
          await this.deps.db.markTradeSettlement(row.id, row.status, { wocBSig: res.signature });
        }
      }
    }

    // Per-leg completion (fix F1c/r6#2): complete only when the trade carried a $WOC
    // leg AND every pledged $WOC leg verified. A single verified leg of a two-sided
    // pledge (a belt the single-leg rule makes unreachable for new rows) or a
    // claudium-only / empty row that crashed mid-settlement refunds instead.
    const hasWocLeg = row.wocA !== '0' || row.wocB !== '0';
    const aPaid = row.wocA === '0' || wocASig !== null;
    const bPaid = row.wocB === '0' || wocBSig !== null;
    if (hasWocLeg && aPaid && bPaid) {
      // Complete by mail: A's escrow goes to B, B's escrow goes to A.
      if (keyB) {
        this.deps.sim.sendTradeLetter(
          keyB,
          row.charBName,
          'delivery',
          row.escrowA.copper,
          row.escrowA.items,
        );
      }
      if (keyA) {
        this.deps.sim.sendTradeLetter(
          keyA,
          row.charAName,
          'delivery',
          row.escrowB.copper,
          row.escrowB.items,
        );
      }
      await this.deps.db.insertTradeLedger({
        realm: this.deps.realm,
        settlementId: row.id,
        charAId: row.charAId,
        charBId: row.charBId,
        accountAId: row.accountAId,
        accountBId: row.accountBId,
        charAName: row.charAName,
        charBName: row.charBName,
        itemsA: row.escrowA.items,
        copperA: row.escrowA.copper,
        itemsB: row.escrowB.items,
        copperB: row.escrowB.copper,
        claudiumA: row.claudiumA,
        claudiumB: row.claudiumB,
        wocA: row.wocA,
        wocB: row.wocB,
      });
      await this.deps.db.markTradeSettlement(row.id, 'completed');
      return;
    }
    // Refund by mail: each side gets their own escrow back.
    if (keyA) {
      this.deps.sim.sendTradeLetter(
        keyA,
        row.charAName,
        'refund',
        row.escrowA.copper,
        row.escrowA.items,
      );
    }
    if (keyB) {
      this.deps.sim.sendTradeLetter(
        keyB,
        row.charBName,
        'refund',
        row.escrowB.copper,
        row.escrowB.items,
      );
    }
    // Reverse ONLY executed Claudium legs (fix F7b). The service dedupe key makes a
    // refund exactly-once, so replaying recovery is safe.
    if (row.claudiumExecA && row.accountAId !== null && row.accountBId !== null) {
      await this.deps.claudiumTrade
        .refundClaudiumLeg(row.id, 'a', row.accountAId, row.accountBId, row.claudiumA)
        .catch((err) => console.error('[trade-settle] recovery claudium refund a failed:', err));
    }
    if (row.claudiumExecB && row.accountAId !== null && row.accountBId !== null) {
      await this.deps.claudiumTrade
        .refundClaudiumLeg(row.id, 'b', row.accountBId, row.accountAId, row.claudiumB)
        .catch((err) => console.error('[trade-settle] recovery claudium refund b failed:', err));
    }
    // Ledger honesty on recovery (fix R2): a claudium leg that executed pre-crash was
    // just reversed above (two real transfers), so record what moved exactly as the
    // live unwind does. Self-guards: no row is written when nothing executed. The
    // complete branch returned earlier with its own ledger row, so this never doubles.
    await this.writeUnwindLedger(row);
    await this.deps.db.markTradeSettlement(row.id, 'refunded', { failReason: 'restart' });
  }
}
