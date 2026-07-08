# API Pipeline QA Checklist: whole-feature integration matrix

This is the whole-feature integration QA matrix for the API pipeline re-architecture, run ONCE
at packet completion (after Phase 25 lands), not per phase. Each `phase-NN-qa.md` already gates
its own diff against the per-phase acceptance criteria; this matrix is the final cross-phase pass
that asserts the migrated server behaves as one coherent system, the repo invariants survived the
25-phase chain, and nothing regressed across the stacked PRs.

Scope reminder (from `state.md`): the work is SERVER-ONLY except the Phase 22 client touch
(`userFacingApiError` in `src/main.ts` plus the `apiError.*` catalog). It is NOT a gameplay change,
NOT a WS wire change, and NOT a concurrency-scalability fix. Anchor every check on SYMBOL NAMES,
route strings, and test files, never on line numbers (all SPEC line anchors are stale).

How to use: check every box. A box anchors on a runnable check (a Vitest file, a guard test, a
build command, a curl) or a symbol-anchored code read, never on "looks done." Any unchecked box is
a blocker. Record the verdict, the validation results, and the reviewer outcomes at the bottom.

---

## 1. Server-authority + anti-cheat

The client is a renderer; the server resolves all outcomes. The migration moved routing and
hardening only, never gameplay resolution.

- [ ] No client-trusted outcomes were introduced: no migrated `/api` or `/admin` handler accepts a
      client-supplied combat, loot, quest-credit, economy, or XP RESULT. Handlers accept INTENT and
      identifiers; the server computes the outcome.
- [ ] All WS commands stay validated server-side: the WS path was not migrated, the `ws_auth`
      extraction (Phase 1) preserved `authenticateWebSocket`/`onConnection`/`upgrade` behavior, and
      the 20 Hz world loop still resolves movement intent and commands authoritatively.
- [ ] The migration changed NO gameplay resolution: `git diff main..HEAD -- src/sim/` is empty
      except for nothing (the packet must not touch `src/sim/`); no combat, hit-table, rage, armor
      DR, XP-curve, loot, or market-pricing math was edited by any phase.
- [ ] BOLA load-then-authorize holds: every account-owned `:id` route resolves through an
      account-scoped `requireOwned*` loader (scope-before-find), denial is 404 for player-owned
      objects and 403 for admin/operator-scoped routes, and the deny-by-default registry coverage
      test passes with `bola_denied` structured logging on cross-account access.
- [ ] Dev-only cheats stay gated: `GET /api/perf` and any level/teleport/item path remain behind
      `ALLOW_DEV_COMMANDS=1` and are never reachable in a production config.

## 2. Three-host / parity

One sim runs the offline browser world, the online server, and the RL env. This packet is
server-only, so all three hosts must be byte-for-byte unaffected in sim behavior.

- [ ] ROUTE-FAMILY COVERAGE (the release-merge drift gate): every route family present in server
      SOURCE (sweep ALL of server/ for dispatched path literals, incl. prefix-delegated
      sub-dispatcher modules like server/daily_rewards.ts, not just the four dispatcher files) is
      either migrated onto RouteDefs or recorded as DELIBERATELY delegate-served, AND has
      `SURFACE_INVENTORY` rows + (for /api) `API_CONTENT_TYPE` entries. A release merge that adds
      routes must file rows at the merge and assign an owning phase (the v0.19.0 daily-rewards
      merge filed neither: caught only by the 2026-07-02 drift audit, owned by Phase 18b).

- [ ] The sim is untouched: `git diff --name-only main..HEAD` lists no file under `src/sim/`.
- [ ] `tests/architecture.test.ts` is green (sim purity and determinism guard: no DOM/Three imports,
      no imports from render/ui/game/net, no `Math.random`/`Date.now`/`performance.now` in `src/sim/`).
- [ ] No WS wire change: the snapshot/event wire schema is unchanged; no phase altered the WS
      payloads. If any phase would have, it stopped and surfaced it (per the canonical stop rule).
- [ ] `ClientWorld` is unaffected: `src/net/` (the online client world mirror) and `IWorld`
      (`src/world_api.ts`) are not in the diff; the only client-side touch is the Phase 22
      `userFacingApiError` matcher in `src/main.ts` plus the `apiError.*` catalog.
- [ ] `cross-platform-sync` reviewer: dispatched for Phase 22 only (the client matcher), verdict
      clean; SKIP-justified for every other phase because they are server-only.

## 3. Determinism

The sim tick is a fixed 20 Hz and all sim randomness goes through `Rng`. Server time is fine, but
limiter tests must be deterministic.

- [ ] No `Math.random`, `Date.now`, or `performance.now` was added to `src/sim/` by any phase
      (re-confirmed by `tests/architecture.test.ts`).
- [ ] The limiter clock is injected: `ratelimit.ts` / `ratelimit_db.ts` take a `now()` clock
      (default `Date.now`, Phase 2 seam), and the window / `Retry-After` / `{remaining,resetSeconds}`
      tests drive it deterministically via the injected clock, not wall time.
- [ ] No new wall-clock nondeterminism leaked into a unit-tested code path: golden-master fixtures
      normalize timestamps, ids, tokens, reqId, and Date, and the normalizer test asserts it masks
      exactly the placeholder set and nothing else.

## 4. Error model

Per-surface envelopes are chosen by one `mapError`, never a single global serializer. Status codes
follow RFC 9110 / 6585. No internal detail leaks.

- [ ] `/api` JSON routes serialize errors as RFC 9457 `application/problem+json`
      (`type`/`title`/`status`/`detail`/`instance` plus a stable machine `code`).
- [ ] `/oauth` POST JSON routes serialize as RFC 6749 `{error, error_description}`.
- [ ] `/admin` routes serialize as `{success, data, error}` with the frozen page/limit pagination
      contract (NOT page/pageSize).
- [ ] Non-JSON `/api` surfaces are correct per the Phase 3 content-type classification: HTML routes
      (`GET /api/email/unsubscribe`, OAuth GET consent/device pages) return `htmlError`; the Discord
      callback (`GET /api/auth/discord/callback`) returns a 302 redirect-to-error (NOT problem+json);
      the binary card route (`POST /api/card`) is binary/no-JSON-wrap; the legacy `{ok:false}` 405
      (perf_report) is preserved as its characterized contract case.
- [ ] Status codes are correct end to end: 400 malformed JSON, 413 over byte cap (Content Too Large),
      422 well-formed-but-invalid (all field issues collected in one pass), 409 unique-violation,
      429 + `Retry-After`, 401 missing/invalid token (+ `WWW-Authenticate`), 403 no-entitlement,
      405 known-path wrong-method (+ `Allow`, decided before auth).
- [ ] No internal leakage in 500 bodies: unknown errors are logged and return a 500 with NO stack,
      SQL, or table text in the response body (asserted by the error-model contract test).
- [ ] `error_codes.ts` is the single `as const` source of truth, frozen `(domain, reason)` + param
      keys, APPEND-ONLY (AIP-193); the append-only assertion passes.

## 5. i18n completeness

The server stays language-agnostic and emits stable CODES re-localized at the client boundary.

- [ ] Every server-emitted error code resolves in EVERY locale: the per-surface code-parity Vitest
      asserts each code maps to a client `apiError.*` entry present in all locales (append-only
      frozen), and it covers the ~30 to 45 EXISTING REST strings plus the new Discord/guild codes,
      the desktop-login arm (`errors.api.desktopCodeInvalid`, live in `userFacingApiError` since
      the v0.19.0 merge), and whatever Phase 22 adjudicated for the 18b prose families (the
      daily-rewards bodies are provably discarded client-side; 'this token is read-only' needs a
      code). Prose-only 18b routes BLOCK the prose-fallback removal until the ladder deletion.
- [ ] `userFacingApiError` (`src/main.ts`) looks up emitted codes DIRECTLY in the client catalog
      (not reverse-matching English prose) and keeps its dual REST + WS-disconnect-reason role;
      parametric cases (suspended-until {date}, the {seconds} rate-limit families) carry `{code, params}`
      and format client-side via `formatNumber`/`formatDuration`/`Intl`.
- [ ] Em dashes are gone: the U+2014 rate-limit strings were swapped to commas in the same change as
      the matching `userFacingApiError` prefix (startsWith still resolves), and the operator-facing
      em dashes in `src/admin/i18n.locales/en_CA.ts` (and its resolved copy) are fixed.
- [ ] `tests/localization_fixes.test.ts` (S3) is green AND the new per-surface code-parity test is
      green.

## 6. Persistence

Additive idempotent DDL at boot under the advisory lock; no migrations directory; the inline DDL IS
the schema. JSONB stays back-compatible.

- [ ] `RATELIMIT_SCHEMA` is wired into the `ensureSchema` statement list under
      `pg_advisory_xact_lock`, with a boot-time table-existence assertion (the exact trap the
      unwired `DISCORD_SCHEMA` fell into).
- [ ] `DISCORD_SCHEMA` (the 5 tables in `discord_db.ts`) is wired into `ensureSchema` with a
      boot-time table-existence assertion; the previously-orphaned `handleSwagClaim` is dispatched
      and reachable over HTTP.
- [ ] The World Market realm-key fix is applied at BOTH writers in lockstep
      (`saveCharacterAndMarketState` escrow txn AND `saveWorldState`) AND the read
      (`loadMarketState`); no bare global `'market'` `world_state` write remains (anchored on
      function names, not lines).
- [ ] The market backfill PARTITIONS the existing global blob by each seller character's realm, is
      idempotent under the advisory lock, has a boot-ordering gate before the first new-key write,
      and ships a dry-run + escrow-sum/row-count verification with a documented data-rollback.
- [ ] JSONB back-compat holds: `serializeCharacter` keeps a defensive `??` default so new state
      fields load on pre-existing rows; the save/load round-trip test and the idempotent-DDL re-run
      test pass (extends `save_character_and_market.test.ts`).
- [ ] `migration-safety` reviewer: dispatched for the DDL-wiring and market phases (Phase 16/19/20),
      verdict clean.

## 7. Rate limiting

Two-tier: an in-memory IP gate first, a pg-backed global-keyed backstop second.

- [ ] Two-tier ordering holds: tier-1 in-memory IP gate runs BEFORE tier-2 pg, so floods never reach
      pg (`pg_limiter_writes_total` stays 0 under a tier-1 flood in the test).
- [ ] `Retry-After` plus the draft-11 / RFC 9651 `RateLimit` + `RateLimit-Policy` structured-field
      headers (q/w/r/t, pinned to a draft version in a comment) are emitted on 429, not the legacy trio.
- [ ] The new limiters fire: character.create/rename/delete/takeover, reports.create, and the Discord
      limiter (`DISCORD_MAX_PER_MINUTE=15`, ip+account) each rate-limit under their policy; the
      ip+account-keyed limiters resolve the account key only AFTER the DB token lookup.
- [ ] Handler-level checks are preserved: `authThrottled` (per-username, failed-only, clears on
      success, 15m/10-fail) and `rateLimitedPerfReport` (returns 200 BY DESIGN) keep their behavior
      as documented knownDeviations.
- [ ] The FUSED register/login/desktop-login per-IP budget is still ONE bucket with
      limiter-before-auth ordering (a per-policy split is an explicit maintainer decision, never a
      rework side effect), and the daily-rewards spin no-limiter decision (Phase 18b parity; the
      one-spin-per-day 409 plus the wallet-eligibility 403 are the only guards, no throttle) is
      either preserved or consciously revisited in Phase 19.

## 8. Security headers

A top-level wrapper covers the whole prefix ladder AND the onion, so a routing rollback cannot drop
a header.

- [ ] `withSecurityHeaders` is a TOP-LEVEL `createServer` wrapper covering serveStatic, `/c/` SSR,
      `/p/` card, `/avatar`, the sitemap, the OAuth GET pages AND the route onion, present on BOTH
      the old-ladder and new-dispatcher paths (a simulated flag-off pass still carries every header).
- [ ] The header set is complete: nosniff, Referrer-Policy, Permissions-Policy deny-all, HSTS in
      prod, COOP/CORP same-origin, frame-ancestors / X-Frame-Options on OAuth, Cache-Control no-store
      on auth/token, Server + X-Powered-By stripped.
- [ ] No COEP: `COEP: require-corp` is NOT set (it would break cross-origin GLB/HDRI), and no
      enforcing CSP header is present (full CSP is a separate Report-Only effort, NOT enforced here).
- [ ] The 415 Content-Type gate runs LOG-ONLY first behind a named flag, exempts the binary card /
      HTML unsubscribe / redirect callback / audited beacon routes via the Phase 3 classification,
      and returns 415 + a stable code only when flipped to enforce.
- [ ] CORS + the OPTIONS-204 short-circuit stay TOP-LEVEL wrappers covering both old and new paths;
      the parity harness asserts old and new emit identical CORS/preflight per route.

## 9. Performance

No realtime regression. The pipeline runs on the same event loop as the 20 Hz world loop.

- [ ] The perf gate passes: the pipeline (compose recursion + ALS + per-route metric write +
      full-issue schema validation) adds under the chosen X ms p99 per request AND does NOT raise
      tick p95 above 0.8 x DT, measured against the existing perf harness (the gate constant is
      pinned in Phase 24).
- [ ] No per-tick allocation regression: the world-loop hot path does not allocate per tick from the
      pipeline (metric labels use the `:param` route template, never a concrete path, so cardinality
      stays bounded and no per-request string is retained on the tick path).

## 10. Copy review

- [ ] No em dashes (U+2014), en dashes (U+2013), or emojis appear in any server code, comment, doc,
      commit, or player-facing copy added or changed by the packet (the Stop hook and the pre-push
      copy scan are green over the changed files; the legacy U+2014 rate-limit strings are fixed).

## 11. Build gate

- [ ] The full pre-merge gate is green at HEAD:
      `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`.
- [ ] `npm run ci:changed` (Biome on changed files only) is green; no whole-tree `--write` was run.

## 12. Deploy verification

- [ ] `curl /api/status` returns ok (the labeled-behavioral trim to `{ok, realm, players_online}`),
      and `/livez` + `/readyz` respond (`/readyz` reports NOT-ready during the SIGTERM drain).
- [ ] The active dispatch path is logged at boot, and an alert fires if the OLD path is active in
      prod (the new path is the default per Phase 25's flag-default flip).
- [ ] The old ladders are still reachable when the flag is flipped back: a flag-off boot serves the
      migrated routes through all four legacy delegates (`handleApi`, `handleAdminApi`,
      `handleOAuth`, and the /internal composite that tries the daily-rewards ops sub-dispatcher
      first), with CORS/preflight and security headers still present (both are top-level wrappers).

---

## Reviewer dispatch (final pass)

Spawn only the surfaces the cumulative diff touches (`git diff --name-only main..HEAD`):

- [ ] `privacy-security-review`: auth, BOLA, rate limit, security headers, secrets, SQL. Verdict clean.
- [ ] `migration-safety`: `ensureSchema` wiring (RATELIMIT_SCHEMA / DISCORD_SCHEMA), the market fix +
      backfill, any JSONB shape change. Verdict clean.
- [ ] `cross-platform-sync`: Phase 22 client matcher only. Verdict clean.
- [ ] `architecture-reviewer`: SKIP-justified (no `src/sim/` change).
- [ ] `qa-checklist`: this matrix, completed.

## Verdict

- Verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL.
- Validation results: each gate command with pass/fail.
- Reviewer outcomes: each dispatched reviewer with verdict.
- Open follow-ups: the deferred items (old-ladder deletion exit criteria and owner per Phase 25,
  and the deferred API conventions A/D/F/G), tracked as their own PRs.
