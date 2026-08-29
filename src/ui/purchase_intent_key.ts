// The ONE idempotency-key minter every Claudium-spending surface uses.
//
// WHY IT IS NOT IN store_purchase_intent.ts, which is where it belongs by
// subject: that module is registered in UI_PURE_CORES and the architecture
// guard scans those files for Math.random / Date.now / performance.now. A
// minter needs exactly those, and the ledger's own header states the property
// the scan protects ("this module never touches crypto, the clock, or the
// network"), which is what lets a caller inject a minter and unit-test the
// ledger deterministically. Moving the minter in would trade a real guarantee
// for tidiness. It is not in a WINDOW either: it lived in
// src/ui/daily_rewards_window.ts while the store was the only spender, and the
// banker's rung purchase would have had to import one window module from
// another to reach it.
//
// A SECOND MINTER IS THE THING TO AVOID. Both arms must stay inside the
// server's STORAGE_KEY_PATTERN, `^[A-Za-z0-9_.:-]{1,200}$`. A key that fails it
// comes back 'invalid_request', which the intent ledger reads as DEFINITIVE and
// closes the intent on, so a charset regression does not surface as an error:
// it silently loses the intent, and the next attempt mints a fresh key over a
// debit that may still be live.

/** Crypto-random key for one purchase intent. src/net owns the network client,
 *  so the UI mints its own rather than importing from there.
 *
 *  crypto.randomUUID emits hex and hyphens; the fallback emits a literal prefix
 *  plus digits, lowercase letters and hyphens. Both arms are pinned against the
 *  server pattern by tests/daily_rewards_store_behavior.test.ts. */
export function mintIntentKey(): string {
  const source = globalThis.crypto;
  if (source && 'randomUUID' in source) return source.randomUUID();
  return `intent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
