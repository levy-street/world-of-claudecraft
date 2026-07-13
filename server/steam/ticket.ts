// Pure (IO-free) helpers for Steam link-ticket verification: the ticket shape
// clamp, the AuthenticateUserTicket request construction, and the verdict
// parse over the upstream response body. Kept separate from the fetch shell
// (server/steam/web_api.ts) so every branch is unit-testable without a
// network, the wallet_link.ts versus wallet.ts split.
//
// Trust chain: the desktop shell asks Steam for a session ticket bound to the
// identity string below, the client posts the hex ticket to POST
// /api/steam/link, and the SERVER proves it against Steam's
// ISteamUserAuth/AuthenticateUserTicket with the publisher key. The client is
// never trusted to name its own Steam id; the id comes out of the verified
// ticket. A row in steam_links is the whole proof, and it is never an
// identity or session source.
//
// Residual exposure, accepted: a web-api ticket cannot carry a WoCC-issued
// nonce, so a ticket stolen inside its short Steam validity window could link
// the victim's Steam id to the THIEF'S account (a griefing nuisance: the
// thief's deeds mirror onto the victim's Steam profile). It can never mint a
// session or credential; it is bounded by the ticket lifetime and the identity
// binding. The squat is not durable: the real owner reclaims by proof. When the
// victim posts a fresh valid ticket for the same Steam id, POST /api/steam/link
// DISPLACES the thief's row (server/steam/routes.ts, displaceSteamLink) rather
// than answering account_taken, because a fresh ticket proves CURRENT control
// of the Steam account, strictly stronger than the thief's stale stolen one, so
// the true owner always wins in steady state. The stronger future design is a
// server-issued identity challenge: today both ends pin the fixed identity
// 'wocc-link' (the desktop mints its ticket for it, electron/steam.cjs), so a
// per-link server nonce would close the theft window entirely, not just bound
// it. This equals Steam's own account-linking model.

/** The agreed identity string both ends pin: the desktop shell requests its
 *  ticket for this identity and the server verifies with the same value, so a
 *  ticket minted for any other consumer fails verification here. */
export const TICKET_IDENTITY = 'wocc-link';

// The hex shape clamp. A web-api session ticket is a variable-length byte
// blob (it embeds the account's license list, so size varies per account);
// Steam's GetTicketForWebApiResponse_t caps it at k_nCubTicketMaxLength =
// 2560 bytes, which the shell hex-encodes to at most 5120 chars. 5120 bounds
// a hostile caller without rejecting any real ticket, and 40 rejects garbage
// too short to be one.
const TICKET_HEX = /^[0-9a-fA-F]+$/;
export const MIN_TICKET_HEX_CHARS = 40;
export const MAX_TICKET_HEX_CHARS = 5120;

/** True for a plausibly-shaped hex ticket (charset + length clamp only; real
 *  validity is decided by Steam during verification). */
export function isTicketShape(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_TICKET_HEX_CHARS &&
    value.length <= MAX_TICKET_HEX_CHARS &&
    TICKET_HEX.test(value)
  );
}

/** The partner (publisher-key) Web API host. Publisher keys are rejected on
 *  the public api.steampowered.com host, so all server-side calls go here. */
export const PARTNER_API_HOST = 'https://partner.steam-api.com';

/**
 * The AuthenticateUserTicket request URL. GET with key/appid/ticket/identity
 * as query params. The returned URL CONTAINS the publisher key: it exists to
 * be fetched, never logged; no caller may write it (or an upstream error
 * body) to a log line.
 */
export function buildAuthenticateUserTicketUrl(opts: {
  key: string;
  appId: number;
  ticket: string;
  identity?: string;
}): string {
  const url = new URL(`${PARTNER_API_HOST}/ISteamUserAuth/AuthenticateUserTicket/v1/`);
  url.searchParams.set('key', opts.key);
  url.searchParams.set('appid', String(opts.appId));
  url.searchParams.set('ticket', opts.ticket);
  url.searchParams.set('identity', opts.identity ?? TICKET_IDENTITY);
  return url.toString();
}

/**
 * How a verification response reads:
 *  - ok: the ticket proves the given Steam id, no publisher or VAC ban;
 *  - banned: the ticket verified but the account is VAC- or publisher-banned
 *    (the link is refused; a banned account gets no mirror);
 *  - invalid: Steam rejected the ticket (wrong app, wrong identity, expired,
 *    forged, or reused past its window);
 *  - malformed: the body is not a recognizable AuthenticateUserTicket
 *    response (treated as an upstream fault by the shell, never as proof).
 */
export type TicketVerdict =
  | { kind: 'ok'; steamId: string }
  | { kind: 'banned' }
  | { kind: 'invalid' }
  | { kind: 'malformed' };

/** Parse the upstream JSON body into a verdict. Attacker-adjacent input
 *  (Steam relays what the client handed it), so every read is defensive and
 *  an unrecognized shape resolves to 'malformed', never a throw. */
export function parseAuthenticateUserTicketResponse(body: unknown): TicketVerdict {
  if (body === null || typeof body !== 'object') return { kind: 'malformed' };
  const response = (body as { response?: unknown }).response;
  if (response === null || typeof response !== 'object') return { kind: 'malformed' };
  const error = (response as { error?: unknown }).error;
  if (error !== undefined) return { kind: 'invalid' };
  const params = (response as { params?: unknown }).params;
  if (params === null || typeof params !== 'object') return { kind: 'malformed' };
  const p = params as {
    result?: unknown;
    steamid?: unknown;
    vacbanned?: unknown;
    publisherbanned?: unknown;
  };
  if (p.result !== 'OK' || typeof p.steamid !== 'string' || !/^\d+$/.test(p.steamid)) {
    return { kind: 'malformed' };
  }
  if (p.vacbanned === true || p.publisherbanned === true) return { kind: 'banned' };
  return { kind: 'ok', steamId: p.steamid };
}

/**
 * The SetUserStatsForGame request the mirror worker POSTs to unlock one
 * achievement server-side: form-encoded name[i]/value[i] pairs with value 1
 * (an achievement in this interface is a stat that latches at 1; setting an
 * already-set achievement is a no-op on Steam's side, which is what makes the
 * mirror's redeliveries harmless). The body CONTAINS the publisher key:
 * fetched, never logged.
 */
export function buildSetAchievementRequest(opts: {
  key: string;
  appId: number;
  steamId: string;
  achNames: readonly string[];
}): { url: string; body: URLSearchParams } {
  const body = new URLSearchParams();
  body.set('key', opts.key);
  body.set('steamid', opts.steamId);
  body.set('appid', String(opts.appId));
  body.set('count', String(opts.achNames.length));
  opts.achNames.forEach((name, i) => {
    body.set(`name[${i}]`, name);
    body.set(`value[${i}]`, '1');
  });
  return { url: `${PARTNER_API_HOST}/ISteamUserStats/SetUserStatsForGame/v1/`, body };
}
