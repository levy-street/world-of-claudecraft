// The Exchange window's toast strip, UNRESOLVED (extracted from
// woc_market_window.ts under the monolith ratchet): keys, codes, and screened
// reason words, resolved at render by resolveWocNotice() so a runtime language
// switch never leaves a stale-locale sentence on screen. Dispatch only: every
// sentence comes from the pure mappers (api_error_i18n, woc_market_reason_text,
// wallet_bridge_reason_text) or the catalog.

import { userFacingApiError } from './api_error_i18n';
import { type TranslationKey, t } from './i18n';
import { type WalletBridgeReason, walletBridgeReasonText } from './wallet_bridge_reason_text';
import { wocBondPendingText, wocPaymentPendingText } from './woc_market_reason_text';

export type WocNotice =
  | { kind: 'key'; key: TranslationKey; error: boolean }
  | { kind: 'keyParams'; key: TranslationKey; params: Record<string, string>; error: boolean }
  | { kind: 'api'; code: string; params?: Record<string, unknown>; error: boolean }
  | { kind: 'pending'; reason: string | null; error: boolean }
  | { kind: 'bondPending'; reason: string | null; error: boolean }
  | {
      kind: 'bridge';
      reason: WalletBridgeReason;
      flavor: 'sign' | 'payment';
      error: boolean;
    };

export function resolveWocNotice(n: WocNotice): string {
  switch (n.kind) {
    case 'key':
      return t(n.key);
    case 'keyParams':
      return t(n.key, n.params);
    case 'api':
      return userFacingApiError({ code: n.code, params: n.params });
    case 'pending':
      return wocPaymentPendingText(n.reason);
    case 'bondPending':
      return wocBondPendingText(n.reason);
    case 'bridge':
      return walletBridgeReasonText(n.reason, n.flavor);
  }
}
