// Top-level security-header setter for every HTTP response the server emits.
// By locked decision this is a plain top-level
// wrapper, NOT an onion Middleware: it runs in routeHttpRequest before the
// prefix ladder, so it covers BOTH the legacy handleApi ladder and the new
// flag-gated dispatcher. A dispatch-flag rollback can never drop a header, and
// every branch (static, /c/ SSR, /p/ card, /avatar, sitemap, /api, /admin/api,
// /oauth, /internal, the OPTIONS-204 short-circuit, and every success AND error
// response) carries the same set. It must never run on the WS upgrade handshake,
// which bypasses routeHttpRequest by construction (server.on('upgrade')).
//
// Deliberately NOT set here: any Content-Security-Policy header (deferred to a
// separate report-only effort) and Cross-Origin-Embedder-Policy (it would break
// the cross-origin GLB / HDRI asset loads the renderer depends on).

import type * as http from 'node:http';

const HEADER_CONTENT_TYPE_OPTIONS = 'X-Content-Type-Options';
const HEADER_REFERRER_POLICY = 'Referrer-Policy';
const HEADER_PERMISSIONS_POLICY = 'Permissions-Policy';
const HEADER_CROSS_ORIGIN_OPENER_POLICY = 'Cross-Origin-Opener-Policy';
const HEADER_CROSS_ORIGIN_RESOURCE_POLICY = 'Cross-Origin-Resource-Policy';
const HEADER_STRICT_TRANSPORT_SECURITY = 'Strict-Transport-Security';
const HEADER_FRAME_OPTIONS = 'X-Frame-Options';
const HEADER_CACHE_CONTROL = 'Cache-Control';

// Headers node's http never sets; removing them pins the contract so a future
// proxy or middleware that starts leaking a Server / X-Powered-By banner is
// stripped here regardless.
const HEADER_SERVER = 'Server';
const HEADER_POWERED_BY = 'X-Powered-By';

const CONTENT_TYPE_OPTIONS_VALUE = 'nosniff';
const REFERRER_POLICY_VALUE = 'strict-origin-when-cross-origin';
const CROSS_ORIGIN_OPENER_POLICY_VALUE = 'same-origin';
const CROSS_ORIGIN_RESOURCE_POLICY_VALUE = 'same-origin';
// One year, with subdomains. Set ONLY in production (see below): an HSTS header
// on localhost poisons the browser's HSTS cache for every future localhost dev.
const STRICT_TRANSPORT_SECURITY_VALUE = 'max-age=31536000; includeSubDomains';
const FRAME_OPTIONS_DENY_VALUE = 'DENY';
const CACHE_CONTROL_NO_STORE_VALUE = 'no-store';

// The production gate for HSTS, mirroring web_login_guard.ts's webLoginEnforced
// prod idiom (env.NODE_ENV === 'production').
const PRODUCTION_NODE_ENV = 'production';

// The /oauth/ family alone gets the extra clickjacking + no-store hardening: its
// consent and device HTML pages must never be framed, and its token /
// device_authorization JSON responses carry bearer secrets.
const OAUTH_PATH_PREFIX = '/oauth/';

// The browser features denied to every page. Fullscreen and Gamepad are
// deliberately ABSENT: the game client calls the Fullscreen API (src/main.ts,
// required for the mobile landscape orientation lock) and the Gamepad API
// (src/game/gamepad.ts). Autoplay and screen-wake-lock are likewise excluded as
// plausible game features a blanket deny would silently break. Everything below
// is a sensor / capability the game never uses.
const PERMISSIONS_POLICY_DENY_FEATURES: readonly string[] = [
  'accelerometer',
  'ambient-light-sensor',
  'battery',
  'bluetooth',
  'camera',
  'display-capture',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'serial',
  'usb',
  'xr-spatial-tracking',
];

// Each denied feature as `name=()` (an empty allowlist), joined into the single
// Permissions-Policy value. Built once from the list above so the list is the
// one source of truth.
const PERMISSIONS_POLICY_VALUE = PERMISSIONS_POLICY_DENY_FEATURES.map(
  (feature) => `${feature}=()`,
).join(', ');

/**
 * Set the security headers on `res` for every HTTP response. A plain top-level
 * setter (not an onion Middleware): call it as the first statement in
 * routeHttpRequest, before CORS/preflight and the prefix ladder, so both
 * dispatch arms and every prefix carry the headers.
 *
 * The unconditional set lands on every branch. HSTS is added only in production
 * (env.NODE_ENV === 'production'). The /oauth/ family additionally gets
 * X-Frame-Options: DENY and Cache-Control: no-store.
 */
export function withSecurityHeaders(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = (req.url ?? '').split('?')[0];

  res.setHeader(HEADER_CONTENT_TYPE_OPTIONS, CONTENT_TYPE_OPTIONS_VALUE);
  res.setHeader(HEADER_REFERRER_POLICY, REFERRER_POLICY_VALUE);
  res.setHeader(HEADER_PERMISSIONS_POLICY, PERMISSIONS_POLICY_VALUE);
  res.setHeader(HEADER_CROSS_ORIGIN_OPENER_POLICY, CROSS_ORIGIN_OPENER_POLICY_VALUE);
  res.setHeader(HEADER_CROSS_ORIGIN_RESOURCE_POLICY, CROSS_ORIGIN_RESOURCE_POLICY_VALUE);

  if (env.NODE_ENV === PRODUCTION_NODE_ENV) {
    res.setHeader(HEADER_STRICT_TRANSPORT_SECURITY, STRICT_TRANSPORT_SECURITY_VALUE);
  }

  if (path.startsWith(OAUTH_PATH_PREFIX)) {
    res.setHeader(HEADER_FRAME_OPTIONS, FRAME_OPTIONS_DENY_VALUE);
    res.setHeader(HEADER_CACHE_CONTROL, CACHE_CONTROL_NO_STORE_VALUE);
  }

  res.removeHeader(HEADER_SERVER);
  res.removeHeader(HEADER_POWERED_BY);
}
