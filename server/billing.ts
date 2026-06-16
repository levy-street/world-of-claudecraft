// STUB (RFC) — on-chain entitlement logic for agent accounts. server/-only; no src/sim/ import.
// Carries NO raw SQL: it calls db.ts functions (the only SQL home) via the BillingStore seam below,
// and talks to the chain through SolanaClient. Both seams are injected so this is unit-testable
// against in-memory fakes (mirror the SocialDb fake pattern in tests/).
// TODO(eliza): wire BillingStore to real db.ts functions and SolanaClient to server/solana.ts.

import type { SolanaClient } from './solana';

export type EntitlementKind = 'agent_player' | 'familiar';

export interface Quote {
  quoteId: string;
  kind: EntitlementKind;
  recipient: string; // treasury address
  lamports: number;
  mint: string | null;
  memo: string; // == quoteId, must appear in the paying tx
  expiresAt: number;
}

export interface Entitlement {
  kind: EntitlementKind;
  status: 'active' | 'expired' | 'revoked';
  expiresAt: number | null;
}

/** The narrow set of persistence ops billing needs — implemented by db.ts (SQL lives there). */
export interface BillingStore {
  recordPayment(row: {
    accountId: number;
    txSig: string;
    from: string;
    to: string;
    amount: number;
    mint: string | null;
    reference: string;
  }): Promise<{ id: number } | null>; // null if txSig already consumed (UNIQUE replay guard)
  grantEntitlement(row: {
    accountId: number;
    kind: EntitlementKind;
    source: 'payment' | 'hold';
    paymentId: number | null;
    expiresAt: number | null;
  }): Promise<void>;
  activeEntitlement(accountId: number, kind: EntitlementKind): Promise<Entitlement | null>;
}

export interface BillingConfig {
  treasury: string;
  priceLamports: Record<EntitlementKind, number>;
  mint: string | null;
}

export class Billing {
  constructor(
    private readonly chain: SolanaClient,
    private readonly store: BillingStore,
    private readonly cfg: BillingConfig,
  ) {}

  /** Build a payable quote tying a payment to a specific account + entitlement. */
  quote(_accountId: number, _kind: EntitlementKind): Quote {
    void this.cfg;
    throw new Error('TODO(eliza): Billing.quote');
  }

  /**
   * Verify a finalized Solana payment, then grant the entitlement.
   * Must check: finalized commitment, recipient === treasury, amount >= price, memo === quoteId,
   * and that the tx_sig has not been consumed before (replay guard via store.recordPayment).
   */
  async verifyPayment(_accountId: number, _quoteId: string, _signature: string): Promise<Entitlement> {
    void this.chain;
    void this.store;
    throw new Error('TODO(eliza): Billing.verifyPayment');
  }

  /** Grant a time-boxed entitlement from a current SPL token-hold check. */
  async verifyHold(_accountId: number, _kind: EntitlementKind): Promise<Entitlement> {
    throw new Error('TODO(eliza): Billing.verifyHold');
  }

  /** The gate decision read at WS connect and at summon_familiar. Pure given an entitlement. */
  async requireEntitlement(accountId: number, kind: EntitlementKind): Promise<boolean> {
    const ent = await this.store.activeEntitlement(accountId, kind);
    return ent !== null && ent.status === 'active';
  }
}
