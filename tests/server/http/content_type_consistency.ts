// Cross-check that a captured golden's RESPONSE content-type is consistent with the
// content-type CLASS its route carries in SURFACE_INVENTORY. The inventory's completeness
// gate only checks that the inventory row and the API_CONTENT_TYPE map agree with
// EACH OTHER (two hand-authored structures); it never compares either against what
// the route actually emits. That blind spot let two JSON routes (/api/account/email/
// verify, /api/email/unsubscribe) sit misclassified as HTML. This module closes it:
// the characterization tests run every captured golden through it, so a class that
// contradicts the real (golden-captured) content-type fails the suite.

import { readFileSync } from 'node:fs';
import {
  BINARY,
  type ContentTypeClass,
  HTML,
  LEGACY_OKFALSE_405,
  PROBLEM_JSON,
  REDIRECT,
} from './content_type_classification';
import { SURFACE_INVENTORY } from './surface_inventory';

// Response content-type PREFIXES each class is allowed to emit. PROBLEM_JSON, HTML
// and the legacy ok-false 405 are pure response-MIME contracts. BINARY names a
// REQUEST-body contract (POST /api/card), so its responses are a JSON error today
// or an image on success; both are allowed. REDIRECT maps to zero routes, so no
// golden ever resolves to it (the empty set would reject one if it did).
const RESPONSE_CONTENT_TYPE_PREFIXES: Record<ContentTypeClass, readonly string[]> = {
  [PROBLEM_JSON]: ['application/json'],
  [HTML]: ['text/html'],
  [LEGACY_OKFALSE_405]: ['application/json'],
  [BINARY]: ['application/json', 'image/'],
  [REDIRECT]: [],
};

// Resolve a concrete (method, pathname) to the content-type class of its inventory
// row, keyed on METHOD too (so the same path with different methods, e.g. GET
// /oauth/device = HTML page vs POST /oauth/device = JSON, resolves correctly).
// Returns null for an uninventoried path (a synthetic unknown-endpoint url) or the
// preflight row (contentType null), so those goldens are simply skipped.
export function routeContentTypeClass(method: string, url: string): ContentTypeClass | null {
  const pathname = new URL(url, 'http://localhost').pathname;
  const row = SURFACE_INVENTORY.find(
    (r) =>
      !r.unreachable &&
      r.method === method &&
      (r.match ? (r.match as RegExp).test(pathname) : r.path === pathname),
  );
  return row?.contentType ?? null;
}

// Returns null when the golden's content-type is consistent with its route's class
// (or there is nothing to check), or a human-readable reason string when it is not.
export function goldenContentTypeMismatch(
  method: string,
  url: string,
  fixturePath: string,
): string | null {
  const golden = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    headers?: Record<string, unknown>;
  };
  const contentType = golden.headers?.['content-type'];
  // No response content-type (e.g. a 204 preflight) -> nothing to cross-check.
  if (typeof contentType !== 'string') return null;
  const cls = routeContentTypeClass(method, url);
  // Uninventoried/synthetic path (the unknown-endpoint cases) -> not our concern.
  if (cls === null) return null;
  const allowed = RESPONSE_CONTENT_TYPE_PREFIXES[cls];
  if (allowed.some((prefix) => contentType.startsWith(prefix))) return null;
  return `${method} ${url}: golden content-type '${contentType}' contradicts class '${cls}' (allowed: ${allowed.join(', ') || 'none'})`;
}
