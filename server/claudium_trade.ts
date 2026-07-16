// Thin orchestrator-facing wrapper over the Claudium economy-service transfer
// endpoint (server/claudium_proxy.ts). The settlement orchestrator uses this for
// the Claudium legs of an external-lane trade.
//
// Idempotency is the contract: every leg (and every refund) carries a stable
// dedupe key derived from the settlement id and direction, so a service retry, a
// duplicate refund on unwind, or a boot-recovery replay all resolve to a single
// net effect on the service ledger. The game side stays correct regardless of how
// many times the service sees the same key.
//
// A synchronous balance cache backs offer clamping: the sim's tradeRails callback
// must be synchronous, so it can only read a cached number. refresh() repopulates
// it via the proxy balance call; an unknown balance reads as 0 (the pledge clamps
// to 0, which is harmless).

import { type ClaudiumTransferResult, claudiumBalance, transferClaudium } from './claudium_proxy';

export interface ClaudiumTrade {
  executeClaudiumLeg(
    settlementId: number,
    direction: 'a' | 'b',
    fromAccount: number,
    toAccount: number,
    amount: number,
  ): Promise<ClaudiumTransferResult>;
  refundClaudiumLeg(
    settlementId: number,
    direction: 'a' | 'b',
    fromAccount: number,
    toAccount: number,
    amount: number,
  ): Promise<ClaudiumTransferResult>;
  claudiumBalanceFor(accountId: number): number;
  refresh(accountId: number): Promise<void>;
}

export function createClaudiumTrade(): ClaudiumTrade {
  const balances = new Map<number, number>();
  return {
    executeClaudiumLeg(settlementId, direction, fromAccount, toAccount, amount) {
      return transferClaudium(fromAccount, toAccount, amount, `trade-${settlementId}-${direction}`);
    },
    // The reverse transfer (to -> from) that unwinds an executed leg. Its own
    // dedupe key namespace ('trade-refund-...') so a refund is never confused with
    // the forward leg and is itself exactly-once.
    refundClaudiumLeg(settlementId, direction, fromAccount, toAccount, amount) {
      return transferClaudium(
        toAccount,
        fromAccount,
        amount,
        `trade-refund-${settlementId}-${direction}`,
      );
    },
    claudiumBalanceFor(accountId) {
      return balances.get(accountId) ?? 0;
    },
    async refresh(accountId) {
      const result = await claudiumBalance(accountId);
      if (result.balance !== null) balances.set(accountId, result.balance);
    },
  };
}
