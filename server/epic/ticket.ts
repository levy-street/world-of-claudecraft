// Pure (IO-free) helpers for Epic link-proof verification: the proof shape
// clamp, the Auth Web API exchange_code token request construction, and the
// verdict parse over the upstream response body. Kept separate from the fetch
// shell (server/epic/web_api.ts) so every branch is unit-testable without a
// network, the same pure-versus-fetch split server/steam/ticket.ts keeps.
//
// Trust chain: the desktop shell mints a short-lived proof (preferred: Epic
// Games Launcher exchange code from argv AUTH_TYPE=exchangecode +
// AUTH_PASSWORD; optional EOS adapter may mint an id-token style string), the
// client posts it as POST /api/epic/link { proof }, and the SERVER exchanges it
// against Epic's OAuth token endpoint with the confidential client credentials.
// The client is never trusted to name its own Epic account id; the id comes
// out of the verified token response (account_id). A row in epic_links is the
// whole proof, and it is never an identity or session source.
//
// Residual exposure, accepted (Steam twin): an exchange code stolen inside its
// short Epic validity window could link the victim's Epic id to the THIEF'S
// account (a griefing nuisance: the thief's deeds mirror onto the victim's
// Epic profile). It can never mint a session or credential. The squat is not
// durable: the real owner reclaims by proof. When the victim posts a fresh
// valid proof for the same Epic account, POST /api/epic/link DISPLACES the
// thief's row (server/epic/routes.ts, displaceEpicLink) rather than answering
// account_taken, because a fresh verified proof proves CURRENT control of the
// Epic account, strictly stronger than the thief's stale stolen one.

/** Official Epic Auth Web API token host + path (RFC 6749 style). Pinned so
 *  no builder can drift to an unofficial host. */
export const EPIC_TOKEN_HOST = 'https://api.epicgames.dev';
export const EPIC_TOKEN_PATH = '/epic/oauth/v2/token';
export const EPIC_TOKEN_URL = `${EPIC_TOKEN_HOST}${EPIC_TOKEN_PATH}`;

/** grant_type value for launcher-launched clients (Epic Auth Web APIs). */
export const EXCHANGE_CODE_GRANT = 'exchange_code';

// The proof shape clamp. Preferred mint is a short-lived launcher exchange
// code; an optional EOS adapter may later post a longer id-token style string.
// Bounds reject empty garbage and hostile multi-megabyte bodies without
// rejecting any real exchange code or compact JWT. Charset is OAuth-safe
// printable characters (no whitespace / control bytes).
const PROOF_CHARSET = /^[A-Za-z0-9._~+/=-]+$/;
export const MIN_PROOF_CHARS = 8;
export const MAX_PROOF_CHARS = 16_384;

/** True for a plausibly-shaped link proof (charset + length clamp only; real
 *  validity is decided by Epic during verification). */
export function isProofShape(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_PROOF_CHARS &&
    value.length <= MAX_PROOF_CHARS &&
    PROOF_CHARSET.test(value)
  );
}

/**
 * How a verification response reads:
 *  - ok: the proof proves the given Epic account id;
 *  - banned: upstream reported the account is blocked / access denied for
 *    the user (the link is refused; a blocked account gets no mirror);
 *  - invalid: Epic rejected the proof (wrong client, expired exchange code,
 *    forged, or already consumed);
 *  - malformed: the body is not a recognizable token response (treated as an
 *    upstream fault by the shell, never as proof).
 */
export type ProofVerdict =
  | { kind: 'ok'; epicAccountId: string }
  | { kind: 'banned' }
  | { kind: 'invalid' }
  | { kind: 'malformed' };

/**
 * The exchange_code token request. POST form-urlencoded to EPIC_TOKEN_URL.
 * The body CONTAINS the client secret: it exists to be fetched, never logged;
 * no caller may write it (or an upstream error body) to a log line.
 *
 * Official Epic Auth Web APIs (https://dev.epicgames.com/docs/web-api-ref/authentication):
 *   POST https://api.epicgames.dev/epic/oauth/v2/token
 *   grant_type=exchange_code
 *   exchange_code=<launcher code>
 *   deployment_id=<deployment>
 *   client_id + client_secret (confidential client)
 */
export function buildExchangeCodeTokenRequest(opts: {
  clientId: string;
  clientSecret: string;
  deploymentId: string;
  exchangeCode: string;
}): { url: string; body: URLSearchParams; headers: Record<string, string> } {
  const body = new URLSearchParams();
  body.set('grant_type', EXCHANGE_CODE_GRANT);
  body.set('exchange_code', opts.exchangeCode);
  body.set('deployment_id', opts.deploymentId);
  body.set('client_id', opts.clientId);
  body.set('client_secret', opts.clientSecret);
  return {
    url: EPIC_TOKEN_URL,
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  };
}

/** Epic account id shape from a successful token response: non-empty string
 *  bounded for storage (epic_links.epic_account_id). Official field name is
 *  account_id. */
const EPIC_ACCOUNT_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** Parse a successful (2xx) token JSON body into a verdict. Attacker-adjacent
 *  input (Epic relays what the client handed it), so every read is defensive
 *  and an unrecognized shape resolves to 'malformed', never a throw. */
export function parseExchangeCodeTokenResponse(body: unknown): ProofVerdict {
  if (body === null || typeof body !== 'object') return { kind: 'malformed' };
  const accountId = (body as { account_id?: unknown }).account_id;
  if (typeof accountId !== 'string' || !EPIC_ACCOUNT_ID.test(accountId)) {
    return { kind: 'malformed' };
  }
  return { kind: 'ok', epicAccountId: accountId };
}

/**
 * Classify a non-2xx token error body. Epic puts OAuth errors on 4xx (not
 * inside a 2xx envelope the way Steam AuthenticateUserTicket does). Returns
 * invalid / banned for recognized client-or-user faults; 'upstream' when the
 * body is unusable or the status looks like a server/config fault.
 */
export function classifyTokenErrorStatus(
  status: number,
  body: unknown,
): 'invalid' | 'banned' | 'upstream' {
  // 5xx and network-adjacent statuses are never proof either way.
  if (status < 400 || status >= 500) return 'upstream';

  const error =
    body !== null && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  const errorCode = typeof error === 'string' ? error.toLowerCase() : '';

  // User / proof rejection (RFC 6749 + Epic Auth Web API grant errors).
  if (
    errorCode === 'invalid_grant' ||
    errorCode === 'invalid_token' ||
    errorCode === 'invalid_request' ||
    errorCode === 'unsupported_grant_type'
  ) {
    return 'invalid';
  }

  // Account blocked / access denied for the user (not a config miswire).
  if (errorCode === 'access_denied' || errorCode === 'account_restricted') {
    return 'banned';
  }

  // 401 with invalid_client is a server credentials problem, not a player
  // proof problem: treat as upstream so ops can fix provisioning.
  if (errorCode === 'invalid_client' || errorCode === 'unauthorized_client') {
    return 'upstream';
  }

  // Bare 400/401 without a known error code still often means a bad or spent
  // exchange code; 403 without a known code is treated as banned-adjacent.
  if (status === 403) return 'banned';
  if (status === 400 || status === 401) return 'invalid';
  return 'upstream';
}

// ---------------------------------------------------------------------------
// Achievement unlock builders (O2: server-trusted Web API path).
//
// Chosen path (never client-reported unlocks; never a native EOS SDK process
// in Node):
//   1. Client access token via Connect Web API client_credentials:
//        POST https://api.epicgames.dev/auth/v1/oauth/token
//   2. Epic account id -> Product User Id via Connect external accounts:
//        GET  https://api.epicgames.dev/user/v1/accounts
//            ?accountId=<epic_account_id>&identityProviderId=epicgames
//   3. Unlock batch via Stats Achievements service (EOS SDK
//      StatsAchievementsService base https://api.epicgames.dev/stats):
//        POST https://api.epicgames.dev/stats/v1/{deploymentId}/players/
//             {productUserId}/achievements/unlock
//        body: { achievementIds: string[] }
//
// Field names pinned: access_token, product_user_id (token response when
// present), ids map on external-accounts, achievementIds on unlock body.
// Secrets ride only in Authorization headers / form bodies: never logged.
// ---------------------------------------------------------------------------

/** Connect Web API host (EOS Game Services). Shared by token, mapping, unlock. */
export const EPIC_GS_HOST = 'https://api.epicgames.dev';

/** Connect client_credentials token path (EOS Connect Web APIs). */
export const EPIC_CONNECT_TOKEN_PATH = '/auth/v1/oauth/token';
export const EPIC_CONNECT_TOKEN_URL = `${EPIC_GS_HOST}${EPIC_CONNECT_TOKEN_PATH}`;

/** grant_type for a trusted server / GameServer-policy client. */
export const CLIENT_CREDENTIALS_GRANT = 'client_credentials';

/** External-accounts mapping path (Epic account id -> product user id). */
export const EPIC_USER_ACCOUNTS_PATH = '/user/v1/accounts';

/** identityProviderId value for Epic Account Services ids we store in
 *  epic_links.epic_account_id. */
export const EPIC_IDENTITY_PROVIDER = 'epicgames';

/** Stats Achievements service base (UnlockAchievements operation). */
export const EPIC_STATS_BASE_PATH = '/stats/v1';

/**
 * Client-credentials token request. The Authorization header CONTAINS the
 * client secret (Basic base64(clientId:clientSecret)); fetched, never logged.
 * Official Connect Web API: POST https://api.epicgames.dev/auth/v1/oauth/token
 * with grant_type=client_credentials.
 */
export function buildClientCredentialsTokenRequest(opts: {
  clientId: string;
  clientSecret: string;
}): { url: string; body: URLSearchParams; headers: Record<string, string> } {
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`, 'utf8').toString('base64');
  const body = new URLSearchParams();
  body.set('grant_type', CLIENT_CREDENTIALS_GRANT);
  return {
    url: EPIC_CONNECT_TOKEN_URL,
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
  };
}

/** Parse a 2xx client_credentials token body. Returns the access_token string
 *  or null when the shape is unusable (treated as upstream by the shell). */
export function parseClientCredentialsTokenResponse(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const token = (body as { access_token?: unknown }).access_token;
  if (typeof token !== 'string' || token.length === 0) return null;
  return token;
}

/**
 * External-account mapping URL: resolve one Epic account id to a product user
 * id. Official Connect Web API query params: accountId, identityProviderId.
 */
export function buildExternalAccountMappingUrl(opts: {
  epicAccountId: string;
  identityProviderId?: string;
}): string {
  const url = new URL(`${EPIC_GS_HOST}${EPIC_USER_ACCOUNTS_PATH}`);
  url.searchParams.set('accountId', opts.epicAccountId);
  url.searchParams.set('identityProviderId', opts.identityProviderId ?? EPIC_IDENTITY_PROVIDER);
  return url.toString();
}

/** Product user id shape from the mapping response: same conservative bound as
 *  EPIC_ACCOUNT_ID. The value is interpolated into the Stats unlock URL PATH
 *  (buildUnlockAchievementsRequest), and encodeURIComponent leaves dots alone,
 *  so a dot-segment-bearing value would survive into the path and normalize;
 *  the clamp excludes dots (and every other reserved byte) outright. */
const PRODUCT_USER_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** Parse a 2xx external-accounts mapping body for one requested Epic account
 *  id. Returns the product user id string, or null when unmapped / malformed /
 *  outside the PRODUCT_USER_ID shape clamp. */
export function parseExternalAccountMappingResponse(
  body: unknown,
  epicAccountId: string,
): string | null {
  if (body === null || typeof body !== 'object') return null;
  const ids = (body as { ids?: unknown }).ids;
  if (ids === null || typeof ids !== 'object') return null;
  const puid = (ids as Record<string, unknown>)[epicAccountId];
  if (typeof puid !== 'string' || !PRODUCT_USER_ID.test(puid)) return null;
  return puid;
}

/**
 * Unlock-achievements request. POST JSON to the Stats Achievements service.
 * Bearer token is a short-lived client access token (not a player token). The
 * Authorization header is secret-bearing: never logged.
 *
 * Path shape (O2 pin):
 *   POST /stats/v1/{deploymentId}/players/{productUserId}/achievements/unlock
 * Body field: achievementIds (string array of portal achievement ids).
 */
export function buildUnlockAchievementsRequest(opts: {
  deploymentId: string;
  productUserId: string;
  accessToken: string;
  achievementIds: readonly string[];
}): { url: string; body: string; headers: Record<string, string> } {
  const dep = encodeURIComponent(opts.deploymentId);
  const puid = encodeURIComponent(opts.productUserId);
  const url = `${EPIC_GS_HOST}${EPIC_STATS_BASE_PATH}/${dep}/players/${puid}/achievements/unlock`;
  return {
    url,
    body: JSON.stringify({ achievementIds: [...opts.achievementIds] }),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.accessToken}`,
    },
  };
}
