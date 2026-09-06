// The Exchange Vault's window arm (docs/prd/woc/marketplace.md, "Selling
// without a wallet: the Vault"): the two mutations that touch no wallet, the
// Vault commit of a pending settlement and the cash-out, over a narrow host
// slice of the window (the trade_woc_arm pattern). The window stays the owner
// of its busy guard, toast, and reload; this module owns only the ladders.

import type { TranslationKey } from './i18n';
import type { WocMarketHooks } from './woc_market_hooks';
import type { WocNotice } from './woc_market_notice';

export interface WocVaultHost {
  hooks(): WocMarketHooks | null;
  withBusy(label: TranslationKey, run: () => Promise<void>): Promise<void>;
  fail(code: string, params?: Record<string, unknown>): void;
  ok(key: TranslationKey): void;
  notice(n: WocNotice): void;
  clearPendingQuote(): void;
  reload(): Promise<void>;
  refreshWocBalance(force?: boolean): void;
  tokens(value: number): string;
}

/** The Vault commit: no wallet, no signature. The server charges the ledger
 *  and settles from custody; the outcome ladder mirrors the wallet confirm's
 *  (review, still confirming, decided-and-delivering, complete). */
export async function payPendingFromVault(host: WocVaultHost, settlementId: number): Promise<void> {
  const hooks = host.hooks();
  if (!hooks) return;
  await host.withBusy('hudChrome.wocMarket.confirming', async () => {
    const out = await hooks.client.confirmHeld(settlementId);
    if (!out.ok) {
      host.fail(out.code, out.params);
      return;
    }
    if (out.state === 'review') {
      host.ok('hudChrome.wocMarket.settlementReview');
    } else if (out.state === 'confirming') {
      host.notice({ kind: 'pending', reason: out.reason ?? null, error: false });
    } else if (out.state === 'confirmed' || out.state === 'delivering') {
      host.ok('hudChrome.wocMarket.paymentConfirmedDelivering');
    } else {
      host.ok('hudChrome.wocMarket.purchaseComplete');
    }
    host.clearPendingQuote();
    await host.reload();
  });
}

/** Cash out the whole Vault balance to the linked wallet. */
export async function withdrawVault(host: WocVaultHost): Promise<void> {
  const hooks = host.hooks();
  if (!hooks) return;
  await host.withBusy('hudChrome.wocMarket.confirming', async () => {
    const out = await hooks.client.withdrawHeld();
    if (!out.ok) {
      host.fail(out.code, out.params);
      return;
    }
    host.notice({
      kind: 'keyParams',
      key: 'hudChrome.wocMarket.vaultWithdrawn',
      params: { tokens: host.tokens(out.tokens) },
      error: false,
    });
    host.refreshWocBalance(true); // Token-account changes emit no wallet event.
    await host.reload();
  });
}
