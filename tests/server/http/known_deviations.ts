// Known deviations ledger for the API pipeline re-architecture (characterization spine).
//
// This is the CHARACTERIZATION counterpart to the surface inventory: where the
// inventory records WHAT routes exist and the goldens record WHAT they emit
// today, this ledger records the places where today's behavior is a DELIBERATE
// deviation, either one the migration intentionally changed (introducedInPhase
// names the packet phase, per the docs/api-pipeline/ numbering, that landed the
// change) or one preserved by design forever (introducedInPhase null). It
// changes no runtime behavior; it is a planning and freshness artifact so the
// migration phases landed their changes against a written baseline instead of
// an unstated assumption.
//
// Anchoring rule: every entry's `routes` strings are exact paths that MUST exist
// in SURFACE_INVENTORY (the test cross-checks this), and every `goldenFixtures`
// path MUST point at a fixture that exists on disk (the test cross-checks that
// too). Entries never anchor on line numbers.
//
// Stable-code rule: this ledger CHARACTERIZES the codes/strings the server emits
// today. It does not add, rename, or localize any error code or catalog entry
// (the error-code catalog and the REST error i18n own that). The
// `currentBehavior` text describes what exists.

// Named deviation ids (no scattered inline strings; one source of truth, the
// inventory and tests refer to these constants).
export const DEVIATION_ID = {
  perfReport200NotThrottle: 'perf-report-200-not-429-on-throttle',
  perfReportSitePresence405OkFalse: 'perf-report-and-site-presence-405-ok-false',
  registerLoginAntiEnumeration: 'register-login-anti-enumeration',
  authBodyValidationRemap: 'auth-body-validation-remap-login-challenge',
  authNullBodyCoercion: 'auth-null-body-coercion',
  bolaOwned404: 'bola-owned-404',
  planned405BeforeAuth: 'planned-405-before-auth',
  validationStatusRemap: 'validation-status-remap-422-400-413',
  statusNameListTrim: 'status-name-list-trim',
  realmsSearchAuthzGapClose: 'realms-search-authz-gap-close',
  newLimiterCharacterMutations: 'new-limiter-character-mutations',
  characterBodyValidationRemap: 'character-body-validation-remap',
  characterIdParamDecode: 'character-id-param-decode-422',
  companionTokenMethodFan: 'companion-token-method-fan-405',
  accountBodyValidationRemap: 'account-body-validation-remap',
  rateLimitedBodyToCode: 'rate-limited-body-to-code',
  walletBodyValidationRemap: 'wallet-body-validation-remap',
  reportsBodyValidationRemap: 'reports-body-validation-remap',
  newLimiterReportsCreate: 'new-limiter-reports-create',
  newLimiterDiscord: 'new-limiter-discord',
  discordCallbackHtmlNotRedirect: 'discord-callback-html-not-redirect',
  swagClaimOrphanUnreachable: 'swag-claim-orphan-unreachable',
  discordBodyValidationRemap: 'discord-body-validation-remap',
  adminEnumInvalid422: 'admin-enum-invalid-422',
  adminIdParamDecode: 'admin-id-param-decode-422',
  adminBodyValidationRemap: 'admin-body-validation-remap',
  oauthBodyValidationRemap: 'oauth-body-validation-remap',
  internalBodyValidationRemap: 'internal-body-validation-remap',
  oauthInternalOffTable405: 'oauth-internal-off-table-405-handoff',
  githubBodyValidationRemap: 'github-body-validation-remap',
  desktopLoginBodyValidationRemap: 'desktop-login-body-validation-remap',
  desktopLoginCreateFullScope: 'desktop-login-create-full-scope',
  dailyRewardsBodyValidationRemap: 'daily-rewards-body-validation-remap',
  dailyRewardsOpsBodyValidationRemap: 'daily-rewards-ops-body-validation-remap',
  rateLimit429Draft11Headers: 'rate-limit-429-draft11-headers',
  securityHeadersAllSurfaces: 'security-headers-all-surfaces',
  mapsAssetsRateLimitedBodyToCode: 'maps-assets-rate-limited-body-to-code',
  mapsAssetsIdParamDecode: 'maps-assets-id-param-decode-422',
} as const;
export type DeviationId = (typeof DEVIATION_ID)[keyof typeof DEVIATION_ID];

export interface KnownDeviation {
  // Kebab-style unique id (a value of DEVIATION_ID).
  readonly id: string;
  // Route paths the deviation touches. Each MUST exist as a `path` in
  // SURFACE_INVENTORY (the test hard-fails on an unknown route).
  readonly routes: readonly string[];
  // What the server does TODAY (the characterized current contract).
  readonly currentBehavior: string;
  // What is intended: the preserved behavior (for a by-design deviation) or the
  // target the named phase landed.
  readonly intendedBehavior: string;
  // The packet phase (4 to 25) that intentionally changed this behavior, or
  // null for a by-design deviation that is preserved forever.
  readonly introducedInPhase: number | null;
  // Why the deviation exists / why it is preserved or changed.
  readonly reason: string;
  // Optional golden fixtures (paths relative to the repo root) that demonstrate
  // the current behavior. Only fixtures that actually exist are listed; the test
  // asserts each one is present on disk.
  readonly goldenFixtures?: readonly string[];
}

export const KNOWN_DEVIATIONS: readonly KnownDeviation[] = [
  // --- By-design deviations (preserved forever, introducedInPhase null) --------
  {
    id: DEVIATION_ID.perfReport200NotThrottle,
    routes: ['/api/perf-report'],
    currentBehavior:
      'POST /api/perf-report answers 200 { ok: true } even when the perf-report ' +
      'limiter is throttling; the throttle result is swallowed and the beacon ' +
      'never observes a 429.',
    intendedBehavior:
      'Preserved: a throttled perf beacon is silently accepted with a 200, never ' +
      'a 429 or an error the client could surface or retry on.',
    introducedInPhase: null,
    reason:
      'The client perf beacon must never see a 429 (a throttled beacon should be ' +
      'dropped quietly with a 200, not retried or logged as an error).',
  },
  {
    id: DEVIATION_ID.perfReportSitePresence405OkFalse,
    routes: ['/api/perf-report', '/api/site-presence'],
    currentBehavior:
      'A non-POST request to either heartbeat endpoint answers 405 with the ' +
      'legacy { ok: false } body shape, not the { error } problem shape the rest ' +
      'of the surface uses.',
    intendedBehavior:
      'Preserved: these two beacon endpoints keep their method ownership and the ' +
      'bare ok-false 405 shape (the 4th content-type contract case).',
    introducedInPhase: null,
    reason:
      'This is the 4th content-type contract case (LEGACY_OKFALSE_405): the ' +
      'perf-report and site-presence heartbeats keep their legacy ok-shape and ' +
      'POST-only method ownership.',
    goldenFixtures: ['tests/server/fixtures/main/site_presence_get_405.json'],
  },
  {
    id: DEVIATION_ID.registerLoginAntiEnumeration,
    routes: ['/api/register', '/api/login'],
    currentBehavior:
      'POST /api/register answers 409 on a taken username and POST /api/login ' +
      'answers 401 on bad credentials, deliberately not revealing whether a given ' +
      'account exists.',
    intendedBehavior:
      'Preserved: the 409 (register conflict) and 401 (login failure) stay ' +
      'anti-enumeration safe (unknown-vs-bad credentials stay indistinguishable).',
    introducedInPhase: null,
    reason:
      'Registration conflict (409) and login failure (401) stay intentionally ' +
      'indistinguishable so an attacker cannot enumerate which usernames or ' +
      'emails exist.',
    goldenFixtures: ['tests/server/fixtures/main/login_post_empty_401.json'],
  },
  {
    id: DEVIATION_ID.bolaOwned404,
    routes: [
      '/api/characters/:id/sheet',
      '/api/characters/:id/standing',
      '/api/characters/:id',
      '/api/characters/:id/rename',
      '/api/characters/:id/takeover',
    ],
    currentBehavior:
      'An owner-scoped :id read or mutation for a character the caller does not ' +
      'own answers 404 (not 403), so a caller cannot tell "exists but not yours" ' +
      'apart from "does not exist".',
    intendedBehavior:
      'Preserved through the character-surface migration: the owner-scope guard ' +
      'keeps answering 404 (anti-enumeration); it is NOT changed to 403.',
    introducedInPhase: null,
    reason:
      'Owner-scoped object reads deny a non-owned id with 404 not 403 to avoid ' +
      'leaking the existence of another player character (BOLA anti-enumeration); ' +
      'the migrated requireOwned guard keeps it.',
  },
  {
    id: DEVIATION_ID.discordCallbackHtmlNotRedirect,
    routes: ['/api/auth/discord/callback'],
    currentBehavior:
      'GET /api/auth/discord/callback answers text/html (a self-posting bounce ' +
      'page that does window.opener.postMessage then location.replace), not a ' +
      '302 redirect, on both the success and error paths.',
    intendedBehavior:
      'Preserved: the OAuth popup flow needs an HTML bounce to postMessage the ' +
      'opener window and close the popup, so it is intentionally not a bare 302 ' +
      '(the REDIRECT content class stays unused). The migrated route rides a ' +
      'RouteDef carrying meta.envelope "html", so even an unexpected throw escaping ' +
      'handleDiscordCallback serializes through the error boundary as an HTML ' +
      'error (never problem+json, which would break window.opener.postMessage); its ' +
      'normal responses stay the self-written bouncePage.',
    introducedInPhase: null,
    reason:
      'The Discord OAuth popup completes by postMessaging the opener and closing ' +
      'the popup; a 302 cannot do that, so the HTML-not-302 shape is by design. The ' +
      'RouteDef pins the HTML surface via meta.envelope so the error path ' +
      'cannot regress to problem+json.',
    goldenFixtures: ['tests/server/fixtures/main/discord_callback_error_bounce.json'],
  },

  // --- Phase-numbered deviations (introducedInPhase names the change) ----------
  // NOTE: authRateLimitDashToComma (introducedInPhase 11) was RETIRED by the
  // account-portal migration. The auth-surface migration served register/login
  // through the new pipeline with a COMMA where the legacy ladder used an em dash
  // (the no-em-dash code invariant forbids a U+2014 literal in new code), a
  // matcher-safe divergence the client prose-matcher never saw (it keys on the
  // "too many attempts" / "too many failed attempts" prefix, before the
  // punctuation). The account-portal migration swapped the four legacy handleApi
  // rate-limit 429 strings in server/main.ts to the same comma, so the legacy and
  // migrated bodies are now byte-identical and the divergence no longer exists.
  {
    id: DEVIATION_ID.authBodyValidationRemap,
    routes: ['/api/login', '/api/native-attestation/challenge'],
    currentBehavior:
      'On the legacy handleApi ladder, POST /api/login and POST ' +
      '/api/native-attestation/challenge parse the body with readBody, whose reject on ' +
      "malformed JSON or an over-cap body falls to handleApi's outer catch and answers " +
      '500 { error: "internal error" } (application/json); an unexpected handler throw ' +
      'answers the same generic 500.',
    intendedBehavior:
      'The new pipeline serves these routes, parsing the body with ' +
      'the withBody middleware and surfacing errors through the RFC 9457 ' +
      'boundary (withErrors): malformed JSON now answers 400 (json.malformed), an over-cap ' +
      'body answers 413 (body.too_large), and an unexpected throw answers 500 ' +
      '(internal.error), all as application/problem+json. The 400/413 status remap mirrors ' +
      'what validationStatusRemap already documents for /api/register (so register is not ' +
      'repeated here); the auth migration realizes it for login and challenge too. The ' +
      'problem+json body shape (vs the legacy { error } shape) is the systemic error-model ' +
      'boundary shared by every migrated route, leak-free (the 500 detail is a static ' +
      'generic sentence; the original error goes only to the logger); the client ' +
      'code-matcher covers these bodies.',
    introducedInPhase: 11,
    reason:
      'The migrated routes parse the body via withBody (400 malformed / 413 over-cap) ' +
      'instead of the legacy readBody-reject to outer-catch generic 500, a strictly more ' +
      'correct and uniform status mapping. These framework-error paths are NOT exercised ' +
      'by the db-free parity corpus (which replays valid bodies only), so the divergence ' +
      "is documented here rather than caught by the harness. register's equivalent is " +
      'tracked by validationStatusRemap (whose attribution to the error model is the ' +
      'pre-existing framing; the per-route realization landed as each route migrated).',
  },
  {
    id: DEVIATION_ID.authNullBodyCoercion,
    routes: ['/api/register', '/api/login', '/api/native-attestation/challenge'],
    currentBehavior:
      'A literal JSON `null` request body (well-formed JSON, so readBody resolves it to ' +
      '`null` rather than {}) is dereferenced by the legacy handleApi arms: register reads ' +
      'null.username, login reads null.username / null.password, and the challenge arm reads ' +
      'null.action, each throwing a TypeError that falls to handleApi outer catch and answers ' +
      '500 { error: "internal error" }.',
    intendedBehavior:
      'The new pipeline serves these routes: withBody parses the `null` ' +
      'without throwing (null is valid JSON, so this is NOT the malformed-JSON path) and the ' +
      'handlers plus the turnstile gate coerce it away with `ctx.body ?? {}` = {}. So register ' +
      'answers 400 (username shape), login answers 401 (invalid credentials), and the challenge ' +
      'answers 200 (default action "auth"), all non-token responses. Not covered by ' +
      'authBodyValidationRemap (malformed-JSON / over-cap only) and not exercised by the ' +
      'valid-object-body parity corpus. The divergence becomes the real behavior when the ' +
      'legacy ladder is removed.',
    introducedInPhase: 11,
    reason:
      'Byte-for-byte parity would require re-crashing on a `null` body (a legacy 500 from an ' +
      'unguarded null dereference); the migrated `ctx.body ?? {}` coercion is strictly safer ' +
      'and yields a normal 400 / 401 / 200 for a degenerate input no real client sends. ' +
      'Documented rather than changed, since both outcomes are non-token responses and the ' +
      'coercion is an improvement.',
  },
  {
    id: DEVIATION_ID.planned405BeforeAuth,
    routes: ['/api/register', '/api/me/characters'],
    currentBehavior:
      'A known path requested with the wrong method does not get a uniform 405 ' +
      'before auth today: it either falls through to the 404 unknown-endpoint arm ' +
      'or hits the auth gate first (so a wrong method on an authed route can ' +
      'answer 401 before any 405).',
    intendedBehavior:
      'The table router returns 405 (method not allowed) for a known path ' +
      'plus an unsupported method, decided before the auth gate runs.',
    introducedInPhase: 4,
    reason:
      'The table router centralizes method dispatch so a known path with an ' +
      'unsupported method returns 405 before auth, instead of the legacy 404 or 401.',
    goldenFixtures: [
      'tests/server/fixtures/main/register_get_wrong_method_404.json',
      'tests/server/fixtures/main/me_characters_post_wrong_method_404.json',
    ],
  },
  {
    id: DEVIATION_ID.validationStatusRemap,
    routes: ['/api/register'],
    currentBehavior:
      'On the legacy handleApi ladder POST /api/register reads its body with ' +
      'readBody (no try/catch), so a malformed JSON body or an over-cap body ' +
      'falls to the outer catch and answers 500 { error: "internal error" }; a ' +
      'well-formed but semantically invalid body answers a hand-written 400.',
    intendedBehavior:
      'The new pipeline serves register with the withBody ' +
      'middleware, so malformed JSON answers 400 (json.malformed) and an over-cap ' +
      'body answers 413 (body.too_large), both application/problem+json; the ' +
      'semantic 400s stay hand-written prose (the 422 prong is aspirational and not ' +
      'yet realized). NOTE: this entry was originally seeded (with the characterization ' +
      'corpus) to also cover /api/reports and /api/bug-reports, but the reports/telemetry ' +
      'migration serves those parity-first ' +
      '(they self-read their body with NO withBody, so they get NO 400/413 status ' +
      'remap: reports 500s on a bad body, bug-reports keeps its own byte-identical ' +
      '413 { error: "bug report too large" } / 400 { error: "bad request" }); their ' +
      'only framework-error divergence is the 500 body SHAPE, tracked by ' +
      'reportsBodyValidationRemap. So the two routes are removed from this entry.',
    introducedInPhase: 7,
    reason:
      'The auth migration realizes the withBody 400 (malformed) / 413 (over-cap) status ' +
      'remap for register (was a generic 500); the 422-for-semantic prong stays aspirational ' +
      '(register still hand-writes its semantic 400s). Not exercised by the valid-body ' +
      'parity corpus, so documented here. /api/reports and /api/bug-reports were ' +
      'removed when the reports/telemetry surface migrated (they self-read without ' +
      'withBody, so they get no status remap; their 500 body-shape divergence is ' +
      'reportsBodyValidationRemap).',
    goldenFixtures: ['tests/server/fixtures/main/register_post_empty_400.json'],
  },
  {
    id: DEVIATION_ID.statusNameListTrim,
    routes: ['/api/status'],
    currentBehavior:
      'GET /api/status returns a names[] array of online player names alongside ' + 'the counts.',
    intendedBehavior:
      'The migrated public-read surface trims the names[] list out of the public status ' +
      'payload (counts only).',
    introducedInPhase: 10,
    reason:
      'The legacy status arm exposes a names[] list of online ' +
      'players; the migrated public-read surface trims it to counts only.',
    goldenFixtures: ['tests/server/fixtures/main/status_get.json'],
  },
  {
    id: DEVIATION_ID.realmsSearchAuthzGapClose,
    routes: ['/api/realms', '/api/search'],
    currentBehavior:
      'GET /api/realms treats a present-but-invalid bearer token the same as no ' +
      'token (silently anonymous, empty counts), never validating it; GET ' +
      '/api/search requires a token and answers 401 to any request without one.',
    intendedBehavior:
      'The migrated public-read surface applies the anonymous-friendly bearer ' +
      'resolver to both: a request ' +
      'with NO token still serves (realms with empty counts, search with results), ' +
      'but a request that PRESENTS a token has it validated (an invalid token is ' +
      'rejected 401 auth.token_invalid) and moderation-gated (a banned/suspended ' +
      'account is rejected 403, which the legacy bearerAccount did not check). ' +
      'Search additionally becomes anonymous-friendly (a missing token no longer ' +
      '401s) and, being now an anonymous DB-hitting read, is rate-limited in-handler ' +
      'with the same publicReadRateLimited per-IP budget the public sheet uses.',
    introducedInPhase: 10,
    reason:
      'Both routes had an authz gap: realms never validated a present token, and ' +
      "search's token requirement was inconsistent with the rest of the public-read " +
      'surface. The migration closes the gap by validating a present token while keeping ' +
      'the no-token path serving.',
    goldenFixtures: [
      'tests/server/fixtures/main/realms_get_noauth.json',
      'tests/server/fixtures/main/search_get_noauth_401.json',
    ],
  },
  {
    id: DEVIATION_ID.newLimiterCharacterMutations,
    routes: [
      '/api/characters',
      '/api/characters/:id/rename',
      '/api/characters/:id',
      '/api/characters/:id/takeover',
    ],
    currentBehavior:
      'Character create, rename, delete, and takeover have no dedicated per-action ' +
      'limiter today (they are gated only by the full session).',
    intendedBehavior:
      'The migrated character surface adds new per-action limiters on character ' +
      'create, rename, delete, and takeover.',
    introducedInPhase: 12,
    reason:
      'NEW per-action limiters on character mutations (create, rename, delete, ' +
      'takeover) land with the migrated character surface; the legacy arms have no ' +
      'dedicated limiter.',
  },
  {
    id: DEVIATION_ID.characterBodyValidationRemap,
    routes: ['/api/characters', '/api/characters/:id/rename', '/api/characters/:id'],
    currentBehavior:
      'On the legacy handleApi ladder, POST /api/characters, POST /api/characters/:id/rename, ' +
      'and DELETE /api/characters/:id read the body with readBody, whose reject on malformed ' +
      'JSON or an over-cap body falls to handleApi outer catch and answers 500 { error: ' +
      '"internal error" }; a literal JSON null body (valid JSON, so readBody resolves it to ' +
      'null) is dereferenced (null.name / null.class), throwing a TypeError that falls to the ' +
      'same generic 500.',
    intendedBehavior:
      'The new pipeline serves these routes, parsing the body with the ' +
      'withBody middleware and surfacing framework errors through the RFC 9457 ' +
      'boundary (withErrors): malformed JSON answers 400 (json.malformed), an over-cap body ' +
      'answers 413 (body.too_large), both as application/problem+json; and a literal JSON null ' +
      'body is coerced away with `ctx.body ?? {}` = {}, so create answers 400 (name invalid), ' +
      'rename answers 400 (name invalid), and delete answers 400 (confirmation required). This ' +
      'mirrors authBodyValidationRemap + authNullBodyCoercion for the auth POST ' +
      'routes; the client code-matcher covers these problem+json bodies. Not exercised ' +
      'by the valid-body parity corpus, so documented here rather than caught by the harness.',
    introducedInPhase: 12,
    reason:
      'The migrated character write routes parse the body via withBody (400 malformed / 413 ' +
      'over-cap) and coerce a null body, instead of the legacy readBody-reject / null-deref to a ' +
      'generic 500, a strictly more correct and uniform mapping shared by every withBody POST ' +
      'route (the systemic error-model boundary). These framework-error paths are not ' +
      'in the db-free parity corpus (which replays valid bodies only), so the divergence is ' +
      'documented, not harness-caught. A RELATED ordering divergence on POST /api/characters/:id/' +
      'rename: the migrated route runs requireOwnedCharacter (ownership -> 404) as middleware ' +
      'BEFORE the handler validates the name, whereas the legacy arm validates the name (-> 400) ' +
      'before getCharacter. So a request with an INVALID name AND a non-owned/absent :id answers ' +
      '404 on the new path vs 400 on the legacy path. Security-neutral-to-positive (ownership-' +
      'first leaks nothing about name validity to a non-owner, the deny-by-default BOLA posture); ' +
      'no golden fixture exercises the non-owned + invalid-name shape, so it is documented here ' +
      'rather than harness-caught.',
  },
  {
    id: DEVIATION_ID.characterIdParamDecode,
    routes: [
      '/api/characters/:id/sheet',
      '/api/characters/:id/standing',
      '/api/characters/:id/rename',
      '/api/characters/:id/takeover',
      '/api/characters/:id',
    ],
    currentBehavior:
      'On the legacy handleApi ladder the owner :id arms gate on \\d+ route regexes ' +
      '(ownerSheetMatch / standingMatch / renameMatch / takeoverMatch / delMatch), so a ' +
      'non-numeric :id (e.g. "abc", "1.5") matches no character arm and falls through to ' +
      'the 404 unknown-endpoint arm without the bearer ever being read; a numeric-but-non-' +
      'positive :id ("0") matches \\d+, reaches the account-scoped getCharacter(accountId, ' +
      '0) which misses, and answers the legacy 404 body ("character not found" for sheet / ' +
      'standing / rename, "not found" for takeover / delete); a digit string past 2^53 ' +
      'also matches \\d+ and reaches the account-scoped read with a non-safe Number (the ' +
      'same 404 miss, or a pg bigint-range 500 on the widest ids).',
    intendedBehavior:
      'The new pipeline serves these routes: requireOwned decodes ' +
      ':id with num({ int: true, min: 1 }) BEFORE any DB call, so a non-numeric OR non-' +
      'positive :id is rejected 422 (validation.failed, application/problem+json) for an ' +
      'authenticated caller; because the auth guard (activeGuard / readGuard) runs before ' +
      'the decode, an UNauthenticated bad-:id request short-circuits 401 ({ error: "not ' +
      'authenticated" }) first. This is NaN-safe and strictly more correct (ids are 1-based ' +
      'bigserial, so 0 / negative / non-numeric are never valid). The 422 / 401 (new) vs 404 ' +
      '(legacy) shape is not exercised by the numeric-id parity corpus, so it is documented ' +
      'here rather than caught by the harness; the client code-matcher covers the 422 ' +
      'problem+json body, and the divergence becomes the real behavior when the legacy ' +
      'ladder is removed.',
    introducedInPhase: 12,
    reason:
      'The migrated :id routes reject a malformed or non-positive id at the num() decoder ' +
      '(422), and an unauthenticated caller 401s at the auth guard first, instead of the ' +
      'legacy 404 fall-through / account-scoped miss. A strictly more correct, NaN-safe ' +
      'mapping for a degenerate input no real client sends (ids come from the server-issued ' +
      'numeric character list); unit-tested in require_owned.test.ts (the badIds cases), not ' +
      'in the numeric-only parity corpus, so documented here rather than harness-caught. ' +
      'Sibling to characterBodyValidationRemap (same surface and routes, same ' +
      'harness-invisible rationale).',
  },
  {
    id: DEVIATION_ID.companionTokenMethodFan,
    routes: ['/api/account/companion-token'],
    currentBehavior:
      'The legacy handleApi companion-token arm is a single method-agnostic ' +
      '`url === "/api/account/companion-token"` block with NO top-level method guard: ' +
      'it resolves bearerActiveAccount FIRST, then fans POST (create), GET (list), and ' +
      'DELETE (revoke) inside. An UNsupported method (e.g. PUT) that presents a valid ' +
      'full-session bearer passes the auth gate and then falls through all three inner ' +
      'branches to the 404 unknown-endpoint arm; the same method WITHOUT a bearer answers ' +
      '401 at the auth gate first.',
    intendedBehavior:
      'The migrated account portal registers the companion-token path as THREE ' +
      'method-specific RouteDefs (POST create, GET list, DELETE revoke). The table router ' +
      'answers a known path plus an unsupported method with 405 (method not allowed) and an ' +
      'Allow header, decided BEFORE the auth guard runs. The registry RESOLVES an unsupported ' +
      'method to methodNotAllowed (405 + Allow) for this path, but the dispatcher DELEGATES a ' +
      'non-matched resolve to the legacy handleApi ladder, so TODAY a wrong-method companion ' +
      'request still gets the legacy 404 (authenticated) / 401 (unauthenticated); the 405 + ' +
      'Allow becomes the served behavior only at the ladder deletion (when the ' +
      'dispatcher serves methodNotAllowed itself). Same framing as planned405BeforeAuth.',
    introducedInPhase: 13,
    reason:
      'The companion-token block fans methods after auth with no top-level method guard; ' +
      'the migrated three-RouteDef form inherits the systemic planned-405-before-auth ' +
      'behavior (a known path plus an unsupported method is 405 + Allow, decided before ' +
      'auth). Sibling to planned405BeforeAuth for a specific method-fan arm. Not exercised ' +
      'by the parity corpus (no wrong-method companion-token fixture), so documented here ' +
      'rather than harness-caught; the divergence becomes the real behavior at the ladder ' +
      'deletion.',
  },
  {
    id: DEVIATION_ID.accountBodyValidationRemap,
    routes: [
      '/api/account/password',
      '/api/account/deactivate',
      '/api/account/companion-token',
      '/api/account/email/change',
      '/api/account/marketing',
      '/api/account/2fa/setup',
      '/api/account/2fa/enable',
      '/api/account/2fa/disable',
    ],
    currentBehavior:
      'The account-portal handlers self-read their request body with readBody INSIDE the ' +
      'migrated handler (the shared handleAccount* domain function for password / deactivate ' +
      '/ email-change / marketing / 2fa, or the companion create/revoke route handler ' +
      'directly). On the legacy handleApi ladder, a malformed ' +
      'JSON body or an over-cap body makes readBody reject, and the reject falls to ' +
      'handleApi\'s outer catch, which answers 500 { error: "internal error" } ' +
      '(application/json); a literal JSON null body (valid JSON) is dereferenced ' +
      '(null.username / null.optIn / ...), throwing a TypeError that falls to the same ' +
      'generic 500.',
    intendedBehavior:
      'The new pipeline serves these routes. The migrated handlers call ' +
      'the SAME domain functions UNCHANGED (they self-read the body, so NO withBody ' +
      'middleware is composed and there is NO 400/413 status remap: a malformed or over-cap ' +
      'body still answers 500, and a null body still throws to 500). The ONLY divergence is ' +
      'the 500 BODY SHAPE: the throw propagates to the withErrors boundary and ' +
      'serializes as 500 application/problem+json (internal.error) instead of the legacy ' +
      '500 { error: "internal error" }. Leak-free (the 500 detail is a static sentence; the ' +
      'original error goes only to the logger). The client code-matcher covers the ' +
      'problem+json body; the divergence becomes the real behavior when the legacy arm ' +
      'is removed.',
    introducedInPhase: 13,
    reason:
      'The migrated account write handlers surface an unexpected throw (malformed / over-cap ' +
      '/ null body) through the shared error-model boundary as 500 problem+json ' +
      'instead of the legacy outer-catch 500 { error }. Same 500 STATUS, different body ' +
      'shape; there is no status remap because these handlers self-read without withBody. ' +
      'These framework-error paths are NOT exercised by the db-free parity corpus (which ' +
      'replays valid bodies only), so the divergence is documented here rather than ' +
      'harness-caught. Sibling to authBodyValidationRemap / characterBodyValidationRemap ' +
      '(same systemic boundary; those add a 400/413 remap because they use withBody, this ' +
      'one does not).',
  },
  {
    id: DEVIATION_ID.rateLimitedBodyToCode,
    routes: ['/api/wallet/link/challenge', '/api/wallet/link', '/api/woc/balance', '/api/card'],
    currentBehavior:
      'On throttle, the wallet link-challenge, wallet link, woc balance, and card ' +
      'routes answer 429 { error: "rate limited" } (application/json): the two ' +
      'wallet routes self-limit inside handleWalletChallenge / handleWalletLink, and ' +
      'the woc balance + card arms limit inline in server/main.ts, each returning the ' +
      'same bare English prose body.',
    intendedBehavior:
      'The new pipeline serves these routes: the throttle is a ' +
      'rateLimit(policy) middleware (WALLET_LINK_POLICY / WOC_BALANCE_POLICY / ' +
      'CARD_UPLOAD_POLICY) that throws HttpError(429, "rate_limit.exceeded", ' +
      '{ retryAfterSeconds }); the error boundary serializes it as RFC 9457 ' +
      'application/problem+json carrying the stable machine code "rate_limit.exceeded" ' +
      '(and a Retry-After header) instead of the bare { error: "rate limited" } prose. ' +
      'The code already exists in error_codes.ts (harvested with the error-code catalog; ' +
      'reused by the character-mutation limiters), so no catalog append is needed. The ' +
      'legacy arms keep the prose body for the flag-off rollback until the legacy ladder ' +
      'is removed; the client code-matcher (userFacingApiError) covers the problem+json body.',
    introducedInPhase: 14,
    reason:
      'The migration gives the four previously-raw rate-limited responses a stable code via ' +
      'the error model (the deliberate stable-code deliverable). The 429 divergence is ' +
      'NOT exercised by the db-free parity corpus (runParity resets every limiter bucket ' +
      'before each pass, so a bucket is never drained), so it is documented here rather ' +
      'than caught by the harness. It is a sibling to newLimiterCharacterMutations (a 429 ' +
      'that resolves to problem+json rate_limit.exceeded), except these four routes ' +
      'already returned a 429 today (as prose), so this changes the BODY SHAPE, not ' +
      'whether a 429 exists. Adding /api/card here also masks it in the path-scoped parity ' +
      'filter, so the card pre-auth 413 + Connection: close byte-identity (the only one of ' +
      'the four with a corpus fixture, card_too_large_413, which does NOT hit the limiter) ' +
      'is re-pinned by a dedicated captureBothModes assertion in parity.test.ts and by the ' +
      'card_route unit test. TELEMETRY drift (observability-only, flag-gated): on the new ' +
      'path the rateLimit(policy) middleware throws before the handler runs, so the four ' +
      'provider_usage counters the legacy arms record on a throttle ' +
      '(wallet.challenge.rate_limited / wallet.link.rate_limited / woc.balance.rate_limited / ' +
      'card.publish.rate_limited) are NOT emitted, and the wallet .request counters no longer ' +
      'count a throttled attempt (the handler that records them runs after the limiter). The ' +
      'rateLimit middleware is generic, so documenting the divergence is the correct ' +
      'resolution rather than coupling it to route-specific metrics; the admin dashboard ' +
      "undercounts throttled wallet/card/balance events with API_DISPATCH at 'new' (the " +
      'production default). Structured request-layer metrics live in the /metrics ' +
      'observability layer. No response-body or security impact.',
  },
  {
    id: DEVIATION_ID.walletBodyValidationRemap,
    routes: ['/api/wallet/link/challenge', '/api/wallet/link'],
    currentBehavior:
      'The wallet link-challenge and link handlers self-read their request body with ' +
      'readBody INSIDE walletChallengeCore / walletLinkCore (no withBody middleware). On the ' +
      'legacy handleApi ladder, a malformed JSON body or an over-cap body makes readBody ' +
      "reject, and the reject falls to handleApi's outer catch, which answers 500 " +
      '{ error: "internal error" } (application/json); a literal JSON null body (valid JSON) ' +
      'is dereferenced (null.address), throwing a TypeError that falls to the same generic 500.',
    intendedBehavior:
      'The new pipeline serves these two routes. The migrated handlers call ' +
      'the SAME limiter-free cores UNCHANGED (they self-read the body, so NO withBody ' +
      'middleware is composed and there is NO 400/413 status remap: a malformed or over-cap ' +
      'body still answers 500, and a null body still throws to 500). The ONLY divergence is ' +
      'the 500 BODY SHAPE: the throw propagates to the withErrors boundary and ' +
      'serializes as 500 application/problem+json (internal.error) instead of the legacy ' +
      '500 { error: "internal error" }. Leak-free (the 500 detail is a static sentence; the ' +
      'original error goes only to the logger). The client code-matcher covers the ' +
      'problem+json body; the divergence becomes the real behavior when the legacy arm ' +
      'is removed.',
    introducedInPhase: 14,
    reason:
      'The migrated wallet challenge/link handlers surface an unexpected body throw (malformed ' +
      '/ over-cap / null body) through the shared error-model boundary as 500 ' +
      'problem+json instead of the legacy outer-catch 500 { error }. Same 500 STATUS, ' +
      'different body shape; there is no status remap because these handlers self-read without ' +
      'withBody. Exact sibling to accountBodyValidationRemap (the account self-read POST ' +
      'routes); the card route does NOT get an entry because handleCardUpload CATCHES its own ' +
      'readBinaryBody reject and answers a byte-identical 413/400 on both paths. These ' +
      'framework-error paths are NOT exercised by the db-free parity corpus (which replays ' +
      'valid bodies only), so the divergence is documented here rather than caught by the ' +
      'harness.',
  },
  {
    id: DEVIATION_ID.reportsBodyValidationRemap,
    routes: ['/api/reports', '/api/bug-reports', '/api/perf-report', '/api/site-presence'],
    currentBehavior:
      'The four reports/telemetry handlers self-read their request body with readBody ' +
      '(the report handler at the default cap; the bug-report handler at a 1 MB cap ' +
      'with its OWN try/catch answering 413 { error: "bug report too large" } / 400 ' +
      '{ error: "bad request" }; handlePerfReport / handleSitePresenceHeartbeat inside ' +
      'themselves). On the legacy handleApi ladder, a readBody reject that the handler ' +
      'does NOT catch (an over-cap or malformed body for reports / perf-report / ' +
      "site-presence, or a non-rate-limit createBugReport throw) falls to handleApi's " +
      'outer catch and answers 500 { error: "internal error" } (application/json).',
    intendedBehavior:
      'The new pipeline serves these four routes. The handlers self-read ' +
      'their body (so NO withBody middleware is composed and there is NO 400/413 status ' +
      'remap), and every handler-owned body stays byte-identical: the report validation ' +
      'ladder ({ error } 400/404 + 200 { ok, reportId }), the bug-report 413/400/429/200 ' +
      'bodies, and the perf-report / site-presence 200/400/405 { ok } beacon bodies. The ' +
      'ONLY divergence is the 500 BODY SHAPE: an unexpected throw (a readBody reject on ' +
      'an over-cap/malformed body, or a rethrown non-rate-limit createBugReport error) ' +
      'propagates to the withErrors boundary and serializes as 500 ' +
      'application/problem+json (internal.error) instead of the legacy 500 ' +
      '{ error: "internal error" }. Leak-free (the 500 detail is a static sentence; the ' +
      'original error goes only to the logger). The client code-matcher covers the ' +
      'problem+json body; the divergence becomes the real behavior when the legacy arm ' +
      'is removed.',
    introducedInPhase: 15,
    reason:
      'The migrated reports/bug-report/perf-report/site-presence handlers surface an ' +
      'unexpected body throw through the shared error-model boundary as 500 ' +
      'problem+json instead of the legacy outer-catch 500 { error }. Same 500 STATUS, ' +
      'different body shape; there is no status remap because these handlers self-read ' +
      'without withBody. Exact sibling to accountBodyValidationRemap / ' +
      'walletBodyValidationRemap. These framework-error paths are NOT exercised by the ' +
      'db-free parity corpus (which replays valid bodies only), so the divergence is ' +
      'documented here rather than harness-caught. Adding /api/reports and ' +
      '/api/site-presence here also masks them in the path-scoped parity filter, so ' +
      'their corpus fixtures (reports_post_noauth_401, site_presence_get_405) are ' +
      're-pinned by dedicated captureBothModes assertions in parity.test.ts.',
  },
  {
    id: DEVIATION_ID.newLimiterReportsCreate,
    routes: ['/api/reports'],
    currentBehavior:
      'On the legacy handleApi ladder POST /api/reports has no dedicated limiter ' +
      '(it is gated only by the full session plus the per-target 12h ' +
      'duplicate-report window in createPlayerReport).',
    intendedBehavior:
      'The new pipeline serves POST /api/reports with a NEW coarse ' +
      'per-account limiter: a rateLimit(REPORTS_CREATE_POLICY) middleware (fused ' +
      'per-IP AND per-account, REPORTS_CREATE_MAX_PER_MINUTE = 10 over the shared ' +
      '60s window) mounted AFTER activeGuard, throwing HttpError(429, ' +
      '"rate_limit.exceeded", { retryAfterSeconds }) serialized as RFC 9457 ' +
      'application/problem+json. The code already exists (harvested with the error-code ' +
      'catalog, reused by the character-mutation and wallet/card ' +
      'limiters), so no catalog append is needed. The legacy arm stays unlimited ' +
      'for the flag-off rollback until the legacy ladder is removed.',
    introducedInPhase: 15,
    reason:
      'A NEW per-account reports.create limiter lands with the reports/telemetry ' +
      'migration (report creation ' +
      'had no dedicated limiter): a 429 is now possible where none was. Sibling to ' +
      'newLimiterCharacterMutations. The 429 divergence is NOT exercised by the ' +
      'db-free parity corpus (runParity resets every limiter bucket before each ' +
      'pass, so a bucket is never drained), so it is documented here rather than ' +
      'caught by the harness.',
  },
  {
    id: DEVIATION_ID.newLimiterDiscord,
    routes: [
      '/api/auth/discord/start',
      '/api/auth/discord/callback',
      '/api/auth/discord/login/new',
      '/api/auth/discord/login/link',
      '/api/discord',
    ],
    currentBehavior:
      'The discord.* routes share one legacy discordRateLimited limiter (keyed ' +
      'ip+account, or ip-only when the account is 0). start is DOUBLE-counted (the ' +
      'legacy handleApi arm pre-checks discordRateLimited AND handleDiscordStart ' +
      'self-checks it). The callback is unlimited and applies no isIpBlocked, and ' +
      'start applies no isIpBlocked either, so a moderation-IP-blocked client can ' +
      'still open the OAuth flow (start mints state; the login-mode callback mints a ' +
      'returning-user session). login/new + login/link already apply isIpBlocked.',
    intendedBehavior:
      'The new pipeline serves the discord routes PARITY-FIRST: the ' +
      'rate limit stays legacy prose { error: "rate limited" } (NOT the coded ' +
      'rateLimit(DISCORD_POLICY) adapter; the pre-seeded DISCORD_POLICY stays ' +
      'UNMOUNTED, held for a future coded-emission adoption), because the keying is ' +
      'entangled with handler logic. start drops the legacy double-count to a single ' +
      'count on the new path (the RouteDef does not pre-check; handleDiscordStart ' +
      'self-limits once; a side effect only visible in the unconfigured-AND-drained ' +
      'test state is that a start IN EITHER MODE (login or link, both share the ' +
      'handler) then answers 503 [config-null] where the legacy pre-check would answer ' +
      '429, since the new path defers the rate check into the handler after its config ' +
      'check; prod-irrelevant, since prod configures Discord). status/unlink carry the ' +
      'discordActiveRateGuard (the same check the legacy arm ran in main.ts, moved ' +
      'behind the auth guard); swag self-limits inside handleSwagClaim (no rate guard). ' +
      'The migration also CLOSES the isIpBlocked gap the PR #1044 / #1075 reviews flagged: ' +
      'start applies isIpBlocked (opaque 429 { error: "rate limited" }, matching ' +
      'login/new + login/link; in link mode the inline bearer resolve runs BEFORE the ' +
      'IP gate, so an unauthenticated blocked-IP link start answers the ordinary 401 ' +
      'and the block stays invisible there too) and the ' +
      'callback applies isIpBlocked (an opaque HTML bounce reusing the existing ' +
      '"server_error" vocabulary, so the block is never revealed and the callback ' +
      'stays HTML). passesTurnstile is DELIBERATELY not added (the Discord flow carries ' +
      'no turnstile token, so a gate would 403 every prod login; the OAuth itself is ' +
      'the human-check, matching login/new + login/link). The wider rate-limiter rework ' +
      '(the two-tier limiter) reworked the backing afterward.',
    introducedInPhase: 16,
    reason:
      'The migration ports the discord family parity-first: the limiters keep their ' +
      'legacy prose bodies (coded emission stays a deferred adoption), start loses ' +
      'its double-count ' +
      'on the new path, and start + callback gain an opaque isIpBlocked gate closing ' +
      'the PR #1044 / #1075 IP-ban-evasion finding (a blocked IP could mint a Discord ' +
      'account/session). The 429 / IP-block divergences are NOT exercised by the ' +
      'db-free parity corpus (runParity resets every limiter bucket before each pass, ' +
      'and the corpus IP is never blocked), so they are documented here rather than ' +
      'caught by the harness. The four discord corpus fixtures (start-503, ' +
      'status-401, unlink-401, callback-bounce) are path-masked by this entry, so ' +
      'each is re-pinned by a dedicated captureBothModes assertion proving the ' +
      'migrated path stays byte-identical to the legacy arm.',
  },
  {
    id: DEVIATION_ID.swagClaimOrphanUnreachable,
    routes: ['/api/discord/swag/claim'],
    currentBehavior:
      'handleSwagClaim is exported but no dispatcher arm routes to it, so POST ' +
      '/api/discord/swag/claim is unreachable today (it falls through to the 404 ' +
      'unknown-endpoint arm).',
    intendedBehavior:
      'The migration registers POST /api/discord/swag/claim as a RouteDef ([activeGuard] ' +
      'plus handleSwagClaim, which self-limits with discordRateLimited and receives a ' +
      'live grantCosmetic hook injected via configureDiscordRuntime -> ' +
      'game.grantMechChromaToAccount), so the handler is now reachable over HTTP and ' +
      'answers its real 200 / 400 / 403 / 409 / 429 bodies. The legacy ladder still 404s ' +
      'it (no legacy arm was ever added), so it is served on the new path only (a ' +
      'dispatch-flag rollback would 404 it again); there is still no client caller (the ' +
      'widget shows a claim badge but never posts), so the reachability is the deliverable.',
    introducedInPhase: 16,
    reason:
      'The swag-claim handler exists but had no dispatch arm (an orphan); the ' +
      'discord wiring registers it as a RouteDef so it is reachable over HTTP. Its ' +
      'existing unit tests (the handleSwagClaim logic) stay green; the previously-404 ' +
      'behavior on the legacy path is preserved for rollback until the legacy ladder ' +
      'is removed. Not ' +
      'exercised by the parity corpus (no swag fixture, since it 404d), so documented ' +
      'here rather than harness-caught.',
  },
  {
    id: DEVIATION_ID.discordBodyValidationRemap,
    routes: [
      '/api/auth/discord/start',
      '/api/auth/discord/callback',
      '/api/auth/discord/login/new',
      '/api/auth/discord/login/link',
      '/api/discord',
      '/api/discord/swag/claim',
    ],
    currentBehavior:
      'The Discord handlers self-read their request body with readJsonBody, which ' +
      'SWALLOWS an over-cap (> 4 KB) or malformed body and returns {} (it never ' +
      'rejects), so there is no 400/413 body path. On the legacy handleApi ladder, an ' +
      'UNEXPECTED throw (e.g. a Postgres error from consumeDiscordOAuthState / ' +
      "linkDiscordToAccount / a reward query) falls to handleApi's outer catch and " +
      'answers 500 { error: "internal error" } (application/json); an unexpected throw ' +
      'escaping the callback (outside its internal try/catch) hits the same generic 500.',
    intendedBehavior:
      'The new pipeline serves these routes. The handlers self-read ' +
      '(so NO withBody middleware is composed and there is NO 400/413 status remap: a ' +
      'bad body is still coerced to {} by readJsonBody), and every handler-owned body ' +
      'stays byte-identical. The ONLY divergence is the 500 BODY SHAPE on an unexpected ' +
      'throw: for the JSON routes it propagates to the withErrors boundary and ' +
      'serializes as 500 application/problem+json (internal.error) instead of the ' +
      'legacy 500 { error: "internal error" }; for the callback (meta.envelope "html") ' +
      'it serializes as a 500 HTML error page instead of the legacy 500 JSON, ' +
      'preserving the never-problem+json contract. Leak-free (the 500 detail is a ' +
      'static sentence; the original error goes only to the logger). The client ' +
      'code-matcher covers the problem+json body; the divergence becomes the ' +
      'real behavior when the legacy arm is removed.',
    introducedInPhase: 16,
    reason:
      'The migrated Discord handlers surface an unexpected throw through the shared ' +
      'error-model boundary as 500 problem+json (JSON routes) or 500 HTML ' +
      '(callback, via meta.envelope) instead of the legacy outer-catch 500 { error }. ' +
      'Same 500 STATUS, different body shape; there is no status remap because these ' +
      'handlers self-read without withBody (and readJsonBody swallows a bad body to {}, ' +
      'so no 400/413 path exists at all). Exact sibling to accountBodyValidationRemap / ' +
      'walletBodyValidationRemap / reportsBodyValidationRemap (the callback variant ' +
      'stays HTML per discordCallbackHtmlNotRedirect). These framework-error paths are ' +
      'NOT exercised by the db-free parity corpus (which replays valid bodies only), so ' +
      'the divergence is documented here rather than harness-caught.',
  },
  // --- The admin surface (server/admin.ts) -------------------------------------
  {
    id: DEVIATION_ID.adminEnumInvalid422,
    routes: ['/admin/api/moderation/accounts/:id/(suspend|unsuspend|ban|unban)'],
    currentBehavior:
      'SUPERSEDED by the v0.22.0 release merge (the fine-grained admin permission ' +
      'model). BOTH arms now run the central ADMIN_ROUTE_PERMISSIONS gate before any ' +
      'route/action decode (legacy: the handleAdminApi preamble; migrated: inside ' +
      'createRequireAdmin), and the table keys the sanction route on the literal ' +
      'four-action alternation, so an action outside the four resolves NO permission ' +
      'and answers a fail-closed 404 { success: false, data: null, error: "unknown ' +
      'admin endpoint" } identically on both arms (pinned by tests/server/admin.test.ts ' +
      '"404s a fifth action outside the enum fail-closed"). Before v0.22.0 the legacy ' +
      'arm answered a POST-fallthrough 405 and the migrated arm a 422 enum decode.',
    intendedBehavior:
      'No live divergence remains: the fail-closed 404 is byte-identical on both arms. ' +
      'The migrated :id/:action restructure (the no-regex-routing guard rejects the ' +
      'alternation) and its schema enum { suspend, unsuspend, ban, unban } are still in ' +
      'place, but the 422 arm is an unreachable defensive backstop behind the gate ' +
      '(only the four table-matched actions ever reach the decode). Retained in the ' +
      'ledger for the ladder-deletion PR: deleting the legacy arm must NOT resurrect ' +
      'the 422 by removing the central gate from the migrated path.',
    introducedInPhase: 17,
    reason:
      'Restructuring the only enum-alternation route to a schema-validated :action ' +
      'param is required by the no-regex-routing guard. The original 422-vs-405 ' +
      'divergence was closed from the LEGACY side by the v0.22.0 central permission ' +
      'gate, mirrored onto the migrated arm in the same merge. Not exercised by the ' +
      'db-free parity corpus (admin authed reads need Postgres), documented here.',
  },
  {
    id: DEVIATION_ID.adminIdParamDecode,
    routes: [
      '/admin/api/moderation/accounts/:id/(suspend|unsuspend|ban|unban)',
      '/admin/api/moderation/accounts/:id/reactivate',
      '/admin/api/moderation/accounts/:id/chat-mute',
      '/admin/api/moderation/accounts/:id/lift-mute',
      '/admin/api/moderation/accounts/:id/note',
      '/admin/api/moderation/accounts/:id/reset-strikes',
      '/admin/api/moderation/reports/:id/ignore',
      '/admin/api/moderation/characters/:id/force-rename',
      '/admin/api/moderation/accounts/:id',
      '/admin/api/accounts/:id',
      '/admin/api/chat-filter/words/:id/delete',
      '/admin/api/bug-reports/:id/screenshot',
      // v0.20.0 third slice: the map editor moderation :id routes inherit the
      // same requireAdminTarget 422-vs-legacy-fall-through class.
      '/admin/api/maps/:id/unpublish',
      '/admin/api/user-assets/:id/block',
      '/admin/api/user-assets/:id/unblock',
    ],
    currentBehavior:
      'NARROWED by the v0.22.0 release merge: BOTH arms now run the central ' +
      'ADMIN_ROUTE_PERMISSIONS gate before any decode, and its `(\\d+)`-keyed patterns ' +
      'reject every NON-NUMERIC :id spelling ("abc", "+5", "5.0", " 5 ") with the same ' +
      'fail-closed 404 { success: false, data: null, error: "unknown admin endpoint" } ' +
      'on both arms (pinned by tests/server/admin.test.ts "404s a non-numeric :id ' +
      'fail-closed"), so that whole class no longer diverges (and the pre-v0.22.0 ' +
      'wider-than-legacy num() spellings can no longer reach the migrated handler). ' +
      'What REMAINS divergent is the DEGENERATE DIGIT-STRING class, which passes the ' +
      'gate on both arms: the legacy `(\\d+)` regex matches "0" / "00" and runs the ' +
      'handler to its DB-miss path (the handler-owned 404 "account not found" / "word ' +
      'not found" / "open report not found", a 200 { screenshot: null } on ' +
      "bug-reports/:id/screenshot, a 200 { ok: true } on reactivate's zero-row " +
      'UPDATE), and a digit string past 2^53 passes a non-safe Number to the *_db ' +
      'layer (a DB miss answers the handler-owned 404; a pg bigint-range error ' +
      "surfaces as the catch's 400 err.message on the moderation writes or the outer " +
      '500 "internal error" on the reads).',
    intendedBehavior:
      'The migrated admin surface decodes :id with requireAdminTarget num({ int, min: 1 }) ' +
      'BEFORE any DB call, so the degenerate digit-string class ("0", "00", past-2^53) ' +
      'answers 422 { success: false, data: null, error: "validation.failed" } where the ' +
      'legacy arm runs the handler (NaN-safe: a query never receives a non-positive or ' +
      'non-safe Number). AUTH-GATED: requireAdmin precedes the decode, so an ' +
      'unauthenticated bad-id request 401s on both paths; the divergence is only ' +
      'reachable behind a valid admin bearer holding the route permission. Sibling to ' +
      'characterIdParamDecode (whose legacy arm answered the account-scoped miss 404 for ' +
      'a matched "0"). No golden pins a degenerate-numeric admin id and no client sends ' +
      'one, so it is not a parity divergence the harness can observe.',
    introducedInPhase: 17,
    reason:
      'The operator loader rejects a degenerate numeric id with a 422 rather than ' +
      'letting a non-positive or non-safe Number reach a query; the legacy `(\\d+)` arm ' +
      'runs the handler instead. The non-numeric class this entry originally covered ' +
      'was closed from the LEGACY side by the v0.22.0 central permission gate (both ' +
      'arms fail-closed 404 pre-decode). Not observable by the numeric-only, db-free ' +
      'parity corpus (and auth-gated), documented here.',
  },
  {
    id: DEVIATION_ID.adminBodyValidationRemap,
    routes: [
      '/admin/api/login',
      '/admin/api/moderation/accounts/:id/(suspend|unsuspend|ban|unban)',
      '/admin/api/chat-filter/config',
      '/admin/api/blocked-ips',
      '/admin/api/accounts',
    ],
    currentBehavior:
      'The legacy handleAdminApi self-reads each body with readBody and wraps its whole ' +
      'body in one try/catch: a malformed / over-cap body (readBody throws "bad json" / ' +
      '"body too large") OR any unexpected throw (a Postgres error) falls to the outer ' +
      'catch and answers 500 { success: false, data: null, error: "internal error" }.',
    intendedBehavior:
      'The migration keeps the handlers self-reading (NO withBody, so no 400/413 status ' +
      'remap), so every handler-owned body stays byte-identical. The ONLY divergence is ' +
      'the 500 BODY on an unexpected throw / bad body: it propagates to the ' +
      'withErrors boundary and serializes as the admin envelope 500 { success: false, ' +
      'data: null, error: "internal.error" } (the stable code) instead of the legacy ' +
      'outer-catch 500 { ...error: "internal error" }. Same 500 STATUS and same ' +
      '{ success, data, error } shape; only the error string differs (the code ' +
      '"internal.error" vs the prose "internal error"). Leak-free (the 500 detail is a ' +
      'stable code; the original error goes only to the logger). SYSTEMIC HEADER NOTE: ' +
      'every withErrors-served admin error path (this 500 plus the adminIdParamDecode / ' +
      'adminEnumInvalid422 422s) attaches an X-Request-Id response header the legacy ' +
      'fail() did not; this is the shared error-boundary behavior on every migrated ' +
      'surface, auth-gated, and invisible to the db-free parity corpus ' +
      '(the tested 401 gate writes via direct json()/fail(), no header), NOT admin-specific.',
    introducedInPhase: 17,
    reason:
      'The migrated admin handlers surface an unexpected throw / bad body through the ' +
      'shared error-model boundary as 500 { ...error: "internal.error" } (the ' +
      'admin serializer, selected by meta.envelope "admin") instead of the legacy ' +
      'outer-catch 500 { ...error: "internal error" }. Same status + envelope shape, ' +
      'different error string. Exact sibling to accountBodyValidationRemap / ' +
      'walletBodyValidationRemap / reportsBodyValidationRemap / discordBodyValidationRemap. ' +
      'The listed routes are representative (the remap applies to every admin route); the ' +
      'framework-error path is not exercised by the db-free parity corpus, documented here.',
  },
  {
    id: DEVIATION_ID.oauthBodyValidationRemap,
    routes: [
      '/oauth/authorize',
      '/oauth/token',
      '/oauth/revoke',
      '/oauth/device_authorization',
      '/oauth/device',
    ],
    currentBehavior:
      'The legacy handleOAuth wraps its whole ladder in one try/catch: any throw escaping ' +
      'a POST handler (an over-cap consent body, readForm/readBinaryBody rejects past its ' +
      '16 KB cap; a Postgres error) logs a structured "oauth error" line and answers the ' +
      'bare RFC 6749 500 { error: "server_error" } with NO error_description. A malformed ' +
      'JSON body is NOT a throw path (readForm coerces it to {} and the handler answers ' +
      'its own 400/401).',
    intendedBehavior:
      'The migration keeps the handlers self-reading (readForm inside the unchanged cores; ' +
      'NO ' +
      'withBody, so no 400/413 status remap and every handler-owned body stays ' +
      'byte-identical). The ONLY divergence is the 500 BODY on an unexpected throw: it ' +
      'propagates to the withErrors boundary and serializes through serializeOauth ' +
      '(meta.envelope "oauth") as 500 { error: "server_error", error_description: "An ' +
      'unexpected error occurred." } plus an X-Request-Id header, where legacy wrote the ' +
      'bare { error: "server_error" }. Same 500 status, same RFC 6749 error code; the ' +
      'description member and header are ADDITIVE and leak-free (generic text; the ' +
      'original error goes only to the logger, the shared "unhandled request error" line ' +
      'instead of the module-local "oauth error" line). The GET consent/device HTML pages ' +
      'stay on the legacy ladder (never enter the route table), so their htmlError paths ' +
      'are untouched.',
    introducedInPhase: 18,
    reason:
      'The migrated OAuth POST handlers surface an unexpected throw through the shared ' +
      'error-model boundary (the RFC 6749 serializer) instead of the legacy ' +
      'module-local catch. Same status + error code, an additive description field. ' +
      'Sibling to accountBodyValidationRemap / walletBodyValidationRemap / ' +
      'reportsBodyValidationRemap / discordBodyValidationRemap / adminBodyValidationRemap. ' +
      'Not exercised by the db-free parity corpus (a real throw needs a DB failure or an ' +
      'over-cap stream), documented here and pinned with fakes in tests/server/oauth.test.ts.',
  },
  {
    id: DEVIATION_ID.internalBodyValidationRemap,
    routes: [
      '/internal/restart-countdown',
      '/internal/discord/flex',
      '/internal/discord/roles',
      '/internal/discord/presence',
      '/internal/discord/grant',
      '/internal/discord/member',
      '/internal/discord/relay',
      '/internal/discord/activity',
      '/internal/discord/daily-rewards-winners',
      '/internal/discord/daily-rewards-winners/mark',
      '/internal/discord/members-meta',
    ],
    currentBehavior:
      'The legacy handleInternalApi has NO outer catch. Every body read carries its own ' +
      '.catch(() => ({})) (a malformed/over-cap body coerces to {} and is not a throw ' +
      'path), but an unexpected throw (a Postgres error, a dailyRewardService throw) ' +
      "escapes the whole ladder into main.ts's fire-and-forget /internal arm as an " +
      'unhandled promise rejection: the keep-alive unhandledRejection handler logs it, NO ' +
      "response is ever written, and the bot's request hangs until its client timeout.",
    intendedBehavior:
      'The migration routes the same throw to the withErrors boundary, which serializes ' +
      'it through the admin-shape serializer (meta.envelope "admin": the internal fail() ' +
      'envelope IS the admin { success, data, error } shape, and EnvelopeKind is a frozen ' +
      'spine contract (server/http/types.ts) with no separate internal member) as ' +
      '500 { success: false, data: ' +
      'null, error: "internal.error" } plus an X-Request-Id header. A response is now ' +
      'always written where legacy hung the request: strictly a reliability improvement, ' +
      'flag-gated, leak-free (stable code only; the original error goes to the logger). ' +
      'SECRET-GATED: every divergence is only reachable behind a valid deploy/bot secret ' +
      '(the gate itself answers the legacy 404/401 bodies via direct json(), no header).',
    introducedInPhase: 18,
    reason:
      "The legacy internal ladder's missing outer catch is a latent request-hang; the " +
      'migrated routes serialize an unexpected throw through the shared error boundary ' +
      'like every other migrated surface. Sibling to the other *BodyValidationRemap ' +
      'entries (with a hang, not a 500 prose body, as the legacy counterfactual). Not ' +
      'exercised by the db-free parity corpus (a real throw needs a DB failure behind a ' +
      'valid secret), documented here and pinned with fakes in tests/server/internal.test.ts.',
  },
  {
    id: DEVIATION_ID.oauthInternalOffTable405,
    routes: ['/oauth/authorize', '/oauth/device', '/internal/restart-countdown'],
    currentBehavior:
      'The route table registers only the POST arms of these three paths, so the registry ' +
      'RESOLVES a GET (or any unregistered method) on them to methodNotAllowed. The ' +
      'dispatcher DELEGATES every non-matched resolve to the legacy ladder, so ' +
      'today the served behavior is unchanged: GET /oauth/authorize and GET /oauth/device ' +
      'are REAL feature pages (handleOAuth renders the consent and device-link HTML), and ' +
      'a non-POST /internal/restart-countdown answers the deliberate feature-hiding 404 ' +
      '"unknown endpoint" (the legacy arm method-checks before its secret gate). All ' +
      'three are parity-pinned old-vs-new with captureBothModes in parity.test.ts.',
    intendedBehavior:
      'At the ladder deletion the dispatcher stops delegating and serves ' +
      'methodNotAllowed itself (405 + Allow: POST). Applied blindly, that would regress ' +
      'the two consent/device GET pages from working HTML to a 405 and would swap the ' +
      'restart-countdown anti-enumeration 404 for a path-revealing 405. The deletion PR ' +
      'must therefore migrate the two GET pages onto RouteDefs (meta.envelope "html", the ' +
      'renderAuthorize / renderDevicePage cores unchanged) or retain a delegate for the ' +
      'un-migrated GET paths, and decide the restart-countdown wrong-method shape ' +
      'deliberately (keep the 404 or accept the 405) rather than by default.',
    introducedInPhase: 18,
    reason:
      'The migration keeps the OAuth GET pages OFF the route table (per the packet) and ' +
      'preserves every wrong-method 404 purely by dispatcher delegation, so without this ' +
      'entry nothing in the ledger records that the ladder deletion changes the served ' +
      'behavior of these off-table arms. Sibling to planned405BeforeAuth and ' +
      'companionTokenMethodFan (the systemic 405-at-the-ladder-deletion framing); listed ' +
      'separately because two of the arms are whole HTML pages, not just a status-code change.',
  },
  // --- The release-merge late-arrival families ---------------------------------
  // introducedInPhase stays the integer 18 (the ledger bounds the value to the
  // 25-phase packet numbering; 18b was the inserted late-arrival sub-phase,
  // recorded here as 18).
  {
    id: DEVIATION_ID.githubBodyValidationRemap,
    routes: ['/api/auth/github/start', '/api/auth/github/callback', '/api/github'],
    currentBehavior:
      'The four legacy github arms are bare `return handler(...)` calls inside ' +
      "handleApi's try (no await), so an UNEXPECTED throw (a Postgres error in " +
      'createGitHubOAuthState / consumeGitHubOAuthState / githubForAccount / ' +
      'unlinkGitHub) never reaches the outer catch: it becomes an unhandled promise ' +
      'rejection in the fire-and-forget /api arm, NO response is written, and the ' +
      'request HANGS until the client times out. Expected error paths (unconfigured ' +
      '503, rate-limit 429, the callback bounce pages incl. its own caught 500 ' +
      'server_error bounce) are handler-owned and unaffected.',
    intendedBehavior:
      'The late-arrival migration routes the same throw to the withErrors boundary: ' +
      'start/status/unlink serialize as the api-surface problem+json 500 plus an ' +
      'X-Request-Id header; the callback carries meta.envelope "html", so its ' +
      'escaping throw serializes as an HTML error page, never problem+json (the ' +
      'window.opener.postMessage popup contract). A response is now always written ' +
      'where legacy hung: strictly a flag-gated reliability improvement, leak-free ' +
      '(generic text; the original error goes to the logger).',
    introducedInPhase: 18,
    reason:
      'The late-arrival migration ports the github family onto the shared ' +
      'spine; the handlers self-read nothing (no withBody), so the only divergence is ' +
      'the unexpected-throw class. Sibling to internalBodyValidationRemap (the same ' +
      'hang counterfactual: the bare-return arms postdate the wave that pinned the ' +
      '`return await` arms). Not exercised by the db-free parity corpus (a real throw ' +
      'needs a DB failure behind auth), documented here and pinned with fakes in ' +
      'tests/server/github.test.ts.',
  },
  {
    id: DEVIATION_ID.desktopLoginBodyValidationRemap,
    routes: ['/api/desktop-login/create', '/api/desktop-login/exchange'],
    currentBehavior:
      'Both legacy desktop-login arms are bare `return handler(...)` calls inside ' +
      "handleApi's try (no await), so exchange's self-read readBody rejection (a " +
      'malformed JSON body or the 64 KiB over-cap destroy) and any unexpected DB throw ' +
      'escape the outer catch as an unhandled rejection: NO response is written and ' +
      'the request HANGS until the client times out.',
    intendedBehavior:
      'The migration keeps exchange self-reading (NO withBody, so no 400/413/422 remap and ' +
      'every handler-owned body stays byte-identical) and routes the rejection to the ' +
      'withErrors boundary: the api-surface problem+json 500 plus an ' +
      'X-Request-Id header. A response is now always written where legacy hung: ' +
      'strictly a flag-gated reliability improvement.',
    introducedInPhase: 18,
    reason:
      'The late-arrival migration ports the desktop-login handoff pair onto the shared ' +
      'spine; the ' +
      'single-use IP-bound code flow and the fused register/login per-IP budget are ' +
      'preserved byte-for-byte, so the unexpected-throw / bad-JSON class is the only ' +
      'divergence. Sibling to internalBodyValidationRemap (the hang counterfactual). ' +
      'Pinned with fakes in tests/server/desktop_login.test.ts.',
  },
  {
    id: DEVIATION_ID.desktopLoginCreateFullScope,
    routes: ['/api/desktop-login/create'],
    currentBehavior:
      'POST /api/desktop-login/create requires a FULL active session on BOTH serving ' +
      'paths (legacy arm: bearerActiveAccount; RouteDef: the shared createActiveGuard): ' +
      'a read-scope companion/OAuth token answers 403 { error: "this token is ' +
      'read-only" } and a moderation-locked account 403s before any code is minted. ' +
      'Before the late-arrival migration the handler resolved the bearer via the ' +
      'SCOPE-BLIND ' +
      'accountForToken, so a read-scope token could mint a handoff code that ' +
      '/api/desktop-login/exchange then traded for a full-scope session token: a ' +
      'read-to-full scope escalation.',
    intendedBehavior:
      'Preserved on both paths (the maintainer-resolved late-arrival fork, option FIX): ' +
      'the escalation is closed identically under both dispatch modes, so old-vs-new ' +
      'parity holds; the change is versus the pre-18b shipped baseline, not between ' +
      'the dispatch arms. No legitimate caller regresses: the browser /desktop-login ' +
      'page always holds a full-scope session token.',
    introducedInPhase: 18,
    reason:
      'The scope-checked resolver (accountAndScopeForToken + the read-only 403) exists ' +
      'precisely to stop a read token acting as full on mutating routes; exchange ' +
      'mints scope "full", so create IS a session-minting mutation. Landed on both ' +
      'serving paths in the same change (the dual-edit rule), pinned in ' +
      'tests/server/desktop_login.test.ts and the security suite. The read-only 403 ' +
      'prose is the existing shared guard string ("this token is read-only", no ' +
      'client matcher arm today: a recorded REST error i18n adjudication).',
  },
  {
    id: DEVIATION_ID.dailyRewardsBodyValidationRemap,
    routes: ['/api/daily-rewards', '/api/daily-rewards/spin', '/api/daily-rewards/history'],
    currentBehavior:
      'The legacy player family is served by a bare `return handleDailyRewardApi(...)` ' +
      "inside handleApi's try (no await), so an unexpected throw (a Postgres error, a " +
      'dailyRewardService throw past the eligibility guards) escapes the outer catch ' +
      'as an unhandled rejection: NO response is written and the request HANGS. ' +
      'Handler-owned bodies (the 403 wallet-lock, the 409 already-claimed, the ' +
      'in-family 404 "unknown endpoint", the lenient Number(...)||30 history limit) ' +
      'are unaffected.',
    intendedBehavior:
      'The migration registers the three player routes calling the SAME ' +
      'handleDailyRewardApi core (no withBody: spin provably reads no body, history ' +
      'keeps its lenient limit decode) behind the shared createActiveGuard, and routes ' +
      'the unexpected throw to the withErrors boundary: the api-surface problem+json ' +
      '500 plus an X-Request-Id header. Off-table shapes (wrong method, unknown ' +
      'subpath, the no-slash /api/daily-rewardsX sibling, HEAD) stay delegate-served ' +
      'until the legacy ladder is removed.',
    introducedInPhase: 18,
    reason:
      'The late-arrival migration ports the daily-rewards player family; parity is by ' +
      'construction ' +
      '(the RouteDef handlers call the ladder core unchanged), so the ' +
      'unexpected-throw class is the only divergence. Sibling to ' +
      'internalBodyValidationRemap (the hang counterfactual). NO rate limiter is ' +
      'added (legacy has none; the spin-throttle decision was handed to the two-tier ' +
      'rate-limiter rework). ' +
      'Pinned with fakes in tests/server/daily_rewards_routes.test.ts.',
  },
  {
    id: DEVIATION_ID.dailyRewardsOpsBodyValidationRemap,
    routes: [
      '/internal/daily-rewards/pending-payouts',
      '/internal/daily-rewards/payout-history',
      '/internal/daily-rewards/mark-payout',
    ],
    currentBehavior:
      'The legacy ops family is the FIRST arm of the /internal composite delegate ' +
      '(handleDailyRewardInternalApi, tried before handleInternalApi), fired ' +
      'fire-and-forget with NO outer catch: mark-payout self-reads its body via an ' +
      'UN-caught readBody (unlike internal.ts, which .catch(() => ({}))s every read), ' +
      'so a malformed/over-cap body AND any DB throw in the three handlers become an ' +
      'unhandled rejection: NO response is written and the payout service request ' +
      'HANGS. The gate itself is FAIL-CLOSED: an unset ' +
      'WOC_DAILY_REWARD_SERVICE_SECRET and a wrong x-woc-daily-reward-secret header ' +
      'both answer 401 { success: false, data: null, error: "not authenticated" } ' +
      "(never the other internal gates' feature-off 404, never a " +
      'RESTART_COUNTDOWN_SECRET fallback).',
    intendedBehavior:
      'The migration registers the three ops routes behind the new ' +
      'requireInternalSecretFailClosed gate (same fail-closed 401 semantics, ' +
      'per-request env read, length-guarded timingSafeEqual) with handlers calling ' +
      'the SAME handleDailyRewardInternalApi core, and routes the rejection to the ' +
      'withErrors boundary: the admin-shape 500 { success: false, data: null, error: ' +
      '"internal.error" } plus an X-Request-Id header (meta.envelope "admin"). A ' +
      'response is now always written where legacy hung. The legacy family gates the ' +
      'WHOLE /internal/daily-rewards/ prefix BEFORE path/method resolution; on the ' +
      'table each route gates after path match, which is invisible while the ' +
      'composite delegate serves the unmatched remainder: at the ladder ' +
      'deletion the family-wide pre-path 401 must be recreated or its loss ' +
      'adjudicated deliberately (alongside oauthInternalOffTable405).',
    introducedInPhase: 18,
    reason:
      'The late-arrival migration puts the ops family on the table (the initial OAuth + ' +
      '/internal migration left it delegate-only). ' +
      'Sibling to internalBodyValidationRemap with the same hang counterfactual, ' +
      'SECRET-GATED: every divergence is only reachable behind the valid payout ' +
      'secret except the 500 on a bad mark-payout body, whose legacy counterfactual ' +
      'is also a hang. The composite delegate ordering (daily-rewards tried first) ' +
      'is untouched and stays parity-pinned. Pinned with fakes in ' +
      'tests/server/daily_rewards_routes.test.ts.',
  },
  // --- The two-tier rate limiter + draft-11 429 headers ------------------------
  {
    id: DEVIATION_ID.rateLimit429Draft11Headers,
    routes: [
      '/api/wallet/link/challenge',
      '/api/wallet/link',
      '/api/woc/balance',
      '/api/card',
      '/api/characters',
      '/api/characters/:id/rename',
      '/api/characters/:id/takeover',
      '/api/characters/:id',
      '/api/reports',
    ],
    currentBehavior:
      'Before the two-tier limiter rework, a coded 429 from a rateLimit(policy) middleware ' +
      '(the migrated ' +
      'wallet/woc/card, character-mutation, and reports.create limiters) is thrown as ' +
      'HttpError(429, "rate_limit.exceeded", { retryAfterSeconds: 60 }) where 60 is the ' +
      'static shared-window constant, and the ONLY response header is Retry-After: 60 ' +
      '(applyImpliedHeaders derives it from params.retryAfterSeconds). No RateLimit or ' +
      'RateLimit-Policy header is emitted, and the advertised retry is the constant 60 ' +
      'regardless of how far into the sliding window the caller actually is.',
    intendedBehavior:
      'The rework turns the rateLimit middleware adapter into a two-tier resolver ' +
      '(in-memory tier-1 ' +
      'first, a pg-backed GLOBAL tier-2 second) and gives every coded 429 the accurate ' +
      'per-request numbers plus the draft-11 headers. The thrown 429 now carries ' +
      'retryAfterSeconds = the limiter outcome.resetSeconds (the true seconds-to-window-' +
      'reset, which equals 60 only at the instant the window filled) in both the body and ' +
      'Retry-After, plus RateLimit: "<name>";r=<remaining>;t=<resetSeconds> and ' +
      'RateLimit-Policy: "<name>";q=<limit>;w=60 (fields per ' +
      'draft-ietf-httpapi-ratelimit-headers-11, structured-field syntax per RFC 9651; the ' +
      'legacy X-RateLimit-* trio is deliberately never emitted). Tier-2 records the same ' +
      'named limit against a pg fixed-window counter AFTER tier-1 allows, so in a single ' +
      'process it can never reject when tier-1 allowed (tier-1 records first and the fixed ' +
      'window counts a subset of the sliding window): tier-2 adds NO new 429 today, only ' +
      'the imminent multi-realm global cap. Tier-2 fails open (a pg outage degrades to ' +
      'tier-1-only limiting, never a 500). The legacy handleApi arms are untouched (they ' +
      'keep the prose { error: "rate limited" } body for the flag-off rollback until the ' +
      'legacy ladder is removed); the client code-matcher covers the coded body.',
    introducedInPhase: 19,
    reason:
      'The draft-11 RateLimit / RateLimit-Policy header emission and the accurate ' +
      'per-request Retry-After / body retryAfterSeconds (was the constant 60) are the ' +
      "rework's deliverable, additive over the earlier migrated coded 429 (same 429 status, " +
      'same stable code, same problem+json body shape; new headers + a more accurate ' +
      'retry value). NOT exercised by the db-free parity corpus: runParity resets every ' +
      'limiter bucket before each pass, so a bucket is never drained and no coded 429 ' +
      'fires, and every route listed here is ALREADY path-masked in the parity filter by ' +
      'rateLimitedBodyToCode (wallet/woc/card), newLimiterCharacterMutations (the four ' +
      'character routes), or newLimiterReportsCreate (/api/reports), so this entry adds no ' +
      'new masking and needs no new captureBothModes re-pin. Documented here and pinned ' +
      'directly on the thrown HttpError in tests/server/http/rate_limit.test.ts.',
  },
  {
    id: DEVIATION_ID.securityHeadersAllSurfaces,
    // Cross-cutting: the wrapper covers EVERY response on EVERY prefix (static,
    // /c/ SSR, /p/ card, /avatar, sitemap, and all four API dispatchers). These
    // four rows are one representative per dispatcher; the inventory has no way
    // to name the non-API prefix routes (they are deliberately uninventoried,
    // see the surface_inventory.ts header).
    routes: ['/api/login', '/admin/api/login', '/oauth/token', '/internal/restart-countdown'],
    currentBehavior:
      'Before the top-level security-headers wrapper, no response carries any security ' +
      'header: no ' +
      'X-Content-Type-Options, Referrer-Policy, Permissions-Policy, ' +
      'Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy, ' +
      'Strict-Transport-Security, or X-Frame-Options anywhere in the tree, and ' +
      'the /oauth/token and /oauth/device_authorization JSON responses (which ' +
      'carry bearer secrets) set no Cache-Control.',
    intendedBehavior:
      'The TOP-LEVEL withSecurityHeaders wrapper in ' +
      'routeHttpRequest (ahead of the prefix ladder, shared by the legacy ladder ' +
      'AND the new dispatcher so a dispatch flag rollback cannot drop a header) sets: ' +
      'X-Content-Type-Options: nosniff, Referrer-Policy: ' +
      'strict-origin-when-cross-origin, a Permissions-Policy deny list that ' +
      'excludes the features the game client uses (fullscreen, gamepad) plus ' +
      'autoplay/screen-wake-lock, Cross-Origin-Opener-Policy: same-origin, and ' +
      'Cross-Origin-Resource-Policy: same-origin on every response; ' +
      'Strict-Transport-Security only under NODE_ENV=production; and ' +
      'X-Frame-Options: DENY plus Cache-Control: no-store on the /oauth/ prefix. ' +
      'Cross-Origin-Embedder-Policy is deliberately NOT set (it would break ' +
      'cross-origin GLB/HDRI loads) and no Content-Security-Policy header is ' +
      'emitted (a full CSP is a separate report-only effort).',
    introducedInPhase: 21,
    reason:
      "The hardening headers are the wrapper's deliverable. Old-vs-new parity is " +
      'unaffected by construction (both dispatch arms flow through the one ' +
      'top-level wrapper, so captureBothModes sees identical header sets and no ' +
      'parity masking is needed); the visible contract change is against the ' +
      'pre-wrapper goldens, so every fixture under tests/server/fixtures/ was ' +
      're-pinned with the new header set in the same change. The log-only ' +
      'Content-Type 415 gate and cross-site Origin check, added alongside the wrapper, ' +
      'change no observable behavior (they pass every request through and only ' +
      'record mismatches) until their named enforce flags flip after the native ' +
      'traffic audit.',
    goldenFixtures: ['tests/server/fixtures/main/site_presence_get_405.json'],
  },
  {
    id: DEVIATION_ID.mapsAssetsRateLimitedBodyToCode,
    routes: [
      '/api/maps',
      '/api/maps/public',
      '/api/maps/:id',
      '/api/maps/:id/fork',
      '/api/maps/:id/publish',
      '/api/maps/:id/unpublish',
      '/api/assets',
      '/api/assets/:file',
    ],
    currentBehavior:
      'On throttle, the map editor legacy arms answer 429 { error: "rate_limited" } ' +
      '(application/json): every /api/maps mutation and the POST /api/assets upload check ' +
      'their fused ip+account bucket inline in server/main.ts, and the two public reads ' +
      '(GET /api/maps/public, the GET /api/assets byte read) plus the anonymous leg of ' +
      'GET /api/maps/:id check the tier-1 publicReadRateLimited bucket, each returning ' +
      'the same snake_case prose body.',
    intendedBehavior:
      'The v0.20.0 in-merge migration serves these routes through the new pipeline, where ' +
      'the throttle is a rateLimit(policy) middleware (MAP_MUTATION_POLICY / ' +
      'ASSET_UPLOAD_POLICY / PUBLIC_READ_POLICY) that throws HttpError(429, ' +
      '"rate_limit.exceeded", { retryAfterSeconds }); the error boundary serializes it as ' +
      'RFC 9457 application/problem+json with the stable code, the draft-11 headers, and ' +
      'Retry-After, instead of the bare { error: "rate_limited" } prose. The tier-1 buckets ' +
      'are SHARED with the legacy arms (the policies wrap the same ratelimit.ts functions), ' +
      'so limits land identically; only the 429 body shape and headers differ, plus EVERY ' +
      'policy-mounted lane (the mutations and upload included, not just the public reads) ' +
      'gains the pg tier-2 global backstop the legacy tier-1-only checks lack. The GET ' +
      '/api/assets/:file byte read keeps the surface-default problem+json ERROR envelope ' +
      '(its success body is binary but its meta sets no envelope, the POST /api/card ' +
      'precedent), so its coded 429 is problem+json like the rest of the family (pinned in ' +
      'user_assets_routes.test.ts). GET /api/maps/:id keeps its legacy CONDITIONAL ' +
      'anonymous-only prose throttle inside optionalViewerGuard on BOTH paths (a rateLimit ' +
      'mount would throttle authenticated owners too), so it is listed only for ' +
      'completeness of the family.',
    introducedInPhase: 24,
    reason:
      'Sibling to rateLimitedBodyToCode (the wallet/card entry): the same coded-' +
      '429 body-shape change, applied to the v0.20.0 map editor family at its in-merge ' +
      'migration. The 429 divergence is NOT exercised by the db-free parity corpus ' +
      '(runParity resets every limiter bucket before each pass), so it is documented here ' +
      'and unit-pinned in tests/server/maps_routes.test.ts / user_assets_routes.test.ts ' +
      'rather than harness-caught.',
  },
  {
    id: DEVIATION_ID.mapsAssetsIdParamDecode,
    routes: [
      '/api/maps/:id',
      '/api/maps/:id/fork',
      '/api/maps/:id/publish',
      '/api/maps/:id/unpublish',
      '/api/assets/:id',
      '/api/assets/:file',
    ],
    currentBehavior:
      'On the legacy handleApi ladder the map editor :id arms gate on \\d+ route regexes ' +
      '(mapIdMatch / mapPublishMatch / assetIdMatch), so a non-numeric :id matches no arm ' +
      'and falls through to the 404 unknown-endpoint arm without the bearer ever being ' +
      'read. On an owner-only mutation the ownership miss surfaces from the service SQL ' +
      'AFTER the body is read: an unowned PUT /api/maps/:id with a mid-stream over-cap ' +
      'body answers 413 (readBody trips first).',
    intendedBehavior:
      'The v0.20.0 in-merge migration mounts requireOwned on the owner-only :id routes ' +
      '(PUT/DELETE /api/maps/:id, publish/unpublish, DELETE /api/assets/:id), which ' +
      'decodes :id with num({ int: true, min: 1 }) BEFORE any DB call: a non-numeric or ' +
      'non-positive :id is rejected 422 (validation.failed) for an authenticated caller, ' +
      'and an unauthenticated bad-:id request 401s at the auth guard first. The owner ' +
      'loader also runs BEFORE the handler reads the body, so the unowned + over-cap-body ' +
      'shape answers the deny-by-default 404 instead of the legacy 413. The public-or-' +
      'owner :id routes (GET /api/maps/:id, POST fork, the GET /api/assets byte read) ' +
      'validate their param IN-HANDLER against the same shape the legacy regex enforced ' +
      'and answer the ladder terminal 404 { error: "unknown endpoint" } byte-identically ' +
      'once the handler runs; their DECODE carries no 422. Their GUARDS still run before ' +
      'that in-handler shape check, which the legacy regex fall-through never did, so ' +
      'three guard-before-shape-check legs diverge: (1) an unauthenticated non-numeric ' +
      'fork answers the auth 401 where legacy answered the terminal 404 without reading ' +
      'the bearer (pinned in maps_routes.test.ts); (2) an authenticated non-numeric fork ' +
      'consumes a map_mutation tier-1 token (and can answer the coded 429) where legacy ' +
      'never consulted the limiter for that shape; (3) an anonymous non-matching GET ' +
      '/api/maps/:id or GET /api/assets/:file consumes the shared public-read bucket ' +
      '(and can 429) before the terminal 404, where legacy answered it unthrottled.',
    introducedInPhase: 24,
    reason:
      'Sibling to characterIdParamDecode (same 422/401-vs-404 shape, same NaN-safe ' +
      'rationale, same harness-invisibility: the parity corpus replays numeric ids only). ' +
      'The loader-before-body ordering is the same deny-by-default posture the character ' +
      'rename route documents in characterBodyValidationRemap. Unit-pinned in ' +
      'tests/server/maps_routes.test.ts; becomes the real behavior when the legacy arm ' +
      'is removed.',
  },
];

// The phase window a scheduled deviation may name (phases 4 to 25 of the
// docs/api-pipeline/ packet numbering). A by-design deviation uses null instead.
export const DEVIATION_PHASE_MIN = 4;
export const DEVIATION_PHASE_MAX = 25;
