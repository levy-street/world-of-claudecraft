// Cached "escrowed $WOC" per wallet for the holder-tier badge (#475).
//
// When a player stakes $WOC to found a realm, the principal moves into a
// program-owned escrow vault. getTokenAccountsByOwner (woc_balance.ts) reads only
// the WALLET's token accounts, so it cannot see the vault: a naive holder-tier
// read would drop a whale's badge the instant they commit the most $WOC. This
// module sums the wallet's non-released stake principal (realm_stakes) so the
// badge counts it. woc_balance.setEscrowedWocSource is wired to this at boot
// (server/main.ts); without it (tests, the RL env) the badge stays wallet-only.
//
// Cached per wallet on the same 2-minute floor as the balance cache: stakes
// change only on found/release, and the holder-tier refresh reads this for every
// online player. The source is local Postgres, not an RPC, so a miss is cheap.

import { pool } from './db';
import { stakedBaseForWallet } from './realm_stake_db';
import { WOC_DECIMALS } from './woc_config';
import { invalidateWocBalance } from './woc_balance';

const TTL_MS = 2 * 60 * 1000;
const BASE_UNIT = 10 ** WOC_DECIMALS;

interface Entry { staked: number; at: number; }
const cache = new Map<string, Entry>();

// Whole-$WOC sum of a wallet's escrowed stakes. Realm-scale stakes stay well
// within Number range (a 100%-of-supply lock is 1e9 $WOC), so the base-unit ->
// whole conversion is exact for any realistic supply.
export async function escrowedWocForWallet(pubkey: string): Promise<number> {
  const now = Date.now();
  const hit = cache.get(pubkey);
  if (hit && now - hit.at < TTL_MS) return hit.staked;
  const base = await stakedBaseForWallet(pool, pubkey);
  const staked = Number(base) / BASE_UNIT;
  cache.set(pubkey, { staked, at: now });
  return staked;
}

// Drop a wallet's cached escrow AND wallet balance so the holder-tier badge
// refreshes from chain + DB on the next read. Call after a stake is recorded
// (wallet drained into the vault) or released (tokens back in the wallet): both
// caches re-read together, so the badge reflects the move at once without dipping.
export function invalidateWalletHoldings(pubkey: string): void {
  cache.delete(pubkey);
  invalidateWocBalance(pubkey);
}

export function resetEscrowedWocCacheForTests(): void {
  cache.clear();
}
