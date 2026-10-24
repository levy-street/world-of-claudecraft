// Origin guard for the ClaudeCraft Studio dev-server routes in vite.config.ts.
//
// Those routes write source and assets into the checkout (published map modules,
// the region module, collision tables, GLBs under public/), so a hostile page a
// developer visits while `npm run dev` runs must not be able to reach them with a
// cross-origin POST. Writes need a loopback socket AND a same-origin loopback
// Origin; reads need a loopback socket and Host. The checks are the ones the
// diagnostics capture endpoint already uses (diagnostics_capture_guard.mjs).
// Dev-only by construction: the plugin hooks configureServer, which never runs
// in a build or in the authoritative server.

import { diagnosticsCaptureAllowed, diagnosticsReadAllowed } from './diagnostics_capture_guard.mjs';

/** Path prefixes of every Studio dev route the guard covers. */
export const STUDIO_DEV_ROUTE_PREFIXES = Object.freeze([
  '/__dungeon_editor/',
  '/__bg_editor/',
  '/__collision_master/',
  '/__region_map/',
  '/__studio_map/',
  '/__studio_asset/',
]);

/** @param {string | undefined} url */
export function isStudioDevRoute(url) {
  const path = String(url ?? '').split('?')[0];
  return STUDIO_DEV_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * @param {{ method?: string, url?: string, remoteAddress?: string, origin?: string, host?: string }} req
 * @returns {boolean} true when the request may proceed to the route handler
 */
export function studioDevRequestAllowed(req) {
  if (!isStudioDevRoute(req.url)) return true;
  const method = String(req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return diagnosticsReadAllowed(req.remoteAddress, req.host);
  }
  return diagnosticsCaptureAllowed(req.remoteAddress, req.origin, req.host);
}

/** Connect-style middleware: 403 for a Studio route that fails the guard. */
export function studioDevGuardMiddleware(req, res, next) {
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const allowed = studioDevRequestAllowed({
    method: req.method,
    url: req.url,
    remoteAddress: req.socket?.remoteAddress,
    origin: first(req.headers?.origin),
    host: first(req.headers?.host),
  });
  if (allowed) {
    next();
    return;
  }
  res.statusCode = 403;
  res.end('loopback same-origin requests only');
}
