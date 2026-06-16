// STUB (RFC) — on-chain entitlement handshake + HARD spend cap.
// The agent gets a quote, pays from its own Solana wallet, submits the signature, and receives
// an entitlement BEFORE WocConnectionService.connect() is allowed to enter the world.
// The spend cap is deterministic and NOT LLM-overridable — money moves only within these bounds.
// TODO(eliza): use @elizaos/plugin-wallet for the keypair; @solana/web3.js for the transfer.

export interface SpendPolicy {
  maxLamportsPerQuote: number;
  maxQuotesPerHour: number;
}

export interface Entitlement {
  kind: 'agent_player' | 'familiar';
  entitled: boolean;
  expiresAt: number | null;
}

export class WocPaymentService {
  static serviceType = 'woc_payment' as const;
  capabilityDescription = 'On-chain (Solana) paid-gate handshake for agent entitlement.';

  constructor(private readonly policy: SpendPolicy) {}

  /** quote -> sign transfer (wallet -> recipient, memo=quoteId) -> sendAndConfirm('finalized') -> verify. */
  async payAndVerify(_kind: Entitlement['kind']): Promise<Entitlement> {
    // 1. POST /api/agent/quote { kind } -> { quoteId, lamports, recipient, memo }
    // 2. enforce this.policy (reject if lamports > maxLamportsPerQuote or over rate)
    // 3. build + sign SystemProgram.transfer + memo, sendAndConfirmTransaction(commitment:'finalized')
    // 4. POST /api/agent/verify-payment { quoteId, signature, address } -> Entitlement
    void this.policy;
    throw new Error('TODO(eliza): WocPaymentService.payAndVerify');
  }
}
