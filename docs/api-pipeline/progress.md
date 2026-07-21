# API Pipeline Re-Architecture: Progress Tracker

Status board for the 25-phase stacked PR chain that re-architects every JSON
endpoint on the authoritative game server behind one in-house request pipeline.
Canonical decisions live in the planning packet (see `state.md` / `README.md`).
NOTE (packet closure, 2026-07-05): the per-phase `phase-NN-<slug>.md` and
`phase-NN-qa.md` working documents this file narrates were removed when the packet
closed; find them in git history. This file and `state.md` are the durable record.

Mark a row's Status as "In progress" or "Done" and fill Started / Completed
(YYYY-MM-DD) as work lands. Keep deliverable and QA boxes in sync with the PR.

## Overall status

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 01 | Done | 2026-06-30 | 2026-06-30 |
| Phase 01 QA | Done | 2026-06-30 | 2026-06-30 |
| Phase 02 | Done | 2026-06-30 | 2026-06-30 |
| Phase 02 QA | Done | 2026-06-30 | 2026-06-30 |
| Phase 03 | Done | 2026-06-30 | 2026-06-30 |
| Phase 03 QA | Done | 2026-06-30 | 2026-06-30 |
| Phase 04 | Done | 2026-06-30 | 2026-06-30 |
| Phase 04 QA | Done | 2026-06-30 | 2026-06-30 |
| Phase 05 | Done | 2026-06-30 | 2026-06-30 |
| Phase 05 QA | Done | 2026-06-30 | 2026-06-30 |
| Phase 06 | Done | 2026-06-30 | 2026-06-30 |
| Phase 06 QA | Done | 2026-06-30 | 2026-06-30 |
| Phase 07 | Done | 2026-06-30 | 2026-06-30 |
| Phase 07 QA | Done | 2026-06-30 | 2026-06-30 |
| Phase 08 | Done | 2026-06-30 | 2026-06-30 |
| Phase 08 QA | Done | 2026-06-30 | 2026-06-30 |
| Phase 09 | Done | 2026-06-30 | 2026-06-30 |
| Phase 09 QA | Done | 2026-06-30 | 2026-06-30 |
| Phase 10 | Done | 2026-06-30 | 2026-06-30 |
| Phase 10 QA | Done | 2026-07-01 | 2026-07-01 |
| Phase 11 | Done | 2026-07-01 | 2026-07-01 |
| Phase 11 QA | Done | 2026-07-01 | 2026-07-01 |
| Phase 12 | Done | 2026-07-01 | 2026-07-01 |
| Phase 12 QA | Done | 2026-07-01 | 2026-07-01 |
| Phase 13 | Done | 2026-07-01 | 2026-07-01 |
| Phase 13 QA | Done | 2026-07-01 | 2026-07-01 |
| Phase 14 | Done | 2026-07-01 | 2026-07-01 |
| Phase 14 QA | Done | 2026-07-01 | 2026-07-01 |
| Phase 15 | Done | 2026-07-01 | 2026-07-01 |
| Phase 15 QA | Done | 2026-07-01 | 2026-07-01 |
| Phase 16 | Done | 2026-07-01 | 2026-07-01 |
| Phase 16 QA | Done | 2026-07-01 | 2026-07-01 |
| Phase 17 | Done | 2026-07-01 | 2026-07-01 |
| Phase 17 QA | Done | 2026-07-01 | 2026-07-01 |
| Phase 18 | Done | 2026-07-02 | 2026-07-02 |
| Phase 18 QA | Done | 2026-07-02 | 2026-07-02 |
| Drift audit (release merges) | Done | 2026-07-02 | 2026-07-02 |
| Phase 18b | Done | 2026-07-02 | 2026-07-02 |
| Phase 18b QA | Done | 2026-07-02 | 2026-07-02 |
| Phase 19 | Done | 2026-07-02 | 2026-07-02 |
| Phase 19 QA | Done | 2026-07-02 | 2026-07-02 |
| Phase 20 | Done | 2026-07-02 | 2026-07-02 |
| Phase 20 QA | Done | 2026-07-02 | 2026-07-02 |
| Phase 21 | Done | 2026-07-02 | 2026-07-02 |
| Phase 21 QA | Done | 2026-07-02 | 2026-07-02 |
| Phase 22 | Done | 2026-07-02 | 2026-07-02 |
| Phase 22 QA | Done | 2026-07-02 | 2026-07-02 |
| Phase 23 | Done | 2026-07-02 | 2026-07-03 |
| Phase 23 QA | Done | 2026-07-03 | 2026-07-03 |
| v0.20.0 release merge + audit | Done | 2026-07-03 | 2026-07-03 |
| Phase 24 | Done | 2026-07-03 | 2026-07-03 |
| Phase 24 QA | Done | 2026-07-03 | 2026-07-03 |
| Phase 25 | Done | 2026-07-03 | 2026-07-03 |
| Phase 25 QA | Done | 2026-07-04 | 2026-07-04 |
| Closeout review (whole branch) | Done | 2026-07-04 | 2026-07-04 |
| Phase 26 (closeout cleanup) | Done | 2026-07-04 | 2026-07-04 |
| Phase 27 (flip precondition, sink bound) | Done | 2026-07-04 | 2026-07-04 |
| Phase 28 (attack-signal RED metrics) | Done | 2026-07-05 | 2026-07-05 |
| v0.21.0 release merge + audit | Done | 2026-07-04 | 2026-07-04 |
| v0.22.0 release merge + audit (both passes) | Done | 2026-07-05 | 2026-07-05 |
| v0.22.0 release merge, third pass (abb89e725: terracing, tool effects, charselect CTA; audit clean, no server delta) | Done | 2026-07-05 | 2026-07-05 |

## Phase 01: Importable spine + WS-auth extraction (the gate, zero behavior change)

Deliverables:
- [x] Export startServer() and guard main.ts's module-load self-invoke (require.main === module, NOT import.meta) so the module imports without binding a socket
- [x] Lift authenticateWebSocket/onConnection/upgrade out of main() into an importable ws_auth module (createWsAuth(deps) factory mirroring the wallet_link/SocialService IO-pure split, not a one-line export)
- [x] Expose the createServer prefix dispatcher as a pure function (routeHttpRequest)
- [x] A smoke test that imports the module without booting

QA:
- [x] Fixes applied
- [x] Tests added (tests/server/ws_auth.test.ts 17 + tests/server/importable_spine.test.ts 1 = 18, all green)
- [x] Dead code removed (type WebSocket import narrowed out of main.ts)
- [x] Reviews clean (privacy-security-review: no findings; cross-platform-sync: NO WIRE CHANGE; qa-checklist: READY)

Notes:
- New surface: server/ws_auth.ts (createWsAuth(deps) -> { authenticateWebSocket, onConnection, attachUpgrade(server, wss) }); server/main.ts exports startServer(): Promise<http.Server> and routeHttpRequest(req, res). NO server/http/ spine module created (that is Phase 4+).
- Entrypoint guard: esbuild leaves import.meta EMPTY under format: 'cjs' (the bundle is the only launch path: npm run server / npm run realms both exec node dist-server/server.cjs), so the working guard is require.main === module, NOT the import.meta comparison drafted in the SPEC. Verified: build:server emits no import.meta warning; the bundled dist-server/server.cjs boots, serves GET /api/status -> 200, and stops cleanly on SIGTERM; a Vitest import() binds no socket and opens no DB connection.
- Cleanliness pass (per user request): the WS handshake wire vocabulary (rejection strings, the 1008 close + reason, leave reasons, the 10000ms timeout, the /ws path) lives in named constants (WS_AUTH_ERROR, TOO_MANY_CONNECTIONS_CLOSE, LEAVE_REASON, AUTH_TIMEOUT_MS, WS_UPGRADE_PATH) with a single rejectHandshake(ws, error) helper, no scattered magic literals. Wire VALUES byte-identical (the 18 tests assert literal frames). The HTTP prefix ladder is intentionally left inline; Phase 4 turns it into a route table.
- QA pass (phase-01-qa.md, 2026-06-30): 5 read-only auditors (correctness, test-coverage, dead-code, privacy-security-review, cross-platform-sync). 0 BLOCKING. cross-platform-sync verdict NO WIRE CHANGE (9 handshake frames + {t:hello} shape + 1008 close all byte-identical); privacy-security-review no CRITICAL/WARNING (check order, per-IP gate, and server authority preserved; the new console.error logs the SyntaxError not the raw token frame). Applied ALL findings (2 SHOULD-FIX + 4 nits, per user "apply everything so nothing accumulates"): strengthened the IP-gate test to assert the isConnectionRefused input bag and added real-predicate refuse + admin-bypass cases; added tests/server/route_dispatch.test.ts pinning routeHttpRequest (OPTIONS-204 short-circuit, public CORS '*', /internal + /admin/api prefix dispatch via mocked sub-dispatchers); added mutedUntil precedence/fallback, an accept-path socket-stays-open assertion, and a moderation-before-character order test; fixed the stale main().catch() comment (also clearing its em dash). The three server test files went 19 -> 28 tests. Full mirror gate green (572 files / 6033 tests, tsc, build:env, build:server, build); the bundled dist-server/server.cjs re-confirmed self-invoke -> listen -> GET /api/status 200 -> clean SIGTERM. NOTE (not a finding): main.ts carries PRE-EXISTING em dashes (dev comments + the player-facing rate-limit strings) that the SPEC defers to Phase 13/22 under a userFacingApiError matcher-lockstep constraint; left untouched on purpose.

## Phase 02: Shared test scaffolding harness (the phase the SPEC is missing)

Deliverables:
- [x] One faithful fake-http helper (FakeRes: setHeader/getHeader/getHeaders/removeHeader/headersSent/writableEnded/writeHead-merge/write/guarded-end + makeReq with node-faithful lower-cased headers) + a fakeCtx(overrides) producing the frozen Ctx (refactor-ready for Phase 5 buildContext) + a nextGuard() onion primitive
- [x] Inject a now() clock into ratelimit.ts (default Date.now) for deterministic window tests, threaded through every Date.now site; setRateLimitClock is production-guarded; behavior-preserving (no return-shape change; that rework is P19, and ratelimit_db.ts does not exist until P19)
- [x] An in-memory FakeRateLimitStore implementing the type-only RateLimitStore interface ({remaining,resetSeconds}) with the injected clock; mirrors recordSlidingWindowAttempt semantics
- [x] FakeDb (SocialDb-style injected-interface) for characters/leaderboard/reports with in-memory fakes + a type-only-import tsc drift guard that fails the build on signature drift (reports targets moderation_db.ts, where createPlayerReport actually lives)
- [x] A golden-master generator (write-then-compare, no manual-approve) + a separately-tested field-name-driven normalizer with an exported NORMALIZER_PLACEHOLDERS constant (timestamps, ids, tokens, reqId, Date header, expiry seconds, nonces/csrf)
- [x] A parity-harness driver (runParity) running each fixture through BOTH injected dispatchers in-process with per-pass isolation (every limiter bucket incl. the failed-login bucket + clock reset, plus an injected reset hook for the later fresh-ALS/reloaded-config steps)
- [x] Registry-introspection meta-test helpers (route completeness; :id requireOwned presence with operator AND publicRead exclusions)
- [x] A pure loadConfig(env) returning a frozen Config separate from the boot call site (parses the single API_DISPATCH flag; NOT wired into boot, that is P24)
- [x] Create the tests/server/ + tests/server/helpers/ + tests/server/http/ dirs and an index barrel; standardize tests/server/<domain>.test.ts (existing suites NOT converted)

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Notes:
- Shipped server/http/types.ts (TYPE-ONLY, zero runtime emit: RouteDef/RouteMeta/RequireOwned/OwnerScope/Ctx/CtxAccount/Method/Surface/EnvelopeKind/Middleware/Next/RateLimitStore + the Standard-Schema-v1 slot), server/http/config.ts (pure loadConfig), the server/ratelimit.ts clock seam, and tests/server/helpers/{fake_http,fake_ctx,fake_db,fake_ratelimit_store,normalizer,golden,parity,registry_introspect,index}.ts with self-tests, plus tests/server/ratelimit_clock.test.ts and tests/server/http/config.test.ts.
- Orchestration: lead wrote the frozen types.ts, then three parallel Agents (clock+store; fake-http+ctx; FakeDb+config) on disjoint files, then one Agent for golden/normalizer/parity/registry. All against the one frozen contract.
- In-phase reviewers (the two the phase doc requires): privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (3 nits), qa-checklist READY 0 BLOCKING / 2 SHOULD-FIX. Per the standing "apply every finding" directive, ALL were applied: production guard on setRateLimitClock; a meta.publicRead marker so public :id reads are not false-flagged (the Phase 10 exemption); resetAuthFailures added to the parity per-pass isolation (the failed-login bucket was bleeding); normalizer no longer over-masks the generic key 'state'; makeReq lower-cases header names. The golden mkdir/write nit was reviewed as intentional (test-only, author-controlled path), no change.
- Validation: tsc clean; tests/server 15 files / 120 tests; behavior-preservation (woc_balance/wallet_server/discord_server/security/ip_block + ratelimit_clock) 156 tests unchanged; full npm test 582 files / 6115 passed / 11 skipped; build:server/build:env/build green; ci:changed green (only pre-existing ws_auth noExplicitAny warnings). NO DDL, NO ensureSchema change, NO WS wire change, NO src/sim touch.
- QA pass (phase-02-qa.md, 2026-06-30): brief (Explore) + 8-way audit fan-out (4 correctness slices, test-coverage, dead-code, privacy-security-review, qa-checklist) + adversarial verify, then two gap re-runs (the clock-correctness slice degenerated to a stub and the privacy-security agent hit the StructuredOutput retry cap, so both were re-dispatched fresh). All 11 acceptance criteria verified PASS: types.ts type-only (compiles to just `export {};`), the clock seam threads all 5 former Date.now sites with a Date.now default + production guard and changes no return shape, FakeDb drift guard is a real compile-time `satisfies` over the live db.ts/moderation_db.ts signatures, the normalizer masks exactly the 7-token set (look-alike numerics untouched, generic `state` preserved), the parity driver isolates every limiter bucket + clock per pass, registry-introspect excludes operator/admin/publicRead :id routes, and loadConfig is pure/frozen/fail-fast/unwired. Security CONFIRMED: the clock cannot weaken a window in prod (NODE_ENV guard; Dockerfile sets NODE_ENV=production) and loadConfig never logs/leaks DATABASE_URL/TURNSTILE_SECRET/GITHUB_TOKEN and fails closed. 0 BLOCKING, 0 SHOULD-FIX. Per the standing "apply every finding" directive, all 3 in-scope NICE-TO-HAVEs were fixed (commits 54df58b0 named DEFAULT_SITEMAP_LIMIT in fake_db.ts; 6707ee2d dropped the dead updated.length>0 branches in FakeRateLimitStore.hit; 0d08e73b added a dedicated default-clock no-op assertion to ratelimit_clock.test.ts, taking it 6 -> 8 cases). Two security NICE-TO-HAVEs are deferred to their wiring phase (Config returns secrets as plain fields: when a later phase calls loadConfig(process.env) at boot, guard against console.log(config)/error-serialization dumping them, e.g. a redacting toJSON; resetRateLimitClock has no NODE_ENV guard, which is correct since it only restores Date.now). Re-validated: tsc clean; full npm test 582 files / 6117 passed / 11 skipped; build:server/build:env/build green; ci:changed clean (pre-existing ws_auth warnings only).

## Phase 03: Surface re-inventory, content-type classification + characterization/golden corpus

Deliverables:
- [x] Re-derive every endpoint against HEAD by SYMBOL anchor (never line numbers); route-count freshness gate test (tests/server/http/surface_inventory.ts + surface_inventory.test.ts). 106 inventory rows across the four dispatchers + the OPTIONS-204 preflight; the gate reads the four dispatcher SOURCE files and asserts set-equality (75 exact `=== '<path>'` arms + 18 `*Match` :param regex sources), with a vacuous-pass guard, so a route added/removed in source without an inventory edit hard-fails.
- [x] Classify the /api surface into the 5 named content-type classes (content_type_classification.ts): PROBLEM_JSON, HTML (discord/callback ONLY), BINARY (card request body), LEGACY_OKFALSE_405 (perf-report + site-presence), REDIRECT. CORRECTION to the plan: the Discord callback is HTML (a 200 text/html bounce page with client-side location.replace), NOT a 302 REDIRECT; REDIRECT therefore maps to ZERO routes today (defined for taxonomy completeness, asserted unused). Every /api path carries exactly one class; the completeness gate fails on any unclassified /api path. QA CORRECTION: account/email/verify and email/unsubscribe were initially classed HTML but both handlers answer application/json in every branch (the captured email/unsubscribe golden is application/json), so QA reclassified both to PROBLEM_JSON; the HTML class now maps to exactly one /api route, /api/auth/discord/callback.
- [x] Characterization golden corpus (characterization.test.ts + characterization_admin_oauth_internal.test.ts + 57 fixtures under tests/server/fixtures/{main,admin,oauth,internal}) over the four dispatchers, captured by replaying routeHttpRequest (the Phase 1 spine) through the Phase 2 goldenMaster + normalizer. Byte-stable across runs. Covers the contract/error paths (404 unknown-endpoint, 405 method-ownership, 401 auth-before-method, 413 pre-auth oversize, 503 unconfigured, 204 preflight, the 4 leaderboard query-forks, the 4 Discord /api routes, dev-gated /api/perf, both internal secret gates). DB/network-backed SUCCESS bodies are DEFERRED (documented deferral ledgers) to avoid blessing a pool-less-500 or a dynamic-token golden; later phases mock the db and pick these up.
- [x] knownDeviation list seeded (known_deviations.ts + known_deviations.test.ts): 12 entries, each tagged introducedInPhase (4 to 25) or null (by-design, preserved). Test cross-checks every deviation route exists in the inventory, every phase is null or in [4,25], ids are unique, and every listed goldenFixtures path exists on disk.

QA:
- [x] Fixes applied (3 em dashes in a test comment removed; the as-const arrays annotated `readonly T[]` so tsc passes; biome golden-dir ignore added for tests/server/fixtures, mirroring tests/parity/golden)
- [x] Tests added (4 new test files, 73 tests, byte-stable across two runs)
- [x] Dead code removed (N/A: net-new test-only deliverable)
- [x] Reviews clean (privacy-security-review CLEAN: secret gates reject, no token/secret/PII in any fixture, no defect blessed as by-design; qa-checklist READY: freshness gate is not a tautology, no runtime/i18n change, 3 by-design NITs)

Notes:
- ZERO runtime change: the diff is tests/server/http/*.ts + tests/server/fixtures/** + a one-line biome.json golden-dir ignore + these docs. `git diff --name-only` shows no server/ runtime and no src/.
- Validation: `npx tsc --noEmit` clean; the 4 new test files pass (73/73, twice, byte-stable); biome clean on changed files (only pre-existing ws_auth/main noExplicitAny warnings); `npm run build:server` unaffected.
- Surfaced (out of Phase 3 scope, do NOT fix here): (1) Discord callback is HTML not a 302 (corrects the error-model + classification plan; affects Phase 7 mapError and Phase 16). (2) A pre-existing em dash in server/oauth.ts renderDevicePage player-facing HTML (a copy-rule violation in server SOURCE; blocks the GET /oauth/device success golden, deferred; fix when oauth migrates in Phase 18 or as a standalone copy fix). (3) The token-bearing discord callback SUCCESS bounce + the OAuth token-mint/device-authorization SUCCESS bodies embed dynamic tokens the key-name normalizer cannot mask (snake_case device_code/user_code, HTML-embedded token); a candidate Phase 2 normalizer enhancement (snake_case + HTML-body token masking), surfaced not applied.
- By-design NITs (no change warranted, reviewed): the static/SSR createServer prefix routes (/p/*, /avatar/*, /c/*, sitemap) stay on the top-level ladder (Phase 21) outside the 5-class /api scheme, documented in the inventory header; the freshness gate scans the `=== '<path>'` + `*Match` dispatch idioms (every current route uses one), documented; the deferred db/network success-path goldens are by-design (pool-less determinism).

QA VERDICT (Phase 03 QA, 2026-06-30): PASS-WITH-FOLLOWUPS. Brief + 5-way audit fan-out (correctness, test-coverage, dead-code, privacy-security-review, qa-checklist). 1 BLOCKING + 3 SHOULD-FIX + nits, all fixed; deferred follow-ups recorded. No golden blessed a security defect (privacy-security CLEAN on the contract: secret gates reject, anti-enumeration 401 frozen, no token/secret/PII in any fixture body). Fixes landed (commits 69b9129d, 0cd9c3a7, cf4832e3):
  - BLOCKING: account/email/verify + email/unsubscribe were misclassified HTML but emit application/json; reclassified to PROBLEM_JSON (map + inventory rows). Added content_type_consistency.ts, a cross-check that resolves each captured golden to its route's class and asserts the response content-type is consistent, wired through both characterization files so a class/golden content-type contradiction can never pass green again.
  - SHOULD-FIX (de-binarize): surface_inventory.test.ts had three raw NUL (0x00) bytes as dedup-key delimiters, making git/biome/file(1) treat the safety-net test as binary (no line-level diff) and letting biome --write rewrite them to U+FFFD; escaped to U+0000 (identical runtime keys, ASCII source).
  - SHOULD-FIX (freshness granularity): the gate compared path SETS, so a new method on an existing path slipped through; added a method-aware subset guard.
  - SHOULD-FIX (coverage): added a golden for GET /api/account/email/verify (no token -> 400 JSON, pins the JSON content-type); added GET /api/register + POST /api/me/characters wrong-method 404 baselines wired into the planned405BeforeAuth deviation's goldenFixtures (Phase 4 anchor).
  - NIT: captured the /internal/discord/* secret-unset 404 feature-off gate per route (all 8, mirroring the 401 loop); DRYed the admin/oauth/internal goldenMaster boilerplate into one characterize() wrapper.
  - Corpus grew 57 -> 67 fixtures; suite 73 -> 84 tests, byte-stable across two runs; tsc clean, biome clean on changed files, ci:changed exit 0, build:server unaffected; full tests/server 196/196.
  - DEFERRED follow-ups (out of Phase 3 scope, require later infrastructure, flagged by privacy-security-review): (a) the token-bearing SUCCESS goldens (Discord callback bounce, OAuth authorize/device_authorization/token) need the surfaced Phase 2 normalizer enhancement (snake_case device_code/user_code + HTML-embedded session-token masking) BEFORE the Discord/OAuth migrations (Phase 16/18), so the token-delivery contract is frozen pre-migration. (b) The BOLA cross-account 404 and the register taken-username 409 anti-enumeration contracts are asserted only in deviation prose today; capture them as authenticated goldens once a db-mocking harness lands.

## Phase 04: Table router (server/http/router.ts)

Deliverables:
- [x] Map<method,{static:Map,dynamic[]}>, O(1) static match, :param capture with no per-request regex
- [x] 404-vs-405 + Allow, HEAD-for-GET, synthesized OPTIONS from the real method set, single-trailing-slash normalization (convention H), Vary:Origin
- [x] A no-regex-routing guard asserting every pattern is literal segments or a plain :param

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Notes:
- New modules (both PURE, server-only, not wired into the live server until Phase 9; the
  module-first split is the pure helper + its thin consumer):
  - `server/http/path_pattern.ts`: `compilePattern` (the no-regex routing guard), `normalizePath`
    (single trailing slash, root preserved, no internal-slash collapse / no percent-decode / no
    ".." resolution), `matchPattern` (segment-count then string-equality, no per-request regex);
    plus the `HttpMethod` (an ALIAS of the canonical `Method` from server/http/types.ts, not a
    second source of truth), `PatternSegment`, `CompiledPattern` types.
  - `server/http/router.ts`: `createRouter(routes)` over a `Map<HttpMethod,{static:Map,dynamic[]}>`,
    returning the discriminated `MatchResult` union (`matched` with params + `head`,
    `methodNotAllowed` with a sorted Allow, synthesized `options`, `notFound`). HEAD maps to GET;
    OPTIONS is synthesized from the real method set; the Allow set always includes synthesized
    OPTIONS and (when GET is present) HEAD, ordered by a complete `METHOD_ORDER` map.
  - Tests: `tests/server/http/path_pattern.test.ts` + `tests/server/http/router.test.ts` (55 tests).
- The router is a PURE match function: it returns descriptors, never writes a header/response/
  envelope. The 405/404/OPTIONS WRITES + the Vary:Origin header are the Phase 9 dispatcher's job;
  the error bodies are Phase 7's. The honest 405+Allow is default; the anti-enumeration
  404-instead-of-405 override on auth routes is applied by Phase 9 from an explicit list, never here.
- The no-regex guard REJECTS the admin enum-alternation route
  `/admin/api/moderation/accounts/:id/(suspend|unsuspend|ban|unban)` (the only such route in the
  Phase 3 inventory), which is what forces it to restructure to `:param` + schema in Phase 17.
- DECISIONS beyond the literal contract (sound, recorded for Phase 9): registering HEAD/OPTIONS is
  rejected (they are synthesized, so a HEAD-only route is intentionally inexpressible; the inventory
  has none); the duplicate guard rejects same-SHAPE patterns (so `/a/:x` vs `/a/:y` throw, not just
  textual dups), and reserved param names (`__proto__`/`constructor`/`prototype`) are rejected at
  compile time.
- Validation green: tsc clean; the two http files 55 tests pass; full `npm test` 611 files / 6411
  pass; build:env/build:server/build all exit 0; Biome on changed files clean; ASCII-clean (no
  em/en dashes, no emojis). Reviewers (privacy-security-review, qa-checklist, fresh coverage
  subagent): 0 BLOCKING; all SHOULD-FIX + NIT findings applied (per the apply-all-findings rule).
  Forward/cross-seam notes recorded in state.md for Phase 9. Next: Phase 04 QA (phase-04-qa.md).

QA (phase-04-qa.md) verdict: PASS. 0 BLOCKING. Audited by a context Explore agent + 4 parallel
reviewers (correctness, test-coverage, dead-code, privacy-security-review): correctness 0 findings
(all 21 acceptance criteria verified against the real code), dead-code 0 findings, privacy-security
PASS (routing-bypass safe-by-contract, 405+Allow Phase 9-overridable, ReDoS-safe by construction,
no prototype-pollution path), test-coverage found 1 SHOULD-FIX + 3 NIT coverage gaps (no code
defects). All applied (apply-all-findings rule):
- SHOULD-FIX (coverage): a 405 reached through a dynamic/param route under a wrong real method was
  asserted nowhere (every methodNotAllowed test used a static path). Added the canonical
  wrong-method-on-a-resource test (`POST /api/characters/42` with GET+DELETE `:id` -> 405 Allow
  `[GET, HEAD, DELETE, OPTIONS]`).
- NIT (coverage): multi-param capture (`/a/:foo/b/:bar` -> `{foo,bar}`); PUT and PATCH positions in
  METHOD_ORDER (never exercised before) pinned via a GET/PUT/PATCH/DELETE Allow assertion; a
  structural server-only PURITY test (criterion 16) over both source files asserting they import
  nothing parent-relative (`../`) or `node:` (the no-req/res half is tsc-guaranteed by the
  signatures).
- HARDENING (privacy NIT, defense-in-depth): `matchPattern` now builds the captured-params bag with
  `Object.create(null)` so the returned params object has no inherited `Object.prototype` keys (the
  real prototype-pollution path was already closed by the compile-time reserved-name guard). Pinned
  by a null-prototype assertion. `toEqual` is prototype-insensitive, so existing capture assertions
  are unaffected.
- DEFERRED to Phase 9 (privacy NIT, not a router defect): a catch-all leading-`:param` dynamic route
  registered before a specific route could shadow a route carrying a `requireOwned` BOLA loader
  (cross-shape dynamic overlaps resolve first-registered, by design). Recorded as a Phase 9 registry
  obligation in state.md (order specific dynamic routes first; add an introspection check that no
  overlapping dynamic shape leaves a `requireOwned` route shadowed by a non-owned one).
- Re-validation after the 5 added tests + the 1-line hardening: tsc clean; the two http files 60
  tests pass; full `npm test` 611 files / 6420 pass / 11 skip; build:env/build:server/build all exit
  0; Biome on the 3 changed files clean; ASCII-clean. Next: Phase 05 (onion compose + request
  context, phase-05-onion-context.md).

## Phase 05: Onion compose + request context (compose.ts + context.ts)

Deliverables:
- [x] compose(Mw[]) recursive dispatch with a double-next guard
- [x] Ctx type + buildContext (url, query, params, ip via requestIp(), reqId, body?, account?)
- [x] An AsyncLocalStorage carrier for reqId
- [x] An outermost wrapper contract: the top-level compose(ctx) call is wrapped to guarantee exactly one idempotent response on both the resolve and throw paths (raw node:http does not auto-respond)

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Notes:
- New modules (both server-only, NOT wired into the live server until Phase 9; no
  `server/http/index.ts` barrel created, Phase 9 owns it):
  - `server/http/compose.ts`: `compose(stack)` (the canonical Koa onion dispatch with a
    `lastIndex`-cursor double-next guard that rejects with `'next() called multiple times'`,
    the exact string the Phase 2 `nextGuard` uses), `runOnion(ctx, stack)` (the OUTERMOST
    wrapper: runs the composed stack inside `runWithReqId(ctx.reqId, ...)`, then guarantees
    exactly one response), and `respondOnce(res, status, headers?, body?)` (the
    headersSent/writableEnded-guarded idempotent low-level sender, exported for reuse). It
    imports `Ctx/Middleware/Next` from `./types` and `runWithReqId` from `./context`; it does
    NOT redefine or re-export the frozen types, and there is no import cycle (context never
    imports compose).
  - `server/http/context.ts`: `buildContext(req, res, match)` producing the frozen `Ctx`
    (`Ctx` has NO `route` field, so the match is read ONLY for `params`); reuses
    `ratelimit.requestIp` for `ctx.ip` (never re-derives IP); `query` and the non-matched
    `params` are built on `Object.create(null)`. Plus the reqId carrier:
    `reqIdStorage` (AsyncLocalStorage<string>), `newReqId` (crypto.randomUUID, a server-side
    id, NOT sim randomness), `runWithReqId`, `currentReqId`.
  - Tests: `tests/server/http/compose.test.ts` (17) + `tests/server/http/context.test.ts`
    (20). The Phase 2 `tests/server/helpers/fake_ctx.ts` was left UNTOUCHED (it already
    returns a valid frozen Ctx with deterministic test defaults; a context test asserts
    `buildContext` and `fakeCtx` produce the same own-key set rather than re-pointing the helper).
- LOAD-BEARING: `compose()` neither responds nor catches. Raw node:http hangs the socket on an
  uncaught throw, so `runOnion`'s one-response wrapper is mandatory. The fallbacks emit NO body
  and NO internal detail (no stack/SQL/table/English): the catch arm uses `catch {` with no
  binding so the thrown value is never read. The real RFC 9457 envelope is Phase 7; `withErrors`
  is Phase 8 and sits INSIDE this wrapper later. Fallback statuses are named consts:
  resolve-with-no-response = 404 (a distinct structural fallback), uncaught-throw = 500; both
  carry `X-Request-Id` from `ctx.reqId` (the echo-on-every-response middleware is Phase 8/23).
- Validation green: tsc clean; the two http files 37 tests pass; `npm run ci:changed` exit 0
  (no warnings on the 4 files); build:env/build:server/build all exit 0; full `npm test` green;
  ASCII-clean (no em/en dashes, no emojis). Reviewers (privacy-security-review, qa-checklist,
  fresh coverage subagent): 0 BLOCKING, 0 SHOULD-FIX-correctness; all findings applied (apply-all
  rule), see the QA section. Next: Phase 05 QA (phase-05-qa.md).

QA (reviewers) verdict: PASS. 0 BLOCKING. Audited by privacy-security-review + qa-checklist + a
fresh coverage subagent (each told to report COVERAGE, not filter). qa-checklist and coverage
returned PASS with every acceptance criterion met by a regression-sensitive test; privacy returned
2 SHOULD-FIX (forward-looking) + nits. All applied (apply-all-findings rule):
- SHOULD-FIX (privacy, host-injection): `new URL(req.url, base)` adopts a CLIENT-supplied host on
  an absolute-form target (`GET http://evil.com/api/foo`), seeding a foreign authority into the
  frozen `ctx.url` that a later phase could trust for a redirect Location / same-origin check.
  Fixed with a `buildUrl(target)` helper that rebuilds the URL from path + search ONLY, pinning the
  authority to the placeholder. Pinned by a new test (absolute-form -> `ctx.url.host` stays localhost).
- SHOULD-FIX (privacy, totality): `new URL` throws on a malformed target, and `buildContext` runs
  OUTSIDE `runOnion`'s safety net, so a throw there would hang the socket once Phase 9 wires it.
  `buildUrl` now catches and falls back to the root path, keeping `buildContext` total. Pinned by a
  malformed-target (`http://`) test asserting no throw.
- NIT (privacy, totality) + the qa/coverage partial-response observation: the catch-path
  `respondOnce` was itself unguarded, and a middleware that committed headers but never ended would
  hang the socket. Replaced both inline fallbacks with a `finalizeResponse(ctx, status)` helper that
  (1) no-ops when already ended, (2) sends the bare fallback when nothing was committed, (3) `end()`s
  a headers-committed-but-unended response to close the socket, and swallows a throw from an unusable
  (destroyed-socket) response so `runOnion` never throws out of its own net. Two new tests assert the
  socket is ended on both the throw and resolve partial paths.
- NIT (qa/coverage, coverage): added an empty-stack `compose([])` test and a `respondOnce` Buffer-body
  test; named the `'GET'`/`'/'` buildContext default literals (`DEFAULT_METHOD`/`DEFAULT_REQUEST_PATH`).
- KEPT with rationale: the 404 no-response fallback (the spec deliberately calls it a distinct "bare
  fallback", and both reviewers judged 404 defensible / 500-vs-404 a non-blocking discussion item);
  the `(req.method ?? 'GET').toUpperCase() as Method` cast (the router is the method gate before Phase
  9 wiring; node delivers methods uppercase; documented in a comment, no actionable improvement without
  unfreezing `Method`).
- Re-validation after the fixes + 5 added tests: tsc clean; the two http files 37 tests pass; full
  `npm test` green; build:env/build:server/build all exit 0; Biome on the 4 changed files clean;
  ASCII-clean. Next: Phase 05 QA (phase-05-qa.md).

QA (phase-05-qa.md) verdict: PASS-WITH-FOLLOWUPS-RESOLVED. Audited by a context Explore pass + 4
parallel auditors (correctness, coverage, dead-code, privacy-security-review) each adversarially
re-verified by an independent skeptic (9 raw -> 6 confirmed, 1 refuted). 1 BLOCKING defect (counted
twice, code + masking test), 2 SHOULD-FIX, 2 NIT, all applied (apply-all-findings rule):
- BLOCKING (privacy, buildUrl): the in-phase host-injection fix was INCOMPLETE. Rebuilding via
  `new URL(parsed.pathname + parsed.search, PLACEHOLDER_ORIGIN)` still adopts a CLIENT host for a
  plain origin-form target whose normalized path begins with `//`: `/..//evil.com` collapses to
  `//evil.com`, which the second `new URL` re-reads as a protocol-relative AUTHORITY, so
  `ctx.url.host` becomes `evil.com` (and `/..//evil.com:8443/x` -> `evil.com:8443`). Verified
  empirically. The absolute-form-only pinning test masked it (its path was the safe single-slash
  `/api/foo`). Fixed by ASSIGNING `url.pathname`/`url.search` onto a fresh fixed-authority `URL`
  object (the setters cannot move the authority); host stays `localhost` for every `//`, backslash,
  encoded-slash, and userinfo vector tested. Pinned by two new regression tests that fail on the old code.
- SHOULD-FIX (coverage, compose sync-throw): the existing sync-throw test put the thrower at index 1
  behind an async parent, so it passed even with compose's entry-frame try/catch removed; its inline
  comment claimed otherwise. Corrected the comment and added a test that a FIRST middleware throwing
  synchronously yields a rejected promise, not a synchronous throw (the only case that exercises the guard).
- SHOULD-FIX (coverage, finalizeResponse net): the catch-swallow branch ("runOnion must never throw
  out of its net") was dead across the suite. Added a test injecting a res whose writeHead/end throw
  while writableEnded is false (a destroyed socket); runOnion must still resolve.
- NIT (coverage): added a clean short-circuit test (a middleware resolves WITHOUT calling next();
  downstream never runs) and a runOnion test where an inner middleware ends the response and an outer
  one then throws (the writableEnded early-return on the throw path keeps the 200, no 500 clobber).
- NIT (dead-code, comments): reconciled the Phase 7 vs Phase 8 attribution in compose.ts (the RFC 9457
  envelope and codes are Phase 7; the withErrors middleware that emits them is Phase 8).
- REFUTED: "double-next is only exercised from the outermost frame" - the guard (`i <= lastIndex`,
  one monotonic closure var) is frame-agnostic, so a deeper-frame case would re-assert identical logic.
- Re-validation: tsc clean; the two http files 43 tests pass (was 37, +6); full `npm test` green;
  build:env/build:server/build all exit 0; Biome on the 4 changed files clean; ASCII-clean.
  Next: Phase 06 (typed schema validator, phase-06-schema-validator.md).

## Phase 06: Typed schema validator (schema.ts)

Deliverables:
- [x] object()/str()/num()/bool()/enum_()/optional() decoders conforming type-only to the Standard Schema v1 ~standard shape (imported from the frozen types.ts, NOT a new standard_schema.ts)
- [x] All-issues-in-one-pass collection yielding issues[]{pointer,code,params} as stable CODES, never English
- [x] Infer<typeof S> so handler input types derive from the schema (no parallel interface)
- [x] Typed params AND query (a :id cannot reach a DB call as NaN; page/pageSize bounded once)

QA:
- [x] Fixes applied (3 SHOULD-FIX + the actionable NITs from the correctness/security review, all applied)
- [x] Tests added (37 in tests/server/http/schema.test.ts: runtime + tsc-checked type-level)
- [x] Dead code removed (none introduced; module is the minimal combinator set)
- [x] Reviews clean (privacy-security 0/0, qa-checklist 0/0, adversarial-correctness 0 BLOCKING)
- [x] Dedicated QA gate (phase-06-qa.md) PASS: 0 BLOCKING, 1 SHOULD-FIX + 3 NIT all applied (all test-coverage)

Notes:
DONE + QA DONE (2026-06-30). New module `server/http/schema.ts` (150 code lines, under the ~150 cap;
zero new deps) + tests. Surface: `Issue {pointer, code, params?}`, `DecodeResult<T>` (`{ok,value}` |
`{ok:false,issues}`), `Schema<T> extends StandardSchemaV1<unknown,T>`, `Infer<S>`; combinators
`object/str/num/bool/enum_/optional(schema, default?)`; stable codes `type|required|min|max|int|
minLength|maxLength|enum`. decode() collects ALL field issues in one pass; `object()` reads ONLY
declared keys (via `Object.hasOwn`) into a null-proto object, so an input `__proto__`/`constructor`
key cannot pollute a prototype. `num()`/`bool()` coerce strings (params/query arrive as strings).
TWO doc-vs-code reconciliations (the phase doc text was stale; both match state.md's canonical plan):
(a) NO new `server/http/standard_schema.ts` - Standard Schema v1 is already vendored in the
Phase-2-frozen `server/http/types.ts` ("the SINGLE home ... Phases 4 to 9 import, never redefine"),
so schema.ts IMPORTS `StandardSchemaV1`/`StandardSchemaProps`/`StandardSchemaResult`/
`StandardSchemaIssue` from `./types`. (b) NO `server/http/index.ts` barrel added - none exists; the
barrel is the Phase 09 deliverable, so schema.ts is consumed by direct extensionless imports.
The `~standard` conformance is type-only; the runtime `~standard.validate` is a thin sync adapter
over decode() that still emits CODES (`message = issue.code`, never English).

Review verdict: 3 reviewers (privacy-security-review, qa-checklist, adversarial-correctness), 0
BLOCKING. The correctness pass found 3 SHOULD-FIX, all applied as a deliberate input-boundary
HARDENING beyond the minimal contract (decided in QA, documented for Phase 10+ callers):
- `num()` string coercion is now CANONICAL DECIMAL only (a `DECIMAL` regex, anchored/ReDoS-safe):
  hex/octal/binary/scientific strings (`'0x10'`->was 16, `'1e3'`->was 1000) are rejected with code
  `type`, so a string `:id` never decodes to a surprising value. Still contract-compatible ("coerce
  a string, reject NaN"); body numbers (real `number`) are unaffected.
- `num({ int })` now requires `Number.isSafeInteger` (was `isInteger`), so two distinct id strings
  past 2^53 can no longer alias to the same number (rejected with code `int`).
- `optional(schema, default)` CLONES an object/array default per decode (`structuredClone` for a
  mutable default), so a mutable default is never shared by reference across requests.
Plus NITs applied: `object()` output is null-proto (`Object.create(null)`, defense-in-depth matching
the spine's params/query idiom); `bool()` trims string input for parity with `num()`; and added
coverage (falsy bounds `min:0`/`max:0`/`maxLength:0`, `-Infinity`, non-decimal rejection, both
`int`+`min` collected in one pass, present-but-invalid optional inside an object, a nested +
`optional(object())` Infer assertion, case-sensitive enum, the object-default non-aliasing proof,
and an explicit-pointer decode). Deferred (correctly OUT of scope): code->HTTP-status + problem+json
(P7), the `withBody`/validate middleware that calls decode() (P8), RouteDef.schema wiring + registry
(P9), concrete page/pageSize bounds + the {items,...} envelope (P10), the client i18n matcher (P22).
Validation: tsc/biome(ci:changed)/build:server all green; `tests/server/http/` 229 pass (schema 33);
full ASCII-clean.

Phase 06 QA gate (phase-06-qa.md, dedicated adversarial pass, 2026-06-30): PASS. A 4-auditor fan-out
(correctness, test-coverage, dead-code, privacy-security) plus per-finding adversarial verify found
0 BLOCKING and CONFIRMED 1 SHOULD-FIX + 3 NIT, all TEST-COVERAGE gaps; the implementation itself was
re-verified defect-free (no schema.ts change). The correctness and security auditors confirmed every
STEP 5 criterion against the real code; 3 further findings were REFUTED on verification (a redundant
params-survival assertion, and two subjective dead-code simplifications: the makeDefault-vs-base-decode
duplication and the one-pass-return rule-of-three, both judged non-defects not worth churning correct
code). The 4 confirmed test additions (commit, +4 tests -> schema 37):
- SHOULD-FIX: object()'s makeDefault() clone path for an absent optional field is a SECOND clone site
  separate from optional().decode(undefined); only the latter was tested, so dropping the object-path
  clone (schema.ts:217) would pass all 33 tests yet share one mutable default across decodes (per-request
  cross-mutation bleed). Added a mutable-default non-aliasing test through the object path.
- NIT: assert the null-prototype output construction (Object.getPrototypeOf === null), which no test
  pinned (a refactor to a plain `{}` literal would still pass, since declared-keys-only already neutralizes
  __proto__ input).
- NIT: assert `~standard.validate` converts a MULTI-segment pointer to a nested path array
  (['parent','child']); only [] and ['id'] were covered.
- NIT: prove the second clause of the pollution invariant (a SHAPE that itself declares a `__proto__`
  key, via a computed key) cannot pollute Object.prototype.
Re-validation after the test hardening: tsc/biome(ci:changed)/build:server all green; `tests/server/http/`
233 pass (schema 37); full ASCII-clean. Next: Phase 07 (RFC 9457 error model + error_codes catalog,
phase-07-error-model.md).

## Phase 07: RFC 9457 error model + per-surface serializers + error_codes catalog

Deliverables:
- [x] HttpError(status,code,params?,headers?) + toAppError: malformed-JSON->400, validation->422 (ALL issues one pass), missing/invalid token->401(+WWW-Authenticate), no-entitlement->403, over-cap->413, unique-violation(23505)->409, rate-limited->429(+Retry-After), unknown->onUnexpected-500 with no stack/SQL/table text
- [x] Per-SURFACE serializer selection (problem+json / RFC 6749 oauth / admin {success,data,error} / HTML-error / redirect 302 / binary text/plain / ok_false 405), by the route error-surface tag NOT per-prefix, resolving the non-JSON /api classification
- [x] error_codes.ts as the single as-const source of truth, deep-frozen (domain.reason) + param keys append-only per AIP-193, reusing the existing userFacingApiError vocabulary

QA:
- [x] Fixes applied (2 SHOULD-FIX + the actionable NITs from privacy-security-review + qa-checklist, all applied; 1 nit declined with documented rationale)
- [x] Tests added (91 across the 3 files: 9 error_codes + 46 errors + 36 leak; was 85, +6 in review hardening)
- [x] Dead code removed (folded the duplicated isUnexpected() branch enumeration into a single AppError.unexpected flag)
- [x] Reviews clean (privacy-security-review 0 BLOCKING, qa-checklist READY/0 BLOCKING)

Notes:
DONE + QA DONE (2026-06-30). Two new spine modules, zero new deps, wires NO routes (Phase 8 calls
mapError; Phase 22 localizes the codes). `server/http/error_codes.ts` (140 lines): a deep-frozen
`as const` ERROR_CODES catalog, `ErrorCode = keyof typeof ERROR_CODES`, 48 codes (9 structural + 39
harvested). `server/http/errors.ts` (392 lines): `HttpError(status, code, params?, headers?)`,
`toAppError(err): AppError` (the exhaustive status table), `normalizeSurface(EnvelopeKind|ErrorSurface)`,
seven per-surface serializers, `mapError(err, ctx, opts?): {status, headers, contentType, body}` that
RETURNS the shape (does not write ctx.res). Orchestrated as 1 Explore (context) + 3 parallel writers
(A catalog, B errors, C leak test) against a locked contract, then 2 reviewers.

Key facts that corrected the phase brief (from the Explore pass): (a) Ctx has NO `route`/`envelope`
field (Phase-5-frozen), so mapError reads the surface from `opts.surface` (the route `EnvelopeKind`
tag), defaulting to 'problem'; Phase 8's withErrors will pass it from the matched RouteDef. (b)
schema.ts has NO ValidationError class and decode() never throws; it returns `{ok,value}|{ok:false,
issues:Issue[]}`, so a 422 normally arrives as an HttpError Phase 8 builds, and toAppError also
defensively recognizes a raw `{ok:false, issues}`. (c) the Discord callback is HTML not a 302, so the
REDIRECT class maps to ZERO live routes today (the 'redirect' serializer is defined for completeness).
(d) the card 413 is application/json + Connection:close today; the 'binary' serializer is the new
minimal text/plain form (binary is NOT in the stay-as-today set).

Seeded codes: the 9 structural (validation.failed[issues], json.malformed, auth.token_missing,
auth.token_invalid, auth.forbidden, body.too_large[maxBytes], db.conflict, rate_limit.exceeded
[retryAfterSeconds], internal.error) + 39 harvested domain.reason codes reconciled 1:1 to the existing
userFacingApiError identities (auth.*, account.*, character.*, moderation.*, email.*, two_factor.*).
The ONLY parametric harvested code is moderation.suspended_until[date]. Each harvested code carries an
`// identity:` comment naming its English source string for the Phase 22 client matcher.

Review verdict: privacy-security-review 0 BLOCKING (the 500-no-leak hard gate holds on all 7 surfaces;
redirect Location is a fixed encoded /error?code=; no open-redirect; auth/status/header semantics
correct). qa-checklist READY, 0 BLOCKING. Applied: (1) SHOULD-FIX serializeProblem now spreads
`...params` FIRST so an RFC 9457 reserved member (notably `code`, the localization key) can never be
shadowed by a future catalog param; (2) SHOULD-FIX documented the intentional breadth of the
SyntaxError->400 arm + the Phase 8 narrowing plan (withBody rethrows HttpError(400) so stray internal
SyntaxErrors fall to the 500+onUnexpected branch); (3) NIT unified the unexpected-500 decision into a
single AppError.unexpected flag (deleted isUnexpected, removing the lockstep duplication); (4) NIT
added tests (params-in-body maxBytes/retryAfterSeconds/date, the reserved-key shadow regression,
case-insensitive header non-overwrite, non-auth-401 WWW-Authenticate skip, the unexpected-flag
semantics). DECLINED with rationale: broadening WWW-Authenticate to all 401s (privacy nit) - it is
applied surface-agnostically in toAppError and a Bearer challenge is only meaningful on the bearer
API surface, not on oauth/admin 401s; a route needing another RFC 7235 challenge sets its own header.

Validation: tsc clean; the 3 new files 91 tests pass; full tests/server/http 324 pass (was 318);
S3 guard (localization_fixes.test.ts) 27 pass/3 skip (unchanged; server matcher untouched, Phase 22
owns the REST code-parity guard); build:server exit 0; Biome clean on the 5 changed files; ci:changed
exit 0; ASCII-clean (no em/en dash, emoji, .only, debugger). Deferrals: withErrors middleware -> P8;
client userFacingApiError extension + apiError.* catalog + per-surface code-parity Vitest -> P22; the
real Retry-After VALUE sourcing from the limiter -> P19; the em-dash rate-limit string fix -> P13; the
structured logger + /metrics -> P23.

Phase 07 QA gate (phase-07-qa.md, dedicated adversarial pass): PASS, 0 BLOCKING, 0 SHOULD-FIX. A
1 Explore context load + 4 parallel auditors (correctness, test-coverage, dead-code/cleanup,
privacy-security-review) + a per-finding adversarial verify stage. The correctness auditor returned
ZERO findings: every acceptance criterion re-verified against the real code (as-const + deep-frozen
catalog, domain.reason keys, param-key declarations, the append-only snapshot, userFacingApiError
vocabulary reused 1:1, the exhaustive toAppError table incl. the HttpError pass-through for
401/403/413/429, per-surface not per-prefix selection, all seven frozen serializer shapes, stable
`code` i18n, server-only three-host parity, and the 500-no-leak proof). Out-of-scope check CONFIRMED
clean: the four Phase 7 commits touched only server/http/, tests/server/http/, and the two doc files.
The 10 findings surfaced were ALL NICE-TO-HAVE. Applied 5 in-scope hardening nits (commits 4d5a0882
+ 8877faeb): a direct escapeHtml escaping test (escapeHtml exported for it), the detailFor
status-reason fallback assertion, a WWW-Authenticate propagation assertion on the serialized mapError
result, hoisted CT_JSON/CT_HTML content-type constants, and narrowed DETAILS/OAUTH_ERROR to
`Partial<Record<ErrorCode, string>>` so a renamed/mistyped key is a compile error (no runtime change).
Deferred 5 forward-looking notes to their scoped phases: the 37 harvested "orphan" codes (reserved
for P22 emit-wiring, AIP-193), normalizeSurface's export consumer (P8 withErrors), the redirect
surface status collapse and instance=ctx.path echo (P8+/P12 route wiring), and defaultOnUnexpected's
console.error (P23 redacting logger). A follow-up qa-checklist confirmation pass returned READY
(0 BLOCKING / 0 SHOULD-FIX) and added one further forward-looking i18n note: the html and redirect
serializers render server-side English (reasonFor/detailFor) with NO client-matcher boundary, unlike
problem+json/oauth/admin which carry the machine `code` for Phase 22 re-localization; the phase that
first points a PLAYER-FACING HTML error route at this surface must localize it (a server-rendered
English page cannot pass through the Phase 22 client matcher). Post-fix: 97 tests across the 3 files (was 91, +6);
tests/server/http 330 pass (was 324); full gate green (npm test 617 files / 6597 pass / 11 skip; tsc,
build:env, build:server, build all exit 0; S3 27/3; ci:changed exit 0, changed files clean;
ASCII-clean). Note (commit hygiene, not a Phase 7 defect): commit 03dc2632 swept a stray root-level
PROFESSIONS_REVIEW.md in with the schema.ts credential-compare rename; it is unrelated to the API
pipeline and was removed in a follow-up commit at the user's request. Next: Phase 08 (Core middleware set + metric/log hook seam + thin
rateLimit adapter, phase-08-middleware.md).

## Phase 08: Core middleware set + metric/log hook seam + thin rateLimit adapter

Deliverables:
- [x] withErrors (outermost), requestId+ALS, withCors(class), withBody(maxBytes) mapping overflow->413/bad-json->400 preserving the card pre-auth Content-Length 413 short-circuit, PLUS a withRawBody/binary variant for the card route
- [x] requireAccount({scope}) as the one bearer resolver modeling at least read/active/full scopes, applying the ban/moderation+scope gate uniformly
- [x] A THIN rateLimit(policy) adapter over today's existing limiter booleans (deep two-tier rework deferred to P19)
- [x] The per-route metric + access-log hook behind an INJECTABLE no-op sink (collection point must land now)
- [x] Always-drain-body on early reject; clientError handler at the top-level createServer setup (no req/res, destroy the socket)

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean (privacy-security-review + qa-checklist, both 0 BLOCKING / 0 SHOULD-FIX)

Notes:
DONE (2026-06-30). Eight importable-but-UNMOUNTED onion middleware primitives plus one top-level
handler land under server/http/middleware/ and server/http/; NOTHING is mounted in front of the live
handleApi (Phase 9 mounts them), the dispatch flag and routing are untouched, and the WS wire and
upgrade path are unchanged. Built as a 3-agent parallel fan-out (8a errors/requestId/cors/metricSink,
8b-1 body/rawBody/clientError, 8b-2 requireAccount/rateLimit) integrated behind one onion-order test.

New files:
- server/http/middleware/with_errors.ts: `withErrors(opts?: { surface?, onUnexpected? })`, the OUTERMOST
  frame and single response authority. Catches a throw from next(), calls Phase 7 mapError, and writes
  ONE idempotent response via respondOnce (merging the SEPARATE contentType field onto headers). It does
  NOT rethrow (it is the terminal boundary inside runOnion). 500-no-leak preserved (original only to
  opts.onUnexpected).
- server/http/middleware/request_id.ts: `withRequestId()` re-establishes the Phase 5 reqId ALS binding
  around next() (`runWithReqId(ctx.reqId || newReqId(), next)`) so currentReqId() reads downstream even
  when composed without runOnion. It does NOT write ctx.reqId (readonly on the frozen Ctx). No
  X-Request-Id echo (Phase 23).
- server/http/middleware/cors.ts: `withCors(allowClass: 'api'|'public', isAllowedOrigin?)`. 'api' reflects
  a REALM_ORIGINS/NATIVE_APP_ORIGINS member (defaultApiAllow, byte-identical to the live maybeCors);
  'public' is the unconditional wildcard (mirrors publicCors). Sets headers BEFORE next() so a 4xx/429
  mapped downstream still carries CORS.
- server/http/middleware/metric_sink.ts: the injectable `MetricSink` interface + `noopMetricSink` default
  + `withMetrics(sink, route, now?)`. Records { route (the :param TEMPLATE, never a concrete path),
  method, status, durationMs } per request. Placed directly inside withErrors; since withErrors does not
  rethrow, the throw-path status is derived via toAppError(err).status (a pure read, so onUnexpected stays
  exactly-once). Real logger + /metrics exporter are Phase 23.
- server/http/middleware/body.ts: `withBody(maxBytes?)` wrapping readBody; over-cap -> HttpError(413,
  'body.too_large', {maxBytes}), malformed JSON -> HttpError(400, 'json.malformed'). JSON-only, imposes NO
  415 (Content-Type enforcement is Phase 21). The JSON cap is now a single source of truth:
  `DEFAULT_JSON_BODY_MAX_BYTES` exported from server/http_util.ts and referenced by both readBody's default
  and withBody (removes the re-typed-literal drift a QA nit flagged).
- server/http/middleware/raw_body.ts: `withRawBody(maxBytes)` wrapping readBinaryBody (raw Buffer, NO JSON
  parse). A Content-Length already over the cap rejects before reading; a mid-stream overflow rejects at
  readBinaryBody's cap; both throw HttpError(413, 'body.too_large', {maxBytes}, { Connection: 'close' }) and
  set res.shouldKeepAlive=false, preserving the live card route's pre-auth short-circuit semantics.
- server/http/middleware/require_account.ts: `requireAccount({ scope: 'read'|'active'|'full', lookupToken?,
  moderationStatus? })`, the ONE bearer resolver, mirroring the live bearerActiveAccount/bearerReadAccount.
  401 auth.token_missing (no/malformed token) / 401 auth.token_invalid (unknown token, WWW-Authenticate via
  the Phase 7 error model) / 403 auth.forbidden (insufficient scope: 'active' and 'full' both require
  scopeAllowsMutation, 'read' accepts read|full) / 403 moderation.banned|suspended|suspended_until.
  Populates ctx.account on success. The moderation/ban gate is applied UNIFORMLY for every scope tier, so no
  route mounted behind it can skip the ban/suspension check (closes the Discord bearer-gap precedent). DB
  calls are injected (deps-bag) for unit-testability, defaulting to the real accountAndScopeForToken /
  moderationStatusForAccount. Object-level requireOwned* BOLA loaders are Phase 12.
- server/http/middleware/rate_limit.ts: `rateLimit(policy)`, a THIN adapter over the existing boolean
  limiters (server/ratelimit.ts). `RateLimitPolicy = { name, keyClass: 'ip'|'ip+account', limited(ctx),
  retryAfterSeconds }`; on a limit throws HttpError(429, 'rate_limit.exceeded', { retryAfterSeconds }). Five
  named policy constants (PUBLIC_READ, WOC_BALANCE, CARD_UPLOAD, WALLET_LINK, DISCORD); Retry-After is coarse
  (WINDOW_MS/1000). 'ip+account' policies read ctx.account via accountIdOf (fail-closed 500 if absent, a
  composition bug). No ratelimit_db, no RATELIMIT_SCHEMA, no new limiter behavior (all Phase 19).
- server/http/client_error.ts: `handleClientError(err, socket)` destroys an undestroyed socket, no req/res.
  Registered once in server/main.ts startServer (`server.on('clientError', handleClientError)` right after
  http.createServer, before the noServer:true WebSocketServer setup). The ONLY main.ts edit this phase (an
  import + one line). Does not touch routing or the WS upgrade handshake.

Tests (tests/server/http/, 10 suites / 45 tests): with_errors, request_id, cors, metric_sink, body,
raw_body, client_error, require_account, rate_limit, and onion_order (the integration test pinning the
canonical sequence withErrors -> metric hook -> requestId -> withCors -> rateLimit(ip) -> withBody ->
requireAccount -> rateLimit(ip+account) -> handler, plus cheap-reject-first, auth-before-account-limiter,
and CORS-survives-a-429). No new error code was appended (every 4xx/401/403/413/429/500 body reuses a code
already in error_codes.ts).

Reviews: privacy-security-review PASS (0 BLOCKING / 0 SHOULD-FIX; confirmed the bearer-gap is closed, the
401/403 split, no internal leakage, the clientError handler is not an abuse vector, CORS parity; it noted
the primitive is a privacy IMPROVEMENT over the live resolver, which leaks the English status.message).
qa-checklist READY (0 BLOCKING / 0 SHOULD-FIX). Both reviewers rated everything else NIT/informational; the
one actionable nit (the re-typed JSON cap) was applied as the DEFAULT_JSON_BODY_MAX_BYTES single-source-of-
truth. The remaining nits are deliberate forward-looking notes recorded in state.md (Phase 9 mount-order
decision for auth-vs-body on account-scoped routes, Phase 9 must not widen the withCors origin predicate,
the Phase 23 redirect-surface status nuance in the metric hook, and the defensive readBody/readBinaryBody
throw-fall-through kept as intentional defense-in-depth). migration-safety NOT dispatched (no DDL / JSONB /
db.ts schema change), cross-platform-sync + architecture-reviewer NOT dispatched (server-only, no
src/sim / wire / matcher change). Determinism, three-host/IWorld parity, and persistence are N/A.

Validation: tsc clean; the 10 primitive suites 45/45; full npm test 627 files / 6642 pass / 11 skip;
build:env + build:server + build all exit 0; ci:changed exit 0 (changed files clean; the only remaining
warnings are pre-existing noExplicitAny in main.ts and readBody's Promise<any>); ASCII-clean (no em/en
dashes or emojis). Next: Phase 08 QA (docs/api-pipeline/phase-08-qa.md).

QA (2026-06-30): PASS. Five-agent parallel audit (correctness, test-coverage, dead-code,
privacy-security-review, qa-checklist). 0 BLOCKING. Fixes applied:
- SHOULD-FIX (message fidelity): a self-deactivated account now maps to the `account.deactivated`
  code instead of the generic `moderation.suspended`. moderationStatusForAccount (db.ts) now sets an
  OPTIONAL `deactivated` discriminator on AccountModerationStatus (additive, no schema/JSONB change),
  and requireAccount branches on it ahead of the defensive `moderation.suspended` fallback.
- SHOULD-FIX (coverage): withCors's SHIPPING `defaultApiAllow` predicate now has a direct test (a
  NATIVE_APP_ORIGINS member reflected, a foreign origin skipped, with NO injected predicate).
- Parity NIT: withRawBody's Content-Length pre-check now uses the live strict `/^\d+$/`-on-trimmed
  parse (a shared contentLengthOverCap helper mirroring player_card.ts cardUploadContentLengthTooLarge),
  so a non-numeric length falls through to the mid-stream cap exactly as the live card route does.
- Coverage NITs added: require_account malformed-but-present Authorization -> token_missing and the
  token_invalid `Bearer error="invalid_token"` challenge; withBody no-415 (non-JSON Content-Type still
  parses) + the real 64 KiB over-cap boundary; request_id newReqId fallback (empty ctx.reqId);
  WALLET_LINK_POLICY and DISCORD_POLICY (keyClass + flood-429 + the ip+account composition-bug 500).
- Doc: DISCORD_POLICY is commented as AUTHENTICATED-legs-only; Phase 9 needs a SEPARATE 'ip' policy for
  the unauthenticated Discord start/callback legs (the live discordRateLimited keys IP-only at accountId 0).
Phase 8 http suites now 10 files / 57 tests. Deferred (tracked, non-blocking): a shared
BEARER_TOKEN_PATTERN constant to retire the duplicated 64-hex regex (touches main.ts's 3 copies; folds
into the auth-resolver migration), the serializeOauth `moderation.* -> access_denied` refinement (Phase 7
errors.ts), and a live WS-upgrade smoke test (needs a booted server, out of the bare Vitest suite).
Reviewers: privacy-security-review PASS, qa-checklist PASS-WITH-NOTES; migration-safety /
cross-platform-sync / architecture-reviewer correctly NOT dispatched (server-only, no DDL/JSONB/db-schema,
no src/sim / wire / matcher change). Next: Phase 09 (docs/api-pipeline/phase-09-registry-parity.md).

## Phase 09: Registry + dispatcher-in-front (per-path delegate) + dual-path parity harness + top-level CORS wrapper

Deliverables:
- [x] registry.ts spreading domain route tables into one lookup + http/index.ts barrel
- [x] New dispatcher in front of old handleApi; un-migrated paths delegate per-path to the old ladder unchanged; reproduce the createServer prefix order and the non-awaited void semantics exactly
- [x] Keep CORS/OPTIONS as a top-level wrapper covering both old and new paths
- [x] A parity harness diffing each P3 fixture through old vs new (status, body, contracted headers), weighting error and 404-vs-405 paths heaviest, blocking on any undocumented diff
- [x] A registry-completeness test diffing the old-ladder path set against the new-router path set, hard-failing on any old path absent from the new router (run on every rebase)

New surface shipped (all under server/http/ + tests/server/http/):
- `server/http/registry.ts`: `ApiRegistry` (`resolve(method,path) -> MatchResult<RouteDef>` reusing the Phase 4 router, no re-implemented matching), `apiRoutes` (readonly RouteDef[], EMPTY this phase; the migration phases spread per-domain arrays in), `createApiRegistry(routes?)` (sorts most-specific-first, then the shadow guard, then createRouter; duplicate (method,path) rejection inherited from createRouter), `apiRegistry`, and `assertNoOwnedRouteShadowing` (the recorded Phase 4 BOLA-shadow obligation: a non-owned overlapping dynamic route may not shadow an account-owned :id route).
- `server/http/dispatch.ts`: `createApiDispatcher({registry, delegate, metricSink?})` -> a fire-and-forget `(req,res)=>void` matching the legacy handleApi call shape. Matched route -> `runOnion(ctx, [withErrors, withMetrics, ...route.middleware, handler])`; any other /api path -> `void delegate(req,res)` UNCHANGED. `selectApiEntry(mode, newDispatcher, legacy)` picks the path from the flag (legacy = call handleApi directly, an inert rollback). withRequestId is intentionally omitted (runOnion already binds the reqId ALS); withCors omitted (CORS is top-level).
- `server/http/index.ts`: barrel re-exporting the public spine (router, compose, context, schema, errors, error_codes, registry, dispatch) + the type-only types.
- The dispatch flag: `API_DISPATCH` env, parsed by `loadConfig` into `Config.dispatch: 'legacy' | 'new'` (default `DEFAULT_DISPATCH = 'legacy'`, now EXPORTED from config.ts so main.ts single-sources it). `server/main.ts` reads it once at boot (`setApiDispatchMode(loadConfig(process.env).dispatch)`), swaps only the /api arm to `apiEntry`, lifts CORS + OPTIONS-204 into `applyCorsAndPreflight` (one top-level source over both paths), and adds the prod-guarded test-only `setApiDispatchModeForTests`/`resetApiDispatchModeForTests`.
- `tests/server/http/parity.test.ts` (dual-path parity over 38 db-free MAIN /api contract requests + CORS/preflight cases, old-vs-new via the Phase 2 runParity driver, 0 divergences), `tests/server/http/completeness.test.ts` (registry-completeness gate: legacy ladder subset of router UNION delegate, non-vacuous negative control), plus `registry.test.ts` and `dispatch.test.ts`.

ZERO routes migrated (registry empty, every /api path delegates), so behavior is byte-for-byte identical to today (proven by parity + the Phase 3 goldens staying green). No WS wire, no src/sim, no DDL/JSONB, no new player-facing English.

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Notes:
- Phase 9 QA gate (phase-09-qa.md) PASS: 0 BLOCKING, 0 SHOULD-FIX, 2 NICE-TO-HAVE, both applied. Five-dimension audit (correctness, test-coverage, dead-code, privacy-security-review, qa-checklist) all clean, each substantive finding adversarially verified. Nits fixed as two stacked commits: (a) `refactor(http)` single-source the `DispatchMode` union in config.ts (was re-typed inline in dispatch.ts + main.ts x2 while only the default value was single-sourced); (b) `docs(http)` correct the `server/http/index.ts` barrel header (claimed a consumer, main.ts/tests, that imports the modules directly, not the barrel). No new tests required: the parity corpus already covers ALL 34 db-free MAIN /api fixtures (+ 4 dedicated CORS cases), and the completeness gate carries a non-vacuous synthetic-dropped-route negative control. FORWARD-LOOKING (Phase 10+, NOT a Phase 9 defect): once the registry is populated, a synchronous throw from `resolve()`/`buildContext()` would escape `routeHttpRequest`'s `void apiEntry(req,res)` call (outside any try/catch, unlike legacy `handleApi`'s body-wide catch); impossible with the empty registry (`match` over empty tables cannot throw, `buildContext` is never reached), so a migration-phase note, not a fix here.
- Validation GREEN: tsc clean; the 4 new suites 39 tests; full `tests/server/` 529; full pre-merge gate `npm test` 631 files / 6693 pass / 11 skip, build:env + build:server + build all exit 0; ci:changed clean; ASCII-clean.
- In-phase reviewers (the two the phase doc requires): privacy-security-review PASS (0 BLOCKING / 0 SHOULD-FIX, 2 INFO no-action: delegate cannot drop auth, no un-authed leak, CORS byte-identical extraction, clean flag-off rollback, prod-guarded test setter, no secret leak, 500-no-leak, exactly-one-response, WS untouched); qa-checklist READY (0 BLOCKING / 0 SHOULD-FIX, 2 NITs). Per the standing apply-all rule: NIT (a) applied (exported DEFAULT_DISPATCH from config.ts so main.ts no longer re-types the 'legacy' literal); NIT (b) recorded as a Phase 10 handoff (a migrated route must still return 405 under a wrong method once its legacy arm is removed; the completeness never-double-serves clause forces the arm removal). Not dispatched (no matching surface): migration-safety, cross-platform-sync, architecture-reviewer, release-malware-audit.
- Orchestration: 1 Explore (context) + a 2-wave hand-spawned fan-out (the phase doc said NOT a Workflow): Wave 1 = Agent A (registry + barrel) parallel with the lead doing the delicate dispatch.ts + main.ts swap + CORS wrapper; Wave 2 = Agent C (parity) + Agent D (completeness) against the landed code. Every agent's suite was re-run by the lead (not trusted from self-report).

## Phase 10: Migrate public reads (server/leaderboard.ts)

Deliverables:
- [x] Port /api/leaderboard (incl. ?board=guilds, legacy ?limit=N, ?scope), /api/arena/leaderboard, /api/releases, /api/project-stats, /api/search, /api/realms, /api/public/characters/:name/sheet, dev-gated /api/perf, and /api/status as RouteDefs (server/leaderboard.ts), spread into apiRoutes (server/http/registry.ts)
- [x] Typed page/pageSize/scope query decoders with bounds + defaults as NAMED constants (convention B envelope DEFERRED, see the decision below); the guild board and legacy single-page shape are exempt
- [x] Labeled-behavioral /api/status trim to {ok,realm,players_online}
- [x] Apply the one bearer resolver to /api/realms (anonymous-friendly when no token) and /api/search, closing their authz gap (new additive `optional` mode on requireAccount)

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

QA gate outcome (2026-07-01): PASS. A 4-dimension audit (correctness+dual-path parity, test-coverage, dead-code, privacy-security-review) with per-finding adversarial verification produced 0 BLOCKING and 0 SHOULD-FIX (two findings initially rated SHOULD-FIX were downgraded to NICE-TO-HAVE on verification). Two findings were refuted (a claim that the /api/status deviation neutered the cors_reflected_origin_get fixture, refuted because CORS is applied top-level from one place and is mode-independent by construction; and the anonymous-search security note, which was already a PASS verdict). Per the apply-all directive, all five verified NICE-TO-HAVE findings were fixed:
- (1) HEAD dual-path divergence (the one substantive finding): registering the 9 GET routes exposed a real UNDOCUMENTED parity break. The Phase 4 router synthesizes HEAD from GET (match.head), and the dispatcher ran the onion for it, so under API_DISPATCH 'new' a HEAD to a migrated GET route served 200-as-GET while the legacy ladder 404s HEAD (violating acceptance criterion 9, "zero undocumented diff"). The parity filter is PATH-scoped, so a known_deviations entry would over-broaden and mask real GET breaks. Fix (parity-preserving): the dispatcher now DELEGATES a HEAD match to the legacy ladder (server/http/dispatch.ts), keeping HEAD byte-identical (404 both paths) while the legacy arms are retained; serving HEAD as GET is a deliberate change deferred to the Phase 25 flag flip / ladder deletion. Enforced by a new dispatch.test.ts case (HEAD match delegates) and a parity corpus case (HEAD /api/leaderboard 404 on both paths, no divergence).
- (2) arena + project-stats handlers had no handler-level test (only their read fns): added an injectable dbReads seam (setLeaderboardDbForTests/resetLeaderboardDbForTests, mirroring the runtime seam) so the two always-DB-hitting handlers can be driven with a FakeDb; added handler tests for both.
- (3) readPublicSheet's second 404 (name resolves but the row read returns null) and its null-rank 200 branch were untested: added both.
- (4) six read-fn Db interfaces (ArenaReadDb/SearchReadDb/RealmsReadDb/ProjectStatsReadDb/PublicSheetDb/PublicSheetDeps) were exported but unused outside the module: made module-private.
- (5) five scope/format constants (LEADERBOARD_SCOPE_DEFAULT/GLOBAL, LEADERBOARD_GUILD_BOARD, ARENA_FORMAT_2V2/DEFAULT) were exported but unused outside the module: made module-private; decodeScope/decodeArenaFormat now return the named constant (single-sourced compare + return). The three limit constants the unit tests import stay exported.
QA fix scope (5 files): server/http/dispatch.ts, server/leaderboard.ts, tests/server/http/dispatch.test.ts, tests/server/http/parity.test.ts, tests/server/leaderboard.test.ts. Validation: tsc clean; the leaderboard + http/{dispatch,parity,completeness,registry,require_account} + known_deviations suites green (104 tests); ci:changed clean; build:server + full pre-merge gate green.

New module + surface:
- `server/leaderboard.ts` (NEW): the public-read domain. Pure query decoders + pure response builders + host-agnostic read functions (each takes a narrow Db interface, unit-tested via the Phase 2 FakeLeaderboardDb/FakeCharactersDb) + thin Ctx handlers + `export const routes: RouteDef[]` (9 GET routes). Runtime singletons the handlers need but cannot import without a cycle (game.clients.size / game.perfProfile, the three cache-fronted readers getLeaderboard/getGuildLeaderboard/getReleases, GITHUB_REPO/RELEASES_SIZE, publicOrigin, toSheetRank) are INJECTED once at boot via `configureLeaderboardRuntime` (main.ts, at module load). The in-memory leaderboard/releases caches STAY in main.ts (unchanged behavior); the injected readers reference the exact same functions the legacy arms use.
- `server/http/registry.ts`: `apiRoutes` now `[...leaderboardRoutes]` (no longer empty).
- `server/http/middleware/require_account.ts`: additive `optional?: boolean` mode (anonymous-friendly). When true and NO Authorization header is present, next() runs with ctx.account undefined; a PRESENT header still falls through to full validation (invalid -> 401, banned -> 403). Only the absent-header branch changes; required mode is untouched.
- `server/main.ts`: `configureLeaderboardRuntime({...})` at module load; ReleaseEntry moved to leaderboard.ts (main.ts imports it). The legacy handleApi arms for all nine paths are LEFT INTACT (the flag-off rollback path; removed only in Phase 25).
- `tests/server/leaderboard.test.ts` (NEW): decoders + builders + read-fns-via-FakeDb + the runtime-only handlers (status trim, perf gate, leaderboard shapes, releases) via the exported routes + fakeCtx.

New named constants (single source of truth, server/leaderboard.ts): `LEADERBOARD_SCOPE_DEFAULT`/`LEADERBOARD_SCOPE_GLOBAL`/`LEADERBOARD_GUILD_BOARD`, `LEADERBOARD_LEGACY_LIMIT_MAX` (= LEADERBOARD_MAX from src/sim/leaderboard_page.ts), `ARENA_LEADERBOARD_LIMIT` (20), `ARENA_FORMAT_2V2`/`ARENA_FORMAT_DEFAULT`, `SEARCH_RESULT_LIMIT` (8). page/pageSize reuse `LEADERBOARD_PAGE_SIZE`; the releases cap is injected (main.ts RELEASES_SIZE). No error_codes.ts codes appended: the gap-close 401 reuses the existing `auth.token_invalid`, so no S3 change.

Convention B decision (RECORDED, per the phase contract): DEFERRED. A src/net + src/ui consumer audit found every live client reads the `leaders` key (Api.leaderboard / ClientWorld.leaderboard / ClientWorld.guildLeaderboard in src/net/online.ts, ArenaWindow.fetchLeaderboard in src/ui/arena_window.ts), never `items`. Renaming `leaders` -> `items` would silently break all four call sites, so the existing `{realm,scope,metric,leaders,page,pageCount,total,pageSize}` shape is PRESERVED byte-for-byte (fixture diff: NONE for the standard/guild/legacy boards). The typed page/pageSize/scope DECODERS were still introduced (pure input hardening, no wire change). The {items,...} envelope is deferred to net-new endpoints (Phase 25 scaffold). The guild board and legacy ?limit single-page were exempt from convention B regardless.

Two labeled knownDeviations (tests/server/http/known_deviations.ts, both introducedInPhase 10):
- `status-name-list-trim` (pre-registered in Phase 3): /api/status drops the online-player `names[]` list, exposing counts only {ok,realm,players_online}. The Phase 3 golden status_get.json stays as the CURRENT (legacy, with-names) baseline the deviation documents; the parity harness confirms old(names)-vs-new(trimmed) diverges and is filtered.
- `realms-search-authz-gap-close` (NEW this phase): /api/realms + /api/search now validate a PRESENT token (invalid -> 401) via requireAccount({optional:true}); the no-token behavior is unchanged for realms (empty counts) and search becomes anonymous-friendly (a missing token no longer 401s, it serves results). goldenFixtures reference the current-behavior realms_get_noauth.json + search_get_noauth_401.json.

Test-harness reconciliation (the Phase 9 baseline assertions the migration evolves, all flagged "this-phase seed baseline" / "vacuous now, forward-real" by the Phase 9 author):
- completeness.test.ts: the "never double-serves" test was RECONCILED to a "rollback-retention" test. A migrated route is deliberately BOTH router-owned (flag 'new') AND legacy-served (flag 'legacy') because the legacy arm is the flag-off rollback path kept until Phase 25; that is not a runtime double-serve (the dispatcher runs exactly one arm per request, the flag picks, and parity proves they are byte-identical). The invariant flips: every router-owned ladder path MUST still be legacy-served until Phase 25 (a rollback arm removed too early would 404 under flag 'legacy'). Plus a new "Phase 10 migrated baseline" block (the 9 paths are router-owned, the rest delegate-only). The negative control + coverage tests are unchanged.
- parity.test.ts: the Phase-9 "zero RAW divergences" assertion is replaced by "every raw divergence is a registered known-deviation path, and the status trim + search gap-close deviations actually fire". The search corpus fixture dropped its ?q so the new anonymous served path stays db-free.
- registry.test.ts: the empty-registry assertion is replaced by "registers the Phase 10 public-read domain and matches its paths".

Rate limit + error bodies (parity-first): the ported routes keep their legacy `{error:...}` bodies byte-for-byte (404 not-found, 429 rate limited). The public sheet AND (post-review) /api/search call publicReadRateLimited IN-HANDLER (not the rateLimit middleware) precisely so the 429 body shape is unchanged (the phase's "do not change any limiter return-shape" rule). RFC-9457-ification of these error bodies is Phase 22.

Notes:
- Reviewers (per the phase contract): privacy-security-review REQUIRED = 0 CRITICAL, 1 WARNING (applied), 3 INFO (by-design); port-faithfulness coverage = all 9 routes FAITHFUL (3 with the intended deviations), every named constant matches the legacy inline literal; qa-checklist = READY, 0 BLOCKING / 0 SHOULD-FIX, 2 low NITs (both applied). SKIPPED (no matching surface): migration-safety, cross-platform-sync, architecture-reviewer.
- Applied review findings (apply-all rule): (1) SECURITY WARNING: /api/search became anonymous but was unrate-limited (the gap-close opened an unauthenticated DB-hitting name-enumeration surface); now gated in-handler with publicReadRateLimited, the same per-IP budget the public sheet uses, 429 `{error:'rate limited'}` (parity-safe: the harness resets the limiter per pass so the single request stays under budget); added a search-429 unit test. (2) NIT: the realms-search-authz-gap-close deviation now also documents that a present VALID token from a banned/suspended account is rejected 403 (requireAccount's uniform moderation gate, which the legacy bearerAccount skipped). (3) NIT: added a public-sheet 429 branch unit test.
- INFO/by-design (no change): the /api/status name-list trim and the search/realms gap-close are only live under API_DISPATCH 'new' (the legacy arms stay for rollback; the flag flips in Phase 25); the router adds a trailing-slash normalization to migrated routes (a Phase 9 dispatcher property, canonical-path bodies identical); the test-only DATABASE_URL is a dummy loopback literal (the established test-setup pattern). CORRECTED in QA: the router's HEAD-as-GET synthesis was NOT identical to the legacy ladder (legacy 404s HEAD; the onion would have served 200-as-GET), so the QA pass made the dispatcher DELEGATE a HEAD match to the legacy ladder, keeping HEAD byte-identical (404) until the Phase 25 flag flip (see the QA gate outcome above).

More notes:

## Phase 11: Migrate auth (register/login/native-attestation)

Deliverables:
- [x] Port /api/register, /api/login, /api/native-attestation/challenge as RouteDefs (server/auth_routes.ts, NEW module), spread into apiRoutes (server/http/registry.ts)
- [x] passesTurnstile as a per-route POST-body middleware after withBody (server/http/middleware/turnstile.ts), scoped to register+login (not a global prologue, not on the challenge route)
- [x] Preserve authThrottled as a HANDLER-level check (per-username, failed-only via recordAuthFailure, clears on success via clearAuthFailures, 15m/10-fail window)
- [x] Preserve the deliberate anti-enumeration behavior on register/login (documented; see the CORRECTION note: it is 409-on-taken-username / 401-on-bad-credentials, already the by-design registerLoginAntiEnumeration deviation, NOT a 404)

QA (in-phase reviewers, per the phase contract; the dedicated Phase 11 QA gate phase-11-qa.md is the next step):
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Reviewers (2026-07-01, the two the phase doc requires): privacy-security-review REQUIRED = 0 BLOCKING / 0 SHOULD-FIX (2 NICE-TO-HAVE + 3 INFO all parity-preserved); it verified the credential surface line-for-line (guard order = legacy cheap-reject-first, no limiter/IP-block moved after a DB read/write, admin IP-block bypass correct, anti-enumeration preserved, no secret read/logged, parameterized SQL only, CSPRNG token issuance, moderation gate intact). qa-checklist REQUIRED = READY, 0 BLOCKING / 1 SHOULD-FIX / 3 NICE-TO-HAVE. NOT dispatched (no matching surface): migration-safety (no DDL/JSONB), cross-platform-sync (no IWorld/wire/matcher; the client matcher is CONSUMED unchanged), architecture-reviewer (no src/sim). Both reviewers independently surfaced the SAME substantive item.
Applied ALL findings (apply-all rule):
- (SHOULD-FIX, both reviewers) Ledger gap: the new path parses the body via withBody and surfaces errors via the Phase 7 withErrors boundary, so on /api/login and /api/native-attestation/challenge a malformed JSON body now answers 400 (json.malformed), an over-cap body 413 (body.too_large), and an unexpected throw 500 (internal.error), all as RFC 9457 problem+json, whereas the legacy handleApi outer catch answers all three as 500 { error: 'internal error' }. register's 400/413 status remap is already tracked by validationStatusRemap; login + challenge were not. NOT exercised by the db-free parity corpus (valid bodies only), so it is documented, not harness-caught. FIX: added the authBodyValidationRemap known deviation (routes /api/login + /api/native-attestation/challenge, introducedInPhase 11). Leak-free: the 500 detail is a static generic sentence and the original error goes only to the logger. Phase 22 wires the client code-matcher for these problem+json bodies.
- (NICE, both) webLoginGuard reads webLoginEnforced() LIVE per request (the legacy arm cached it once): documented as a deliberate, parity-equivalent (env is fixed at boot), more-testable choice with an inline comment; behavior unchanged.
- (NICE, qa) login had no onion-level IP-rate-limit test (register did): added a symmetric login guard-chain 429 test (exhaust the per-IP window then a login from the same IP is rejected by ipRateLimitGuard before the handler reads the account).
- (NICE, qa) validationStatusRemap.introducedInPhase framing (7 vs the per-route Phase-11 realization): the pre-existing Phase-7 entry (which also spans /api/reports + /api/bug-reports, migrating in later phases) is left as-is; the new authBodyValidationRemap precisely attributes login + challenge to Phase 11 and its reason notes the framing. Re-splitting validationStatusRemap is out of Phase 11 scope.
INFO (parity-preserved, no action): the login account-existence timing oracle (verifyPassword scrypt runs only for an existing username), a banned account with a correct password answering 403 (not 401), and a blocked-IP correct-password answering 429 (not 401) all reproduce the legacy behavior exactly and are covered by registerLoginAntiEnumeration.

New module + surface:
- `server/auth_routes.ts` (NEW): the auth credential domain. Thin Ctx handlers (register, login, native-attestation challenge) + small per-route guard middleware + `export const routes: RouteDef[]` (3 POST routes). Follows the server/leaderboard.ts template. NOTE the deviation from the phase doc's "on server/auth.ts": server/auth.ts is a pure leaf (crypto + validators, imports only node + obscenity); bolting HTTP handlers + db.ts/http imports onto it risks an import cycle and mixes the pure/IO split the repo enforces (server/CLAUDE.md), so the routes live in a NEW module exactly as the leaderboard template is a NEW server/leaderboard.ts (not bolted onto db.ts). db.ts / account.ts reads+writes + the register side-effects (emailAccountCreated / createSuspiciousRegistrationReport / captureReferral) are imported directly and bundled behind a test seam (setAuthDbForTests); the three main.ts-local singletons (game.isIpBlocked, passesTurnstile, requestMetadata) are INJECTED once at boot via configureAuthRuntime (main.ts), mirroring configureLeaderboardRuntime.
- `server/http/middleware/turnstile.ts` (NEW): a generic per-route POST-body anti-bot gate. Takes an injected `verify` (main.ts passesTurnstile is wired in by the auth route), runs after withBody, and on failure short-circuits with the legacy 403 `{error:'verification failed, please try again'}` body (it does NOT throw an HttpError, so the body shape stays legacy-identical and the client prose-matcher still resolves it; RFC 9457 for this is Phase 22).
- `server/http/registry.ts`: `apiRoutes` now `[...leaderboardRoutes, ...authRoutes]`.
- `server/main.ts`: `configureAuthRuntime({...})` at module load. The legacy handleApi arms for all three paths are LEFT INTACT (the flag-off rollback path; removed only in Phase 25).
- Tests (NEW): tests/server/auth.register.test.ts, tests/server/auth.login.test.ts, tests/server/auth.attestation.test.ts.

KEY RECONCILIATION (parity-first, following the Phase 10 durable pattern): the migrated auth handlers write the SAME legacy `{error:'...'}` / success body shapes byte-for-byte via http_util json(), NOT the RFC 9457 problem+json error model. The phase doc's "emit through the shared error model as a stable code (problem+json)" invariant is the Phase-22 END-STATE; the phase doc's own OUT-OF-SCOPE ("the existing prose-matcher still resolves the migrated responses, parity preserved") is decisive and requires prose bodies now, because src/main.ts userFacingApiError keys on English prose and is not code-aware until Phase 22. The guard checks (origin, IP rate-limit, IP block) run IN small per-route middleware writing legacy bodies (NOT the generic rateLimit/requireAccount middleware, which would emit problem+json and change the body shape) so parity holds exactly as Phase 10 kept publicReadRateLimited in-handler.

Middleware order (per route), the exact legacy check order, cheap-reject-first (Phase 8 onion philosophy):
- register: [webLoginGuard, ipRateLimitGuard, registerIpBlockGuard, withBody(), turnstile] then registerHandler.
- login: [webLoginGuard, ipRateLimitGuard, withBody(), turnstile] then loginHandler (the IP block is IN-HANDLER, after the account is known, with the isAdminAccount bypass, exactly as the legacy arm did, so an admin verified by password is never locked out).
- challenge: [withBody()] then challengeHandler (NO origin/rate-limit/turnstile gate: it is the first step a native client takes, before it can attest).

One labeled knownDeviation (tests/server/http/known_deviations.ts, introducedInPhase 11):
- `authRateLimitDashToComma`: the legacy 429 rate-limit / IP-block bodies use an em dash ("too many attempts" + em dash + " wait a minute ..."); the ported handlers use a COMMA, because the no-em-dash code invariant forbids a U+2014 literal in the new module. Matcher-safe: userFacingApiError keys on the "too many attempts" / "too many failed attempts" PREFIX (before the punctuation), so the localized message is unchanged. This divergence is NOT exercised by the db-free parity corpus (the corpus tests only the register-400 / login-401 / challenge-200 paths); the register/login unit tests assert the comma body directly. Phase 13 aligns the legacy strings to the comma and retires this deviation. The em dash was NEVER typed in new code or in the deviation text (described in words).

CORRECTION (doc vs code): the phase doc repeatedly says "anti-enumeration 404" on register/login. There is NO 404. The real anti-enumeration is register 409 (taken username) / login 401 (bad credentials), plus a shared 429 message for the IP block (no signal the block exists) and 403 for moderation. This is ALREADY the by-design `registerLoginAntiEnumeration` deviation (introducedInPhase null), so no new anti-enum entry was added; the 409/401 behavior is preserved byte-for-byte. The 2FA branch ({twoFactorRequired:true} 200 / "invalid authentication code" 401) is preserved exactly.

No error_codes.ts change: every code the auth routes would emit (auth.invalid_credentials, auth.web_login_only, auth.too_many_attempts, auth.too_many_failed_attempts, auth.verification_failed, account.username_*, account.password_*, account.deactivated, moderation.*, two_factor.code_invalid) was ALREADY harvested into the catalog in Phase 7, so nothing was appended and there is NO S3 guard change (the migrated bodies still emit the legacy prose; the codes are wired to emission in Phase 22).

Test-harness reconciliation (the migration extends the Phase 10 baseline): completeness.test.ts's "Phase 10 migrated baseline" block became "migrated baseline (Phase 10 public reads + Phase 11 auth)": the 12 migrated routes (9 GET reads + 3 POST auth) are all router-owned AND legacy-served (rollback-retention), method-aware (auth routes are POST). parity.test.ts is unchanged (its register-400 / login-401 / challenge-200 corpus fixtures now exercise the new handlers and stay byte-identical; the challenge random challengeId/nonce are masked by the normalizer, so they are parity-stable).

DEDICATED QA GATE (phase-11-qa.md, 2026-07-01): PASS-WITH-FOLLOWUPS. A workflow ran ONE Explore context-loader, 5 parallel audit agents (correctness, test-coverage, dead-code, privacy-security-review, qa-checklist), then an adversarial verifier over EVERY finding. Raw 13 findings -> 4 confirmed / 9 refuted-or-invalid. 0 BLOCKING, 1 SHOULD-FIX, 3 NICE-TO-HAVE; applied all four feasible ones (apply-all rule), deferred one nit as infeasible in-scope.
- (SHOULD-FIX, test-coverage) The register/login middleware ORDER was asserted only by array LENGTH (register 5, login 4, challenge 1), never by sequence. A reorder to turnstile-BEFORE-withBody would ship green (length unchanged; the guard-chain tests inject body-independent verifiers; the parity corpus uses empty bodies with no Turnstile secret) yet in production Turnstile would read the unparsed empty body, verify would fail, and EVERY register/login would 403: a total auth outage. FIX: added a decisive functional order test to both tests/server/auth.register.test.ts and tests/server/auth.login.test.ts: ctx.body is left unset and only the streamed request carries the token, with a body-dependent verifier (passesTurnstile = body.turnstileToken === 'ok'); the route must reach 200, which only happens if withBody parsed the body BEFORE Turnstile read it. A turnstile-before-withBody reorder now fails the suite.
- (NICE, correctness) A literal JSON `null` request body (valid JSON, so withBody does NOT throw and it is NOT covered by authBodyValidationRemap) diverges: legacy dereferences null and 500s via the outer catch, the migrated `ctx.body ?? {}` coerces it to {} so register 400 / login 401 / challenge 200. FIX: documented as the new `authNullBodyCoercion` known deviation (introducedInPhase 11); the coercion is strictly safer (no code change).
- (NICE, test-coverage) The challenge default-action 'auth' and string pass-through were asserted only structurally (createNativeAttestationChallenge is unspied and the action is stored inside the challenge, never echoed), so a regression dropping body.action would pass. FIX: tests/server/auth.attestation.test.ts now vi.mocks native_attestation DELEGATING to the real impl (shape tests keep real values) and asserts the exact action threaded ('link' pass-through; non-string -> 'auth').
- (NICE, qa-checklist, DEFERRED) The 8 migrated auth body strings are player-facing but scanned by no localization completeness guard (the S3 guard covers only src/sim/sim.ts + server/game.ts). A full round-trip test needs userFacingApiError, which lives only in the DOM-coupled src/main.ts (client) and is not Node-importable without extracting the matcher: out of Phase 11 scope. All 8 strings were manually verified to resolve today. FOLLOW-UP: extract userFacingApiError into a Node-testable module and pin the auth-string round-trip (a general REST-surface localization-guard gap, not a Phase 11 regression).
Refuted highlights (adversarially dismissed, not fixed): the test-coverage "parity-masks-migrated-auth-routes" SHOULD-FIX (old==new is pinned TRANSITIVELY by byte-identical new-path unit assertions + legacy golden fixtures, so a drift on either arm still fails a real test); the web-login live-read (parity-equivalent, env fixed at boot); the authThrottled clock-window and register no-db-touched nits (already covered by ratelimit_clock.test.ts and by the 429-body distinguisher respectively); three privacy-security parity notes (enumeration timing, challenge no-rate-limit, turnstile-ordering-invariant) all reproduce legacy exactly.
Validation matrix (all green): tsc --noEmit 0; vitest auth.register+login+attestation + known_deviations + completeness + parity = 71 pass; localization_fixes (S3) 27 pass / 3 skip; ci:changed 0 (my 4 files clean; the 921 warnings are pre-existing noExplicitAny elsewhere); build:server 0.

Notes:

## Phase 12: Migrate character ownership + BOLA seam (server/characters.ts)

Deliverables:
- [x] Port /api/me/characters, /api/characters (GET/POST), /api/characters/:id (DELETE), /rename, /takeover, /standing, /sheet with typed :id params (8 RouteDefs in server/characters.ts, spread into apiRoutes)
- [x] requireOwnedCharacter loader (generic server/http/middleware/require_owned.ts) populating ctx.state.character via an account-scoped query + a deny-by-default coverage test (metadata: completeness.test.ts checkRequireOwnedCoverage(apiRoutes); functional: tests/server/http/ownership_coverage.test.ts drives every account-owned :id route with a null loader and asserts 404). Admin operator routes excluded by explicit metadata (none exist yet; Phase 17)
- [x] Labeled-behavioral NEW limiters character.create/rename/delete/takeover as asserted knownDeviations (newLimiterCharacterMutations, pre-seeded Phase 3, realized here)
- [x] 404 denial applied for player-owned objects (bolaOwned404, pre-seeded by-design); 403 admin/operator is Phase 17 (no operator routes here)

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Reviewers (the two the phase doc requires; migration-safety / cross-platform-sync / architecture-reviewer correctly SKIPPED, no DDL-JSONB / IWorld-wire-matcher / src-sim change): privacy-security-review REQUIRED = 0 BLOCKING / 0 SHOULD-FIX / 3 NICE-TO-HAVE, all 6 checks PASS (account-scoped-before-authorize, cross-account/absent identical 404 with a leak-free bola_denied log, num() 422 before any DB call, per-(ip+account)-per-action limiter behind auth with no casing/trailing-slash bypass, server-authoritative force_rename/offline/name-confirm gates, parameterized SQL + preserved moderation gate + no secret leak). qa-checklist REQUIRED = READY, 0 BLOCKING / 1 SHOULD-FIX / 2 NICE-TO-HAVE. BOTH reviewers independently surfaced the SAME item.
Applied ALL findings (apply-all):
- (SHOULD-FIX, both reviewers) The rename route checks ownership (requireOwnedCharacter) BEFORE the handler validates the name, so a full-token request to a non-owned/absent :id with an invalid name answers 404 where legacy returned 400. Runtime is acceptable-and-safer (BOLA-first anti-enumeration); FIX = documented as the ordering note on the characterBodyValidationRemap known deviation + this KEY RECONCILIATIONS note + a unit assertion in tests/server/characters.test.ts (non-owned id + invalid name -> 404, handler unreached).
- (NICE, security) The bola_denied deny-log fires on EVERY miss and the two owner READ routes carry no limiter, so an authed :id-iterator can drive log volume. FIX = documented in require_owned.ts as a deliberate per-denial audit signal whose volume-bounding is Phase 23's structured-logging sink (the sink is injectable); NOT a read limiter (would 429 reads where legacy never did; out of this phase's scope).
- (NICE, qa) Untested create double-collision-after-reclaim 409 + the non-unique create/rename rethrow 500 branches: added three unit tests.
- (NICE/INFO, both) The new-limiter 429 problem+json client-matcher is Phase 22 (already the newLimiterCharacterMutations deviation + a progress deferral note); no action.

New modules + surface:
- `server/http/middleware/require_owned.ts` (NEW): the generic `requireOwned(config)` load-then-authorize BOLA loader. Runs AFTER the auth guard: reads ctx.account.accountId (a missing one is a composition bug -> HttpError(500)), decodes ctx.params[param] with num({int,min:1}) throwing the decode failure (-> 422) BEFORE any DB call so a query never sees NaN, calls the account-scoped loader, and on a hit stores the row at ctx.state[resource] + next(); on a miss emits a structured `bola_denied` deny-log (route + method + path + the CALLER's accountId + the requested id + reqId, NEVER whether the row exists for another account) and writes the route's LEGACY 404 body, short-circuiting (no throw, no next). The 404 body is per-route: 'character not found' (sheet/standing/rename) vs 'not found' (takeover/delete), byte-for-byte with the legacy arms.
- `server/characters.ts` (NEW): the owner-gated character domain. Thin Ctx handlers + two per-route auth guards (activeGuard mirrors bearerActiveAccount, readGuard mirrors bearerReadAccount, both write the legacy `{error}` bodies and short-circuit, NOT the generic requireAccount which throws problem+json) + requireOwnedCharacter(notFoundBody) + the four character.* limiter middleware + `export const routes: RouteDef[]` (8 routes). The db.ts reads/writes bundled behind setCharactersDbForTests; six main.ts-local singletons (isCharacterOnline, takeOverCharacter, rekeyMarketSeller, saveMarket, initialCharacterState, publicOrigin) INJECTED at boot via configureCharactersRuntime, mirroring configureLeaderboardRuntime/configureAuthRuntime.
- `server/ratelimit.ts`: added `characterMutationRateLimited(req, accountId, action)` (per-action ip+account sliding-window buckets, keyed BY ACTION so create/rename/delete/takeover never share a window) + `CHARACTER_MUTATION_MAX_PER_MINUTE = 20` (generous named constant; deep two-tier rework is Phase 19) + `resetCharacterMutationRateLimits`.
- `server/http/middleware/rate_limit.ts`: added CHARACTER_CREATE/RENAME/DELETE/TAKEOVER_POLICY ('ip+account', reusing the existing rate_limit.exceeded code -> NO error_codes append, NO S3 change).
- `server/http/registry.ts`: `apiRoutes` now `[...leaderboardRoutes, ...authRoutes, ...characterRoutes]`.
- `server/main.ts`: `configureCharactersRuntime({...})` at module load. The legacy handleApi character arms are LEFT INTACT (flag-off rollback; removed Phase 25).
- Tests (NEW): tests/server/http/require_owned.test.ts, tests/server/characters.test.ts, tests/server/http/ownership_coverage.test.ts. Harness edits: completeness.test.ts MIGRATED_ROUTES +8 char routes (20 total, method-aware); parity.ts isolatePass now resets the character-mutation buckets; known_deviations.ts +characterBodyValidationRemap.

KEY RECONCILIATIONS (parity-first, doc-vs-code, following the Phase 10/11 durable pattern):
- The migrated handlers write the SAME legacy `{error}`/success bodies byte-for-byte via http_util json(), NOT the RFC 9457 problem+json model. The phase doc's "stable-code i18n via problem+json" invariant is the Phase-22 END-STATE (its own OUT-OF-SCOPE line defers the src/main.ts userFacingApiError matcher to Phase 22, so prose bodies are required now). The auth guards + the requireOwned 404 write legacy prose and short-circuit (no throw); the 4 no-auth 401 goldens (characters/me_characters/owner_sheet/standing) pin `{error:'not authenticated'}` and would FAIL against a problem+json requireAccount, so the per-route legacy-body guards are load-bearing.
- The doc's "requireOwnedCharacter populates ctx.character" is realized as `ctx.state.set('character', row)` because Ctx is frozen with no per-resource field; ctx.state (a Map) is the sanctioned slot (types.ts comment names it for exactly this). Handlers read ctx.state.get('character').
- The doc's "404 via HttpError with a stable code" for the BOLA denial is likewise the Phase-22 end-state; the loader writes the legacy 404 prose body (an HttpError would emit problem+json and break the client matcher + byte-parity). The bolaOwned404 by-design deviation (pre-seeded Phase 3) already documents the 404-not-403 anti-enumeration for these routes.
- Non-numeric :id: the router matches :id GENERICALLY (path_pattern cannot constrain a segment to digits), so the new router matches `/api/characters/abc/...` where the legacy `\d+` regex 404-fell-through. requireOwned's num() decoder answers 422 (before any DB call), the doc's explicit ask and NaN-safe. This diverges from legacy's 404-fallthrough ONLY for a malformed id no golden fixture pins and no real client sends, so it is not a parity divergence the harness can observe (documented, not ledgered).

Middleware order (per route), cheap-reject-first:
- GET /api/me/characters: [readGuard] (read OR full token). GET /api/characters: [activeGuard] (full only). Both return the byte-identical characterListPayload body.
- POST /api/characters: [activeGuard, rateLimit(CREATE), withBody] then create.
- GET /api/characters/:id/standing: [activeGuard, requireOwnedCharacter('character not found')]. GET /api/characters/:id/sheet: [readGuard, requireOwnedCharacter('character not found')].
- POST /api/characters/:id/rename: [activeGuard, rateLimit(RENAME), withBody, requireOwnedCharacter('character not found')] (withBody BEFORE requireOwnedCharacter mirrors the legacy readBody-then-getCharacter order and keeps the framework-error divergence uniform).
- POST /api/characters/:id/takeover: [activeGuard, rateLimit(TAKEOVER), requireOwnedCharacter('not found')] (no body).
- DELETE /api/characters/:id: [activeGuard, rateLimit(DELETE), withBody, requireOwnedCharacter('not found')] (exact legacy order: body, ownership, online/confirm/delete).

Two labeled knownDeviations that TOUCH the character routes:
- `newLimiterCharacterMutations` (pre-seeded Phase 3, introducedInPhase 12): create/rename/delete/takeover now carry per-action limiters, so a 429 is possible where none was. Realized here; asserted by the character unit tests (drive the chain under withErrors, 21st attempt -> 429 rate_limit.exceeded problem+json). Not exercised by the parity corpus (single-request passes with reset buckets).
- `characterBodyValidationRemap` (NEW, introducedInPhase 12): POST create/rename + DELETE parse the body via withBody, so malformed JSON -> 400 (json.malformed), over-cap -> 413 (body.too_large) as problem+json, and a literal JSON null body is coerced away (`ctx.body ?? {}` -> 400 name-invalid / confirmation-required) instead of the legacy readBody-reject / null-deref to a generic 500. Mirrors the Phase 11 authBodyValidationRemap + authNullBodyCoercion; NOT exercised by the valid-body parity corpus, so documented not harness-caught. Every future withBody POST migration inherits this. RELATED (same deviation, surfaced by BOTH in-phase reviewers): on POST /api/characters/:id/rename requireOwnedCharacter (ownership 404) runs as middleware BEFORE the handler validates the name, so a non-owned/absent :id with an INVALID name answers 404 where legacy validated the name first (400). Security-neutral-to-positive (BOLA-first anti-enumeration leaks nothing about name validity); unreachable by a real client (a client only renames its own force-flagged character); locked by a unit assertion in tests/server/characters.test.ts.

No error_codes.ts change (rate_limit.exceeded and every character.*/auth.*/moderation.* code was harvested Phase 7); NO S3 change; NO DDL/JSONB (reuses the account-scoped db helpers); NO src/sim import; NO WS wire change; no em/en dashes or emojis in any added line.

Deferrals: the client code-matcher for the character problem+json 429/422 bodies is Phase 22; the admin/operator-scope loader + 403 denial + the operator-route exclusion realization is Phase 17 (Phase 12 leaves the exclusion an explicit metadata clause; no operator routes exist yet).

Validation (all GREEN): tsc --noEmit 0; the Phase 12 targeted matrix (characters + require_owned + ownership_coverage + parity + completeness + registry + registry_introspect + known_deviations + rate_limit + surface_inventory + dispatch) 134 tests pass; full pre-merge gate `npm test` 672 files / 7178 pass / 11 skip (up from Phase 11), tsc 0, build:env + build:server + build exit 0; ci:changed exit 0 (only pre-existing noExplicitAny warnings, no errors/format diffs); no em/en dash or emoji in any added line. New tests: require_owned 11, characters 43 (39 + 4 QA), ownership_coverage 8. Next: Phase 12 QA (phase-12-qa.md).

Phase 12 QA gate (phase-12-qa.md, dedicated adversarial re-verification, 2026-07-01): PASS, 0 BLOCKING. A 29-agent workflow fanned out 8 finder dimensions (legacy-parity, BOLA correctness, acceptance criteria, test-coverage, cleanup, i18n/stable-code, deviations-ledger, docs/spec-completeness) plus privacy-security-review + qa-checklist + a completeness critic, each finding adversarially verified (13 confirmed, 5 refuted). The BOLA-correctness dimension returned ZERO findings (no cross-account read/write hole, no existence leak in body or deny-log, NaN/non-positive :id blocked before any DB call). Verdict: 0 BLOCKING, 2 SHOULD-FIX, 11 NICE-TO-HAVE; per apply-all, every finding fixed (the :id-decode ledger gap was independently surfaced 4x and the create-retry gap 2x, deduped):
- test-coverage (SHOULD-FIX): added a per-action limiter-independence test (fully throttle create, prove a first delete still 200s, pinning the `${action}:` bucket key that was otherwise unasserted); added owned-path rename invalid-name + offensive-name 400 tests (the moderation boundary, previously only tested on create); plus the create reclaim-then-retry edge tests (retry null -> 400 limit-reached; retry non-unique -> 500 rethrow), skin-clamp (99->7, -3->0, non-number->0), and toSheetRank(null) owner-sheet coverage.
- deviations-ledger (NICE): added the `characterIdParamDecode` known deviation (introducedInPhase 12): the migrated :id routes reject a non-numeric OR non-positive :id with 422 (authed) / 401 (guard-first, unauth) where the legacy `\d+` arms 404'd; harness-invisible (numeric-only corpus), sibling to characterBodyValidationRemap.
- cleanup (NICE): extracted the byte-identical ctx-account-id 500 guard (triplicated across characters.ts / require_owned.ts / rate_limit.ts, 2 of the 3 copies added in Phase 12) into one exported `ctxAccountId` in server/http/context.ts; collapsed the four identical CHARACTER_*_POLICY objects into a `characterMutationPolicy(name, action)` factory (the other five policies call distinct limiter fns and stay longhand).
- docs (NICE): corrected the progress.md "five" -> "six" injected-runtime count; kept the local parity.test.ts isolate() in lockstep with isolatePass (added resetCharacterMutationRateLimits).
Refuted (5) include the `this token is read-only` client-matcher gap (pre-existing; the migrated activeGuard preserves the legacy body byte-for-byte, so not a Phase 12 regression) and a parity-masking claim (old==new is pinned transitively by the unit + golden corpus). Re-validation (all GREEN): tsc 0; full `npm test` 672 files / 7187 pass / 11 skip (+9 QA tests); build:server + build:env + build exit 0; ci:changed exit 0 (changed files clean). Next: Phase 13.

Notes:

## Phase 13: Migrate account portal (server/account.ts) + em-dash fix

Deliverables:
- [x] Ported the account-portal surface onto `server/account.ts` `export const routes` (16 RouteDefs): GET /api/account, POST password/logout/email(410)/deactivate, companion-token POST/GET/DELETE (the legacy method-agnostic arm split into three method-specific RouteDefs), POST email/change, GET email/verify, POST export/marketing, POST 2fa/setup+enable+disable, GET /api/email/unsubscribe. Thin Ctx handlers delegate to the existing handleAccount* domain functions UNCHANGED; registry.ts spreads `...accountRoutes` into apiRoutes.
- [x] /api/email/unsubscribe classified per its REAL Phase 3 fixture (JSON {ok:true}, NOT the planning label's HTML); serializer reproduces the bytes.
- [x] Labeled-behavioral em-dash rate-limit fix: the four legacy handleApi 429 strings in server/main.ts swapped from a U+2014 em dash to a comma ('too many attempts, wait a minute and try again' / 'too many failed attempts, wait a few minutes and try again'), matching the Phase 11 migrated arms; userFacingApiError (src/main.ts) UNCHANGED (its startsWith prefixes sit before the comma, so resolution is neutral); no new error code. The former `authRateLimitDashToComma` known deviation is RETIRED (legacy == migrated now).
- [x] Operator-facing em dashes in src/admin/i18n.locales/en_CA.ts swapped to commas + resolved copy regenerated via `npm run i18n:admin` (never hand-edited).
- [x] Also cleaned the pre-existing comment em dashes in server/main.ts + src/main.ts (the Phase 13 lockstep), so `grep -rnP "\x{2014}"` over all four target files prints nothing.

Notes:
- Auth via per-route legacy-body guards (activeGuard mirrors bearerActiveAccount: 401 no-token DB-free, 403 read-only scope, 403 moderation-locked; logoutGuard mirrors the logout arm: any token that maps to an account, NO scope/moderation gate so a banned/deactivated account can still sign out), NOT the problem+json requireAccount (the no-auth goldens pin {error:'not authenticated'} and the client prose-matcher is not code-aware until Phase 22). The deactivate hooks (AccountGameHooks) are INJECTED at boot via configureAccountRuntime; the companion-token TTL (24*90) is a MOVED named constant. The account handlers SELF-READ their body (no withBody), so no stream double-read.
- TWO new knownDeviations (both introducedInPhase 13): `companionTokenMethodFan` (the method-agnostic companion arm, split into 3 RouteDefs, now answers 405 + Allow before auth for an unsupported method where the legacy arm 404'd after auth / 401'd unauth; sibling to planned405BeforeAuth) and `accountBodyValidationRemap` (the self-reading account POST handlers surface a malformed/over-cap/null body throw as 500 problem+json vs the legacy outer-catch 500 {error:'internal error'} - same 500 STATUS, different body shape, NO 400/413 remap because there is no withBody; not corpus-tested).
- NO error_codes append, NO S3 change, NO DDL/JSONB, NO src/sim, NO WS wire, NO IWorld/matcher-logic change.
- Validation GREEN: tsc 0; full `npm test` 674 files / 7221 pass / 11 skip; build:env + build:server + build exit 0; check:admin 0/0; ci:changed exit 0; the acceptance grep prints nothing; Stop-hook floor clean. New tests: tests/server/account.test.ts (29) + tests/server/rate_limit_copy.test.ts (5); completeness.test.ts MIGRATED_ROUTES +16 (36 total, method-aware, companion-token path x3).
- In-phase reviewers (all 3 in parallel; cross-platform-sync/migration-safety/architecture-reviewer correctly SKIPPED - no IWorld/wire/matcher-logic, no DDL/JSONB, no src/sim): privacy-security-review 0 CRITICAL / 0 SHOULD-FIX (all 6 security decisions + parameterized-SQL/IDOR/logging PASS; 2 INFO by-design); qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX / 3 NICE; independent correctness reviewer 0 BLOCKING / 0 SHOULD-FIX (byte-parity-correct + matcher-safe, all 16 routes diffed) / 2 NICE. Applied ALL findings (apply-all): (qa) a deactivate full-chain test proving the injected AccountGameHooks fire through the handler (anyCharacterOnline consulted -> disconnectAccount on success; 409 when online, no disconnect) + the useRuntime()-null throw + the passwordHandler/logoutHandler callerToken-null defensive re-guards (+5 tests, via a per-file vi.mock spread of the deactivate-path db/auth/email reads); (correctness) tightened the companionTokenMethodFan intendedBehavior wording (the dispatcher DELEGATES a methodNotAllowed resolve to the legacy ladder, so the 405 is served only at the Phase 25 ladder deletion, same as planned405BeforeAuth); (qa) corrected the accountBodyValidationRemap currentBehavior wording (companion create/revoke self-read in the route handler, not a handleAccount* fn). Re-validated GREEN (tsc 0; full npm test 674 / 7221; ci:changed 0). Next: Phase 13 QA (phase-13-qa.md).

### Phase 13 QA gate (2026-07-01): PASS-WITH-FOLLOWUPS

Dedicated QA re-verification (Opus 4.8, xhigh). Full validation matrix GREEN at the host: tsc 0; full `npm test` 674 files / 7222 pass / 11 skip (was 7221; the accountBodyValidationRemap test is +1, the deactivate-email assertion strengthens an existing test); build:env + build:server + build exit 0; check:admin 0/0; ci:changed exit 0; `npm run i18n:admin` regenerates the admin resolved copy IDENTICALLY (git clean, not hand-edited). DASH-SCAN CORRECTION: the phase-13-qa.md matrix's `grep -rnP "\x{2014}"` is a SILENT false-negative on macOS BSD grep (no -P), AND a naive `perl -ne '/\x{2014}/'` is ALSO a false-negative (it byte-scans; a UTF-8 em dash is 3 bytes and never matches the wide char) - only `perl -CSD` (UTF-8-decoded) is authoritative. The authoritative scan found: server/main.ts + both admin en_CA files are U+2014/U+2013-clean; the four rate-limit strings are the comma form (rate_limit_copy.test.ts pins this via a JS-string .includes, which is correct). TWO pre-existing dashes surfaced that the em-dash-only acceptance check missed: (a) server/account.ts had 7 U+2014 in its handleAccount* comment banners (commit 07ff069a, NOT Phase 13 lines) - FIXED here (swapped to colons; the U+2500 box-drawing separators are not a banned char, left); (b) src/main.ts:4322 has a U+2013 en dash in a player-facing "no data" placeholder `setAll(accountEls, '-')` (commit 53bf3108, unrelated game-client stats code) - NOT fixed (out of Phase 13's rate-limit/comment scope; a separate player-copy/i18n concern, flagged for a future pass). Independent host parity check confirmed all 16 migrated handlers byte-identical to their retained legacy arms and activeGuard/logoutGuard exact mirrors (order + DB-free short-circuits).

Audit: a 5-dimension multi-agent audit (correctness, test-coverage, dead-code, privacy-security-review, qa-checklist) + a 2-lens adversarial verify pass. 6 raw findings -> 1 survivor; privacy-security CLEAN (0 BLOCKING / 0 SHOULD-FIX); correctness CLEAN (0 BLOCKING / 0 SHOULD-FIX). 0 BLOCKING, 0 SHOULD-FIX overall.
- Applied (apply-all): (1) refreshed the stale server/account.ts module header (it still described the pre-migration shape: "no module-private seam", "main.ts resolves the bearer once", "all four routes"); (2) removed a new `noUnusedImports` warning on `emailAccountDeleted` in tests/server/account.test.ts by turning it into a real assertion that the deactivate flow emails the account (strengthens the deactivate success path end to end); (3) added an `accountBodyValidationRemap` deviation test (POST /api/account/companion-token with a malformed body -> 500 application/problem+json internal.error), pinning the deviation the way companionTokenMethodFan already was; (4) removed the 7 pre-existing U+2014 em dashes from the server/account.ts handleAccount* comment banners (qa-checklist NICE-TO-HAVE; comment-only, and Phase 13 was the declared em-dash lockstep for the files it touched).
- Deferred (refuted NICE-TO-HAVE, low value): a companion-token golden cross-check (the random minted token precludes a byte-golden; the existing unit assertions on token shape/label/scope/expiry are the correct pin); per-adapter drive tests for the 6 pure forwarders whoami/setEmail/emailChange/export/marketing/2fa (type-distinct args make a swap a tsc error, ctxAccountId threading is already pinned by the deactivate + companion tests, and the domain fns are covered by account_server.test.ts); a present-token forwarding assertion for unsubscribe (byte-identical to the already-pinned emailVerifyHandler; pinning it would require expanding the shared db mock for marginal value).

## Phase 14: Migrate wallet + cards (server/wallet.ts)

Deliverables:
- [x] Ported the wallet / card / referral surface onto `server/wallet.ts` `export const routes` (7 RouteDefs): POST /api/wallet/link/challenge, POST /api/wallet/link, DELETE /api/wallet/link, GET /api/wallet, GET /api/woc/balance (PUBLIC), POST /api/card (binary), GET /api/referrals. The route layer was APPENDED to server/wallet.ts (like account.ts); registry.ts spreads `...walletRoutes` into apiRoutes. Legacy handleApi arms KEPT for flag-off rollback (removed Phase 25).
- [x] Preserved the ip+account limiter position and the card pre-auth byte-cap short-circuit. CORRECTION vs the doc: the existing walletLinkRateLimited / cardUploadRateLimited are a SINGLE fused call recording BOTH the IP and account buckets, so they mount as one rateLimit(WALLET_LINK_POLICY / CARD_UPLOAD_POLICY) middleware AFTER activeGuard (ctx.account set); there is no separate pre-auth IP-only tier for wallet/card (splitting would double-count and change behavior). The card pre-auth 413 + Connection: close short-circuit is preserved as a dedicated cardContentLengthGuard mounted BEFORE activeGuard, reusing the existing MAX_CARD_BYTES via cardUploadContentLengthTooLarge (no new literal).
- [x] Gave the four previously-raw `{error:'rate limited'}` 429s (wallet link challenge, wallet link, woc balance, card) a stable machine code: on the new path the limiter is a rateLimit(policy) middleware that throws HttpError(429, 'rate_limit.exceeded', {retryAfterSeconds}), serialized as RFC 9457 problem+json (with Retry-After). The code ALREADY existed in error_codes.ts (harvested Phase 7, reused by the Phase 12 character limiters), so NO catalog append. The legacy prose arms are unchanged for rollback (the `rateLimitedBodyToCode` known deviation, introducedInPhase 14).

QA:
- [x] Fixes applied (biome format on the 2 flagged files; no logic fixes needed)
- [x] Tests added (tests/server/wallet.test.ts 12, card_route.test.ts 5, woc_referrals_route.test.ts 8; completeness.test.ts MIGRATED_ROUTES +7; parity.test.ts dedicated card-413 + card-401 re-pins)
- [x] Dead code removed (n/a: the walletChallengeCore/walletLinkCore split leaves the legacy self-limiting handlers intact for rollback, both used)
- [x] Reviews clean: privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 6 security invariants PASS: auth-scope parity, fused ip+account limiter post-auth with no double-count, pre-auth 413 byte cap, server authority / no IDOR, coded-429 leak-free, parameterized SQL); qa-checklist READY 0 BLOCKING (all 7 acceptance criteria verified from code, independent re-run tsc 0 + 45/45 in-scope + dash scan clean). migration-safety / cross-platform-sync / architecture-reviewer correctly SKIPPED (no DDL/JSONB, no IWorld/wire/matcher, no src/sim).

Notes:
- CARD IS NOT withRawBody (doc-vs-code correction): handleCardUpload SELF-READS the binary body via readBinaryBody (mid-stream cap intact) and returns a JSON body ({url,ref} success; {error} errors), NOT a binary response. Composing withRawBody would double-consume the stream (the account.ts self-read lesson). So the card RouteDef uses [cardContentLengthGuard, activeGuard, rateLimit(CARD_UPLOAD_POLICY)] + the self-reading handler; the pre-auth 413 short-circuit is the dedicated guard, not withRawBody. The parity harness card_too_large_413 fixture is byte-identical old-vs-new (413 + Connection: close + {"error":"image too large"}).
- Auth via a per-route activeGuard mirroring bearerActiveAccount EXACTLY (401 no/bad/unknown token DB-free-then-lookup, 403 read-only BEFORE the moderation read, 403 moderation-locked with status.message), NOT the problem+json requireAccount (the no-auth goldens pin {error:'not authenticated'} and the client prose-matcher is not code-aware until Phase 22). GET /api/woc/balance is PUBLIC (on-chain balances are public), so it carries only rateLimit(WOC_BALANCE_POLICY), no auth guard (matching the legacy arm). The wallet challenge/link handlers were split into a self-limiting legacy handler (kept for rollback, prose 429) + a limiter-free walletChallengeCore/walletLinkCore the new RouteDef calls after the coded-429 middleware, so the fused ip+account bucket is recorded EXACTLY ONCE per request on either path.
- The card level lookup (game.liveLevelForCharacter) is the one main.ts-local singleton, INJECTED at boot via configureWalletRuntime (WalletGameHooks); the guard db reads are bundled behind setWalletDbForTests. Referrals + woc handlers keep their direct db.ts / woc_balance.ts imports.
- ONE new knownDeviation `rateLimitedBodyToCode` (introducedInPhase 14, routes wallet-link-challenge / wallet-link / woc-balance / card): the four 429 bodies change from {error:'rate limited'} prose to problem+json rate_limit.exceeded on the new path. NOT corpus-tested (runParity resets every limiter bucket per pass, so a bucket is never drained); documented, not harness-caught. Adding /api/card to the ledger masks it in the path-scoped parity filter, so the card pre-auth 413 byte-identity is re-pinned by a dedicated captureBothModes assertion in parity.test.ts + the card_route unit test (toEqual against the golden).
- NO error_codes append, NO S3 change, NO DDL/JSONB, NO src/sim, NO WS wire, NO IWorld/matcher-logic change. Determinism preserved (limiter tests pin setRateLimitClock; no Date.now/Math.random in the new limiter test paths).
- Validation GREEN: tsc 0; full `npm test` 677 files / 7249 pass / 11 skip (was 674 / 7222; +3 files, +27 tests incl. the QA-added walletBodyValidationRemap + card-401 re-pin); build:server 0; ci:changed exit 0 (only pre-existing noExplicitAny warnings); parity harness byte-identical old-vs-new; error_codes append-only 9 green; perl -CSD dash/emoji scan over all changed files clean.
- Applied ALL review findings (apply-all; both reviewers 0 BLOCKING): (1, both) documented the usage-metric drift in the rateLimitedBodyToCode deviation reason (the four provider_usage *.rate_limited counters + the wallet *.request counters are not emitted on a throttled new-path 429 because rateLimit() throws before the handler; observability-only, flag-gated, admin-dashboard undercount once API_DISPATCH flips at Phase 25; the rateLimit middleware is generic so documenting is the correct resolution; structured metrics are Phase 23); (2, privacy-security) added the NEW `walletBodyValidationRemap` known deviation (routes wallet-link-challenge + wallet-link: the self-reading cores surface a malformed/over-cap/null body throw as 500 problem+json vs the legacy outer-catch 500 {error:'internal error'}, NO 400/413 remap since no withBody; the card route is EXCLUDED because handleCardUpload catches its own readBinaryBody reject with a byte-identical 413/400; sibling to accountBodyValidationRemap) + a unit test pinning it (POST /api/wallet/link/challenge with '{ not valid json' -> 500 application/problem+json internal.error); (3, qa NICE) added a dedicated /api/card no-auth 401 captureBothModes re-pin in parity.test.ts (mirroring the 413 re-pin) so the path-scoped deviation mask cannot hide an auth-shape break on the card route.
- FILED FOLLOW-UP (both reviewers SHOULD-FIX, resolve as a scheduled step NOT in this phase): the activeGuard (with bearerToken + BEARER_PATTERN + NOT_AUTHENTICATED + READ_ONLY_TOKEN) is now the THIRD byte-identical copy of the bearerActiveAccount mirror (server/characters.ts + server/account.ts + server/wallet.ts) - rule-of-three has fired. The clean fix is a shared db-seam-parameterized bearer-guard middleware, but extracting it would touch two already-shipped, byte-parity-pinned surfaces that also carry sibling guards (readGuard, logoutGuard), so it belongs in a dedicated packet step (a natural fit alongside Phase 22/25), not this small wallet migration. A code comment at server/wallet.ts activeGuard records this; DO NOT add a 4th copy in Phase 15+ (extract instead when the next domain needs the guard).
- QA GATE (phase-14-qa.md) DONE (2026-07-01): PASS, 0 BLOCKING / 0 SHOULD-FIX. Independent 5-dimension audit (correctness / test-coverage / dead-code / privacy-security-review / qa-checklist) + per-finding adversarial verify. correctness PASS (all 13 acceptance criteria met; the 3 planning-doc mis-statements confirmed superseded by byte-parity deviations), dead-code PASS, privacy-security-review PASS (re-run free-text after the workflow's schema-forced agent hit the StructuredOutput 5-retry cap; all 6 security invariants preserved), qa-checklist READY (its findings are documented Phase 22/23/25 deferrals), test-coverage PASS-WITH-ISSUES. The one SHOULD-FIX (DELETE /api/wallet/link had no route-chain behavioral test) adversarially downgraded to NICE (latent route, shared activeGuard exhaustively tested, one-line delegation, a mis-wire fails closed via ctxAccountId 500) but APPLIED anyway (apply-all). Coverage added: tests/server/wallet.test.ts +4 (DELETE /api/wallet/link no-auth 401 + authed 200 {unlinked:true} unlinking account 7; GET /api/wallet authed 200 {wallet:{pubkey,linkedAt}} + null variant, via a per-file vi.mock of db.ts unlinkWallet/walletForAccount) and tests/server/card_route.test.ts +2 (card success 200 {url,ref} + 404 pass through the [cardContentLengthGuard, activeGuard, rateLimit] chain as application/json, pinning the JSON-not-binary correction on the 200/404 paths, via a vi.fn(actual.handleCardUpload) wrapper that keeps the real handler for the existing 400/429 drain). Re-validation GREEN: tsc 0; full npm test 677 files / 7255 pass / 11 skip (was 7249, +6 QA tests); build:server 0; ci:changed exit 0 (only pre-existing noExplicitAny warnings); the 6 Phase 14 suites + error_codes append-only 62 green; biome clean on both changed files; perl -CSD dash/emoji scan clean. NICE deferrals recorded (not dropped): the throttle-path telemetry drift (documented in rateLimitedBodyToCode, owned by Phase 23) and the rule-of-three bearer-guard extraction (a dedicated step near Phase 22/25) stand as filed follow-ups.

## Phase 15: Migrate reports + telemetry + misc (server/reports.ts)

Deliverables:
- [x] Ported the four leftover write/telemetry endpoints onto `server/reports.ts` `export const routes` (4 RouteDefs): POST /api/reports, POST /api/bug-reports (account-gated writes), POST /api/perf-report, POST /api/site-presence (public telemetry beacons). registry.ts spreads `...reportsRoutes` into apiRoutes. Legacy handleApi arms KEPT for flag-off rollback (removed Phase 25); main.ts grew only the configureReportsRuntime boot call + import (it did NOT shrink, same rollback-retention model as Phase 10 to 14; the doc's "it shrank" is the Phase-25 end-state).
- [x] Added the NEW reports.create per-account limiter (labeled behavioral, the newLimiterReportsCreate deviation): `rateLimit(REPORTS_CREATE_POLICY)` mounted AFTER activeGuard, a fused per-IP AND per-account sliding window (server/ratelimit.ts reportsCreateRateLimited, REPORTS_CREATE_MAX_PER_MINUTE = 10 over the shared 60s WINDOW_MS, mirroring cardUploadRateLimited), throwing HttpError(429, 'rate_limit.exceeded', {retryAfterSeconds}) serialized as RFC 9457 problem+json. The code ALREADY existed (harvested Phase 7), so NO error_codes append. Bug reports keep their EXISTING handler-level BugReportRateLimitError -> 429 (createBugReport self-limits at BUG_REPORT_RATE_LIMIT = 5/hour); NOT re-implemented.
- [x] Preserved perf_report's 200-on-throttle (rateLimitedPerfReport / shouldStorePerfReport both answer 200, never 429; handlePerfReport unchanged) and site_presence's 405 ownership. CORRECTION vs the doc: perf-report's 405 {ok:false} branch is DEAD CODE via the dispatcher (its legacy arm gates on POST, so a GET falls to the 404 unknown-endpoint arm); only site-presence's 405 is live (URL-only legacy arm). Both routes are registered POST-only, so a non-POST resolves methodNotAllowed and the Phase 9 dispatcher DELEGATES it to the retained legacy ladder, preserving perf-report's 404 fall-through and site-presence's handler-owned 405 {ok:false, error:'method not allowed'} byte-identically. site-presence stays reachable independent of REQUIRE_WEB_LOGIN (no web-login guard on the route; the legacy prologue only ever gated register/login).

QA:
- [x] Fixes applied (biome format on the changed/new files; applied the one qa NICE nit: a malformed-bearer db-free 401 test)
- [x] Tests added (tests/server/reports.test.ts 24, tests/server/reports_telemetry.test.ts 9; completeness.test.ts MIGRATED_ROUTES +4 method-aware; parity.test.ts reports_post_noauth_401 re-pin + limiter reset lockstep in helpers/parity.ts + the local isolate())
- [x] Dead code removed (n/a: the legacy handleApi arms are RETAINED for rollback, both used; no dead code introduced)
- [x] Reviews clean: privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 8 security invariants PASS high-confidence: auth-scope parity byte-identical, no IDOR [account-scoped reporter + verified-owned bug character; cross-account target resolution unchanged], limiter fail-closed + ordered after the guard, body caps preserved incl. dev-trace gating, zero raw SQL, screenshot/meta sanitization intact, public beacons no-auth + site-presence web-login-independent, rollback-safe behind the default legacy flag; 2 INFO no-action); qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX (all 10 acceptance criteria verified from code + independent re-run tsc 0 + 554 http/reports suites green + dash scan clean; 1 NICE nit APPLIED). migration-safety / cross-platform-sync / architecture-reviewer correctly SKIPPED (no DDL/JSONB, no IWorld/wire/matcher, no src/sim).

Notes:
- PARITY-FIRST bodies (the canonical Phase 10 to 14 pattern; docs/api-pipeline/state.md wins over the phase file's coded-error / requireAccount / append-codes language, which is the Phase-22 end-state). The migrated handlers write the SAME legacy {error} / {ok} bodies byte-for-byte: the client prose-matcher (src/main.ts userFacingApiError) plus the hud.ts / options-window report/bug matchers key on the EXACT legacy prose until Phase 22, so coded problem+json would break live localization AND the reports_post_noauth_401 golden. Auth is the shared legacy-body activeGuard, NOT requireAccount. NO error_codes.ts append.
- The activeGuard was EXTRACTED (rule-of-three fired: it was the byte-identical 3rd copy across wallet.ts/characters.ts/account.ts, and the Phase 14 review said "do NOT add a 4th copy in Phase 15+; extract when the next domain needs the guard"). NEW `server/http/middleware/bearer_active_guard.ts` exports `createActiveGuard(getDb)` (+ NOT_AUTHENTICATED / READ_ONLY_TOKEN / bearerToken / BearerActiveGuardDb); reports.ts consumes it via `createActiveGuard(() => reportsDb)` with a setReportsDbForTests seam. The three existing inline copies are NOT retrofitted (that touches shipped byte-parity-pinned surfaces carrying sibling readGuard/logoutGuard, so it stays the dedicated Phase 22/25 step); the extraction adds NO 4th copy.
- SELF-READ bodies (no withBody anywhere): reports self-reads at the 64 KB default; bug-reports self-reads at a 1 MB cap (BUG_REPORT_MAX_BODY_BYTES, named) with its OWN try/catch preserving 413 {error:'bug report too large'} / 400 {error:'bad request'} byte-identically; perf-report / site-presence self-read inside their handlers. The report handler needs the one main.ts-local singleton (game.reportTargetForPid), INJECTED at boot via configureReportsRuntime (ReportsGameHooks); every other domain fn keeps its direct db import.
- NO raw SQL in server/reports.ts (all persistence delegates to moderation_db / bug_report_db / admin_db / db / perf_report / site_presence). NO error_codes append, NO S3 change, NO DDL/JSONB, NO src/sim, NO WS wire, NO IWorld/matcher-logic change.
- knownDeviations: realized the pre-seeded `newLimiterReportsCreate` (introducedInPhase 15, /api/reports, the coded-429 limiter) and added `reportsBodyValidationRemap` (introducedInPhase 15, routes /api/reports + /api/bug-reports + /api/perf-report + /api/site-presence): the four self-reading handlers surface an unexpected body throw (a readBody reject on an over-cap/malformed body, or a rethrown non-rate-limit createBugReport error) as 500 problem+json (internal.error) vs the legacy outer-catch 500 {error:'internal error'} - same 500 STATUS, different body shape, NO 400/413 status remap (no withBody). Sibling to accountBodyValidationRemap / walletBodyValidationRemap; not corpus-tested (valid-body corpus). NARROWED `validationStatusRemap` routes to ['/api/register'] (removed /api/reports + /api/bug-reports): under parity-first self-read they get NO 400/413 status remap - reports 500s on a bad body, bug-reports keeps its own byte-identical 413/400 prose - so the pre-seeded 422/400/413 intent no longer applies to them; their 500 body-shape is reportsBodyValidationRemap.
- Adding /api/reports and /api/site-presence to the ledger masks their whole paths in the path-scoped parity filter, so their corpus fixtures are re-pinned by dedicated captureBothModes assertions in parity.test.ts (a NEW reports_post_noauth_401 re-pin: no-bearer POST 401s at activeGuard byte-identical; site_presence_get_405 was already re-pinned by the Phase 9 heartbeat test). The reports.create limiter bucket is reset in isolatePass (helpers/parity.ts) + the local isolate() for lockstep (harmless today: the reports corpus request 401s before the limiter runs).

Phase 15 QA gate (phase-15-qa.md, dedicated independent audit, 2026-07-01): PASS, 0 BLOCKING / 0 SHOULD-FIX. A four-track fan-out re-verified the committed diff against the authoritative parity-first fork (state.md wins over the phase file): a Workflow ran correctness + test-coverage + dead-code with a per-finding adversarial-refute stage, alongside the two required domain reviewers (privacy-security-review + qa-checklist) run as plain free-text Agents; migration-safety / cross-platform-sync / architecture-reviewer correctly SKIPPED (no DDL/JSONB, no IWorld/wire/matcher, no src/sim). All 9 acceptance criteria PASS against the real code. privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (createActiveGuard fails closed on all four reject paths and ctxAccountId 500s if the guard is missing; the fused ip+account reports.create limiter is post-guard with no cross-account leak; no IDOR in report-target resolution, all SQL parameterized in the *_db modules; the bug-report 1 MB cap is enforced mid-stream with the PR #811 screenshot allowlist + meta clamp intact). qa-checklist READY 0/0/0 (it independently confirmed the path-scoped mask over /api/bug-reports + /api/perf-report hides zero coverage, and the extracted guard adds no 4th copy). Six NICE-TO-HAVE surfaced. Per apply-all, the three in-scope low-risk coverage nits were APPLIED (test-only, one commit ed5d3c00):
- A dedicated captureBothModes parity assertion pinning GET /api/perf-report -> 404 byte-identical old-vs-new. The test-coverage reviewer suggested a corpus fixture, but /api/perf-report is masked by three known deviations (perfReport200NotThrottle, perfReportSitePresence405OkFalse, reportsBodyValidationRemap) so a plain fixture would be filtered out; the mask-aware fix is a captureBothModes re-pin mirroring site_presence_get_405 (the head-parity-gotcha).
- A reports invalid-reason case exercising the cleanReportReason allowlist-miss branch (a present-but-invalid reason string 400s 'choose a report reason'), which the missing-reason {} case does not reach.
- A strengthened comment on the site-presence web-login-reachability proxy pointing at tests/web_login_guard.test.ts (the prologue is a main.ts concern outside the RouteDef; webLoginEnforced / isWebClientRequest are tested there).
The other three NICE were deferred with a note, NOT dropped: the bug-report and site-presence per-route limiter gaps are PRE-EXISTING parity behavior and adding a limiter is the Phase 19 two-tier rework explicitly OUT OF SCOPE here (applying it would trip a STOPPING RULE); the guard's exported NOT_AUTHENTICATED / READ_ONLY_TOKEN / bearerToken are the contract-sanctioned transitional surface for the deferred Phase 22/25 retrofit (the finding's own recommendation is leave-as-is). Re-validation GREEN (pre-merge mirror): tsc 0; full npm test 679 files / 7291 pass / 11 skip (was 7288 at Phase 15 impl, +2 QA coverage tests); build:env 0; build:server 0; build 0; the affected reports + telemetry + http suites 493 green; biome clean on the 3 changed test files; perl -CSD dash/emoji scan over the added lines clean. Committed-not-pushed (shared worktree). Next: Phase 16.

## Phase 16: Migrate Discord family (server/discord.ts), net-new since SPEC

The SPEC premise was STALE (it predates PR #1044/#1075). Verified ground truth first: DISCORD_SCHEMA is ALREADY wired into ensureSchema (db.ts) with a guard test (schema_wiring.test.ts) since PR #1075; the family is SEVEN routes not five (PR #1075 added /api/auth/discord/login/new + /login/link, which already carry isIpBlocked); and DISCORD_POLICY is already pre-seeded in rate_limit.ts. The maintainer chose (1) migrate ALL SEVEN routes and (2) "do what is best for the project" on the DDL. So the schema is left wired-as-is (no new runtime boot assertion: it would be a boot-behavior change with no remaining justification now that the regression is already guarded at test time), and the persistence deliverable is completed with an idempotent-DDL re-run test instead.

Deliverables:
- [x] Ported ALL SEVEN Discord endpoints onto `server/discord.ts` `export const routes` (7 RouteDefs): POST /api/auth/discord/start, GET /api/auth/discord/callback (HTML bounce, meta.envelope 'html', NEVER problem+json), POST /api/auth/discord/login/new, POST /api/auth/discord/login/link, GET /api/discord (status), DELETE /api/discord (unlink), POST /api/discord/swag/claim (previously ORPHANED, now reachable). registry.ts spreads `...discordRoutes`. Legacy handleApi arms KEPT for flag-off rollback (removed Phase 25); main.ts grew only the configureDiscordRuntime boot call + import.
- [x] PARITY-FIRST (the canonical state.md pattern, wins over the phase file's coded / discord.*-codes / turnstile language, which is the Phase-22 end-state). The thin handlers reuse the existing handleDiscord* functions UNCHANGED, so every body is byte-identical: the rate limit stays legacy prose { error: 'rate limited' } (NOT the coded rateLimit(DISCORD_POLICY) adapter; the pre-seeded DISCORD_POLICY stays UNMOUNTED until Phase 22), auth on status/unlink/swag is the shared legacy-body createActiveGuard (NOT problem+json requireAccount), NO error_codes.ts append. start self-limits in-handler (dropping the legacy double-count on the new path); status/unlink carry the discordActiveRateGuard (the check the legacy arm ran in main.ts, moved behind the guard); swag self-limits inside handleSwagClaim (no rate guard, no double-count).
- [x] Closed the isIpBlocked gap the PR #1044 / #1075 reviews flagged: isIpBlocked applied on start (opaque 429 { error: 'rate limited' }, matching login/new + login/link) and on callback (opaque HTML bounce reusing the existing 'server_error' vocabulary, so the block is never revealed and the callback stays HTML). login/new + login/link already carried isIpBlocked. passesTurnstile DELIBERATELY not added (the Discord flow carries no turnstile token, so a gate would 403 every prod login; the OAuth itself is the human-check, matching login/new + login/link). Documented in the newLimiterDiscord deviation.
- [x] Persistence: DISCORD_SCHEMA is already wired into ensureSchema under the advisory lock (PR #1075). Strengthened the existing schema_wiring.test.ts wiring guard to cover all five AC tables (discord_links, discord_oauth_states, reward_points, reward_ledger, swag_claims) and added an idempotent-DDL re-run test (a second ensureSchema boot issues identical statements; the Discord DDL is entirely CREATE TABLE / INDEX IF NOT EXISTS + ADD COLUMN IF NOT EXISTS, so a re-run is a no-op). NO new runtime boot assertion (per the maintainer's "best for the project": a boot-behavior change with no remaining justification).
- [x] Client matcher: the discordRateLimited { error: 'rate limited' } gap is closed with a single userFacingApiError arm (src/main.ts) resolving 'rate limited' -> t('errors.api.tooManyAttempts') (an EXISTING key, so no new key, no M16 non-Latin fills). The choice panel already handled 'rate limited' inline. swag has no client caller (the widget shows a badge but never posts), so its reachability is the deliverable. NO Discord error codes appended (Phase 22 owns the coded emission + the comprehensive per-surface parity guard + the apiError.* catalog).
- [x] Swag live grant: the previously-orphaned handleSwagClaim's grantCosmetic hook is wired via configureDiscordRuntime -> a NEW public game.grantMechChromaToAccount(accountId, chromaId) (mirrors the private session-scoped noteAccountMechChroma; best-effort persist + live-session push, account-scoped so no cross-account grant).

QA:
- [x] Fixes applied (apply-all: 3 in-scope coverage/comment nits, see the QA paragraph below)
- [x] Tests added (tests/server/discord.test.ts NEW, 26 tests; tests/schema_wiring.test.ts +1 idempotency test + the all-tables assertion; completeness.test.ts MIGRATED_ROUTES +7 + the swag-orphan skip; parity.test.ts +4 captureBothModes re-pins; known_deviations.ts +discordBodyValidationRemap)
- [x] Dead code removed (n/a: the legacy handleApi Discord arms are RETAINED for rollback until Phase 25; no dead code introduced)
- [x] Reviews clean: privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 11 checks PASS: auth-guard parity byte-identical, isIpBlocked opaque + placed correctly, turnstile omission defensible, unlink + swag caller-scoped [no IDOR], grantCosmetic grants only to the caller's own account, rate-limit behind auth + start no-double-count, callback never problem+json verified end-to-end, no secret/PII/SQL/determinism regression, deviation coverage complete; 3 NICE/INFO no-action). migration-safety 0 BLOCKING / 1 WARNING (a PRE-EXISTING non-atomic accounts.cosmetics read-modify-write, deferred) / 2 INFO (applied). qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX (all 9 acceptance criteria PASS against the real code + green gates; 4 NICE). cross-platform-sync + architecture-reviewer correctly NOT dispatched (no IWorld/wire/sim_i18n/server_i18n, no src/sim; src/main.ts touches only the client REST-error matcher, outside the trigger set).

Notes:
- QA apply-all (2026-07-01): all three reviewers reported 0 BLOCKING / 0 SHOULD-FIX. APPLIED the 3 in-scope nits (test/comment only): (1) a callback ESCAPING-THROW contract test (discord.test.ts) driving the real callback RouteDef with a throwing runtime.isIpBlocked and asserting the withErrors boundary serializes it as 500 text/html, never problem+json (pins the meta.envelope 'html' contract on the error path end-to-end, not just structurally); (2) clarified the schema_wiring.test.ts toEqual comment (it pins HARNESS determinism against the recording mock, not real-DB idempotency; the IF-NOT-EXISTS regex block is the real no-op guarantee); (3) crisped the schema_wiring "six tables" comment. DEFERRED-with-note (NOT dropped): the migration-safety WARNING is a PRE-EXISTING non-atomic load-modify-save of accounts.cosmetics in grantAccountMechChroma (shared by noteAccountMechChroma + markAccountQuestComplete; a last-write-wins race window), which Phase 16 newly REACHES from the swag route but does NOT introduce; fixing it changes a shared db function used by 3+ callers (a behavior change beyond a route migration) and the swag route has NO client caller today (the widget shows a claim badge but never POSTs), so the window is currently theoretical; flagged for a conscious dedicated change. Also deferred (no action): the swag error strings ('unknown swag item', etc.) have no client matcher but no client caller either (add matchers when a caller lands); the userFacingApiError 'rate limited' arm is not unit-tested (src/main.ts is the DOM-coupled client firewall, not Node-importable; the Phase 11 extract-the-matcher follow-up owns it); the isIpBlocked gap-closure is latent behind API_DISPATCH until the Phase 25 flag flip (the expected staged-migration model, documented in newLimiterDiscord).
- knownDeviations: enriched the pre-seeded `newLimiterDiscord` (introducedInPhase 16: start's new-path single-count + the isIpBlocked opaque gate on start/callback + the deliberate turnstile omission) and `swagClaimOrphanUnreachable` (realized: swag is now router-owned only, no legacy arm ever existed, so it serves on the new path only until Phase 25); enriched the by-design `discordCallbackHtmlNotRedirect` (the RouteDef pins meta.envelope 'html' so an escaping throw stays HTML, never problem+json); ADDED `discordBodyValidationRemap` (introducedInPhase 16, all 7 routes): an unexpected handler/DB throw surfaces as 500 problem+json (JSON routes) or 500 HTML (callback) via the withErrors boundary vs the legacy outer-catch 500 { error: 'internal error' } - same 500 STATUS, different body shape, NO 400/413 remap (readJsonBody swallows a bad body to {}). Sibling to accountBodyValidationRemap / walletBodyValidationRemap / reportsBodyValidationRemap.
- `newLimiterDiscord` masks all four Discord corpus fixtures (start-503, status-401, unlink-401, callback-bounce-503) in the path-scoped parity filter, so each is re-pinned by a dedicated captureBothModes assertion in parity.test.ts proving the migrated path stays byte-identical to the legacy arm (the head-parity-gotcha). The discord bucket reset was already in isolate()/isolatePass.
- completeness.test.ts MIGRATED_ROUTES +7 (method-aware; /api/discord listed twice GET+DELETE); the swag orphan is skipped from the must-be-legacy-served assertion (it is router-owned only, its own 'excludes the documented unreachable swag-claim orphan' test pins the SURFACE_INVENTORY unreachable flag). completeness title extended to Phase 16.
- NO error_codes append, NO S3 change, NO DDL change (schema already wired), NO JSONB shape change, NO src/sim, NO WS wire, NO IWorld/matcher-logic change. Determinism/sim-purity untouched (game.grantMechChromaToAccount is server-side account cosmetics, no sim state).
- Minor duplication filed, not extracted: start's inline resolveActiveAccount mirrors createActiveGuard for its link-mode-only conditional auth (the shared guard cannot be a plain route middleware on a route that also serves an unauthenticated login mode); a candidate for the Phase 22/25 shared bearer-resolver consolidation alongside the three inline activeGuard copies.

Phase 16 QA gate (phase-16-qa.md, dedicated independent audit, 2026-07-01): PASS, 0 BLOCKING / 0 SHOULD-FIX surviving verification. Six-track fan-out re-audited the committed diff against the ratified design (the two maintainer forks + parity-first prose, state.md wins over the phase file): a Workflow ran correctness + test-coverage + dead-code/cleanup + an adversarial completeness critic with a per-finding 3-lens adversarial-verify stage, alongside the two required domain reviewers (privacy-security-review + migration-safety) as plain free-text Agents; cross-platform-sync correctly SKIPPED (src/main.ts touches only the client REST matcher, outside the trigger set). All 10 acceptance criteria met or met-as-amended against the real code; privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (2 INFO); migration-safety 0 BLOCKING / 0 SHOULD-FIX (3 INFO, both prior deferrals re-confirmed and NOT widened). ORCHESTRATION NOTE: the verify stage hit the session usage limit mid-run, leaving 11 findings with zero cast votes (the workflow's survives-filter mis-filed them as refuted); they were NOT dropped: the orchestrator hand-verified each against the code (all real coverage/documentation gaps, none behavioral, so the PASS verdict stands). Per apply-all, APPLIED every confirmed finding (test/comment/prose only, zero production behavior change; commits 9832a1f8 + 6f877c5b):
- The dispatcher meta.envelope threading was untested tree-wide (AC2 was mirror-deep: discord.test.ts's runRoute mirrors dispatch.ts rather than driving it). dispatch.test.ts now pins an html-enveloped route's throw serializing 500 text/html through the REAL createApiDispatcher, with the existing problem+json throw test as the un-enveloped control; composed with the discord.test.ts meta.envelope registry pin, the callback contract is now end-to-end by construction.
- login/new + login/link had resolve-only coverage (no chain test, no fixture, and their paths are masked by newLimiterDiscord). discord.test.ts drives both through the composed chain (blocked-IP 429 proving the useRuntime().isIpBlocked glue + drained-bucket 429, both db-free), and parity.test.ts adds two drained-bucket captureBothModes re-pins (429 byte-identical old-vs-new).
- The start single-count drop (and its 503-vs-429 ordering side effect) was asserted only by deviation prose. discord.test.ts now pins both: 20 unconfigured starts record ZERO limiter attempts (the RouteDef adds no pre-check; the legacy arm's 20 pre-checks would have tripped the 15-cap), and a drained+unconfigured start answers 503, never 429.
- resolveActiveAccount's read-only 403 and moderation 403 branches were untested new code; both now covered, plus the link-mode ordering contract (no bearer + blocked IP answers the ordinary 401, never 429, so the block leaks nothing; an authed link start with a blocked IP answers the opaque 429).
- The discordRateLimited ip+account dual keying was untested (the drain helper fills both keys). Two tests trip each key alone: an ip-only drain (account 0) 429s the next authed read, and an account drain from a foreign IP (via X-Forwarded-For) 429s a fresh-IP authed read.
- No swag success-path test ever invoked the grant callback. discord_server.test.ts now claims chroma_blurple end-to-end (grantCosmetic called once with the CATALOG grantId 'vanguard_azure'; the reward_points spend parameterized [1, 1000]) and proves a title-kind claim does NOT invoke the grant; the unlink DELETE is now asserted bound to the guard-resolved account id. game_sessions.test.ts covers the NEW GameServer.grantMechChromaToAccount (persists + pushes to the live session; offline persists with a no-op push).
- Hardening/prose: rate_limit_copy.test.ts text-pins the new userFacingApiError 'rate limited' arm (the DOM-coupled matcher's silent-removal guard until the Phase 11 extraction); the schema_wiring idempotency regexes are case-insensitive; the newLimiterDiscord ledger prose now scopes the 503-vs-429 reorder to BOTH start modes (it said login-only; link reorders identically) and documents the link-mode resolve-before-IP-gate ordering; the stale src/main.ts choice-panel comment (made false by this very phase) was rewritten (commit 6f877c5b).
DEFERRED-with-note (NOT dropped): authed 200-path coverage for status/unlink through the migrated chain (needs a pg-mock + route-chain hybrid harness; the 200 bodies are already pinned in tests/discord_server.test.ts against the SAME shared handlers, the chain glue by the guard/limiter/swag-reached tests, and the Phase 25 flag flip is the live E2E); the callback isIpBlocked 403-vs-500 status distinguisher (privacy-security INFO, low confidence: body opacity is preserved and matches the ratified opaque-server_error decision); the swag durability seam (transactional point spend but best-effort grantCosmetic, non-recoverable via the idempotent 409 re-claim: PRE-EXISTING pattern, latent, no client caller; a conscious durability decision when a caller lands, filed by migration-safety); the pre-existing grantAccountMechChroma read-modify-write deferral re-confirmed (Phase 16 adds a writer path, does not widen the window). Re-validation GREEN: tsc 0; full npm test 680 files / 7342 pass / 11 skip (was 7321 at phase impl, +21 QA coverage tests); the 10 affected suites 178 green; build:server 0; build 0; ci:changed exit 0 (pre-existing warnings only); parity 15 cases (+2 chooser re-pins); perl -CSD dash/emoji scan over all added lines clean. Committed-not-pushed (shared worktree). Next: Phase 17 (migrate Admin API, server/admin.ts).

## Phase 17: Migrate Admin API onto the shared seam (server/admin.ts)

The heaviest migration phase: all 32 handleAdminApi branches (login + 12 authed POST writes + the enum route + 18 GET reads) moved onto RouteDefs. PARITY-FIRST (the canonical state.md pattern wins over the phase file's coded / 403-operator-denial / isolated-limiter-store language, which is the Phase-22/19 end-state). The legacy handleAdminApi ladder is KEPT intact as the flag-off rollback path; /admin/api routes through a NEW flag-gated dispatcher (adminApiEntry) whose delegate is handleAdminApi.

Deliverables:
- [x] All 32 handleAdminApi branches ported onto `server/admin.ts` `export const routes` (RouteDefs), each `surface: 'admin'` + `meta.envelope: 'admin'` so the FROZEN { success, data, error } envelope is byte-identical (a contract test pins the success / error / data:{ ok:true } variants) and an unexpected throw serializes through withErrors' serializeAdmin (the adminBodyValidationRemap 500). The page/limit pagination contract is preserved via the existing lenient parsePageParams (page/limit, NOT page/pageSize; DEFAULT_PAGE_LIMIT + MAX_PAGE_LIMIT reused; a bad page DEFAULTS, never 422, per the Phase 10 lenient-decoder lesson: a strict schema decode would break parity). registry.ts spreads `...adminRoutes`. Legacy handleAdminApi arms KEPT for flag-off rollback (removed Phase 25).
- [x] NEW `server/http/middleware/require_admin.ts`: the admin-auth gate `createRequireAdmin(getDb)` mirrors the legacy adminAccountId(req) resolver EXACTLY (bearer -> accountForToken -> isAdminAccount, uniform 401 { ...error: 'admin authentication required' }, NO read-only-scope 403 and NO moderation gate). Mounted on every route except login (anonymous by design; its own in-handler rateLimited(req, ADMIN_LOGIN_MAX_PER_MINUTE), isolated from the new POLICIES table, kept as the legacy shared-store call). requireAdmin runs BEFORE the :id / :action decode, so an unauthenticated malformed request 401s exactly as legacy did.
- [x] Enum restructure: the legacy regex route /moderation/accounts/:id/(suspend|unsuspend|ban|unban) becomes /moderation/accounts/:id/:action with a schema-validated enum_(['suspend','unsuspend','ban','unban']); an action outside the four decodes to 422 (adminEnumInvalid422 deviation vs the legacy POST-fallthrough 405). The literal sibling routes (reactivate / chat-mute / lift-mute / note / reset-strikes) sort most-specific-first (more literal segments) ahead of :action, so each resolves to its own handler (verified). The Phase 4 no-regex-routing guard passes.
- [x] The 12 admin :id routes carry an OPERATOR-scoped loader `requireAdminTarget` (require_admin.ts): it decodes :id with num({ int, min: 1 }) -> 422 on a non-numeric / non-positive id (adminIdParamDecode deviation, sibling of characterIdParamDecode), and marks the route `meta.requireOwned.ownerScope: 'operator'` which EXCLUDES it from the account-owner deny-by-default coverage clause (checkRequireOwnedCoverage exempts operator + admin-surface :id routes). PARITY-FIRST FORK: the loader authorizes NO cross-scope object and emits NO per-object 403/404 (the operator has universal authority over every target, so requireAdmin's 401 IS the operator gate and the handlers keep their own legacy 404 'account not found'); the doc's "denial 403" is the seam for a future finer operator sub-scope, with no parity-faithful trigger on today's admin surface.
- [x] Every game.* side effect preserved via configureAdminRuntime (AdminRuntime = Pick<GameServer, ...>, so main.ts passes the live game directly): disconnectAccount, muteAccountChat, liftChatMuteLive, resetChatStrikesLive, reloadChatFilter, reloadBlockedIps, disconnectByIp, plus the live reads (adminStats, liveSessions, suspiciousPlayers, isIpBlocked, liveSharedIps, liveAccountIds). The best-effort emailSecurityIncident stays isolated. The DB reads/writes are bundled behind setAdminDbForTests, built LAZILY (makeRealAdminDb is a function, not a module-load literal) so a legacy-only test that partial-mocks an admin *_db module (tests/admin.test.ts) still imports cleanly.

QA:
- [x] Fixes applied (apply-all: SF-1 the pre-existing em dash at admin.ts:68 fixed; N-1 the systemic X-Request-Id header documented on the adminBodyValidationRemap deviation; SF-2 the docs already describe the shipped no-403 behavior)
- [x] Tests added (tests/server/admin.test.ts NEW 43; ownership_coverage operator sweep + 2 negative controls; completeness admin block; parity +8 admin dual-path re-pins; known_deviations +3)
- [x] Dead code removed (n/a: the legacy handleAdminApi ladder is RETAINED for rollback until Phase 25; no dead code introduced)
- [x] Reviews clean: privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 8 checks CLEAN high-confidence: is_admin gate un-bypassable, no SQL/stack/PII leak in any 4xx/500 incl. the adminBodyValidationRemap 500, operator loader NaN-safe + no cross-scope read, IP-block/moderation server-authority + guards preserved, admin-login limiter isolated, emailSecurityIncident isolated, parameterized SQL, no dev-command/secret exposure; 2 NICE = pre-existing legacy behaviors preserved byte-for-byte, Phase 22 owns the coded rework). qa-checklist READY 0 BLOCKING / 1 SHOULD-FIX (SF-1, applied) / 2 NICE (SF-2 done in docs, N-1 systemic-not-a-defect documented); it independently confirmed the operator-403 fork is "a defensible reading, not a gap, high confidence: met-as-amended, the amendment is the correct call". migration-safety correctly SKIPPED (no *_db DDL/schema/JSONB change), cross-platform-sync + architecture-reviewer SKIPPED (no src/sim, no wire, no client matcher).

Notes:
- Files: NEW server/http/middleware/require_admin.ts + tests/server/admin.test.ts (43 route-layer tests). Edited: server/admin.ts (the route layer appended after the frozen handleAdminApi; getBlockedIpsForAccount widened to a structural { isIpBlocked } param), server/http/registry.ts (+adminRoutes), server/main.ts (adminApiEntry dispatcher + adminLegacy delegate + configureAdminRuntime boot; setApiDispatchMode flips BOTH entries), tests/server/http/{completeness,ownership_coverage,known_deviations,parity}.test.ts + docs.
- Test harness: ownership_coverage.test.ts's Phase-17 forward guard was FLIPPED into a real operator-scope deny-by-default sweep (every operator :id route: a non-admin bearer 401s via requireAdmin + a NaN :id 422s via requireAdminTarget, both before the handler; two negative controls). completeness.test.ts gained a Phase-17 admin block that derives the expected admin route set FROM the SURFACE_INVENTORY admin ladder (enum row rewritten to :action) and asserts registers-exactly + no-dropped-branch + the literal-vs-:action specificity. parity.test.ts gained a /admin/api dual-path block: 8 DB-free admin cases byte-identical old-vs-new (the 401 gate on a read / write / enum route / wrong method / unknown endpoint, and the login db-free 401); the two auth-gated divergences (enumInvalid422, idParamDecode) are invisible there (401 precedes the decode on both paths) and are pinned with fakes in admin.test.ts.
- knownDeviations ADDED (introducedInPhase 17): `adminEnumInvalid422` (invalid action 422 vs legacy 405, auth-gated), `adminIdParamDecode` (non-numeric :id 422 vs legacy 404-fallthrough, sibling of characterIdParamDecode, auth-gated), `adminBodyValidationRemap` (an unexpected throw / bad body surfaces as 500 { ...error: 'internal.error' } via serializeAdmin vs the legacy outer-catch 500 { ...error: 'internal error' } - same status + { success,data,error } shape, only the error string differs; sibling of the other *BodyValidationRemap). All three are harness-invisible (auth-gated / need a real throw), documented not corpus-tested.
- surface_inventory.ts UNCHANGED (the legacy handleAdminApi ladder + its inline regexes are frozen, so the freshness gate passes). NO error_codes append (Phase 22), NO S3 / i18n change (the admin envelope strings are the legacy prose kept for parity; the admin dashboard SPA i18n is untouched), NO DDL / JSONB change (all admin *_db + db.ts SCHEMA unchanged; NO defined-but-unwired schema surfaced), NO src/sim, NO WS wire.
- Validation GREEN: tsc 0; full npm test 681 files / 7427 pass / 11 skip (was 680 / 7342; +1 file, +85 tests); the no-regex guard + BOLA coverage + parity all green; build:server 0; ci:changed exit 0 (pre-existing noExplicitAny warnings only, format-clean on the changed files).

Phase 17 QA gate (phase-17-qa.md, dedicated independent audit, 2026-07-01): PASS, 0 BLOCKING / 0 SHOULD-FIX surviving in production code. Four-track fan-out re-verified the committed diff (correctness + test-coverage + dead-code as plain free-text Agents, privacy-security-review as the required domain reviewer; migration-safety / cross-platform-sync / architecture-reviewer correctly SKIPPED: no *_db DDL, no src/sim, no wire, no client matcher). All 11 acceptance criteria verified MET or MET-AS-AMENDED against the real code; the two amendments were re-adjudicated (not rubber-stamped) and SIGNED OFF: (1) the operator no-403 fork is the correct parity-preserving call (the frozen legacy branches 404 an absent account, so a 403-on-absent would break byte-parity; the ownerScope 'operator' exclusion is enforced by checkRequireOwnedCoverage AND the functional sweep; the doc's "403 with bola_denied" remains the seam for a future finer operator sub-scope), and (2) the login limiter on the legacy shared rateLimited store matches legacy byte-for-byte (the isolated per-policy store is the Phase 19 end-state). privacy-security-review: all 8 checks CLEAN, no BLOCKING/SHOULD-FIX (1 INFO: num({int,min:1}) accepts a few trimmed decimal integer spellings, "+5" / "5.0" / " 5 ", where the legacy (\d+) 404-fell-through; harmless under universal operator authority and now documented on the adminIdParamDecode deviation). Correctness: all 32 migrated handlers byte-identical to their frozen legacy branches (status, prose, DB-call order, query semantics, side effects) with no divergence outside the three seeded deviations; HEAD delegates to legacy; rollback intact; enum specificity verified. Test-coverage found the real gaps; per apply-all EVERY finding was applied (test/docs only, zero production behavior change): a NEW admin auth-mounting sweep in ownership_coverage.test.ts (every non-login admin route must 401 an unauthenticated request BEFORE the handler, plus a non-vacuity negative control; requireAdmin carries no metadata marker, so this functional sweep is the only deny-by-default guarantee for the non-:id admin routes) and 27 new handler-level tests in tests/server/admin.test.ts (43 -> 70) closing the 15 previously-untested migrated handlers: perf/raw keyset hasMore + nextBeforeId math, shared-ips online=1 live-sort-slice-blocked branch AND the DB branch with sort/dir passthrough, ip-associations online/blocked mapping, moderation/queue live-ids passthrough, moderation account detail nested shape + its 404, accounts/:id online merge, chat-filter GET composite, chat-filter/config returning the UPDATED CONFIG object (not ok:true) + its reload, bug-report screenshot, characters search/sort/dir whitelist + defaults, lift-mute (db write + live push), note (body.reason -> note), the emailSecurityIncident mail NOW ACTUALLY ASSERTED (the floating void promise is flushed; derived args pinned: trimmed reason / 'not specified' / 'permanent' / expiresAt-as-until / no-target no-mail), positive-path reloads on blocked-ips/delete + word-delete, the reset-strikes 404 branch, and the ignore-report success path. Dead-code: 9 of 10 checks CLEAN; the one finding (ADMIN_TARGET_ID exported but only used module-internally) applied: now module-local. Known structural deferral (recorded, not new): the authed admin bodies stay pool-less-deferred in the parity harness exactly as characterization defers them; the new handler-level pins are the compensating control until the Phase 25 flag flip. Doc miscount fixed (12 authed POST writes, not 13). Re-validation GREEN: tsc 0; the 6 touched/guard suites 200/200; ci:changed exit 0 (pre-existing noExplicitAny warnings only); build:server 0; full CI mirror green (npm test, tsc, build:env, build:server, build); perl -CSD dash/emoji scan over all added lines clean.

Phase 17 INDEPENDENT RE-VERIFICATION (2026-07-02, full from-scratch distrust audit after the phase was produced under context pressure): CLEAN, no hallucinated behavior and no production defect found. Method: an 11-agent fan-out (6 route-slice parity auditors covering all 32 branches legacy-vs-migrated line by line + the spine wiring; acceptance-criteria walk; docs-claims hallucination hunt; test-quality audit; privacy-security-review; qa-checklist), every finding then 3-lens adversarially verified. privacy-security-review: 0 CRITICAL / 0 WARNING (is_admin gate proven on all 32 routes in both dispatch modes; no leak; SQL parameterized; side effects gated). qa-checklist: READY, 0 blocking. Acceptance walk: all 11 boxes HOLD (two as-amended per the recorded operator-403 and login-limiter forks). Confirmed findings were TEST/DOCS-ACCURACY only, all applied: (1) the adminIdParamDecode ledger currentBehavior wrongly claimed a non-positive :id "never matches" the legacy \d+ regex; in truth "0"/"00" and past-2^53 digit strings DID match and ran the handler (handler-owned 404s, a 200 { screenshot: null } on bug-reports/0/screenshot, a 200 { ok: true } on reactivate's zero-row UPDATE, pg-error 400/500 on unsafe ints), so the entry was rewritten to characterize all three legacy input classes (and the characterIdParamDecode sibling gained the unsafe-integer clause); (2) the overview merge math (the one non-trivial read computation) had no body pin: added a full merged-body test with values that make each Math.max argument win somewhere, plus bare-passthrough body pins on perf/summary and characters; (3) added the catch->400 err.message prose passthrough pins on all 7 write handlers + the non-Error fallback, the remaining guard negatives (verifyPassword-false 401, "until reviewed" mail derivation, unsuspend-passes-the-admin-guard parity, word-empty 400, blocked-ips add/delete invalid-ip 400s), an admin HEAD old-vs-new parity fixture, num() "+5"/"5.0" decode pins backing the ledger's widened claim (the DECIMAL regex was verified to accept them), the completeness admin-param filter widened from "/:id" to any "/:" param, a truthful scope-stamp comment in require_admin.ts (the "full" stamp is nominal; a read-scope companion token of an admin account passes the legacy-mirror gate), and the registry.ts phase-record JSDoc extended for Phase 17. Killed as NOT findings by the adversarial panels (documented-and-accepted): the trailing-slash normalization divergence (locked convention H, adjudicated by-design at the Phase 10 gate, systemic to every migrated surface, wrong home in the route-anchored ledger) and the setDb loose-cast nit (documented in-file; AdminDb derives from the real imports so drift fails loud). Re-validation GREEN: tsc 0; full npm test 694 files / 7640 pass / 11 skip (+16 re-verification pins); build:server 0; biome clean on touched files. NOTE: this audit ran on the post-v0.19.0-merge tree (merge ada776e9, Electron desktop); the merge was verified to leave the admin surface byte-unchanged.

## Phase 18: Migrate OAuth JSON + Internal onto the shared seam (oauth.ts + internal.ts)

The migration-wave bookend: the two remaining non-/api sub-dispatchers (handleOAuth, handleInternalApi) now serve from their OWN flag-gated dispatchers under API_DISPATCH 'new' (main.ts oauthApiEntry + internalApiEntry over the SAME apiRegistry; setApiDispatchMode flips all FOUR entries). PARITY-FIRST: every thin handler calls the existing core / reproduces its frozen legacy branch byte-for-byte; both legacy ladders KEPT intact as the flag-off rollback paths AND as the dispatchers' delegates (removed Phase 25). SCOPE CORRECTION vs this phase doc: the /internal surface is ELEVEN routes, not nine; the doc's count predates the two daily-rewards-winners routes (GET + POST .../mark), which the frozen SURFACE_INVENTORY already listed, so the whole family migrated (the Phase 16 no-half-migrated-family precedent).

Deliverables:
- [x] The 5 OAuth POST JSON endpoints ported onto `server/oauth.ts` `export const routes` (authorize, token, revoke, device_authorization, device), each `surface: 'oauth'` + `meta.envelope: 'oauth'`, NO middleware: the thin handlers call the existing private cores UNCHANGED (self-read via readForm, web-session auth via the in-handler fullSessionAccount, never requireAccount and never the API bearer scope gate), so every status/body keeps the legacy RFC 6749 {error[,error_description]} prose byte-for-byte. An unexpected throw serializes through withErrors/serializeOauth (oauthBodyValidationRemap: 500 { error: 'server_error' } gains an additive error_description + X-Request-Id vs the legacy module-local catch).
- [x] OAuth stays mixed HTML+JSON: GET /oauth/authorize (renderAuthorize) and GET /oauth/device (renderDevicePage) are NOT registered; a GET resolves methodNotAllowed and the dispatcher DELEGATES to the legacy handleOAuth ladder, which renders the HTML exactly as today (pinned by parity + a completeness assertion). The security-header subset is Phase 21, untouched here.
- [x] All 11 /internal endpoints ported onto `server/internal.ts` `export const routes` (restart-countdown + the 10 /internal/discord/* bot-channel routes incl. the two daily-rewards-winners routes), each `surface: 'internal'` + `meta.envelope: 'admin'` (the internal fail() envelope IS the admin { success, data, error } shape; EnvelopeKind is the frozen Phase 2 contract, no new member). Handlers reproduce the frozen legacy branches byte-for-byte via the same imported data cores (discord_db / discord / discord_activity / discord_relay / dailyRewardService, called directly, NO eager import bundle, so the lazy-db-bundle partial-mock hazard never arises); game.startRestartCountdown is injected at boot via configureInternalRuntime (InternalRuntime = Pick<GameServer, 'startRestartCountdown'>). An unexpected throw serializes as the admin-shape 500 'internal.error' where the legacy ladder (NO outer catch) left the request HANGING on an unhandled rejection (internalBodyValidationRemap: strictly a reliability improvement, flag-gated).
- [x] NEW `server/http/middleware/require_internal_secret.ts`: requireInternalSecret({ header, envVar }) with the named constants DEPLOY_SECRET_HEADER/'x-woc-deploy-secret' + DEPLOY_SECRET_ENV/'RESTART_COUNTDOWN_SECRET' (restart-countdown) and DISCORD_SECRET_HEADER/'x-woc-discord-secret' + DISCORD_SECRET_ENV/'DISCORD_BOT_SECRET' (every discord route) as the single source of truth. The gate reads its env var PER REQUEST, writes the LEGACY bodies via json() directly (feature-off 404 'unknown endpoint' on an empty/unset env, 401 'not authenticated' on a mismatch), short-circuits without next(), and keeps the length-guarded timingSafeEqual compare (mirroring internal.ts secretsMatch); never logs or echoes a secret.
- [x] The /internal ladder arm's composite delegate preserved EXACTLY: the separate /internal/daily-rewards/* ops family (handleDailyRewardInternalApi, its own x-woc-daily-reward-secret gate, never part of handleInternalApi) is tried first and short-circuits when handled; it stays entirely delegate-served and off the route table.
- [x] restart-countdown's wrong-method 404 (never 405) and its 409-on-already-active preserved: a non-POST resolves methodNotAllowed and DELEGATES to the legacy ladder (the Phase 9 dispatcher rule), so no knownDeviation was needed; pinned byte-identical old-vs-new with the CORRECT secret (proving the 404 is method-driven, not gate-driven).

QA:
- [x] Fixes applied (Biome import-order on 3 files; the packet's stale premises corrected against ground truth: 11 internal routes not 9, delegation makes the 405-regression concern moot, the Phase 7 envelope contract tests already existed)
- [x] Tests added (tests/server/oauth.test.ts NEW 20; tests/server/internal.test.ts NEW 25; tests/server/http/require_internal_secret.test.ts NEW 13; ownership_coverage internal secret-gate mounting sweep +24 incl. the negative control; completeness Phase 18 block +9; parity +21 dual-path pins; known_deviations +2 entries; characterization +4 backfilled daily-rewards-winners goldens)
- [x] Dead code removed (n/a: both legacy ladders are RETAINED for rollback until Phase 25; no dead code introduced)
- [x] Reviews clean: privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 8 checks CLEAN: timing-safe compare byte-equivalent to the frozen secretsMatch, correct gate pairing on all 11 routes with short-circuit-before-handler in both modes, no secret/bearer logged or serialized anywhere incl. both 500 paths, no auth widening on the consent POSTs [no middleware, same fullSessionAccount full+unlocked resolver], all 11 internal branches byte-identical outside the 2 documented deviations, daily-rewards ops + HTML pages delegate-served untouched, no new SQL, no CORS widening; INFO only: both deviations accurate and leak-free). qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX (all 9 acceptance criteria MET; BOTH amendments independently adjudicated CORRECT: the 11-vs-9 route count [the frozen SURFACE_INVENTORY already listed both daily-rewards-winners routes, Phase 16 no-half-migrated-family precedent] and delegation-not-deviation for the wrong-method 404 [dispatch.ts delegates every non-matched resolve, no 405 can surface]; it also confirmed byte + header identity on every non-throw path incl. no X-Request-Id on the gate responses, and the adversarial pass found nothing missing; 1 standing VERIFY = the live db-touching success paths under flag 'new' are the whole migration's structural deferral until the Phase 25 flip, covered by mocked units + dual-path parity; NICE doc-count precision applied). migration-safety correctly SKIPPED (no DDL/JSONB), cross-platform-sync + architecture-reviewer SKIPPED (no src/sim, no wire, no client matcher).

Notes:
- Files: NEW server/http/middleware/require_internal_secret.ts + tests/server/{oauth,internal}.test.ts + tests/server/http/require_internal_secret.test.ts. Edited: server/oauth.ts + server/internal.ts (route layers appended after the frozen handlers), server/http/registry.ts (+oauthRoutes +internalRoutes), server/main.ts (oauthApiEntry + internalApiEntry dispatchers, the composite internalLegacy delegate, configureInternalRuntime boot; setApiDispatchMode flips all four entries), tests/server/http/{completeness,ownership_coverage,parity}.test.ts + known_deviations.ts + characterization_admin_oauth_internal.test.ts (+4 fixtures) + docs.
- Test harness: completeness.test.ts gained a Phase 18 block deriving BOTH expected sets from the SURFACE_INVENTORY ladders (oauth POST-only registration + the GET-HTML-pages-stay-off assertion + the 11-route internal set + envelope pins + the daily-rewards ops family stays delegate-only); the /api registers-exactly filter now also excludes /oauth + /internal. ownership_coverage.test.ts gained the internal secret-gate MOUNTING sweep the Phase 17 QA mandated (requireInternalSecret carries no meta marker, so the functional sweep is the only deny-by-default guarantee: every internal route driven twice, env-unset -> feature-off 404 and wrong-secret -> 401, handler never called, plus an ungated-synthetic negative control). parity.test.ts gained '/oauth dispatch parity' (11 pins: the 5 POST db-free contracts, wrong-method/HEAD/unknown-path delegation, both GET HTML pages byte-identical through the delegate) and '/internal dispatch parity' (10 pins under per-test env control: both gates' 404/401, the wrong-method-with-correct-secret 404, TWO REAL authed 200s through the migrated gate+handler chain [presence, members-meta: db-free], unknown-subpath gate-then-404, HEAD delegation, and the composite-delegate fallthrough), with the stale /oauth-/internal-out-of-scope SKIP note rewritten.
- knownDeviations ADDED (introducedInPhase 18): `oauthBodyValidationRemap` (the additive 500 error_description + X-Request-Id via serializeOauth vs the legacy bare { error: 'server_error' }; log line moves to the shared boundary) and `internalBodyValidationRemap` (an unexpected throw now answers the admin-shape 500 'internal.error' where legacy HUNG the request: handleInternalApi has no outer catch and main.ts's keep-alive unhandledRejection handler only logs). Both secret/auth-gated or throw-only, invisible to the db-free corpus, pinned with fakes in the two new test files.
- The characterization suite's daily-rewards-winners GAP closed: the two routes postdate the Phase 3 capture, so their four gate goldens (secret_unset_404 + no_secret_401 each) were backfilled into the DISCORD_ROUTES loops, freezing the legacy contract on disk before the flag flip.
- surface_inventory.ts UNCHANGED (both frozen ladders already listed every migrated route incl. the 11 internal ones; the freshness gate passes). NO error_codes append (serializeOauth's RFC 6749 mapping and 'internal.error' already existed; Phase 22 owns coded emission), NO S3 / i18n change (RFC 6749 codes are protocol tokens; /internal is bot/operator-facing; neither feeds userFacingApiError or the apiError.* catalog), NO DDL / JSONB change (oauth_db + discord_db only CONSUMED), NO src/sim, NO WS wire. Pre-existing em dashes in oauth.ts (a header comment + the consent/device-page copy) deliberately left untouched per the phase doc (the deferred copy sweep); no added line carries one.
- Validation GREEN: tsc 0; full npm test 701 files / 7781 pass / 11 skip (+3 test files, +58 route-layer/middleware tests, +~58 harness/characterization additions over the pre-phase tree); build:server 0; ci:changed exit 0 (pre-existing noExplicitAny warnings only); perl -CSD dash/emoji scan over all added lines clean (the route-table banner dashes are U+2500 box-drawing, the repo convention, outside the blocked ranges).
- QA GATE (phase-18-qa.md, 2026-07-02): PASS. Five parallel auditors (correctness, test-coverage, dead-code, privacy-security-review, qa-checklist READY) plus the full CI-mirror gate. Zero BLOCKING. ONE SHOULD-FIX (correctness), FIXED: the Phase-25 off-table handoff was unrecorded (once the ladders are deleted the dispatcher serves methodNotAllowed itself, regressing GET /oauth/authorize + GET /oauth/device from real HTML pages to 405s and swapping restart-countdown's anti-enumeration wrong-method 404 for a path-revealing 405; planned405BeforeAuth covers neither); a new knownDeviation `oauthInternalOffTable405` (introducedInPhase 18) now directs Phase 25 to migrate the two GET pages onto RouteDefs (meta.envelope 'html') or retain a delegate, and to decide the restart-countdown wrong-method shape deliberately. Per apply-all, every NICE-TO-HAVE applied (test/docs only, zero production change): +4 oauth tests (the approveAuthorize happy path, a 200 { redirect } carrying the SAME 64-hex single-use code createAuthCode persisted plus the state echo; the approved-device_code grant completion issuing the read-scope token via consumeDeviceCode; and the two missing consent-gate cross pins, read-scope-on-device 401 + locked-on-authorize 401, so every rejection branch is proven on BOTH consent POSTs), +1 parity pin (the composite delegate ORDERING: a /internal/daily-rewards/* request with the ops env secret unset answers that family's fail-CLOSED 401, never the ladder's terminal 404, identical old-vs-new, so any future flip of the handleDailyRewardInternalApi-first ordering is caught). Adjudicated NO-CHANGE with rationale: the secretsMatch triplication (middleware + internal.ts ladder + daily_rewards.ts) stays, because a shared home must be a THIRD module (internal.ts imports the middleware, so importing back is a cycle), the internal.ts copy retires with the ladder at Phase 25, and the frozen-ladder rule forbids touching the legacy copies now; InternalSecretGate stays exported (it types the exported factory's param). MAINTENANCE RULE until Phase 25: the internal RouteDef handlers REPRODUCE (not call) their frozen ladder branches, so any /internal behavior edit must land in BOTH the ladder branch and its RouteDef twin (both copies are test-pinned; a one-sided edit fails the dual-path parity pins). Coverage fiction-audit CLEAN (the test fakes drive the REAL compose/withErrors/serializer stack; captureBothModes flips the REAL API_DISPATCH flag through routeHttpRequest). Security re-review CLEAN across all checks (timing-safe compares, gates short-circuit before handlers, no secret/bearer echo, no auth widening on the consent POSTs, no gate-pair swap, atomic four-entry flag flip, fixtures carry no secret material). Re-validation GREEN: tsc 0; full npm test 701 files / 7786 pass / 11 skip (+5 tests); the 5 touched suites 133/133; ci:changed exit 0; build:server 0; build:env + client build 0 (the full pre-merge gate).

## Drift audit (2026-07-02): release-merge endpoint coverage + Phase 18b insertion

A maintainer-requested audit of the packet and the API surface against the post-v0.19.0-merge tree (six parallel auditors: route census vs the frozen corpus, harness derivation map, domain spec, release-merge divergence, docs staleness, client/i18n). Findings and actions:

- TWELVE routes had NO owning migration phase, having arrived via release merges AFTER their would-have-been waves: the github identity family (4 routes, server/github.ts, v0.18.0 merge bbed053db, inventory rows filed at the merge), desktop-login (2 routes, server/desktop_login.ts, v0.19.0 merge ada776e9, rows filed at the merge), and daily-rewards (3 bearer-gated player routes + 3 secret-gated /internal/daily-rewards/* ops routes, server/daily_rewards.ts, v0.19.0 merge df91eee8, NO rows filed). All twelve are legacy/delegate-served only; the Phase 25 ladder deletion would have dropped them. ACTION: new phase docs phase-18b-late-arrivals.md + phase-18b-qa.md own the migration (must land before Phase 25, ideally before Phase 19); README/implementation-plan/state/qa-checklist and the forward phase docs (19, 21, 22, 24, 25) updated to match.
- The 6 daily-rewards routes were also INVISIBLE to the frozen corpus and its gates: the freshness gate scanned only server/{main,admin,oauth,internal}.ts, and the /api arms hide behind main.ts's `startsWith('/api/daily-rewards')` prefix delegate while the ops arms live in the /internal composite delegate. ACTION (landed with this audit): 6 SURFACE_INVENTORY rows filed (GET /api/daily-rewards, POST /api/daily-rewards/spin, GET /api/daily-rewards/history: authScope full via the ladder's bearerActiveAccount, limiter null; POST /internal/daily-rewards/{pending-payouts,payout-history,mark-payout}: new AUTH_SCOPE `secret-daily-reward` documenting the fail-closed x-woc-daily-reward-secret gate) + 3 API_CONTENT_TYPE entries (PROBLEM_JSON); server/daily_rewards.ts added to the freshness gate's DISPATCHER_SOURCES (the gate now hard-fails on any unfiled route in a prefix-delegated sub-dispatcher module, closing the blind spot); completeness.test.ts derives legacy-served /api paths from main.ts + daily_rewards.ts and its Phase 18 internal-ladder pins exclude (and separately count) the ops family, whose three REAL paths are now pinned delegate-only alongside the synthetic probes. Inventory: 114 -> 120 rows. All affected suites green; the ownership/parity/characterization suites need no change until 18b (registry-driven, corpus-driven-by-hand respectively).
- Release-merge DIVERGENCE audit of ada776e9 + df91eee8: CLEAN. No unmirrored change to any migrated route's legacy arm (the passesTurnstile secret-param refactor is re-bound at the configureAuthRuntime injection site; the web-login-guard and CORS desktop-origin changes are shared-core by construction, CORS staying the single top-level authority for both modes); no endpoint deleted or renamed; the desktop-login and daily-rewards additions are single-serving-path (delegate) in both modes until 18b.
- SECURITY finding for the 18b maintainer fork: POST /api/desktop-login/create resolves its bearer via the scope-blind accountForToken while exchange mints a full-scope session token; the scope-checked resolver (accountAndScopeForToken, which every other mutating route uses via bearerActiveAccount) exists precisely to reject read-scope tokens. Recorded as the REQUIRED fork in phase-18b-late-arrivals.md STEP 2 (recommend fixing on BOTH serving paths; the browser /desktop-login page always holds a full-scope token so no legitimate caller regresses).
- Client/i18n: desktop-login prose is fully matched (errors.api.desktopCodeInvalid live in userFacingApiError); the daily-rewards prose family deliberately has no matcher arm (the client discards the bodies: online.ts raw fetches + the window's generic hudChrome.dailyRewards.error card); 'this token is read-only' has no arm anywhere. All recorded as Phase 22 adjudications in its phase doc. No translation work done or needed now (strings fill at release per the standing rule).
- Stale-on-flip annotations noted for Phase 25: the swag-claim row's `unreachable: true` and the four limiter-column rows (reports, characters POST, wallet-link x2) document the LEGACY arm and become misleading after the default flips; the exit criteria must also carve out the deliberately delegate-served shapes or the zero-old-path-requests gate is unreachable.
- Post-audit diff review (2 fresh reviewers, corpus/harness vs code ground truth + doc claims): corpus rows, gate edits, and consumer sweep all verified accurate; 2 NICE findings. Applied: the player-family row comment now spells out the no-trailing-slash-boundary nuance of the startsWith prefix arm. Adjudicated NO-CHANGE with rationale: a knownDeviations ledger entry for the delegate-only-drop-at-P25 hazard was declined because the ledger records MODE-BEHAVIORAL deviations (both modes are byte-identical for these routes today), the entry would be retired by Phase 18b itself, and the hazard is already machine-adjacent via the freshness/coverage gates plus the new Phase 25 route-family stopping rule.

## Phase 18b: Migrate the late-arrival families (github, desktop-login, daily-rewards)

The twelve release-merge late-arrival routes (github x4 v0.18.0, desktop-login x2 + daily-rewards player x3 + ops x3 v0.19.0) now SERVE FROM THE SHARED DISPATCHERS under API_DISPATCH 'new', unblocking the Phase 25 ladder deletion. PARITY-FIRST: every thin handler reuses the existing core UNCHANGED (the daily-rewards handlers call the whole ladder sub-dispatchers, so parity is by construction); every legacy arm KEPT as the flag-off rollback path AND the dispatcher delegate (removed Phase 25). BOTH maintainer forks resolved as the packet recommended (maintainer confirmed "go with the recommended route"): desktop-login create = FIX on both serving paths; spin limiter = none (Phase 19 owns the POLICIES decision).

Deliverables:
- [x] github family (server/github.ts route layer appended, the Phase 16 discord template): POST /api/auth/github/start + GET /api/github + DELETE /api/github behind the shared createActiveGuard (lazy db bundle + setGithubDbForTests) with the legacy-order guards (auth FIRST, then githubRateLimited; start's 429 records github.link.rate_limited, status/unlink's does not); GET /api/auth/github/callback public with meta.envelope 'html' (an escaping throw serializes as HTML, never problem+json, preserving the window.opener.postMessage popup contract). GROUND TRUTH preserved: the family carries NO isIpBlocked/turnstile anywhere (link-only, caller already authenticated), so none was added (a posture change would be its own fork).
- [x] desktop-login pair (NEW server/desktop_login_routes.ts, a SIBLING module so server/desktop_login.ts stays db-import-free for its pure-unit tests): create [desktopLoginRateGuard, activeGuard] + exchange [desktopLoginRateGuard]. The FUSED per-IP budget is preserved as ONE bucket with limiter-before-auth: the rate guard calls the SAME rateLimited(req) default bucket the register/login RouteDefs and the legacy fused arm consume (parity-pinned: 25 login drains then a desktop-login 429, byte-identical old-vs-new).
- [x] The desktop-login create SCOPE FIX (the drift audit's REQUIRED fork, resolved FIX): the pre-18b handler resolved its bearer via the SCOPE-BLIND accountForToken while exchange mints a full-scope session token (a read-scope companion/OAuth token could escalate to a full session). handleDesktopLoginCreate was restructured into the post-auth core issueDesktopLoginCode(req,res,deps,accountId) (deps drop bearerToken/accountForToken entirely, so the core CANNOT self-resolve a bearer); the legacy arm now runs bearerActiveAccount first (mirroring its authed siblings) and the RouteDef mounts createActiveGuard. Read tokens now 403 'this token is read-only' on BOTH paths (byte-identical, so no old-vs-new divergence; the change is vs the pre-18b baseline, recorded as the desktopLoginCreateFullScope deviation). No legitimate caller regresses: the browser /desktop-login page always holds a full-scope session token.
- [x] daily-rewards player trio (server/daily_rewards.ts route layer appended): GET /api/daily-rewards + POST /api/daily-rewards/spin + GET /api/daily-rewards/history behind createActiveGuard (LAZY db bundle, mandatory here: game.ts imports this module, so an eager literal would break every partial-db-mock game test); the thin handler calls handleDailyRewardApi(req,res,accountId) UNCHANGED (it re-parses the URL, so bodies, the in-family 404, and the lenient Number(...)||30 history limit are byte-identical by construction). NO withBody (spin provably reads no body), NO limiter (legacy has none; the spin throttle is a named Phase 19 fork, confirmed no-limiter this phase). Off-table shapes (wrong method, unknown subpath, the no-slash /api/daily-rewardsX sibling, HEAD) stay delegate-served, parity-pinned.
- [x] daily-rewards ops trio (same route layer): POST /internal/daily-rewards/{pending-payouts,payout-history,mark-payout}, surface 'internal' + meta.envelope 'admin', behind the NEW requireInternalSecretFailClosed({DAILY_REWARD_SECRET_HEADER 'x-woc-daily-reward-secret', DAILY_REWARD_SECRET_ENV 'WOC_DAILY_REWARD_SERVICE_SECRET'}) in require_internal_secret.ts: env-unset AND mismatch both answer the legacy 401 (never the other gates' feature-off 404, never a RESTART_COUNTDOWN_SECRET fallback), per-request env read, the module's shared length-guarded timingSafeEqual (no fourth secretsMatch copy). The handler calls handleDailyRewardInternalApi(req,res) UNCHANGED (the core re-checks the same secret, passing whenever the gate passed; keeping it intact keeps the composite delegate frozen). The /internal composite delegate ORDERING is untouched (daily-rewards tried first) and stays parity-pinned.
- [x] Registry spreads +3 (githubRoutes, desktopLoginRoutes, dailyRewardRoutes); NO new dispatcher or boot injection needed (all four flag-gated entries existed since Phases 9-18; github/daily-rewards use module-owned resources, desktop_login_routes bundles its own db reads; dailyRewardService stays importable by game.ts independent of route-table state).

QA:
- [x] Fixes applied (both maintainer forks implemented as confirmed; the security.test.ts desktop fixture updated to the new deps contract; biome format on all touched files)
- [x] Tests added (tests/server/github.test.ts NEW 24; tests/server/desktop_login.test.ts NEW 17; tests/server/daily_rewards_routes.test.ts NEW 30; ownership_coverage: the third gate pair with a per-gate unset-env body fork + count 11 -> 14 + the NEW /api auth-mounting sweep over the 7 authed 18b routes with a negative control; completeness: MIGRATED_ROUTES +9 + the ops delegate-only pins FLIPPED to registered with the synthetic probes still notFound; parity: a Phase 18b dual-path block of 17 pins incl. the fused-budget one-bucket 429, the github callback 503 HTML, the ops gate-pass mark-payout 400, wrong-method and no-slash delegation, and HEAD; known_deviations +5; characterization +17 backfilled goldens across both suites)
- [x] Dead code removed (n/a: every ladder arm retained for rollback; the one deletion is handleDesktopLoginCreate's scope-blind self-auth, replaced by the shared guards on both paths)
- [x] Reviews clean: privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 7 security-critical points confirmed: the scope fix real on both paths with the core unreachable unauthenticated; the fail-closed gate byte-equivalent to internalAuthorized, secret never logged/echoed/serialized; the fused budget one-bucket limiter-before-auth in both modes; github gates neither added nor removed, OAuth state single-use, HTML escaping intact; guards before handlers everywhere, doubly enforced by the sweeps; no new SQL, no secrets in the 17 fixtures; deviation prose leak-free. 1 INFO = the Phase 25 pre-path-gate handoff, already recorded on dailyRewardsOpsBodyValidationRemap). qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX / 2 NICE, BOTH APPLIED (+ a payout-history wrong-secret re-pin so every masked ops path has its own captureBothModes line; + a DELETE /api/daily-rewards wrong-method-on-registered-path pin proving the table 405 never surfaces); all 8 STEP 5 acceptance criteria MET, no stopping rule tripped. migration-safety SKIPPED (no DDL/JSONB), cross-platform-sync + architecture-reviewer SKIPPED (no src/sim, no wire, no matcher change).

Notes:
- Files: NEW server/desktop_login_routes.ts + tests/server/{github,desktop_login,daily_rewards_routes}.test.ts + 17 fixtures. Edited: server/{github,desktop_login,daily_rewards}.ts, server/http/middleware/require_internal_secret.ts (+ the fail-closed variant + the third gate-pair constants), server/http/registry.ts, server/main.ts (the create-arm scope fix + trimmed deps), tests/security.test.ts, tests/server/http/{completeness,ownership_coverage,parity}.test.ts + known_deviations.ts + surface_inventory.ts (the create row: authScope bearer -> full, handler issueDesktopLoginCode) + both characterization suites, docs/api-pipeline/{progress,state}.md.
- knownDeviations ADDED (all introducedInPhase 18, the integer bound; prose names Phase 18b): githubBodyValidationRemap + desktopLoginBodyValidationRemap + dailyRewardsBodyValidationRemap + dailyRewardsOpsBodyValidationRemap (all four the HANG-counterfactual class: the legacy arms are bare `return handler(...)` inside handleApi's try, or the un-caught fire-and-forget composite, so an unexpected throw/bad-JSON escaped as an unhandled rejection with NO response; the new paths serialize 500 problem+json / HTML / admin-shape + X-Request-Id, a flag-gated reliability improvement) and desktopLoginCreateFullScope (the deliberate scope-gate change vs the pre-18b baseline, identical on both dispatch arms).
- PHASE 19 HANDOFF: the fused register/login/desktop-login per-IP budget is preserved as ONE bucket (four paths, limiter-before-auth); POST /api/daily-rewards/spin still has NO limiter by confirmed decision (the one-spin-per-day 409 + wallet-eligibility 403 are the only guards); the github family keeps githubRateLimited's ip+account keying with the start-only usage metric.
- PHASE 25 HANDOFF (reduced off-table set): the oauthInternalOffTable405 set + HEAD-to-GET + the daily-rewards prefix-arm remainder (wrong method / unknown subpath / the no-slash sibling resolve unmatched and delegate to the ladder's auth-then-404) + the ops family's family-wide PRE-PATH 401 (the legacy composite gates the whole /internal/daily-rewards/ prefix BEFORE path/method resolution; the table gates per-route after path match, invisible while the delegate serves the remainder; at ladder deletion the pre-path gate must be recreated or its loss adjudicated, recorded on dailyRewardsOpsBodyValidationRemap and flagged by privacy-security-review). The desktop-login deps contract note: DesktopLoginRouteDeps no longer carries bearerToken/accountForToken; any future arm edit lands in BOTH the ladder arm and the RouteDef twin (the dual-edit rule now covers all 12 routes; the daily-rewards families are exempt in practice since both paths call the SAME core).
- i18n: NO new player-visible strings, NO translations (all prose is frozen legacy English; fills happen at release per the standing rule). 'this token is read-only' on create reuses the existing shared guard constant; its missing client-matcher arm remains the recorded Phase 22 adjudication.
- Validation GREEN: tsc 0; full npm test 704 files / 7905 pass / 11 skip (+3 files, +119 tests over the Phase 18 QA baseline; +2 parity pins after the QA nits = 7907 expected on the next full run); build:server 0; client build green; ci:changed exit 0; perl -CSD dash/emoji scan over all added lines clean.

QA GATE (phase-18b-qa.md, 2026-07-02): PASS, apply-all.
- Fan-out: correctness + test-coverage + dead-code auditors (free-text general-purpose agents) + privacy-security-review (0 BLOCKING / 0 SHOULD-FIX; all six focus areas CLEAN high-confidence: the scope fix closed on both paths with no bypassing call site, the fail-closed gate leak-free, the fused bucket per-IP-bounded before auth, github OAuth state single-use with origin-targeted postMessage and escaped inline JSON, no PII/secret in any 4xx/5xx, no new SQL; 2 pre-existing INFO already tracked) + qa-checklist (READY, 0 BLOCKING / 0 SHOULD-FIX, 2 INFO). All 9 STEP 5 acceptance criteria MET; no stopping rule tripped; both maintainer fork outcomes verified as shipped.
- SHOULD-FIX applied (2, both test/docs-only, zero production change): (1) COVERAGE LOSS from the security.test.ts rewrite: the deleted 'create rejects an unknown or stale token with 401' case was the tree's ONLY drive of the shared createActiveGuard account-null branch (a well-formed bearer whose resolver returns null, bearer_active_guard.ts); replaced with a route-layer test in desktop_login.test.ts asserting the 401, handler-never-reached, no code minted, AND the resolver consulted exactly once (distinguishing it from the missing-bearer short-circuit). (2) STALE DOC CLAUSE: state.md's drift-audit paragraph still said the daily-rewards player counterfactual was handleApi's outer-catch 500; ground truth (main.ts, the bare-return prefix arm inside the try) confirms the HANG class the shipped deviation and this file already record; the clause was corrected in place.
- NICE applied per apply-all (4): the github start unconfigured 503 route-layer test (handler-owned JSON 503 through the real chain); the create unexpected-throw 500 boundary test (a rejecting db read serializes problem+json + X-Request-Id, minting no code); the phase doc's stale handleDesktopLoginCreate mention rewritten to the post-fix issueDesktopLoginCode contract; the github callback's non-GET arm NAMED in the Phase 25 carve-out (a wrong-method request delegates to the ladder terminal 404 'unknown endpoint' today and flips to the table 405 at the deletion, the systemic planned405BeforeAuth framing, NOT an oauthInternalOffTable405 member since the callback's GET is on the table) + a dedicated captureBothModes wrong-method pin in parity.test.ts.
- Adjudicated NO-CHANGE with rationale (1): a dedicated legacy-arm read-scope 403 end-to-end test. Two auditors independently ruled it correct by construction: the legacy create arm delegates to the same shared, separately-tested bearerActiveAccount helper chain, the branch is not db-free so not parity-pinnable, and the arm retires at the Phase 25 ladder deletion; the migrated path (which survives) is directly tested.
- Re-validation GREEN: tsc 0; full npm test 704 files / 7911 pass / 11 skip (+4: two guard/boundary tests, the start 503 test, the callback wrong-method pin); the three 18b suites + the six harness/characterization suites + security.test.ts all green; ci:changed exit 0; biome clean on every touched file; build:server 0; client build green; perl -CSD dash/emoji scan over all added lines clean.

## Phase 19: Two-tier rate limiter + ratelimit_db (cross-cutting, deep)

The limiter MECHANISM rework deferred from Phase 8, with zero route-table, dispatcher, or WS-wire change. Three vertical slices (return shape, pg tier-2 + DDL, two-tier resolver + headers), each its own green commit. STALE PACKET PREMISES corrected against ground truth: DISCORD_SCHEMA was ALREADY wired into ensureSchema (PR #1075, guarded by tests/schema_wiring.test.ts), so the trap was avoided by construction, not fixed; recordSlidingWindowAttempt is a PRIVATE generic helper with no external call sites (the shape change lands on the 10 exported wrappers); the POLICIES table lives in server/http/middleware/rate_limit.ts, not ratelimit.ts; and there was never a respond429 helper nor a legacy X-RateLimit-* trio to remove (only applyImpliedHeaders' Retry-After, whose comment already said "Phase 19 supplies it": the draft-11 emission was CREATED, not upgraded).

Deliverables:
- [x] Every in-memory limiter returns the FROZEN Phase 2 `RateLimitOutcome { allowed, remaining, resetSeconds }` via the injected clock: rateLimited + the 9 scoped wrappers + authThrottled in server/ratelimit.ts (record-then-judge preserved, a call still consumes a token when limited; fused ip/account limiters merge allowed=both, remaining=min, resetSeconds=max via mergeFusedOutcomes; authThrottled stays READ-ONLY, handler-level, per-username, failed-only, cleared on success, 15m/10-fail), plus perf_report.ts's local limiter, which now reads time through the NEW `rateLimitNow()` accessor so setRateLimitClock drives it (its handler still answers 200 { ok: true } on throttle BY DESIGN). Every consumer across 12 server files flipped to `!x.allowed` with BYTE-IDENTICAL legacy 429 prose bodies and no header additions on legacy arms; the fused register/login/desktop-login/create+exchange per-IP budget stays ONE shared bucket (comment kept). NO boolean caller remains anywhere in server/ or tests/.
- [x] NEW server/ratelimit_db.ts: the pg-backed tier-2 GLOBAL backstop for the imminent multi-realm deployment (N realms otherwise means N times the intended budget). PgRateLimitStore implements the frozen RateLimitStore contract; hit() is ONE atomic parameterized `INSERT ... ON CONFLICT (policy, key) DO UPDATE ... RETURNING` fixed-window upsert on the WINDOW_MS grid, with the `>=`/GREATEST pairing so a clock-skewed realm can never reopen a counted window; the composite store key splits at the FIRST colon into the (policy, key) columns so IPv6 survives intact; the pool is INJECTED (the module never imports db.ts, mirroring discord_db/github_db cycle avoidance); the pg-write counter fires through the Phase 8 MetricSink seam as route 'ratelimit.pg.hit' with status encoding the decision (noopMetricSink default, Phase 23 wires a real exporter); reset() is a documented GLOBAL test-only surface. RATELIMIT_SCHEMA (rate_limits: policy/key/window_start/count, PK (policy, key)) wired into ensureSchema after GITHUB_SCHEMA under pg_advisory_xact_lock, followed by a to_regclass('public.rate_limits') FAIL-FAST boot assertion (scoped to this one table; the others stay test-guarded per the Phase 16 decision) and RATELIMIT_PRUNE_SQL, a STATIC param-free DELETE of dead windows (2 x WINDOW_MS horizon, database clock) run at every realm boot: the security review's unbounded-row-growth SHOULD-FIX, resolved with a mechanism rather than a comment.
- [x] The Phase 8 thin adapter is now the TWO-TIER resolver: RateLimitPolicy becomes { name, keyClass, limit, windowSeconds, tier1, tier2 } with every limit REFERENCING its existing exported named constant and windowSeconds derived from WINDOW_MS (identity-asserted by a derivation guard test; nothing re-tuned). Tier-1 (the in-memory sliding window) runs and throws FIRST, so floods NEVER reach pg (pinned by a counting-store test: the write counter stays flat once tier-1 rejects). Tier-2 ('global' on all 10 policies) then hits `${name}:ip:${ip}` plus, for 'ip+account', `${name}:acct:${accountId}` (mirroring tier-1's fused semantics; in a single process tier-2 can never reject when tier-1 allowed, because tier-1 records first and a fixed window counts a subset of the sliding window, so nothing changes until multi-realm). Tier-2 FAILS OPEN on a store error (console.error + proceed; the 429 throw sits OUTSIDE the try so a genuine tier-2 rejection is never swallowed). The store is injected via the setRateLimitTier2Store slot in ratelimit.ts and wired at boot in main.ts (`setRateLimitTier2Store(createPgRateLimitStore({ pool }))`, registration only, no connection at import). The 429 throw carries rateLimit429Headers (NEW in server/http/errors.ts): Retry-After plus `RateLimit: "name";r=remaining;t=reset` and `RateLimit-Policy: "name";q=limit;w=window`, pinned by comment to draft-ietf-httpapi-ratelimit-headers-11 (a NON-FINAL Internet-Draft, on purpose) with RFC 9651 structured-field syntax; params.retryAfterSeconds is now the ACCURATE per-request resetSeconds (previously the constant 60). knownDeviation `rateLimit429Draft11Headers` (introducedInPhase 19) documents it on the 9 mounted coded-429 routes; ALL were already path-masked by rateLimitedBodyToCode / newLimiterCharacterMutations / newLimiterReportsCreate, so no new masking and no captureBothModes re-pins were needed.
- [x] Policy table complete: discord (ip+account), character_create/rename/delete/takeover, and reports_create are all present in the two-tier table (they already existed as RateLimitPolicy consts; this phase PROMOTED them into the resolver shape). Names keep the pre-existing underscore convention (character_create), not the packet's dot shorthand. DISCORD_POLICY and PUBLIC_READ_POLICY stay deliberately UNMOUNTED (discord and the public reads self-limit in-handler; mounting is a later decision, not this phase's).

QA:
- [x] Fixes applied (security SHOULD-FIX: the boot prune above; migration-safety INFO x2: the reset()-is-global comment and the >WINDOW_MS-skew note; qa-checklist NIT x2: the stale "stay boolean until Phase 19" comment in the frozen types.ts [comment-only, contract untouched] and one pre-existing em dash on a touched tests/security.test.ts line)
- [x] Tests added (tests/server/ratelimit.test.ts NEW: pinned-clock outcome accuracy, fused-merge, authThrottled read-only; tests/server/ratelimit_db.test.ts NEW 13: exact UPSERT SQL/params, colon-split incl. IPv6, outcome math across the window boundary, metric decisions, reset; schema_wiring +6: wiring, idempotent re-run, both assertion branches, the prune pin; http/rate_limit.test.ts rewritten: exact draft-11 header strings, tier-1-before-tier-2, tier-2 trip with tier-2 numbers, fail-open, ip+account key composition and merge, the derivation guard, the missing-account 500 guard kept; errors.test.ts +rateLimit429Headers units; perf_report +rate-cap/clock-roll via insert count; 8 consumer suites updated to the outcome shape incl. the admin lazy-db stubs that tsc could NOT see [Record<string,unknown> overrides, a runtime-only 429 regression caught and fixed])
- [x] Dead code removed (the static RateLimitPolicy.retryAfterSeconds field and the shared RETRY_AFTER_SECONDS constant are gone from the middleware, replaced by per-request accuracy; nothing else became dead: every legacy limiter arm is retained rollback surface until Phase 25)
- [x] Reviews clean: privacy-security-review 0 BLOCKING / 1 SHOULD-FIX (unbounded rate_limits growth; FIXED via the boot prune; all 7 requested checks PASS: tier-ordering verified in code, key derivation collision-free, UPSERT parameterized and race-safe, no secret/SQL/stack in any 429 body or header, every one of the ~24 flipped call sites verified non-inverted with byte-identical prose, fail-open cannot swallow a real 429, no dev-command/secret/auth-gate change). migration-safety 0 BLOCKING / 0 SHOULD-FIX (DDL additive + idempotent + genuinely wired under the lock, both assertion branches tested, advisory-lock concurrency sound, UPSERT atomic under concurrent realms, BIGINT-as-string handled via Number(), boot inert at import; 2 INFO notes, both applied as comments). qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX (all 9 acceptance criteria met with the respond429/dot-name premise corrections adjudicated; adversarial pass found no missing piece: no tier-1 double-count [the wallet RouteDefs call the limiter-free cores, the middleware is the sole tier-1 caller], deviation route list exact; 2 NITs applied; 2 low VERIFYs recorded below). architecture-reviewer + cross-platform-sync correctly NOT dispatched (no src/sim, no IWorld/wire/matcher change).

Notes:
- Files: NEW server/ratelimit_db.ts + tests/server/{ratelimit,ratelimit_db}.test.ts. Edited: server/ratelimit.ts (shape + rateLimitNow + the tier-2 slot), server/http/middleware/rate_limit.ts (two-tier resolver), server/http/errors.ts (rateLimit429Headers), server/db.ts (schema wiring + assertion + prune), server/main.ts (call-site flips + boot wiring), server/{account,admin,auth_routes,desktop_login_routes,discord,github,wallet,profile_page,leaderboard,perf_report}.ts (call-site flips), server/http/types.ts (ONE stale comment corrected, contract untouched), tests: schema_wiring, security, perf_report, wallet_server, server/{admin,auth.login,desktop_login,discord,ratelimit_clock}, server/helpers/parity.test.ts, server/http/{rate_limit,errors,onion_order}.test.ts + known_deviations.ts, server/woc_referrals_route.test.ts (stale comment).
- Maintainer forks resolved PARITY-PRESERVING per the packet's defaults: POST /api/daily-rewards/spin keeps NO limiter (the one-spin-per-day 409 + wallet-eligibility 403 stay the only guards); the fused 4-path per-IP auth budget stays UNSPLIT and shared; promoting the auth/github/desktop-login legacy limiter facts into the resolver is the packet's named fork and was NOT taken. Any of the three can be revisited as an explicit maintainer decision.
- Standing VERIFYs (low, from the QA gate): the draft-11 structured-field grammar is pinned to a non-final draft (no client consumes it until Phase 22, and only under API_DISPATCH 'new'); end-to-end tier-2 against live Postgres is deferred to the unit convention (every piece is unit-faked; the wiring is one line).
- Validation GREEN: tsc 0; full npm test 706 files / 7943 pass / 11 skip; build:server 0; ci:changed exit 0 (pre-existing warnings only); added-line dash/emoji scan clean (perl -CSD).
- Handoff: phase-19-qa.md is the separate QA gate; run it before Phase 20.
- QA pass (phase-19-qa.md, 2026-07-02): PASS, apply-all. Six parallel auditors over the committed diff (correctness, test-coverage, dead-code, privacy-security-review, migration-safety, qa-checklist) plus a FRESH post-fix qa-checklist over the combined range. Zero BLOCKING. All acceptance criteria verified item by item against the real code (window-boundary math, UPSERT atomicity under skew, tier-1-before-tier-2, draft-11 header values, derivation identity, legacy-arm byte-parity, sim purity, stable-code i18n). THREE SHOULD-FIX fixed: the UPSERT's CASE/GREATEST counting logic had no literal-text regression pin (the test compared the exported constant against itself, so both sides moved together on an edit; now toContain-pinned like the prune SQL); the pg driver's BIGINT-as-string window_start return was never driven through the Number() coercion (a dropped Number() would concatenate, not add, invisible to tsc; now string-typed in a test); the outcome formula was TRIPLICATED across slidingWindowOutcome / rateLimitedPerfReport / PgRateLimitStore.hit (rule of three met; extracted to the exported pure windowedRateLimitOutcome in ratelimit.ts, all three delegate, faithful move verified). Nits applied per apply-all: tier2 'none' documented as the deliberate per-policy opt-out seam (tier-2 costs a pg UPSERT per ALLOWED request, so a future mounted public_read can stay tier-1-only with a one-word edit); the tier-2 merge now reuses the exported mergeFusedOutcomes (the byte-identical private mergeTier2 deleted, so tier-1's both-direction merge tests cover the one function); the fail-open console.error throttled to once per WINDOW_MS via the injected clock (+ test-only resetTier2ErrorLogThrottle; a pg outage under load no longer floods the ops log, the security review's one nit); an empty RETURNING row pinned to reject (the resolver fail-open absorbs it); the local recording tier-2 store renamed RecordingRateLimitStore (it shadowed the DIFFERENT shared helpers/fake_ratelimit_store.ts class); the admin allowedRateLimit stub's return type now derives from the real bundle (closing the tsc-blind Record<string,unknown> seam for the limiter specifically; the loose bag itself is documented file design and stays). Deferrals: delete-or-keep of the orphaned shared FakeRateLimitStore helper (no consumer but its self-test) goes to the Phase 25 packet teardown; migration-safety's five observations (to_regclass 'public' hardcode, boot-only seq-scan prune, >window skew resetSeconds, DB-clock-ahead prune edge, reversibility) are explicitly no-action. Fix commits 39b610eb / fbe7be29 / c368e50f / 1a1fb08d. Re-validation GREEN: tsc 0; full npm test 706 files / 7947 pass / 11 skip (+4); build:env + build:server + client build 0; ci:changed 0; added-line dash scan clean; fresh qa-checklist READY 0/0 with the four fix commits spot-checked (faithful helper move, no test-order coupling in the log throttle, one-way import chain preserved).

## Phase 20: World Market realm-scope fix + partitioned backfill (separate persistence PR)

Deliverables:
- [x] Realm-scope the world_state 'market' key at BOTH write sites in lockstep (the saveCharacterAndMarketState escrow txn AND saveWorldState) plus the read (loadMarketState); anchor on function names, not the stale lines
- [x] A backfill PARTITIONING the existing global blob by each seller character's realm, idempotent under the advisory lock, with a boot-ordering gate before the first new-key write
- [x] A dry-run + escrow-sum/row-count verification and a documented data-rollback

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Notes:
STALE PREMISE CORRECTED: the realm scoping itself PRE-LANDED via hotfix e5124811c (arrived with the release/v0.19.0 merge): marketStateKey(realm) = 'market:<realm>' was already live at both writers and the read, with a LAZY whole-blob migration inside loadMarketState that claimed the ENTIRE legacy blob for the first booting realm and DELETED the bare row (violating this phase's retain-the-legacy-row stopping rule, and mis-homing cross-realm sellers). Phase 20 therefore kept the landed keys (keeping the test-pinned name marketStateKey, NOT the packet's marketKey; MARKET_KEY_PREFIX added as the single-source constant) and REPLACED the lazy migration with the packet's mechanism. Shipped: NEW server/market_backfill.ts (a *_db-style module, injected client, never imports db.ts; db.ts imports and re-exports its constants), whose runMarketBackfill runs inside ensureSchema's pg_advisory_xact_lock transaction: marker probe ('market_backfill_done') -> no-op on every later boot; legacy SELECT ... FOR UPDATE (serializes against a not-yet-upgraded lazy claim); seller resolution via realm-UNFILTERED characters queries (numeric keys by id with an int4-range guard, name-form keys by name, a multi-realm name stays unresolved); partitionMarketSave routes unresolved/house keys to the backfilling realm and COUNTS them (never drops); verifyPartitionConservation (listing/collection counts, escrow copper, item counts) throws BEFORE any write; partitions upsert in sorted realm order, merging via mergeMarketSaves (id remap clamped above a corrupt max id) when a realm row pre-exists; the legacy row is RETAINED forever (saveWorldState hard-rejects any write to it). Boot-ordering gate: openMarketWriteGate() runs only after ensureSchema COMMITs; saveMarketState / the saveCharacterAndMarketState escrow txn / any market:<realm> saveWorldState throw 'market write blocked' before it. loadMarketState is a pure read: realm row, else (marker present) null, else a defensive legacy READ. MARKET_BACKFILL_DRY_RUN=1 logs the per-realm plan and halts boot deliberately without writing. Tests (6 suites, 44 green): tests/server/market_backfill.test.ts (20), rewritten tests/market_db.test.ts + tests/save_character_and_market.test.ts gate/read pins, tests/schema_wiring.test.ts boot wiring + gate-after-COMMIT + dry-run-halt pins, NEW tests/server/market_realm_isolation.test.ts (two realms on one DATABASE_URL no longer clobber; old behavior documented in a comment) + tests/character_state_backcompat.test.ts (serializeCharacter ?? defaults round-trip). Docs: docs/api-pipeline/phase-20-rollback-runbook.md (dry-run-then-apply, rollback SQL, the mixed-fleet post-backfill-writes-are-LOST caveat + maintenance-window mitigation, fail-closed boot) + server/CLAUDE.md persistence pointer. Reviews (apply-all): migration-safety 0 BLOCKING / 1 SHOULD-FIX (runbook honesty, applied) / 2 NIT (merge clamp + dead-fallback note, applied); privacy-security-review 0/0/1 NIT (int4-range guard, applied); qa-checklist READY 0/0/3 NIT (three coverage tests, applied). Validation: tsc 0; full npm test 716 files / 8046 pass / 11 skip; build:env + build:server + build green; ci:changed clean; dash/emoji scan clean. Also cleaned 14 pre-existing em dashes in touched-file comments (db.ts + save_character_and_market.test.ts). OUTSIDE the dispatch-flag rollback story: persistence is not reverted by API_DISPATCH (rollback is the documented data runbook).

QA pass (phase-20-qa.md, 2026-07-02): PASS, apply-all, zero BLOCKING. Five parallel auditors over the committed diff (correctness, test-coverage, dead-code, migration-safety PRIMARY, privacy-security-review) after an Explore context load; both domain verdicts PASS fresh. All 13 acceptance criteria verified item by item against the real code (no bare-'market' write survives; marker-gated pure-read legacy fallback; constants single-sourced; unresolved sellers counted never dropped; advisory-lock idempotency incl. the concurrent-boot story; gate-after-COMMIT ordering vs game.loadMarket and the 30s autosave with all three write paths traced; conservation-before-write; two-realm isolation; ?? round-trip; scope purity incl. three-host parity and no realm-key leak into src/sim/ or headless/; every new string dev-channel only; runbook cross-checked against code; added-line dash/emoji scan clean via perl -CSD). ONE SHOULD-FIX fixed (doc-only, migration-safety): the runbook's mixed-fleet Caveat 2 described the WRONG old code: the actually-deployed v0.19.0 hotfix lazy migration is a claim-and-DELETE, so a hotfix-era realm with no partition row of its own booting AFTER the backfill would adopt the ENTIRE retained legacy blob into its one realm key (duplicating every already-partitioned listing) and DELETE the rollback artifact, strictly worse than the documented stranded-autosave variant (verified against 438727c2~1:server/db.ts); Caveat 2 rewritten naming BOTH variants and the post-window check extended (legacy NULL means a hotfix-era process adopted and deleted; recover from the adopting realm row plus backup). Nits applied per apply-all: a market-write-fails rollback case (the either-write claim only exercised the character-write half; existing case retitled); copper-only and item-count-only conservation false-path cases (only the listing-drop dimension was independently pinned); a mergeMarketSaves duplicate-key malformed-blob case pinning value conservation under row-collapse (migration-safety's post-merge-assert nit resolved TEST-side: merge conserves copper/items/listings BY CONSTRUCTION since copper sums and items concatenate, only the collection ROW count legitimately shrinks on a key merge, so a 4-field post-merge assert would false-positive on legitimate merges); the marker no-op pin's constant-self-comparison replaced with the 'market_backfill_done' literal; db.ts's market re-export narrowed to marketStateKey only (the other three constants were never db.ts public surface, nothing imports them from ./db, and the comment mis-named game.ts as a consumer); runbook Caveat 5 added (one-way marker: fresh-DB marker with legacyRowFound:false, a later-restored legacy row is never re-adopted without re-running the rollback SQL); a pre-existing U+2192 arrow removed from a touched db.ts comment. No-change-needed (recorded with rationale): the delveClears/companionUpgrades ?? defaults are behavior-neutral behind null-safe spreads (nothing to pin); the any[] rows type in MarketBackfillClient matches pg's own default and db.ts house style; the WORLD_STATE_UPSERT_SQL hand-copy is deliberate cycle-avoidance with both copies literal-pinned; the case-variant 'Market:x' gate shape is unreachable (marketStateKey is the single key producer, no client-controlled world_state key path exists). Fix commits 60350a09 (tests) / 73389609 (re-export narrowing) / 44ae9e6c (runbook) / c63cc0ad (record). Re-validation GREEN: tsc 0; the 6 persistence suites 48 tests green (+4); full npm test 716 files / 8055 pass / 11 skip (bounded workers after two contention-flake full runs whose failing files all pass in isolation); build:env + build:server + build green; ci:changed 0; dash scan clean.

## Phase 21: Security headers top-level wrapper + Content-Type/Origin enforcement

Deliverables:
- [x] withSecurityHeaders via a TOP-LEVEL wrapper covering serveStatic, /c/ SSR, /p/ card, /avatar, sitemap, OAuth GET pages AND the route onion: nosniff, Referrer-Policy, Permissions-Policy deny-all, HSTS in prod, COOP/CORP same-origin, frame-ancestors/X-Frame-Options on OAuth, no-store on auth/token, strip Server/X-Powered-By; explicitly NO COEP:require-corp
- [x] Enforce Content-Type: application/json on /api JSON bodies (415) in LOG-ONLY mode first, exempting binary/HTML/redirect routes, until the Capacitor native client is confirmed
- [x] A cheap Origin/Sec-Fetch-Site check on mutating endpoints (bearer-only, no cookies)

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Notes:
- Impl (2026-07-02). Three new modules under server/http/middleware/: security_headers.ts
  (withSecurityHeaders, a plain top-level setter called as the FIRST statement of
  routeHttpRequest in server/main.ts, ahead of applyCorsAndPreflight, so static, /c/ SSR,
  /p/ card, /avatar, sitemap, all four API prefixes, the OPTIONS-204 short-circuit, and
  BOTH dispatch arms carry identical headers; a flag-off pass is pinned by test),
  content_type.ts (withContentType(route)) and origin_check.ts (withOriginCheck(route)),
  the latter two mounted in dispatch.ts between withMetrics and the route-local middleware,
  self-scoped to surface 'api' plus mutating methods, and existing ONLY on the matched-route
  onion (the delegate-served carve-out: enforcement covers the registered surface; the 18b
  late arrivals landed, so the remainder is the deliberately off-table set).
- Header set: X-Content-Type-Options nosniff; Referrer-Policy strict-origin-when-cross-origin;
  a Permissions-Policy denying 18 sensor/capability features that deliberately EXCLUDES
  fullscreen and gamepad (in live use: src/main.ts requestFullscreen for the mobile landscape
  lock, src/game/gamepad.ts) plus autoplay and screen-wake-lock (plausible game features);
  COOP and CORP same-origin; HSTS max-age=31536000; includeSubDomains under
  NODE_ENV=production ONLY; the /oauth/ prefix additionally gets X-Frame-Options DENY and
  Cache-Control no-store (the /oauth/token and /oauth/device_authorization JSON responses
  carried NO Cache-Control before this phase; the HTML pages already set their own).
  X-Frame-Options was chosen over a frame-ancestors CSP because the packet forbids ANY
  Content-Security-Policy header (full CSP is a separate report-only effort); NO COEP
  (cross-origin GLB/HDRI).
- 415 gate: LOG-ONLY default behind API_CONTENT_TYPE_ENFORCE ('1'/'true' enforces, read per
  request). Exemption reads MATCHED RouteDef metadata, never a path list: the NEW
  RouteMeta.requestBody ('json' | 'binary') with POST /api/card declared 'binary' (its error
  ENVELOPE stays the surface problem+json; requestBody is the request-side classifier), plus
  envelope binary/html/redirect defensively. Absent Content-Type always passes (bearer-only
  surface). Audited: the site-presence/perf-report beacons SEND application/json, so they are
  gated-but-passing, not exempted. Enforce throws HttpError(415, 'body.unsupported_media_type').
- Origin check: LOG-ONLY default behind API_ORIGIN_CHECK_ENFORCE. Mutating methods only;
  ABSENT Origin ALWAYS allowed (bearer-only, no cookies; beacons and native clients must keep
  working); allowed = same-origin host (the Host/X-Forwarded-Host comparison mirroring
  isWebClientRequest) OR allowedCorsOrigin (ONE allowlist shared with CORS: realm vhosts +
  capacitor://localhost family + app://worldofclaudecraft family); the literal 'null' and any
  unparseable Origin count as cross-site; Sec-Fetch-Site is recorded as audit context, never
  gated on (an allowlisted realm origin is cross-site by its definition). Enforce throws
  HttpError(403, 'origin.cross_site'). ENFORCE-AUDIT NOTE: the WEB_ORIGINS env allowlist and
  the localhost dev regex that isWebClientRequest also accepts are NOT in this gate's allow
  set; revisit at the flip.
- Codes + i18n: body.unsupported_media_type and origin.cross_site appended (error_codes.ts,
  EXPECTED_CODES, DETAILS, OAUTH_ERROR, STATUS_REASON 415). English errors.api.unsupportedMediaType
  + errors.api.crossSiteOrigin added to shell.ts; the packet's "apiError.*" family does not
  exist in the tree, errors.api.* is the real one. M16 (wordy English) required the five
  non-Latin fills, which live in the i18n.locales OVERLAYS (the build reads the catalog for
  en ONLY; shell.ts inline locale blocks are not consumed). userFacingApiError untouched
  (Phase 22).
- Harness: all 88 goldens re-pinned through routeHttpRequest (verified additive-headers-only,
  zero body/status drift, byte-stable across two regens); the securityHeadersAllSurfaces
  knownDeviation records the contract change (old-vs-new parity needs NO masking: both arms
  share the one wrapper); onion_order.test.ts pins the two new global frames (log-only
  records + full pass-through inside the real onion); route_dispatch.test.ts's local fakeRes
  gained removeHeader (the wrapper's defensive Server/X-Powered-By strip); card_route.test.ts's
  hand-built onion now applies withSecurityHeaders first, mirroring the real serving path its
  byte-identical golden captures.
- Validation: tsc clean; the three new suites (12 + 21 + 22 tests) green twice; parity,
  characterization x2, completeness, ownership_coverage, known_deviations, surface_inventory,
  onion_order, route_dispatch, error_codes, importable_spine green; full tests/server 68 files
  / 1361 pass; S3 green; i18n_completeness (M16) green; ci:changed clean (also picked up a
  pre-existing scripts/gate.mjs format drift from the QA-tooling commit, fixed); build:server
  green; full npm run gate green pre-commit.
- Reviews (all three dispatched in parallel, apply-all; a first dispatch died on a transient
  auth outage and was re-run, zero verdicts inferred from the dead run): privacy-security-review
  0 CRITICAL / 2 WARNING (fed the native-client coverage cross-platform-sync would otherwise
  own; confirmed the beacons use fetch with application/json, NOT sendBeacon, and CORP
  same-origin is safe because all web assets are same-origin); test-coverage-auditor 0 BLOCKING
  / 2 SHOULD-FIX / 3 NIT; qa-checklist READY 0/0/2-NIT. ALL findings applied: the real card
  RouteDef's requestBody 'binary' is now literal-pinned in card_route.test.ts (the enforce-flip
  protection); the envelope binary/html/redirect exemption arms are tested in both modes; the
  415/403 title + detail English prose literal-pinned; a DELETE mismatch case per gate proves
  the mutating set is not POST-only; the WEB_ORIGINS divergence is documented IN
  defaultAllowOrigin (an operator adding to WEB_ORIGINS does not widen the gate); the
  un-throttled-sink log-amplification hazard is recorded as a Phase 23 handoff in state.md;
  scripts/gate.mjs's pre-existing format drift split into its own chore commit. Adjudicated
  no-change per the auditors' own recommendations: a dedicated new-dispatcher-served header
  integration test (parity's both-modes full-header equality plus the migrated-route goldens
  already pin it) and reconciling the origin allowlist with WEB_ORIGINS now (deliberately
  deferred to the enforce-flip audit so that traffic stays visible in the log records). The
  dedicated phase-21-qa.md gate is the SEPARATE next step.
- Handoff: flipping either enforce flag is gated on the native/beacon traffic audit reading the
  two log-only sinks in production; Phase 22 wires the two new codes into userFacingApiError;
  Phase 24 may consolidate the flag reads into loadConfig; Phase 25's ladder deletion inherits
  the top-level wrapper unchanged (it is dispatch-mode-independent by construction).

Phase 21 QA gate (phase-21-qa.md, dedicated independent audit, 2026-07-02): PASS, 0 BLOCKING /
2 SHOULD-FIX (both test-coverage gaps, both applied) plus nits applied per the apply-all rule.
A 4-auditor fan-out (correctness, test-coverage-auditor, dead-code, privacy-security-review)
over one Explore context brief; the two custom-agentType workflow auditors returned empty
mid-run and were re-dispatched as direct agents (zero verdicts inferred from the dead runs).
All ten acceptance criteria plus the stopping rules verified CLEAN against HEAD, including a
release-merge check: HEAD gained c582aec7 (release/v0.20.0) after the phase; verified 12
client-UI files only, zero overlap with the Phase 21 surface. Applied:
- (SHOULD-FIX) enforce-mode absent/empty Content-Type cases in content_type.test.ts: the
  load-bearing native-client allowance was tested only in log-only mode, so a refactor moving
  the absent-header guard below the enforce throw would have 415'd every Content-Type-less
  client at the flip with no test failing.
- (SHOULD-FIX) a real-dispatcher gate-mount test in dispatch.test.ts (onion_order's stack is a
  hand-built replica): an enforce-mode cross-site, wrong-type POST resolves 403
  origin.cross_site with exactly one sink line, ahead of route-local middleware, pinning gate
  presence AND mount order on the real createApiDispatcher onion.
- (nits) MUTATING_METHODS single-sourced (exported from content_type.ts, imported by
  origin_check.ts; the two copies were divergently typed ReadonlySet of Method vs string); the
  dead opts.env ?? process.env fallback dropped in withOriginCheck; HEAD non-gating pinned per
  gate in both modes; the state.md enforce-flip note now names the two sink log tags to harvest
  (one grep style misses the other), the X-Forwarded-Host same-origin caveat (spoofing fails
  toward allow; consider trusted-proxy gating at the flip), the QA-confirmed desktop/Capacitor
  enforce-flip safety (both origin families ride the shared allowedCorsOrigin set), and the
  API_DISPATCH=new watch-item (not before Phase 23 bounds the sinks).
Adjudicated no-change, per the auditors' own leans: RouteMeta.requestBody keeps the 'json'
vocabulary arm (self-documenting; absent means json); oauth.ts's three writeHead no-store
literals agree with the wrapper today (Phase 25 consolidation candidate); no-store stays
scoped to /oauth/ rather than the /api login family (browsers do not cache POST responses;
informational); the OAUTH_ERROR mappings for the two new codes are unreachable until Phase 22
wires them (forward-looking by design); no /c/-SSR-specific header integration case (the
wrapper is the path-independent first statement and the unit layer pins the set for an
arbitrary URL); no WS-upgrade header test (the upgrade path bypasses routeHttpRequest by
construction); X-Frame-Options stays scoped to /oauth/ (bearer-auth surfaces carry no ambient
credentials; frame-ancestors belongs to the deferred CSP effort); CORP same-origin
re-confirmed safe (OG unfurls are server-side crawls; CORS-mode asset fetches ignore CORP).
privacy-security-review verdict: ship-safe; rejections and sink records leak nothing (route
template only; no Authorization header, token, or body is logged). Validation green post-fix:
tsc 0; the 11-file targeted matrix 202 pass / 3 skip (parity, characterization goldens, S3
included); ci:changed; build:server; full npm run gate on the committed state (unpiped
background run per the piped-tail trap).

## Phase 22: REST i18n matcher + per-surface code-parity guard

Deliverables:
- [x] Extend userFacingApiError to look up emitted codes DIRECTLY in the client catalog instead of reverse-matching English prose; port parametric cases (suspended-until {date}, the {seconds} rate-limit families) to {code,params}; preserve its dual REST + WS-disconnect-reason role
- [x] Add apiError.* English catalog entries and wire them into client i18n; params formatted client-side via formatNumber/formatDuration/Intl
- [x] A per-surface code-parity Vitest asserting every server-emitted code resolves to a client entry in every locale, append-only frozen, PLUS coverage for the ~30-45 EXISTING REST strings (currently unguarded; S3 scans only game.ts) and the new Discord/guild codes

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Notes:
- Reviews (2026-07-02, apply-all): cross-platform-sync PASS (0 BLOCKING / 0 SHOULD-FIX;
  verified byte-identical prose move, 59/59 code-catalog-table parity, machine-only
  params, twin parity, WS role unchanged; INFO: the pre-existing uncoded 'token not
  found' and 'image too large' raw-English leaks are later-phase candidates, and the
  REST suspension date is now locale-formatted while the WS kick keeps the raw UTC
  string, an accepted asymmetry). qa-checklist READY (0 BLOCKING / 0 SHOULD-FIX / 2
  NITs, both applied: the characters.test.ts moderation fake now sets banned:true and
  pins moderation.banned; the parity guard's dimension-3 failure messages now name the
  real API_ERROR_KEYS export). privacy-security-review / migration-safety /
  architecture-reviewer exclusions re-confirmed VALID against the actual diff.
- Impl (2026-07-02). Client: userFacingApiError + technicalErrorMessage EXTRACTED from
  src/main.ts into the pure DOM-free src/ui/api_error_i18n.ts (main.ts stays a thin
  consumer; the matcher is finally unit-testable). Resolution order: stable problem+json
  code FIRST via the exported API_ERROR_KEYS identity table (the ONE declarative
  code-to-key mapping: code 'domain.reason' -> t('apiError.<domain>.<reason>'), 59 rows,
  exact set-parity with server/http/error_codes.ts), the legacy prose arms SECOND (moved
  verbatim; still required for un-migrated old-ladder routes until the Phase 25 ladder
  deletion), raw diagnostic English LAST. An unknown or param-starved code falls through
  to prose. ApiError (src/net/online.ts) now captures a top-level string `code` plus the
  body params. Parametric ports, both formatted CLIENT-side: moderation.suspended_until ->
  t(key, {date: formatDateTime(parsedIso)}); rate_limit.exceeded -> {seconds} via the NEW
  formatDuration(seconds) in src/ui/i18n.ts (cached Intl.NumberFormat style 'unit',
  per-locale plural rules). WS-disconnect branches (loading.*, tServer moderation.*) and
  the intentionally-English diagnostics moved unchanged.
- Catalog: NEW src/ui/i18n.catalog/api_error.ts (flat en-only domain, export
  apiErrorStrings, nested identity keys, deliberately no `as const`) wired as `apiError`
  in the index.ts barrel. One English entry per code; existing vocabulary REUSED verbatim
  where an equivalent errors.api.* / hudChrome.account.* / server_i18n English exists.
  M16 non-Latin fills (zh_CN, zh_TW, ja_JP, ko_KR, ru_RU) for every wordy value, copying
  the existing human translations for reused English; Latin locales stay pending for the
  release fill. Resolved artifacts regenerated; sha legitimately re-baselined to
  f203483ecaba2234aecbf14bdea5bb613933665fdc3cf8546d887a9957e04425 (content addition).
- Server (the coded-emission pass the ratified premise shift assigned here): ADDITIVE
  `code` fields alongside byte-identical legacy prose in BOTH dispatch twins
  (auth_routes, account, characters, discord, wallet, the desktop_login shared throttle,
  turnstile, bearer_active_guard, and every server/main.ts legacy arm). NEW shared
  moderationErrorBody(status) in http_util.ts (banned -> moderation.banned;
  suspendedUntil -> moderation.suspended_until + machine ISO `date`; deactivated ->
  account.deactivated; else -> moderation.suspended), unit-tested in
  tests/server/moderation_error_body.test.ts. 9 NEW discord.* codes appended to
  error_codes.ts + snapshot (not_configured, expired, already_linked, password_required,
  unknown_swag, link_required, swag_claimed, swag_tier, swag_points). 21 characterization
  goldens regenerated, git-diff audited additive-only. DISCORD_POLICY stays UNMOUNTED
  (mounting would switch the 429 to problem+json and change limiter keying: observable,
  deferred to the P25 window). Left prose-only deliberately: 'rate limited',
  'server_error', 'too many attempts, slow down', the github/desktop-login/daily-rewards
  domain bodies (Phase 18b adjudication), and the /api/search legacy divergent arm.
- Guards: NEW tests/api_error_code_parity.test.ts, 5 dimensions (SoT enumeration from
  ERROR_CODES, every-code every-locale non-empty resolution with the exact missing
  apiError.<code> key named on failure, API_ERROR_KEYS table parity, per-locale
  placeholder parity pinning {date}/{seconds}, append-only literal 59-code freeze),
  closing the historically UNGUARDED REST matcher gap (S3 scans only the WS path). NEW
  tests/main_api_error.test.ts (18 runtime matcher tests, code/prose/parametric/WS/
  diagnostic). tests/server/rate_limit_copy.test.ts re-pointed at the extracted module.
- Validation: tsc green; new suites + S3 + architecture green; npm run gate PASS all 9
  steps; i18n regen idempotent (hash stable across re-runs).
- QA GATE (phase-22-qa.md) DONE (2026-07-02): PASS, apply-all, zero BLOCKING. Seven
  parallel auditors over the a363a25c..HEAD diff: correctness (all 6 acceptance items and
  all 7 stopping rules PASS; the prose fallback verified byte-for-byte verbatim against the
  pre-phase src/main.ts, every one of the ~45 arms accounted for), test-coverage (1
  SHOULD-FIX + 3 NIT), dead-code/cleanup (CLEAN; mapped which prose arms are fully shadowed
  for the P25 removal vs which MUST STAY: 'rate limited', the 8 'too many attempts, slow
  down' account arms, the not-found triple, the not-authenticated arm incl. the /api/search
  legacy divergent 401, the desktop 'invalid or expired' pair, and all WS-delivered prose),
  server coded-emission (all 9 checks PASS: byte-identical prose, additive-only, every twin
  pair matched, moderationErrorBody mirrors require_account, and the ENUMERATION posture:
  unknown-username and wrong-password share auth.invalid_credentials, IP blocks ride the
  generic auth.too_many_attempts, the Phase 16 opaque discord paths stay uncoded),
  privacy-security-review (PASS, no new disclosure channel; the machine ISO date encodes
  the same instant the prose already showed), cross-platform-sync (PASS; params traced end
  to end on BOTH body shapes), qa-checklist (READY; *_i18n.ts confirmed exempt from
  UI_PURE_CORES by the architecture sweep's _view/_core name filter).
- QA fixes applied (apply-all): [SHOULD-FIX] the moderation.suspended_until date-ABSENT
  defer-to-prose arm was untested (a mutation rendering "suspended until undefined" passed
  the suite) -> pinned in tests/main_api_error.test.ts. The parity guard gained DIMENSION
  6: the apiError.* catalog leaf set must EQUAL ERROR_CODES (seals the phantom-leaf
  direction nothing covered) and no English value may carry a placeholder outside the
  PARAMETRIC_TOKEN_PINS contract (resolveByCode calls a bare t(key) for every
  non-parametric code, so a stray {token} would render literally).
  moderationErrorBody <-> requireAccount are now MIRROR-GUARDED (the same status driven
  through both emitters must derive the same code + date; each was previously only
  literal-pinned alone). exportData (src/net/online.ts) routed through apiErrorFromBody
  (it was the one client fetch error path still dropping the code). SWAG_REASON_CODE's
  `as` cast replaced by an === 'ok' narrowing so a future canClaimSwag refusal reason
  fails tsc instead of silently emitting no code. The discord emit sites are
  literal-pinned in tests/discord_server.test.ts ({error, code} toEqual for expired x2,
  the already_linked TOCTOU race, password_required, unknown_swag, link_required,
  swag_tier, plus NEW swag_points, swag_claimed, unlink-404 account.not_found, and
  login/link invalid-credentials pins). End-to-end {date} capture through mocked fetch
  added alongside the existing {seconds} one.
- QA adjudicated NO-CHANGE: the /api/search uncoded 401 (the documented legacy divergent
  arm, deliberately prose-only); the dual not-authenticated codes (auth.token_missing on
  problem+json vs auth.required on legacy bodies) are the intended dual-path design; the
  stableStringify key-order canonicalization stands; the two parametric code literals in
  resolveByCode stay raw (AIP-193 forbids renames and dimension 6 now guards the
  placeholder side). Transitional divergences resolve at P25, do not fix early: apiError.*
  rewording vs the legacy prose keys, and the REST locale-formatted date vs the WS raw UTC
  kick.
- QA re-validation: tsc 0; touched + guard suites green (259 tests incl. architecture, S3,
  M16); i18n regen idempotent (tree clean after i18n:gen); ci:changed 0 errors; npm run
  gate PASS all 9 steps.

## Phase 23: Structured logging + /metrics exporter + drain-aware health

Deliverables:
- [x] A pino-shaped logger facade replacing the ~70 raw console.* calls on the request path, with secret/PII redaction (Authorization/bearer 64-hex/password/cookie/OAuth-code/TOTP/wallet-key); structured access line + X-Request-Id echo on every response via the ALS reqId reaching db.ts/domain fns (the real request-path count is ~37, the ~70 SPEC estimate was a loose bound; the echo is built + unit-tested on 2xx and thrown-5xx with the error-path live, the 2xx dispatch-onion mount deferred to P25 for parity, see Notes)
- [x] A Prometheus /metrics exporter (prom-client, the one weighed dependency) emitting the RED request-layer catalog with bounded cardinality (route = :param template, never concrete path)
- [x] /livez + /readyz with /readyz reporting NOT-ready during the SIGTERM drain

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed
- [x] Reviews clean

Notes (implementation, 2026-07-03):
- New modules: server/http/redact.ts (pure; key needles + Bearer/64-hex value patterns + OTP-scoped
  numeric/dashed codes; Buffer/TypedArray/ArrayBuffer values collapse to REDACTED; idempotent,
  cycle-safe, never throws), server/http/logger.ts (in-house pino-shaped facade, NO pino; one JSON
  object per line; ALS reqId via currentReqId() at emit time, omitted outside a request; redact()
  before every write; injectable transport, default singleton on the process streams),
  server/http/access_log.ts (MetricSink; one 'access' line per onion-served request; ip TRUNCATED
  at the log surface via truncateIpForLog, IPv4 /24 + IPv6 /48), server/http/metrics.ts
  (createHttpMetrics(): per-instance Registry; http_requests_total + http_request_duration_seconds
  with the named HTTP_DURATION_BUCKETS_SECONDS constant; labels route/method/status only;
  collectDefaultMetrics per-registry, enabled at boot), server/http/health.ts
  (markDraining/isReady/isLive + the /livez, /readyz, /metrics handler helpers, all
  Cache-Control: no-store).
- Wiring: composite teeMetricSink(accessLog, metrics.sink) (additive export on metric_sink.ts,
  per-sink error isolation) injected into ALL FOUR createApiDispatcher sites in main.ts;
  noopMetricSink stays the dispatch.ts default for unit tests. GET /livez, /readyz, /metrics mount
  as top-level routeHttpRequest arms after applyCorsAndPreflight and before /internal/ (outside
  auth/rate-limit, security headers inherited); markDraining() is the FIRST statement of the
  shutdown closure. MetricEvent gained an optional ip (populated by withMetrics from ctx; never a
  metric label). Verified through the real ladder under BOTH dispatch modes.
- X-Request-Id: echo built into withRequestId (setHeader on the way in; REQUEST_ID_HEADER
  single-sourced with compose.ts), unit-tested on 2xx and thrown-5xx. LIVE MOUNT DEFERRED TO P25:
  mounting in the dispatch onion adds the header to migrated 2xx/429/404 responses the retained
  legacy delegate never emits (44 parity divergences); the error-path echo is live via errors.ts
  baseHeaders; NOTE comment at the dispatch.ts mount point. Also not live pre-P25: access
  lines/metrics for 'legacy'-mode /api requests (only onion-run routes traverse withMetrics).
- Console sweep (~37 request-path sites): main.ts (3, incl. the legacy handleApi 'api error'
  catch), oauth, admin, discord, auth_routes, profile_page, player_card, woc_balance, github,
  moderation_service, email/index, plus the content_type/origin_check/require_owned/rate_limit
  middleware default sinks. errors.ts keeps its console default (import cycle via context.ts):
  dispatch.ts injects a logger-backed onUnexpected instead. email/sender.ts console dev transport
  kept (console IS the transport). Boot, world-loop, and WS-lifecycle console calls untouched.
- Malware scan: the redactor deny-list names wallet-secret identifiers, tripping 13 high key-exfil
  flags; a release-malware-audit triage dismissed all 13 (replace-only deny-list, no egress, values
  never read). Fix: a generic per-rule pathSev in scripts/malware_scan.mjs (+ .d.mts type), demoting
  the wallet-identifier rule high to medium for EXACTLY server/http/redact.ts +
  tests/server/http/redact.test.ts; pinned in tests/malware_scan.test.ts (widening the path list
  fails a test; Keypair/HD-derivation/exec rules still fire HIGH inside redact.ts). Flag as
  intentional at the release-malware-audit gate.
- Reviews (apply-all): privacy-security-review 0 BLOCKING, 1 SHOULD-FIX applied (full ip replaced
  by log-surface truncation; the "existing ratelimit practice" rationale was wrong) plus the
  byte-collapse and the never-log-raw-url/headers/body convention note; /metrics exposure
  acceptable-for-now, the gate decision (token/bind/rate-limit + any full-ip exception) is Phase
  24. qa-checklist READY 0 BLOCKING; 1 SHOULD-FIX applied (the 3 legacy main.ts console sites) + 2
  nits (stale content_type comment, dashed user-code redact pin). NOT dispatched (triggers absent):
  migration-safety, cross-platform-sync, architecture-reviewer. S3 + code-parity not in play (no
  player-facing string or error code added).
- Validation: tsc 0; new/extended suites green (redact, logger, access_log, request_id, metrics,
  health, metric_sink, dispatch, malware_scan); npm run gate PASS all 9 steps (730 files / 8260
  tests); build:server bundles prom-client 15.1.3 (pinned exact; subtree
  tdigest/bintrees/@opentelemetry/api).

QA GATE (phase-23-qa.md) DONE (2026-07-03): PASS, 0 BLOCKING. Independent 5-dimension audit
(Explore context loader + correctness / test-coverage-auditor / dead-code /
privacy-security-review / qa-checklist). correctness: all 10 acceptance criteria PASS (criterion 4
PASS-with-documented-deferral: the live 2xx X-Request-Id mount is the P25 flag-flip decision;
criteria 1/3 carry the documented legacy-mode gap, no /api access line/metric/reqId until P25
flips the flag). test-coverage: all 11 claimed behaviors COVERED-DECISIVE, 154/154 targeted tests.
dead-code: categories clean except unused-export nits. qa-checklist READY (exclusions confirmed:
migration-safety no-DDL, cross-platform-sync + architecture-reviewer server-only; S3 + per-surface
code-parity not in play; release-malware-audit owns prom-client at release).
- Findings applied (apply-all, 6 commits adb1cb11f..05b53548f): (1, correctness SHOULD-FIX)
  all three legacy-delegate arms (un-migrated path, HEAD match, the 'legacy' entry that is the
  production default) ran OUTSIDE any runWithReqId, so swept logger lines there carried no reqId;
  dispatch.ts delegateWithReqId now binds a fresh id around each (observability-only, response
  bytes untouched, test-first with 3 red-then-green pins). (2, coverage SHOULD-FIX)
  HTTP_DURATION_BUCKETS_SECONDS was never literal-pinned; metrics.test.ts now pins the 11
  boundaries + le= exposition. (3) REQUEST_ID_HEADER single-sourced in errors.ts (the LIVE
  error-path emitter; compose.ts re-exports; the reverse import would cycle via context.ts).
  (4) un-exported LogLevel + HTTP_METRIC_LABELS, dropped unused HttpMetricLabel. (5) the lazily
  request-reachable email transport banner routed through the logger. (6) coverage nits: opaque
  non-hex token-key redact pin, X-Request-Id echo isolated from withErrors (the composed 5xx test
  passed without withRequestId's setHeader), livez/readyz integration under BOTH dispatch modes,
  the production composite teeMetricSink(accessLog, prom) shape driven end to end through the
  dispatcher. (7) NEW guard tests/server/http/logger_call_hygiene.test.ts: scans every server
  logger call site and fails on raw req.url / req.headers / ctx.req / ctx.body wholesale (the
  string-level redaction only covers Bearer + 64-hex, so the convention needed a test, not review).
- Conscious keeps (not dead code): Logger.child() and health.isLive() are SPEC-MANDATED exports
  (the phase doc names both; isLive is deliberately constant-true and handleLivez deliberately
  hard-codes 200, wiring it would create an untestable dead 503 branch); the 'no-store' constant
  duplication with security_headers.ts stands (coupling health.ts to it is worse);
  HttpMetrics/CreateHttpMetricsOptions/LogFields/LoggerOptions stay exported (public-signature
  types). serializeErrors' top-level-only Error flattening is now documented in the logger header
  (a NESTED Error serializes via enumerable props; pg DatabaseError detail can carry row values).
- privacy-security-review: 0 CRITICAL. ONE WARNING CARRIED FORWARD: /metrics is unauthenticated on
  the public listener (route-template + process/runtime disclosure); acceptable within this phase
  by design, but Phase 24 MUST land the exposure gate (ops token / loopback bind / network policy)
  BEFORE API_DISPATCH=new reaches production. DoS posture mild (bucketed Histogram, no per-scrape
  percentile cost). INFO deferrals to the P24 privacy batch: an optional email value-pattern in the
  redactor (error-path-only residual risk today, every swept site logs {err} with top-level
  flattening to {message,stack}).
- Validation after fixes: tsc 0; the 11 touched/adjacent suites green (150 tests incl. the new
  guard); ci:changed clean (pre-existing warnings only); full npm run gate PASS re-run unpiped.

## v0.20.0 release merge (2026-07-03): merge c916d296a + release-merge audit

The FULL v0.20.0 merge (distinct from the earlier client-UI-only slice c582aec7 the Phase 21
QA note records; this one DOES touch the API surface). Merged release/v0.20.0
(tip 1e1883d6a) with the router-side reconciliation folded into the merge commit, then ran
the release-merge-audit skill over it (11 parallel auditors: 8 overlap slices reading the
merged result against both parents, plus injections / endpoints / planning-docs sweeps).
Verdict: ZERO blocking; the merge is a verified clean union on every overlap slice.

What the merge brought onto the pipeline, all migrated INSIDE the merge commit (no owning
phase; provenance = c916d296a): POST /api/account/email/set-initial (mandatory-email
backfill, activeGuard, shared handler both arms, the release's rateLimited(req) boolean call
adapted to the Phase 19 .allowed outcome shape), GET /api/daily-rewards/leaderboard +
POST /internal/daily-rewards/leaderboard (both daily families now four routes each, shared
sub-dispatcher cores), GET /admin/api/detection-calibration (AdminRuntime pick extended).
Auth contract change mirrored into auth_routes.ts: register 400s a missing/invalid signup
email (email.invalid, the existing catalog code) before the username lookup and always
stores the address; register and login answer emailMissing. Harness deltas:
SURFACE_INVENTORY 120 -> 124, MIGRATED_ROUTES 65 rows, internal ladder derivation 15 (ops
4), auth + secret mounting sweeps 9 authed /api routes, content-type rows +4,
captureBothModes re-pins for the three authed arrivals, admin ladder 33 branches. Also in
the release: server/msg_rate_limit.ts (WS-side global inbound message token bucket, a Phase
24 tunables-inventory item, NOT part of the REST limiter), bot-detector calibration
histograms (contract + stub + the private overlay implementation, which lives outside this
repo's git), discord_email capture columns, and the world-boss/quest-UI content. Audit
findings applied: the missing leaderboard parity pins, daily_rewards.ts route-banner counts,
and the state.md/phase-24/phase-25 premise corrections (route-set 12 -> 16, the WS limiter
carve-out, main.ts ~2080 lines, the redactor email pattern upgraded to strongly
recommended).

## Phase 24: Validated config + server timeouts + no-magic-values consolidation

Deliverables:
- [x] A validated fail-fast config read ONCE at boot via the pure loadConfig(env) from P2 (HSTS-in-prod, REQUIRE_WEB_LOGIN, realm/native-app origins, limiter DSN, the dispatch flag), replacing scattered process.env reads; log the active dispatch path at boot and alert if the old path is active in prod
- [x] Set requestTimeout/headersTimeout/keepAliveTimeout/maxHeaderSize in startServer() with chosen named-constant values mindful of the WS upgrade handshake and the 1 MB card upload
- [x] Consolidate every tunable into named constants with unit + comment; POLICIES values DERIVE from existing constants
- [x] Add the perf/tick-jitter acceptance gate (pipeline adds < X ms p99, tick p95 stays under 0.8 x DT)

QA:
- [x] Fixes applied
- [x] Tests added
- [x] Dead code removed (audit CLEAN: nothing to remove; six letter-unclassified env reads adjudicated intentional-keep, exceptions block trued up)
- [x] Reviews clean

Notes:

DONE 2026-07-03 (one session, Explore + four hand-spawned slice agents + two in-phase
reviewers apply-all). New/changed symbols: loadConfig (server/http/config.ts) is the
validated fail-fast boot edge (DATABASE_URL kept, doubling as the tier-2 limiter DSN,
there is no separate limiter env; API_DISPATCH set-but-invalid now THROWS, unset stays
DEFAULT_DISPATCH; REQUIRE_WEB_LOGIN + API_CONTENT_TYPE_ENFORCE + API_ORIGIN_CHECK_ENFORCE
throw on garbage; PUBLIC_ORIGIN must parse as a bare http(s) origin; a non-empty REALMS
needs a usable Name=origin entry; new fields requireWebLogin, metricsToken) with a six-item
conscious-exceptions comment block (per-request secret gates, game.ts dev reads, domain
config getters, the middleware env= seams, the db.ts pool, the tolerant realm keys).
server/main.ts: the 8 module-scope env consts are gone; boot-consumed values thread off
the startServer-primed Config and request-time consumers read the lazy memoized
activeConfig() (+ resetActiveConfigForTests), so a bare import stays env-free (importable
spine intact); loadConfig runs FIRST in startServer (fails before the DB retry loop);
logApiDispatchSelection logs the active path and logger.warn ALERTS on legacy+production;
github_contributors is runtime-configured (its duplicate GITHUB_* module reads removed).
The P23 carried must-gate LANDED: handleMetricsGate (server/http/health.ts) serves
GET /metrics 404 feature-off when METRICS_TOKEN is unset, else Bearer + length-guarded
timingSafeEqual with an opaque 401, every arm no-store, both dispatch modes gated
(top-level arm); DEPLOY.md gained the ops note (set the token on server AND scraper).
The redactor email value-pattern (P23 carry) landed with RFC-BOUNDED quantifiers after
privacy review measured the first unbounded regex quadratic (seconds on a 60 KB value):
EMAIL_RE {1,64}@{1,255}.{2,24} + an includes('@') probe scans linearly (about 9 ms at
80 KB), with pathological-input regression tests under a 2 s cap. PgRateLimitStore now
receives the composite httpMetricSink (module-scope reorder). NEW
server/http/server_timeouts.ts: REQUEST_TIMEOUT_MS 300000 / HEADERS_TIMEOUT_MS 60000 /
KEEP_ALIVE_TIMEOUT_MS 5000 / MAX_HEADER_SIZE_BYTES 16384, measured EQUAL to the installed
node defaults so behavior is byte-identical, wired via createServer({maxHeaderSize}) +
applyServerTimeouts; headersTimeout > keepAliveTimeout pinned; PACKET PREMISE CORRECTED:
the card cap is MAX_CARD_BYTES = 4 MiB (player_card.ts), not "1 MB" (the 1 MiB body is
bug-reports). Consolidation: WS_MAX_PAYLOAD_BYTES (16 KiB, never-widen comment),
BUG_REPORT_MAX_BODY_BYTES deduped (exported from reports.ts, imported by main.ts),
DAILY_PRUNE_INTERVAL_MS, DB_BOOT_MAX_ATTEMPTS + DB_BOOT_RETRY_MS, DB_POOL_MAX_CLIENTS,
AUTH_MAX_PER_MINUTE (the rateLimited default budget), six daily-rewards decode defaults;
msg_rate_limit.ts stays module-owned WS-plane by explicit decision; POLICIES already
derived (P19), now pinned by tests/server/tunables.test.ts (identity AND literal per
policy, plus a targeted no-duplicate source scan). NEW server/http/perf_gate.ts:
DT_MS = 1000/TICK_RATE (=50), TICK_P95_CEILING_RATIO 0.8 (ceiling 40 ms),
PIPELINE_ADDED_P99_BUDGET_MS 1.0; tests/server/perf_gate.test.ts has two deterministic
always-on arms (TickProfiler synthetic p95 + a bounded-work onion-vs-legacy proxy: O(1)
dispatch, registry-size independent, template-bounded sink cardinality) and an env-gated
wall-clock arm (PERF_GATE_WALLCLOCK=1; measured added-p99 about 0.005 ms, tick p95 about
0.44 ms); single-threaded vitest cannot reproduce tick-GAP jitter, npm run perf:load stays
the live soak. DECISIONS: no timed drain window added (none exists; additive behavior,
deferred to P25 as an explicit decision item); no full-ip log exception (nothing needs
it); the daily-rewards pagination upper clamp is a pre-existing gap left untouched
(non-behavioral contract). Reviews apply-all: privacy-security-review 0 BLOCKING, 1
should-fix (the ReDoS, fixed same session); qa-checklist READY 0 BLOCKING (DEPLOY.md ops
note + the rateLimited default-binding pin applied). DEPLOY-ENV AUDIT WARNING: the
stricter PUBLIC_ORIGIN/REALMS validators throw at boot on garbage values a deploy env may
currently tolerate; audit the real env before this branch ships. Maintainer to-do
resolved with a corrected premise: the private bot_detector repo main ALREADY implemented
the calibration contract (PR #7), so the overlay was refreshed FROM it instead of
committing the merge-session stopgap upstream; its environment_probe.test.ts is locally
removed (imports src/game/client_env, unshipped main-repo client work). Validation:
tsc 0, npm run gate PASS all 9 steps (752 files / 8580 passed + 13 skipped),
build:server green. NEXT: Phase 24 QA gate (phase-24-qa.md).

Phase 24 QA gate (phase-24-qa.md) DONE (2026-07-03): PASS, apply-all, 0 BLOCKING.
Five-track audit over the phase-scoped diff 260bfb916..309874bd6 (raw main...HEAD carries
out-of-scope v0.20.0 release content per the packet's premise correction): a 12-agent
workflow (correctness vs the ten STEP 5 ACs, test-coverage, dead-code; every
BLOCKING/SHOULD-FIX finding verified by 3 adversarial lenses, 9/9 upholds) plus
privacy-security-review and qa-checklist as direct reviewers. All ten ACs MET (AC2/AC5
as amended by the corrected premises: the validated key set is DATABASE_URL /
REQUIRE_WEB_LOGIN / the two enforce flags / PUBLIC_ORIGIN / REALMS / API_DISPATCH, and
the card comment cites the 4 MiB MAX_CARD_BYTES). THREE SHOULD-FIX found, all fixed
(a76ccbc37 comments, 3ce3702f3 tests, 73ca3de65 docs):
(1) SET-BUT-EMPTY numeric env default-shift: pre-P24 'CHAT_LOG_RETENTION_DAYS=' meant
Number('') = 0 = keep chat logs forever; numberOr reads empty as unset, so the same
placeholder line now means the 90-day default and pruning silently turns ON
(irreversible). Semantics deliberately KEPT (empty = ambiguous = default; the legacy 0
was a JS quirk) and pinned in config.test.ts (explicit 0 stays keep-forever), with the
hazard added to maintainer action 1 and a DEPLOY.md env-hygiene bullet.
(2) The startServer timeout wiring was asserted only by inspection (deleting
applyServerTimeouts(server) stayed green); tunables.test.ts now source-pins
createServer({ maxHeaderSize: MAX_HEADER_SIZE_BYTES }) + applyServerTimeouts(server).
(3) The perf-gate header overclaimed O(1) dispatch: counted seams cannot see an
O(routes) matcher scan internal to one dispatch (it still counts 1 per seam), so the
header now states the honest counted-seam scope and Phase 25's pre-flip validation
gains the PERF_GATE_WALLCLOCK=1 arm (run in this QA: 10/10 pass, wall-clock arms
included, added-p99 and tick p95 well under budget).
Nits applied (apply-all): the conscious-exceptions block trued up (the two /api/perf
ALLOW_DEV_COMMANDS request-time gates with the dual-arm-parity rationale, the
daily-rewards module-load TTL knob, db.ts MARKET_BACKFILL_DRY_RUN, an ambient-NODE_ENV
scope note, and an honest Config.allowDevCommands role comment: it has NO live consumer
yet, a P25 wire-or-drop decision item); loadConfig purity pinned in BOTH directions
(ambient keys absent from the arg cannot fall through); isBareOrigin per-dimension
negatives (credentials / query / hash, plus a credentialed REALMS entry); an
activeConfig() memoization pin through the /metrics gate (env mutation without reset
must NOT re-read); literal-spelling bans (16_384, 1_048_576, and a generic
daily-rewards decode-default digit ban); the bearerCredential repeated-header doc fix.
Dead-code audit CLEAN: no orphaned module consts, no re-typed literals, no commented-out
code, every new export has a real importer, zero genuinely missed env reads. Reviewers:
privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (2 nits, applied; notes the
legacy-in-prod ALERT fires on every prod boot until the P25 flip, by design);
qa-checklist READY 0/0 (its three VERIFY items closed: full gate re-run PASS, wall-clock
arm 10/10, deploy-env audit extended by finding 1). Validation after fixes: tsc 0, the
six phase files 102 passed + 2 env-gated skips, ci:changed exit 0, build:server exit 0,
npm run gate PASS all 9 steps (760 files / 8667 passed + 13 skipped). NEXT: Phase 25
(phase-25-docs-flag-flip.md), the LAST phase.

## v0.20.0 release merge, second slice (2026-07-03): housekeeping family + deferred GameServer construction

Merged release/v0.20.0 (tip 3e1bc17c4, 27 commits since c916d296a: the admin housekeeping
section PR #1340, spawn-intro cinematic PR #1330, unit-frame customization PR #1369,
professions vendor tools PR #1178, i18n regens) with the reconciliation folded into the
merge commit. Four textual conflicts: the admin.ts + main.ts import blocks (additive both
sides, kept both) and two generated i18n artifacts (i18n.resolved.sha256 +
i18n.status.summary.json, REGENERATED via i18n:gen + i18n:admin + i18n_resolved_hash --write,
never hand-merged).

What the merge brought onto the pipeline, migrated INSIDE the merge commit (no owning
phase; provenance = this merge):
- The housekeeping family, 10 routes (GET overview/rates/mobs/quests/items/npcs/spawns/world
  + POST overrides + POST overrides/clear under /admin/api/housekeeping/), served legacy-side
  by a POST-auth prefix delegation in handleAdminApi to the handleHousekeepingApi
  sub-dispatcher (which slices the prefix and compares SUFFIXES). Migrated as 10 RouteDefs
  (requireAdmin + ADMIN_META) sharing ONE parity-by-construction handler that calls the
  sub-dispatcher whole (the 18b daily-rewards template), so bodies, the in-family POST 404,
  and the non-GET/POST 405 are byte-identical on both arms and no known_deviations entry is
  needed. AdminRuntime Pick extended with housekeepingSummary; handleHousekeepingApi's game
  param narrowed (type-only) to Pick<GameServer,'housekeepingSummary'> so both arms call the
  one function. Admin surface is now 43 RouteDefs; the legacy admin ladder itself gained NO
  new === branches (the delegation is a startsWith arm).
- THE STRUCTURAL HAZARD OF THIS MERGE: the release moved `new GameServer()` off module load
  into the boot path (overrides must apply BEFORE the Sim ctor reads the content tables),
  but this branch wires configureAdminRuntime(game)/configureInternalRuntime(game) at module
  scope BY VALUE, and the parity/characterization harnesses import main.ts and drive
  routeHttpRequest WITHOUT running startServer() (they inherited module-load construction
  implicitly). Resolution: liveGame(), a memoized lazy accessor (the activeConfig()
  pattern); production takes the first touch in startServer() right after
  applyGameConfigAtBoot (the two by-value runtime injections moved there with it); every
  module-scope closure defers its liveGame() read to request time; the harnesses construct
  lazily on first request against override-free content, exactly the world their goldens
  pinned. Without this, all game-touching parity captures crash on undefined.
- Harness deltas: SURFACE_INVENTORY 124 -> 134 (10 admin rows, handler prose
  'handleHousekeepingApi arm: ...'); the freshness gate learned a third source-side class,
  REGISTERED RouteDefs (a suffix-comparing sub-dispatcher is invisible to the === text scan;
  union excludes rows flagged unreachable, i.e. the swag claim), which also future-proofs
  the gate for the P25 ladder deletion; parity +4 db-free 401 pins (catalog read, override
  save, unknown sub-path, wrong method; authed bodies stay DB-excluded per the Phase 17
  policy); the admin auth-mounting sweep covers all 10 automatically (registry-derived).
- Also in the release, no pipeline interaction: src/sim/game_config.ts (TUNING + override
  validation, sim-pure, architecture guard green), game_config_overrides JSONB DDL
  (additive, idempotent), game.ts Sim ctor reading TUNING.worldSeed/respawnSeconds,
  initialCharacterState retargeting to TUNING.worldSeed ?? 20061, and the client-side
  spawn-cinematic / unit-frame / professions-tools work.

P25 handoff addition: unknown housekeeping sub-paths and non-GET/POST methods have no
RouteDef, so today they delegate to the legacy ladder (admin auth 401 precedes the
in-family 404/405); at the ladder deletion they flip to the table's PRE-AUTH
404/405 (the systemic planned405BeforeAuth class). Carve out at P25 alongside the 18b
remainder.

## v0.20.0 release merge, third slice (2026-07-03): map editor surface + Ravenpost mail

Merged release/v0.20.0 (tip 2e9e59384, 108 commits since 3e1bc17c4: map editor PR #1306,
IP-pivot renames PR #1341, craft skill PR #1180, global party invite PR #981, combo points
PR #1367, housekeeping calendar caps PR #1371, Ravenpost mail + event calendar PR #1339)
with the reconciliation folded into the merge commit. Twelve textual conflicts: three
server files (db.ts import + ensureSchema DDL order, main.ts import blocks x3,
ratelimit.ts new-bucket insertion), the i18n catalog index (apiError vs editor domain,
kept both), five locale overlays (maintainer fill blocks, disjoint keys, kept both), and
three generated i18n artifacts (REGENERATED via i18n:gen + i18n_resolved_hash --write;
second-run idempotency proven).

THE HAZARD THAT FIRED (the v0.20.0-slice-1 subtype, release code calling
branch-refactored helpers): the release's new limiter buckets (mapMutationRateLimited /
assetUploadRateLimited) were boolean-era (`ipLimited || accountLimited`) and its NINE
main.ts call sites tested the outcome by truthiness; under this branch's Phase 19
RateLimitOutcome contract every request would have answered 429. Adapted to
mergeFusedOutcomes + `.allowed` during conflict resolution. Also: two bare `game.`
references in the merged rename arm re-pointed at liveGame(); the release's PUT addition
to maybeCors mirrored into the UNMOUNTED withCors twin (API_ALLOW_METHODS, the v0.19.0
CORS-drift lesson) and its pins.

MIGRATED-ROUTE DIVERGENCE FIXED: the release added a Ravenpost mail rekey
(rekeyMailOwner + saveMail) to the LEGACY character-rename arm only; /api/characters/:id/
rename is Phase 12 MIGRATED, so CharactersRuntime gained both members, the migrated
renameHandler mirrors the arm, the injection site binds liveGame(), and two decisive
tests pin the mirror (rekey -> saveMail; no rekey -> no save).

What the merge brought onto the pipeline, migrated INSIDE the merge commit (no owning
phase; provenance = this merge):
- The custom-map family, 9 routes (GET/POST /api/maps, GET /api/maps/public,
  GET/PUT/DELETE /api/maps/:id, POST fork, POST publish + unpublish as two literal-suffix
  RouteDefs) in NEW server/maps_routes.ts, and the uploaded-GLB family, 4 routes
  (POST /api/assets binary upload, GET /api/assets/mine, GET /api/assets/:file =
  <sha256>.glb byte read with a binary response, DELETE /api/assets/:id) in NEW
  server/user_assets_routes.ts. Template: the wallet *Core split. Each legacy lane's BODY
  moved into an exported post-auth core the lane now calls; the RouteDefs mount the
  equivalent guards (Content-Length 413 precheck BEFORE auth, createActiveGuard /
  createReadGuard over a lazy seam-backed guard-db bundle, rateLimit(MAP_MUTATION_POLICY /
  ASSET_UPLOAD_POLICY / PUBLIC_READ_POLICY) sharing the legacy tier-1 buckets,
  requireOwned loaders on the owner-only :id routes) and call the SAME cores, so bodies
  cannot drift. createReadGuard is NEW in bearer_active_guard.ts (the active factory's
  read-scope sibling; first registered read-scope routes outside the per-domain copies).
  GET /api/maps/:id keeps the legacy optional-auth + anonymous-only prose throttle in a
  bespoke optionalViewerGuard (meta.publicRead); fork is public-or-owner (service-
  enforced, meta.publicRead). The maps service singletons moved OUT of main.ts into the
  route modules (module-scope construction is pure; setMapsServiceForTests /
  setUserAssetsServiceForTests seams added).
- Admin: 5 new RouteDefs in admin.ts (GET /admin/api/maps + /admin/api/user-assets lists,
  POST /admin/api/maps/:id/unpublish, POST /admin/api/user-assets/:id/block + /unblock as
  two literal suffixes over the legacy (block|unblock) regex arm, all requireAdmin +
  requireAdminTarget/adminTargetMeta on :id) plus the housekeeping CALENDAR RouteDef (the
  release added a 'calendar' suffix to handleHousekeepingApi, a freshness-gate blind spot
  until registered; 11th member of the shared parity-by-construction handler family).
  Admin surface is now 49 RouteDefs.
- Known deviations: mapsAssetsRateLimitedBodyToCode (coded 429 vs the legacy prose
  rate_limited, the wallet-class body-shape change; buckets shared so limits land
  identically) and mapsAssetsIdParamDecode (requireOwned num() 422/401 vs the legacy \d+
  404 fall-through, plus the loader-before-body ordering; the publicRead :id routes
  validate IN-HANDLER and answer the ladder terminal 404 byte-identically, parity-clean).
- Harness deltas: HTTP_METHODS gained PUT (first PUT route in the tree); SURFACE_INVENTORY
  +13 /api rows (2 BINARY: the upload and the byte read; BINARY's "only member" docstring
  updated) + 6 admin rows; API_CONTENT_TYPE +10 keys; MIGRATED_ROUTES +13; the /api
  auth-mounting sweep 9 -> 19 routes; the ownership deny-by-default sweep gained the maps +
  assets fakes (five new registry-derived deny cases run automatically); tunables POLICIES
  pins +2 (map_mutation 30/min, asset_upload 10/min); parity gained 6 focused
  captureBothModes re-pins (the two pre-auth 413 + Connection: close lanes, two db-free
  401s, two ladder-terminal-404 shape parities) since the family is path-masked by its
  deviation entries; NEW tests/server/maps_routes.test.ts (23) +
  user_assets_routes.test.ts (15).
- Also in the release, no pipeline interaction: the Ravenpost mail system (WS commands +
  mail/mailU delta keys + per-realm JSONB blob; saveCharacterAndMarketState gained the
  mail escrow param, mirrored into fake_db + the branch-side gate/rollback tests), the
  event calendar, craft skills, combo points, the /invite social command, the IP-pivot
  content renames + regenerated parity goldens, editor.html as the FIFTH Vite entry, maps
  + user_assets DDL (additive, idempotent, after SCHEMA under the advisory lock).

P25 handoff addition: the maps/assets wrong-method shapes flip from the ladder terminal
404 to the table's pre-auth 405 at the ladder deletion (the systemic planned405BeforeAuth
class; same carve-out as housekeeping/18b). The GET /api/maps/:id optional-auth throttle
stays tier-1-only prose BY DESIGN on both arms (conditional anonymous-only, not
expressible as a rateLimit mount) and survives P25 unchanged inside optionalViewerGuard.

Release-merge audit (the release-merge-audit skill, 7-slice workflow + critic,
2026-07-03): ZERO blocking. The gate run on the merged tree caught ONE red release-side
test (tests/glb_assets.test.ts pinned the boolean-era assetUploadRateLimited; adapted to
.allowed in b65f33963), a NEW instance class for future audits: release-side TEST files
pinning branch-refactored helper contracts (sweep tests/ + scripts/, not just server/).
Apply-all fixes from the audit: dead main.ts imports removed (parsePageParams,
readBinaryBody); the rate_limit.ts header no longer claims PUBLIC_READ_POLICY is
unmounted; GET /api/assets/:file dropped meta.envelope 'binary' so its thrown errors
serialize problem+json (the /api/card precedent; drained-bucket 429 unit-pinned);
mapsAssetsIdParamDecode extended with fork + :file and the three guard-before-shape-check
legs (unauth non-numeric fork 401-vs-404 pinned; bucket consumption before the terminal
404 documented); mapsAssetsRateLimitedBodyToCode corrected (tier-2 applies to the
mutation lanes too); adminIdParamDecode extended with the three map editor moderation
:id routes; admin.ts map editor moderation backends converted to lazy memoized accessors
with test setters (the lazy AdminDb doctrine); world_api.ts header counts trued up
(160 members, 28 delta keys, 9 dispatch-only) and snapshots.test.ts prose made
count-free; the P25 Agent C exit-criteria carve-out now enumerates the maps/assets
wrong-method class; main.ts line anchors re-based (~2350); root CLAUDE.md build entries
(five, editor) and server/CLAUDE.md housekeeping RouteDef count (11) corrected. Full
gate re-run PASS (all 9 steps) after the fixes.

## v0.20.0 release merge, fourth slice (2026-07-03): bags, ghost death loop, Drowned Litany, guild last-login

Merge bbd063447 (release tip fd66e1db0) landed the WoW-style bag system, the ghost/death
loop with Spirit Healers, The Drowned Litany delve, guild-roster last-login, unit-frame
auras, and gamepad brand glyphs. ZERO HTTP API surface: the server delta is only db.ts /
game.ts / social.ts / social_db.ts. The five new commands (equip_bag, unequip_bag,
resurrect_corpse, resurrect_healer, delve_rite_choose) are WS world-protocol dispatch
cases in server/game.ts, pinned by the release side in tests/command_schema.test.ts
(116/125 send/dispatch) and tests/world_api_parity.test.ts (167/42/125 with facet and
runtime membership checks on both worlds). The additive idempotent characters.last_login
column plus touchCharacterLogin (fire-and-forget on the WS join path) and the widened
SocialDb.guildMembers lastLogin shape are consumed only by the WS social hub; no HTTP
envelope, migrated handler, legacy arm, or injected runtime picks any of it up. The
migrated set STAYS 45; no corpus rows, RouteDefs, or deviations needed. Conflicts were
the three i18n generated artifacts only, resolved by regeneration. Full five-dimension
release-merge audit (overlap reads, legacy-arm divergence, endpoint inventory, injected
helpers, planning premises) returned zero blocking findings; the two nits applied were a
stale world_api_parity method-kind test TITLE (122 to 125; assertion was already correct)
and this ledger entry itself (the packet previously recorded the v0.20.0 merges as a
closed set of three). Targeted suites green at the merged tip (command_schema,
world_api_parity, game_sessions, snapshots, architecture, localization_fixes,
parity/coverage, social_system, social_frames, delves); tsc 0.

## v0.20.0 release merge, fifth slice (2026-07-04): the housekeeping revert + release tip

Merge of release tip d4e1340f3 (40 commits). The defining change is a REMOVAL: the release
reverted the whole housekeeping feature (revert of PR #1340 plus the calendar-caps
follow-up b9b3378f7; the feature never reached main), so the merge mirrors the delete end
to end on the branch: housekeeping.ts / housekeeping_api.ts / housekeeping_db.ts,
src/sim/game_config.ts, the game_config_overrides DDL, the admin SPA housekeeping pages,
the 11 housekeeping RouteDefs + housekeepingHandler + the AdminRuntime housekeepingSummary
member in server/admin.ts, the 11 surface-corpus rows, the 4 housekeeping parity 401 pins,
the http/CLAUDE.md testing-seam note, and state.md carve-out (d) (retired in place; the
release-merge migrated set drops 45 -> 34, the admin surface counts 38 RouteDefs). The
liveGame() deferred construction SURVIVES the revert (the import-main harnesses and the
module-scope configure*Runtime closures still need lazy first-touch);
tests/server/game_boot_order.test.ts keeps the laziness pin and drops the
applyGameConfigAtBoot source-order pin with the feature.

Remaining release deltas carried no HTTP route surface: the daily-rewards repeat-quest
halving is shared-module logic inside DailyRewardService (both dispatch arms), the Play
Integrity nonce normalization lives in native_attestation.ts (a shared helper imported by
BOTH twins: auth_routes.ts and the main.ts ladder), the admin live-evidence work is
SPA + admin-i18n only, and one-online-character-per-account / mail hardening /
block-invites / haste sets / cast-target locking are WS + sim surface with release-side
test pins. Code conflicts: main.ts (4 hunks: housekeeping imports/boot-apply, the
liveGame block vs release's module-scope construction, the ws import), admin.ts (import
block), server/CLAUDE.md, plus the housekeeping_api.ts modify/delete. i18n conflicts:
hud_chrome hide-chest keys (take release) and the 5 non-Latin overlays where the release's
de-IP reword (afbb90520) of realm.noRealms/realm.loading wins over the branch's stale
transliterations while keeping the branch's errors.api.* fills; generated artifacts
regenerated, never hand-merged.

## Phase 25: Docs + new:endpoint scaffold + flag-default flip

Deliverables:
- [x] Update server/CLAUDE.md (pipeline model + graduated Adding-an-endpoint recipe + error-localization rule + the injected-FakeDb test recipe over the pg-mock idiom), root CLAUDE.md (the server/http seam), new server/http/CLAUDE.md, i18n docs (apiError.* domain)
- [x] npm run new:endpoint scaffold emitting RouteDef stub + typed schema + paired error code + English catalog entry + a paired FakeDb-based copy-from TEST file, auto-attaching requireOwned* on :id routes
- [x] Flip the env-flag default to the new path keeping the old ladders behind the flag; designate one early migration commit as the canonical add-one-authenticated-endpoint example
- [x] Name the old-ladder deletion exit criteria (metric gate + owner) for the next-release follow-up PR

QA:
- [x] Fixes applied (all findings from all three in-phase reviewers, including nits)
- [x] Tests added (dispatch_default.test.ts + the new_endpoint golden suite)
- [x] Dead code removed (nothing to remove: the phase adds new surface only; main.ts got comment edits plus the one-line reset-body change)
- [x] Reviews clean (privacy-security-review, qa-checklist, test-coverage-auditor: zero BLOCKING each; every should-fix and nit applied and re-verified)

Notes:

DONE 2026-07-03 (one session: one Explore context agent, three hand-spawned slice agents
(docs, scaffold, flip), three in-phase reviewers apply-all). The MIGRATION PACKET IS
COMPLETE: this was the final phase; the separate phase-25-qa.md gate remains, then the
old-ladder deletion follows next release under the recorded exit criteria.

THE FLIP. DEFAULT_DISPATCH (server/http/config.ts) went DISPATCH_LEGACY to DISPATCH_NEW;
that one const seeds both loadConfig's unset/empty default and the four module-init entry
seeds in server/main.ts, and setApiDispatchMode recomputes all four entries (apiEntry,
adminApiEntry, oauthApiEntry, internalApiEntry), so the new pipeline is now the production
default on every surface with API_DISPATCH=legacy as the one-flag rollback. The per-path
catch-all delegate semantics are UNCHANGED (only the default moved); zero parity fixtures
diffed (the phase stopping rule held). logApiDispatchSelection's legacy+production warn now
fires exactly when an operator has rolled back (DEPLOY.md operational note added).
resetApiDispatchModeForTests restores DEFAULT_DISPATCH instead of a hardcoded 'legacy'
(every caller sets its mode explicitly; reset is cleanup only). Three legacy golden-master
suites now pin 'legacy' explicitly instead of riding the ambient default
(characterization.test.ts, characterization_admin_oauth_internal.test.ts,
route_dispatch.test.ts); config.test.ts default pins flipped to the literal 'new'.

tests/server/http/dispatch_default.test.ts asserts BOTH directions on ALL FOUR entries
db-free. Premise correction discovered here: a wrong-method probe does NOT discriminate
new-vs-legacy today (the dispatcher delegates every non-matched resolve including
methodNotAllowed; the table 405s are the planned405BeforeAuth class that fires at the
deletion). So /api uses the two VISIBLE Phase 10 deviations as discriminators
(realmsSearchAuthzGapClose search 200-vs-401, statusNameListTrim), and admin/oauth/internal
use legacy-delegate spies (handleAdminApi / handleOAuth / the internal composite with
handleDailyRewardInternalApi tried first; handleApi is in-module and not mockable), with
unmatched-path cases proving each spy CAN fire (non-vacuous).

THE SCAFFOLD. scripts/new_endpoint.mjs behind `npm run new:endpoint --
--domain <slug> --method <METHOD> --path </api/...> [--public] [--root <dir>] [--repo <dir>]`.
Rung derivation: :param and no --public = owner-gated (real requireOwned auto-attached,
meta.requireOwned, 404 anti-enum denial); --public = public read (meta.publicRead on a
:param); else authenticated. After the security review the emitted guards compose the REAL
shared server/http/middleware/bearer_active_guard.ts (createReadGuard on GET,
createActiveGuard on mutating: moderation-gated AND read-vs-full scope-enforced out of the
box) over an injected db seam that defaults to the real db.ts reads (pg Pool constructs
lazily; verified with DATABASE_URL unset). Emitted files: the domain routes module (typed
Infer-derived schema via server/http/schema.ts combinators, withBody on mutations, an
in-array rate-limit TODO naming the recipe step) plus a FakeDb-idiom test asserting
happy/401/403-moderation/403-read-scope/404/invalid paths; SIX append-only targets
(error_codes.ts, its EXPECTED_CODES snapshot test, api_error_code_parity.test.ts
KNOWN_CODES, api_error_i18n.ts API_ERROR_KEYS, the api_error.ts English catalog,
registry.ts via two anchor comments), leaving a real-tree run parity-green. --domain and
--path are strict-charset validated before templating (template-injection hardening);
--public plus a mutating method prints an unauthenticated-unlimited-write warning; the CLI
reminds about M16 (the wordy-English heuristic is /[a-z]{4,}/, so ANY real English value
trips it: emitted defaults are terse to minimize the five non-Latin fills, which remain
required in the same change when the contributor rewords). Biome formatting of emitted
files is the contributor's normal biome check --write step (CLI says so). The golden test
(tests/server/new_endpoint.test.ts, 22 tests, ~2s) emits ALL THREE rungs into one mkdtemp
root, type-checks all six emitted files with one child tsc (repo-extending tsconfig), runs
the three emitted tests plus the error_codes snapshot in one child vitest (explicit config
override), byte-level asserts append-only on all six targets (in-order subsequence +
reconstruction, catches reorder), pins hostile-path/refuse-overwrite/missing-target
negatives per dimension, and asserts git porcelain unchanged (the scaffold writes only
under --root, so this diff never touches src/ and the S3 guard is not triggered). tmp/**
joined vite.config.ts test.exclude so a crashed golden run cannot leave collectable orphan
tests.

DOCS. server/http/CLAUDE.md is NEW (spine module map, the RouteDef/RouteMeta contract,
per-surface envelope rule, append-only error_codes + apiError.* localization mapping, the
dispatch-flag model, the dual-edit maintenance rule, the housekeeping vi.mock seam note,
and the exit-criteria pointer). server/CLAUDE.md gained the pipeline model, the graduated
Adding-an-endpoint recipe (scaffold first, then the three rungs by real commits:
c07d677af public read server/leaderboard.ts; 14275d39e authenticated server/auth_routes.ts,
designated THE canonical add-one-authenticated-endpoint example; 5bba9353e owner-gated
server/characters.ts), the emit-the-CODE-never-English rule, and the FakeDb-over-pg-mock
test recipe; its Key-files row no longer claims main.ts owns a route table. Root CLAUDE.md:
one repo-map row plus the request-seam architecture/modularity notes (AGENTS.md and
GEMINI.md untouched, still thin pointers). translation-workflow.md gained the REST
localize-by-code section.

EXIT CRITERIA (state.md `## Old-ladder deletion exit criteria (next release)`, owner
Fernando). Discovered while writing it: the delegate path is UNMETERED today (withMetrics
mounts only on the matched-route onion), so the deletion PR must FIRST add a bounded
old-path counter (a sentinel route label or http_delegated_requests_total{surface,method,
status}, O(1) cardinality), then gate on 14 consecutive zero days in production EXCLUDING
the enumerated carve-outs, plus zero unexplained 404-rate delta vs the pre-flip baseline.
Carve-outs enumerated: HEAD-to-GET delegation, the oauthInternalOffTable405 set (decision:
the two GET oauth HTML pages migrate onto meta.envelope 'html' RouteDefs IN the deletion
PR; restart-countdown wrong-method joins planned405BeforeAuth), the 18b daily-rewards
prefix-arm oddities and ops pre-path 401, the housekeeping in-family 404/405 flips, and the
maps/assets wrong-method flips. Also scheduled there: the Phase 18/18b dual-edit rule
expiry, and the Config.allowDevCommands resolution (KEEP AND SCHEDULE: the deletion PR
wires the surviving /api/perf arm; game.ts per-command env reads stay by design). Deferred
items carried forward: conventions A/D/F/G, full-CSP Report-Only, the concurrency
workstream, the X-Request-Id echo live mount, the timed drain window, the daily-rewards
pagination clamp, HEAD-as-GET at deletion.

REVIEWS (apply-all). privacy-security-review: 0 BLOCKING, 2 should-fix + 2 nits, all
applied and re-verified CLOSED (the real-guard composition, --path charset, limiter TODO +
public-write warning, three-rung e2e); it confirmed the flip is a net hardening,
byte-identical onion, cleanly reversible, and flagged the operator-visible note that
GET /api/search serves anonymous callers 200 by default post-flip (the pre-existing,
rate-limited Phase 10 realmsSearchAuthzGapClose deviation) while /api/status gets stricter.
qa-checklist: READY, 0 BLOCKING (its two should-fix: this ledger entry, and the golden
rung-coverage gap, both applied). test-coverage-auditor: CLEAN, 0 BLOCKING 0 should-fix,
20/20 behaviors decisively pinned; its actionable nit (a unit pin proving the parity-file
append lands exactly one row against the real source) applied; its no-change nit (e2e
content pins beyond error_codes.ts are covered by the per-helper unit layer) recorded.

VALIDATION at the final tree: tsc 0; dispatch_default + config 32/32; the golden 22/22;
tests/server/http parity + completeness + known_deviations 41 files / 912 tests green with
ZERO fixture edits; PERF_GATE_WALLCLOCK=1 perf_gate 10/10 (the P24-mandated pre-flip
wall-clock arm); ci:changed 0; npm run gate PASS all 9 steps (re-run after the review
fixes). Ship reminder inherited from P24 for the maintainer before this branch deploys:
the deploy-env audit (stricter validators throw at boot; METRICS_TOKEN on server and
scraper together; no empty numeric placeholders), now plus the flipped default itself
(set API_DISPATCH=legacy only as a deliberate rollback).

QA GATE (phase-25-qa.md, 2026-07-04): PASS, apply-all. One Explore context load, then four
parallel reviewers over the committed range 9a254ee2b..4e6e60f8d (correctness,
test-coverage-auditor, dead-code/cleanup, privacy-security-review). Zero BLOCKING. All 10
acceptance criteria PASS against the real diff (the canonical example hash 14275d39e
verified to exist and match server/auth_routes.ts, with c07d677af and 5bba9353e also
verified; AGENTS.md and GEMINI.md confirmed untouched thin pointers; the exit-criteria link
matches the state.md heading character for character) and all 3 stopping-rule checks held
(zero src/ or WS files in the range; the fresh route-family sweep over all of server/ found
every dispatched family either registry-owned across the 15 domain modules or a recorded
state.md carve-out; knownDeviations consistent with the flip, oauthInternalOffTable405
fires at the deletion as documented). TWO SHOULD-FIX fixed (f954346e5): retained-ladder
comments across 14 server files still claimed Phase 25 removes the ladder, including the
main.ts boot-site comment that still said the default is 'legacy', the dispatch.ts
through-Phase-24 retention note, and the bearer_active_guard give-way trigger (which is the
DELETION, not the flip); all reworded to the next-release ladder-deletion PR. Nits applied
per apply-all: the packet's dangling scratchpad/canonical.md pointers repointed to state.md
Locked design decisions (fd472bd96; canonical.md never existed); golden-test hardening
(b04df2f89): the anchor-not-found UsageError paths pinned directly and the golden child
vitest now asserts a real passed-count summary, not exit code alone; state.md's live
cheat-sheet line saying unset API_DISPATCH stays 'legacy' corrected. Adjudicated NO-CHANGE
with rationale: strict composite ORDER inside dispatch_default (already pinned in
route_dispatch.test.ts, redundant there); the scaffold's SURFACE_BY_PREFIX mirror (a
zero-dep .mjs cannot import the TS spine; commented as a mirror) and its deliberately wide
export surface (the golden-test seam); security's two INFO notes (the opt-in --public write
rung already prints the loud warning plus TODOs; dummy localhost test DSNs follow repo
convention). DEFERRED to the deletion PR: the stale until-Phase-25 prose inside
tests/server/http/known_deviations.ts and sibling test comments (frozen ledger prose; those
entries fire at the deletion anyway). Validation GREEN at the final tree: tsc 0; golden
23/23 (+1 hardening case); dispatch_default + config 32/32; tests/server/http 41 files /
912 tests with ZERO fixture edits; PERF_GATE_WALLCLOCK=1 perf_gate 10/10; ci:changed 0;
npm run gate PASS all 9 steps (re-run over the fix commits).

NEXT: the next-release old-ladder deletion PR under the exit criteria above (owner
Fernando; the deletion PR adds the bounded delegate counter FIRST). The whole-feature
integration matrix (qa-checklist.md) remains available to run once at packet completion if
the maintainer wants the final cross-phase pass before ship.

## v0.21.0 release merge, first slice (2026-07-04): corpse harvest + component tags

Merge dc392dca1 brings release/v0.21.0 (tip 9ab4c0c92, PR #1181: single-use first-come
corpse harvest #1141, on the monster component tags from #1140) into the branch. Two
conflicts, both known classes: tests/world_api_parity.test.ts (method-count test title,
resolved to the release's correct 126) and src/ui/i18n.status.summary.json (generated;
taken from the release side then regenerated via npm run i18n:gen). Post-merge audit (the
release-merge-audit skill, 6-lens / 11-agent workflow run, every consequential finding
adversarially verified): merge RESOLUTION clean in both directions (exact union of the
parents; branch-era game.ts/online.ts work intact, harvestCorpse landed like its siblings),
ZERO HTTP API surface (no server/http, main.ts, or route-table files in the 24-file delta;
the WS command is pinned by command_schema 117/126 per the slice-4 precedent; surface
corpus is HTTP-only by design so no rows), IWorld extended and implemented in BOTH worlds
(world_api_parity 168 members), docs premises intact (migrated set stays 34; deletion exit
criteria untouched).

Audit findings fixed branch-side in the same slice: (1) harvestCorpse lacked the
dead-player rejection every sibling interaction command enforces; added with the standard
"You can't do that while dead." error plus a claim-not-consumed test. (2) harvestCorpse
violated addItem's command-boundary contract by skipping the canAddItem capacity
pre-check; added BEFORE the claim write (a full-bags refusal leaves the corpse unclaimed)
with the standard "Your bags are full." error plus a test. (3) M16: the two new wordy sim
error strings were pasted as byte-identical English into all 19 non-en sim locale blocks
(13 in sim_i18n.ts + 7 in sim_i18n.newlocales.ts) and the scanner records any present dict
entry as translated-by-human, so no gate at any tier would ever flag them; replaced with
real fills in all 19 locales. (4) The S3 drift guard's simSrc list did not scan
src/sim/interaction.ts, where the new emits' ONLY literal occurrences live; appended it
plus src/sim/professions/gathering.ts (H1 entries). (5) HARVEST_COMPONENT_ITEMS was game
data inside src/sim/professions/ against that directory's no-game-data contract; moved to
src/sim/content/professions.ts (gathering.ts re-exports for existing importers). (6) Stale
prose trued up: world_api.ts FACET MAP header counts made count-free (they had re-staled
twice across release merges; the pinned gates own the literals), the types.ts
componentTags "unconsumed" comment updated, and harvestClaimedBy documented as
SERVER-PRIVATE (no snapshot delta mirrors it; the online ClientWorld always reads null,
noted for whichever slice first adds a UI consumer).

OPEN UPSTREAM (content design, deliberately not fixed here): the harvest yield map's
hide/silk/venomSac tags map to kind:'quest' items (q_boars/q_spiders/q_widows), so a
harvest grants quest-collect credit from ANY tagged mob (a wolf hide advances the boar
quest) and bypasses the quest-state gates the loot/pickup paths enforce. The complete fix
is dedicated profession-material items, which is content design owned by the professions
epic; flagged in a KNOWN CONTENT GAP comment at the relocated table and reported to the
maintainer. Also pre-existing, reported not fixed: 35 byte-identical wordy-English rows
for 7 Drowned Litany keys across the five non-Latin sim locale blocks (same
registry-blindness pattern; candidate for a dedicated fill session together with pointing
the scanner at the sparse sim dicts and extending the release-tier copied-English guard
H3b to simDICT), and the empty-yield harvest success path (unmapped tags consume the
claim with zero player feedback; upstream design call between an emit and not consuming
the claim).

## Phase 26: closeout comment cleanup (de-phase + de-stale + oauth copy) DONE (2026-07-04)

The shipped pipeline code no longer carries development-process "Phase N of
docs/api-pipeline/" framing: 123 files reworded (641 grep hits plus a case-insensitive
sweep's lowercase/hyphenated stragglers), every phase number replaced by the mechanism it
stood for per the phase-26 Master Key. Executed as a 9-bucket parallel fan-out plus a
hand-edited Part B; one usage-limit interruption mid-fan-out was resumed from the workflow
cache with the partial drafts verified and adopted. Landed as six commits: ef0405a18
(spine + middleware + server/http/CLAUDE.md), 4d7a7929d (domain files), 76e26254c (tests
+ labels + the known_deviations prose), 185bcd0d6 (the Part B stale-comment corrections:
dispatch.ts "registry EMPTY today", types.ts "later phase" loader/reqId docs, registry.ts
timeline changelog rewritten as a count-free surface description, index.ts consolidation
narrative, server_timeouts.ts "nothing sets these"), 34cbb4560 (the oauth em-dash sweep:
seven comments plus the player-facing device string, now "Device approved. You can return
to your device.", which also unblocks the deferred GET /oauth/device characterization
golden), and 669d07fad (the apiError catalog/matcher comments).

Deliberate keeps, so a literal re-run of the phase-26 acceptance grep is NOT a miss:
the known_deviations.ts `introducedInPhase` field, its values, and DEVIATION_PHASE_MIN/MAX
stay byte-identical (runtime data pinned by known_deviations.test.ts; renaming it out of
phase vocabulary is a separate test-touching task), and five live doc pointers survive in
code on purpose (server/http/CLAUDE.md to the state.md deletion exit criteria;
market_backfill.ts to phase-20-rollback-runbook.md; wallet.ts, leaderboard.ts, and
discord.ts to progress.md follow-up/deferral records). The five src/ui/i18n.locales
overlays keep their one "(..., Phase 22)" comment each (overlay files are not hand-edited;
maintainer call if they should go through the i18n regen pipeline). Test DATABASE_URL
placeholder values (wocc_phaseNN_*) and the 18b code identifiers in tests are program-read
values, out of a comment sweep's scope.

Validation: tsc 0; the four guard suites 251/251; tests/server + api_error_code_parity +
schema_wiring 1677 passed with ZERO fixture edits; localization_fixes + i18n_completeness
green; npm run gate PASS all 9 steps; ci:changed 0. Reviews apply-all: two fresh coverage
reviewers (server diff, tests+ui diff) CLEAN with one nit (a "top-level" misdescription of
the Content-Type gate in wallet.ts, fixed pre-commit); qa-checklist READY, 0 blocking,
0 should-fix. NEXT: phase-27-flip-precondition.md.

## Phase 27: closeout, bound the log-only mismatch sinks (the flip precondition) DONE (2026-07-04)

Resolution: OPTION A (implement the promised bound). The Phase 21 QA pre-flip watch-item
("do not set API_DISPATCH=new in ANY environment before the two log-only mismatch sinks
are sampled or bounded") is now SATISFIED, retroactively to the Phase 25 default flip.
Phase 23 had routed both sinks through the structured logger with template-bounded
cardinality (which made the flip defensible) but landed no sampling or throttle; this
phase lands the bound itself.

NEW `server/http/mismatch_warn_throttle.ts`: a pure, host-agnostic, per-process
fixed-window throttle. `createMismatchWarnThrottle({maxPerWindow?, windowMs?, now?})`
returns `{admit(key) -> {emit, suppressed}}`; named constants
MISMATCH_WARN_MAX_PER_WINDOW (5) and MISMATCH_WARN_WINDOW_MS (60000), no bare literals.
State is keyed on the mismatch's `${method} ${route-template}` (RouteDef.path), NEVER the
concrete URL, so cardinality stays O(registered routes) under an attacker-chosen-path
flood. The flood signal is never dropped silently: the first admitted line of each NEW
window carries the prior window's suppressed count (the "message repeated N times" idiom).
The clock is injected (the same now() seam as metric_sink.ts); only the default binding
uses Date.now, so every test advances a fake clock deterministically. Server-only; the
sim is untouched.

Wiring: both default sinks and ONLY those two. content_type.ts and origin_check.ts each
gained a `create*MismatchSink(throttle?)` factory (injectable for tests); the exported
`default*MismatchSink` consts are now factory-built instances, each owning its own
process-wide throttle (the two gates never share window state). A suppressed admission
returns before logger.warn; an admitted line with a non-zero prior-window tally adds a
`suppressed` field to the structured record. The throttle gates ONLY the warn line: both
middleware take their enforce decision (415/403) independently of the sink, so a future
API_CONTENT_TYPE_ENFORCE / API_ORIGIN_CHECK_ENFORCE flip rejects every flooded request
while its warn lines ride the same bound (pinned by test). NEITHER enforce flag was
flipped (that stays gated on the native-traffic audit, out of scope here). Enforce-flip
audit note (recorded in state.md): a suppressed origin-gate line can hide a DISTINCT
origin value; a recurring legitimate origin re-surfaces on any key not saturated by a
flood, but under a sustained flood of ONE (method, template) key a low-rate origin on
that same key can stay suppressed every window, so the audit must not treat the warn
sample as exhaustive for flooded keys.

Tests: NEW tests/server/http/mismatch_warn_throttle.test.ts (10 tests: the per-key cap,
the exactly-once suppressed tally on the next window's first line, the zero-tally case,
the two-roll tally reset (the second surfaced tally counts only the second window, never
a carry-forward), the exact window boundary [59999 in / 60000 rolls], per-template
independence, per-key tallies across the roll, instance independence, and the 5 / 60000
defaults pinned as literals via injected-clock behavior plus constant literal pins).
content_type.test.ts + origin_check.test.ts each gained a 4-test flood-bound block: 20
same-window mismatches on one template collapse to 5 warn lines with the 15-line tally
riding ONLY the next window's first line (the following line omits the field); two
templates bounded independently (5 + 5); the enforce path unaffected (8 flooded
enforce-mode requests all reject 415/403 while warn fires exactly 5 times); and the
AS-SHIPPED pin: the exported default* sink consts themselves collapse a 20-mismatch
flood to 5 lines on the real process-wide throttle (a silent revert of the default
wiring fails green no more), with the origin-side case also proving the two module
defaults never share one throttle instance. The pre-existing default-sink tests (one
line per single mismatch) pass unchanged, as does dispatch.test.ts's real-mount
exactly-one-sink-line pin (single admits sit far under the bound).

Durable record (the part that stops the item floating): state.md OPEN items now leads
with the RESOLVED entry; the Phase 21 security-headers section's watch-item paragraph
carries an inline resolution pointer; the closeout-phases list marks Phase 27 RESOLVED;
the new-files table gained the Phase 27 row; and config.ts carries a mechanism-framed
clearance note beside DEFAULT_DISPATCH so a reader of the flip sees the precondition was
addressed, not skipped.

Validation: tsc 0; tests/server/http 42 files / 915 pass (incl. the 18 new tests); biome
ci clean on all touched code/test files; npm run gate PASS all 9 steps (re-run on the
final state). Reviewers (the phase doc's three), apply-all honored: privacy-security-
review APPROVE, 0 blocking / 1 should-fix (the "audit sees every live origin family"
claim over-stated for a key under sustained flood; softened in origin_check.ts, state.md,
and this record) / 2 nice (the deliberate no-eviction decision now documented on the
throttle factory; the idle-window tally-attribution nuance now documented on
MismatchWarnAdmission.suppressed), all applied. test-coverage-auditor: 2 should-fix (the
shipping default sinks had no flood test, so a silent revert of the default wiring passed
green; the two-roll tally reset was unpinned), 2 nice (cross-gate default independence;
the tally-omission assertion was vacuous on the first window), all four applied as the
AS-SHIPPED pins, the two-roll test, and the second-line omission assertion.
qa-checklist: READY, 0 blocking / 0 should-fix / 2 nice (an imprecise "throws before
consulting it" comment in content_type.ts, fixed to the origin_check phrasing; the
default-const coverage gap, closed by the AS-SHIPPED pins). Note: the packet contains no
phase-27-qa.md (the closeout phases run their reviewers in-phase, the Phase 26
precedent). NEXT: phase-28 (the four missing attack-signal metrics), the last open
closeout item besides the next-release deletion PR.

## Phase 28: closeout, ship the four attack-signal RED metrics (source-spec 4.9 complete) DONE (2026-07-05)

Resolution: OPTION A (SHIP), the maintainer's pick at the packet's STEP 2 fork. The
source-spec 4.9 "Request layer (RED), this PR" catalog is now COMPLETE: all six series
live on the ONE per-instance /metrics registry, and the brute-force / BOLA-enumeration /
flood-reaching-pg dashboards the effort set out to enable are buildable.

NEW server/http/attack_signals.ts: the AttackSignalSink contract (rateLimitHit /
authFailure / bolaDenied / pgLimiterWrite), the noopAttackSignalSink default, and the
setAttackSignalSink / attackSignalSink() process-wide slot (mirrors the
setRateLimitTier2Store idiom; read at emission time, never captured at import).
server/http/metrics.ts registers the four Counters on the SAME registry as the two
Phase 23 metrics, each name a pinned constant (RATE_LIMIT_HITS_TOTAL,
AUTH_FAILURES_TOTAL, BOLA_DENIED_TOTAL, PG_LIMITER_WRITES_TOTAL), exposes them as
HttpMetrics.attackSignals, and try/catch-guards every increment so an observability
write can never break the rejection path it observes. Ctx gained an additive optional
`route` field (the matched :param TEMPLATE, set by buildContext from the matched
RouteDef; fakeCtx override added): the ONLY route identity allowed in a metric or log
label, never ctx.path.

Emission sites: rate_limit.ts increments rate_limit_hits_total{policy, key_kind} before
BOTH 429 throws (tier-1 and tier-2), labels from the bounded policy table only.
ratelimit.ts is the auth choke point covering BOTH dispatch arms plus discord/account
re-auth with one site: recordAuthFailure emits kind='bad_credentials'; authThrottled
emits kind='throttled' on a lockout outcome, with the caller-rejects assumption spelled
out in its doc comment (all three callers gate-and-reject; a future non-rejecting caller
must split the predicate). require_owned.ts increments bola_denied_total{route} with
ctx.route ?? 'unknown' alongside the unchanged structured deny-log (404 body
byte-identical). ratelimit_db.ts counts one pg_limiter_writes_total{policy} per UPSERT
and the http_requests_total{route='ratelimit.pg.hit'} proxy row is GONE (the store's
MetricSink option removed; ONE source of truth; the access log no longer carries pg
pseudo-lines; the allowed-vs-tripped split now lives on rate_limit_hits_total).
main.ts boot: setAttackSignalSink(httpMetrics.attackSignals) plus
createPgRateLimitStore({ pool }). Reconciliations recorded in state.md OPEN items: the
spec's auth.* policy alert example maps to auth_failures_total + the 429 rows of
http_requests_total on the auth routes (the fused per-IP auth budget is legacy-parity
inline, outside the policy middleware); realm stays a Prometheus external label
(matching Phase 23); bola_denied_total counts the locked 404 anti-enumeration denials
(the spec table's "403s" wording predates that decision).

Tests (8 files): metrics.test.ts (six-series TYPE lines before traffic, name-constant
literal pins, per-counter label pins, instance isolation); context.test.ts (ctx.route =
template not concrete path, undefined on unmatched); rate_limit.test.ts (tier-1 and
tier-2 rejection labels, allowed-records-nothing, the tier-1 flood never touching the
tier-2 store, and the REAL-PgRateLimitStore-over-counting-fake-pool flood companion
that pins "pg_limiter_writes_total stays 0 under a tier-1 flood" end to end, making
qa-checklist.md:153 literally true); ratelimit.test.ts (bad_credentials per
recordAuthFailure, throttled once per lockout check, below-ceiling and clear negatives);
require_owned.test.ts (template-not-path both directions, 'unknown' fallback, owned-load
and 422-before-DB negatives); ratelimit_db.test.ts (policy parsing incl. the colonless
'default', writes-not-decisions, no ip/colon in the label); metrics_gate.test.ts (pg
sink rework, six-series exposure at the real /metrics surface, and the boot-wiring
integration pin: an emission through attackSignalSink() after importing main surfaces
in a routeHttpRequest /metrics scrape, so deleting the one main.ts wiring line fails a
test); fake_ctx.ts (route override).

Reviews (in-phase, the closeout precedent; apply-all honored): privacy-security-review
CLEAN, all 7 required checks pass (no label can carry ip/account/token/concrete id;
METRICS_TOKEN gate unwidened; zero behavior change at every emission site; guarded
increments; prom-client untouched at the pinned EXACT 15.1.3; proxy fully removed with
no double-count; the BolaDenyEvent audit log intact), 0 findings. test-coverage-auditor
0 BLOCKING / 1 SHOULD-FIX + 1 NIT, BOTH APPLIED: the unpinned main.ts boot-wiring line
became the metrics_gate boot-wiring integration test, and the vacuous
pgLimiterWrites-empty assertion in the recording-fake flood test became the real-pg-store
flood companion (plus a clarifying comment on the original). qa-checklist READY,
0 BLOCKING / 0 SHOULD-FIX / 0 NIT (its two adversarial items are the documented-by-design
reconciliations above).

Validation at the final tree: tsc 0; tests/server 86 files / 1704 passed + 2 skipped;
build:server OK; PERF_GATE_WALLCLOCK=1 perf_gate 10/10 (counters sit on rejection paths,
not the request hot path); ci:changed 0 errors; npm run gate PASS all 9 steps. Durable
record: state.md closeout list marks Phase 28 RESOLVED, the OPEN items index leads with
the RED-catalog-complete entry, the new-files table gained row 28, the Phase 19 record
carries an inline proxy-retired pointer, and server/http/CLAUDE.md's observability row
names attack_signals with the label discipline. The packet (25 phases + closeouts 26/27/28)
is now fully closed; the only remaining follow-up is the next-release ladder-deletion PR
(exit criteria in state.md, owner Fernando).

## v0.22.0 release merge (2026-07-05): admin permissions + antibot config + Meta CAPI, both-arm mirror

Merge 05395258b brings release/v0.22.0 (61 commits): fine-grained admin role permissions
(#1455), bot-detector runtime config (#1433), server-side Meta CAPI (#1460), per-player
node harvest + proficiency-scaled rarity roll (#1121/#1122), and the world-boss
anti-kite/raid-lockout work. Fourteen conflicts resolved (sim corpse-harvest cluster,
server seams, sim_i18n key-union with branch translations winning, count-pin re-derives:
command schema 118 sends / 127 dispatch, IWorld 170 members / 42 data / 128 methods).

HTTP surface: EIGHT new admin routes, migrated inside the merge commit per the
no-half-migrated-family rule (GET /admin/api/me, GET /admin/api/staff, GET
/admin/api/staff/history, POST /admin/api/staff/roles, GET /admin/api/provider-usage,
GET+POST /admin/api/antibot-config, GET /admin/api/antibot-config/history), each
router-owned AND legacy-served, with surface-corpus rows and no-auth parity 401 pins.
The release-merge migrated set grows 34 to 42; the admin surface counts 46 RouteDefs.

Auth model, mirrored onto both arms: createRequireAdmin resolves staff identity
fail-closed (staff_db.adminRolesForAccount; no roles means 401) and runs the central
ADMIN_ROUTE_PERMISSIONS gate from the concrete request path (unmapped 404 'unknown admin
endpoint' / 405; missing permission 403) before any :id/:action decode, byte-identical
to the release's legacy handleAdminApi preamble; the identity (username, roles, expanded
permissions) is stashed on ctx.state for /me and the staff-roles write. Login answers
roles + expanded permissions; overview no longer carries the usage snapshot
(provider-usage owns it under ops_usage.read). DEVIATION SUPERSESSION recorded in the
ledger: adminEnumInvalid422 fully superseded (both arms fail-closed 404 an out-of-enum
action pre-decode); adminIdParamDecode narrowed to the degenerate digit-string class
('0'/'00'/past-2^53 still 422 on the migrated arm where legacy runs the handler); the
non-numeric class now answers the same 404 on both arms, superseding the old 422 and the
wider-spelling num() note. tests/server/admin.test.ts pins both supersessions plus the
403 permission-denial arm, the staff family (role change + live kick + the four
refusals), and the antibot family (GET fields, history, validate-apply-persist,
missing-overrides 400, rollback-on-reject with persist-nothing).

Register twins (server/auth_routes.ts + the legacy main.ts arm): accountId in the 200
body, the Meta CAPI AccountCreated event (email + cookie attribution, fire-and-forget,
injectable via the auth db bundle), and the requestMetadata hoist. WS join: ws_auth.ts
deps bag re-bound (adminRolesForAccount + permissionsForRoles + metaRequestUserData +
metaEventSourceUrl); the session snapshots isAdmin + the expanded adminPermissions (fail
closed, no is_admin fallback) and the CAPI attribution (fbp/fbc/sourceUrl) for
trackReachedLevel5. Boot replays the persisted antibot overrides through
game.applyAntibotConfig right after the liveGame() first touch.

Private bot detector (synced to ~/Documents/wocc-bot-protection, its own commit):
describeConfig/applyConfig implemented; an enforce kill-switch field defaults to the
ANTIBOT_ENFORCE env var (the host now always grants its enforce parameter; the config
gates active responses live) plus the six gate knobs (report/throttle/kick score
thresholds and sustain windows) threaded through evaluateGate as an optional tuning bag
with the old literals as defaults; REPLACE + skip-invalid apply semantics with a
tests/config.test.ts pinning both.

Release-merge audit (six parallel auditors: server overlaps, sim overlaps, i18n
overlaps, endpoints+deviations, injected bindings, doc premises): server/sim/i18n
overlaps and every injection seam CLEAN; findings applied: the eight surface-corpus
rows (the freshness gates redden without them), the two ledger rewrites, the stale
admin.ts banner prose (auth model + superseded deviations), the world_boss.ts header
(utcDay to raid-lockout), the server/CLAUDE.md antibot boot-replay row (startServer +
liveGame, not main() + new GameServer()), and the count updates here, in state.md
(closeout counts, Phase 17 + 18b brackets, the new slice record), and in
phase-25-docs-flag-flip.md.
