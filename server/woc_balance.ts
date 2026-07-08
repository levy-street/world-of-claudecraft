// Server-side $WOC balance reads: the ONLY place the Solana RPC endpoint is used.
//
// Both the in-world holder-tier flair (broadcast to nearby players) and the
// connected wallet's own balance (drawn on the player card / bag, via the
// /api/woc/balance proxy) are read here with a raw fetch, so the RPC URL, and any
// API key embedded in it, never ship in the client bundle. Cached per wallet, since
// balances move slowly and public RPCs are rate-limited.
//
// Reads SOLANA_RPC_URL + WOC_MINT from the SERVER environment. The VITE_* names are
// accepted only as a local-dev fallback (server/db.ts loads .env.local); no client
// code references them, so nothing secret is inlined at build time.
import type http from 'node:http';
import { holderTierIndexForBalance } from '../src/sim/holder_tier';
import { logger } from './http/logger';
import { json } from './http_util';
import {
  providerUsageSnapshot,
  recordUsageCacheEvent,
  recordUsageMetric,
  resetUsageCacheForTests,
  setUsageCacheSize,
  type UsageCacheSnapshot,
} from './provider_usage';
import { isSolanaAddress } from './wallet_link';

const WOC_MINT = (
  process.env.WOC_MINT ??
  process.env.VITE_WOC_MINT ??
  '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'
).trim();
const SOLANA_RPC_URL = (
  process.env.SOLANA_RPC_URL ??
  process.env.VITE_SOLANA_RPC_URL ??
  'https://api.mainnet-beta.solana.com'
).trim();
// How long a per-wallet balance is reused before the next RPC. This is the
// freshness floor for the in-world holder-tier badge (the broadcast path reads
// through this cache); the player's own card/bag bypass it with `fresh=1` on
// open. 2 min keeps token changes visible within a couple minutes while staying
// well under public-RPC rate limits (≈ online-players / 2 min in RPC reads).
export const CACHE_TTL_MS = 2 * 60 * 1000;
export const WOC_BALANCE_CACHE_MAX_ENTRIES = 1024;

interface CacheEntry {
  balance: number;
  at: number;
}
const cache = new Map<string, CacheEntry>();
setUsageCacheSize('woc.balance', cache.size, WOC_BALANCE_CACHE_MAX_ENTRIES);

interface RpcTokenAmount {
  uiAmount?: unknown;
  uiAmountString?: unknown;
  amount?: unknown;
  decimals?: unknown;
}

interface RpcTokenAccount {
  account?: {
    data?: {
      parsed?: {
        info?: {
          tokenAmount?: unknown;
        };
      };
    };
  };
}

interface RpcTokenAccountsResponse {
  result?: {
    value?: RpcTokenAccount[];
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseDecimalAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function decimalStringFromRawAmount(rawAmount: string, decimals: number): string | null {
  const raw = rawAmount.trim();
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    return null;
  const digits = raw.replace(/^0+/, '') || '0';
  if (decimals === 0) return digits;

  const integerDigits = digits.length > decimals ? digits.slice(0, -decimals) : '0';
  const fractionalDigits =
    digits.length > decimals ? digits.slice(-decimals) : digits.padStart(decimals, '0');
  const trimmedFraction = fractionalDigits.replace(/0+$/, '');
  return trimmedFraction ? `${integerDigits}.${trimmedFraction}` : integerDigits;
}

function parseRawAmount(rawAmount: unknown, decimals: unknown): number | null {
  if (typeof rawAmount !== 'string' || typeof decimals !== 'number') return null;
  const decimal = decimalStringFromRawAmount(rawAmount, decimals);
  return decimal === null ? null : parseDecimalAmount(decimal);
}

function parseTokenBalance(tokenAmount: unknown): number | null {
  const record = asRecord(tokenAmount);
  if (!record) return null;
  const amountRecord: RpcTokenAmount = record;
  const { uiAmount, uiAmountString, amount, decimals } = amountRecord;
  if (typeof uiAmount === 'number' && Number.isFinite(uiAmount) && uiAmount >= 0) return uiAmount;
  if (typeof uiAmountString === 'string') {
    const parsed = parseDecimalAmount(uiAmountString);
    if (parsed !== null) return parsed;
  }
  return parseRawAmount(amount, decimals);
}

function rememberCacheEntry(pubkey: string, entry: CacheEntry): void {
  cache.delete(pubkey);
  cache.set(pubkey, entry);
  evictOldestCacheEntries();
  setUsageCacheSize('woc.balance', cache.size, WOC_BALANCE_CACHE_MAX_ENTRIES);
}

function evictOldestCacheEntries(): void {
  while (cache.size > WOC_BALANCE_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
    recordUsageCacheEvent('woc.balance', 'eviction');
  }
}

export function resetWocBalanceCacheForTests(): void {
  cache.clear();
  resetUsageCacheForTests('woc.balance');
  setUsageCacheSize('woc.balance', cache.size, WOC_BALANCE_CACHE_MAX_ENTRIES);
}

export function wocBalanceCacheStats(): UsageCacheSnapshot {
  const stats = providerUsageSnapshot().caches.find(
    (cacheStats) => cacheStats.key === 'woc.balance',
  );
  if (!stats) throw new Error('missing woc balance cache stats');
  return stats;
}

/**
 * The owner's total $WOC across all their token accounts for the mint, in
 * human-readable units. Returns null on any RPC/parse failure so callers can
 * keep the last known value.
 */
export async function fetchWocBalance(pubkey: string): Promise<number | null> {
  recordUsageMetric('woc.balance.rpc');
  try {
    const res = await fetch(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [pubkey, { mint: WOC_MINT }, { encoding: 'jsonParsed' }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      recordUsageMetric('woc.balance.rpc.failure');
      return null;
    }
    const data = (await res.json()) as RpcTokenAccountsResponse;
    const accounts = data?.result?.value;
    if (!Array.isArray(accounts)) {
      recordUsageMetric('woc.balance.rpc.failure');
      return null;
    }
    let total = 0;
    for (const a of accounts) {
      const info = asRecord(a?.account?.data?.parsed?.info);
      const balance = parseTokenBalance(info?.tokenAmount);
      if (balance !== null) total += balance;
    }
    return total;
  } catch (err) {
    recordUsageMetric('woc.balance.rpc.failure');
    logger.error({ pubkey, err }, 'woc balance read failed');
    return null;
  }
}

/**
 * Cached $WOC balance for a wallet. Re-fetches at most once per TTL; on a failed
 * refresh keeps the last known balance, or null when the wallet has never been
 * read successfully (so callers can omit the figure). One per-wallet cache backs
 * both the holder-tier broadcast and the client balance proxy.
 */
export async function cachedWocBalance(pubkey: string, fresh = false): Promise<number | null> {
  const now = Date.now();
  const hit = cache.get(pubkey);
  if (!fresh && hit && now - hit.at < CACHE_TTL_MS) {
    recordUsageCacheEvent('woc.balance', 'hit');
    rememberCacheEntry(pubkey, hit);
    return hit.balance;
  }
  // Genuine staleness only. A fresh=1 bypass of a still-in-TTL entry reaches here
  // too, but it's a deliberate skip — not a stale refresh — so it records neither
  // 'stale' nor 'miss' (the ensuing fetch still records 'store'/'failure').
  if (!hit) recordUsageCacheEvent('woc.balance', 'miss');
  else if (now - hit.at >= CACHE_TTL_MS) recordUsageCacheEvent('woc.balance', 'stale');
  const balance = await fetchWocBalance(pubkey);
  if (balance === null) {
    recordUsageCacheEvent('woc.balance', 'failure');
    if (!hit) return null;
    rememberCacheEntry(pubkey, hit);
    return hit.balance;
  }
  recordUsageCacheEvent('woc.balance', 'store');
  rememberCacheEntry(pubkey, { balance, at: now });
  return balance;
}

/**
 * Cached holder tier + exact balance for a wallet. The tier is derived from the
 * (cached) balance; {0, 0} when the wallet has never been read successfully. This
 * backs the `ht`/`hb` holder-tier identity payload the server broadcasts.
 */
export async function holderInfoForPubkey(
  pubkey: string,
): Promise<{ tier: number; balance: number }> {
  const balance = await cachedWocBalance(pubkey);
  if (balance === null) return { tier: 0, balance: 0 };
  return { tier: holderTierIndexForBalance(balance), balance };
}

/**
 * Parse the /api/woc/balance query string into its `{ owner, fresh }` inputs.
 * `fresh` is true ONLY for the exact `fresh=1` opt-in — any other value, or its
 * absence, is a normal cached read, so a stray `fresh=true`/`fresh=0` can't be
 * used to force an RPC. `owner` defaults to '' so the handler's address
 * validation rejects a missing owner with a 400. Pure + import-safe (unlike the
 * route in main.ts, which self-runs the server on import), so it's unit-tested.
 */
export function parseWocBalanceQuery(rawUrl: string): { owner: string; fresh: boolean } {
  const params = new URLSearchParams(rawUrl.split('?')[1] ?? '');
  return { owner: params.get('owner') ?? '', fresh: params.get('fresh') === '1' };
}

/**
 * GET /api/woc/balance?owner=<pubkey>[&fresh=1] → { balance: number | null }
 *
 * Public proxy that keeps the RPC endpoint server-side. On-chain balances are
 * public, and this is narrow (only the $WOC mint, for one owner); the address is
 * validated before any RPC, the per-wallet cache plus the route's IP rate-limit
 * bound load, so it can't be abused as a general RPC passthrough. `fresh` skips
 * the per-wallet TTL (used when the player opens a balance surface so a token
 * change shows up) — still behind the route's IP rate-limit.
 */
export async function handleWocBalance(
  res: http.ServerResponse,
  owner: string,
  fresh = false,
): Promise<void> {
  recordUsageMetric('woc.balance.api');
  if (!isSolanaAddress(owner)) return json(res, 400, { error: 'invalid Solana wallet address' });
  const balance = await cachedWocBalance(owner, fresh);
  return json(res, 200, { balance });
}
