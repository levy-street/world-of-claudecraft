// Thin, secret-gated proxy to the economy service's realm-stake handler (#475).
//
// The realm_stake_escrow on-chain verification moved to the economy service
// (repo woc-daily-rewards-service, routes /v1/economy/realm-stake/*). The service
// owns the settlement engine and the finalized-tx verification; the game no longer
// re-implements it. This module is the game server's client to those routes:
// secret-gated (x-woc-economy-secret, browsers never see it), fetch-only (no
// extra dependency), and GRACEFUL. When the service is not configured
// (WOC_ECONOMY_URL / WOC_ECONOMY_SECRET unset) every method returns null so the
// caller can fall back to its own path; the game boots and runs with the rail off.
//
// The escrow handle the game passes is the SAME stake PDA the UI deposits to
// (server/realm_escrow.ts realmStakePda): the service independently re-derives it
// from the realmId + program and rejects a mismatch, so the address the wallet
// funds is exactly the address the service verifies. No client money math: the
// game reads the service's staked/reason verdict, it does not inspect the chain.

// The additive optional escrow handle shape the service re-derives and verifies.
// jobIdNum is the generic numeric-id field on the shared EscrowHandleV1 (the realm
// id here); handle is the derived stake PDA (base58).
export interface RealmStakeHandle {
  jobIdNum: string; // the numeric realmId (u64, decimal string) the PDA is seeded from
  handle: string; // the derived stake PDA (base58)
}

export interface RealmStakeQuoteResult {
  realmId: string;
  escrow: string; // the resolved stake PDA (== the game handle)
  escrowProgramId: string;
  amountBase: string;
  memo: string;
  expiresAtMs: number;
  reason?: string; // set when the service rejected the quote (rail off, bad/mismatched handle)
}

export interface RealmStakeConfirmResult {
  staked: boolean;
  reason?: string; // not_finalized | quote_expired | wrong_amount | memo_mismatch | already_staked
}

function config(): { baseUrl: string; secret: string } | null {
  const baseUrl = (process.env.WOC_ECONOMY_URL ?? '').trim().replace(/\/$/, '');
  const secret = (process.env.WOC_ECONOMY_SECRET ?? '').trim();
  if (!baseUrl || !secret) return null;
  return { baseUrl, secret };
}

/** True when the economy service is configured; the caller can require the rail. */
export function realmStakeServiceConfigured(): boolean {
  return config() !== null;
}

function headers(secret: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-woc-economy-secret': secret };
}

// A bounded fetch so a slow/hung service never wedges a request handler.
async function postJson<T>(path: string, body: unknown, timeoutMs = 8000): Promise<T | null> {
  const cfg = config();
  if (!cfg) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: headers(cfg.secret),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(`realm-stake proxy: ${path} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`realm-stake proxy: ${path} failed: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Quote the stake with the game-derived escrow handle. The service re-derives the
// stake PDA from the realmId + program and rejects a missing / malformed /
// mismatched handle. Returns null on a transport failure or when the service is
// not configured (the caller falls back).
export function realmStakeQuote(req: {
  ownerAccountId: number;
  owner: string;
  realmId: string;
  amountBase: string;
  escrow: RealmStakeHandle;
}): Promise<RealmStakeQuoteResult | null> {
  return postJson<RealmStakeQuoteResult>('/v1/economy/realm-stake/stake/quote', req);
}

// Confirm the stake: the service verifies the finalized on-chain deposit against
// the agreed stake PDA (finalized, exact mint + amount, destination = the PDA) and
// returns the staked/reason verdict. Returns null on a transport failure or when
// the service is not configured (the caller falls back to its own verify).
export function realmStakeConfirm(req: {
  realmId: string;
  signature: string;
}): Promise<RealmStakeConfirmResult | null> {
  return postJson<RealmStakeConfirmResult>('/v1/economy/realm-stake/stake/confirm', req);
}
