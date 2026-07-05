// Cloudflare Turnstile server-side verification.
//
// The client renders a Turnstile widget on the login/register form; a human
// (or a real browser) produces a one-time token that we verify here against
// Cloudflare's siteverify endpoint. Headless clients (the aiohttp/websockets
// bot wave) cannot solve the challenge, so they cannot obtain a valid token
// and are rejected before any account work happens.
//
// Verification is gated by TURNSTILE_SECRET being set (see server/main.ts): with
// no secret configured (local dev / tests) the caller skips this entirely, so
// `npm run dev` stays frictionless.
import { recordUsageMetric } from './provider_usage';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5000;

// Fail-closed: an empty token, a non-2xx response, a malformed body, a timeout,
// or any network error all resolve to `false`. The origin is only reachable
// through Cloudflare, so there is no scenario where the site is up but
// siteverify is unreachable — failing closed cannot lock players out on its own.
export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token || !secret) return false;
  recordUsageMetric('turnstile.verify');
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (remoteIp) form.set('remoteip', remoteIp);
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      recordUsageMetric('turnstile.verify.failure');
      return false;
    }
    const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
    const verified = data?.success === true;
    if (!verified) recordUsageMetric('turnstile.verify.failure');
    return verified;
  } catch {
    recordUsageMetric('turnstile.verify.failure');
    return false;
  }
}
