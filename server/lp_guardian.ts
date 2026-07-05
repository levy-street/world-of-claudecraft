// Server-side Liquidity Guardian tier reads: the staking-gated cosmetic
// sibling of the holder-tier pipeline in woc_balance.ts. Reads a wallet's
// woc_lp_vault Position over the same raw-fetch RPC seam (never a client-side
// RPC), caches per wallet, and maps it to a guardian tier through the pure
// shared src/sim/guardian_tier.ts. COSMETIC ONLY, and fail-closed: when the LP
// staking feature is not configured (WOC_LP_STAKING_ENABLED off or the
// program/mint absent) every read is tier 0 and no RPC is ever issued.
import { PublicKey } from '@solana/web3.js';
import { guardianTierIndex } from '../src/sim/guardian_tier';
import { decodePosition, POSITION_ACCOUNT_SIZE, poolPda, positionPda } from './lp_vault_client';
import { solanaRpc } from './solana_rpc';
import { isSolanaAddress } from './wallet_link';

const ENABLED = process.env.WOC_LP_STAKING_ENABLED === '1';
const PROGRAM_ID = (process.env.WOC_LP_VAULT_PROGRAM_ID ?? '').trim();
const LP_MINT = (process.env.WOC_LP_MINT ?? '').trim();
// The flair dust floor, in LP base units (pool-specific scale, so env-tuned).
const MIN_STAKE_BASE = (() => {
  const v = process.env.WOC_LP_GUARDIAN_MIN_STAKE_BASE;
  return v && /^[0-9]+$/.test(v) ? BigInt(v) : 1n;
})();

export const GUARDIAN_CACHE_TTL_MS = 2 * 60 * 1000; // matches woc_balance.ts
export const GUARDIAN_CACHE_MAX_ENTRIES = 1024;

interface CacheEntry {
  tier: number;
  stakedBase: bigint;
  at: number;
}
const cache = new Map<string, CacheEntry>();

/** Whether guardian flair is live (config-derived; cosmetics are rail-gated). */
export function guardianFlairConfigured(): boolean {
  return ENABLED && isSolanaAddress(PROGRAM_ID) && isSolanaAddress(LP_MINT);
}

function positionAddressFor(owner: string): PublicKey {
  const programId = new PublicKey(PROGRAM_ID);
  return positionPda(programId, poolPda(programId, new PublicKey(LP_MINT)), new PublicKey(owner));
}

interface RpcAccountInfoResponse {
  value?: { data?: [string, string] } | null;
}

/**
 * The wallet's guardian tier + staked LP, cached. Tier 0 (and no RPC) when the
 * feature is unconfigured or the wallet is malformed; tier 0 on any RPC
 * failure (fail-closed flair: never guess a badge).
 */
export async function guardianInfoForPubkey(
  pubkey: string,
): Promise<{ tier: number; stakedBase: bigint }> {
  if (!guardianFlairConfigured() || !isSolanaAddress(pubkey)) return { tier: 0, stakedBase: 0n };
  const cached = cache.get(pubkey);
  const now = Date.now();
  if (cached && now - cached.at < GUARDIAN_CACHE_TTL_MS)
    return { tier: cached.tier, stakedBase: cached.stakedBase };

  let tier = 0;
  let stakedBase = 0n;
  try {
    const res = await solanaRpc<RpcAccountInfoResponse>('getAccountInfo', [
      positionAddressFor(pubkey).toBase58(),
      { encoding: 'base64' },
    ]);
    const b64 = res?.value?.data?.[0];
    if (typeof b64 === 'string') {
      const raw = Buffer.from(b64, 'base64');
      if (raw.length === POSITION_ACCOUNT_SIZE) {
        const p = decodePosition(raw);
        stakedBase = p.amount;
        tier = guardianTierIndex(
          {
            amountBase: p.amount,
            lockedUntil: Number(p.lockedUntil),
            stakedAt: Number(p.stakedAt),
          },
          Math.floor(now / 1000),
          MIN_STAKE_BASE,
        );
      }
    }
  } catch {
    // RPC hiccup: cosmetic read, fail closed to no flair and retry after TTL.
    tier = 0;
    stakedBase = 0n;
  }

  if (cache.size >= GUARDIAN_CACHE_MAX_ENTRIES && !cache.has(pubkey)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(pubkey, { tier, stakedBase, at: now });
  return { tier, stakedBase };
}

/** Test seam: drop all cached entries. */
export function resetGuardianCacheForTests(): void {
  cache.clear();
}
