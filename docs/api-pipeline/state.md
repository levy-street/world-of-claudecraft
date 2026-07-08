# API Pipeline: cross-phase state (the cheat sheet)

NOTE (packet closure, 2026-07-05): the per-phase working documents this file cites
(`phase-NN-*.md`, `brainstorm.md`, `implementation-plan.md`) were removed at packet
closure and live in git history. This file, `progress.md`, `qa-checklist.md`,
`source-spec.md`, and `phase-20-rollback-runbook.md` are the durable record; shipped
code and tests point at them, so keep their paths and headings stable.

Authoritative quick-reference for the `docs/api-pipeline/` packet. Every phase file reads
this first in its Explore step. Source of truth for the locked decisions is the canonical
block (transcribed below) and the synthesis. When a phase file disagrees with this file,
this file and the canonical win. The feature re-architects every JSON/HTTP endpoint on the
authoritative game server (`server/`) behind one in-house request pipeline. Goal:
maintainability, security, testability, observability. NOT a concurrency-scalability fix
(the single-threaded 20 Hz world loop is the per-realm ceiling, a separate out-of-scope
workstream), NOT a gameplay change, NOT a WS wire change.

## Current phase

Phase 25 (docs + new:endpoint scaffold + flag-default flip) is the FINAL phase. THE
DISPATCH DEFAULT IS NOW 'new' (server/http/config.ts DEFAULT_DISPATCH = DISPATCH_NEW):
the in-house pipeline fronts every REST surface in production, and API_DISPATCH=legacy is
the ONE-FLAG rollback (no code redeploy) to the retained legacy ladder. The one const
seeds both loadConfig's unset/empty default AND main.ts's four pre-boot entry seeds, so all
four flag-gated entries (apiEntry / adminApiEntry / oauthApiEntry / internalApiEntry) flip
together via the single setApiDispatchMode; loadConfig throws on a garbage API_DISPATCH.
logApiDispatchSelection's legacy+production ALERT now fires exactly when someone has ROLLED
BACK. resetApiDispatchModeForTests now restores the BOOT DEFAULT (DEFAULT_DISPATCH, 'new'),
and the two characterization golden masters (characterization.test.ts +
characterization_admin_oauth_internal.test.ts) plus route_dispatch.test.ts now pin 'legacy'
EXPLICITLY (they characterize the legacy ladder, so they are immune to the flip);
tests/server/http/dispatch_default.test.ts pins both directions on all four entries.
config.test.ts pins the literal 'new' as the unset default. The old ladder is RETAINED
behind the flag this release; its deletion is a NEXT-RELEASE follow-up PR gated by the
criteria in `## Old-ladder deletion exit criteria (next release)` (end of this file).
Phase 24 (validated config + server timeouts + no-magic-values + perf gate) DONE
(2026-07-03).

PHASE-25 QA GATE (phase-25-qa.md, 2026-07-04): PASS, apply-all. Zero BLOCKING across four
reviewers (correctness, test-coverage-auditor, dead-code/cleanup, privacy-security-review);
all 10 acceptance criteria and all 3 stopping-rule checks verified against the real range
9a254ee2b..4e6e60f8d. Two SHOULD-FIX fixed in f954346e5 (the retained-ladder comments across
14 server files still claimed Phase 25 removes the ladder or that the default is 'legacy';
reworded to the next-release ladder-deletion PR). Nits applied: the packet's dangling
scratchpad/canonical.md pointers repointed to this file (fd472bd96) and the new:endpoint
golden test hardened (b04df2f89: anchor-not-found UsageError pins plus a passed-count
assertion on the child vitest). The stale until-Phase-25 prose inside
tests/server/http/known_deviations.ts and sibling test comments is DEFERRED to the deletion
PR (frozen ledger prose; those entries fire at the deletion anyway). [Superseded early:
Phase 26's comment sweep (76e26254c, 2026-07-04) already reworded that prose; zero
"Phase 25" matches remain in known_deviations.ts.] Validation green at the
final tree: tsc 0, golden 23/23, dispatch_default + config 32/32, tests/server/http 41
files / 912 tests with zero fixture edits, PERF_GATE_WALLCLOCK=1 perf_gate 10/10,
ci:changed 0, npm run gate PASS all 9 steps. The core MIGRATION is COMPLETE.

CLOSEOUT REVIEW (2026-07-04): an independent whole-branch review confirmed the migration is
functionally complete (gate green, dispatch default 'new' across all four entries, every REST
surface migrated, no un-carved-out surface, load-bearing counts hold: admin 38 RouteDefs,
release-merge set 34 [v0.22.0 SLICE UPDATE 2026-07-05: admin 46 RouteDefs, set 42; see the
v0.22.0 release-merge slice above]) and the deletion-exit-criteria index is honest. It surfaced THREE closeout
polish items, none a correctness or safety blocker, each now a follow-up phase (see README
"Closeout phases (post-25)" and the phase-26/27/28 files):
- Phase 26 (cleanup) DONE (2026-07-04): the shipped code no longer carries dev-phase framing.
  123 files reworded to the mechanism names (commits ef0405a18 / 4d7a7929d / 76e26254c), the
  stale "registry EMPTY today / loader is a later phase / nothing sets these" comments corrected
  to the wired pipeline (185bcd0d6), and the oauth em-dash sweep landed including the
  player-facing device string (34cbb4560; the deferred GET /oauth/device characterization golden
  is now capturable). Deliberate keeps recorded in progress.md Phase 26: the known_deviations.ts
  introducedInPhase field/values + DEVIATION_PHASE_MIN/MAX (pinned runtime data), five live doc
  pointers in code (rollback runbook, this file's exit criteria, three progress.md records), and
  the five i18n overlay comments (overlays are never hand-edited). Zero behavior change; gate
  PASS; qa-checklist READY 0/0.
- Phase 27: the Phase 25 flag flip to 'new' crossed the Phase 21 QA pre-flip watch-item (bound the
  two log-only mismatch sinks before flipping) without clearing it on the record; resolve by
  bounding the sinks or recording a conscious acceptance. RESOLVED (2026-07-04, Option A): both
  default sinks are flood-bounded by server/http/mismatch_warn_throttle.ts; see the OPEN items
  entry in this file for the full record.
- Phase 28: only 2 of the 6 source-spec 4.9 "Request layer (RED), this PR" metrics shipped
  (http_requests_total, http_request_duration_seconds); the four attack-signal counters
  (rate_limit_hits_total, auth_failures_total, bola_denied_total, pg_limiter_writes_total) were
  silently narrowed out with no durable deferral; qa-checklist.md:153 still named the then-unshipped
  pg_limiter_writes_total. RESOLVED (2026-07-05, Option A: SHIP): all four counters are live on the
  one /metrics registry via the new server/http/attack_signals.ts slot, the ratelimit.pg.hit proxy
  row is replaced by the real pg_limiter_writes_total series, and qa-checklist.md:153 now names a
  real, test-pinned metric; see the OPEN items entry in this file for the full record.
These three closeout items are now ALL RESOLVED and recorded in this file's durable indexes (the
OPEN items entries plus the new-files table).

THIRD v0.20.0 RELEASE-MERGE SLICE (2026-07-03, after the Phase 24 QA gate): the map
editor surface landed and was migrated IN-MERGE (9 custom-map + 4 uploaded-GLB /api
routes on the wallet shared-*Core template in NEW server/maps_routes.ts +
server/user_assets_routes.ts, 5 admin moderation RouteDefs, the housekeeping calendar
11th member; MAP_MUTATION_POLICY + ASSET_UPLOAD_POLICY; createReadGuard joins the
bearer-guard factories; HTTP_METHODS gained PUT; deviations mapsAssetsRateLimitedBodyToCode
+ mapsAssetsIdParamDecode). The release-merge migrated set is now 45; the migrated
character-rename handler mirrors the release's Ravenpost mail rekey. Full record:
progress.md "v0.20.0 release merge, third slice". Phase 25's premises updated in place
(migrated-set count, the maps/assets 405 carve-out, the optionalViewerGuard throttle note).

FOURTH v0.20.0 RELEASE-MERGE SLICE (2026-07-03, merge bbd063447): bags, ghost death loop,
Drowned Litany, guild last-login. ZERO HTTP API surface (server delta only
db.ts/game.ts/social.ts/social_db.ts; five new WS commands pinned release-side; additive
last_login DDL consumed only by the WS social hub). Migrated set STAYS 45; no corpus,
RouteDef, deviation, or premise changes. Full record: progress.md "v0.20.0 release merge,
fourth slice".

FIFTH v0.20.0 RELEASE-MERGE SLICE (2026-07-04, the release-tip merge): the release
REVERTED the whole housekeeping feature (revert of PR #1340 plus the calendar-caps
follow-up; the feature never reached main), so this merge mirrors the delete end to end:
housekeeping.ts/housekeeping_api.ts/housekeeping_db.ts, src/sim/game_config.ts, the admin
SPA pages, the 11 housekeeping RouteDefs in server/admin.ts (and housekeepingHandler +
the AdminRuntime housekeepingSummary member), the 11 surface-corpus rows, the four
housekeeping parity 401 pins, and carve-out (d) below (retired in place). The release-merge
migrated set drops 45 -> 34; the admin surface now counts 38 RouteDefs. The liveGame() deferred
construction SURVIVES the revert (the import-main harnesses and the module-scope
configure*Runtime closures still need lazy first-touch; tests/server/game_boot_order.test.ts
keeps the laziness pin, the applyGameConfigAtBoot order pin is deleted with the feature).
Non-housekeeping release deltas in the slice: mandatory signup email +
POST /api/account/email/set-initial were already migrated in an earlier slice (both twins
present); the rest is WS/sim/UI surface (one-online-character-per-account, mail hardening,
block-invites, haste item sets, cast-target locking, chat tab strip, delve fixes) with no
HTTP route changes. Full record: progress.md "v0.20.0 release merge, fifth slice".

v0.21.0 RELEASE-MERGE SLICE (2026-07-04, merge dc392dca1): corpse-harvest profession
(#1141) + monster component tags (#1140). ZERO HTTP API surface: the only server delta is
server/game.ts (one new WS command harvestCorpse plus its HEAVY_SELF_CMDS membership),
pinned release-side in tests/command_schema.test.ts (117 sends / 126 dispatch) and
tests/world_api_parity.test.ts (168 members / 42 data / 126 methods). New sim claim logic
in src/sim/professions/gathering.ts behind the SimContext seam (command body in
src/sim/interaction.ts). Migrated set STAYS 34; no corpus rows, RouteDefs, deviations, or
deletion-exit-criteria changes. Post-merge audit fixes applied branch-side: dead-player +
full-bags guards on harvestCorpse (sibling-precedent, tested), real fills for the two new
sim error strings across all 19 non-en locales (M16), the S3 simSrc list extended with
interaction.ts + professions/gathering.ts, HARVEST_COMPONENT_ITEMS relocated to
src/sim/content/professions.ts, world_api.ts FACET MAP header made count-free. OPEN
UPSTREAM (content design, flagged to the maintainer, NOT papered over here): harvest
yields are quest items, granting cross-quest collect credit from any tagged mob. Full
record: progress.md "v0.21.0 release merge, first slice".

v0.22.0 RELEASE-MERGE SLICE (2026-07-05, merge 05395258b): fine-grained admin role
permissions (#1455), bot-detector runtime config (#1433), Meta CAPI (#1460), node
harvest + rarity roll (#1121/#1122), world-boss anti-kite/raid-lockout. EIGHT new admin
routes mirrored onto BOTH arms (GET /admin/api/me, GET /admin/api/staff, GET
/admin/api/staff/history, POST /admin/api/staff/roles, GET /admin/api/provider-usage,
GET+POST /admin/api/antibot-config, GET /admin/api/antibot-config/history): the
release-merge migrated set grows 34 -> 42 and the admin surface counts 46 RouteDefs;
eight surface-corpus rows plus eight no-auth parity 401 pins added. AUTH MODEL CHANGE
mirrored into createRequireAdmin: staff roles fail-closed (staff_db.adminRolesForAccount)
plus the CENTRAL ADMIN_ROUTE_PERMISSIONS gate (403/404/405 pre-decode) on both arms; the
migrated login returns roles + expanded permissions; GET /admin/api/overview no longer
carries the usage snapshot (split to provider-usage). DEVIATION SUPERSESSION: the central
gate 404s an out-of-enum :action and every non-numeric :id spelling identically on both
arms pre-decode, so adminEnumInvalid422 is fully superseded and adminIdParamDecode is
narrowed to the degenerate digit-string class ('0'/'00'/past-2^53); the ledger entries
record this. Register twins gained accountId in the 200 body plus the Meta CAPI
AccountCreated event; the WS join (ws_auth.ts deps bag) snapshots adminPermissions and
the CAPI attribution; the private bot detector implements describeConfig/applyConfig
(enforce kill-switch defaulting to ANTIBOT_ENFORCE plus six gate knobs), synced to the
canonical repo. One new WS command (harvest_node) pinned in command_schema (118/127) and
world_api_parity (170/42/128). Full record: progress.md "v0.22.0 release merge".

loadConfig(env) is now the validated FAIL-FAST boot edge, called once as startServer's
first step (before the DB retry loop) and memoized behind main.ts activeConfig() (+
resetActiveConfigForTests) so request-time consumers read lazily and a bare import stays
env-free: throws name the key, never a value (DATABASE_URL, which IS the tier-2 limiter
DSN, no separate env; API_DISPATCH set-but-invalid, unset takes DEFAULT_DISPATCH ('new'
since Phase 25);
REQUIRE_WEB_LOGIN / API_CONTENT_TYPE_ENFORCE / API_ORIGIN_CHECK_ENFORCE garbage;
non-origin PUBLIC_ORIGIN; unusable non-empty REALMS). New Config fields requireWebLogin +
metricsToken; the six conscious read-once exceptions are documented at the top of
config.ts (per-request secret gates, game.ts dev reads, domain config getters, middleware
env= seams, db.ts pool, tolerant realm keys). Boot logs the dispatch path
(logApiDispatchSelection) and ALERT-warns on legacy+production. The P23 must-gate LANDED:
GET /metrics is 404 feature-off until METRICS_TOKEN is set, then Bearer + length-guarded
timingSafeEqual (opaque 401), no-store on every arm, gated in BOTH dispatch modes;
DEPLOY.md carries the ops note (token on server AND scraper or scraping goes dark). The
redactor email value-pattern landed RFC-BOUNDED ({1,64}@{1,255}.{2,24} + an includes('@')
probe) after review measured the unbounded form quadratic (seconds at 60 KB, same thread
as the 20 Hz loop); pathological-input pins cap it at 2 s. PgRateLimitStore now gets the
composite httpMetricSink. NEW server/http/server_timeouts.ts codifies the four node:http
timeouts EQUAL to the installed node defaults (REQUEST_TIMEOUT_MS 300000,
HEADERS_TIMEOUT_MS 60000 > KEEP_ALIVE_TIMEOUT_MS 5000, MAX_HEADER_SIZE_BYTES 16384 via
createServer options): zero behavior change, named and pinned; the packet's "1 MB card"
premise was WRONG (card cap is 4 MiB MAX_CARD_BYTES; the 1 MiB body is bug-reports).
Consolidated named constants: WS_MAX_PAYLOAD_BYTES (16 KiB never-widen),
BUG_REPORT_MAX_BODY_BYTES (deduped, reports.ts exports), DAILY_PRUNE_INTERVAL_MS,
DB_BOOT_MAX_ATTEMPTS/DB_BOOT_RETRY_MS, DB_POOL_MAX_CLIENTS, AUTH_MAX_PER_MINUTE
(rateLimited default), six daily-rewards decode defaults; msg_rate_limit.ts stays
module-owned WS-plane by decision; tunables.test.ts pins every POLICIES row by identity
AND literal plus a targeted no-duplicate source scan. NEW server/http/perf_gate.ts
(DT_MS = 1000/TICK_RATE = 50, TICK_P95_CEILING_RATIO 0.8 -> 40 ms,
PIPELINE_ADDED_P99_BUDGET_MS 1.0) + tests/server/perf_gate.test.ts: deterministic
always-on arms (TickProfiler synthetic p95; bounded-work onion-vs-legacy proxy: O(1)
dispatch, registry-size independent, template-bounded cardinality) and a
PERF_GATE_WALLCLOCK=1 arm (measured added-p99 about 0.005 ms vs the 1.0 budget, tick p95
about 0.44 ms vs 40); tick-GAP jitter under load stays with npm run perf:load (not
reproducible in single-threaded vitest). DECISIONS: NO timed drain window (none exists
today; additive, now a P25 decision item); no full-ip log exception; daily-rewards
pagination upper clamp stays a pre-existing gap (non-behavioral contract). Reviews
apply-all: privacy-security 0 BLOCKING / 1 should-fix (ReDoS, fixed); qa-checklist READY
0 BLOCKING (DEPLOY.md note + rateLimited default-binding pin applied). DEPLOY-ENV AUDIT
WARNING before this branch ships: the stricter PUBLIC_ORIGIN/REALMS validators fail a
boot that today tolerates a garbage value; audit the real deploy env. The packet's
maintainer to-do resolved with a CORRECTED premise: private bot_detector repo main (PR
#7) already implemented the calibration contract, the working-tree overlay was refreshed
FROM it (stopgap discarded, nothing committed upstream), and its
environment_probe.test.ts is locally removed (imports src/game/client_env, main-repo
client work that has not shipped). Validation: tsc 0, npm run gate PASS all 9 steps (752
files / 8580 passed + 13 skipped), build:server green. Full record: progress.md Phase 24
Notes. NEXT: Phase 25 (phase-25-docs-flag-flip.md), the LAST phase.

Phase 24 QA gate (phase-24-qa.md) DONE (2026-07-03): PASS, apply-all, 0 BLOCKING, 3
SHOULD-FIX found and fixed (a76ccbc37 + 3ce3702f3 + 73ca3de65). All ten ACs MET (AC2/AC5
as amended by the corrected premises). The three fixes: (1) the SET-BUT-EMPTY numeric env
default-shift ('CHAT_LOG_RETENTION_DAYS=' meant 0 = keep forever pre-P24 via Number(''),
now the 90-day default so pruning silently turns on; semantics KEPT and pinned in
config.test.ts, explicit 0 stays keep-forever, hazard added to maintainer action 1 + a
DEPLOY.md env-hygiene bullet); (2) the startServer timeout wiring is now source-pinned in
tunables.test.ts (createServer maxHeaderSize + applyServerTimeouts; deleting the wiring
used to stay green); (3) the perf-gate header's O(1)-dispatch overclaim reworded to the
honest counted-seam scope (an O(routes) matcher scan internal to one dispatch counts 1 at
every seam) and the PERF_GATE_WALLCLOCK=1 arm added to Phase 25's pre-flip validation
(run in this QA: 10/10 pass). Nits applied: exceptions block trued up (the two /api/perf
gates, the daily-rewards TTL knob, MARKET_BACKFILL_DRY_RUN, ambient-NODE_ENV scope,
Config.allowDevCommands has NO live consumer yet, a P25 wire-or-drop decision item);
purity pinned both directions; isBareOrigin credential/query/hash negatives;
activeConfig() memoization pin; literal-spelling bans; bearerCredential doc fix.
Dead-code audit CLEAN; privacy-security-review 0/0 (+2 nits applied); qa-checklist READY
0/0. Validation after fixes: tsc 0, ci:changed 0, build:server 0, npm run gate PASS all
9 steps (760 files / 8667 passed + 13 skipped).

Phase 23 (structured logging + /metrics exporter + drain-aware health) DONE (2026-07-03).
The Phase 8 observability seam is now LIVE: server/main.ts injects a composite
teeMetricSink(createAccessLogSink(logger), httpMetrics.sink) into all FOUR createApiDispatcher
sites (api/admin/oauth/internal share ONE registry and ONE access-log stream); noopMetricSink
STAYS the default in dispatch.ts so unit tests are unchanged. New modules
server/http/{redact,logger,access_log,metrics,health}.ts: an in-house pino-SHAPED JSON logger
(no pino; ALS reqId read at emit time via currentReqId, omitted outside a request; every record
passes redact() before write; never throws; injectable transport), a pure redactor (key needles +
Bearer/64-hex value patterns + OTP-scoped numeric/dashed codes; Buffer/TypedArray/ArrayBuffer
values collapse to the placeholder; idempotent, cycle-safe, total), the access-log MetricSink
(one 'access' line per onion-served request; route is ALWAYS the :param template; the client ip
is TRUNCATED at the log surface via truncateIpForLog, IPv4 /24 and IPv6 /48, full ip only on the
in-memory MetricEvent), the prom-client RED exporter (prom-client PINNED EXACT 15.1.3, the ONE
weighed dependency, subtree tdigest/bintrees/@opentelemetry/api; createHttpMetrics() per-instance
Registry; http_requests_total + http_request_duration_seconds with the named
HTTP_DURATION_BUCKETS_SECONDS constant; labels route/method/status only, ip NEVER a label;
collectDefaultMetrics scoped per registry, on at boot), and drain-aware health (markDraining /
isReady / isLive; GET /livez, /readyz, /metrics are top-level routeHttpRequest arms after CORS
and before /internal/, OUTSIDE auth/rate-limit, Cache-Control no-store, security headers
inherited; markDraining() is the FIRST statement of the shutdown closure so /readyz flips 503 at
drain start; verified through the real ladder under BOTH dispatch modes). The request-path
console.* sweep (~37 real sites, the SPEC's ~70 was a loose bound) moved
main/oauth/admin/discord/auth_routes/profile_page/player_card/woc_balance/github/
moderation_service/email plus the content_type/origin_check/require_owned/rate_limit default
sinks onto the logger; server/http/errors.ts keeps its console default (import cycle via
context.ts) and dispatch.ts injects a logger-backed onUnexpected; email/sender.ts's console dev
transport is intentional. TWO LOAD-BEARING DEFERRALS: (1) the X-Request-Id echo is BUILT and
unit-tested in withRequestId (setHeader on the way in; REQUEST_ID_HEADER single-sourced in
errors.ts, the runtime leaf, re-exported via compose.ts) but the LIVE dispatch-onion mount is
DEFERRED TO P25: mounting now adds the header to
migrated 2xx/429/404 responses the retained legacy delegate never emits (44 parity divergences);
the error-path echo is already live via errors.ts baseHeaders; NOTE comment in dispatch.ts. (2)
In 'legacy' dispatch mode (the production default until P25) /api requests emit NO access line or
metric (only onion-run routes traverse withMetrics); /livez//readyz//metrics work in both modes.
Malware-scan note: the redactor deny-list NAMES wallet-secret identifiers, so
scripts/malware_scan.mjs gained a generic per-rule pathSev demotion (high to medium, still
visible to triage) scoped to EXACTLY server/http/redact.ts + tests/server/http/redact.test.ts on
the wallet-identifier rule only, endorsed by a release-malware-audit triage (all 13 findings
false positives) and pinned in tests/malware_scan.test.ts (widening the path list fails a test);
flag as intentional at release. Reviews apply-all: privacy-security-review 0 BLOCKING (ip
truncation, byte-collapse, never-log-raw-url/headers convention applied; /metrics exposure
posture acceptable-for-now), qa-checklist READY 0 BLOCKING (3 legacy main.ts console sites
migrated, stale comment, dashed user-code pin). REMAINS PHASE 24: the timed drain WINDOW
constant, loadConfig(env) consolidation, server timeouts, the /metrics exposure gate
(token/bind/rate-limit + full-ip exception decision), the perf/tick-jitter acceptance gate, and
optionally wiring the PgRateLimitStore metrics param. Validation: tsc 0, npm run gate PASS all 9
steps (730 files / 8260 tests), build:server bundles prom-client. Full record: progress.md Phase
23 Notes.

Phase 23 QA gate (phase-23-qa.md) DONE (2026-07-03): PASS, apply-all, ZERO BLOCKING across five
auditors (correctness: all 10 acceptance criteria PASS, criterion 4 with the documented P25
deferral; test-coverage: 11/11 COVERED-DECISIVE; dead-code; privacy-security-review 0 CRITICAL;
qa-checklist READY; exclusions confirmed: migration-safety / cross-platform-sync /
architecture-reviewer not in play, release-malware-audit owns prom-client at release). Fixes
applied in 6 commits (adb1cb11f..05b53548f): the three legacy-delegate arms now bind a fresh
runWithReqId scope (dispatch.ts delegateWithReqId; they ran OUTSIDE any ALS scope so swept
logger lines on the production-default 'legacy' path carried no reqId; observability-only,
response bytes untouched), REQUEST_ID_HEADER re-homed to errors.ts (compose.ts re-exports; the
reverse import cycles via context.ts), HTTP_DURATION_BUCKETS_SECONDS literal-pinned, unused
exports trimmed (LogLevel, HTTP_METRIC_LABELS, HttpMetricLabel), the lazily request-reachable
email transport banner moved onto the logger, coverage pins added (opaque token-key redact,
withRequestId echo isolated from withErrors, both-mode livez/readyz integration, the production
composite tee shape end to end), and a NEW guard tests/server/http/logger_call_hygiene.test.ts
(fails on any server logger call passing raw req.url/req.headers/ctx.req/ctx.body wholesale).
Conscious keeps: Logger.child() + health.isLive() are spec-mandated; the no-store constant dup
stands. CARRIED-FORWARD WARNING: Phase 24 MUST land the /metrics exposure gate BEFORE
API_DISPATCH=new reaches production (unauthenticated route-template + process/runtime
disclosure today, by phase design); the redactor email value-pattern rides the same P24
privacy batch, upgraded from optional to strongly recommended by the v0.20.0 merge (signup
email is now MANDATORY, so raw email values flow on every register body, the set-initial
body, and the Discord capture path). Validation after fixes: tsc 0, ci:changed clean, npm run gate PASS all 9 steps
(731 files / 8269 tests). NEXT: Phase 24 (phase-24-config-timeouts.md).

Phase 22 (REST i18n matcher + per-surface code-parity guard + the coded-emission pass) DONE
(2026-07-02). The matcher is code-based and guarded, the migrated surfaces emit additive
codes alongside byte-identical prose in both twins, 9 discord.* codes appended (set now 59,
append-only), apiError.* is the client home, and tests/api_error_code_parity.test.ts +
tests/main_api_error.test.ts close the historically unguarded REST-matcher gap. Full record:
the "REST i18n matcher (Phase 22): DONE" section below + progress.md Phase 22 Notes.
Validation: tsc 0, npm run gate PASS all 9 steps. Phase 22 QA gate (phase-22-qa.md) DONE
(2026-07-02): PASS, apply-all, ZERO BLOCKING across seven auditors (correctness: all 6
acceptance items + 7 stopping rules PASS, the prose fallback byte-for-byte verbatim;
test-coverage; dead-code; server coded-emission: every twin pair matched and the
enumeration posture verified, unknown-username and wrong-password share
auth.invalid_credentials, IP blocks ride auth.too_many_attempts, the Phase 16 opaque
discord paths stay uncoded; privacy-security-review; cross-platform-sync; qa-checklist
READY). One SHOULD-FIX fixed (the suspended_until date-ABSENT defer arm was untested) plus
apply-all hardening: the parity guard gained DIMENSION 6 (apiError.* catalog leaf set ==
ERROR_CODES, and no value may carry a placeholder outside the {date}/{seconds} contract),
moderationErrorBody <-> requireAccount mirror-guarded (same status through both emitters
must derive the same code + date), exportData routed through apiErrorFromBody (the last
code-dropping client fetch error path), the swag reason cast replaced by === 'ok'
narrowing (a future canClaimSwag refusal reason fails tsc), and literal {error, code} pins
on the discord emit sites incl. NEW swag_points / swag_claimed / unlink-404 /
already_linked-race coverage. Adjudicated no-change: the /api/search uncoded 401 (the
documented divergent arm), the dual not-authenticated codes (intended dual-path design),
key-order canonicalization; transitional prose/date divergences resolve at P25. QA
re-validation: tsc 0, ci:changed 0, i18n regen idempotent, npm run gate PASS all 9 steps.
NEXT: Phase 23 (structured logging + /metrics, phase-23-logging-metrics.md).

Phase 20 (World Market realm-scope fix + partitioned backfill, separate persistence PR) DONE (2026-07-02). STALE PREMISE: the realm scoping pre-landed via hotfix e5124811c (v0.19.0 merge) as marketStateKey(realm) = 'market:<realm>' plus a LAZY whole-blob claim-and-DELETE migration in loadMarketState; Phase 20 kept the landed keys (helper name stays marketStateKey, NOT the packet's marketKey; MARKET_KEY_PREFIX added as the single-source constant) and REPLACED that migration. Scheme: NEW server/market_backfill.ts (*_db-style, injected client, no db.ts import; db.ts re-exports its constants) partitions the legacy bare 'market' blob per SELLER realm (numeric seller keys by character id with an int4-range guard, name-form keys by name, multi-realm-ambiguous names unresolved; unresolved/house keys routed to the backfilling realm and COUNTED, never dropped), verifies conservation (listing/collection counts, escrow copper, item counts) BEFORE writing, merges into a pre-existing realm row via a clamp-remapped mergeMarketSaves, upserts the 'market_backfill_done' marker, and RETAINS the legacy row forever (saveWorldState hard-rejects writes to it). GATE ORDERING (the load-bearing invariant): the backfill runs INSIDE ensureSchema's pg_advisory_xact_lock transaction, and openMarketWriteGate() runs only after that transaction COMMITs, strictly before game.loadMarket (main.ts boot order) and the 30s autosave; every market write path (saveMarketState, the saveCharacterAndMarketState escrow txn, market:<realm> saveWorldState) throws 'market write blocked' before the gate opens, so no realm-key write can precede the backfill across N realms on one DATABASE_URL. loadMarketState is a pure read (realm row, else marker-present null, else defensive legacy read). MARKET_BACKFILL_DRY_RUN=1 logs the per-realm plan and deliberately halts boot without writing. Rollback = data runbook (docs/api-pipeline/phase-20-rollback-runbook.md: dry-run-then-apply, rollback SQL, mixed-fleet post-backfill-writes-are-LOST caveat + one-maintenance-window mitigation, fail-closed boot); persistence is OUTSIDE the API_DISPATCH rollback story. Reviews apply-all: migration-safety verdict 0 BLOCKING / 1 SHOULD-FIX (runbook honesty; applied) / 2 NIT (applied); privacy-security-review 0/0/1 (applied); qa-checklist READY 0/0/3 (applied). Validation: tsc 0, full npm test 716 files / 8046 pass / 11 skip, all builds green. Full detail: progress.md Phase 20 Notes. Phase 20 QA gate (phase-20-qa.md) DONE (2026-07-02): PASS, apply-all, zero BLOCKING; migration-safety and privacy-security-review both PASS on a fresh independent pass. ONE doc SHOULD-FIX fixed: the runbook's mixed-fleet caveat now names BOTH old-code variants (pre-scoping stranded autosave writes AND the v0.19.0 hotfix lazy claim-and-DELETE: booting post-backfill on a partition-less realm it would adopt the whole retained legacy blob into one realm key, duplicate already-partitioned listings, and destroy the rollback artifact; the post-window check gained the legacy-NULL arm) plus a new one-way-marker caveat (a later-restored legacy row is never re-adopted without re-running the rollback SQL). Nits applied: four coverage tests (market-write-fails rollback, copper-only and item-count-only conservation mismatches, mergeMarketSaves duplicate-key value conservation under row-collapse), the marker no-op pin literalized, db.ts's market re-export narrowed to marketStateKey only. Re-validation: tsc 0, 6 persistence suites / 48 tests, full gate green. NEXT: Phase 21 (security-headers: top-level wrapper + Content-Type/Origin enforcement, phase-21-security-headers.md).

Phase 19 (two-tier rate limiter + ratelimit_db, cross-cutting) DONE (2026-07-02). Every in-memory limiter in server/ratelimit.ts (rateLimited + the 9 scoped wrappers + authThrottled + the PRIVATE recordSlidingWindowAttempt helper, plus perf_report.ts's local limiter via the NEW rateLimitNow() clock accessor) now returns the FROZEN Phase 2 RateLimitOutcome { allowed, remaining, resetSeconds } instead of a boolean; every consumer across 12 server files flipped to !x.allowed with BYTE-IDENTICAL legacy 429 prose and NO header additions on legacy arms (the fused register/login/desktop-login per-IP budget stays ONE bucket; authThrottled stays handler-level per-username/failed-only/clears-on-success; rateLimitedPerfReport still 200s by design; fused limiters merge allowed=both/remaining=min/resetSeconds=max). NEW server/ratelimit_db.ts: the pg-backed tier-2 GLOBAL backstop for multi-realm (PgRateLimitStore implements the frozen RateLimitStore; ONE atomic parameterized INSERT..ON CONFLICT (policy,key) DO UPDATE upsert per hit on the WINDOW_MS grid with the >=/GREATEST clock-skew guard; store key splits at the FIRST colon so IPv6 survives; pool INJECTED, never imports db.ts; pg-write counter through the Phase 8 MetricSink seam as route 'ratelimit.pg.hit' with status encoding the decision [PHASE-28 UPDATE 2026-07-05: that proxy row is GONE, replaced by the real pg_limiter_writes_total{policy} series via the attack-signal slot; the store's MetricSink option was removed]; reset() documented GLOBAL test-only). RATELIMIT_SCHEMA wired into ensureSchema after GITHUB_SCHEMA under the advisory lock + a to_regclass('public.rate_limits') fail-fast boot assertion (scoped to this one table) + RATELIMIT_PRUNE_SQL (a STATIC param-free dead-window DELETE, 2 x WINDOW_MS horizon on the DATABASE clock, at every boot: the security review's unbounded-growth fix). The Phase 8 adapter is the TWO-TIER resolver: RateLimitPolicy { name, keyClass, limit, windowSeconds, tier1, tier2 } with every limit REFERENCING its named constant (identity-asserted by a derivation guard test; nothing re-tuned); tier-1 runs and throws FIRST (floods never reach pg, pinned by a counting-store test); tier-2 ('global' on all 10 policies) hits `${name}:ip:${ip}` plus `${name}:acct:${id}` for ip+account and FAILS OPEN on a store error (the 429 throw sits OUTSIDE the try so a real tier-2 reject is never swallowed; single-process tier-2 can never reject when tier-1 allowed, so nothing changes until multi-realm); store injected via the setRateLimitTier2Store slot in ratelimit.ts, wired at boot in main.ts (createPgRateLimitStore({ pool }), registration only, import-inert). Coded 429s throw HttpError carrying rateLimit429Headers (NEW in errors.ts): Retry-After + RateLimit "name";r;t + RateLimit-Policy "name";q;w, pinned to draft-ietf-httpapi-ratelimit-headers-11 (NON-FINAL draft, on purpose) / RFC 9651; params.retryAfterSeconds is now the ACCURATE per-request resetSeconds (was the constant 60). One knownDeviation rateLimit429Draft11Headers on the 9 mounted coded-429 routes (ALL already path-masked by rateLimitedBodyToCode/newLimiter*, so no new masking, no re-pins). STALE PACKET PREMISES corrected: DISCORD_SCHEMA was already wired (PR #1075), recordSlidingWindowAttempt is private, POLICIES lives in the middleware, and no respond429 / legacy X-RateLimit trio ever existed (the emission was CREATED). Maintainer forks resolved parity-preserving: spin keeps NO limiter, the fused budget UNSPLIT, DISCORD/PUBLIC_READ policies stay UNMOUNTED, and the auth/github/desktop-login legacy limiter facts were NOT promoted into the resolver (the packet's named fork, open for a maintainer decision). Reviews: privacy-security-review 0 BLOCKING / 1 SHOULD-FIX (the boot prune, FIXED; all 7 checks pass incl. every flipped call site verified non-inverted), migration-safety 0/0 (2 INFO comments applied), qa-checklist READY 0/0 (2 NITs applied incl. the stale types.ts comment [comment-only, contract untouched]; 2 low VERIFYs: the non-final draft grammar [no consumer until Phase 22, 'new'-mode only] and live-pg e2e deferred to the unit convention). Validation: tsc 0, full npm test 706/7943+11skip, build:server 0, ci:changed 0, dash scan clean. Phase 19 QA gate (phase-19-qa.md) DONE (2026-07-02): PASS, apply-all, zero BLOCKING. Three SHOULD-FIX fixed (UPSERT CASE/GREATEST logic literal-pinned in tests [the constant-vs-constant assertion moved both sides together]; BIGINT-as-string window_start driven through Number() [string-typed test row]; the triplicated outcome formula extracted to the exported pure windowedRateLimitOutcome in ratelimit.ts, consumed by slidingWindowOutcome + rateLimitedPerfReport + PgRateLimitStore.hit). Nits applied: tier2 'none' documented as the deliberate opt-out seam; mergeTier2 deleted in favor of the exported mergeFusedOutcomes; the tier-2 fail-open console.error throttled to once per WINDOW_MS on the injected clock (+ resetTier2ErrorLogThrottle, test-only); empty-RETURNING-row pinned to reject; RecordingRateLimitStore rename (shadowed the different shared fake); the admin allowedRateLimit stub typed from the real bundle. Deferral: the orphaned shared FakeRateLimitStore helper's delete-or-keep goes to the Phase 25 teardown. Fix commits 39b610eb/fbe7be29/c368e50f/1a1fb08d; re-validation tsc 0, full npm test 706/7947+11skip, all builds green, fresh post-fix qa-checklist READY 0/0. Phase 20 followed (see the paragraph above).

Phase 18b (migrate the late-arrival families: github, desktop-login, daily-rewards) DONE (2026-07-02). All TWELVE release-merge routes now SERVE FROM THE SHARED DISPATCHERS under API_DISPATCH 'new' with every legacy arm retained as the flag-off rollback path + delegate (removed Phase 25): the github family x4 (route layer on server/github.ts, the discord template: callback meta.envelope 'html', createActiveGuard + the legacy-order rate guards incl. start's usage metric; NO isIpBlocked added, ground truth has none), the desktop-login pair (NEW SIBLING module server/desktop_login_routes.ts so desktop_login.ts stays db-import-free; the FUSED register/login per-IP budget stays ONE bucket limiter-before-auth, parity-pinned), and both daily-rewards families (route layer on server/daily_rewards.ts; the player trio behind createActiveGuard with a LAZY guard bundle [game.ts imports the module]; the ops trio behind the NEW requireInternalSecretFailClosed gate [401 on unset env AND mismatch, per-request read, shared timingSafeEqual, no fallback secret]; ALL handlers call the ladder sub-dispatchers UNCHANGED, so parity is by construction; the /internal composite ordering untouched). BOTH forks maintainer-confirmed as recommended: the create SCOPE FIX landed on BOTH serving paths (handleDesktopLoginCreate restructured to the post-auth issueDesktopLoginCode core, deps drop bearerToken/accountForToken; legacy arm bearerActiveAccount, RouteDef createActiveGuard; read tokens now 403 where they escalated to a full session; deviation desktopLoginCreateFullScope) and spin keeps NO limiter (Phase 19 owns the decision). Five knownDeviations (introducedInPhase 18, prose names 18b; four are the bare-return HANG-counterfactual *BodyValidationRemap class). Harness: completeness MIGRATED_ROUTES +9 + the internal derivation 11 -> 14 with the ops delegate-only pins FLIPPED to registered; ownership_coverage third gate pair (per-gate unset-env body fork: daily-reward 401 vs the others' 404) + the NEW /api auth-mounting sweep (7 authed 18b routes + negative control); parity +19 dual-path pins (incl. the fused-budget one-bucket 429, the ops gate-pass mark-payout 400, wrong-method/no-slash/HEAD delegation, the callback 503 HTML); +17 backfilled characterization goldens; 3 NEW route-layer suites (github 24 / desktop_login 17 / daily_rewards_routes 30); the surface_inventory create row flipped bearer -> full. Reviews: privacy-security-review 0/0 (all seven critical points confirmed; 1 INFO = the Phase 25 ops pre-path-gate handoff, recorded on dailyRewardsOpsBodyValidationRemap), qa-checklist READY 0/0/2-NICE-both-applied (payout-history re-pin + the player wrong-method pin). Validation: tsc 0, full npm test 704/7905+11skip, build:server + client build green, ci:changed 0, dash scan clean. Phase 18b QA gate (phase-18b-qa.md) DONE (2026-07-02): PASS, apply-all. Five parallel auditors (correctness, test-coverage, dead-code, privacy-security-review 0/0 all six areas CLEAN, qa-checklist READY 0/0/2-INFO); all 9 acceptance criteria MET, no stopping rule tripped, both fork outcomes verified as shipped. Zero BLOCKING; TWO SHOULD-FIX fixed (both test/docs-only): the security.test.ts rewrite had deleted the tree's only coverage of the shared createActiveGuard ACCOUNT-NULL branch (well-formed bearer, resolver returns null), replaced by a desktop_login.test.ts route-layer test asserting the resolver ran exactly once; and this file's drift-audit clause claiming the daily-rewards player counterfactual was an outer-catch 500 was corrected to the ground-truth HANG class (the prefix arm is a bare return inside handleApi's try). NICE applied per apply-all: the github start unconfigured 503 route-layer test, the create unexpected-throw 500 boundary test, the phase doc's stale handleDesktopLoginCreate mention rewritten, and the github callback's non-GET arm named in the Phase 25 carve-out (wrong-method delegates to the ladder terminal 404 today, flips to the table 405 at the deletion, the systemic planned405BeforeAuth framing) + a dedicated captureBothModes wrong-method pin. Adjudicated NO-CHANGE: a legacy-arm read-scope 403 end-to-end test (correct by construction via the shared bearerActiveAccount; the arm retires at P25). Re-validation GREEN: tsc 0, full npm test 704/7911+11skip (+4), ci:changed 0, build:server + client build green, dash scan clean. NEXT: Phase 19 (two-tier rate limiter, phase-19-rate-limiter.md).

Drift audit (2026-07-02, maintainer-requested) DONE, inserting Phase 18b: a six-track audit of the packet + API surface against the post-v0.19.0-merge tree found TWELVE routes with no owning migration phase (github family x4, v0.18.0 merge; desktop-login x2 + daily-rewards player x3 + /internal/daily-rewards ops x3, v0.19.0 merges), six of them (all daily-rewards) also invisible to the frozen SURFACE_INVENTORY and every corpus-derived gate (the freshness gate scanned only the four dispatcher files; the /api arms hide behind main.ts's startsWith('/api/daily-rewards') prefix delegate). LANDED WITH THE AUDIT (test/docs only, no server behavior change): the 6 missing rows (player trio authScope 'full' via the ladder's bearerActiveAccount, limiter null; ops trio POST x3 under the NEW AUTH_SCOPE 'secret-daily-reward' documenting the fail-closed x-woc-daily-reward-secret gate) + 3 API_CONTENT_TYPE entries + server/daily_rewards.ts added to the freshness gate's DISPATCHER_SOURCES (blind spot CLOSED: the gate now reds on unfiled routes in prefix-delegated sub-dispatcher modules) + completeness.test.ts deriving legacy-served paths from main.ts AND daily_rewards.ts with the ops family excluded from the Phase 18 internal pins and its three REAL paths pinned delegate-only (inventory 114 -> 120 rows; affected suites green). NEW PHASE DOCS: phase-18b-late-arrivals.md + phase-18b-qa.md own migrating all 12 routes parity-first (github mirrors the Phase 16 discord template incl. the html callback envelope; desktop-login keeps the FUSED register/login per-IP budget and carries the phase's REQUIRED maintainer fork: create resolves its bearer via the scope-blind accountForToken while exchange mints a full-scope token, so a read-scope token escalates to a full session, and the recommended fix [createActiveGuard semantics on create, landed on BOTH serving paths] needs adjudication + a knownDeviation; daily-rewards player trio gets createActiveGuard byte-parity + a dailyRewardsBodyValidationRemap deviation [legacy counterfactual: a request HANG, the prefix arm is a bare return inside handleApi's try; this clause originally guessed outer-catch 500 pre-implementation and was corrected at the 18b QA gate], no withBody anywhere, spin keeps NO limiter; the ops trio needs a FAIL-CLOSED variant of requireInternalSecret [401 on unset env AND mismatch, never the 404 feature-off, never a RESTART_COUNTDOWN_SECRET fallback] and its hang-counterfactual deviation sibling of internalBodyValidationRemap; the composite-delegate ordering stays untouched and load-bearing). 18b MUST land before Phase 25 (the ladder deletion would drop all 12 routes) and SHOULD land before Phase 19 (limiter decisions homeless otherwise). Release-merge DIVERGENCE audit CLEAN: no unmirrored change to any migrated route's legacy arm (turnstile secret re-bound at the configureAuthRuntime injection site; web-login-guard + CORS desktop origins are shared-core by construction), no deleted/renamed endpoints. Client/i18n: desktop-login prose fully matched (errors.api.desktopCodeInvalid); the daily-rewards prose family deliberately unmatched (the client DISCARDS those bodies: online.ts raw fetches + the generic hudChrome.dailyRewards.error card) and 'this token is read-only' unmatched anywhere, both recorded as Phase 22 adjudications in its doc; NO translation work (strings fill at release). Forward docs updated: README (18b row + four-dispatcher framing), implementation-plan (18b row + deletion precondition), qa-checklist (route-family coverage box, fused-budget box, four-ladder flag-off box, i18n additions), phase-19 (shared-budget constraint + spin fork), phase-21 (delegate-served 415/Origin carve-out), phase-22 (premise shift: the waves shipped parity-first PROSE, so 22 owns coded emission; the four known adjudications), phase-24 (all-of-server env sweep + per-request secret carve-outs), phase-25 (18b precondition, four-entry flip, exit-criteria carve-outs, route-family stop rule). Next: Phase 18b (docs/api-pipeline/phase-18b-late-arrivals.md), then Phase 19.

Phase 18 (migrate OAuth JSON + Internal, server/oauth.ts + server/internal.ts) DONE (2026-07-02). The migration-wave bookend: the two remaining non-/api sub-dispatchers now SERVE FROM THEIR OWN FLAG-GATED DISPATCHERS under API_DISPATCH 'new'. main.ts gained oauthApiEntry (delegate = legacy handleOAuth UNCHANGED) and internalApiEntry (delegate = the EXACT pre-Phase-18 composite: handleDailyRewardInternalApi tried first for /internal/daily-rewards/*, then handleInternalApi bound to the live game), both createApiDispatcher over the SAME apiRegistry (disjoint first segments); setApiDispatchMode flips ALL FOUR entries (api, admin, oauth, internal). Legacy ladders KEPT intact for flag-off rollback (removed Phase 25). SCOPE CORRECTION vs the phase doc: /internal is ELEVEN routes not nine (the doc predates GET /internal/discord/daily-rewards-winners + POST .../mark, both already in the frozen SURFACE_INVENTORY); the whole family migrated per the Phase 16 no-half-migrated-family precedent, and the separate /internal/daily-rewards/* ops family (its own x-woc-daily-reward-secret gate, never part of handleInternalApi) stays entirely delegate-served. KEY DECISIONS (PARITY-FIRST, the canonical rule wins over the phase file's mapError-replaces-oauthError / HttpError-reason-mapping / 405-knownDeviation language): (1) OAUTH: 5 RouteDefs in server/oauth.ts (authorize/token/revoke/device_authorization/device, all POST, surface 'oauth' + meta.envelope 'oauth', NO middleware); thin handlers call the EXISTING private cores UNCHANGED (self-read via readForm, web-session auth via the in-handler fullSessionAccount full-scope+unlocked resolver, NEVER requireAccount and never the API bearer gate), so every body keeps the legacy RFC 6749 {error[,error_description]} prose byte-for-byte; revoke stays always-200 {ok:true}. The GET consent/device HTML pages are NOT registered: a GET resolves methodNotAllowed and DELEGATES to the legacy ladder which renders them (completeness pins the off-the-table assertion; parity pins both pages byte-identical). (2) INTERNAL: 11 RouteDefs in server/internal.ts (surface 'internal' + meta.envelope 'admin': the internal fail() envelope IS the admin {success,data,error} shape and EnvelopeKind is the frozen Phase 2 contract, so NO new envelope member); handlers REPRODUCE the frozen legacy branches byte-for-byte calling the same imported cores DIRECTLY (no eager import bundle, so the lazy-db-bundle partial-mock hazard never arises); game.startRestartCountdown injected via configureInternalRuntime (InternalRuntime = Pick<GameServer,'startRestartCountdown'> + resetInternalRuntimeForTests). (3) NEW server/http/middleware/require_internal_secret.ts: requireInternalSecret({header,envVar}) with the named single-source-of-truth pairs (DEPLOY_SECRET_HEADER 'x-woc-deploy-secret' / DEPLOY_SECRET_ENV 'RESTART_COUNTDOWN_SECRET' on restart-countdown; DISCORD_SECRET_HEADER 'x-woc-discord-secret' / DISCORD_SECRET_ENV 'DISCORD_BOT_SECRET' on every discord route); reads the env PER REQUEST, writes the LEGACY bodies via json() directly (feature-off 404 'unknown endpoint' on empty/unset env, 401 'not authenticated' on mismatch, short-circuit no-next), length-guarded timingSafeEqual (mirrors internal.ts secretsMatch), never logs/echoes a secret. (4) restart-countdown wrong-method stays 404 never 405 WITHOUT a deviation: a non-POST resolves methodNotAllowed and the Phase 9 dispatcher DELEGATES it (pinned old-vs-new WITH the correct secret, proving method-driven); HEAD delegates per the standing rule. knownDeviations ADDED (introducedInPhase 18): `oauthBodyValidationRemap` (an unexpected throw serializes via withErrors/serializeOauth as 500 {error:'server_error',error_description:'An unexpected error occurred.'} + X-Request-Id vs the legacy module-local catch's bare {error:'server_error'}; additive members, same status + RFC 6749 code) and `internalBodyValidationRemap` (legacy handleInternalApi has NO outer catch: an unexpected throw became an unhandled rejection in main.ts's fire-and-forget arm, logged by the keep-alive handler, NO response written, request HUNG; the new path answers the admin-shape 500 {success:false,data:null,error:'internal.error'} + X-Request-Id, strictly a reliability improvement, flag-gated). Both throw-only/secret-gated, invisible to the db-free corpus, pinned with fakes in the new test files. TEST HARNESS: completeness.test.ts Phase 18 block derives BOTH expected sets FROM the SURFACE_INVENTORY ladders (5 oauth POST registered exactly + the 2 GET HTML pages resolve methodNotAllowed [off the table] + the 11 internal routes registered exactly + envelope pins + /internal/daily-rewards stays notFound/delegate-only; the /api registers-exactly filter now also excludes /oauth + /internal). ownership_coverage.test.ts gained the INTERNAL SECRET-GATE MOUNTING SWEEP (the Phase 17 QA mandate realized for the next authed surface: requireInternalSecret carries NO meta marker, so the functional sweep is the only deny-by-default guarantee; every internal route driven twice through its real chain, env-unset -> feature-off 404 + wrong-secret -> 401, handler never called, + an ungated-synthetic negative control). parity.test.ts gained '/oauth dispatch parity' (11 pins: the 5 db-free POST contracts incl. unsupported_grant_type / invalid_request / access_denied x2 / always-200 revoke / invalid_client, wrong-method + HEAD + unknown-path delegation, both GET HTML pages byte-identical through the delegate) and '/internal dispatch parity' (10 pins under per-test env pinning [captureWithEnv]: both gates' 404/401, wrong-method-with-CORRECT-secret 404, TWO REAL AUTHED 200s through the migrated gate+handler chain [presence {received:true} + members-meta {updated:0}, both db-free], unknown-discord-subpath gate-then-404, HEAD-to-GET delegation, and the outside-both-families composite fallthrough 404); the stale SKIP note rewritten (oauth/internal now IN scope, only db-touching bodies deferred). CHARACTERIZATION BACKFILL: the two daily-rewards-winners routes predate the Phase 3 goldens, so their 4 gate fixtures (secret_unset_404 + no_secret_401 each) were added to the DISCORD_ROUTES loops (write-if-absent froze the legacy contract). NO error_codes append (serializeOauth's RFC 6749 map + internal.error pre-exist; Phase 22 owns coded emission), NO S3/i18n change (RFC 6749 codes are protocol tokens, /internal is bot-facing; nothing feeds userFacingApiError), NO DDL/JSONB (oauth_db/discord_db only consumed), NO src/sim, NO WS wire. Pre-existing em dashes in oauth.ts (header comment + consent/device-page copy) left untouched per the phase doc's deferred copy sweep; no added line carries one. New tests: tests/server/oauth.test.ts (20: registration shape, both grants incl. a full PKCE exchange asserting the 64-hex read-scope token, revoke idempotence, the web-session gate [no-bearer/read-scope/locked all 401 legacy prose, full+unlocked 200], device_authorization RFC 8628 fields + normalized user-code store, the remap-500 pin, the frozen RFC 6749 envelope, registry boundary), tests/server/internal.test.ts (handler-level pins for all 11 branches behind a passing gate incl. clamps/truncations/dedupe-keys/tier math/drain enrichment/winners-limit clamp + the remap-500 pin + representative gate cases), tests/server/http/require_internal_secret.test.ts (13: feature-off/mismatch/match, the length guard proven no-throw, per-request env read, constants pinned, no-secret-echo). Orchestration: 3 parallel Explore readers (spine/harness/domain, ground-truth verified FIRST: the 9-route premise was stale, the 405 concern was moot under delegation, the Phase 7 envelope contract tests already existed) -> lead-implemented the coupled core myself (middleware + both route layers + registry + main.ts + deviations + the 4 harness edits) -> 3 parallel test-authoring agents on INDEPENDENT new files -> 2 parallel reviewers, apply-all. Validation GREEN: tsc 0; full npm test 701 files / 7781 pass / 11 skip; build:server 0; ci:changed exit 0 (pre-existing noExplicitAny warnings only); perl -CSD dash/emoji scan over all added lines clean. Reviewers: privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 8 checks CLEAN: timing-safe compare byte-equivalent, correct (header,env) gate pairing on all 11 routes with short-circuit-before-handler in both modes, no secret/bearer logged or serialized incl. both 500 paths, no auth widening on the consent POSTs, all 11 internal branches byte-identical outside the 2 documented deviations, daily-rewards ops + HTML pages delegate-served untouched, no new SQL, no CORS widening; INFO only). qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX (all 9 acceptance criteria MET; both amendments independently adjudicated CORRECT [11-vs-9 route scope; delegation-not-deviation wrong-method 404]; full stableStringify byte + header identity confirmed on every non-throw path incl. no X-Request-Id on the gate responses; adversarial pass found nothing missing; 1 standing VERIFY = the live db-touching success paths under flag 'new' remain the whole migration's structural deferral until the Phase 25 flip; the NICE doc-count nit applied). migration-safety correctly SKIPPED (no DDL/JSONB), cross-platform-sync + architecture-reviewer SKIPPED (no src/sim, no wire, no client matcher). Committed-not-pushed (shared worktree). Phase 18 QA gate (phase-18-qa.md) DONE (2026-07-02): PASS. Five parallel auditors (correctness, test-coverage, dead-code, privacy-security-review, qa-checklist READY) + the full CI-mirror gate. Zero BLOCKING; ONE SHOULD-FIX (correctness), FIXED: the Phase-25 off-table handoff was unrecorded (at the ladder deletion the dispatcher serves methodNotAllowed itself, regressing GET /oauth/authorize + GET /oauth/device from real HTML pages to 405s and swapping restart-countdown's anti-enumeration wrong-method 404 for a path-revealing 405; planned405BeforeAuth covers neither), so a new knownDeviation `oauthInternalOffTable405` (introducedInPhase 18) directs Phase 25 to migrate the two GET pages onto RouteDefs (meta.envelope 'html') or retain a delegate, and to decide the restart-countdown wrong-method shape deliberately. Per apply-all, every NICE-TO-HAVE applied (test/docs only, zero production change): +4 oauth tests (the approveAuthorize happy path 200 { redirect } carrying the SAME 64-hex single-use code createAuthCode persisted plus the state echo; the approved-device_code completion issuing the read-scope token via consumeDeviceCode; the two missing consent-gate cross pins, read-scope-on-device 401 + locked-on-authorize 401, so every rejection branch is proven on BOTH consent POSTs) and +1 parity pin (the composite delegate ORDERING: a /internal/daily-rewards/* request with the ops env secret unset answers that family's fail-CLOSED 401, never the ladder's terminal 404, identical old-vs-new). Adjudicated NO-CHANGE with rationale: the secretsMatch triplication stays (a shared home must be a THIRD module because internal.ts imports the middleware, the internal.ts copy retires with the ladder at Phase 25, and the frozen-ladder rule forbids touching the legacy copies now); InternalSecretGate stays exported (it types the exported factory's param). MAINTENANCE RULE until Phase 25: the internal RouteDef handlers REPRODUCE (not call) their frozen ladder branches, so any /internal behavior edit must land in BOTH the ladder branch and its RouteDef twin (both copies test-pinned; a one-sided edit fails the dual-path parity pins). Coverage fiction-audit CLEAN (the fakes drive the REAL compose/withErrors/serializer stack; captureBothModes flips the REAL API_DISPATCH through routeHttpRequest); security re-review CLEAN on every check. Re-validation GREEN: tsc 0; full npm test 701 files / 7786 pass / 11 skip (+5); ci:changed 0; build:server 0; build:env + client build 0. Next: Phase 19 (two-tier rate limiter, phase-19-*.md).

Phase 17 (migrate Admin API, server/admin.ts) DONE (2026-07-01). The heaviest migration phase: ALL 32 handleAdminApi branches (login + 12 authed POST writes + the enum route + 18 GET reads) now SERVE FROM A NEW FLAG-GATED ADMIN DISPATCHER under API_DISPATCH 'new'. main.ts routes /admin/api through its OWN dispatcher `adminApiEntry` (createApiDispatcher over the SAME apiRegistry, admin paths are a disjoint '/admin' first segment so they never collide with /api) whose DELEGATE is the legacy handleAdminApi (bound to the live game); an unmatched admin path (unknown endpoint, wrong method, HEAD) delegates to handleAdminApi UNCHANGED. `setApiDispatchMode` flips BOTH apiEntry and adminApiEntry. Legacy handleAdminApi ladder KEPT intact for flag-off rollback (removed Phase 25). registry.ts spreads `...adminRoutes`. KEY DECISION (PARITY-FIRST, the canonical rule wins over the phase file's coded / operator-403-denial / isolated-limiter-store language, all Phase-22/19 end-state): the migrated thin handlers REPRODUCE each legacy branch's logic (calling adminDb().* + useAdminRuntime().*, byte-identical) and write the SAME { success, data, error } admin envelope. (1) Envelope FROZEN by a contract test (success / error / data:{ok:true} variants); every RouteDef carries surface 'admin' + meta.envelope 'admin' so an UNEXPECTED throw serializes through withErrors' serializeAdmin as 500 { ...error:'internal.error' } (the adminBodyValidationRemap deviation vs the legacy outer-catch 500 { ...error:'internal error' } - same status + shape, only the error STRING differs). (2) AUTH = NEW server/http/middleware/require_admin.ts `createRequireAdmin(getDb)`, mirroring the legacy adminAccountId(req) resolver EXACTLY (bearer -> accountForToken -> isAdminAccount, uniform 401 { ...error:'admin authentication required' }, NO read-only-scope 403 and NO moderation gate - legacy admin auth applied neither); mounted on every route except login. It runs BEFORE the :id/:action decode, so an unauthenticated malformed request 401s exactly as legacy did (auth precedes route/method). (3) admin.login is ANONYMOUS (no requireAdmin) with its own in-handler rateLimited(req, ADMIN_LOGIN_MAX_PER_MINUTE) - the legacy shared-store call, isolated from the new POLICIES table (rate_limit.ts); its OWN isolated limiter STORE is the Phase 19 two-tier end-state, parity-first keeps the legacy call. (4) ENUM RESTRUCTURE: the legacy regex /moderation/accounts/:id/(suspend|unsuspend|ban|unban) (rejected by the Phase 4 no-regex guard) becomes /moderation/accounts/:id/:action with a schema enum_(['suspend','unsuspend','ban','unban']); the literal sibling routes (reactivate/chat-mute/lift-mute/note/reset-strikes, 5 literal segments) sort most-specific-first AHEAD of :action (4 literals), so each resolves to its own handler (verified via createApiRegistry.resolve); an action outside the four decodes to 422 (adminEnumInvalid422). (5) the 12 admin :id routes carry an OPERATOR-scoped loader `requireAdminTarget` (require_admin.ts): decodes :id with num({int,min:1}) -> 422 on a non-numeric/non-positive id (adminIdParamDecode, sibling of characterIdParamDecode) and marks `meta.requireOwned.ownerScope:'operator'` which EXCLUDES the route from the account-owner deny-by-default clause (checkRequireOwnedCoverage already exempts operator + admin-surface :id routes). PARITY-FIRST FORK on the "403 denial": the operator loader authorizes NO cross-scope object and emits NO per-object 403/404 - the admin operator has UNIVERSAL authority over every target (an admin moderates any account), so requireAdmin's 401 IS the operator gate and the handlers keep their own legacy 404 'account not found' byte-for-byte; the phase doc's "cross-scope/absent denial 403" has no parity-faithful trigger on today's admin surface (it is the seam for a future finer operator sub-scope). (6) game.* side effects preserved via configureAdminRuntime (AdminRuntime = Pick<GameServer, adminStats|liveSessions|suspiciousPlayers|isIpBlocked|liveSharedIps|liveAccountIds|disconnectAccount|muteAccountChat|liftChatMuteLive|resetChatStrikesLive|reloadChatFilter|reloadBlockedIps|disconnectByIp>, so main.ts passes the live game directly); the DB reads/writes bundled behind setAdminDbForTests, built LAZILY (makeRealAdminDb is a FUNCTION + ReturnType type + memoized adminDb() accessor, NOT a module-load literal) so a legacy-only test that partial-mocks an admin *_db module (tests/admin.test.ts mocks moderation_db without addAccountNote) still imports cleanly ([[lazy-db-bundle-vs-partial-mock]]). page/limit pagination PRESERVED via the existing LENIENT parsePageParams (page/limit, NOT page/pageSize; DEFAULT_PAGE_LIMIT + MAX_PAGE_LIMIT reused; a bad page DEFAULTS never 422, per the Phase 10 lenient-decoder lesson: a strict schema decode would break parity). knownDeviations ADDED (introducedInPhase 17): `adminEnumInvalid422`, `adminIdParamDecode`, `adminBodyValidationRemap` - all AUTH-GATED / harness-invisible (an unauthenticated request 401s before the decode on both paths, and a real throw is needed for the 500-remap), documented not corpus-tested. TEST HARNESS: ownership_coverage.test.ts's Phase-17 forward guard FLIPPED into a real operator-scope deny-by-default sweep (every operator :id route: a non-admin bearer 401s via requireAdmin + a NaN :id 422s via requireAdminTarget, both before the handler; 2 negative controls); completeness.test.ts gained a Phase-17 admin block deriving the expected admin route set FROM the SURFACE_INVENTORY admin ladder (enum row rewritten to :action) asserting registers-exactly + no-dropped-branch + the literal-vs-:action specificity; parity.test.ts gained a /admin/api dual-path block (8 DB-free admin cases byte-identical old-vs-new: the 401 gate on a read/write/enum route/wrong method/unknown endpoint + the login db-free 401). surface_inventory.ts UNCHANGED (the legacy ladder + its inline regexes are frozen, freshness gate passes). NO error_codes append (Phase 22), NO S3/i18n change (the admin envelope strings are the legacy prose kept for parity; the admin dashboard SPA i18n untouched), NO DDL/JSONB change (all admin *_db + db.ts SCHEMA unchanged; NO defined-but-unwired schema surfaced), NO src/sim, NO WS wire. New file: tests/server/admin.test.ts (43 tests via fakeCtx + setAdminDbForTests + configureAdminRuntime + a compose()-driven runRoute threading withErrors). Orchestration (ultracode): a discovery Workflow (4 parallel readers over main.ts threading / admin *_db + game.* signatures / parity+deviations+inventory / state+progress docs) + direct ground-truth reads of the router/registry/schema/errors/compose core -> lead-implemented the coupled core myself (seam + all 32 routes + registry + main.ts dispatcher + deviations + the 5 harness edits, too interdependent to parallelize on the shared server/admin.ts + shared harness files, per the prior-phase clobber lesson) -> 2 parallel reviewers, apply-all. Validation GREEN: tsc 0; full npm test 681 files / 7427 pass / 11 skip (was 680 / 7342; +1 file, +85 tests); the no-regex guard + BOLA coverage + parity all green; build:server 0; ci:changed exit 0 (pre-existing noExplicitAny warnings only, format-clean on the changed files); perl -CSD dash/emoji scan over all added lines clean. Reviewers (the two this diff's surface warrants): privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 8 checks CLEAN high-confidence: is_admin gate un-bypassable, no SQL/stack/PII leak in any 4xx/500 incl. the adminBodyValidationRemap 500 [serializeAdmin emits only the stable code, never app.params, so the invalid id/action value is not echoed], operator loader NaN-safe + no cross-scope read, IP-block/moderation server-authority + guards preserved, admin-login limiter isolated, emailSecurityIncident isolated, parameterized SQL, no dev-command/secret exposure; 2 NICE = pre-existing legacy behaviors preserved byte-for-byte, Phase 22 owns the coded rework - the resumed-via-SendMessage verdict, the plain reviewer Agent TRUNCATED mid-investigation, same gotcha as Phase 15/16); qa-checklist READY 0 BLOCKING / 1 SHOULD-FIX (SF-1 a PRE-EXISTING em dash at admin.ts:68, now in a touched file so the pre-push copy-scan could snag it - FIXED to a period) / 2 NICE (SF-2 the docs describe the shipped no-403 behavior [done]; N-1 the systemic X-Request-Id header the withErrors path adds on the 422/500 admin paths, consistent with every Phase 10-16 surface, auth-gated, NOT a Phase 17 defect - documented on the adminBodyValidationRemap deviation). qa-checklist INDEPENDENTLY confirmed the operator-403 fork is "a defensible reading, not a gap, high confidence: met-as-amended, the amendment is the correct call" (a 403 on an absent account would BREAK parity: legacy 404s it). Apply-all done. migration-safety correctly SKIPPED (no *_db DDL/schema/JSONB change), cross-platform-sync + architecture-reviewer SKIPPED (no src/sim, no wire, no client matcher). Committed-not-pushed (shared worktree). Phase 17 QA gate (phase-17-qa.md) DONE (2026-07-01): PASS, 0 BLOCKING / 0 SHOULD-FIX surviving in production code; all 11 acceptance criteria MET or MET-AS-AMENDED against the real diff, both amendments re-adjudicated and SIGNED OFF (the operator no-403 fork is the correct parity-preserving call - legacy 404s an absent account, a 403 would break byte-parity, the exclusion is enforced by checkRequireOwnedCoverage plus the functional sweep; the login limiter's legacy shared store is byte-parity, the isolated store is Phase 19). privacy-security-review all 8 checks CLEAN (1 INFO documented on adminIdParamDecode: num() accepts trimmed decimal integer spellings "+5"/"5.0"/" 5 " where legacy (\d+) 404-fell-through, harmless under universal operator authority). Correctness: all 32 handlers byte-identical to their frozen legacy branches, no divergence outside the three seeded deviations, HEAD delegation + rollback + enum specificity verified. Per apply-all, EVERY finding applied (test/docs only, zero production behavior change): a NEW admin auth-mounting sweep in ownership_coverage.test.ts (every non-login admin route 401s an unauthenticated request before the handler + a negative control; requireAdmin carries no metadata marker, so the functional sweep is the only deny-by-default guarantee for the non-:id admin routes), 27 new handler-level tests in tests/server/admin.test.ts (43 -> 70; the 15 previously-untested handlers incl. perf/raw keyset hasMore math, both shared-ips branches, chat-filter/config's config-object body + reload, and the emailSecurityIncident mail NOW ACTUALLY ASSERTED by flushing the floating promise: trimmed reason / 'not specified' / 'permanent' / expiresAt-as-until / no-target no-mail), ADMIN_TARGET_ID made module-local, the adminIdParamDecode prose widened, the POST-write miscount fixed (12 not 13). The authed-parity deferral stays structural (pool-less, as characterization defers); the handler-level pins are the compensating control until the Phase 25 flip. Re-validation GREEN: tsc 0, touched suites 200/200, ci:changed 0, build:server 0, full CI mirror green. Next: Phase 18 (OAuth JSON + Internal, oauth.ts + internal.ts). [v0.22.0 SLICE UPDATE 2026-07-05: the auth model described in (2) is SUPERSEDED, both arms: createRequireAdmin now mirrors adminIdentity(req) (bearer -> accountForToken -> staff_db.adminRolesForAccount fail-closed) plus the central ADMIN_ROUTE_PERMISSIONS gate (403/404/405 pre-decode, from the concrete request path); the (4) out-of-enum 422 and the (5) non-numeric-id 422 are unreachable behind that gate (adminEnumInvalid422 superseded, adminIdParamDecode narrowed to the degenerate digit-string class); the admin surface counts 46 RouteDefs after the 8 staff/antibot/CAPI routes. See the v0.22.0 release-merge slice.]

Phase 16 (migrate Discord family, server/discord.ts, net-new since SPEC) DONE (2026-07-01). All SEVEN Discord endpoints now SERVE FROM THE NEW DISPATCHER under API_DISPATCH 'new' (7 RouteDefs in `server/discord.ts` `export const routes`: POST /api/auth/discord/start, GET /api/auth/discord/callback [HTML bounce], POST /api/auth/discord/login/new, POST /api/auth/discord/login/link, GET /api/discord [status], DELETE /api/discord [unlink], POST /api/discord/swag/claim [previously ORPHANED, now reachable]); legacy handleApi arms KEPT for flag-off rollback (removed Phase 25). registry.ts spreads `...discordRoutes`; main.ts grew only a configureDiscordRuntime boot call + import. THE SPEC PREMISE WAS STALE (predates PR #1044/#1075): I verified ground truth FIRST and the maintainer resolved two forks. (Fork 1: route scope) the family is SEVEN routes not the packet's five - PR #1075 added login/new + login/link (the first-login create-new/link-existing chooser), which ALREADY carry isIpBlocked - so the maintainer chose MIGRATE ALL SEVEN (a fully-migrated server/discord.ts, no half-migrated family). (Fork 2: DDL) DISCORD_SCHEMA is ALREADY WIRED into ensureSchema (server/db.ts, under the advisory lock) with a guard test (tests/schema_wiring.test.ts) since PR #1075, so the packet's "wire the unwired DISCORD_SCHEMA + add a runtime boot-time table-existence assertion" premise is void; the maintainer chose "do what is best for the project", so NO new runtime boot assertion (a boot-behavior change with no remaining justification now the regression is test-guarded) and the persistence deliverable is completed with an idempotent-DDL re-run test instead. KEY DECISION (PARITY-FIRST PROSE, the canonical rule wins over the phase file's coded discord.*-codes / turnstile-on-start / mounted-DISCORD_POLICY language, all Phase-22 end-state): the thin Ctx handlers reuse the existing handleDiscord* functions UNCHANGED, so every body is byte-identical - (1) the rate limit stays legacy prose {error:'rate limited'} (NOT the coded rateLimit(DISCORD_POLICY) adapter; the pre-seeded DISCORD_POLICY in rate_limit.ts stays UNMOUNTED until Phase 22, because the Discord keying is entangled with handler logic: start resolves an account only in link mode, four handlers self-limit internally); start drops the legacy double-count to a single count on the new path; status/unlink carry a discordActiveRateGuard (the check the legacy arm ran in main.ts, moved behind the auth guard, byte-identical prose); swag self-limits inside handleSwagClaim (no rate guard, no double-count). (2) auth on status/unlink/swag is the shared legacy-body createActiveGuard (401 {error:'not authenticated'} DB-free, 403 read-only, 403 moderation), NOT problem+json requireAccount; start resolves the account inline via resolveActiveAccount (a ~8-line mirror of createActiveGuard, since the guard cannot be a plain route middleware on a route that also serves an unauthenticated login mode; a candidate for the Phase 22/25 shared bearer-resolver consolidation). (3) NO error_codes.ts append (Phase 22 owns coded emission + the comprehensive per-surface parity guard + the apiError.* catalog). SECURITY: CLOSED the isIpBlocked gap the PR #1044/#1075 reviews flagged (a moderation-IP-blocked client could mint a Discord account/session) - isIpBlocked applied on start (opaque 429 {error:'rate limited'}, matching login/new+link) and callback (an OPAQUE HTML bounce reusing the existing 'server_error' vocabulary, so the block is never revealed and the callback stays HTML); login/new+link already carried it. passesTurnstile DELIBERATELY NOT added (the Discord flow carries no turnstile token, so a gate would 403 EVERY prod Discord login; the OAuth itself is the human-check, matching login/new+link). CALLBACK stays HTML never problem+json: the RouteDef carries meta.envelope 'html' so an escaping throw serializes through the Phase 7/8 boundary (dispatch.ts threads meta.envelope into withErrors -> mapError -> serializeHtml) as HTML, not problem+json (which would break window.opener.postMessage); pinned by a contract test that drives a real escaping throw. SWAG un-orphaned with a live grantCosmetic hook: configureDiscordRuntime injects (accountId, chromaId) => game.grantMechChromaToAccount(...), a NEW public GameServer method mirroring the private session-scoped noteAccountMechChroma (persist via grantAccountMechChroma + updateLiveAccountCosmetics; account-scoped so no cross-account grant; best-effort live push, no-op offline). CLIENT: the discordRateLimited {error:'rate limited'} gap is closed with ONE userFacingApiError arm (src/main.ts) resolving 'rate limited' -> t('errors.api.tooManyAttempts') (an EXISTING key: no new key, no M16 non-Latin fills, S3 stays green); swag has no client caller (the widget shows a badge but never POSTs), so its reachability is the deliverable. knownDeviations: enriched the pre-seeded `newLimiterDiscord` (start single-count + the isIpBlocked opaque gate on start/callback + the deliberate turnstile omission + a prod-irrelevant cfg-null-AND-drained 503-vs-429 ordering note) and `swagClaimOrphanUnreachable` (realized: swag is now router-owned ONLY, no legacy arm ever existed, served on the new path only until Phase 25); enriched the by-design `discordCallbackHtmlNotRedirect` (the RouteDef pins meta.envelope 'html'); ADDED `discordBodyValidationRemap` (introducedInPhase 16, all 7 routes: an unexpected handler/DB throw surfaces as 500 problem+json [JSON routes] or 500 HTML [callback] via withErrors vs the legacy outer-catch 500 {error:'internal error'} - same 500 STATUS, different body shape, NO 400/413 remap since readJsonBody SWALLOWS a bad body to {}; sibling to accountBodyValidationRemap/walletBodyValidationRemap/reportsBodyValidationRemap). `newLimiterDiscord` path-masks all 4 discord corpus fixtures (start-503, status-401, unlink-401, callback-bounce-503), so each is re-pinned by a dedicated captureBothModes assertion in parity.test.ts (the head-parity-gotcha); the discord bucket reset was already in isolate()/isolatePass. completeness.test.ts MIGRATED_ROUTES +7 (method-aware, /api/discord twice GET+DELETE), and the swag orphan is SKIPPED from the must-be-legacy-served assertion (router-owned only; its own 'excludes the documented unreachable swag-claim orphan' test pins the SURFACE_INVENTORY unreachable flag). NO error_codes append, NO S3 change, NO DDL change (schema already wired), NO JSONB shape change, NO src/sim, NO WS wire, NO IWorld/matcher-logic change. New tests: tests/server/discord.test.ts (26) via fakeCtx + setDiscordDbForTests + configureDiscordRuntime + the ratelimit reset/clock seams + a compose()-driven runRoute threading withErrors({surface: route.meta?.envelope}); route wiring via apiRegistry.resolve; the guard 401/403 DB-free; the discordActiveRateGuard 429 behind the auth guard; start isIpBlocked/503/link-mode-401; the callback HTML contract incl. an ESCAPING-THROW -> 500 text/html (never problem+json); swag reachability to its in-handler self-limit; the useRuntime null 500. Orchestration: direct ground-truth verification FIRST (the schema was already wired, the family was 7 not 5, DISCORD_POLICY was pre-seeded, turnstile-on-start would break prod) -> asked the maintainer the two forks -> lead-implemented the coupled core myself (discord.ts route layer + guards + inline resolver + runtime + game.ts grant method + registry + main.ts boot + deviations + completeness + 4 parity re-pins + client matcher, too interdependent to parallelize on the shared files) -> 1 parallel test-authoring agent (discord.test.ts) + 3 parallel reviewers, apply-all. Reviewers (the three this diff's surface warrants): privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 11 checks PASS: auth-guard parity byte-identical, isIpBlocked opaque + placed right, turnstile omission defensible, unlink + swag caller-scoped [no IDOR], grantCosmetic grants only to the caller's own account, rate-limit behind auth + no start double-count, callback never problem+json verified end-to-end, no secret/PII/SQL/determinism regression, deviation coverage complete; 3 NICE/INFO no-action - the resumed-via-SendMessage verdict, since the plain reviewer Agent TRUNCATED mid-investigation, the same gotcha as Phase 15); migration-safety 0 BLOCKING / 1 WARNING (a PRE-EXISTING non-atomic accounts.cosmetics read-modify-write in grantAccountMechChroma, shared by noteAccountMechChroma/markAccountQuestComplete, which Phase 16 newly REACHES from the swag route but does NOT introduce - deferred with note, since fixing a shared db fn used by 3+ callers is a behavior change beyond a route migration and swag has no client caller today) / 2 INFO (applied); qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX (all 9 acceptance criteria PASS + all gates green; 4 NICE). cross-platform-sync + architecture-reviewer correctly NOT dispatched (no IWorld/wire/sim_i18n/server_i18n matcher, no src/sim; src/main.ts touches only the client REST-error matcher, outside the trigger set). Apply-all: 3 in-scope test/comment nits APPLIED (the callback escaping-throw contract test; the schema_wiring toEqual harness-determinism clarification; the six-tables comment); the migration-safety pre-existing WARNING + the swag-no-matcher + userFacingApiError-untestable + isIpBlocked-latent-until-Phase-25 items DEFERRED-with-note. Validation GREEN: tsc 0; full npm test 680 files / 7321 pass / 11 skip (was 679 / 7291; +1 file, +30 tests); build:server 0; build 0; ci:changed exit 0 (only pre-existing noExplicitAny/noNonNullAssertion warnings in unrelated lines); parity byte-identical old-vs-new (13 cases, +4 discord re-pins); perl -CSD dash/emoji scan over all added lines clean. Committed-not-pushed (shared worktree). Phase 16 QA gate (phase-16-qa.md) DONE (2026-07-01): PASS, 0 BLOCKING / 0 SHOULD-FIX surviving verification. Independent 6-track audit (a Workflow running correctness / test-coverage / dead-code / an adversarial completeness critic with a per-finding 3-lens adversarial-verify stage, plus privacy-security-review + migration-safety as free-text Agents; cross-platform-sync correctly SKIPPED, src/main.ts touches only the client REST matcher): all 10 acceptance criteria met or met-as-amended under the two maintainer forks + parity-first prose; privacy-security 0/0 (2 INFO), migration-safety 0/0 (3 INFO, prior deferrals re-confirmed, NOT widened). ORCHESTRATION GOTCHA: the Workflow verify stage hit the session usage limit mid-run, so 11 findings landed 'killed' with ZERO cast votes (the survives-filter treats an all-failed vote set as refuted); they were NOT dropped - the orchestrator hand-verified each against the code (all real coverage/doc gaps, none behavioral). Apply-all APPLIED every confirmed finding (test/comment/prose only, zero production behavior change; commits 9832a1f8 test(server) + 6f877c5b fix(main)): (1) the dispatcher meta.envelope threading pin (dispatch.test.ts drives an html-enveloped route's throw through the REAL createApiDispatcher -> 500 text/html, with the problem+json throw test as the un-enveloped control; AC2 had been mirror-deep, dispatch.ts's withErrors({surface: route.meta?.envelope}) untested tree-wide); (2) chooser-route chain coverage (discord.test.ts: login/new + login/link blocked-IP 429 [pins the useRuntime().isIpBlocked glue] + drained-bucket 429, db-free) + 2 NEW parity captureBothModes re-pins (drained-bucket 429 byte-identical old-vs-new; the chooser routes had NO corpus fixture and are masked by newLimiterDiscord); (3) the start single-count drop pinned by TEST not just prose (20 unconfigured starts record ZERO limiter attempts; drained+unconfigured answers 503 never 429); (4) resolveActiveAccount read-only 403 + moderation 403 (untested new code) + the link-mode auth-BEFORE-IP-gate ordering (no-bearer + blocked IP -> the ordinary 401, never 429; authed + blocked -> opaque 429); (5) discordRateLimited dual-keying (ip key alone and account key alone each trip; the account drain arrives via an X-Forwarded-For foreign ip, which the loopback-trusted-proxy requestIp resolves); (6) the swag SUCCESS path (discord_server.test.ts: grantCosmetic invoked once with the CATALOG grantId 'vanguard_azure', spend parameterized [1,1000]; a title-kind claim does NOT invoke the grant) + the unlink DELETE asserted bound to the guard-resolved account id; (7) GameServer.grantMechChromaToAccount tests (game_sessions.test.ts: persists + pushes to the live session; offline persists, no-op push); (8) a rate_limit_copy.test.ts text pin on the new userFacingApiError 'rate limited' arm (silent-removal guard until the Phase 11 matcher extraction); (9) the schema_wiring idempotency regexes made case-insensitive; (10) the newLimiterDiscord prose corrected (the 503-vs-429 reorder applies to BOTH start modes, not login-only) + the link-mode resolve-before-IP-gate ordering documented; (11) the stale src/main.ts choice-panel comment (made false by this very phase) rewritten. DEFERRED-with-note (not dropped): authed 200-path coverage for status/unlink through the migrated chain (needs a pg-mock + route-chain hybrid harness; the 200 bodies are pinned in discord_server.test.ts against the SAME shared handlers, the chain glue by the guard/limiter/swag-reached tests; the Phase 25 flag flip is the live E2E); the callback isIpBlocked 403-vs-500 status distinguisher (privacy-security INFO, low confidence; body opacity preserved, matches the ratified opaque-server_error decision); the swag durability seam (transactional point spend but best-effort grantCosmetic, non-recoverable via the idempotent 409 re-claim - PRE-EXISTING pattern, latent, no client caller; a conscious durability decision when a caller lands, filed by migration-safety); the pre-existing grantAccountMechChroma RMW deferral re-confirmed (Phase 16 adds a writer path, does not widen the window). Re-validation GREEN: tsc 0; full npm test 680 files / 7342 pass / 11 skip (was 7321 at impl, +21 QA coverage tests); the 10 affected suites 178 green; build:server 0; build 0; ci:changed 0 (pre-existing warnings only); parity 15 cases (+2 chooser re-pins); perl -CSD dash/emoji scan clean. Next: Phase 17 (migrate Admin API, server/admin.ts, phase-17-*.md).

Phase 15 (migrate reports + telemetry + misc, server/reports.ts) DONE (2026-07-01). The four leftover write/telemetry endpoints now SERVE FROM THE NEW DISPATCHER under API_DISPATCH 'new' (4 RouteDefs in `server/reports.ts` `export const routes`: POST /api/reports + POST /api/bug-reports [account-gated writes], POST /api/perf-report + POST /api/site-presence [public telemetry beacons]); legacy handleApi arms KEPT for flag-off rollback (removed Phase 25). registry.ts spreads `...reportsRoutes`; main.ts grew only a configureReportsRuntime boot call + import (rollback-retention, NOT a shrink; the doc's "it shrank" is the Phase-25 end-state). The migrated-domain set now includes reports/telemetry; the codes these routes would emit are NOT wired (parity-first prose, localized client-side in Phase 22, not yet). KEY DECISION (the fork the maintainer resolved to PARITY-FIRST PROSE, and state.md wins over the phase file per the canonical rule): the phase-15 doc uniformly asked for CODED problem+json errors (requireAccount, HttpError codes, append reports.*/bug_report.*/perf_report.*/site_presence.* codes), but that is the Phase-22 end-state (same trap as Phase 11 to 14) - the client prose-matcher (src/main.ts userFacingApiError) + the hud.ts/options-window report/bug matchers key on the EXACT legacy prose until Phase 22, and the reports_post_noauth_401 golden pins {error:'not authenticated'}, so coded emission would break live localization + parity. So: (1) the migrated handlers write the SAME legacy {error}/{ok} bodies byte-for-byte; (2) auth is the shared legacy-body activeGuard (NOT requireAccount); (3) NO error_codes.ts append (the reports.create 429 reuses the pre-existing rate_limit.exceeded). The activeGuard was EXTRACTED (rule-of-three: the Phase 14 review said "do NOT add a 4th copy in Phase 15+; extract when the next domain needs the guard"): NEW `server/http/middleware/bearer_active_guard.ts` exports `createActiveGuard(getDb)` (+ NOT_AUTHENTICATED/READ_ONLY_TOKEN/bearerToken/BearerActiveGuardDb), reports.ts consumes it via `createActiveGuard(() => reportsDb)` + setReportsDbForTests; the three existing inline copies (wallet/characters/account) are NOT retrofitted (that touches shipped byte-parity-pinned surfaces carrying sibling readGuard/logoutGuard, so it stays the dedicated Phase 22/25 step) - the extraction adds NO 4th copy. All four handlers SELF-READ their body (no withBody): reports at the 64 KB default; bug-reports at a 1 MB cap (BUG_REPORT_MAX_BODY_BYTES, named) with its OWN try/catch preserving 413 {error:'bug report too large'} / 400 {error:'bad request'} byte-identically + its handler-level BugReportRateLimitError -> 429 (NOT re-implemented); perf-report/site-presence self-read inside handlePerfReport/handleSitePresenceHeartbeat (unchanged). NEW reports.create limiter (server/ratelimit.ts reportsCreateRateLimited, fused ip+account, REPORTS_CREATE_MAX_PER_MINUTE = 10 over the shared 60s WINDOW_MS, mirroring cardUpload) as a rateLimit(REPORTS_CREATE_POLICY) middleware mounted AFTER activeGuard (fail-closed: ctxAccountId 500s without ctx.account, and an unauth request 401s at the guard before the limiter), throwing coded 429 rate_limit.exceeded. TELEMETRY 405 ownership CORRECTION vs the doc: perf-report's 405 {ok:false} branch is DEAD CODE via the dispatcher (its legacy arm gates on POST, so GET falls to the 404 unknown-endpoint arm); only site-presence's 405 is live (URL-only legacy arm). Both routes are registered POST-only, so a non-POST resolves methodNotAllowed and the Phase 9 dispatcher DELEGATES it to the retained legacy ladder, preserving perf-report's 404 fall-through + site-presence's handler-owned 405 {ok:false,error:'method not allowed'} byte-identically (do NOT assert GET perf-report -> 405, that would be a behavior change). perf-report's 200-on-throttle (rateLimitedPerfReport / shouldStorePerfReport both 200, never 429) stays inside handlePerfReport unchanged; site-presence stays reachable independent of REQUIRE_WEB_LOGIN (no web-login guard; the prologue only gated register/login). knownDeviations: realized the pre-seeded `newLimiterReportsCreate` (introducedInPhase 15, /api/reports) + added `reportsBodyValidationRemap` (introducedInPhase 15, all 4 routes: the self-reading handlers surface an over-cap/malformed body throw or a rethrown non-rate-limit createBugReport error as 500 problem+json internal.error vs the legacy outer-catch 500 {error:'internal error'} - same 500 STATUS, different body shape, NO 400/413 remap since no withBody; sibling to accountBodyValidationRemap/walletBodyValidationRemap; not corpus-tested); NARROWED `validationStatusRemap` routes to ['/api/register'] (removed reports+bug-reports, which self-read so they get no 400/413 status remap - reports 500s, bug-reports keeps its own byte-identical 413/400 prose). Adding /api/reports + /api/site-presence to the ledger masks their paths in the path-scoped parity filter, so reports_post_noauth_401 is re-pinned by a NEW captureBothModes assertion (no-bearer 401 byte-identical) + site_presence_get_405 was already re-pinned (Phase 9 heartbeat test); the reports.create bucket is reset in isolatePass + isolate() for lockstep (harmless: the corpus request 401s before the limiter). completeness.test.ts MIGRATED_ROUTES +4 (method-aware POST). NO error_codes append, NO S3, NO DDL/JSONB, NO src/sim, NO WS wire, NO IWorld/matcher change. New tests: tests/server/reports.test.ts (24) + reports_telemetry.test.ts (9) via fakeCtx + setReportsDbForTests + configureReportsRuntime + the ratelimit reset/clock seams + a compose()-driven runRoute; the reports 401 golden replayed byte-for-byte; the limiter 429 + Retry-After; the composition-order proof (unauth -> 401 not 500/429); the perf/site methodNotAllowed resolution (NOT 405). Reviewers (the two the phase doc requires; migration-safety/cross-platform-sync/architecture-reviewer correctly SKIPPED): privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 8 security invariants PASS high-confidence; 2 INFO no-action), qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX (all 10 acceptance criteria verified; 1 NICE nit APPLIED: a malformed-bearer db-free 401 test). Orchestration: direct ground-truth verification FIRST (the doc's coded-error/requireAccount/append-codes wording was the Phase-22 end-state, perf-report GET is 404 not 405, bug-reports over-cap is already 413 so withBody would break it, the client already exact-matches the legacy prose) -> lead-implemented the coupled core myself (reports.ts + extracted guard + limiter + registry + main.ts boot + deviations + completeness + parity re-pin) -> 2 parallel test-authoring agents on INDEPENDENT files (writes / telemetry) + 2 parallel reviewers, apply-all. Validation GREEN: tsc 0; full npm test 679 files / 7288 pass / 11 skip (was 677 / 7255; +2 files, +33 tests); build:server 0; ci:changed exit 0 (only pre-existing noExplicitAny warnings); parity byte-identical old-vs-new; error_codes append-only green; perl -CSD dash/emoji scan over all added lines clean (the ratelimit.ts em dashes are pre-existing comments in untouched lines). Committed-not-pushed (shared worktree). Phase 15 QA gate (phase-15-qa.md) DONE (2026-07-01): PASS, 0 BLOCKING / 0 SHOULD-FIX. Independent 4-track audit (a Workflow running correctness/test-coverage/dead-code with per-finding adversarial verify + the two required reviewers privacy-security-review + qa-checklist as plain free-text Agents; migration-safety/cross-platform-sync/architecture-reviewer correctly SKIPPED): all 9 acceptance criteria PASS against the real code, both reviewers 0 BLOCKING / 0 SHOULD-FIX (createActiveGuard fails closed on every reject path, the fused ip+account reports.create limiter is post-guard with no cross-account leak, no IDOR + parameterized SQL, the bug-report 1 MB cap enforced mid-stream with the PR #811 screenshot allowlist + meta clamp intact). Six NICE surfaced; apply-all APPLIED the 3 in-scope coverage nits (commit ed5d3c00, test-only): (1) GET /api/perf-report -> 404 pinned by a NEW captureBothModes assertion (mask-aware: /api/perf-report is in 3 deviations so a plain corpus fixture would be filtered, so re-pin like site_presence_get_405 per the head-parity-gotcha [[api-pipeline-head-parity-gotcha]]); (2) a cleanReportReason allowlist-miss reports case (a present-but-invalid reason 400s 'choose a report reason', a branch the missing-reason {} case does not reach); (3) a site-presence web-login-proxy comment pointing at tests/web_login_guard.test.ts (the prologue is a main.ts concern outside the RouteDef). DEFERRED-with-note (not dropped) the 3 genuine future-phase/no-action items: the bug-report + site-presence per-route limiter gaps are PRE-EXISTING parity behavior = the Phase 19 two-tier rework, OUT OF SCOPE here (applying trips a STOPPING RULE); the guard's exported NOT_AUTHENTICATED/READ_ONLY_TOKEN/bearerToken are the contract-sanctioned Phase 22/25 transitional surface (leave-as-is per the finding). Re-validation GREEN (pre-merge mirror): tsc 0; full npm test 679 files / 7291 pass / 11 skip (was 7288 at impl, +2 QA tests); build:env 0; build:server 0; build 0; biome clean on the 3 changed test files; perl -CSD dash/emoji scan over added lines clean. Next: Phase 16 (migrate Discord family, server/discord.ts, phase-16-*.md).

Phase 14 (migrate wallet + cards, server/wallet.ts) DONE (2026-07-01). The wallet / card / referral surface now SERVES FROM THE NEW DISPATCHER under API_DISPATCH 'new' (7 RouteDefs in `server/wallet.ts` `export const routes`: POST /api/wallet/link/challenge, POST /api/wallet/link, DELETE /api/wallet/link, GET /api/wallet, GET /api/woc/balance [PUBLIC], POST /api/card [binary], GET /api/referrals); legacy handleApi arms KEPT for flag-off rollback (removed Phase 25). The route layer was APPENDED to server/wallet.ts (account.ts template); registry.ts spreads `...walletRoutes` into apiRoutes. KEY RECONCILIATIONS (parity-first, the doc mis-states the end-state, same trap as Phase 11/12/13): (1) auth is a per-route `activeGuard` mirroring bearerActiveAccount EXACTLY (401 {error:'not authenticated'} no/bad/unknown token DB-free-then-lookup, 403 {error:'this token is read-only'} read-only scope BEFORE the moderation read, 403 {error: status.message} moderation-locked), NOT the problem+json requireAccount; GET /api/woc/balance is PUBLIC (on-chain balances are public), carrying only rateLimit(WOC_BALANCE_POLICY), no auth guard (matching the legacy arm). (2) CARD IS NOT withRawBody + the response is JSON not binary (BOTH phase-doc mis-statements corrected): handleCardUpload SELF-READS the binary body via readBinaryBody (mid-stream cap intact) and returns JSON ({url,ref} success / {error} errors), so composing withRawBody would double-consume the stream (the account.ts self-read lesson); the pre-auth Content-Length 413 + Connection: close short-circuit is a dedicated `cardContentLengthGuard` mounted BEFORE activeGuard, reusing MAX_CARD_BYTES via cardUploadContentLengthTooLarge (no new literal). (3) ip+account ORDERING: the existing walletLinkRateLimited / cardUploadRateLimited are a SINGLE FUSED call recording BOTH the IP and account buckets (each call consumes a token, so double-calling double-counts), so they mount as ONE rateLimit(WALLET_LINK_POLICY / CARD_UPLOAD_POLICY) middleware AFTER activeGuard (ctx.account set, ctxAccountId 500s without it); there is NO separate pre-auth IP-only tier for wallet/card (the doc's "IP tier before body, account tier after auth" describes the Phase 8 canonical onion generally, but the fused limiter is post-auth by construction). The wallet challenge/link handlers SELF-LIMIT internally, so they were SPLIT: the legacy handleWalletChallenge/handleWalletLink keep their self-limiter (prose 429, rollback arm untouched) + call a NEW limiter-free walletChallengeCore/walletLinkCore that the new RouteDef calls after the coded-429 middleware, so the fused bucket records EXACTLY ONCE per request on either path. The one main.ts-local singleton (game.liveLevelForCharacter, for the card level) is INJECTED at boot via `configureWalletRuntime` (WalletGameHooks); the guard db reads (accountAndScopeForToken, moderationStatusForAccount) are bundled behind `setWalletDbForTests`; referrals + woc handlers keep their direct db.ts / woc_balance.ts imports. STABLE CODE: the four previously-raw {error:'rate limited'} 429s (wallet link challenge, wallet link, woc balance, card) now emit RFC 9457 problem+json code 'rate_limit.exceeded' (+ Retry-After) via rateLimit(policy) throwing HttpError(429,...); the code ALREADY existed (Phase 7 harvest, Phase 12 reuse) so NO error_codes append; the legacy prose arms are unchanged for rollback. THREE knownDeviations touched/added: `rateLimitedBodyToCode` (NEW, introducedInPhase 14, routes challenge/link/woc-balance/card: the 429 body-shape change; harness-invisible since runParity resets buckets per pass; also documents the provider_usage *.rate_limited telemetry drift on the new-path 429 [rateLimit throws before the handler] as observability-only + flag-gated + Phase 23) + `walletBodyValidationRemap` (NEW, introducedInPhase 14, routes challenge/link: the self-reading cores surface a malformed/over-cap/null body throw as 500 problem+json vs the legacy outer-catch 500 {error:'internal error'}, NO 400/413 remap since no withBody; the card route is EXCLUDED because handleCardUpload CATCHES its own readBinaryBody reject with a byte-identical 413/400; sibling to accountBodyValidationRemap). Adding /api/card to a deviation MASKS it in the PATH-scoped parity filter (the head-parity-gotcha), so the card pre-auth 413 + Connection: close AND the card no-auth 401 byte-identities are re-pinned by two dedicated captureBothModes assertions in parity.test.ts (the wallet-link/woc paths have no corpus fixture: they are db-hitting, skipped). completeness.test.ts MIGRATED_ROUTES extended +7 (43 total, method-aware, /api/wallet/link listed twice POST+DELETE). NO error_codes append, NO S3 change, NO DDL/JSONB, NO src/sim, NO WS wire, NO IWorld/matcher-logic change. New tests: tests/server/wallet.test.ts (12) + card_route.test.ts (5) + woc_referrals_route.test.ts (8) via fakeCtx + setWalletDbForTests + configureWalletRuntime + the ratelimit reset/clock seams + a compose()-driven runRoute; byte-identical golden pins (wallet_get_noauth_401, referrals_get_noauth_401, card_too_large_413), identity-based middleware assertions, non-vacuous drains, the drain-then-unauth-401 order proof. Reviewers (the two the phase doc requires; migration-safety/cross-platform-sync/architecture-reviewer correctly SKIPPED - no DDL-JSONB / IWorld-wire-matcher / src-sim): privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (all 6 security invariants PASS: auth-scope parity, fused ip+account limiter post-auth with no double-count, pre-auth 413 byte cap, server authority / no IDOR, coded-429 leak-free, parameterized SQL; 3 NICE), qa-checklist READY 0 BLOCKING (all 7 acceptance criteria verified from code + independent re-run; 2 SHOULD-FIX non-blocking + 1 NICE). Applied ALL findings (apply-all): (both, telemetry) documented the *.rate_limited / *.request metric drift in the rateLimitedBodyToCode deviation (generic middleware, so document not couple); (privacy-security) added walletBodyValidationRemap + a pinning test (POST /api/wallet/link/challenge '{ not valid json' -> 500 problem+json internal.error); (qa NICE) added the /api/card no-auth 401 captureBothModes re-pin. FILED FOLLOW-UP (both SHOULD-FIX, NOT extracted in-phase per both reviewers' explicit recommendation): the activeGuard is now the 3RD byte-identical bearerActiveAccount mirror (characters.ts + account.ts + wallet.ts) - rule-of-three fired; a shared db-seam-parameterized bearer-guard belongs in a dedicated packet step (alongside Phase 22/25), NOT this small migration (extracting would touch two shipped byte-parity-pinned surfaces that also carry sibling readGuard/logoutGuard); a code comment at server/wallet.ts activeGuard + progress.md record it; do NOT add a 4th copy in Phase 15+. Orchestration: direct ground-truth verification FIRST (the doc's withRawBody/binary-response/ip+account-split wording was all wrong against the code; handleCardUpload self-reads; the limiters are fused) -> lead-implemented the coupled core myself (wallet.ts route layer + core split + guards + card pre-auth guard + runtime + registry + main.ts boot + deviation + completeness + parity re-pin, too interdependent to parallelize on the shared files) -> 3 parallel test-authoring agents on INDEPENDENT files + 2 parallel reviewers, apply-all. Validation: tsc 0; full npm test 677 files / 7249 pass / 11 skip; build:server 0; ci:changed exit 0 (only pre-existing noExplicitAny warnings); parity byte-identical old-vs-new; error_codes append-only 9 green; perl -CSD dash/emoji scan over all changed files clean. Committed-not-pushed (shared worktree). Phase 14 QA gate (phase-14-qa.md) DONE (2026-07-01): PASS, 0 BLOCKING / 0 SHOULD-FIX. Independent 5-dimension audit (correctness / test-coverage / dead-code / privacy-security-review / qa-checklist) + per-finding adversarial verify: correctness PASS (13/13 acceptance criteria met, the 3 planning-doc mis-statements [withRawBody/binary card, two-tier IP limiter split, error_codes append] confirmed superseded by byte-parity deviations), dead-code PASS, privacy-security-review PASS (re-run FREE-TEXT after the Workflow's schema-forced privacy-security-review agent exhausted the StructuredOutput 5-retry cap and returned null; DURABLE ORCHESTRATION NOTE: a forced-schema Workflow agent on the specialized reviewer agentTypes can die on the retry cap, so re-run that reviewer as a plain Agent with free-text output), qa-checklist READY (findings are documented Phase 22/23/25 deferrals), test-coverage PASS-WITH-ISSUES. The lone SHOULD-FIX (DELETE /api/wallet/link had no route-chain behavioral test, only completeness RESOLUTION) adversarially downgraded to NICE (latent route under API_DISPATCH 'legacy'; shared activeGuard exhaustively tested through two other [activeGuard]-only chains; one-line delegation to the already-covered handleWalletUnlink; a missing-guard mis-wire fails CLOSED via ctxAccountId 500) but APPLIED anyway (apply-all): tests/server/wallet.test.ts +4 (DELETE /api/wallet/link no-auth 401 + authed 200 {unlinked:true} unlinking account 7; GET /api/wallet authed 200 {wallet:{pubkey,linkedAt}} + the null variant, via a per-file vi.mock of db.ts unlinkWallet/walletForAccount) and tests/server/card_route.test.ts +2 (card success 200 {url,ref} + 404 pass through the [cardContentLengthGuard, activeGuard, rateLimit] chain as application/json, pinning the JSON-not-binary correction on the 200/404 paths, via a vi.fn(actual.handleCardUpload) wrapper that keeps the real handler for the existing 400/429 drain). NICE deferrals recorded not dropped (throttle-path telemetry drift is documented in rateLimitedBodyToCode, owned by Phase 23; the rule-of-three bearer-guard extraction is a dedicated step near Phase 22/25). Re-validation GREEN: tsc 0; full npm test 677 files / 7255 pass / 11 skip (was 7249, +6 QA tests); build:server 0; ci:changed exit 0 (only pre-existing noExplicitAny warnings); the 6 Phase 14 suites + error_codes append-only 62 green; biome clean on the 2 changed test files; perl -CSD dash/emoji scan clean. Next: Phase 15 (migrate reports + telemetry + misc, server/reports.ts, phase-15-*.md).

Phase 13 (migrate account portal, server/account.ts + em-dash fix) DONE (2026-07-01). The account-portal surface now SERVES FROM THE NEW DISPATCHER under API_DISPATCH 'new' (16 RouteDefs in `server/account.ts` `export const routes`: GET /api/account, POST password/logout/email(410)/deactivate, companion-token POST/GET/DELETE, POST email/change, GET email/verify, POST export/marketing, POST 2fa/setup+enable+disable, GET /api/email/unsubscribe); legacy handleApi arms KEPT for flag-off rollback (removed Phase 25). The route layer was APPENDED to server/account.ts (the existing handleAccount* domain functions are UNCHANGED, still keeping their direct db.ts imports + the account_server.test.ts pg-mock coverage): thin Ctx handlers resolve the bearer + delegate to handleAccount* unchanged, so every ported body is byte-identical (RFC 9457 is Phase 22; the client prose-matcher keys on the legacy prose until then). PARITY-FIRST reconciliations (same trap as Phase 11/12, the doc mis-states the Phase-22 end-state as current): auth is per-route legacy-body guards NOT the problem+json requireAccount - `activeGuard` mirrors bearerActiveAccount EXACTLY (401 no-token DB-free, 403 read-only scope, 403 moderation-locked, in that order) and is on every authenticated route; `logoutGuard` mirrors the logout arm (ANY token that maps to an account via accountForToken, NO scope or moderation gate, so a banned/suspended/deactivated account can still sign out) and is on logout ONLY; the two token-in-query link routes (email/verify + email/unsubscribe) carry NO middleware (the unguessable token is the authorization) and read it via `ctx.url.searchParams.get('token') ?? ''` (byte-equivalent to the legacy new URL(req.url,...).searchParams.get). The companion-token method-agnostic legacy arm (which resolved bearerActiveAccount then fanned POST/GET/DELETE with NO top-level method guard) split into THREE method-specific RouteDefs, all under activeGuard; the moved companion handlers self-read the body + preserve the exact bodies ({token,label,scope:'read',expiresInDays:90} on create with ttl 24*90; {tokens} on list; {ok:true}|404 {error:'token not found'} on revoke). The account POST handlers SELF-READ their body (readBody INSIDE the domain fn), so NO withBody middleware is composed (that would double-consume the stream). Runtime: only deactivate needs the live game session, INJECTED at boot via `configureAccountRuntime` as the exact AccountGameHooks the legacy arm built inline (anyCharacterOnline / disconnectAccount); the bearer + companion-token db.ts reads are bundled behind `setAccountDbForTests`. EM-DASH FIX (labeled behavioral + lockstep cleanup): the four legacy handleApi 429 rate-limit strings in server/main.ts swapped U+2014 -> comma ('too many attempts, wait a minute and try again' / 'too many failed attempts, wait a few minutes and try again'), matching the Phase 11 migrated arms so both are now byte-identical; userFacingApiError (src/main.ts) UNCHANGED (its startsWith('too many attempts')/startsWith('too many failed attempts') prefixes sit BEFORE the comma, so resolution is neutral); no new error code; the former `authRateLimitDashToComma` known deviation is RETIRED (its DEVIATION_ID entry + KNOWN_DEVIATIONS entry removed, the two auth_routes.ts comments updated). The pre-existing COMMENT em dashes in server/main.ts + src/main.ts (the Phase 13 lockstep prior phases left untouched) were also cleaned, and the operator-facing em dashes in src/admin/i18n.locales/en_CA.ts swapped to commas + the resolved copy regenerated via `npm run i18n:admin` (never hand-edited); `grep -rnP "\x{2014}"` over server/main.ts + src/main.ts + src/admin/i18n.locales/en_CA.ts + src/admin/i18n.resolved.generated/en_CA.ts now prints nothing. /api/email/unsubscribe CLASSIFICATION RECONCILIATION: the planning label said HTML, but the live handler + its Phase 3 fixture emit JSON {ok:true}; followed the fixture (JSON serializer) - no HTML. TWO new knownDeviations (both introducedInPhase 13): `companionTokenMethodFan` (routes /api/account/companion-token: an unsupported method now 405 + Allow before auth, where the legacy arm 404'd after auth / 401'd unauth; sibling to planned405BeforeAuth; not corpus-tested) + `accountBodyValidationRemap` (the 8 self-reading account POST/DELETE body routes: a malformed/over-cap/null body throw surfaces as 500 problem+json via withErrors vs the legacy outer-catch 500 {error:'internal error'} - same 500 STATUS, different body shape, NO 400/413 remap since there is no withBody; not corpus-tested). completeness.test.ts MIGRATED_ROUTES extended +16 (36 total, method-aware, companion-token path listed 3x). NO error_codes append, NO S3 change, NO DDL/JSONB, NO src/sim, NO WS wire, NO IWorld/matcher-logic change. New tests: tests/server/account.test.ts (24: route-table wiring, activeGuard/logoutGuard, companion CRUD, the 405 method-fan via apiRegistry.resolve, the email link no-token fixtures, full-chain no-auth 401 goldens) + tests/server/rate_limit_copy.test.ts (5: the em-dash-free + matcher-safe source guard). Validation: tsc 0; full npm test 674 files / 7221 pass / 11 skip; build:env + build:server + build exit 0; check:admin 0/0; ci:changed exit 0; ASCII-clean (Stop-hook floor clean). In-phase reviewers (3 in parallel; cross-platform-sync/migration-safety/architecture-reviewer correctly SKIPPED - no IWorld/wire/matcher-logic, no DDL/JSONB, no src/sim): privacy-security-review 0 CRITICAL / 0 SHOULD-FIX (all 6 security decisions + parameterized-SQL/IDOR/logging PASS, 2 INFO by-design), qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX / 3 NICE, independent correctness reviewer 0 BLOCKING / 0 SHOULD-FIX (byte-parity-correct + matcher-safe, all 16 routes diffed) / 2 NICE. Applied ALL (apply-all): a deactivate full-chain test proving the injected AccountGameHooks fire through the handler + the useRuntime()-null throw + the passwordHandler/logoutHandler callerToken-null re-guards (+5 tests, via a per-file vi.mock spread of the deactivate-path db/auth/email reads); tightened companionTokenMethodFan wording (the dispatcher DELEGATES a methodNotAllowed resolve to the legacy ladder, so 405 is served only at Phase 25, same as planned405BeforeAuth); corrected accountBodyValidationRemap wording (companion create/revoke self-read in the route handler). KEY DURABLE (every remaining phase inherits): a NEW knownDeviation for a method-fan / body-validation divergence is REGISTRY-layer only until Phase 25 - the dispatcher delegates methodNotAllowed to legacy, so 405/framework-error divergences are latent (assert them via apiRegistry.resolve, not a served response). Orchestration: direct ground-truth verification FIRST (the doc's problem+json/requireAccount wording was the end-state, and server/account.ts had NO companion-token handlers - they lived inline in main.ts) -> lead-implemented the coupled core myself (route layer, guards, companion handlers, wiring, em-dash sweep, deviations, harness edits too interdependent to parallelize on the shared files) -> 3 parallel reviewers, apply-all. Committed-not-pushed (shared worktree). Phase 13 QA gate (phase-13-qa.md) DONE (2026-07-01): PASS-WITH-FOLLOWUPS, 0 BLOCKING / 0 SHOULD-FIX. Full matrix GREEN (tsc 0; full npm test 674 files / 7222 pass, 11 skip [was 7221; the accountBodyValidationRemap test is +1, the deactivate-email assertion strengthens an existing test]; build:env + build:server + build exit 0; check:admin 0/0; ci:changed exit 0; `npm run i18n:admin` regenerates the admin resolved copy IDENTICALLY [git clean, not hand-edited]; DASH SCAN: both `grep -rnP "\x{2014}"` [BSD grep has no -P] and a naive `perl -ne '/\x{2014}/'` [byte-scans a 3-byte UTF-8 em dash] are SILENT false-negatives - only `perl -CSD` is authoritative; it confirms server/main.ts + both admin en_CA files U+2014/U+2013-clean, and surfaced 7 PRE-EXISTING U+2014 in the server/account.ts handleAccount* comment banners [FIXED here, swapped to colons] plus a pre-existing U+2013 in a src/main.ts:4322 player placeholder [NOT fixed, out of Phase 13's rate-limit/comment scope]) plus an independent host parity re-check (all 16 migrated handlers byte-identical to the retained legacy arms; activeGuard/logoutGuard exact mirrors incl. order + DB-free short-circuits). Audit = a 5-dimension multi-agent audit (correctness / test-coverage / dead-code / privacy-security-review / qa-checklist) + a 2-lens adversarial verify over every finding: 6 raw -> 1 survivor; privacy-security-review + correctness both 0 BLOCKING / 0 SHOULD-FIX. Applied (apply-all): refreshed the stale server/account.ts module header (it still described the pre-migration 'no module-private seam / main.ts resolves the bearer once / four routes' shape); removed a new noUnusedImports warning on emailAccountDeleted by turning it into a real assertion that the deactivate flow emails the account (strengthens the deactivate success path end to end); added an accountBodyValidationRemap deviation test (POST /api/account/companion-token with a malformed body -> 500 application/problem+json internal.error, pinning it as companionTokenMethodFan already was). Deferred (refuted, low-value NICE): a companion-token golden cross-check (the random minted token precludes a byte-golden; the existing token-shape/label/scope/expiry unit assertions are the correct pin); per-adapter drive tests for the 6 pure forwarders whoami/setEmail/emailChange/export/marketing/2fa (type-distinct args make a swap a tsc error; ctxAccountId threading is already pinned by the deactivate + companion tests; the domain fns are covered by account_server.test.ts); a present-token forwarding assertion for unsubscribe (byte-identical to the already-pinned emailVerifyHandler). Next: Phase 14 (migrate wallet + cards, server/wallet.ts, phase-14-wallet.md).

Phase 12 (migrate character ownership + BOLA seam, server/characters.ts) DONE (2026-07-01). The owner-gated character surface now SERVES FROM THE NEW DISPATCHER under API_DISPATCH 'new' (8 routes: GET /api/me/characters, GET+POST /api/characters, GET :id/standing, GET :id/sheet[owner], POST :id/rename, POST :id/takeover, DELETE :id); legacy handleApi arms KEPT for flag-off rollback (removed Phase 25). NEW `server/http/middleware/require_owned.ts` = the generic `requireOwned(config)` load-then-authorize BOLA loader: runs AFTER the auth guard, reads ctx.account.accountId (a missing one = composition bug -> HttpError(500)), decodes ctx.params.id with num({int,min:1}) THROWING the decode failure (-> 422 validation.failed) BEFORE any DB call so a query never sees NaN, calls the account-scoped loader (db.getCharacter = id AND account_id AND realm), and on a HIT stashes the row at ctx.state[resource] + next(); on a MISS (cross-account OR absent, indistinguishable) emits a structured `bola_denied` deny-log (caller accountId + requested id + reqId, NEVER a cross-account existence signal) and writes the route's LEGACY 404 body, short-circuiting (no throw, no next). NEW `server/characters.ts` = the domain module: two per-route auth guards (activeGuard mirrors bearerActiveAccount full+read-only-403+moderation, readGuard mirrors bearerReadAccount read-OR-full+moderation, both write legacy {error} bodies), requireOwnedCharacter(notFoundBody) (the per-route 404 body DIFFERS: 'character not found' sheet/standing/rename vs 'not found' takeover/delete), the 4 character.* limiter middleware, 8 thin handlers, `export const routes`. db.ts reads bundled behind setCharactersDbForTests; 6 main.ts-local singletons (isCharacterOnline, takeOverCharacter, rekeyMarketSeller, saveMarket, initialCharacterState, publicOrigin) INJECTED at boot via configureCharactersRuntime (mirroring configureLeaderboardRuntime/configureAuthRuntime). KEY RECONCILIATIONS (parity-first, the doc mis-states the end-state as current, same trap as Phase 11): (1) the loader writes the LEGACY prose 404, NOT problem+json - the doc's '404 via HttpError with a stable code / stable-code i18n via problem+json' is the Phase-22 end-state; the 4 no-auth 401 goldens pin {error:'not authenticated'} byte-for-byte, so the guards are per-route legacy-body middleware NOT the problem+json requireAccount; (2) 'populates ctx.character' is realized as ctx.state.set('character', row) (Ctx is FROZEN with no per-resource field; ctx.state is the sanctioned slot); (3) num()->422 for a non-numeric :id: path_pattern CANNOT constrain :id to digits, so the new router matches /api/characters/abc/... where the legacy \d+ regex 404-fell-through; 422 is the doc's ask + NaN-safe + not fixture-pinned (documented, not a harness-observable divergence). Middleware order = cheap-reject-first with withBody BEFORE requireOwnedCharacter on rename+delete (mirrors legacy readBody-then-getCharacter, keeps the framework-error divergence uniform); the limiter is right after the auth guard. NEW server/ratelimit.ts characterMutationRateLimited (per-action ip+account buckets, CHARACTER_MUTATION_MAX_PER_MINUTE=20) + 4 policies in rate_limit.ts reusing rate_limit.exceeded (NO error_codes append, NO S3 change). TWO knownDeviations touch these routes: `newLimiterCharacterMutations` (pre-seeded Phase 3, realized here: a 429 where none was) + `bolaOwned404` (pre-seeded by-design: 404-not-403 for player-owned); plus a NEW `characterBodyValidationRemap` (introducedInPhase 12): the withBody POST/DELETE routes answer malformed 400 / over-cap 413 problem+json + coerce a null body vs the legacy readBody-reject/null-deref-to-500, AND (an ordering note both reviewers surfaced) rename checks ownership 404 before name validation so a non-owned + invalid-name = 404 vs legacy 400. Deny-by-default coverage: metadata (checkRequireOwnedCoverage over apiRoutes, already in completeness.test.ts; my :id routes carry meta.requireOwned {kind:'character',ownerScope:'account'}) + NEW FUNCTIONAL (ownership_coverage.test.ts drives every account-owned :id route with a null loader -> 404, >=5 non-vacuous + a synthetic-no-loader 200 negative control + a Phase-17 operator-scope-zero forward guard). completeness.test.ts MIGRATED_ROUTES is HARD-CODED, extended +8 (20 total, method-aware); parity.ts isolatePass resets the new limiter buckets; the surface_inventory :id match regexes already equal the main.ts regexes (rollback-arm test passes with legacy arms intact). NO error_codes append, NO S3, NO DDL/JSONB, NO src/sim, NO WS wire. Reviewers (the two the phase doc requires; migration-safety/cross-platform-sync/architecture-reviewer correctly SKIPPED): privacy-security-review 0 BLOCKING / 0 SHOULD-FIX / 3 NICE (all 6 checks PASS), qa-checklist READY 0 BLOCKING / 1 SHOULD-FIX / 2 NICE; BOTH independently surfaced the rename-ordering item; ALL findings applied (apply-all): the rename-ordering ledger note + unit assertion, the deny-log-volume tradeoff comment (Phase 23 injectable sink, NOT a read limiter), and 3 tests for the untested create-double-collision-409 + create/rename non-unique-rethrow-500 branches. Orchestration: direct ground-truth verification FIRST (the doc + Explore summary both had the problem+json/ctx.character/HttpError-404 mis-statements) -> lead-implemented the coupled core (loader + module + limiters + wiring + deviation + harness edits, too interdependent to parallelize on shared characters.ts) -> 3 parallel test-authoring agents on INDEPENDENT files + 2 parallel reviewers. Validation: tsc 0; full npm test 672 files / 7178 pass / 11 skip; build:env + build:server + build exit 0; ci:changed exit 0; no dash/emoji in any added line (the pre-existing main.ts em dashes are the Phase 13 lockstep, untouched). Committed-not-pushed (shared worktree). Phase 12 QA gate (phase-12-qa.md) DONE (2026-07-01): PASS, 0 BLOCKING. Workflow = 29 agents (8 finder dimensions: legacy-parity / BOLA-correctness / acceptance / test-coverage / cleanup / i18n-stable-code / deviations-ledger / docs-completeness, + privacy-security-review + qa-checklist + a completeness critic) with per-finding adversarial verification: 13 confirmed / 5 refuted (0 BLOCKING, 2 SHOULD-FIX, 11 NICE). BOLA-correctness dimension returned ZERO findings. ALL applied (apply-all): (SHOULD-FIX) a per-action limiter-independence test (fully throttle create -> a first delete still 200s, pinning the previously-unasserted `${action}:` bucket key) + owned-path rename invalid-name/offensive-name 400 tests (the moderation boundary, previously only tested on create); (NICE) create reclaim-retry edge tests (retry null -> 400, retry non-unique -> 500), skin-clamp + toSheetRank(null) coverage; a NEW `characterIdParamDecode` knownDeviation (introducedInPhase 12): the migrated :id routes reject a non-numeric OR non-positive :id 422 (authed) / 401 (guard-first, unauth) vs the legacy `\d+` 404 fall-through, harness-invisible (numeric-only corpus), sibling to characterBodyValidationRemap; a CLEANUP extract of the triplicated ctx-account-id 500 guard into one exported `ctxAccountId` in server/http/context.ts (used by characters.ts + require_owned.ts + rate_limit.ts, replacing 3 byte-identical copies, 2 added in Phase 12) + a `characterMutationPolicy(name, action)` factory collapsing the 4 identical CHARACTER_*_POLICY objects; and doc fixes (progress.md five->six runtime count; parity.test.ts local isolate() now resets the character-mutation buckets in lockstep with isolatePass). Refuted (5) include the `this token is read-only` matcher gap (pre-existing, preserved byte-for-byte, not a Phase 12 regression) and a parity-masking claim (old==new pinned transitively). Re-validation: tsc 0; full npm test 672 files / 7187 pass / 11 skip (+9 QA tests); build:server + build:env + build exit 0; ci:changed exit 0 (changed files clean); ASCII-clean. Next: Phase 13 (account portal + em-dash fix).

Phase 11 (migrate auth: register/login/native-attestation) DONE (2026-07-01). The CREDENTIAL surface now SERVES FROM THE NEW DISPATCHER under API_DISPATCH 'new' (3 POST routes: /api/register, /api/login, /api/native-attestation/challenge). The legacy handleApi arms STAY in main.ts as the flag-off rollback path (removed only in Phase 25). NEW module `server/auth_routes.ts` (NOT bolted onto the pure-leaf server/auth.ts, which stays crypto+validators only: a NEW sibling module like server/leaderboard.ts, avoiding an import cycle and honoring the pure/IO split) = 3 thin Ctx handlers + small per-route guard middleware + `export const routes` (registry.ts spreads it into apiRoutes alongside the Phase 10 leaderboard routes: `[...leaderboardRoutes, ...authRoutes]`). The db.ts/account.ts reads+writes + the register side-effects (emailAccountCreated/createSuspiciousRegistrationReport/captureReferral) are imported directly + bundled behind a test seam (setAuthDbForTests); the 3 main.ts-LOCAL singletons (game.isIpBlocked, passesTurnstile, requestMetadata) are INJECTED once at boot via configureAuthRuntime (mirroring configureLeaderboardRuntime). NEW `server/http/middleware/turnstile.ts` = a generic per-route POST-body anti-bot gate taking an injected verify (passesTurnstile wired in), run AFTER withBody, attached ONLY to register+login (NOT the challenge route); on failure it short-circuits with the legacy 403 {error:'verification failed, please try again'} body (it does NOT throw an HttpError, so the body shape stays legacy-identical and the client prose-matcher resolves it). KEY RECONCILIATION (parity-first, the Phase 10 durable pattern): the migrated handlers write the SAME legacy {error:'...'} / success bodies byte-for-byte via json(), NOT the RFC 9457 problem+json model. The phase doc's 'emit through the error model as a stable code (problem+json)' is the Phase-22 END-STATE; the phase doc's own OUT-OF-SCOPE ('the existing prose-matcher still resolves the migrated responses, parity preserved') is decisive and requires PROSE bodies now, since src/main.ts userFacingApiError keys on English prose and is NOT code-aware until Phase 22. The guard checks (origin, IP rate-limit, IP block) run IN small per-route middleware writing legacy bodies (NOT the generic rateLimit/requireAccount middleware, which would emit problem+json and change the body shape), exactly as Phase 10 kept publicReadRateLimited in-handler. Middleware order per route = the exact legacy check order, cheap-reject-first: register [webLoginGuard, ipRateLimitGuard, registerIpBlockGuard, withBody(), turnstile]; login [webLoginGuard, ipRateLimitGuard, withBody(), turnstile] with the IP block IN-HANDLER (after the account is known, with the isAdminAccount bypass, so an admin verified by password is never locked out); challenge [withBody()] only (NO gate: it is the pre-attestation step, matching the legacy top-of-ladder branch). authThrottled preserved as a HANDLER-level check (per-username, failed-only via recordAuthFailure, clears on success via clearAuthFailures, 15m/10-fail); the 2FA branch ({twoFactorRequired:true} 200 / 'invalid authentication code' 401 + recordAuthFailure) preserved exactly. TWO labeled knownDeviations (both introducedInPhase 11, tests/server/http/known_deviations.ts): (1) `authRateLimitDashToComma` - the legacy 429 rate-limit/IP-block bodies use an em dash; the ported handlers use a COMMA (the no-em-dash code invariant forbids a U+2014 literal in new code), matcher-safe because userFacingApiError keys on the 'too many attempts'/'too many failed attempts' PREFIX before the punctuation; Phase 13 aligns the legacy strings. (2) `authBodyValidationRemap` (routes /api/login + /api/native-attestation/challenge, added in QA per both reviewers) - on the new path withBody+withErrors answer malformed JSON 400 (json.malformed) / over-cap 413 (body.too_large) / unexpected 500 (internal.error) as problem+json, vs the legacy handleApi outer catch's 500 {error:'internal error'}; register's 400/413 remap is already tracked by validationStatusRemap; leak-free; NOT exercised by the db-free parity corpus (valid bodies only); Phase 22 wires the client code-matcher. CORRECTION (doc vs code): the phase doc's 'anti-enumeration 404' is WRONG - there is NO 404; the real anti-enumeration is register 409 (taken username)/login 401 (bad credentials), ALREADY the by-design registerLoginAntiEnumeration deviation, so no new anti-enum entry and 409/401 preserved byte-for-byte. NO error_codes.ts append (every code the routes would emit was harvested in Phase 7; the migrated bodies still emit legacy PROSE, codes wired to emission in Phase 22 -> NO S3 change), NO src/sim, NO WS wire, NO DDL/JSONB. completeness.test.ts's 'Phase 10 migrated baseline' became 'migrated baseline (Phase 10 public reads + Phase 11 auth)': the 12 migrated routes (9 GET + 3 POST) are all router-owned AND legacy-served (rollback-retention), METHOD-AWARE (the auth routes are POST, so the ownership check resolves by method). parity.test.ts unchanged (its register-400/login-401/challenge-200 corpus fixtures now exercise the new handlers and stay byte-identical; the challenge random challengeId/nonce are masked by the normalizer). 39 new unit tests + 1 QA-added (tests/server/auth.{register 14, login 16, attestation 10}.test.ts) via fakeCtx + setAuthDbForTests + configureAuthRuntime + the ratelimit reset seams + a compose()-driven runRoute for the guard chain. Reviewers (the two the phase doc requires): privacy-security-review REQUIRED 0 BLOCKING / 0 SHOULD-FIX (2 NICE + 3 INFO, all parity-preserved), qa-checklist READY 0 BLOCKING / 1 SHOULD-FIX (the authBodyValidationRemap ledger gap, now fixed) / 3 NICE; ALL findings applied (apply-all): the new authBodyValidationRemap deviation, the webLoginEnforced()-live comment, the symmetric login rate-limit onion test, and the validationStatusRemap-framing note. migration-safety/cross-platform-sync/architecture-reviewer NOT dispatched (no DDL/JSONB, no IWorld/wire/matcher, no src/sim). Validation: tsc clean; full npm test 650 files / 6913 pass / 11 skip; build:env + build:server + build exit 0; ci:changed exit 0; ASCII-clean (no dash/emoji in any added line; the pre-existing main.ts em dashes are the Phase 13 lockstep, untouched). Phase 11 QA gate (phase-11-qa.md) DONE (2026-07-01): PASS-WITH-FOLLOWUPS. Workflow = 1 Explore context-loader + 5 parallel auditors (correctness / test-coverage / dead-code / privacy-security-review / qa-checklist) + adversarial verify over EVERY finding: 13 raw -> 4 confirmed / 9 refuted (0 BLOCKING, 1 SHOULD-FIX, 3 NICE). Applied all 4 feasible (apply-all), 1 nit deferred as infeasible in-scope. (SHOULD-FIX) register/login middleware ORDER was pinned only by array LENGTH, so a turnstile-BEFORE-withBody reorder would ship green yet 403 every credential request in prod (Turnstile reads the unparsed empty body) = total auth outage; FIX = a functional order test in auth.register + auth.login: ctx.body left unset, only the streamed req carries the token, a body-dependent verifier (passesTurnstile = body.turnstileToken==='ok') must reach 200, which requires withBody to parse BEFORE Turnstile reads. (NICE) a literal JSON `null` body (valid JSON, NOT the malformed path, so authBodyValidationRemap does not cover it) diverges legacy-500 vs migrated-400/401/200 = documented as the NEW `authNullBodyCoercion` known deviation (introducedInPhase 11; `ctx.body ?? {}` coercion is strictly safer, no code change). (NICE) challenge action pass-through was only structurally asserted (createNativeAttestationChallenge unspied, action stored not echoed) = auth.attestation now vi.mocks native_attestation DELEGATING to the real impl and asserts the threaded action ('link' pass-through, non-string -> 'auth'). (NICE, DEFERRED) the 8 migrated auth body strings sit under no localization completeness guard (S3 scans only sim.ts + game.ts); a round-trip test needs userFacingApiError, which lives only in the DOM-coupled src/main.ts and is not Node-importable without extracting the matcher (out of Phase 11 scope; all 8 verified to resolve today) = FOLLOW-UP: extract userFacingApiError to a Node-testable module and pin the auth-string round-trip. Adversarially REFUTED (not fixed): the test-coverage parity-masking SHOULD-FIX (old==new is pinned TRANSITIVELY by byte-identical new-path unit assertions + legacy golden fixtures), the web-login live-read, the authThrottled clock-window + register no-db nits, and 3 privacy-security parity notes (enumeration timing / challenge no-rate-limit / turnstile-ordering-invariant, all reproduce legacy). QA fix scope 4 files (tests/server/http/known_deviations.ts + tests/server/auth.{register,login,attestation}.test.ts). Validation: tsc 0; vitest auth.{register,login,attestation} + known_deviations + completeness + parity 71 pass; localization_fixes (S3) 27 pass / 3 skip; ci:changed 0 (my files clean); build:server 0; ASCII-clean. Next: Phase 12 (migrate character ownership + BOLA seam, server/characters.ts, phase-12-characters.md).

Phase 10 (migrate public reads, server/leaderboard.ts) DONE (2026-06-30). The FIRST real domain migration: the anonymous public-read GET surface now SERVES FROM THE NEW DISPATCHER under API_DISPATCH 'new' (9 routes: /api/leaderboard incl. ?board=guilds + legacy ?limit=N + ?scope, /api/arena/leaderboard, /api/releases, /api/project-stats, /api/status, /api/perf [dev-gated], /api/search, /api/realms, /api/public/characters/:name/sheet). The legacy handleApi arms for all nine STAY in main.ts as the flag-off rollback path (removed only in Phase 25), so each migrated route is intentionally BOTH router-owned (flag 'new') and legacy-served (flag 'legacy'); the dual-path parity harness proves they are byte-identical except for the two labeled deviations. New `server/leaderboard.ts` = pure query decoders (lenient coerce-and-clamp with NAMED constants, mirroring the legacy `Number(x)||default` so a `?page=abc` still defaults rather than 422s: parity-clean) + pure response builders + host-agnostic read functions that each take a narrow Db interface (unit-tested via the Phase 2 FakeLeaderboardDb/FakeCharactersDb) + thin Ctx handlers + `export const routes` (registry.ts spreads it into `apiRoutes`). The main.ts leaderboard/releases CACHES are UNCHANGED (stay in main.ts); the handlers reach the live GameServer + the cache-fronted readers + publicOrigin/toSheetRank/GITHUB_REPO through a module-level `runtime` INJECTED once at boot via `configureLeaderboardRuntime` (registry.ts needs a static `routes` array, and importing main.ts directly would cycle: main -> registry -> leaderboard -> main). Two LABELED knownDeviations (tests/server/http/known_deviations.ts): (1) `status-name-list-trim` (pre-registered Phase 3): /api/status drops the online-player names[] list, counts only; (2) `realms-search-authz-gap-close` (new): /api/realms + /api/search now VALIDATE a present token (invalid -> 401 auth.token_invalid) via a new additive `optional` (anonymous-friendly) mode on requireAccount (server/http/middleware/require_account.ts: when true and NO Authorization header, next() runs with ctx.account undefined; a PRESENT header still fully validates), and search becomes anonymously readable (a missing token no longer 401s). CONVENTION B (the {items,page,pageCount,total,pageSize} envelope): DEFERRED - a src/net + src/ui consumer audit found every live client reads the `leaders` key (never `items`), so the existing paged shape is PRESERVED byte-for-byte and the envelope is deferred to net-new endpoints (Phase 25). ERROR-BODY parity: the ported 404/429 bodies stay the legacy `{error:...}` shape (RFC-9457-ification is Phase 22); the public sheet calls publicReadRateLimited IN-HANDLER (not the rateLimit middleware) so its 429 body shape is unchanged. The Phase 9 completeness "never double-serves" test was RECONCILED to a "rollback-retention" test (router-owned MUST still be legacy-served until Phase 25), and the parity "zero RAW divergences" assertion became "every raw divergence is a registered deviation + the deviations fire" (both were flagged "this-phase seed baseline" by the Phase 9 author). NO error_codes.ts append (auth.token_invalid reused), NO src/sim, NO WS wire, NO DDL/JSONB. POST-REVIEW HARDENING: /api/search (now anonymous) is ALSO rate-limited in-handler with publicReadRateLimited (the same per-IP budget the public sheet uses, 429 `{error:'rate limited'}`) - a privacy-security-review WARNING that the gap-close opened an unrate-limited anonymous DB-hitting name-enumeration surface. Validation: tsc clean; full npm test 640 files / 6812 pass / 11 skip; build:env + build:server + build exit 0; ci:changed exit 0; ASCII-clean. Reviewers: privacy-security-review REQUIRED (0 CRITICAL, 1 WARNING applied, 3 INFO by-design), port-faithfulness coverage (all 9 routes FAITHFUL, constants match), qa-checklist READY (0 BLOCKING / 0 SHOULD-FIX, 2 low NITs applied); migration-safety/cross-platform-sync/architecture-reviewer SKIPPED (no DDL/JSONB, no IWorld/wire/matcher, no src/sim). Phase 10 QA (phase-10-qa.md) DONE (2026-07-01): PASS, 0 BLOCKING / 0 SHOULD-FIX via a 4-dimension audit (correctness+dual-path parity / test-coverage / dead-code / privacy-security-review) with per-finding adversarial verification (2 findings refuted: the CORS-fixture-neutering claim was mode-independent-by-construction wrong; the anonymous-search note was already a PASS). Five verified NICE-TO-HAVE findings all applied (apply-all rule): (1) THE substantive one - a real UNDOCUMENTED HEAD parity break: registering the 9 GET routes made the dispatcher serve HEAD-as-GET (match.head ran the onion) under flag 'new' while the legacy ladder 404s HEAD; the parity filter is PATH-scoped so a known_deviations entry would mask real GET breaks, so the fix makes server/http/dispatch.ts DELEGATE a HEAD match to the legacy ladder (HEAD byte-identical 404 both paths; serving HEAD as GET is deferred to the Phase 25 flag flip), enforced by a dispatch.test.ts delegate case + a parity corpus HEAD case; (2) added an injectable dbReads seam (setLeaderboardDbForTests/resetLeaderboardDbForTests) + handler tests for the two always-DB-hitting handlers (arena, project-stats); (3) readPublicSheet second-404 + null-rank-200 branch tests; (4)+(5) made 6 read-fn Db interfaces + 5 scope/format constants module-private (unused exports) and single-sourced decodeScope/decodeArenaFormat returns. QA fix scope 5 files (server/http/dispatch.ts, server/leaderboard.ts, tests/server/http/{dispatch,parity}.test.ts, tests/server/leaderboard.test.ts). Validation: tsc clean; full npm test 644 files / 6859 pass / 11 skip; build:env + build:server + build exit 0; ci:changed exit 0; ASCII-clean. Next: Phase 11 (migrate auth: register/login/native-attestation, phase-11-auth.md).

Phase 08 (core middleware set + metric/log hook seam + thin rateLimit adapter) DONE (2026-06-30: eight importable-but-UNMOUNTED onion middleware primitives + one top-level handler; NOTHING is mounted in front of the live handleApi, the dispatch flag and routing are untouched, the WS wire and upgrade path are unchanged; Phase 9 mounts them). The canonical onion ORDER these compose into (Phase 9 wires it; no module hardcodes a position): withErrors (outermost) -> metric hook -> requestId+ALS -> withCors -> rateLimit('ip') -> withBody/withRawBody -> requireAccount -> rateLimit('ip+account') -> handler (cheap-reject-first: IP-keyed limits before body+DB, account-keyed after auth). New files: `server/http/middleware/with_errors.ts` (`withErrors(opts?: {surface?, onUnexpected?})`, the OUTERMOST frame + single response authority: catch -> mapError -> ONE idempotent respondOnce merging the SEPARATE contentType onto headers; does NOT rethrow; 500-no-leak preserved, original only to onUnexpected); `request_id.ts` (`withRequestId()` re-binds the Phase 5 reqId ALS via `runWithReqId(ctx.reqId || newReqId(), next)` so currentReqId() reads downstream even without runOnion; does NOT write the readonly ctx.reqId; no X-Request-Id echo, that is P23); `cors.ts` (`withCors('api'|'public', isAllowedOrigin?)`; 'api' reflects a REALM_ORIGINS/NATIVE_APP_ORIGINS member byte-identically to the live maybeCors, 'public' is the unconditional wildcard mirroring publicCors; headers set BEFORE next() so a mapped 4xx/429 still carries CORS); `metric_sink.ts` (injectable `MetricSink` + `noopMetricSink` default + `withMetrics(sink, route, now?)` recording {route=the :param TEMPLATE never a concrete path, method, status, durationMs}; inside withErrors and since withErrors does not rethrow, the throw-path status is derived via toAppError(err).status, a pure read so onUnexpected stays exactly-once; real logger + /metrics are P23); `body.ts` (`withBody(maxBytes?)` over readBody: over-cap -> HttpError(413, 'body.too_large', {maxBytes}), bad JSON -> HttpError(400, 'json.malformed'); JSON-only, NO 415 [P21]; the JSON cap is now the single-source `DEFAULT_JSON_BODY_MAX_BYTES` exported from server/http_util.ts and referenced by both readBody and withBody); `raw_body.ts` (`withRawBody(maxBytes)` over readBinaryBody: raw Buffer, NO JSON parse; a Content-Length over the cap rejects pre-read, a mid-stream overflow rejects at the reader's cap, both throw 413 with { Connection: 'close' } and set res.shouldKeepAlive=false, preserving the live card pre-auth short-circuit); `require_account.ts` (`requireAccount({scope:'read'|'active'|'full', lookupToken?, moderationStatus?})`, the ONE bearer resolver mirroring bearerActiveAccount/bearerReadAccount: 401 auth.token_missing / 401 auth.token_invalid (WWW-Authenticate via the P7 error model) / 403 auth.forbidden ('active' and 'full' require scopeAllowsMutation, 'read' accepts read|full) / 403 moderation.banned|suspended|suspended_until; sets ctx.account on success; the moderation/ban gate is applied UNIFORMLY for EVERY scope tier so no mounted route can skip the ban/suspension check, closing the Discord bearer-gap precedent; DB fns injected [deps-bag] for unit-test, defaulting to the real accountAndScopeForToken/moderationStatusForAccount; object-level requireOwned* BOLA loaders are P12); `rate_limit.ts` (`rateLimit(policy)`, a THIN adapter over the existing boolean limiters: `RateLimitPolicy = {name, keyClass:'ip'|'ip+account', limited(ctx), retryAfterSeconds}`, on a limit throws HttpError(429, 'rate_limit.exceeded', {retryAfterSeconds}); five named policies PUBLIC_READ/WOC_BALANCE/CARD_UPLOAD/WALLET_LINK/DISCORD, Retry-After coarse = WINDOW_MS/1000; 'ip+account' reads ctx.account via accountIdOf, fail-closed 500 if absent; NO ratelimit_db/RATELIMIT_SCHEMA/new limiter behavior, all P19); `server/http/client_error.ts` (`handleClientError(err, socket)` destroys an undestroyed socket, no req/res; registered once in server/main.ts startServer as `server.on('clientError', handleClientError)` right after http.createServer and before the noServer:true WebSocketServer, the ONLY main.ts edit this phase, an import + one line; does not touch routing or the WS upgrade). Tests (tests/server/http/, 10 suites / 45 tests) incl. onion_order.test.ts pinning the canonical sequence + cheap-reject-first + auth-before-account-limiter + CORS-survives-a-429. NO new error code was appended (every 4xx/401/403/413/429/500 body reuses an existing error_codes.ts code). Orchestration: 1 Explore context (+ a follow-up for six integration facts) -> a 3-agent parallel fan-out (8a errors/requestId/cors/metricSink, 8b-1 body/rawBody/clientError, 8b-2 requireAccount/rateLimit) -> lead integration (the onion-order test) + privacy-security-review + qa-checklist. Reviewers PASS: privacy-security-review 0 BLOCKING / 0 SHOULD-FIX (bearer-gap closed, 401/403 split, no internal leakage, clientError not an abuse vector, CORS parity; noted the primitive is a privacy IMPROVEMENT over the live resolver, which leaks the English status.message), qa-checklist READY 0 BLOCKING / 0 SHOULD-FIX. The one actionable nit (the re-typed JSON cap) was applied as DEFAULT_JSON_BODY_MAX_BYTES. Forward-looking notes carried for later phases (reviewed, no P8 change): P9 must DECIDE whether auth precedes body on account-scoped routes (today's order buffers the body cap before a 401 for an ip+account-only route, bounded by the per-route cap, not a regression) and must NOT widen the withCors origin predicate at mount; the metric hook records the app status which equals the sent status for every live surface (the redirect surface, 0 live routes, would collapse to 302 - a P23 cosmetic); the defensive readBody/readBinaryBody throw-fall-through in body/raw_body is intentional defense-in-depth (unreachable only given the reader's current exact reject strings). migration-safety NOT dispatched (no DDL/JSONB/db.ts schema change), cross-platform-sync + architecture-reviewer NOT dispatched (server-only, no src/sim/wire/matcher change); determinism/three-host-parity/persistence are N/A. STILL PENDING after P8: mounting the dispatcher + the top-level CORS/OPTIONS-204 wrapper (P9), the top-level security-headers wrapper + 415 Content-Type enforcement (P21), the deep two-tier limiter rework + ratelimit_db + structured RateLimit headers (P19), the client apiError.* matcher + REST code-parity Vitest (P22), and the real pino-shaped logger + /metrics exporter + X-Request-Id response echo + /livez/readyz (P23). Validation: tsc clean; the 10 primitive suites 45/45; full npm test 627 files / 6642 pass / 11 skip; build:env + build:server + build all exit 0; ci:changed exit 0 (changed files clean); ASCII-clean. Next: Phase 08 QA (phase-08-qa.md). Phase 08 QA (phase-08-qa.md) DONE (2026-06-30): PASS, 0 BLOCKING via a 5-agent audit (correctness/test-coverage/dead-code/privacy-security-review/qa-checklist). Fixes: (1) message-fidelity SHOULD-FIX: a self-deactivated account now maps to the `account.deactivated` code, not the generic `moderation.suspended`; moderationStatusForAccount (server/db.ts) now sets an OPTIONAL `deactivated` discriminator on AccountModerationStatus (additive return-shape, NO DDL/JSONB change; ban/suspension still outrank it) and requireAccount branches on `status.deactivated` ahead of the `moderation.suspended` defensive fallback; (2) coverage SHOULD-FIX: withCors's SHIPPING defaultApiAllow predicate now has a direct test (NATIVE_APP_ORIGINS member reflected, foreign origin skipped, no injected predicate); (3) parity NIT: withRawBody's Content-Length pre-check now uses the live strict `/^\d+$/`-on-trimmed parse (a contentLengthOverCap helper mirroring player_card.ts cardUploadContentLengthTooLarge), so a non-numeric length falls through to the mid-stream cap exactly as the live card route; (4) coverage NITs: require_account malformed-Authorization + token_invalid challenge, withBody no-415 + 64 KiB boundary, request_id newReqId fallback, WALLET_LINK_POLICY + DISCORD_POLICY (keyClass + flood-429 + composition-bug 500). DURABLE FOR PHASE 9: DISCORD_POLICY is AUTHENTICATED-legs-only (keyClass 'ip+account', 500s without ctx.account); the unauthenticated Discord start/callback legs run the same limiter IP-only (discordRateLimited(req, 0)) and need a SEPARATE 'ip' policy at mount, NOT DISCORD_POLICY. Deferred (tracked, non-blocking): a shared BEARER_TOKEN_PATTERN constant to retire the duplicated 64-hex regex (folds into the auth-resolver migration that removes the live bearerScopeAccount trio), serializeOauth `moderation.* -> access_denied` (Phase 7 errors.ts), and a live WS-upgrade smoke test (needs a booted server). Phase 8 http suites now 10 files / 57 tests. Post-QA validation: tsc clean; the 10 primitive suites 57/57; full npm test 627 files / 6654 pass / 11 skip; build:env + build:server + build all exit 0; ci:changed exit 0; ASCII-clean. Next: Phase 09 (registry + dispatcher-in-front + parity harness + top-level CORS wrapper, phase-09-registry-parity.md).

Phase 07 (RFC 9457 error model + per-surface serializers + error_codes catalog) DONE + QA DONE (2026-06-30: two PURE server-only spine modules, wires NO routes; Phase 8 calls mapError, Phase 22 localizes the codes). New `server/http/error_codes.ts` (140 lines, zero deps): a deep-frozen (`deepFreeze` over the object, each value, each params array) `as const` `ERROR_CODES`, `ErrorCode = keyof typeof ERROR_CODES`, 48 codes = 9 structural + 39 harvested, APPEND-ONLY per AIP-193 (a hard snapshot test fails on any removed/renamed code). New `server/http/errors.ts` (392 lines): `HttpError(status, code, params?, headers?)` (extends Error, `super(code)`); `toAppError(err): AppError{status, code, params?, headers?, unexpected}` the EXHAUSTIVE status table (HttpError pass-through; SyntaxError->400 json.malformed; raw `{ok:false,issues}`->422 validation.failed with ALL issues; pg `code==='23505'`->409 db.conflict; anything else->500 internal.error with `unexpected:true`); `applyImpliedHeaders` add-only + case-insensitive (WWW-Authenticate on a 401 auth.* code, Retry-After on a 429 ONLY from `params.retryAfterSeconds`, never fabricated); `normalizeSurface(EnvelopeKind|ErrorSurface|undefined)->ErrorSurface` ('problem+json'->'problem', 'legacy405'->'ok_false', default 'problem'); seven serializers keyed by ErrorSurface; `mapError(err, ctx, opts?): {status, headers, contentType, body}` = serialize(toAppError(err), normalizeSurface(opts.surface), ctx), routing the ORIGINAL to `opts.onUnexpected` (default `console.error`) ONLY when `app.unexpected`. The route error-surface tag is the Phase-2-frozen `RouteMeta.envelope: EnvelopeKind` ('problem+json'|'oauth'|'admin'|'html'|'redirect'|'binary'|'legacy405'); Ctx has NO route field so mapError takes the surface via `opts.surface` (Phase 8 supplies it), default 'problem'. Per-surface map: problem = application/problem+json `{type:'about:blank', title, status, detail, instance:ctx.path, code, ...params}` (client localizes by `code`, NOT by parsing `detail`; params spread FIRST so a reserved member is never shadowed); oauth = application/json `{error:<RFC6749 token>, error_description}`; admin = `{success:false, data:null, error:code}`; html = the htmlError doctype page (escaped, Cache-Control:no-store); redirect = 302 `Location:/error?code=<encoded>` (REDIRECT maps to ZERO live routes; defined for completeness); binary = text/plain body = the code (merges carried headers e.g. Connection:close); ok_false = `{ok:false}` (the legacy 405). Every response carries `X-Request-Id: ctx.reqId`. 500-NO-LEAK is a hard gate: the body + headers are built only from the stable code + static generic developer text (STATUS_REASON/DETAILS/OAUTH_ERROR); the original error (stack/SQL/table/column/driver detail) never reaches the output, only `opts.onUnexpected`. Codes: 9 structural (validation.failed[issues], json.malformed, auth.token_missing, auth.token_invalid, auth.forbidden, body.too_large[maxBytes], db.conflict, rate_limit.exceeded[retryAfterSeconds], internal.error) + 39 harvested reconciled 1:1 to the userFacingApiError identities (domains auth/account/character/moderation/email/two_factor); ONLY parametric harvested code is moderation.suspended_until[date]. Orchestration: 1 Explore (context) + 3 parallel writers (A catalog, B errors, C leak test) against a locked contract, then privacy-security-review + qa-checklist. Reviewers 0 BLOCKING. Applied 2 SHOULD-FIX + NITs: params spread FIRST in problem+json (a future catalog param can never shadow `code`/`status`/reserved members, RFC 9457 3.2); documented the intentional SyntaxError->400 breadth + the Phase 8 narrowing (withBody rethrows HttpError(400) so stray internal SyntaxErrors fall to 500+onUnexpected); unified the unexpected-500 decision into the single `AppError.unexpected` flag (deleted isUnexpected); added coverage (params-in-body, reserved-key shadow, case-insensitive header, non-auth-401 skip, unexpected-flag). DECLINED (documented): broadening WWW-Authenticate to all 401s - it runs surface-agnostically and a Bearer challenge suits only the bearer API surface, not oauth/admin 401s. Validation: tsc clean; 91 tests across the 3 new files; `tests/server/http/` 324 pass (was 318); S3 guard 27/3 (server matcher untouched); build:server exit 0; Biome + ci:changed clean; ASCII-clean. Deferred: withErrors -> P8; client userFacingApiError extension + apiError.* catalog + per-surface code-parity Vitest -> P22; real Retry-After VALUE from the limiter -> P19; em-dash rate-limit string fix -> P13; logger + /metrics -> P23. Phase 07 QA gate (phase-07-qa.md, dedicated adversarial pass): PASS, 0 BLOCKING, 0 SHOULD-FIX. 1 Explore context + 4 parallel auditors (correctness/test-coverage/dead-code/privacy-security) + per-finding verify; the correctness auditor returned ZERO findings (every acceptance criterion re-verified against real code) and the out-of-scope check CONFIRMED the four Phase 7 commits touched only server/http/ + tests/server/http/ + the two docs. All 10 findings were NICE-TO-HAVE; applied 5 in-scope hardening nits (commits 4d5a0882 refactor + 8877faeb test): direct escapeHtml escaping test (escapeHtml now exported), detailFor status-reason fallback assertion, WWW-Authenticate propagation assertion on the serialized mapError result, hoisted CT_JSON/CT_HTML constants, and narrowed DETAILS/OAUTH_ERROR to `Partial<Record<ErrorCode, string>>` (compile-time key-drift guard, no runtime change). Deferred 5 forward-looking notes to their scoped phases (37 orphan harvested codes -> P22; normalizeSurface export -> P8; redirect status-collapse + instance=ctx.path echo -> P8+/P12; defaultOnUnexpected console.error -> P23 redacting logger). A follow-up qa-checklist confirmation pass returned READY (0 BLOCKING/0 SHOULD-FIX) and added one forward-looking i18n note: the html + redirect serializers render server-side English (reasonFor/detailFor) with NO client-matcher boundary (unlike problem+json/oauth/admin which carry the machine `code` for Phase 22); the phase that first wires a PLAYER-FACING HTML error route at this surface must localize it. Post-fix: 97 tests across the 3 files (was 91); tests/server/http 330 (was 324); full gate green (npm test 617 files/6597 pass, tsc/build:env/build:server/build exit 0, S3 27/3, ci:changed clean, ASCII-clean). Commit-hygiene note (not a Phase 7 defect): commit 03dc2632 swept a stray root PROFESSIONS_REVIEW.md in with the schema.ts rename; removed in a follow-up commit at the user's request. Next: Phase 08 (Core middleware set + metric/log hook seam + thin rateLimit adapter, phase-08-middleware.md).

Phase 06 (typed schema validator) DONE + QA DONE (2026-06-30: one PURE server-only module, NOT wired into the live server until Phase 8/9; no DB, no middleware, no route change). New `server/http/schema.ts` (150 code lines, zero new deps): the combinators `object/str/num/bool/enum_/optional(schema, default?)` produce a `Schema<T> extends StandardSchemaV1<unknown,T>` exposing `decode(input, pointer?) -> { ok:true; value } | { ok:false; issues }`; `Issue` is `{ pointer, code, params? }` with STABLE codes (`type|required|min|max|int|minLength|maxLength|enum`), never English; `Infer<typeof S>` derives the handler input type with no parallel interface. decode() collects ALL field issues in ONE pass. `object()` reads ONLY declared keys (via `Object.hasOwn`) into a null-proto (`Object.create(null)`) output, so an input `__proto__`/`constructor` key cannot pollute a prototype; `num()`/`bool()` coerce strings (params/query arrive as strings). TWO reconciliations vs the (stale) phase-06 doc text, both matching THIS file's canonical plan: (a) NO new `server/http/standard_schema.ts` - the Standard Schema v1 type is already vendored in the Phase-2-frozen `types.ts` (the single home, "Phases 4 to 9 import, never redefine"), so schema.ts imports `StandardSchemaV1`/`StandardSchemaProps`/`StandardSchemaResult`/`StandardSchemaIssue` from `./types`; (b) NO `server/http/index.ts` barrel (it is the Phase 09 deliverable; spine uses direct extensionless imports). The `~standard` conformance is type-only; the runtime `~standard.validate` is a thin sync decode() adapter that still emits codes (`message = issue.code`). Reviewers verdict 0 BLOCKING (privacy-security-review 0/0, qa-checklist 0/0, adversarial-correctness 0 BLOCKING / 3 SHOULD-FIX): the 3 SHOULD-FIX applied as a deliberate input-boundary HARDENING (decided in QA, noted for Phase 10+ callers): `num()` string coercion is now CANONICAL DECIMAL only (a `DECIMAL` anchored/ReDoS-safe regex; `'0x10'`/`'1e3'`/grouped strings rejected with code `type`); `num({int})` requires `Number.isSafeInteger` (no >2^53 id aliasing); `optional(schema, default)` CLONES a mutable (object/array) default per decode (`structuredClone`) so it is never shared by reference. Plus NITs: null-proto object output, `bool()` trims for parity with `num()`, and added coverage. Schema tests (runtime + tsc-checked type-level Infer/`~standard` assertions, incl. a nested + `optional(object())` exactness check); tsc/biome(ci:changed)/build:server all green; ASCII-clean. Deferred: code->HTTP-status + problem+json (P7), the withBody/validate middleware (P8), RouteDef.schema wiring + registry + the index.ts barrel (P9), concrete page/pageSize bounds + envelope (P10), client i18n matcher (P22). Phase 06 QA gate (phase-06-qa.md, dedicated adversarial pass): PASS, 0 BLOCKING; 4-auditor fan-out + per-finding verify CONFIRMED 1 SHOULD-FIX + 3 NIT, all TEST-COVERAGE (no schema.ts change; the module re-verified defect-free), and REFUTED 3 (a redundant params-survival assertion + two subjective dead-code simplifications). The 4 test additions pin: the object() makeDefault() clone path (a SECOND clone site separate from optional().decode(undefined), so a mutable default in an object field is non-aliased per decode), the null-prototype output construction, `~standard.validate`'s multi-segment pointer->path conversion, and a SHAPE-declared `__proto__` key being pollution-safe. After hardening: 37 schema tests; `tests/server/http/` 233 pass; tsc/biome(ci:changed)/build:server all green; ASCII-clean. Next: Phase 07 (RFC 9457 error model + error_codes catalog, phase-07-error-model.md).

Phase 05 (onion compose + request context) DONE + QA DONE (2026-06-30: two server-only spine primitives, NOT wired into the live server until Phase 9; no `server/http/index.ts` barrel). `server/http/compose.ts` (`compose` = the canonical Koa onion dispatch with a `lastIndex`-cursor double-next guard rejecting `'next() called multiple times'`; `runOnion` = the OUTERMOST wrapper that runs the composed stack inside `runWithReqId(ctx.reqId, ...)` then guarantees EXACTLY ONE response via a total `finalizeResponse` helper; `respondOnce` = the headersSent/writableEnded-guarded idempotent sender) + `server/http/context.ts` (`buildContext` producing the frozen `Ctx` and reading the match ONLY for params since `Ctx` has no `route` field; reuses `ratelimit.requestIp` for `ctx.ip`; `query`/non-matched `params` are `Object.create(null)`; plus the reqId carrier `reqIdStorage`/`newReqId` (crypto.randomUUID)/`runWithReqId`/`currentReqId`). compose imports `Ctx/Middleware/Next` from `./types` and `runWithReqId` from `./context` (no redefine, no import cycle). Reviewers verdict PASS, 0 BLOCKING (privacy-security-review + qa-checklist + fresh coverage subagent): qa + coverage PASS with every acceptance criterion met by a regression-sensitive test; privacy 2 SHOULD-FIX (forward-looking) + nits, ALL applied: `buildUrl` now pins `ctx.url`'s authority to the placeholder by ASSIGNING path+search onto a fixed-origin URL, so neither absolute-form (`GET http://evil.com/...`) NOR an origin-form target that normalizes to a leading `//` (`/..//evil.com`, the QA-pass BLOCKING fix) can inject a host into the frozen `ctx.url`, AND is total (catches a malformed-target `new URL` throw so `buildContext` never throws before runOnion's net); `finalizeResponse` makes runOnion's net total (swallows a dead-socket throw, `end()`s a headers-committed-but-unended response). Fallbacks emit NO body/stack/SQL/table/English; statuses are named consts (no-response 404, throw 500), both carry `X-Request-Id`. 43 http unit tests (37 + 6 from the QA pass); full `npm test` 613 files / 6463 pass / 11 skip; tsc/biome/ci:changed/build:env/build:server/build all green; ASCII-clean. The Phase 2 `fake_ctx.ts` was left UNTOUCHED (a test asserts buildContext and fakeCtx share the same own-key set). Phase 05 QA (phase-05-qa.md) verdict: PASS-WITH-FOLLOWUPS-RESOLVED (4 adversarially-verified auditors): 1 BLOCKING (the in-phase host-injection fix was INCOMPLETE for `//`-pathname targets; closed by the fixed-origin-URL rebuild), 2 SHOULD-FIX + 2 NIT coverage gaps, all applied. Next: Phase 06 (typed schema validator, phase-06-schema-validator.md).

Phase 04 (table router) DONE + QA DONE (2026-06-30: two PURE, server-only modules, NOT wired into the live server until Phase 9). `server/http/path_pattern.ts` (compilePattern = the no-regex routing guard, normalizePath, matchPattern, and the HttpMethod/PatternSegment/CompiledPattern types) + `server/http/router.ts` (createRouter over a Map<HttpMethod,{static:Map,dynamic[]}>, returning the MatchResult union). Phase 04 QA verdict PASS, 0 BLOCKING (1 context Explore + 4 parallel reviewers: correctness 0 findings / all 21 acceptance criteria verified, dead-code 0, privacy-security PASS, test-coverage 1 SHOULD-FIX + 3 NIT coverage gaps, no code defects). All applied: added a 405-via-dynamic-route test (the canonical wrong-method-on-a-resource case, asserted nowhere before), multi-param capture, PUT/PATCH METHOD_ORDER positions, and a structural server-only purity test (criterion 16, no `../`/`node:` imports); hardened `matchPattern` to build params with `Object.create(null)` (defense-in-depth on top of the reserved-name guard). 60 unit tests; full npm test 611 files / 6420 pass / 11 skip; tsc/biome/build:env/build:server/build all green; ASCII-clean. See "Phase 4 router contract" below for what Phases 5/7/9/17 inherit. Next: Phase 05 (onion compose + request context, phase-05-onion-context.md).

Phase 03 (surface inventory + content-type classification + characterization/golden corpus + knownDeviations) DONE + QA DONE (2026-06-30: tests/docs only, ZERO runtime behavior change; 106-row HEAD-anchored inventory + route-count freshness gate, 5-class /api content-type classification, golden corpus over the four dispatchers replayed through routeHttpRequest + the Phase 2 goldenMaster/normalizer, 12 seeded knownDeviations). Phase 03 QA verdict PASS-WITH-FOLLOWUPS (1 BLOCKING + 3 SHOULD-FIX + nits all fixed; no golden blessed a security defect): account/email/verify + email/unsubscribe were misclassified HTML but emit application/json, RECLASSIFIED to PROBLEM_JSON (HTML now maps to /api/auth/discord/callback ONLY); added content_type_consistency.ts cross-check (every golden's content-type vs its route class, wired through both characterization files); de-binarized surface_inventory.test.ts (raw NUL key delimiters escaped) + a method-aware freshness subset guard; new goldens for email/verify 400 + the wrong-method 404 baselines (wired into planned405BeforeAuth) + the per-route /internal/discord secret-unset 404. Corpus 57->67 fixtures, suite 73->84 tests byte-stable; tsc/biome/ci:changed/build:server green; full tests/server 196/196. Next: Phase 04 (table router, phase-04-router.md). KEY CORRECTIONS this phase surfaced (see below): the Discord callback is HTML (200 text/html bounce), NOT a 302 redirect; REDIRECT maps to zero routes today; the only /api HTML route is the Discord callback. Phase 02 + QA DONE (frozen contracts + self-tested harness + clock seam; all 11 criteria PASS). Phase 01 + QA DONE.

## Phase 2 frozen contracts (Phases 4 to 9 IMPORT these, never redefine)

The single home is `server/http/types.ts` (TYPE-ONLY, zero runtime emit). Verbatim:
- `RouteDef`: `{ method: Method; path; surface: Surface; middleware?; schema?; params?; query?; handler: RouteHandler; meta? }`. Handler is req/res-free `(ctx: Ctx) => Awaitable<unknown>`.
- `RouteMeta`: `{ requireOwned?: { kind; ownerScope: 'account'|'operator' }; publicRead?: boolean; envelope?: EnvelopeKind; deprecated?; sunset? }`. The BOLA coverage helper EXCLUDES operator-scoped and `publicRead` :id routes; `publicRead` is the Phase 10 marker for genuinely public `:id` reads.
- `EnvelopeKind` (7): `'problem+json' | 'oauth' | 'admin' | 'html' | 'redirect' | 'binary' | 'legacy405'`. `Surface` (4): `'api' | 'oauth' | 'admin' | 'internal'`. `Method`: GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD.
- `Ctx`: `{ req; res; method; url: URL; path; query; params; ip; reqId; body?; account?: { accountId; scope: 'read'|'full' }; state: Map<string,unknown> }`. Phase 5 buildContext produces it; fakeCtx mirrors it.
- `Middleware = (ctx, next) => Promise<void>`, `Next = () => Promise<void>`. Schema slot = Standard-Schema-v1 (`StandardSchemaV1`); Phase 6's validator implements it.
- `RateLimitStore`: `{ hit(key, maxPerMinute): Awaitable<RateLimitOutcome>; reset(): Awaitable<void> }`, `RateLimitOutcome = { allowed; remaining; resetSeconds }`. FakeRateLimitStore implements it on an injected clock; Phase 19's PgRateLimitStore implements the SAME interface, and since Phase 19 every ratelimit.ts limiter returns RateLimitOutcome (no boolean caller remains; the shared math lives in the exported windowedRateLimitOutcome).
- Dispatch flag: env `API_DISPATCH` = `'legacy' | 'new'`, default `'legacy'` (Phase 25 flips the default; Phase 24 wires loadConfig into boot). loadConfig(env) is pure and frozen; required value = DATABASE_URL (value-free fail-fast).
- Normalizer placeholder set (load-bearing for Phase 3): exported `NORMALIZER_PLACEHOLDERS` = id/timestamp/token/requestId/date/expires/nonce. Field-name-driven; the generic key `state` is deliberately NOT masked (oauth `state` is masked later with surface context). The parity driver's per-pass isolation resets EVERY limiter bucket (incl. the failed-login bucket) + the clock + an injected hook.

## Phase 4 router contract (Phases 5/7/9/17 consume this; the router is built in Phase 4 but wired in Phase 9)

`server/http/router.ts` `createRouter(routes)` returns `{ match(method, path): MatchResult }`. `MatchResult` is a discriminated union: `{ kind:'matched'; route; params; head }` | `{ kind:'methodNotAllowed'; allow }` | `{ kind:'options'; allow }` | `{ kind:'notFound' }`. `HttpMethod` is an ALIAS of the canonical `Method` (server/http/types.ts); `RoutePattern = { method, path }` is structurally satisfied by `RouteDef`, so Phase 9 calls `createRouter<RouteDef>(...)`.
- The router is a PURE match function: it returns DESCRIPTORS, never writes a header/response and never chooses an error envelope. The 405/404/OPTIONS WRITES are Phase 9's; the localized error BODIES are Phase 7's.
- HEAD maps to GET for lookup and sets `head:true` on the matched result. (Phase 10 QA: while the legacy arms are retained, the dispatcher DELEGATES a HEAD match to the legacy ladder so HEAD stays byte-identical, 404, old-vs-new; serving HEAD as GET is deferred to the Phase 25 flag flip / ladder deletion.) OPTIONS is SYNTHESIZED from the real method set: `{ kind:'options', allow }` on a known path, `notFound` on an unknown one. Phase 9 must serve the synthesized OPTIONS as 204 with `Allow:` + `Vary: Origin` (the router writes neither header). The Allow set always includes synthesized OPTIONS and (when GET is registered) HEAD, ordered by a complete METHOD_ORDER map.
- Honest 405 + Allow is the DEFAULT. The anti-enumeration 404-instead-of-405 override on auth routes is Phase 9's (applied from an explicit list intercepting the `methodNotAllowed` kind); do NOT special-case it in the router.
- normalizePath strips exactly ONE trailing slash (root `/` preserved); it does NOT collapse internal slashes, decode percent-encoding, or resolve `..`. So the router receives a CLEAN pathname: Phase 5 URL parsing owns percent-decode + `..` resolution and MUST NOT decode `%2F` into a path separator before handing the path to the router. SEAM OBLIGATION (Phase 9): the auth gate must authorize on the SAME normalized path the router matches (an exact-string gate on an un-normalized path while the router matches the normalized path is a trailing-slash bypass).
- The no-regex routing guard (compilePattern) accepts only literal segments + plain `:name` (char-by-char, no regex anywhere, ReDoS-safe by construction). It REJECTS the admin enum-alternation route `/admin/api/moderation/accounts/:id/(suspend|unsuspend|ban|unban)`, which is why Phase 17 must restructure that to `:param` + schema. It also rejects reserved param names (`__proto__`/`constructor`/`prototype`) at compile time. The captured-params object `matchPattern` returns is built with `Object.create(null)` (no inherited `Object.prototype` keys), so a downstream lookup by an untrusted key can never read an inherited member: belt-and-suspenders on top of the reserved-name guard (param VALUES from the wire are only ever stored under validated NAMES, never used as keys).
- BUILD-TIME guards in createRouter: registering HEAD or OPTIONS throws (they are synthesized, so a HEAD-only route is intentionally inexpressible; the Phase 3 inventory has none). Duplicate detection is by SHAPE (params replaced with a `:` placeholder), so textual dups, trailing-slash dups, AND param-name-equivalent dups (`/a/:x` vs `/a/:y`) all throw. CROSS-shape dynamic overlaps (e.g. `/:resource/special` vs `/characters/:id` both matching `/characters/special`) are ALLOWED and resolve to the FIRST registered: Phase 9's registry must order more-specific dynamic routes first (no specificity tiebreak in the router by design). SEAM OBLIGATION (Phase 9, BOLA): because the router has no specificity tiebreak, a catch-all leading-`:param` route registered BEFORE a specific route can shadow a route carrying a `requireOwned` loader; the Phase 9 registry must order specific dynamic routes ahead of catch-alls AND add an introspection check that no overlapping dynamic shape leaves a `requireOwned` route shadowed by a non-owned one (Phase 04 QA, privacy-security).
- match() expects an UPPERCASE method token (HTTP methods are case-sensitive per RFC 9110; Node delivers uppercase). An unrecognized method (junk, or lowercase) on a known path returns `methodNotAllowed` (405), not a distinct 501: the MatchResult has no 501 variant, so if Phase 7/9 ever wants 501-Not-Implemented vs 405, that is an error-model mapping (and a contract extension), not router behavior.

## Locked design decisions

### The five 2026-06-30 user decisions
1. **Delivery = stacked PR chain.** Each phase is its own green, bisectable PR; the suite
   stays green at every commit. Pairs with the ~40%-context-per-phase bound: small phases,
   small PRs, small reviews.
2. **Coexistence = a single all-or-nothing env dispatch flag.** The flag controls whether
   the new pipeline sits in front of the old `handleApi`. New path is the DEFAULT (and the
   path the suite targets). The new dispatcher delegates un-migrated paths to the old ladder
   via a per-path catch-all so partially-migrated states work. Rollback = flip the one flag
   (all migrated routes revert to the old ladder at once). ACCEPTED TRADEOFF (chosen
   knowingly): a flag flip reverts the hardening too (new limiters, BOLA loaders, bearer-gap
   close, security headers, em-dash fix all live on the new path). The old ladder is deleted
   in the NEXT release once the metric exit-criteria are clean (Phase 25 names them).
3. **CORS + the OPTIONS-204 short-circuit + the security-headers wrapper stay TOP-LEVEL
   `createServer` wrappers** covering BOTH old and new paths, so a routing rollback cannot
   drop CORS/preflight or security headers. They are NOT inside the per-route onion only.
4. **Discord family in scope this packet.** The SPEC predates the Discord/guild/moderation
   merge; the Discord identity endpoints, schema wiring, orphaned handler, and limiter are
   migrated here (see Discord family below).
5. **BOLA denial status:** 404 for player-owned objects (anti-enumeration); 403 for
   admin/operator-scoped routes.

### Scope and goal
- IN SCOPE: every JSON/HTTP endpoint across the four sub-dispatchers (main `handleApi`,
  admin, oauth, internal) on `server/`, PLUS every prefix-delegated sub-dispatcher module
  behind them (as of v0.19.0: `handleDailyRewardApi` behind main.ts's
  `startsWith('/api/daily-rewards')` arm, and `handleDailyRewardInternalApi` as the first
  member of the /internal composite delegate). Route families that arrive via release
  merges AFTER their would-have-been wave are owned by Phase 18b (github, desktop-login,
  daily-rewards); a release merge that adds routes files SURFACE_INVENTORY rows AT THE
  MERGE and names an owning phase (qa-checklist section 2, the route-family coverage box).
- No heavy web framework. Zero new runtime dependencies; the ONE weighed exception is
  `prom-client`, and ONLY when the `/metrics` exporter lands (Phase 23).
- All `file:line` anchors in the source SPEC (`docs/api-pipeline/source-spec.md`) are STALE
  (main.ts ~2350 lines as of the third v0.20.0 merge). Re-anchor on SYMBOL NAMES and route
  strings, never line numbers.

### Target architecture
- Domain-agnostic spine under `server/http/`: `router.ts`, `compose.ts`, `context.ts`,
  `schema.ts`, `errors.ts`, `error_codes.ts`, `registry.ts`, `index.ts` (barrel),
  `middleware/*.ts`, plus a pure `config.ts` (`loadConfig`).
- Component-first layout: each `server/<domain>.ts` exports `export const routes:
  RouteDef[]`. Handlers are THIN; domain functions take no req/res so the same core serves
  REST and WS and is unit-testable.
- `RouteDef` carries method, path, middleware, schema, params, query, handler, and metadata
  (`requireOwned*` presence, per-surface envelope, deprecated/sunset).
- Router: in-house `Map<method,{static:Map<path,Route>, dynamic:Route[]}>`. Static match
  O(1); dynamic captures `:param` with NO per-request regex. Known-path wrong-method -> 405
  + Allow header BEFORE auth/handler. Deliberate anti-enumeration 404 on auth routes kept
  via an explicit `knownDeviation` list. HEAD-for-GET, synthesized OPTIONS, single
  trailing-slash normalization (convention H), `Vary: Origin`. A no-regex-routing guard
  asserts every pattern is literal segments or a plain `:param`.
- Onion: Koa-compose recursive dispatch (~15 lines) with a double-next guard, ordered
  cheap-reject-first (IP-keyed limits before body+DB; account-keyed limits after auth).
  `compose()` returns a promise and does NOT send a response or catch on its own (see
  gotchas). Validator: tiny in-house (~150-line cap), NO zod/valibot, collects ALL field
  issues in ONE pass, implements the Standard Schema v1 `~standard` type shape, handler
  input DERIVED via `Infer<typeof S>`, typed params AND query.

### Error + status model (RFC 9457 / 9110 / 6585 confirmed)
- Per-surface envelopes chosen by a single `mapError`, NEVER one global serializer:
  - `/api` JSON: RFC 9457 `application/problem+json` (type/title/status/detail/instance +
    a stable machine `code`; clients localize by CODE, not by parsing `detail`).
  - `/oauth` POST JSON: RFC 6749 `{error, error_description}`.
  - `/admin`: `{success, data, error}`.
  - HTML routes (OAuth GET consent/device pages): `htmlError` HTML page. (NOTE: the `/api/account/email/verify` + `/api/email/unsubscribe` link-click endpoints LOOK like pages but answer application/json in every branch, so they are PROBLEM_JSON, not HTML; Phase 3 QA corrected an initial misclassification.)
  - Discord callback: text/html bounce page (200, client-side `location.replace`), NOT a 302
    redirect and NOT problem+json. Phase 3 characterization CORRECTED the SPEC's "302" assumption
    (the handler `bouncePage` writes `Content-Type: text/html`); it needs the HTML-error serializer,
    not a redirect serializer. The REDIRECT envelope/class maps to ZERO routes today.
  - Binary route (card upload): binary/no-JSON-wrap.
  - The legacy `{ok:false}` 405 (perf_report + site_presence non-POST) is a 4th characterized
    contract case (perf_report's own 405 is unreachable via handleApi's POST-gated arm; site_presence
    is method-agnostic so its non-POST 405 is the live one).
- Status codes: 422 well-formed-but-invalid (one-pass collected), 400 malformed JSON, 413
  over byte cap (Content Too Large), 409 unique-violation, 401 missing/invalid token (+
  `WWW-Authenticate`), 403 no-entitlement, 429 + `Retry-After`. Unknown -> logged 500 with
  NO stack/SQL/table text in the body.
- `error_codes.ts` is the single `as const` source of truth, frozen `(domain, reason)` +
  param keys, APPEND-ONLY (AIP-193). Reuse the existing `domain.reason` vocabulary.

### Non-JSON `/api` classification (a blanket rule WOULD break prod)
The `/api` surface is NOT uniformly JSON. A global `415 application/json` + JSON-only
`withBody` + blanket problem+json WOULD break: `POST /api/card` (binary `image/png` via
`readBinaryBody`) and `GET /api/auth/discord/callback` (text/html bounce, NOT a 302; Phase 3
corrected this; it is the ONLY /api route that emits text/html). (`GET /api/email/unsubscribe`
and `GET /api/account/email/verify` answer application/json, so they do NOT break the blanket;
Phase 3 QA corrected an initial HTML misclassification of both.) Therefore: classify every `/api` route by
response content-type; ship a
`withRawBody`/binary middleware variant; exempt declared non-JSON routes from 415 + JSON
withBody; roll out 415 in LOG-ONLY mode first until native (Capacitor) traffic is confirmed.
Audit each beacon endpoint (`/api/site-presence`, `/api/perf-report`) actual Content-Type.

### Rate limiting (two-tier)
Tier-1 in-memory IP gate runs FIRST (floods never reach pg); tier-2 global-keyed atomic
UPSERT in a NEW `server/ratelimit_db.ts` modeled on `bug_report_db.ts` (pg-tier for
multi-realm). Limiters change from boolean to `{remaining, resetSeconds}` (~5 files; Phase
19), using the injected `now()` clock (Phase 2) for deterministic tests. `RATELIMIT_SCHEMA`
MUST be explicitly added to the `ensureSchema` statement list under the boot advisory lock,
with a boot-time table-existence assertion (the exact trap the UNWIRED `DISCORD_SCHEMA`
fell into). Emit draft-11 / RFC 9651 `RateLimit` + `RateLimit-Policy` structured-field
headers (q/w/r/t, pinned to a draft version in a comment) + `Retry-After`, NOT the legacy
trio. Handler-level checks KEPT (cannot be pre-handler middleware): `authThrottled`
(per-username, failed-only, clears on success, 15m/10-fail); `rateLimitedPerfReport`
returns 200 BY DESIGN. NEW limiters (labeled-behavioral knownDeviations):
character.create/rename/delete/takeover, reports.create; the Discord limiter
(DISCORD_MAX_PER_MINUTE=15, ip+account) is the genuinely-new 8th surface. SHARED-BUDGET
CONSTRAINT (v0.19.0): the main.ts fused `rateLimited(req)` per-IP budget deliberately
covers FOUR paths (register, login, desktop-login/create, desktop-login/exchange) as ONE
bucket, limiter-before-auth; the Phase 19 rework must preserve that keying or split it as
an explicit maintainer decision. POST /api/daily-rewards/spin has NO limiter (the
one-spin-per-day 409 is the only guard): parity keeps it none in Phase 18b, and adding one
is a named Phase 19 fork, never a silent add.

### Discord family (Phase 16)
- Migrate `POST /api/auth/discord/start`, `GET /api/auth/discord/callback` (text/html bounce,
  NOT a 302, classified non-JSON), `GET /api/discord` (status), `DELETE /api/discord` (unlink) onto
  RouteDefs.
- WIRE the unwired `DISCORD_SCHEMA` (5 tables in `discord_db.ts`) into `ensureSchema` here.
- FIX the orphaned `handleSwagClaim` (implemented + tested in `discord.ts` but never
  dispatched in main.ts, currently unreachable over HTTP).
- Add a `discord.*` ip+account policy to POLICIES and Discord error codes to the catalog +
  client matcher. Carry forward the `isIpBlocked` + turnstile parity gap from prior reviews.
- The secret-gated `/internal/discord/*` bot-channel endpoints migrate in Phase 18,
  preserving their `x-woc-discord-secret` gate (shipped as TEN: the daily-rewards-winners
  pair postdates this section's count of 8). A THIRD secret gate exists since v0.19.0:
  the `/internal/daily-rewards/*` ops family's `x-woc-daily-reward-secret`
  (WOC_DAILY_REWARD_SERVICE_SECRET, fail-closed 401 on unset env AND on mismatch, never
  falling back to RESTART_COUNTDOWN_SECRET), migrated in Phase 18b onto RouteDefs behind
  requireInternalSecretFailClosed (the composite delegate still serves off-table shapes).

### BOLA / object-level authorization
Load-then-authorize `requireOwned*` resource-loader: scope-before-find, account-scoped
query, populates `ctx.<resource>`. Deny-by-default coverage test over the route registry:
every ACCOUNT-OWNED `:id` route resolves through an account-scoped loader. Admin
operator-scoped `:id` routes are EXCLUDED from the owner clause and use an admin-scope
loader. Structured `bola_denied` deny logging. Denial status: 404 player-owned, 403
admin/operator (see decision 5).

### Security headers (Phase 21) - SHIPPED 2026-07-02
`withSecurityHeaders` (server/http/middleware/security_headers.ts) is LIVE as the first
statement of `routeHttpRequest`, ahead of `applyCorsAndPreflight`, so the headers span the
FULL prefix ladder (static, `/c/` SSR, `/p/` card, `/avatar`, sitemap, /api, /admin/api,
/oauth, /internal, the OPTIONS-204 short-circuit) on BOTH dispatch paths: a flag rollback
drops nothing (pinned by tests/server/http/security_headers.test.ts under both modes).
Set: nosniff, Referrer-Policy strict-origin-when-cross-origin, a Permissions-Policy deny
list EXCLUDING fullscreen/gamepad (in use by the game client) and autoplay/screen-wake-lock,
COOP + CORP same-origin, HSTS under NODE_ENV=production only, X-Frame-Options DENY +
Cache-Control no-store on the /oauth/ prefix (the token/device_authorization JSON responses
had no Cache-Control before), Server + X-Powered-By stripped. X-Frame-Options, NOT a
frame-ancestors CSP: NO Content-Security-Policy header of any kind is emitted (full CSP is
a SEPARATE Report-Only effort), and NO COEP:require-corp (would break cross-origin
GLB/HDRI). All 88 goldens re-pinned (additive headers only); the securityHeadersAllSurfaces
knownDeviation records the contract change.

The 415 Content-Type gate (content_type.ts) and the cross-site Origin check
(origin_check.ts) are mounted in the dispatch.ts onion (matched routes only, 'api' surface,
mutating methods) and are LOG-ONLY pending the native-traffic audit: flipping
API_CONTENT_TYPE_ENFORCE / API_ORIGIN_CHECK_ENFORCE to '1' enforces 415
body.unsupported_media_type / 403 origin.cross_site. Exemptions read RouteDef metadata (the
new RouteMeta.requestBody; POST /api/card is 'binary'); absent Content-Type and absent
Origin ALWAYS pass (bearer-only surface, beacons + native clients). Delegate-served paths
never see the gates (the registered-surface carve-out). Enforce-audit note: the origin
gate's allow set is same-origin host + allowedCorsOrigin; it does NOT include the
WEB_ORIGINS env list or the localhost dev regex isWebClientRequest accepts (deliberate,
so that traffic appears in the audit records; reconcile or accept the 403 before the
flip; an operator adding to WEB_ORIGINS alone does NOT widen this gate). The flip audit
harvests TWO distinct sink tags: '[content-type] mismatch' (content_type.ts) and
'[http] cross-site origin on mutating /api request' (origin_check.ts); grep for both,
one style misses the other. Also at the flip: the same-origin arm (isSameOriginHost)
compares the Origin host against the first X-Forwarded-Host with no trusted-proxy
gating (contrast ratelimit.ts TRUSTED_PROXY_IPS); spoofing it only fails toward allow
on a bearer-only surface (the spoofer could simply omit Origin), but the audit should
consider gating that comparison behind the trusted-proxy check before enforcing.
Phase 21 QA confirmed (privacy-security-review): an API_ORIGIN_CHECK_ENFORCE=1 flip
today would NOT break the Electron desktop (app://worldofclaudecraft) or Capacitor
(capacitor://localhost) clients; both ride the shared allowedCorsOrigin set, and the
absent-Origin allowance covers any client that sends no Origin at all. Phase 23
handoff (security review): the two mismatch sinks are un-throttled console.warn lines
that run AHEAD of the route-local rate limiters, a latent log-amplification vector once
API_DISPATCH=new; Phase 23's structured logger must sample or bound them. Watch-item:
do not set API_DISPATCH=new in ANY environment before Phase 23 lands those bounds.
[Watch-item RESOLVED, Phase 27 (2026-07-04): Phase 23 routed both sinks through the
structured logger with template-bounded cardinality but landed no sampling/throttle;
Phase 27 landed the bound itself (server/http/mismatch_warn_throttle.ts, wired into both
default sinks). See the OPEN items entry at the top of this file.]

### World Market realm-scope fix (Phase 20, own PR, migration-safety reviewer)
Highest-consequence change (normal-operation item loss). Realm-scope the `world_state`
`'market'` key at BOTH write sites in lockstep (anchor on `saveCharacterAndMarketState`
escrow txn AND `saveWorldState`) PLUS the read (`loadMarketState`). Add a backfill that
PARTITIONS the existing global blob by each seller character's realm, idempotent under the
advisory lock, with a boot-ordering gate before the first new-key write, a dry-run +
escrow-sum/row-count verification, and a documented data-rollback. JSONB
`serializeCharacter` with a defensive `??` default keeps new state fields back-compatible.

### REST i18n matcher (Phase 22): DONE
The REST matcher is now CODE-based and GUARDED, closing the long-standing
unguarded-REST-matcher gap (the S3 guard scans only the WS path via server/game.ts).
`userFacingApiError` lives in the pure DOM-free `src/ui/api_error_i18n.ts` (extracted from
`src/main.ts`, unit-tested in tests/main_api_error.test.ts); resolution order is stable
code FIRST (the API_ERROR_KEYS identity table: code `domain.reason` ->
`t('apiError.<domain>.<reason>')`), the legacy prose arms SECOND, diagnostic English LAST.
`apiError.*` (src/ui/i18n.catalog/api_error.ts) is the client-localization home for server
codes: one entry per registered code, alongside the append-only frozen ERROR_CODES set (59
codes: 50 pre-phase + 9 discord.*). tests/api_error_code_parity.test.ts enforces
every-code/every-locale resolution, the identity table, per-locale placeholder parity
({date}, {seconds}), and the append-only freeze. The migrated surfaces now EMIT the codes
ADDITIVELY alongside byte-identical legacy prose in BOTH dispatch twins (shared
moderationErrorBody in http_util.ts carries the machine ISO `date`; rate_limit.exceeded
carries retryAfterSeconds, formatted client-side via the new formatDuration). The
`this token is read-only` 403 now rides auth.forbidden; the desktop-login arm and the
daily-rewards family keep their recorded prose adjudications (the client discards the
daily-rewards bodies; citations in phase-22-rest-i18n.md STEP 1).
REMAINING DEPENDENCIES: the prose fallback stays until the old-ladder deletion (Phase 25);
still prose-only: `rate limited`, `server_error`, `too many attempts, slow down`, the
github/desktop-login/daily-rewards domain bodies (18b adjudication), the /api/search
legacy divergent arm; DISCORD_POLICY stays UNMOUNTED (mounting would switch its 429 to
problem+json and change limiter keying; revisit in the P25 window). The Phase 13 em-dash
fix is long shipped (comma strings live; matcher prefixes unchanged).

### No-magic-values + config (Phase 24)
Every tunable (rate limits + windows, byte caps, page sizes, timeouts, TTLs, pool sizes,
maxPayload, drain window) is a NAMED constant, single source of truth, env read ONCE via a
pure validated `loadConfig(env)` (separate from the boot call site). POLICIES values DERIVE
from existing named constants, never re-typed literals. Server timeouts
(requestTimeout/headersTimeout/keepAliveTimeout/maxHeaderSize) set in `startServer()` with
named constants, mindful of the WS upgrade handshake and the 1 MB card upload.

### API conventions
- SHIP NOW: B (pagination `{items, page, pageCount, total, pageSize}`), H (trailing-slash),
  I (drain-aware health: `/livez` + `/readyz`, `/readyz` NOT-ready during SIGTERM drain).
- DEFERRED to a consumer-driven follow-up: A (versioning), D (ETag), F
  (Deprecation/Sunset), G (OpenAPI). Ship paths UNVERSIONED.

### Performance gate
Non-goal: NO realtime regression. Pipeline (compose recursion + ALS + per-route metric
write + full-issue schema validation) runs on the SAME event loop as the 20 Hz world loop.
Acceptance gate: the pipeline adds < X ms p99 per request and does NOT raise tick p95 above
0.8 x DT, measured against the existing perf harness. (Phase 24 codified the gate and picked
X: PIPELINE_ADDED_P99_BUDGET_MS = 1.0 ms and TICK_P95_CEILING_RATIO 0.8 in
server/http/perf_gate.ts; measured pipeline overhead is about 0.005 ms p99.)

## Non-negotiable constraints (every phase keeps all of these)
- **Determinism / sim purity:** sim randomness via `Rng` only; NEVER
  `Math.random`/`Date.now`/`performance.now` in `src/sim/`. This work is SERVER-ONLY and
  should not touch `src/sim/` (server time is fine; Phase 2 injects a `now()` clock so
  limiter tests are deterministic). `src/sim/` imports nothing from render/ui/game/net; no
  DOM/Three (guarded by `tests/architecture.test.ts`). The only client-side touch is the
  i18n matcher in `src/main.ts` + the `apiError.*` catalog (Phase 22).
- **Server authority:** clients stream intent; the server resolves all outcomes. This
  packet does not change that and does not change the WS wire/snapshots. If a phase would
  change them, STOP and surface it.
- **Stable-code i18n:** every player-visible string is a `t()` key in every locale; the
  server stays language-agnostic and emits a stable CODE re-localized at the client
  boundary. The S3 guard is `tests/localization_fixes.test.ts`.
- **Additive idempotent DDL:** boot-time DDL under the advisory lock (`CREATE TABLE IF NOT
  EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`); there is NO migrations directory;
  the inline DDL IS the schema. JSONB back-compat for existing character state; round-trip
  test. New schemas MUST be added to the `ensureSchema` statement list (the DISCORD_SCHEMA
  trap).
- **No magic values:** every tunable is a named constant via `loadConfig(env)` (Phase 24).
- **No generated-file edits:** do not hand-edit generated files (regenerate via the build).
- **Shared-worktree commit care:** concurrent sessions exist. Commit with EXPLICIT paths,
  never `git add -A`. Conventional Commits with a scope (`feat(http): ...`,
  `fix(server): ...`, `test(server): ...`).
- **No em dashes, en dashes, or emojis** anywhere (code, comments, docs, commits, copy).
  Enforced by the Stop hook + pre-push copy scan.
- **Module-first:** spine under `server/http/` + per-domain route modules; NEVER grow
  main.ts. Biome on CHANGED files only (`npm run ci:changed`); scoped `npx @biomejs/biome
  check --write <file>` only; NEVER a whole-tree `--write`.

## Validation matrix (by change type)
- **Any code change (baseline):** `npx tsc --noEmit` + `npx vitest run
  tests/server/<domain>.test.ts` (and any existing affected suite) + `npm run ci:changed`
  (Biome on changed files).
- **Spine / primitive phases:** `npx vitest run` the new `tests/server/http/*.test.ts`.
- **Server build:** `npm run build:server`.
- **Player text / codes added or changed:** `npx vitest run
  tests/localization_fixes.test.ts` (S3) + the new per-surface code-parity test.
- **Persistence / DDL changed:** idempotent-DDL re-run test + JSONB save/load round-trip
  test; dispatch the `migration-safety` reviewer.
- **Each phase is a PR; pre-merge gate (mirror CI):** `npm test && npx tsc --noEmit && npm
  run build:env && npm run build:server && npm run build`.
- **WS wire/snapshots are NOT expected to change.** If a phase would change them, STOP and
  surface it.
- **Review dispatch (spawn ONLY matching surfaces; check `git diff --name-only`):**
  `privacy-security-review` (`server/` touched, esp. auth/BOLA/rate-limit/headers/secrets/
  SQL), `migration-safety` (`db.ts`, `ratelimit_db.ts`, `discord_db.ts` wiring, the market
  fix, any DDL/JSONB shape change), `cross-platform-sync` (ONLY if IWorld/`src/sim`/wire/the
  matchers/RL surface change, mostly only Phase 22), `architecture-reviewer` (ONLY if
  `src/sim/` changes, which this packet should NOT), `qa-checklist` (each phase completion).

## Key file paths
- **Existing server sub-dispatchers (the four):** main `handleApi` in `server/main.ts`;
  admin `handleAdminApi` in `server/admin.ts`; `server/oauth.ts`; `server/internal.ts`.
- **Existing domain handlers / db modules to draw from:** `server/account.ts`,
  `server/wallet.ts`, `server/discord.ts`, `server/discord_db.ts`, `server/discord_oauth.ts`,
  `server/auth.ts`, `server/native_attestation.ts`, `server/character_sheet.ts`,
  `server/perf_report.ts`, `server/site_presence.ts`, `server/bug_report_db.ts`,
  `server/ratelimit.ts`, `server/ip_block.ts`/`ip_block_db.ts`, `server/turnstile.ts`,
  `server/moderation_db.ts`/`moderation_service.ts`, `server/social_db.ts`, `server/db.ts`,
  `server/http_util.ts`, `server/web_login_guard.ts`.
- **Spine modules to be CREATED (`server/http/`):** `router.ts`, `compose.ts`, `context.ts`,
  `schema.ts`, `errors.ts`, `error_codes.ts`, `registry.ts`, `index.ts` (barrel),
  `config.ts` (pure `loadConfig`), `middleware/*.ts`, plus the importable `ws_auth` module
  (Phase 1).
- **New persistence:** `server/ratelimit_db.ts` (RATELIMIT_SCHEMA wired into `ensureSchema`).
- **New per-domain route modules:** `server/leaderboard.ts`, `server/characters.ts`,
  `server/reports.ts` (each `export const routes: RouteDef[]`); existing files get a `routes`
  export added (`account.ts`, `wallet.ts`, `discord.ts`, `admin.ts`, `oauth.ts`,
  `internal.ts`).
- **Tests:** `tests/server/<domain>.test.ts`, `tests/server/http/<primitive>.test.ts` (the
  `tests/server/` directory is created in Phase 2).
- **Client i18n (Phase 22):** `apiError.*` catalog domain (a `src/ui/i18n.catalog/` module);
  `userFacingApiError` in `src/main.ts` extended; `src/admin/i18n.locales/en_CA.ts` em-dash
  fix.

## New files created per phase
| Phase | New files |
|---|---|
| 01 | DONE. importable `server/ws_auth.ts` (`createWsAuth(deps)` factory -> `{ authenticateWebSocket, onConnection, attachUpgrade(server, wss) }`, wire vocabulary in named constants); in `server/main.ts`: exported `startServer(): Promise<http.Server>` + exported pure `routeHttpRequest(req, res)` dispatcher + `require.main === module` entry guard (NOT import.meta: esbuild empties it under cjs); `tests/server/` dir with `ws_auth.test.ts` + `importable_spine.test.ts` + `route_dispatch.test.ts` (the last added in Phase 01 QA: pins routeHttpRequest's OPTIONS-204 short-circuit + prefix dispatch by mocking the imported sub-dispatchers). NO `server/http/` dir this phase (that is Phase 4+). |
| 02 | DONE. `server/http/types.ts` (TYPE-ONLY frozen contracts; see "Phase 2 frozen contracts" above) + `server/http/config.ts` (pure `loadConfig`); `now()` clock injected into `ratelimit.ts` ONLY (ratelimit_db.ts does not exist until Phase 19), with `setRateLimitClock`/`resetRateLimitClock`/exported `WINDOW_MS`; `tests/server/{helpers,http}/` dirs + `tests/server/helpers/index.ts` barrel: `fake_http.ts` (FakeRes+makeReq) + `fake_ctx.ts` (fakeCtx+nextGuard) + `fake_db.ts` (CharactersDb/LeaderboardDb/ReportsDb + fakes + tsc drift guard) + `fake_ratelimit_store.ts` (FakeRateLimitStore) + `normalizer.ts` (NORMALIZER_PLACEHOLDERS) + `golden.ts` + `parity.ts` (runParity) + `registry_introspect.ts`; plus `tests/server/ratelimit_clock.test.ts` + `tests/server/http/config.test.ts`. Existing ad-hoc makeRes/makeReq suites NOT converted. |
| 03 | DONE. `tests/server/http/surface_inventory.ts` (106-row HEAD-anchored ledger, named DISPATCH/AUTH_SCOPE/REQUIRE_OWNED consts, `:param` rows carry the real RegExp in `match`, orphan flagged `unreachable:true`, leaderboard query-forks as `variant` rows) + `surface_inventory.test.ts` (route-count freshness gate: reads the 4 dispatcher SOURCE files, set-equality of exact `=== '<path>'` arms + `*Match` regex sources vs inventory, vacuous-pass guarded; + classification completeness); `content_type_classification.ts` (5 named classes PROBLEM_JSON/HTML/REDIRECT/BINARY/LEGACY_OKFALSE_405 + per-/api-path map; REDIRECT used by zero routes); `characterization.test.ts` + `characterization_admin_oauth_internal.test.ts` + `tests/server/fixtures/{main,admin,oauth,internal}/*.json` (57 byte-stable goldens via routeHttpRequest + Phase 2 goldenMaster/normalizer); `known_deviations.ts` + `known_deviations.test.ts` (12 seeded deviations). One biome.json line: golden-dir ignore `!tests/server/fixtures` (mirrors `!tests/parity/golden`). ZERO server/ or src/ change. |
| 04 | DONE. `server/http/path_pattern.ts` (pure compilePattern/no-regex guard + normalizePath + matchPattern + HttpMethod alias of Method/PatternSegment/CompiledPattern) + `server/http/router.ts` (createRouter over Map<HttpMethod,{static:Map,dynamic[]}>, MatchResult union, HEAD-as-GET, synthesized OPTIONS, honest 405+Allow, shape-based dup guard) + `tests/server/http/path_pattern.test.ts` + `tests/server/http/router.test.ts` (55 tests). PURE, not wired in until Phase 9. Did NOT touch index.ts/registry.ts (Phase 9). |
| 05 | DONE. `server/http/compose.ts` (`compose` Koa onion + `lastIndex` double-next guard, `runOnion` outermost one-response wrapper using a total `finalizeResponse`, `respondOnce` idempotent sender) + `server/http/context.ts` (`buildContext` -> frozen Ctx, match read only for params; `buildUrl` pins ctx.url authority + is throw-total; reuses `ratelimit.requestIp`; null-proto query/params; reqId carrier `reqIdStorage`/`newReqId`/`runWithReqId`/`currentReqId`) + `tests/server/http/compose.test.ts` (21) + `tests/server/http/context.test.ts` (22). `buildUrl` assigns path+search onto a fixed-origin URL (the QA pass closed a `//`-pathname authority-injection gap that the absolute-form-only test had masked). Imports frozen `Ctx/Middleware/Next` from types.ts (no redefine, no cycle). NOT wired in until Phase 9; no index.ts barrel. Phase 2 `fake_ctx.ts` UNTOUCHED. |
| 06 | DONE. `server/http/schema.ts` (PURE validator: `object/str/num/bool/enum_/optional` combinators -> `Schema<T> extends StandardSchemaV1<unknown,T>` with `decode()` + a thin codes-only `~standard.validate`; `Issue{pointer,code,params?}`, `DecodeResult<T>`, `Infer<S>`; stable codes type/required/min/max/int/minLength/maxLength/enum; all-issues-one-pass; `object()` reads declared keys via `Object.hasOwn` into a null-proto output; `num()`/`bool()` string coercion, `num()` decimal-only + `isSafeInteger`-int, `optional` clones object defaults) + `tests/server/http/schema.test.ts` (37). Imports the Standard Schema v1 type from the frozen `./types` (NO new `standard_schema.ts`); NO `index.ts` barrel (Phase 09). NOT wired in until Phase 8/9. QA gate (phase-06-qa.md) PASS: 0 BLOCKING, 1 SHOULD-FIX + 3 NIT all test-coverage, applied. |
| 07 | DONE. `server/http/error_codes.ts` (deep-frozen `as const` ERROR_CODES, `ErrorCode = keyof typeof ERROR_CODES`, 48 codes = 9 structural + 39 harvested, AIP-193 append-only snapshot test) + `server/http/errors.ts` (`HttpError`, `toAppError` exhaustive status table + `AppError.unexpected` flag, `applyImpliedHeaders` add-only case-insensitive, `normalizeSurface` EnvelopeKind|ErrorSurface->ErrorSurface, seven per-surface serializers, `mapError(err, ctx, opts?)->{status,headers,contentType,body}` with `opts.onUnexpected` sink) + `tests/server/http/error_codes.test.ts` (9) + `tests/server/http/errors.test.ts` (46) + `tests/server/http/error_leak.test.ts` (36, the 500-no-leak hard gate). Surface chosen by the route `RouteMeta.envelope` tag via `opts.surface` (default 'problem'), NOT per-prefix. PURE, wires NO routes (Phase 8 calls mapError; Phase 22 localizes codes). Reviewers (privacy-security-review + qa-checklist) 0 BLOCKING; 2 SHOULD-FIX + NITs applied. |
| 08 | DONE. `server/http/middleware/{with_errors,request_id,cors,metric_sink,body,raw_body,require_account,rate_limit}.ts` (withErrors single-response-authority [no rethrow]; withRequestId ALS rebind; withCors 'api'/'public' mirroring maybeCors/publicCors; the injectable MetricSink + noopMetricSink + withMetrics recording {route-template,method,status,durationMs}; withBody 413/400; withRawBody binary + Connection:close; requireAccount the one bearer resolver with the UNIFORM moderation gate closing the Discord bearer-gap [read/active/full, DB fns injected]; the thin rateLimit(policy) adapter over the existing booleans with five named policies, no ratelimit_db) + `server/http/client_error.ts` (handleClientError socket-destroy, registered in main.ts startServer, the one main.ts edit) + a single-source `DEFAULT_JSON_BODY_MAX_BYTES` added to server/http_util.ts + tests/server/http/{with_errors,request_id,cors,metric_sink,body,raw_body,client_error,require_account,rate_limit,onion_order}.test.ts (10 suites / 45). Importable but UNMOUNTED (Phase 9 mounts). No new error code appended. Reviewers (privacy-security-review + qa-checklist) 0 BLOCKING / 0 SHOULD-FIX; the one actionable nit (re-typed JSON cap) applied. |
| 09 | DONE. `server/http/registry.ts` (`ApiRegistry.resolve(method,path)->MatchResult<RouteDef>` reusing the Phase 4 router; `apiRoutes` EMPTY this phase; `createApiRegistry` sorts most-specific-first + `assertNoOwnedRouteShadowing` [the Phase 4 BOLA-shadow obligation] + createRouter dup-guard; `apiRegistry`) + `server/http/index.ts` barrel (re-exports router/compose/context/schema/errors/error_codes/registry/dispatch + type-only types) + `server/http/dispatch.ts` (`createApiDispatcher({registry,delegate,metricSink?})` -> fire-and-forget `(req,res)=>void`; matched -> `runOnion([withErrors,withMetrics,...route.middleware,handler])`, else `void delegate(req,res)` UNCHANGED; `selectApiEntry(mode,new,legacy)`; withRequestId omitted [runOnion binds the reqId ALS], withCors omitted [CORS top-level]) + wiring in `server/main.ts` (the /api arm now `void apiEntry(req,res)`; CORS+OPTIONS-204 lifted into `applyCorsAndPreflight`, one top-level source over both paths; `setApiDispatchMode` reads `loadConfig(process.env).dispatch` once at boot; prod-guarded `setApiDispatchModeForTests`/`resetApiDispatchModeForTests`) + `DEFAULT_DISPATCH` exported from `server/http/config.ts` (single-sources the pre-boot default) + `tests/server/http/{registry,dispatch,parity,completeness}.test.ts`. The dispatch flag is `API_DISPATCH` env -> `Config.dispatch` ('legacy'|'new', default 'legacy'; NOT flipped, Phase 25 flips). ZERO routes migrated (registry empty; every /api path delegates to handleApi UNCHANGED), so byte-for-byte identical to today (parity harness 0 divergences + Phase 3 goldens green). Reviewers PASS: privacy-security-review 0 BLOCKING/0 SHOULD-FIX, qa-checklist READY 0 BLOCKING/0 SHOULD-FIX (2 NITs, both handled). NO WS/sim/DDL/i18n change. QA GATE (phase-09-qa.md) PASS: 5-dimension audit 0 BLOCKING/0 SHOULD-FIX/2 NICE-TO-HAVE, both fixed (single-sourced the `DispatchMode` union in config.ts; corrected the unimported `index.ts` barrel header); one Phase 10+ sync-throw containment note recorded. |
| 10 | `server/leaderboard.ts` + `tests/server/leaderboard.test.ts`. |
| 11 | auth `routes` (on `server/auth.ts`) + `tests/server/auth.test.ts`. |
| 12 | `server/characters.ts` + `requireOwnedCharacter` loader + `tests/server/characters.test.ts`. |
| 13 | account `routes` (on `server/account.ts`) + `tests/server/account.test.ts`; em-dash fix in `src/main.ts` + `src/admin/i18n.locales/en_CA.ts`. |
| 14 | wallet `routes` (on `server/wallet.ts`) + `tests/server/wallet.test.ts`. |
| 15 | `server/reports.ts` + `tests/server/reports.test.ts`. |
| 16 | discord `routes` (on `server/discord.ts`) + `tests/server/discord.test.ts`; DISCORD_SCHEMA wired into `ensureSchema` (`server/db.ts`); `handleSwagClaim` dispatched. |
| 17 | admin `routes` (on `server/admin.ts`) + `tests/server/admin.test.ts`; admin-scope loader. |
| 18 | oauth + internal `routes` (on `server/oauth.ts`/`server/internal.ts`) + tests. |
| 18b | DONE. github + daily-rewards `routes` (on `server/github.ts`/`server/daily_rewards.ts`) + NEW `server/desktop_login_routes.ts` (sibling of the db-import-free `server/desktop_login.ts`, whose create core became `issueDesktopLoginCode`) + `requireInternalSecretFailClosed` and the daily-reward gate-pair constants in `require_internal_secret.ts` + `tests/server/{github,desktop_login,daily_rewards_routes}.test.ts` + 17 backfilled goldens. |
| 19 | DONE. NEW `server/ratelimit_db.ts` (PgRateLimitStore + RATELIMIT_SCHEMA + RATELIMIT_PRUNE_SQL, wired into `ensureSchema` + the to_regclass boot assertion) + `tests/server/{ratelimit,ratelimit_db}.test.ts`. Edited: `server/ratelimit.ts` (RateLimitOutcome everywhere + `rateLimitNow()` + the tier-2 store slot), `server/http/middleware/rate_limit.ts` (two-tier resolver; the static retryAfterSeconds field removed), `server/http/errors.ts` (`rateLimit429Headers`; there IS no respond429, that packet name was stale), `server/db.ts`, `server/main.ts` (boot wiring) + 10 call-site files + 13 test files. |
| 20 | DONE. NEW `server/market_backfill.ts` (constants MARKET_KEY_PREFIX / LEGACY_MARKET_KEY / MARKET_BACKFILL_MARKER_KEY + `marketStateKey(realm)` moved here, db.ts re-exports; pure partition/merge/conservation helpers + `runMarketBackfill`) + `tests/server/market_backfill.test.ts` + `tests/server/market_realm_isolation.test.ts` + `tests/character_state_backcompat.test.ts` + `docs/api-pipeline/phase-20-rollback-runbook.md`. Edited: `server/db.ts` (ensureSchema backfill wiring + openMarketWriteGate boot gate + pure-read loadMarketState), `tests/market_db.test.ts`, `tests/save_character_and_market.test.ts`, `tests/schema_wiring.test.ts`, `server/CLAUDE.md`. |
| 21 | `server/http/middleware/security_headers.ts` + top-level wrapper in `server/main.ts`; 415 log-only + Origin/Sec-Fetch check + tests. |
| 22 | `apiError.*` client catalog module; `userFacingApiError` extension in `src/main.ts`; per-surface code-parity Vitest. |
| 23 | pino-shaped logger facade + access log; `/metrics` exporter (`prom-client`); `/livez` + `/readyz`; tests. |
| 24 | validated fail-fast config (extend `server/http/config.ts`); named constants module; timeouts in `startServer()`; perf/tick-jitter gate test. |
| 25 | docs (`server/CLAUDE.md`, root `CLAUDE.md`, new `server/http/CLAUDE.md`, i18n docs); `npm run new:endpoint` scaffold; flag-default flip. |
| 27 | `server/http/mismatch_warn_throttle.ts` (the per-(method, route-template) fixed-window flood bound for the two log-only mismatch sinks) + `tests/server/http/mismatch_warn_throttle.test.ts`; sink factories `createContentTypeMismatchSink` / `createCrossSiteMismatchSink` on the two gate modules. |
| 28 | `server/http/attack_signals.ts` (the `AttackSignalSink` contract + `setAttackSignalSink`/`attackSignalSink` process-wide slot). Edited: `server/http/metrics.ts` (the four attack-signal Counters + `HttpMetrics.attackSignals`), `server/http/types.ts` + `context.ts` + `tests/server/helpers/fake_ctx.ts` (the additive `Ctx.route` :param-template field), the four emission sites (`server/http/middleware/rate_limit.ts`, `server/ratelimit.ts`, `server/http/middleware/require_owned.ts`, `server/ratelimit_db.ts` [pg.hit proxy replaced, `metrics` option removed]), `server/main.ts` boot wiring, and their six test files. |

## New endpoints / route tables per phase
- **P10 (public reads) DONE:** `/api/leaderboard` (incl. `?board=guilds`, legacy `?limit=N`,
  `?scope`), `/api/arena/leaderboard`, `/api/releases`, `/api/project-stats`, `/api/search`,
  `/api/realms`, `/api/public/characters/:name/sheet` (by NAME, not a numeric id), dev-gated
  `/api/perf`, `/api/status` trimmed to `{ok,realm,players_online}`. Convention B DEFERRED
  (consumer audit: clients read `leaders`, not `items`); the anonymous-friendly bearer resolver
  (`requireAccount({optional:true})`) closes the `/api/realms` + `/api/search` authz gap. All
  served from `server/leaderboard.ts` RouteDefs; legacy arms kept for flag-off rollback.
- **P11 (auth):** `/api/register`, `/api/login`, `/api/native-attestation/challenge`.
- **P12 (characters BOLA) DONE:** `/api/me/characters`, `/api/characters` (GET/POST),
  `/api/characters/:id` (DELETE), `/rename`, `/takeover`, `/standing`, `/sheet` (owner). Served
  from `server/characters.ts` RouteDefs; legacy arms kept for flag-off rollback. The generic
  `requireOwned` loader (`server/http/middleware/require_owned.ts`) is account-scoped, decodes
  `:id` with num() (422 before any DB call, NaN-safe), stashes the row at `ctx.state.character`
  (the frozen-Ctx slot, since Ctx has no per-resource field), and denies cross-account/absent
  with the legacy 404 (`bolaOwned404`) + a `bola_denied` deny-log carrying no cross-account
  existence signal. Auth via per-route legacy-body guards (activeGuard/readGuard), NOT the
  problem+json requireAccount (the no-auth 401 goldens pin `{error:'not authenticated'}`). NEW
  per-action limiters create/rename/delete/takeover (`newLimiterCharacterMutations`, reusing
  rate_limit.exceeded, no code append). `characterBodyValidationRemap` deviation for the withBody
  POST/DELETE framework-error remap. Deny-by-default coverage: metadata (checkRequireOwnedCoverage
  over apiRoutes) + functional (ownership_coverage.test.ts drives every account-owned :id route
  with a null loader -> 404). Operator-scope loader is Phase 17 (DONE): `requireAdminTarget`
  decodes :id (422 on a bad id) + marks `ownerScope:'operator'` (excluded from the account clause),
  but does NOT do a per-object 403 denial - the admin operator has universal authority, so
  requireAdmin's 401 is the operator gate and the handlers keep their own legacy 404 (parity-first;
  the doc's "denial 403" is the seam for a future finer sub-scope, not a current behavior).
- **P13 (account, +v0.20.0):** `/api/account/*` family (password/logout/email(+change/verify/set-initial, set-initial added at the v0.20.0 merge)/
  deactivate/export/marketing/2fa(setup/enable/disable)/companion-token); `email/verify` +
  `email-unsubscribe` classified PROBLEM_JSON (both answer application/json; Phase 3 QA
  corrected an initial HTML misclassification).
- **P14 (wallet):** `/api/wallet/link/challenge`, `/api/wallet/link` (POST/DELETE),
  `/api/wallet` (GET), `/api/woc/balance`, `/api/card` (withRawBody), `/api/referrals`.
- **P15 (reports/telemetry):** `/api/reports` (new reports.create limiter), `/api/bug-reports`,
  `/api/perf-report` (keep 200-not-429), `/api/site-presence`.
- **P16 (discord):** `POST /api/auth/discord/start`, `GET /api/auth/discord/callback` (HTML
  bounce, NOT a 302; the only /api HTML route), `GET /api/discord`, `DELETE /api/discord`,
  `POST /api/discord/swag/claim` (handleSwagClaim, newly dispatched).
- **P17 (admin):** the ~19 `handleAdminApi` branches as RouteDefs; enum-segment routes
  (suspend|unsuspend|ban|unban) become `:param` + schema-validated enum; `{success,data,error}`
  + page/limit pagination frozen.
- **P18 (oauth + internal):** `/oauth/token`, `/oauth/revoke`,
  `/oauth/device_authorization`, authorize-POST, device-POST (RFC 6749 JSON); GET
  authorize/device pages stay on the top-level ladder (HTML); `/internal/restart-countdown`
  + the `/internal/discord/*` bot-channel endpoints (secret gate preserved; shipped as TEN
  incl. the daily-rewards-winners pair, so P18 = 11 internal routes, not this row's
  original 9).
- **P18b (late arrivals, net-new via release merges) DONE:** the github identity family
  (`POST /api/auth/github/start`, `GET /api/auth/github/callback` HTML, `GET /api/github`,
  `DELETE /api/github`; v0.18.0); desktop-login (`POST /api/desktop-login/create`,
  `POST /api/desktop-login/exchange`; v0.19.0; the create-auth-scope security fork was
  RESOLVED FIX, maintainer-confirmed: full-session auth on BOTH serving paths, read tokens
  403, the desktopLoginCreateFullScope deviation records the closed escalation); daily-rewards
  player (`GET /api/daily-rewards`, `POST /api/daily-rewards/spin`,
  `GET /api/daily-rewards/history`; full-scope via createActiveGuard mirroring the ladder's
  bearerActiveAccount, no limiter by confirmed decision) + the `/internal/daily-rewards/*`
  ops trio (`pending-payouts`, `payout-history`, `mark-payout`; POST, the fail-closed
  requireInternalSecretFailClosed gate, admin envelope; the composite delegate still serves
  every off-table shape until Phase 25). All served from `server/github.ts` +
  `server/desktop_login_routes.ts` + `server/daily_rewards.ts` RouteDefs; legacy arms kept
  for flag-off rollback. Corpus rows for all 12 are FILED (daily-rewards six at the
  2026-07-02 drift audit; the rest at their merges; the create row flipped bearer -> full
  with the scope fix).
- **v0.20.0 merge (c916d296a, 2026-07-03, migrated inside the merge commit):**
  `POST /api/account/email/set-initial` (the mandatory-email backfill; account family,
  activeGuard, shared handleAccountSetInitialEmail on both arms; accountBodyValidationRemap
  applies); `GET /api/daily-rewards/leaderboard` + `POST /internal/daily-rewards/leaderboard`
  (paginated leaderboard reads; both families now FOUR routes each, same guards/gates and
  shared sub-dispatcher cores as their siblings); `GET /admin/api/detection-calibration`
  (bot-detector calibration histograms; requireAdmin, AdminRuntime pick extended with
  detectionCalibration). Corpus rows filed at the merge (SURFACE_INVENTORY 120 -> 124,
  content-type + completeness + mounting sweeps extended, captureBothModes db-free re-pins
  added for all three authed arrivals; the internal ladder derivation is now 15, the ops
  family 4, completeness MIGRATED_ROUTES 65 rows). The same merge made signup email MANDATORY
  (register 400s a missing/invalid email with the existing email.invalid code; register and
  login answer emailMissing; both arms mirrored), and added the WS-side global inbound
  message limiter `server/msg_rate_limit.ts` (a per-connection token bucket in
  game.ts handleMessage; SEPARATE from the Phase 19 REST two-tier limiter, a Phase 24
  tunables-inventory item). The set-initial 409 'use verified email change' bodies stay
  UNCODED by decision, matching the Phase 22 adjudication of the sibling 410
  handleAccountSetEmail (flow-control refusals the client handles by flow; a code, e.g.
  email.already_set, can be appended later without breaking the prose fallback).
  MAINTAINER TO-DO RESOLVED (2026-07-03, during Phase 24, with a corrected premise): the
  private bot_detector repo's main already implemented listCalibrationHistograms (private
  repo PR #7), so the overlay was refreshed FROM it instead of committing the merge-session
  stopgap upstream; its environment_probe.test.ts is locally removed (it imports the
  unshipped src/game/client_env). See the Phase 24 record in progress.md; re-delete that
  test after any future overlay rsync.

## New DB tables / columns per phase
- **P16:** WIRE `DISCORD_SCHEMA` (5 tables: `discord_links`, `discord_oauth_states`,
  `reward_points`, `reward_ledger`, `swag_claims`) into the `ensureSchema` statement list
  under the advisory lock (currently UNWIRED on this branch; the canonical trap).
- **P19:** DONE. NEW `RATELIMIT_SCHEMA` table `rate_limits` (policy TEXT, key TEXT,
  window_start BIGINT, count INTEGER, PRIMARY KEY (policy, key)) in
  `server/ratelimit_db.ts`, ADDED to the `ensureSchema` list under
  `pg_advisory_xact_lock` after GITHUB_SCHEMA, with a to_regclass boot-time
  table-existence assertion (fail-fast, scoped to this table) and the
  RATELIMIT_PRUNE_SQL dead-window boot sweep (static statement, database clock,
  2 x WINDOW_MS horizon); global-keyed single-statement atomic UPSERT tier-2 backstop.
- **P20:** DONE. NO new table, NO DDL at all: the backfill is pure DML on the existing
  `world_state` table. New ROWS: per-realm `market:<realm>` partitions plus the
  `'market_backfill_done'` completion marker; the legacy bare `'market'` row is RETAINED
  read-only forever (rollback artifact; `saveWorldState` hard-rejects writes to it).
  Runs inside `ensureSchema`'s `pg_advisory_xact_lock` transaction (atomic: marker and
  partitions commit together or not at all); marker probe makes every later boot a
  single-SELECT no-op. JSONB `MarketSave`/`CharacterState` shapes UNCHANGED; the
  `serializeCharacter` defensive `??` default round-trip is pinned by
  `tests/character_state_backcompat.test.ts`.

## New error codes + i18n keys + the userFacingApiError matcher change (Phase 22)
- `error_codes.ts` (created P07) is the single `as const`, append-only (AIP-193) source;
  each migration phase appends `domain.reason` codes (reuse existing vocabulary). New codes
  include the Discord family (P16), the previously-unmatched wallet "rate limited" responses
  (P14), and the new character/reports limiter codes.
- **P07 seeded (48 codes, frozen):** 9 structural = `validation.failed`[issues], `json.malformed`,
  `auth.token_missing`, `auth.token_invalid`, `auth.forbidden`, `body.too_large`[maxBytes],
  `db.conflict`, `rate_limit.exceeded`[retryAfterSeconds], `internal.error`; + 39 harvested
  reconciled 1:1 to the existing `userFacingApiError` identities across `auth.*` (invalid_credentials,
  required, web_login_only, too_many_attempts, too_many_failed_attempts, current_password_incorrect,
  password_incorrect, verification_failed), `account.*` (username_invalid/not_allowed/taken/mismatch,
  password_too_short/too_long, characters_online, deactivated, not_found), `character.*` (name_invalid/
  not_allowed/taken, invalid_class, limit_reached, not_found, online, rename_not_permitted,
  delete_confirm, already_in_world, taken_over, rename_required), `moderation.*` (suspended_until[date],
  suspended, banned, force_rename), `email.*` (invalid, unchanged), `two_factor.*` (code_invalid,
  setup_required, already_enabled, not_enabled). ONLY parametric harvested code: `moderation.suspended_until`[date].
  Each carries an `// identity:` comment naming its English source string for the P22 matcher. The two
  WS-disconnect identities (connectionLost/connectionRejected) were NOT harvested (net-layer, not REST;
  append-only allows a later add). AIP-193 forbids renaming any of these, so P22 wires the client
  catalog to these exact names.
- **P22 matcher change:** extend `userFacingApiError` (`src/main.ts`) to look up emitted
  CODES directly in the client catalog instead of reverse-matching English prose; port the
  parametric cases (suspended-until `{date}`, the `{seconds}` rate-limit families) to
  `{code, params}`; preserve its dual REST + WS-disconnect-reason role.
- Add `apiError.*` English catalog entries; params formatted client-side via
  `formatNumber`/`formatDuration`/`Intl`. A per-surface code-parity Vitest asserts every
  server-emitted code resolves in EVERY locale (append-only frozen), covering the ~30-45
  EXISTING REST strings (currently unguarded; S3 scans only the WS path) + the new
  Discord/guild codes.
- Em-dash fix (paired with P13): swap the U+2014 rate-limit dashes to commas in the SAME
  change as the matcher (prefix unchanged so startsWith still resolves); also fix
  `src/admin/i18n.locales/en_CA.ts`.

## New named constants / config (Phase 24)
- A validated fail-fast config read ONCE at boot via the pure `loadConfig(env)` from P2
  (HSTS-in-prod, REQUIRE_WEB_LOGIN, realm/native-app origins, limiter DSN, the dispatch
  flag), replacing scattered `process.env` reads; log the active dispatch path at boot and
  alert if the old path is active in prod. The env inventory sweeps ALL of `server/`, not
  just main.ts (v0.19.0 added request-path reads elsewhere: `WOC_DAILY_REWARD_SERVICE_SECRET`
  per request, `WOC_DAILY_REWARD_SERVICE_URL`, `WOC_DAILY_REWARD_CONFIG_TTL_MS` at module
  load in server/daily_rewards.ts; server/desktop_login.ts adds only the plain named
  constant `DESKTOP_LOGIN_TTL_MS`, a no-magic-values sweep item, not an env read).
  CONSCIOUS CARVE-OUTS from the read-once rule: the internal secret gates
  (require_internal_secret.ts's RESTART_COUNTDOWN_SECRET / DISCORD_BOT_SECRET and the
  daily-reward gate) read their env PER REQUEST by design (env-unset = feature-off /
  fail-closed at request time); Phase 24 names them as exceptions or re-decides them
  explicitly, never folds them silently into boot config. The daily-rewards day-start comes from the payout
  service's /daily-config HTTP payload (TTL-cached in-process) with the named default
  `DEFAULT_DAY_START_UTC_MINUTES`, NOT an env and NOT persisted in the DB.
  - SECRET-LEAK GUARD (Phase 2 QA security note): `Config` returns secrets as plain readonly
    string fields (`databaseUrl`, `turnstileSecret`, `githubToken`). `loadConfig` itself never
    logs them, but the moment this is wired into boot, guard against a casual `console.log(config)`
    or error-serialization dumping the whole object: give `Config` a redacting `toJSON` (and/or a
    `util.inspect.custom`), or never hand the config object to a logger. Log only the dispatch
    path, never the config.
- Server timeouts in `startServer()`: `requestTimeout`, `headersTimeout`,
  `keepAliveTimeout`, `maxHeaderSize` as named constants (mindful of the WS upgrade
  handshake and the 1 MB card upload).
- Consolidate every tunable (rate limits + windows, byte caps, page sizes, timeouts, TTLs,
  pool sizes, maxPayload, drain window) into named constants with unit + comment; POLICIES
  values DERIVE from existing constants.
  ADJUDICATION (2026-07-03, post-P24): the second v0.20.0 merge added a NEW tunables source
  the P24 inventory predates: src/sim/game_config.ts (TUNING.worldSeed, TUNING.respawnSeconds,
  DEFAULT_RATES), a sim-side override LAYER applied from the game_config_overrides JSONB row
  at boot. Adjudicated like msg_rate_limit.ts: it is NOT a POLICIES source and not a
  consolidation target (its defaults deliberately REPRODUCE the historical literals so an
  empty override document changes nothing), so P24's "no tunable literal appears twice"
  acceptance is unaffected; any future audit of server tunables must list it as the third
  source alongside the named-constant block and msg_rate_limit.ts.
- Add the perf/tick-jitter acceptance gate (pipeline adds < X ms p99, tick p95 stays under
  0.8 x DT). DONE: X chosen here as PIPELINE_ADDED_P99_BUDGET_MS = 1.0 ms
  (server/http/perf_gate.ts, perf_gate suite green, measured about 0.005 ms p99).

## Architecture decisions (locked, independently confirmed by code + 2024-2026 sources)
- **RFC 9457 `application/problem+json`** as the `/api` error format (obsoleted RFC 7807,
  no breaking member change), with a stable machine `code` as the load-bearing field;
  clients localize by code, MUST use type/code not parse `detail`.
- **Per-surface envelopes chosen by `mapError`, never one global flip** (problem+json /api,
  RFC 6749 /oauth, `{success,data,error}` /admin); all three shapes exist in code today.
- **The 422 / 400 / 413 / 429(+Retry-After) status model** (RFC 9110: 422 is now core HTTP;
  RFC 6585), a deliberate documented knownDeviation from today's 400-for-validation /
  500-for-malformed.
- **Hand-rolled ~150-line validator** conforming to the Standard Schema v1 `~standard` type
  shape with `Infer`-derived handler types (server ships nothing to a browser, so Valibot's
  bundle win is moot; the seam keeps a zero-churn swap open).
- **In-house static-Map table router** (literal segments + plain `:param`) over
  URLPattern/regex, 404-vs-405+Allow before auth, HEAD-for-GET, synthesized OPTIONS,
  trailing-slash normalization, no-regex-routing guard (ReDoS-safe by construction).
- **Koa-compose recursive-dispatch onion** (~15 lines) with a double-next guard,
  cheap-reject-first (IP-keyed before body+DB, account-keyed after auth).
- **Two-tier rate limiter** (tier-1 in-memory IP gate first; tier-2 global-keyed atomic
  UPSERT in `ratelimit_db.ts`), limiter return-shape boolean -> `{remaining,resetSeconds}`;
  `authThrottled` genuinely cannot be pre-handler middleware.
- **reqId via built-in `node:async_hooks` AsyncLocalStorage** (stable since v16.4.0, zero
  deps), echoed as `X-Request-Id` on every response, behind a pino-shaped logger facade;
  full OpenTelemetry deferred; `prom-client` only when `/metrics` lands.
- **BOLA via a load-then-authorize `requireOwned*` loader** (scope-before-find,
  account-scoped query) + a deny-by-default coverage test + structured deny logging;
  session-id == request-id comparison is explicitly insufficient.
- **Top-level security-headers wrapper** on the createServer prefix ladder (not just the
  JSON onion), NO COEP:require-corp, full CSP deferred to a Report-Only effort.
- **The World Market realm-scope bug is real** (exactly two writers of the bare `'market'`
  key + a global read sharing one PRIMARY-KEY row; realms on one DATABASE_URL collide
  last-writer-wins). The em-dash fix is matcher-safe; the draft-11
  RateLimit/RateLimit-Policy header syntax (q/w/r/t) is a non-final Internet-Draft to pin
  with a version comment.

## OPEN items + known gotchas
- **The source-spec 4.9 request-layer RED catalog is COMPLETE (Phase 28, 2026-07-05, Option A:
  SHIP).** All six "this PR" series are live on the ONE per-instance /metrics registry
  (server/http/metrics.ts): the two Phase 23 metrics plus rate_limit_hits_total{policy, key_kind}
  (both tiers, emitted at the two 429 throws in the rate_limit middleware),
  auth_failures_total{kind: bad_credentials | throttled} (emitted at the server/ratelimit.ts
  recordAuthFailure / authThrottled choke point, so BOTH dispatch arms plus discord/account
  re-auth are covered by one site), bola_denied_total{route} (alongside the requireOwned
  deny-log, labeled by the NEW Ctx.route :param template, never ctx.path), and
  pg_limiter_writes_total{policy} (one increment per tier-2 upsert). Emission sites reach the
  exporter through the process-wide server/http/attack_signals.ts slot (setAttackSignalSink at
  boot, noop default, mirroring setRateLimitTier2Store); every increment is try/catch-guarded so
  an observability write can never break the rejection path it observes. The Phase 19
  http_requests_total{route='ratelimit.pg.hit'} proxy row is REPLACED by the real series (ONE
  source of truth, no double-count; the pg store no longer takes a MetricSink option and the
  access log no longer carries pg.hit pseudo-lines). Label discipline: policy / kind / key_kind /
  route-TEMPLATE only, all from small fixed sets; never an ip, account id, token, or concrete
  resource id. Reconciliations recorded: (1) the spec's alert example
  rate_limit_hits_total{policy=~"auth.*"} predates Phase 19's policy naming, and the fused
  register/login/desktop-login per-IP 429s are legacy-parity inline writes outside the policy
  middleware, so the brute-force dashboard reads auth_failures_total plus the 429 rows of
  http_requests_total on the auth routes instead; (2) the spec preamble's "every metric carries
  realm" is intentionally not implemented, matching the two Phase 23 metrics (one process = one
  realm; realm rides as a Prometheus scrape-config external label); (3) bola_denied_total counts
  the 404-bodied anti-enumeration denials (the spec table's "403s" wording predates the locked
  404 decision).
- **The pre-flip mismatch-sink amplification watch-item (Phase 21 QA) is RESOLVED (Phase 27,
  2026-07-04).** The two log-only mismatch sinks (content_type.ts, origin_check.ts), which run
  AHEAD of the route-local rate limiters, are bounded by server/http/mismatch_warn_throttle.ts:
  at most MISMATCH_WARN_MAX_PER_WINDOW (5) warn lines per MISMATCH_WARN_WINDOW_MS (60s) window
  per (method, route-template) key, per gate. Cardinality stays O(registered routes), never
  O(request paths). The flood signal is never dropped silently: the first admitted line of each
  new window carries the prior window's suppressed count. The throttle gates ONLY the warn line;
  the enforce decision (415/403) is taken in the middleware independently, so a future
  API_CONTENT_TYPE_ENFORCE / API_ORIGIN_CHECK_ENFORCE flip rejects unaffected (its warn lines
  ride the same bound). This satisfies, retroactively to the Phase 25 default flip, the Phase 21
  QA precondition "do not set API_DISPATCH=new in ANY environment before those bounds land":
  the flip is now consistent with the packet's own gate. Enforce-flip audit note: a suppressed
  origin-gate line can hide a DISTINCT origin value; a recurring legitimate origin re-surfaces on
  any (method, route-template) key not saturated by a flood, but under a sustained flood of ONE
  key a low-rate origin on that same key can stay suppressed every window, so the audit must not
  treat the warn sample as exhaustive for flooded keys (if that ever matters, capture distinct
  origins in a separate bounded set rather than widening this bound).
- **Phase 18b LANDED (2026-07-02), unblocking Phase 25's ladder deletion.** All twelve
  release-merge routes (github 4, desktop-login 2, daily-rewards 6) are now router-owned
  under 'new' AND legacy-served under 'legacy'. The v0.20.0 merge (c916d296a, 2026-07-03)
  grew that release-merge set to SIXTEEN, all four migrated inside the merge commit itself:
  POST /api/account/email/set-initial (account family, activeGuard),
  GET /api/daily-rewards/leaderboard + POST /internal/daily-rewards/leaderboard (the
  daily-rewards families are now 4 player + 4 ops), and GET /admin/api/detection-calibration
  (the admin ladder is now 33 branches / 19 GET reads). The SECOND v0.20.0 slice
  (2026-07-03, release tip 3e1bc17c4) grew it to TWENTY-SIX: the 10-route housekeeping
  family (/admin/api/housekeeping/*), 10 RouteDefs sharing one parity-by-construction
  handler that called the handleHousekeepingApi sub-dispatcher whole. [FIFTH-SLICE UPDATE
  2026-07-04: the release reverted housekeeping entirely, so that family, its RouteDefs,
  and its parity pins are GONE; the release-merge set is 34 and the admin surface counts
  38 RouteDefs.] [v0.22.0 SLICE UPDATE 2026-07-05: the staff/antibot/CAPI admin family
  adds 8 routes migrated inside the merge commit, so the release-merge set is 42 and the
  admin surface counts 46 RouteDefs; the legacy admin ladder grew by the same 8 branches
  release-side.] That slice also forced a structural change that SURVIVES the revert:
  GameServer construction moved off module load, so main.ts exposes the memoized
  liveGame() accessor; production first-touches it in startServer(), and the import-main
  test harnesses construct lazily on first request (the overrides-before-construction
  ordering premise died with the feature). Each surviving route is router-owned AND
  legacy-served with corpus rows, mounting-sweep coverage, and captureBothModes re-pins
  filed at the merge. The deletion exit criteria (end of this file, written by Phase 25)
  carve out the deliberately delegate-served shapes (the oauthInternalOffTable405 set +
  HEAD-to-GET + the 18b remainder: the daily-rewards prefix-arm oddities [wrong method,
  unknown subpath, the no-slash sibling], the github callback's non-GET arm [only GET is
  registered, so a wrong-method request delegates to the ladder's terminal 404 'unknown
  endpoint' today and flips to the table 405 at the deletion, the systemic
  planned405BeforeAuth framing; pinned old-vs-new in parity.test.ts at the 18b QA gate],
  and the ops family's family-wide PRE-PATH 401,
  which the table cannot reproduce per-route and whose recreation-or-loss must be
  adjudicated at ladder deletion, per dailyRewardsOpsBodyValidationRemap). Also
  stale-on-flip: the swag-claim row's `unreachable: true` (now ALSO excluded by name from
  the freshness gate's registry-union source side; re-annotate both together) and the four
  limiter-column rows
  (reports, characters-POST, wallet-link x2) document the LEGACY arm and mislead once the
  default flips; the next-release deletion PR re-annotates them (exit criteria section 3).
- **The freshness gate's prefix-delegation blind spot is CLOSED but the lesson stands.**
  The gate scans DISPATCHER_SOURCES (now five files incl. server/daily_rewards.ts) and,
  since the second v0.20.0 merge, ALSO counts registered RouteDefs (non-:param registry
  paths, minus rows flagged unreachable) as source-side dispatch arms. A future module
  that matches its own dispatched paths behind a `startsWith` prefix arm therefore has two
  compliant shapes: (a) it compares FULL paths (daily_rewards.ts): add it to
  DISPATCHER_SOURCES + completeness.test.ts's LEGACY_SOURCE_URLS; or (b) it compares sliced
  SUFFIXES the text scan cannot see (the since-reverted housekeeping_api.ts was the one
  example): it MUST be router-owned, because
  only its RouteDefs make it visible to the corpus-derived gates. A suffix-comparing module
  with NO RouteDefs is invisible exactly as the six daily-rewards routes were.
- **Phase 9 dispatcher now fronts /api (load-bearing for every migration phase).** The new
  in-house dispatcher (`server/http/dispatch.ts` `createApiDispatcher`) sits in front of the
  legacy `handleApi` via a per-path catch-all delegate, gated by the single `API_DISPATCH`
  flag (read via `loadConfig` once at boot; `Config.dispatch`, default `DEFAULT_DISPATCH='new'`
  since the Phase 25 flip; `API_DISPATCH=legacy` is the one-flag rollback).
  The FLAG is the master on/off (rollback = flip it, the new pipeline is never entered); the
  DELEGATE is the partial-migration mechanism (an un-matched /api path falls through to the
  legacy ladder unchanged). CORS + the OPTIONS-204 preflight are now ONE top-level wrapper
  (`applyCorsAndPreflight` in main.ts) over both paths, so a rollback cannot drop preflight and
  the delegated/onion paths cannot diverge on CORS. The dispatcher preserves the createServer
  non-awaited `void` semantics so the Phase 5 `runOnion` wrapper owns the ONE response.
  Registry-completeness gate semantics: router-owned UNION delegate-served must equal the
  old-ladder path set (`tests/server/http/completeness.test.ts`, with a non-vacuous negative
  control). The dual-path parity net (`parity.test.ts`) + the completeness gate are now
  load-bearing and run on every rebase.
- **Phase 10+ migration handoff (from Phase 9 qa-checklist NIT b).** The dispatcher delegates
  on the `methodNotAllowed` and `options` MatchResult kinds while the registry is empty, so the
  Phase 4 router-synthesized 405/OPTIONS is never emitted yet. When a route migrates and its
  legacy arm is removed, the migration phase MUST ensure the route still returns an honest 405
  under a wrong method (and the synthesized OPTIONS) via the new path, not a silent fallthrough.
  The completeness gate's never-double-serves clause forces the legacy-arm removal; the migration
  phase owns emitting the 405/OPTIONS for the now-router-owned path.
- **Phase 10+ sync-throw containment (from Phase 9 QA correctness audit).** `routeHttpRequest`
  calls `void apiEntry(req,res)` OUTSIDE any try/catch, and the flag-on dispatcher runs
  `registry.resolve()` (and, for a matched route, `buildContext()`) SYNCHRONOUSLY before the
  delegate/onion, whereas legacy `handleApi` wraps its whole body in try/catch. With the empty
  Phase 9 registry this is inert (`match` over empty method tables cannot throw and `buildContext`
  is never reached), so there is NO Phase 9 behavior change. But once a route is registered
  (Phase 10+), a synchronous throw from `resolve`/`buildContext` would escape `routeHttpRequest`
  rather than becoming a 500. The migration phase MUST keep the per-request onion the sole failure
  channel: the throw-capable work belongs inside `runOnion` (already the case for the handler and
  route middleware), not in the synchronous pre-onion prefix.
- **Stale anchors.** Every main.ts/db.ts line anchor in the SPEC is stale (main.ts ~2350 lines as of the third v0.20.0 merge). Re-anchor on symbol names and route strings, never line
  numbers. Phase 03 does the
  re-inventory + a route-count freshness gate; the market/em-dash fixes anchor on function
  names and the literal strings.
- **Non-JSON `/api` classification.** A blanket 415 + JSON-only `withBody` + blanket
  problem+json would break `POST /api/card` (binary) and
  `GET /api/auth/discord/callback` (text/html bounce, not a 302; the only /api HTML route).
  (`GET /api/email/unsubscribe` + `GET /api/account/email/verify` answer application/json, so they do
  not break the blanket; Phase 3 QA corrected an initial HTML misclassification.) Classify by response content-type; ship a
  `withRawBody` variant; exempt declared non-JSON routes; 415 log-only first until native
  (Capacitor) traffic confirmed. Design task that must PRECEDE the error-model phase.
- **compose-no-auto-respond rule.** `compose()` returns a promise and does NOT send a
  response or catch on its own; raw `node:http` leaves the socket hanging on an uncaught
  throw. `withErrors` must be OUTERMOST AND the top-level `compose(ctx)` call must be wrapped
  to guarantee exactly ONE idempotent response on both the resolve and throw paths
  (headersSent/writableEnded guarded). A top-level `clientError` handler must destroy the
  socket. Mandatory, not optional.
- **Perf/tick gate RESOLVED (Phase 24, 2026-07-03).** The acceptance constant is
  PIPELINE_ADDED_P99_BUDGET_MS = 1.0 ms p99 (measured about 0.005 ms) with
  TICK_P95_CEILING_RATIO 0.8 x DT, both in server/http/perf_gate.ts; the perf_gate suite
  pins it (PERF_GATE_WALLCLOCK=1 runs the wall-clock arm).
- **Old-ladder deletion exit criteria RESOLVED (Phase 25).** The gate, its carve-outs, the
  metric-instrumentation caveat, the owner, and the full deferred-items handoff now live in
  `## Old-ladder deletion exit criteria (next release)` (end of this file). One correction the
  writeup makes explicit: the delegate/old-ladder path is currently UNMETERED (withMetrics is
  mounted only on the matched-route onion, not on the per-path delegate), so there is no
  existing `http_requests_total` label that counts old-ladder traffic; the deletion PR must add
  a bounded delegate counter FIRST, then read it. The deletion is its own next-release PR.
- **Rollback tradeoff accepted.** A flag flip reverts the hardening too (the suite targets
  the new path). This is the chosen model; not an open question, but keep it visible.
- **`handleSwagClaim` orphaned, RESOLVED (Phase 16, 2026-07-01).** Was implemented + tested
  in `discord.ts` but never dispatched; Phase 16 wired the full seven-route Discord family.
  The legacy arm's `unreachable: true` inventory row is re-annotated at the ladder deletion
  (exit criteria section 3).
- **DISCORD_SCHEMA precedent trap (historical; the premise was already stale at Phase 16).**
  Recorded here as defined-but-unwired, but progress.md Phase 16 found it HAD been wired
  into the `ensureSchema` list since PR #1075 with a `schema_wiring.test.ts` guard. The
  lesson stands: always add new schemas to the `ensureSchema` list with a boot-time
  table-existence assertion (`RATELIMIT_SCHEMA` did, Phase 19).
- **`isIpBlocked` + turnstile parity gap, SATISFIED (Phase 16, 2026-07-01).** Carried
  forward from prior Discord reviews; the migrated Discord endpoints carry `isIpBlocked`,
  and Phase 16 QA re-confirmed the pre-existing turnstile deferrals were not widened.

## Old-ladder deletion exit criteria (next release)

The legacy handler ladder (main.ts `handleApi` + the `handleAdminApi` / `handleOAuth` /
daily-rewards+`handleInternalApi` composite delegates) is RETAINED behind the flag this
release (Phase 25 only flipped the default to 'new'). Its removal is a named NEXT-RELEASE
follow-up PR, owner **Fernando (maintainer)**, and may land ONLY when the gate below is met.
`server/http/CLAUDE.md` links here by this exact heading; do not rename it.

### 1. The metric gate (and the instrumentation it needs FIRST)

The RED exporter (`server/http/metrics.ts`) emits `http_requests_total{route, method, status}`
(name const `HTTP_REQUESTS_TOTAL`) and `http_request_duration_seconds`, where `route` is the
`:param` TEMPLATE. IMPORTANT CAVEAT discovered at the flip: `withMetrics` is mounted ONLY on
the matched-route onion (`server/http/dispatch.ts` `createApiDispatcher`), NOT on the per-path
catch-all delegate. So today a delegate-served request (an un-migrated path, a HEAD-as-GET
match, a wrong-method-on-a-migrated-path that resolves `methodNotAllowed`, or any off-table
shape) traverses NO `withMetrics` and emits NEITHER an `http_requests_total` row NOR an access
line. There is therefore NO existing metric label that counts old-ladder traffic, and a naive
"old-path label shows zero" gate is not directly measurable.

The deletion PR must therefore, as its FIRST step, instrument the delegate branch with a
BOUNDED old-path counter: increment a fixed-cardinality series on the two delegate branches of
`createApiDispatcher` (a sentinel `route` label such as `'<delegate>'` on `http_requests_total`,
or a dedicated `http_delegated_requests_total{surface, method, status}` counter, keyed by the
prefix surface, never the concrete path, to keep cardinality O(1)). The gate then reads THAT
counter. The gate: the delegate/old-path counter shows ZERO requests for **14 consecutive days**
in production EXCLUDING the carve-out classes in section 2, AND there is zero unexplained
404-rate delta versus the pre-flip baseline over the same window. Tracked as the named
next-release follow-up PR above.

### 2. Carve-outs (delegate-served shapes that legitimately keep the old-path signal warm under flag 'new')

A naive zero-requests gate is unreachable without excluding these deliberately delegate-served
shapes. At deletion each flips to the table's pre-auth shape (the `planned405BeforeAuth` class:
the dispatcher will serve `methodNotAllowed` / `notFound` itself once the delegate is gone):
- **(a) HEAD-to-GET delegation.** The router synthesizes HEAD from GET (`head: true`) and the
  dispatcher delegates a head match, so HEAD stays byte-identical old-vs-new while the ladder is
  retained. At deletion HEAD is served AS GET (a deliberate behavior change).
- **(b) The `oauthInternalOffTable405` set.** DECISION RECORDED HERE: at the deletion, migrate
  GET /oauth/authorize and GET /oauth/device (the HTML consent/device pages, off-table and
  delegate-served today) onto `meta.envelope 'html'` RouteDefs IN the deletion PR (table-owned,
  no permanent delegate), and the restart-countdown wrong-method shape adopts the table's
  pre-auth 405 (`planned405BeforeAuth`). The `oauthInternalOffTable405` knownDeviation FIRES at
  the deletion, not at this flip.
- **(c) The Phase 18b off-table remainder.** The daily-rewards prefix-arm oddities (the ladder's
  auth-then-404 on a wrong method, on an unknown subpath, and on the no-slash
  '/api/daily-rewardsX' sibling) adopt the table's pre-auth 404/405 at the deletion (same
  `planned405BeforeAuth` class), and the ops family's family-wide PRE-PATH 401 becomes per-route
  table auth at deletion (unknown ops subpaths become pre-auth 404). Recreation-or-loss of the
  family-wide pre-path 401 is adjudicated in the deletion PR (per `dailyRewardsOpsBodyValidationRemap`).
- **(d) RETIRED (was the v0.20.0 housekeeping in-family shapes).** The fifth v0.20.0 slice
  brought the release's full housekeeping revert, so the family, its 11 RouteDefs, and these
  in-family shapes no longer exist; nothing to carve out. Kept lettered so cross-references to
  (e) stay stable.
- **(e) The v0.20.0 third-slice maps/assets wrong-method shapes.** A wrong method on an
  `/api/maps` or `/api/assets` path has no RouteDef and delegates to the ladder terminal 404
  today; at deletion it flips to the table's pre-auth 405 (`planned405BeforeAuth`). GET
  /api/maps/:id keeps its conditional anonymous-only prose throttle inside `optionalViewerGuard`
  on the surviving path BY DESIGN (documented in `mapsAssetsRateLimitedBodyToCode`).

### 3. Also part of the deletion follow-up PR

- **The Phase 18/18b dual-edit MAINTENANCE RULE EXPIRES.** A migrated route lives in BOTH the
  RouteDef table and the legacy ladder; until the ladder is removed, a behavior edit to one twin
  must land in the other in the same change. That obligation ends when the ladder is deleted.
- **Wire the surviving /api/perf arm onto `Config.allowDevCommands`.** See section 4.
- **`http_requests_total` for the delegate counter** (section 1) is added here.
- Re-annotate the surface-inventory rows that document the LEGACY arm and mislead once the
  ladder is gone: the swag-claim row's `unreachable: true` and the four limiter-column rows
  (reports, characters-POST, wallet-link x2).

### 4. `Config.allowDevCommands`: KEEP AND SCHEDULE (Phase 24 QA wire-or-drop resolution)

`Config.allowDevCommands` STAYS (the validated single-source pin). It has no live consumer yet:
the two /api/perf dev gates (the main.ts legacy arm and the leaderboard.ts migrated arm) each
keep a live per-request `ALLOW_DEV_COMMANDS` read so the two dispatch arms cannot diverge while
the legacy ladder is retained behind the flag. The old-ladder deletion PR (NOT Phase 25) removes
the legacy /api/perf arm and wires the surviving migrated arm onto `Config.allowDevCommands`; the
game.ts per-tick / per-command cheat gates stay per-command env reads BY DESIGN. This decision is
also recorded in `server/http/config.ts` (Config.allowDevCommands doc + conscious exception (2)).

### 5. Deferred items carried into the next release (NOT part of the deletion gate, but the same horizon)

- API conventions still DEFERRED to a consumer-driven follow-up: A (versioning), D (ETag), F
  (Deprecation/Sunset), G (OpenAPI). Ship paths UNVERSIONED until then.
- The full-CSP Report-Only effort (Phase 21 shipped the header hardening minus CSP/COEP).
- The concurrency-scalability workstream (the single-threaded 20 Hz world loop is the per-realm
  ceiling; out of scope for this packet).
- The **X-Request-Id echo LIVE mount**: built and unit-tested in
  `server/http/middleware/request_id.ts` (the success-path header), but NOT mounted on the
  dispatch onion. Mounting adds the header to migrated 2xx/429/404 responses the retained legacy
  delegate does not emit (a corpus-wide parity-visible change), so it is deferred to the deletion
  follow-up (normalize X-Request-Id out of the shared parity normalizer, or register it
  corpus-wide). The error-path echo is already live via `errors.ts` baseHeaders.
- The timed DRAIN WINDOW constant (additive; none exists today; deferred to the concurrency
  workstream).
- The daily-rewards pagination upper-clamp hardening (a pre-existing non-behavioral contract gap).
- HEAD-as-GET behavior change at the deletion (carve-out (a)).
