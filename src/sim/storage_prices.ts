// Storage price resolution (Bank Storage phase 09): the ONE boot-time step
// that turns an optional host override (SimConfig.storagePrices) into the
// frozen table behind every ctx.storagePrices price read. Exactly THREE
// tables are in scope, the personal-storage prices of the bank-storage
// packet: bank slot expansions, bank bag sockets, and Materials Vault rungs.
// The guild bank rung ladder (guild_bank.ts GUILD_BANK_RUNG_PRICES) is
// deliberately OUTSIDE the seam and stays compiled-only: making it tunable
// is a separate maintainer scope call, recorded in the packet ledger; the
// client still renders it wire-only (tests/storage_price_guard.test.ts).
// The compiled constants in bank.ts and materials_vault.ts stay both the
// defaults and the shape contract: an override dimension is accepted only at
// the exact compiled length, so every table-length read (the purchase caps,
// the sanitize load-path clamps) is length-stable under any override.
//
// `src/sim`-pure and PURE by contract: no DOM/Three imports, no env reads, no
// clock, no rng (enforced by tests/architecture.test.ts). Resolved once in the
// Sim constructor; never read mid-tick.

import { BANK_EXPANSION_PRICES, BANK_SOCKET_PRICES } from './bank';
import { VAULT_UPGRADE_PRICES } from './materials_vault';
import type { StoragePrices, StoragePricesOverride } from './types';

// Re-exported so consumers of the resolver can name its types from one module.
export type { StoragePrices, StoragePricesOverride } from './types';

const frozenCopy = (prices: readonly number[]): readonly number[] => Object.freeze([...prices]);

/** The compiled default tables: frozen copies spread from the exported
 *  constants, so the defaults stay byte-identical to the compiled tables. */
export const DEFAULT_STORAGE_PRICES: StoragePrices = Object.freeze({
  bankExpansions: frozenCopy(BANK_EXPANSION_PRICES),
  bankSockets: frozenCopy(BANK_SOCKET_PRICES),
  vaultUpgrades: frozenCopy(VAULT_UPGRADE_PRICES),
});

// One dimension's validation: accepted only as an array of EXACTLY the default
// length whose every entry is a SAFE integer >= 0 (Number.isSafeInteger
// rejects NaN/Infinity/fractions/non-numbers AND magnitudes past
// Number.MAX_SAFE_INTEGER: an operator's mistyped exponent like 1e300 must
// reject loudly, not apply as an unpayable price; zero IS a legal price, the
// phase's rejection list names negative and non-integer, never zero). One bad
// entry drops the WHOLE dimension back to its default; a dimension never
// half-applies. Accepted values return as a frozen COPY, never an alias of the
// caller's array.
const resolveDimension = (raw: unknown, fallback: readonly number[]): readonly number[] => {
  if (!Array.isArray(raw) || raw.length !== fallback.length) return fallback;
  for (const entry of raw) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0) return fallback;
  }
  return frozenCopy(raw);
};

/** Resolve a host override into the full frozen price table. Per-dimension
 *  independence: each of the three lists validates alone, so a malformed
 *  dimension falls back by itself while a valid sibling still applies. A
 *  non-object, null, or array top-level input returns all defaults. Typed
 *  `unknown` because validation is ENTIRELY runtime (untyped hosts hand this
 *  parsed JSON); the intended shape is StoragePricesOverride. */
export function resolveStoragePrices(overrides?: unknown): StoragePrices {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return DEFAULT_STORAGE_PRICES;
  }
  const o = overrides as StoragePricesOverride;
  return Object.freeze({
    bankExpansions: resolveDimension(o.bankExpansions, DEFAULT_STORAGE_PRICES.bankExpansions),
    bankSockets: resolveDimension(o.bankSockets, DEFAULT_STORAGE_PRICES.bankSockets),
    vaultUpgrades: resolveDimension(o.vaultUpgrades, DEFAULT_STORAGE_PRICES.vaultUpgrades),
  });
}
