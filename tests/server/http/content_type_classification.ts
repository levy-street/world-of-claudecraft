// Content-type classification for the server REST surface.
//
// This module names the response content-type CONTRACT classes the server
// emits today and maps every dispatched `/api/*` route onto exactly one class.
// It is a CHARACTERIZATION of current behavior, not a target: the error model and
// the REST error i18n own any migration toward a single shape. Nothing here
// renames or adds a class.
//
// The five classes are mutually exclusive named constants. Every class value is
// a constant (never an inline string literal) so the inventory and the
// completeness gate refer to one source of truth.

// application/json bodies. This is the catch-all class for every JSON-shaped
// route (success payloads AND `{ error }` problem bodies alike); the name marks
// the RFC 7807 problem+json shape the error model standardizes on, but today it
// simply means "the response is application/json".
export const PROBLEM_JSON = 'problem-json' as const;

// text/html bodies. Server-rendered pages and the Discord OAuth bounce page
// (which writes text/html with a client-side location.replace, not a 302).
export const HTML = 'html' as const;

// A true HTTP 3xx redirect (Location header, empty/!html body). Defined for
// completeness of the taxonomy. NOTE: this class currently maps to ZERO routes.
// No dispatcher emits a real 302 today (the OAuth consent POST and the Discord
// callback both answer with a body, JSON and HTML respectively, not a redirect),
// so REDIRECT exists only so a future redirect route has a home to slot into.
export const REDIRECT = 'redirect' as const;

// A non-JSON binary contract, in either direction: POST /api/card and POST
// /api/assets accept a binary REQUEST body (image and GLB model respectively);
// GET /api/assets/:file answers a binary (model/gltf-binary) RESPONSE body.
export const BINARY = 'binary' as const;

// The legacy `{ ok: false }` response shape (as opposed to the `{ error }`
// problem shape). Carried by the perf-report and site-presence heartbeat
// endpoints, whose non-POST guard answers 405 `{ ok: false }`.
export const LEGACY_OKFALSE_405 = 'legacy-okfalse-405' as const;

export const CONTENT_TYPE_CLASSES = [
  PROBLEM_JSON,
  HTML,
  REDIRECT,
  BINARY,
  LEGACY_OKFALSE_405,
] as const;

export type ContentTypeClass = (typeof CONTENT_TYPE_CLASSES)[number];

// Per-/api-route classification. Keyed by the route string exactly as it appears
// in SURFACE_INVENTORY (`:param` routes use the human pattern form, e.g.
// /api/characters/:id/sheet). Every distinct `/api/*` path the server dispatches
// (including the unreachable swag-claim orphan, which is still an /api path) has
// exactly one entry; the completeness gate in surface_inventory.test.ts asserts
// this map and the inventory cover the same set of /api paths with matching
// classes. Admin, oauth, and internal routes are NOT keyed here (the inventory
// row carries their class); this map is the /api contract slice.
export const API_CONTENT_TYPE: Readonly<Record<string, ContentTypeClass>> = {
  '/api/native-attestation/challenge': PROBLEM_JSON,
  '/api/site-presence': LEGACY_OKFALSE_405,
  '/api/register': PROBLEM_JSON,
  '/api/login': PROBLEM_JSON,
  '/api/desktop-login/create': PROBLEM_JSON,
  '/api/desktop-login/exchange': PROBLEM_JSON,
  '/api/me/characters': PROBLEM_JSON,
  '/api/characters': PROBLEM_JSON,
  '/api/public/characters/:name/sheet': PROBLEM_JSON,
  '/api/characters/:id/sheet': PROBLEM_JSON,
  '/api/characters/:id/standing': PROBLEM_JSON,
  '/api/characters/:id/rename': PROBLEM_JSON,
  '/api/characters/:id/takeover': PROBLEM_JSON,
  '/api/characters/:id': PROBLEM_JSON,
  '/api/realms': PROBLEM_JSON,
  '/api/search': PROBLEM_JSON,
  '/api/reports': PROBLEM_JSON,
  '/api/bug-reports': PROBLEM_JSON,
  '/api/perf-report': LEGACY_OKFALSE_405,
  '/api/project-stats': PROBLEM_JSON,
  '/api/status': PROBLEM_JSON,
  '/api/perf': PROBLEM_JSON,
  '/api/arena/leaderboard': PROBLEM_JSON,
  '/api/leaderboard': PROBLEM_JSON,
  '/api/releases': PROBLEM_JSON,
  '/api/account': PROBLEM_JSON,
  '/api/account/password': PROBLEM_JSON,
  '/api/account/logout': PROBLEM_JSON,
  '/api/account/email': PROBLEM_JSON,
  '/api/account/deactivate': PROBLEM_JSON,
  '/api/account/companion-token': PROBLEM_JSON,
  '/api/account/email/change': PROBLEM_JSON,
  '/api/account/email/set-initial': PROBLEM_JSON,
  // The two email link-click endpoints (verify, unsubscribe) read like server-rendered
  // pages but every branch of handleAccountEmailVerify / handleEmailUnsubscribe answers
  // application/json (the SPA owns the UX), so they are PROBLEM_JSON, NOT HTML. The only
  // /api route that emits text/html today is /api/auth/discord/callback (the OAuth bounce).
  '/api/account/email/verify': PROBLEM_JSON,
  '/api/account/export': PROBLEM_JSON,
  '/api/account/marketing': PROBLEM_JSON,
  '/api/account/2fa/setup': PROBLEM_JSON,
  '/api/account/2fa/enable': PROBLEM_JSON,
  '/api/account/2fa/disable': PROBLEM_JSON,
  '/api/email/unsubscribe': PROBLEM_JSON,
  '/api/wallet/link/challenge': PROBLEM_JSON,
  '/api/wallet/link': PROBLEM_JSON,
  '/api/wallet': PROBLEM_JSON,
  '/api/auth/discord/start': PROBLEM_JSON,
  '/api/auth/discord/callback': HTML,
  '/api/auth/discord/login/new': PROBLEM_JSON,
  '/api/auth/discord/login/link': PROBLEM_JSON,
  '/api/discord': PROBLEM_JSON,
  '/api/auth/github/start': PROBLEM_JSON,
  '/api/auth/github/callback': HTML,
  '/api/github': PROBLEM_JSON,
  '/api/woc/balance': PROBLEM_JSON,
  '/api/daily-rewards': PROBLEM_JSON,
  '/api/daily-rewards/leaderboard': PROBLEM_JSON,
  '/api/daily-rewards/spin': PROBLEM_JSON,
  '/api/daily-rewards/history': PROBLEM_JSON,
  '/api/card': BINARY,
  '/api/referrals': PROBLEM_JSON,
  '/api/discord/swag/claim': PROBLEM_JSON,
  // v0.20.0 release merge: the map editor surface. JSON everywhere except the
  // two binary lanes (the GLB upload request body, the byte-read response body).
  '/api/maps': PROBLEM_JSON,
  '/api/maps/public': PROBLEM_JSON,
  '/api/maps/:id': PROBLEM_JSON,
  '/api/maps/:id/fork': PROBLEM_JSON,
  '/api/maps/:id/publish': PROBLEM_JSON,
  '/api/maps/:id/unpublish': PROBLEM_JSON,
  '/api/assets': BINARY,
  '/api/assets/mine': PROBLEM_JSON,
  '/api/assets/:file': BINARY,
  '/api/assets/:id': PROBLEM_JSON,
};
