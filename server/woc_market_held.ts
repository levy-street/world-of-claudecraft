// The Exchange Vault: selling on the $WOC Exchange WITHOUT a linked wallet
// (docs/prd/woc/marketplace.md, "Selling without a wallet: the Vault").
//
// A walletless seller's proceeds cannot go to a wallet, so the settlement
// quote names the operator's custody address as the seller leg's destination
// and the game books the service-computed seller leg to the seller's Vault
// (woc_market_held_db.ts) inside the delivery finalize transaction. The Vault
// spends on buy-now purchases (the buyer's ledger is charged the quoted
// amount, then the economy service settles that quote FROM custody) and
// cashes out to a wallet the player links later (the whole balance moves
// through the service's withdrawal rail). The balance is $WOC, never USD:
// its dollar value moves with the market, and the client renders any USD
// figure as the estimate the service quotes.
//
// Everything here is a sibling of woc_market.ts behind narrow deps (the
// stepup_flow / delivery pattern): the coordinator consults it at the three
// points that need it (listing intake, buy-now intake, the settlement quote's
// seller address) and the held routes drive the rest.

import type { WalletReauthErrorCode } from './wallet_reauth';
import type { Refused, WocMarketDb, WocMarketRefusal } from './woc_market';
import type { WocMarketEconomy, WocQuoteIntent } from './woc_market_economy_types';
import type { WocHeldEntryRow, WocMarketHeldDb } from './woc_market_held_db';
import type { WocSettlementState } from './woc_market_rules';

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/** Display decimals of the $WOC mint (9, the SPL default the dev economy
 *  mirrors). Formatting only: the ledger stores base units verbatim and no
 *  price math happens here. */
export const WOC_HELD_TOKEN_DECIMALS = 9;

/** The pseudo-signature a held settlement records: no wallet signed anything,
 *  the service moved custody funds for this reference. Distinct by prefix
 *  from every base58 signature (':' is outside the alphabet). */
export const WOC_HELD_SIGNATURE_PREFIX = 'held:';

/** Most Vault entries the readout lists. */
export const WOC_HELD_ENTRIES_LIMIT = 50;

/** Reversal backlog per sweep pass. */
export const WOC_HELD_REVERSE_BATCH = 50;

const BASE_SHAPE = /^\d{1,38}$/;

/** A non-negative base-unit amount as the service and ledger carry it. */
export function isHeldBase(value: unknown): value is string {
  return typeof value === 'string' && BASE_SHAPE.test(value);
}

/** Display conversion, base units to whole tokens (a Number, so a display
 *  value only: the base string stays the exact figure on every wire). */
export function heldTokens(base: string): number {
  if (!isHeldBase(base)) return 0;
  return Number(BigInt(base)) / 10 ** WOC_HELD_TOKEN_DECIMALS;
}

export function heldSaleRef(settlementId: number): string {
  return `held:sale:${settlementId}`;
}
export function heldPayRef(settlementId: number): string {
  return `held:pay:${settlementId}`;
}
export function heldPayReverseRef(settlementId: number): string {
  return `held:pay_reverse:${settlementId}`;
}
export function heldWithdrawRef(account: number, nonce: string): string {
  return `held:withdraw:${account}:${nonce}`;
}
export function heldWithdrawReverseRef(withdrawRef: string): string {
  return `${withdrawRef}:reverse`;
}
export function heldSignature(reference: string): string {
  return `${WOC_HELD_SIGNATURE_PREFIX}${reference}`;
}
export function isHeldSignature(signature: string | null): boolean {
  return signature !== null && signature.startsWith(WOC_HELD_SIGNATURE_PREFIX);
}

/** The operator custody address (WOC_MARKET_HELD_WALLET). Unset or blank
 *  means the Vault is off: every walletless arm refuses and the client hides
 *  the option. Trimmed, never validated as a key here: the economy service
 *  is the only party that ever pays to it and it refuses a malformed one. */
export function wocHeldWalletFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.WOC_MARKET_HELD_WALLET ?? '').trim();
  return raw === '' ? null : raw;
}

/** Whether a balance covers a quoted amount (both base-unit strings). */
export function heldCovers(balanceBase: string, amountBase: string): boolean {
  if (!isHeldBase(balanceBase) || !isHeldBase(amountBase)) return false;
  return BigInt(balanceBase) >= BigInt(amountBase);
}

/** The account-proof arm's refusal vocabulary, one refusal per wallet re-auth
 *  outcome (the R11 core, server/wallet_reauth.ts): the route layer maps each
 *  to its own woc_market.account_proof_* code. */
export const ACCOUNT_PROOF_REFUSALS: Record<WalletReauthErrorCode, WocMarketRefusal> = {
  'wallet.reauth_required': 'account_proof_required',
  'wallet.reauth_two_factor': 'account_proof_two_factor',
  'wallet.reauth_no_password': 'account_proof_no_password',
  'wallet.reauth_bad_signature': 'account_proof_invalid',
  'wallet.reauth_bad_password': 'account_proof_invalid',
  'wallet.reauth_bad_two_factor': 'account_proof_invalid',
  'auth.too_many_failed_attempts': 'account_proof_throttled',
};

export type WocAccountProofOutcome = { ok: true } | { ok: false; code: WalletReauthErrorCode };

/** The settlement quote's refusal when a Vault seller's leg has nowhere to
 *  go (the custody wallet was unset after their listing was made). */
export const HELD_QUOTE_REFUSED: WocQuoteIntent = Object.freeze({
  ok: false,
  reference: null,
  transactionBase64: null,
  signatureRequired: true,
  amount: null,
  seller: null,
  burn: null,
  treasury: null,
  bondCents: null,
  expiresAtMs: null,
  reason: 'held_disabled',
});

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface WocMarketHeldDeps {
  db: WocMarketHeldDb;
  market: Pick<
    WocMarketDb,
    'settlementById' | 'submitSettlementSignature' | 'transitionSettlement'
  >;
  economy: Pick<WocMarketEconomy, 'estimate' | 'settleHeld' | 'heldWithdrawal'>;
  verifiedWallet(account: number): Promise<string | null>;
  /** The account re-auth verifier (password plus second factor when
   *  enrolled), the wallet-change core behind the same throttle. */
  accountProof(account: number, proof: unknown): Promise<WocAccountProofOutcome>;
  /** The operator custody address (WOC_MARKET_HELD_WALLET). Null disables
   *  every Vault arm: listings need a wallet again and no held payment or
   *  withdrawal is possible; balances already booked stay readable. */
  custodyWallet: string | null;
  now(): number;
  /** Eager delivery after a settled held payment (the confirmSettlement
   *  precedent); the sweep remains the backstop. */
  deliverNow(): Promise<void>;
  /** Unique nonce for withdrawal refs (crypto.randomUUID in production). */
  nonce(): string;
  onError?(arm: string, err: unknown): void;
}

export interface WocHeldReadout {
  enabled: boolean;
  base: string;
  tokens: number;
  /** True when a linked wallet can receive a cash-out right now. */
  canWithdraw: boolean;
  entries: WocHeldEntryRow[];
}

const refuse = (reason: WocMarketRefusal, params?: Record<string, string | number>): Refused =>
  params === undefined ? { ok: false, reason } : { ok: false, reason, params };

export class WocMarketHeldService {
  constructor(private readonly deps: WocMarketHeldDeps) {}

  enabled(): boolean {
    return this.deps.custodyWallet !== null;
  }

  custodyWallet(): string | null {
    return this.deps.custodyWallet;
  }

  async balance(account: number): Promise<string> {
    return this.deps.db.balance(account);
  }

  async readout(account: number): Promise<WocHeldReadout> {
    const [base, entries, wallet] = await Promise.all([
      this.deps.db.balance(account),
      this.deps.db.entries(account, WOC_HELD_ENTRIES_LIMIT),
      this.deps.verifiedWallet(account),
    ]);
    return {
      enabled: this.enabled(),
      base,
      tokens: heldTokens(base),
      canWithdraw: this.enabled() && wallet !== null && BigInt(base) > 0n,
      entries,
    };
  }

  /** The buy-now pre-check for a Vault payment: the balance must cover the
   *  service's current estimate. The AUTHORITATIVE charge is the quoted
   *  amount at confirmFromHeld; this only refuses the obviously short buyer
   *  before a listing lock is taken. */
  async guardCover(account: number, usdCents: number): Promise<Refused | null> {
    if (!this.enabled()) return refuse('held_disabled');
    const estimate = await this.deps.economy.estimate(usdCents);
    if (!estimate.available || estimate.amount === null) return refuse('quote_unavailable');
    const base = await this.deps.db.balance(account);
    return heldCovers(base, estimate.amount.base) ? null : refuse('held_insufficient');
  }

  /** The walletless listing's step-up substitute: the account itself signs
   *  the custody move (password, plus the second factor when enrolled). */
  async guardAccountProof(account: number, proof: unknown): Promise<Refused | null> {
    if (!this.enabled()) return refuse('wallet_required');
    const out = await this.deps.accountProof(account, proof ?? {});
    return out.ok ? null : refuse(ACCOUNT_PROOF_REFUSALS[out.code]);
  }

  /**
   * Pay an offered settlement from the buyer's Vault. Charge first (typed
   * 'held_insufficient' on a short balance, nothing else written), record the
   * held pseudo-signature (the same offered -> confirming CAS a wallet payment
   * takes), then ask the service to settle from custody. A refusal reverses
   * the charge in-request; a pending verdict leaves the row confirming for
   * the sweep's poll, and the reversal arm below returns the charge if that
   * poll ever fails it.
   */
  async confirmFromHeld(
    account: number,
    settlementId: number,
  ): Promise<{ ok: true; state: WocSettlementState; reason?: string | null } | Refused> {
    if (!this.enabled()) return refuse('held_disabled');
    const settlement = await this.deps.market.settlementById(settlementId);
    if (!settlement) return refuse('not_found');
    if (settlement.buyerAccount !== account) return refuse('not_yours');
    if (settlement.buyerWallet !== this.deps.custodyWallet) return refuse('not_active');
    // A retry after the recording answers the outcome, never a second charge.
    if (settlement.state !== 'offered') {
      if (isHeldSignature(settlement.txSignature) && settlement.state !== 'failed') {
        return { ok: true, state: settlement.state };
      }
      return refuse('not_active');
    }
    if (
      settlement.quoteReference === null ||
      settlement.quoteExpiresAtMs === null ||
      !isHeldBase(settlement.settledAmountBase)
    ) {
      return refuse('quote_unavailable');
    }
    if (settlement.quoteExpiresAtMs <= this.deps.now()) return refuse('quote_expired');
    const charged = await this.deps.db.post({
      account,
      ref: heldPayRef(settlement.id),
      kind: 'pay',
      deltaBase: `-${settlement.settledAmountBase}`,
      settlementId: settlement.id,
    });
    if (charged === 'insufficient') return refuse('held_insufficient');
    const submitted = await this.deps.market.submitSettlementSignature(
      settlement.id,
      heldSignature(settlement.quoteReference),
    );
    if (submitted !== 'ok') {
      await this.reversePayment(account, settlement.id);
      return refuse(submitted === 'contended' ? 'confirm_in_flight' : 'not_active');
    }
    const verdict = await this.deps.economy.settleHeld(settlement.quoteReference);
    if (verdict.settled) {
      await this.deps.market.transitionSettlement(settlement.id, ['confirming'], 'confirmed');
      await this.deps.deliverNow().catch(() => {});
      const after = await this.deps.market.settlementById(settlement.id);
      return { ok: true, state: after?.state ?? 'confirmed' };
    }
    if (verdict.pending) return { ok: true, state: 'confirming', reason: verdict.reason };
    await this.deps.market.transitionSettlement(
      settlement.id,
      ['confirming'],
      'failed',
      verdict.reason ?? 'refused',
    );
    await this.reversePayment(account, settlement.id);
    return refuse('confirm_failed');
  }

  /** Cash out the WHOLE balance to the linked wallet. The charge lands
   *  first, so a crash between it and the service call leaves a visible
   *  withdraw entry with no reversal (the operator trace), never a balance
   *  the player could spend twice. */
  async withdraw(
    account: number,
  ): Promise<{ ok: true; base: string; tokens: number; wallet: string } | Refused> {
    if (!this.enabled()) return refuse('held_disabled');
    const wallet = await this.deps.verifiedWallet(account);
    if (!wallet) return refuse('wallet_required');
    const base = await this.deps.db.balance(account);
    if (!isHeldBase(base) || BigInt(base) === 0n) return refuse('held_empty');
    const ref = heldWithdrawRef(account, this.deps.nonce());
    const charged = await this.deps.db.post({
      account,
      ref,
      kind: 'withdraw',
      deltaBase: `-${base}`,
    });
    // A concurrent charge between the read and the post: the balance is
    // smaller now, answer honestly and let the client re-read.
    if (charged !== 'posted') return refuse('held_insufficient');
    const out = await this.deps.economy.heldWithdrawal({ memoRef: ref, base, wallet });
    if (!out.done) {
      await this.deps.db.post({
        account,
        ref: heldWithdrawReverseRef(ref),
        kind: 'withdraw_reverse',
        deltaBase: base,
      });
      return refuse('held_withdraw_failed');
    }
    return { ok: true, base, tokens: heldTokens(base), wallet };
  }

  /** Sweep arm: return the charge of every held payment whose settlement
   *  failed or expired after the charge (the poll's failed verdict, or a
   *  deadline the sweep expired while the service never answered). Returns
   *  rows reversed. */
  async reverseFailedPayments(): Promise<number> {
    let reversed = 0;
    const backlog = await this.deps.db.unreversedFailedPayments(WOC_HELD_REVERSE_BATCH);
    for (const entry of backlog) {
      if (entry.settlementId === null) continue;
      try {
        const posted = await this.deps.db.post({
          account: entry.account,
          ref: heldPayReverseRef(entry.settlementId),
          kind: 'pay_reverse',
          deltaBase: entry.deltaBase.replace(/^-/, ''),
          settlementId: entry.settlementId,
        });
        if (posted === 'posted') reversed++;
      } catch (err) {
        this.deps.onError?.('heldReversed', err);
      }
    }
    return reversed;
  }

  private async reversePayment(account: number, settlementId: number): Promise<void> {
    const settlement = await this.deps.market.settlementById(settlementId);
    const base = settlement?.settledAmountBase;
    if (!isHeldBase(base)) return;
    await this.deps.db.post({
      account,
      ref: heldPayReverseRef(settlementId),
      kind: 'pay_reverse',
      deltaBase: base,
      settlementId,
    });
  }
}
