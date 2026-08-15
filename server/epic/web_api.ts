// The fetch shell over the pure ticket helpers: the one place server code
// talks to the Epic Auth / Connect / Stats Web APIs for link verification and
// achievement unlock push. Secrets discipline: the client secret rides only
// inside request builders (form body or Basic Authorization); NOTHING here
// logs a URL, a request body, an Authorization header, or an upstream response
// body (an upstream error body can echo the request back). Log lines, if any,
// are fixed strings plus a bare HTTP status at most.

import {
  buildClientCredentialsTokenRequest,
  buildExchangeCodeTokenRequest,
  buildExternalAccountMappingUrl,
  buildUnlockAchievementsRequest,
  classifyTokenErrorStatus,
  type ProofVerdict,
  parseClientCredentialsTokenResponse,
  parseExchangeCodeTokenResponse,
  parseExternalAccountMappingResponse,
} from './ticket';

/** Upstream fetch deadline. Exported for the magnitude pin in
 *  tests/server/epic_web_api.test.ts only. */
export const UPSTREAM_TIMEOUT_MS = 5000;

/** A verification outcome: the parsed verdict, or 'upstream' when Epic could
 *  not be asked (network error, timeout, unparseable body, server fault). An
 *  'upstream' outcome is NEVER treated as proof in either direction. */
export type VerifyOutcome = ProofVerdict | { kind: 'upstream' };

/** Ask Epic whether the proof (launcher exchange code) proves an Epic account
 *  id for our confidential client + deployment. */
export async function verifyLinkProof(
  opts: {
    clientId: string;
    clientSecret: string;
    deploymentId: string;
    proof: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyOutcome> {
  const { url, body, headers } = buildExchangeCodeTokenRequest({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    deploymentId: opts.deploymentId,
    exchangeCode: opts.proof,
  });

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'upstream' };
  }

  const parsed = await res.json().catch(() => null);

  if (!res.ok) {
    // Non-2xx: OAuth error envelope on 4xx, or server fault. Never treat a
    // network-adjacent or unparseable failure as proof.
    if (parsed === null) return { kind: 'upstream' };
    const classified = classifyTokenErrorStatus(res.status, parsed);
    if (classified === 'upstream') return { kind: 'upstream' };
    return { kind: classified };
  }

  if (parsed === null) return { kind: 'upstream' };
  const verdict = parseExchangeCodeTokenResponse(parsed);
  // A malformed 2xx body is an upstream fault (Epic answered garbage), not a
  // proof verdict; the route serves 503 and the player retries.
  if (verdict.kind === 'malformed') return { kind: 'upstream' };
  return verdict;
}

// ---------------------------------------------------------------------------
// Achievement unlock push (O2 server-trusted path).
//
// Steps, all fire-and-forget from the caller's perspective (the mirror worker
// owns retries): client_credentials token -> epic account to product user id
// mapping -> batch unlock. True only when the unlock POST returns 2xx; false
// on any fault (network, non-2xx, unmapped product user, missing token).
//
// The token and the mapping are CACHED per process (the repo hot-path rule:
// a viewer-identical upstream read on a repeating path must not re-fetch).
// Without the caches every push ATTEMPT costs three upstream round trips and
// a fully exhausted retry ladder costs twelve; a mass-reconnect reconcile of
// N linked accounts would pay N token mints and N mapping lookups on the same
// host as the 50 ms world loop. The token memo honors the response's
// expires_in (with a safety margin) and is invalidated whenever the unlock
// POST answers 401, so a revoked credential re-mints on the next attempt. The
// mapping cache is bounded and TTL'd; an unmapped (null) result is never
// cached, since the player may connect to the product at any moment.
// ---------------------------------------------------------------------------

/** Fallback token lifetime when the response carries no usable expires_in. */
export const TOKEN_FALLBACK_TTL_MS = 5 * 60 * 1000;
/** Refresh margin subtracted from the reported lifetime so a token is never
 *  used within its final minute. */
export const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
/** Product-user-id mapping cache TTL. The mapping is stable once present
 *  (Epic account -> product user), so an hour only bounds staleness after an
 *  account-level change upstream. */
export const PUID_CACHE_TTL_MS = 60 * 60 * 1000;
/** Hard cap on the mapping cache; the oldest entry (Map insertion order) is
 *  evicted before a new key past this size, same shape as the mirror's link
 *  cache bound. */
export const PUID_CACHE_MAX = 8192;

let cachedToken: { token: string; expiresAtMs: number } | null = null;
const puidCache = new Map<string, { productUserId: string; expiresAtMs: number }>();

/** Drop the token memo and mapping cache (test-only). */
export function resetEpicWebApiCachesForTests(): void {
  cachedToken = null;
  puidCache.clear();
}

/** Obtain a short-lived client access token for Game Services Web APIs,
 *  reusing the process-local memo while it has lifetime left. */
async function fetchClientAccessToken(
  opts: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const now = Date.now();
  if (cachedToken !== null && now < cachedToken.expiresAtMs) return cachedToken.token;
  const { url, body, headers } = buildClientCredentialsTokenRequest(opts);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = await res.json().catch(() => null);
  const token = parseClientCredentialsTokenResponse(parsed);
  if (token === null) return null;
  // expires_in is seconds (RFC 6749). Defensive read: a missing or unusable
  // value falls back to a short fixed lifetime rather than caching forever.
  const expiresIn =
    parsed !== null && typeof parsed === 'object'
      ? (parsed as { expires_in?: unknown }).expires_in
      : undefined;
  const lifetimeMs =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn * 1000
      : TOKEN_FALLBACK_TTL_MS;
  const expiresAtMs = now + Math.max(0, lifetimeMs - TOKEN_REFRESH_MARGIN_MS);
  // A lifetime at or under the margin is used once, never memoized.
  cachedToken = expiresAtMs > now ? { token, expiresAtMs } : null;
  return token;
}

/** Resolve an Epic account id to a product user id for this product, through
 *  the bounded TTL cache. Null when Epic has no mapping (player has never
 *  connected to the product) or on any upstream fault; null is never cached. */
async function resolveProductUserId(
  opts: { accessToken: string; epicAccountId: string },
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const now = Date.now();
  const hit = puidCache.get(opts.epicAccountId);
  if (hit !== undefined && now < hit.expiresAtMs) return hit.productUserId;
  const url = buildExternalAccountMappingUrl({ epicAccountId: opts.epicAccountId });
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = await res.json().catch(() => null);
  const productUserId = parseExternalAccountMappingResponse(parsed, opts.epicAccountId);
  if (productUserId !== null) {
    if (!puidCache.has(opts.epicAccountId) && puidCache.size >= PUID_CACHE_MAX) {
      const oldest = puidCache.keys().next().value;
      if (oldest !== undefined) puidCache.delete(oldest);
    }
    puidCache.set(opts.epicAccountId, { productUserId, expiresAtMs: now + PUID_CACHE_TTL_MS });
  }
  return productUserId;
}

/**
 * POST a batch of achievement unlocks for one linked Epic account in ONE
 * unlock call (achievementIds array). True on a 2xx unlock response, false
 * otherwise; the mirror worker owns retries and gives up quietly (reconcile
 * heals later). Batching lets the mirror flush a whole account's reconcile set
 * in a single request instead of one per unlock.
 *
 * Server-trusted only: never accepts client-reported unlocks. The path is
 * client_credentials + external-account mapping + Stats Achievements unlock
 * (see ticket.ts O2 builders). Secrets never log.
 */
export async function pushAchievementUnlocks(
  opts: {
    clientId: string;
    clientSecret: string;
    deploymentId: string;
    epicAccountId: string;
    achNames: readonly string[];
  },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (opts.achNames.length === 0) return true;

  const accessToken = await fetchClientAccessToken(
    { clientId: opts.clientId, clientSecret: opts.clientSecret },
    fetchImpl,
  );
  if (accessToken === null) return false;

  const productUserId = await resolveProductUserId(
    { accessToken, epicAccountId: opts.epicAccountId },
    fetchImpl,
  );
  if (productUserId === null) return false;

  const { url, body, headers } = buildUnlockAchievementsRequest({
    deploymentId: opts.deploymentId,
    productUserId,
    accessToken,
    achievementIds: opts.achNames,
  });
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    // 401 means the memoized token is no longer honored (revoked or expired
    // early): drop it so the mirror's next retry attempt mints fresh instead
    // of burning the whole ladder on a dead credential.
    if (res.status === 401) cachedToken = null;
    return res.ok;
  } catch {
    return false;
  }
}

/** POST one achievement unlock. Thin single-name wrapper over
 *  pushAchievementUnlocks; kept for callers that unlock exactly one deed. */
export async function pushAchievementUnlock(
  opts: {
    clientId: string;
    clientSecret: string;
    deploymentId: string;
    epicAccountId: string;
    achName: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  return pushAchievementUnlocks(
    {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      deploymentId: opts.deploymentId,
      epicAccountId: opts.epicAccountId,
      achNames: [opts.achName],
    },
    fetchImpl,
  );
}
