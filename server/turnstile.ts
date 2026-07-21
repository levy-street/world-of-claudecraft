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
import type { IncomingMessage } from 'node:http';
import { verifyNativeAttestation } from './native_attestation';
import { recordUsageMetric } from './provider_usage';
import { requestIp } from './ratelimit';
import { isDesktopAppRequest, isNativeAppRequest } from './web_login_guard';

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

// The full bot gate for account creation / login. Returns true when the request
// may proceed. Native apps prove themselves with a platform attestation instead
// of the widget. The Electron desktop shell is admitted by Origin alone: the
// widget cannot pass Cloudflare's domain validation at app://worldofclaudecraft
// (siteverify widget error 110200, verified empirically), so there is no token
// it could send. An Origin header is spoofable, so this is a deliberate,
// documented softening of the bot gate for the desktop origins only; a real
// desktop attestation (mirroring the native one) is the long-term fix. With no
// secret configured, verification is off entirely. The English rejection error
// the callers emit is matched to a t() key by userFacingApiError() in
// src/main.ts; keep the two strings in sync.
export async function passesTurnstile(
  req: IncomingMessage,
  body: Record<string, unknown>,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (isNativeAppRequest(req)) return verifyNativeAttestation(req, body.nativeAttestation);
  if (isDesktopAppRequest(req)) return true;
  if (!secret) return true;
  return verifyTurnstile(String(body.turnstileToken ?? ''), secret, requestIp(req), fetchImpl);
}
