// Localizes wallet-bridge failures for the money surfaces.
//
// The bridge (src/net/wallet.ts and its sub-clients) throws bare Errors whose
// messages are ENGLISH prose, plus raw provider Errors (a wallet extension's
// own decline text), and the market sinks used to render err.message verbatim:
// the review's i18n medium. This module classifies an unknown thrown value to
// a small stable reason set and resolves player copy for it; the RAW message
// never renders (callers log it on the dev channel instead).
//
// Classification is structural first (the two cancel names are the only
// machine-readable signal the bridge has), then a byte-exact map over the
// bridge-AUTHORED strings (the finite inventory below; the drift pin test
// asserts each literal still exists verbatim in the bridge sources under
// src/net plus the two client-side throw sites the launcher and the desktop
// hand-off own, so a bridge reword cannot silently strand a mapping), then a
// conservative prose heuristic for provider-authored decline text, then a
// caller-flavored generic (a failed SIGNATURE and a failed PAYMENT are
// different claims).
//
// The api_error_i18n / woc_market_reason_text pattern: DOM-free, exports its
// tables for the drift pin (tests/wallet_bridge_reason_text.test.ts).

import { type TranslationKey, t } from './i18n';

export type WalletBridgeReason =
  | 'cancelled' // the player declined (picker, launcher, or in-wallet)
  | 'timeout' // the wallet never answered
  | 'not_connected'
  | 'unsupported' // the wallet lacks the needed capability
  | 'unavailable' // no provider is reachable on this platform/config
  | 'bad_response' // the wallet answered something unusable
  | 'unknown';

/** Byte-exact contracts with the bridge's own thrown strings (never provider
 *  text). Exported for the drift pin: each literal must exist verbatim in
 *  its source (src/net, the mobile launcher, the desktop hand-off and its
 *  main.ts arm), or the mapping is stranded prose. */
export const WALLET_BRIDGE_MESSAGE_REASONS: Readonly<Record<string, WalletBridgeReason>> = {
  // Cancels whose Error NAME did not survive a rethrow path.
  'wallet selection cancelled': 'cancelled',
  'wallet connection cancelled': 'cancelled',
  'wallet request was rejected': 'cancelled',
  // Timeouts.
  'wallet app did not return in time': 'timeout',
  'wallet connection timed out': 'timeout',
  // The desktop shell's browser hand-off (src/net/desktop_wallet_handoff.ts):
  // the Claudium checkout rides it on the Electron shell. 'expired' covers
  // an entry the server no longer holds (expired, or a restarted store): the
  // hand-off did not complete in time either way.
  'wallet authorization timed out': 'timeout',
  'wallet authorization expired': 'timeout',
  // Not connected.
  'connect a wallet first': 'not_connected',
  // Capability.
  'wallet cannot sign and send transactions': 'unsupported',
  // Provider/platform unavailable.
  'external wallet connection is not configured': 'unavailable',
  'native Solana wallet is unavailable': 'unavailable',
  'wallet connections are unavailable in the installed mobile web app': 'unavailable',
  'wallet is not available': 'unavailable',
  'connected Solana wallet provider is unavailable': 'unavailable',
  'native Solana Mobile bridge unavailable': 'unavailable',
  'wallet app could not be opened': 'unavailable',
  'desktop wallet browser is unavailable': 'unavailable',
  'could not open wallet authorization in the browser': 'unavailable',
  // The GAME SERVER's hand-off answer failing the shape check: no wallet
  // spoke, so 'unavailable' (reconnect and retry), never a line that blames
  // the wallet's answer.
  'server returned an invalid wallet authorization': 'unavailable',
  // Unusable answers.
  'wallet returned an invalid signature': 'bad_response',
  'wallet modified the message before signing': 'bad_response',
  'wallet returned an invalid transaction signature': 'bad_response',
  'wallet message signing returned an invalid signature': 'bad_response',
  'wallet transaction signing returned an invalid signature': 'bad_response',
  'wallet did not authorize a Solana account with message signing': 'bad_response',
  'wallet did not authorize a Solana chain': 'bad_response',
  'wallet response is invalid': 'bad_response',
  'wallet response could not be decrypted': 'bad_response',
  'native wallet returned no address': 'bad_response',
  'native wallet returned no signature': 'bad_response',
  'native wallet returned no transaction signature': 'bad_response',
  'wallet returned an invalid transaction authorization': 'bad_response',
  // The Exchange signers' desktop arm (src/game/woc_market_wiring.ts): the
  // handoff answered a result of the wrong kind for the step-up signer.
  'wallet returned an invalid step-up authorization': 'bad_response',
};

const REASON_KEYS: Readonly<Record<Exclude<WalletBridgeReason, 'unknown'>, TranslationKey>> = {
  cancelled: 'hudChrome.walletBridge.cancelled',
  timeout: 'hudChrome.walletBridge.timeout',
  not_connected: 'hudChrome.walletBridge.notConnected',
  unsupported: 'hudChrome.walletBridge.unsupported',
  unavailable: 'hudChrome.walletBridge.unavailable',
  bad_response: 'hudChrome.walletBridge.badResponse',
};

/** The caller-flavored generics: a failed step-up SIGNATURE moves no funds
 *  and must not say "payment"; a failed PAYMENT must not soften it. */
const GENERIC_KEYS: Readonly<Record<'sign' | 'payment', TranslationKey>> = {
  sign: 'hudChrome.wocMarket.signFailedConfirm',
  payment: 'hudChrome.wocMarket.signFailed',
};

/** Provider decline prose the exact map cannot know (Phantom's "User rejected
 *  the request.", localized wallets' equivalents stay unknown). Conservative:
 *  only words that unambiguously mean the PLAYER said no. */
const DECLINE_PROSE = /reject|declin|cancel|denied/i;

export function walletBridgeReason(
  err: unknown,
  opts?: {
    /** Whether the provider decline-prose heuristic may run. Default true
     *  for the market sinks, whose channel carries ONLY bridge/provider
     *  errors. A channel that MIXES its own localized throws (the Claudium
     *  checkout) must pass false: a fill containing "cancelado" would
     *  otherwise convert an unrelated localized sentence into the cancel
     *  copy, a custody-lie class. */
    proseDeclines?: boolean;
  },
): WalletBridgeReason {
  if (err && typeof err === 'object') {
    const name = (err as { name?: unknown }).name;
    if (name === 'WalletSelectionCancelled' || name === 'WalletConnectionCancelled') {
      return 'cancelled';
    }
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  // hasOwn, not a bare index: a provider message of exactly 'toString' or
  // 'constructor' would otherwise read an inherited function off the object
  // literal and escape the reason union.
  if (Object.hasOwn(WALLET_BRIDGE_MESSAGE_REASONS, message)) {
    return WALLET_BRIDGE_MESSAGE_REASONS[message];
  }
  // The deeplink's field-name family: 'wallet response is missing <field>'.
  if (message.startsWith('wallet response is missing ')) return 'bad_response';
  if (opts?.proseDeclines !== false && message !== '' && DECLINE_PROSE.test(message)) {
    return 'cancelled';
  }
  return 'unknown';
}

/** The localized line for a classified reason. */
export function walletBridgeReasonText(
  reason: WalletBridgeReason,
  flavor: 'sign' | 'payment',
): string {
  return t(reason === 'unknown' ? GENERIC_KEYS[flavor] : REASON_KEYS[reason]);
}

/** One-call form for the catch sites: classify, resolve. The caller logs the
 *  raw error on the dev channel; this never returns provider prose. */
export function walletBridgeErrorText(err: unknown, flavor: 'sign' | 'payment'): string {
  return walletBridgeReasonText(walletBridgeReason(err), flavor);
}

/**
 * The Claudium checkout's error channel, which MIXES bridge throws with the
 * checkout's own already-localized t() throws in one catch. Classified
 * bridge failures resolve here (the two claudium-flavored classes keep
 * their store-specific guidance); an UNKNOWN message passes through,
 * because it is either the checkout's own localized sentence or a provider
 * prose this classifier has no honest word for (the pre-existing posture,
 * now scoped to exactly that remainder).
 */
export function claudiumCheckoutErrorText(err: unknown): string {
  // STRICT classification (no decline-prose heuristic): this channel carries
  // the checkout's own localized sentences, and a locale whose fill contains
  // a "cancel"-family word must never be rewritten into the cancel copy.
  const reason = walletBridgeReason(err, { proseDeclines: false });
  if (reason === 'not_connected') return t('hudChrome.claudium.checkoutWalletRequired');
  if (reason === 'unsupported') return t('hudChrome.claudium.checkoutWalletUnsupported');
  if (reason !== 'unknown') return walletBridgeReasonText(reason, 'payment');
  const message = err instanceof Error ? err.message : '';
  return message || t('hudChrome.claudium.checkoutFailed');
}
