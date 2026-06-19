// Server-side $WOC balance reads for the in-world holder-tier flair.
//
// The client reads its own balance (src/net/wallet.ts) to draw the player card;
// for the in-world nameplate flair the SERVER must know each player's tier so it
// can broadcast it to everyone nearby. We hit the Solana JSON-RPC directly (raw
// fetch — no @solana/web3.js in the server bundle) and cache per-wallet, since
// balances change slowly and public RPCs are rate-limited.
//
// Reads SOLANA_RPC_URL + WOC_MINT from the server environment (NOT the VITE_*
// client vars) — this is the production-correct place for the RPC key, off the
// client. The mint default matches src/net/wallet.ts.
import { holderTierForBalance } from '../src/ui/holder_tier';

// Prefer the server-only vars; fall back to the client's VITE_* values (loaded
// from .env.local in dev by server/db.ts) so a single local config drives both,
// then to public defaults. In production set SOLANA_RPC_URL + WOC_MINT directly.
const WOC_MINT = (process.env.WOC_MINT ?? process.env.VITE_WOC_MINT ?? '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth').trim();
const SOLANA_RPC_URL = (process.env.SOLANA_RPC_URL ?? process.env.VITE_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com').trim();
// Balances move slowly relative to a play session; one RPC per wallet per this
// window is plenty and keeps us well under public-RPC rate limits.
const CACHE_TTL_MS = 5 * 60 * 1000;

interface TierEntry { tier: number; at: number; }
const cache = new Map<string, TierEntry>();

/**
 * The owner's total $WOC across all their token accounts for the mint, in
 * human-readable units (the RPC's uiAmount already applies decimals). Returns
 * null on any RPC/parse failure so callers can keep the last known value.
 */
export async function fetchWocBalance(pubkey: string): Promise<number | null> {
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
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } } }> };
    };
    const accounts = data?.result?.value;
    if (!Array.isArray(accounts)) return null;
    let total = 0;
    for (const a of accounts) {
      const ui = a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof ui === 'number') total += ui;
    }
    return total;
  } catch (err) {
    console.error('[woc] balance read failed for', pubkey, err);
    return null;
  }
}

/**
 * Cached holder-tier index (0 = none, 1-10) for a wallet. Re-fetches at most once
 * per TTL; on a failed refresh, keeps the cached value (or 0 if never fetched).
 */
export async function holderTierForPubkey(pubkey: string): Promise<number> {
  const now = Date.now();
  const hit = cache.get(pubkey);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.tier;
  const balance = await fetchWocBalance(pubkey);
  if (balance === null) return hit?.tier ?? 0; // keep last known tier on failure
  const tier = holderTierForBalance(balance)?.index ?? 0;
  cache.set(pubkey, { tier, at: now });
  return tier;
}
