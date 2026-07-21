import type { IncomingMessage } from 'node:http';
import { REALM_ORIGINS } from './realm';

export const NATIVE_APP_ORIGINS = new Set([
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
]);

export const DESKTOP_APP_ORIGINS = new Set([
  'app://worldofclaudecraft',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

export function isNativeAppRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  const origin = req.headers.origin;
  return typeof origin === 'string' && NATIVE_APP_ORIGINS.has(origin);
}

// The Electron desktop shell (app://worldofclaudecraft packaged, the two localhost
// Vite origins in dev). Origin is spoofable, so treat this as a client CLASS
// marker (which UX/verification path applies), never as proof of identity.
export function isDesktopAppRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  const origin = req.headers.origin;
  return typeof origin === 'string' && DESKTOP_APP_ORIGINS.has(origin);
}

// The CORS reflection allow-list for /api/*: realm vhosts plus the native and
// desktop app shells, whose pages are served from a non-site origin and so need
// the browser's permission to call the API. Auth is a bearer token (no cookies),
// so reflecting these specific origins is safe. Returns the origin to reflect,
// or null when the request must get no CORS headers (same-origin pages and
// unknown origins).
export function allowedCorsOrigin(origin: unknown): string | null {
  if (typeof origin !== 'string') return null;
  if (
    REALM_ORIGINS.has(origin) ||
    NATIVE_APP_ORIGINS.has(origin) ||
    DESKTOP_APP_ORIGINS.has(origin)
  ) {
    return origin;
  }
  return null;
}

// Anti-bot: programmatic clients (curl, headless scripts, multibox farms) call
// /api/login and /api/register directly with no browser Origin header. A real
// same-origin browser POST always sends an Origin equal to the page's origin, so
// requiring a recognised Origin on the auth endpoints lets only the web client
// obtain a token. A determined attacker can still spoof Origin, but this stops
// casual scripting and the existing multibox tooling outright.

// Whether the Origin guard is active. Enforced in production, or when
// REQUIRE_WEB_LOGIN=1; disabled for local dev, the Vitest suite, and the .mjs
// e2e (which call the API directly with no Origin). REQUIRE_WEB_LOGIN=0 forces it off.
export function webLoginEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.REQUIRE_WEB_LOGIN ?? '').toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return env.NODE_ENV === 'production';
}

// True when the request carries an Origin that belongs to this site — i.e. it
// came from a page we served, not a raw API client. Accepts: an explicitly
// allow-listed origin (WEB_ORIGINS or a configured REALM_ORIGINS entry), the same
// host the request was sent to (Host / X-Forwarded-Host), or localhost for dev.
export function isWebClientRequest(
  req: Pick<IncomingMessage, 'headers'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '') return false;
  const allow = new Set<string>([
    ...REALM_ORIGINS,
    ...NATIVE_APP_ORIGINS,
    ...DESKTOP_APP_ORIGINS,
    ...String(env.WEB_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  if (allow.has(origin)) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === '') return false;
  const fwd = String(req.headers['x-forwarded-host'] ?? '')
    .split(',')[0]
    .trim();
  const reqHost = String(req.headers.host ?? '');
  if (host === fwd || host === reqHost) return true;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}
