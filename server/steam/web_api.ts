// The fetch shell over the pure ticket helpers: the one place server code
// talks to the Steam Web API. Secrets discipline: the publisher key rides
// only inside the request URL/body built by ticket.ts; NOTHING here logs a
// URL, a request body, or an upstream response body (an upstream error body
// can echo the request back). Log lines are fixed strings plus a bare HTTP
// status at most.

import {
  buildAuthenticateUserTicketUrl,
  buildSetAchievementRequest,
  parseAuthenticateUserTicketResponse,
  type TicketVerdict,
} from './ticket';

const UPSTREAM_TIMEOUT_MS = 5000;

/** A verification outcome: the parsed verdict, or 'upstream' when Steam could
 *  not be asked (network error, timeout, non-2xx, unparseable body). An
 *  'upstream' outcome is NEVER treated as proof in either direction. */
export type VerifyOutcome = TicketVerdict | { kind: 'upstream' };

/** Ask Steam whether the ticket proves a Steam id for our app. */
export async function verifyLinkTicket(
  opts: { key: string; appId: number; ticket: string },
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(buildAuthenticateUserTicketUrl(opts), {
      method: 'GET',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'upstream' };
  }
  if (!res.ok) return { kind: 'upstream' };
  const body = await res.json().catch(() => null);
  if (body === null) return { kind: 'upstream' };
  const verdict = parseAuthenticateUserTicketResponse(body);
  // A malformed 2xx body is an upstream fault (Steam answered garbage), not a
  // ticket verdict; the route serves 503 and the player retries.
  if (verdict.kind === 'malformed') return { kind: 'upstream' };
  return verdict;
}

/** POST a batch of achievement unlocks for one account+steamId in ONE
 *  SetUserStatsForGame call (name[i]/value[i] pairs). True on a 2xx, false
 *  otherwise; the mirror worker owns retries and gives up quietly (reconcile
 *  heals later). Batching lets the mirror flush a whole account's reconcile
 *  set in a single request instead of one per unlock. */
export async function pushAchievementUnlocks(
  opts: { key: string; appId: number; steamId: string; achNames: readonly string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const { url, body } = buildSetAchievementRequest({
    key: opts.key,
    appId: opts.appId,
    steamId: opts.steamId,
    achNames: opts.achNames,
  });
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** POST one achievement unlock to Steam. Thin single-name wrapper over
 *  pushAchievementUnlocks; kept for callers that unlock exactly one deed. */
export async function pushAchievementUnlock(
  opts: { key: string; appId: number; steamId: string; achName: string },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  return pushAchievementUnlocks(
    { key: opts.key, appId: opts.appId, steamId: opts.steamId, achNames: [opts.achName] },
    fetchImpl,
  );
}
