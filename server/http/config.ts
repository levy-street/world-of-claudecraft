// Pure environment to Config loader for the server. It reads a NodeJS.ProcessEnv
// ONCE into a typed, Object.freeze-d Config and returns it. It is pure by
// construction: it takes env as a parameter and never touches the global
// process.env, so it is trivially unit-testable, and boot (server/main.ts) calls
// loadConfig(process.env) at a single edge (memoized as activeConfig()).
//
// FAIL FAST: loadConfig is the one validated boot edge. A missing required value
// or a garbage flag throws here (before the DB retry loop) with a clear English
// message that NAMES the offending key and never echoes a secret VALUE, rather
// than silently defaulting and surfacing as a subtle mis-behavior much later.
//
// No magic values: every default lives in a named const below, single-sourced.
// The loader never logs the env or echoes any secret (notably DATABASE_URL).
//
// SELF-CONTAINED BY DESIGN: this module imports nothing with a module-scope env
// read (no realm.ts, no middleware), so importing it triggers no side effect and
// the URL / boolean-flag validators mirror their owners' rules inline (each such
// mirror names its source). That keeps loadConfig a pure function of its argument
// and config.test.ts hermetic.
//
// CONSCIOUS EXCEPTIONS to the read-once-here rule (deliberately NOT threaded
// through Config; each reads its env at the point and time it needs it, by
// design, so loadConfig only VALIDATES parseability where noted, never relocates
// the read). Ambient NODE_ENV mode checks and the test-only-seam production
// guards (the resetActiveConfigForTests-style throws) are outside this rule's
// scope: NODE_ENV has no garbage state and those guards must stay self-contained.
//   (1) Per-request secret gates that treat env-unset as feature-off / fail-closed
//       at request time: require_internal_secret.ts + internal.ts
//       (RESTART_COUNTDOWN_SECRET, DISCORD_BOT_SECRET) and daily_rewards.ts
//       (WOC_DAILY_REWARD_SERVICE_SECRET, WOC_DAILY_REWARD_SERVICE_URL).
//   (2) Per-request dev-gate reads of ALLOW_DEV_COMMANDS: the game.ts per-tick /
//       per-command cheat gates (alongside ANTIBOT_ENFORCE, PERF_TICK_LOG,
//       SELF_SNAPSHOT_FULL) and the two /api/perf report gates (the main.ts legacy
//       arm and the leaderboard.ts migrated arm, each kept a live per-request read
//       so the two dispatch arms cannot diverge while the legacy ladder is retained
//       behind the flag). The old-ladder deletion is the NEXT-RELEASE follow-up PR
//       (the default flip already shipped): that PR removes the legacy /api/perf arm and wires the
//       surviving migrated arm onto Config.allowDevCommands (the validated
//       single-source pin); the game.ts per-command env reads stay per-command by
//       design.
//   (3) Domain feature-config getters that own their own env (discord.ts, github.ts
//       OAuth, oauth.ts, native_attestation.ts, email/, auth.ts banlist,
//       chat_filter_db.ts, woc_balance.ts, perf_report.ts, TRUSTED_PROXY_IPS in
//       ratelimit.ts), plus daily_rewards.ts's module-load cache-TTL test knob
//       WOC_DAILY_REWARD_CONFIG_TTL_MS (a garbage value degrades to cache-off,
//       never breaks a request).
//   (4) The security-header / enforce-flag middlewares keep their own
//       `env = process.env` seam (security_headers.ts HSTS-in-prod,
//       content_type.ts API_CONTENT_TYPE_ENFORCE, origin_check.ts
//       API_ORIGIN_CHECK_ENFORCE, web_login_guard.ts REQUIRE_WEB_LOGIN). loadConfig
//       VALIDATES their flags (throw on garbage) but does not consume them there;
//       the one exception is REQUIRE_WEB_LOGIN, whose resolved boolean IS surfaced
//       (requireWebLogin) because server/main.ts consumed it as a module const.
//   (5) db.ts module-scope DATABASE_URL read + pool construction (a pg pool
//       connects lazily, so a bare import opens nothing; loadConfig owns the
//       fail-fast throw on an empty DATABASE_URL). db.ts also reads the one-shot
//       MARKET_BACKFILL_DRY_RUN ops flag at the point of the World Market backfill
//       inside ensureSchema ('1' deliberately halts boot for inspection; any other
//       value is off, no garbage state).
//   (6) The realm/origin keys (server/realm.ts) that resolve at module load with a
//       deliberate warn-and-fallback (REALM_NAME, REALM_TYPE, REALM_RESET_TZ): those
//       are tolerant BY DESIGN (a bad value warns and falls back, a currently-working
//       boot), so loadConfig does NOT hard-throw on them. It DOES fail fast on the
//       two garbage cases that would otherwise silently collapse a deploy:
//       PUBLIC_ORIGIN that is not a bare origin, and a non-empty REALMS with no
//       usable Name=origin entry.

// The two accepted API dispatch modes, single-sourced so the boot wiring
// (server/main.ts) and the dispatcher (server/http/dispatch.ts) share ONE type
// rather than re-typing the literal union at each call site.
export type DispatchMode = 'legacy' | 'new';

export interface Config {
  // The SINGLE all-or-nothing API dispatch flag (canonical env name API_DISPATCH).
  // 'legacy' keeps the existing route handling; 'new' selects the re-architected
  // pipeline. The DEFAULT is 'new'; API_DISPATCH=legacy is the
  // one-flag rollback. An unset flag defaults to DEFAULT_DISPATCH; a set-but-invalid
  // flag THROWS (see parseDispatch).
  readonly dispatch: DispatchMode;
  // Required. Also the tier-2 rate limiter DSN: the pg-backed global limiter
  // (server/ratelimit_db.ts) shares this one pool, so an empty value is fatal.
  readonly databaseUrl: string;
  readonly port: number;
  // The validated single-source surface of ALLOW_DEV_COMMANDS, wired onto the
  // surviving /api/perf migrated arm by the next-release ladder-deletion PR; the
  // live cheat gates (game.ts, the two /api/perf arms) deliberately re-read env per
  // command today (see conscious exception (2) above).
  readonly allowDevCommands: boolean;
  readonly turnstileSecret: string;
  readonly maxWsPerIpHard: number;
  readonly githubRepo: string;
  readonly githubToken: string;
  readonly chatLogRetentionDays: number;
  readonly perfReportRetentionDays: number;
  // The auth-endpoint Origin guard, resolved once (mirrors web_login_guard.ts
  // webLoginEnforced): true when REQUIRE_WEB_LOGIN is 1/true, false when 0/false,
  // else NODE_ENV === 'production'. The raw flag is validated (throw on garbage).
  readonly requireWebLogin: boolean;
  // The /metrics bearer token. Empty (unset) means the endpoint is feature-off
  // (404); a non-empty value gates /metrics behind Authorization: Bearer <token>.
  // A secret: never logged or echoed.
  readonly metricsToken: string;
}

// Dispatch flag: the two accepted values and the default. Declared `as const` so
// the equality checks in parseDispatch narrow a raw string to the literal union.
const DISPATCH_LEGACY = 'legacy' as const;
const DISPATCH_NEW = 'new' as const;
// The single source of truth for the default dispatch mode. Exported so the boot
// wiring (server/main.ts) uses the SAME default for its pre-boot/test-import value
// as loadConfig uses when API_DISPATCH is unset, rather than re-typing the literal.
// The production default is 'new' (the new pipeline serves every surface);
// API_DISPATCH=legacy is the one-flag rollback to the retained legacy ladder.
// The flip's precondition on the two log-only mismatch gates is satisfied: their
// warn sinks run ahead of the route-local rate limiters, and both are flood-bounded
// per (method, route-template) window by mismatch_warn_throttle.ts, so a crafted
// mismatch flood cannot amplify log volume (docs/api-pipeline/state.md, OPEN items).
export const DEFAULT_DISPATCH: DispatchMode = DISPATCH_NEW;

// The literal env value that turns the dev-command cheats on. Anything else
// (including unset) leaves them off; production must never set this.
const ALLOW_DEV_COMMANDS_ON = '1';

// Scalar defaults, single-sourced.
const DEFAULT_PORT = 8787;
const DEFAULT_TURNSTILE_SECRET = '';
const DEFAULT_MAX_WS_PER_IP_HARD = 20;
const DEFAULT_GITHUB_REPO = 'levy-street/world-of-claudecraft';
const DEFAULT_GITHUB_TOKEN = '';
const DEFAULT_CHAT_LOG_RETENTION_DAYS = 90;
const DEFAULT_PERF_REPORT_RETENTION_DAYS = 14;
const DEFAULT_METRICS_TOKEN = '';

// Env keys validated below (named rather than inline literals). The two API
// enforce flags mirror content_type.ts CONTENT_TYPE_ENFORCE_ENV and origin_check.ts
// ORIGIN_CHECK_ENFORCE_ENV; kept as literals here to keep this loader import-light.
const REQUIRE_WEB_LOGIN_ENV = 'REQUIRE_WEB_LOGIN';
const CONTENT_TYPE_ENFORCE_ENV = 'API_CONTENT_TYPE_ENFORCE';
const ORIGIN_CHECK_ENFORCE_ENV = 'API_ORIGIN_CHECK_ENFORCE';

// The recognized boolean-flag vocabulary shared by REQUIRE_WEB_LOGIN and the two
// API enforce flags (matches web_login_guard.ts / content_type.ts / origin_check.ts:
// '1'/'true' => on, '0'/'false' => off, compared case-insensitively). Unset or
// empty means "not set" and the flag's own default applies; any OTHER set value is
// garbage and fails fast at boot.
const RECOGNIZED_BOOLEAN_FLAG_VALUES: ReadonlySet<string> = new Set(['1', 'true', '0', 'false']);

// Number(env.X) with a fallback: an unset, empty, or non-finite value (a stray
// "PORT=" or "PORT=abc") yields the default rather than NaN.
function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Accept exactly 'legacy' or 'new'. Unset (or empty) falls back to the default;
// any OTHER set value THROWS naming the key and the allowed values (tightening the
// pre-validation behavior that silently defaulted a typo to 'legacy'). The
// `as const` literal consts let the comparison narrow the result.
function parseDispatch(value: string | undefined): DispatchMode {
  if (value === undefined || value === '') return DEFAULT_DISPATCH;
  if (value === DISPATCH_NEW || value === DISPATCH_LEGACY) return value;
  throw new Error(`API_DISPATCH must be '${DISPATCH_LEGACY}' or '${DISPATCH_NEW}' when set`);
}

// Throw when a boolean flag is set to something outside the recognized vocabulary.
// Unset or empty is allowed (the flag's default applies). Never echoes the value.
function validateBooleanFlag(env: NodeJS.ProcessEnv, key: string): void {
  const raw = env[key];
  if (raw === undefined || raw === '') return;
  if (!RECOGNIZED_BOOLEAN_FLAG_VALUES.has(raw.toLowerCase())) {
    throw new Error(`${key} must be one of 1, true, 0, false when set`);
  }
}

// Resolve REQUIRE_WEB_LOGIN to a boolean, mirroring web_login_guard.ts
// webLoginEnforced EXACTLY (kept inline to preserve this loader's self-contained
// purity; both are pinned by tests). validateBooleanFlag(REQUIRE_WEB_LOGIN) runs
// first, so an unrecognized value has already thrown by the time this is called.
function resolveRequireWebLogin(env: NodeJS.ProcessEnv): boolean {
  const v = (env[REQUIRE_WEB_LOGIN_ENV] ?? '').toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return env.NODE_ENV === 'production';
}

// Whether a raw value is a bare http(s) origin, mirroring server/realm.ts
// resolvePublicOrigin's acceptance rule (http/https scheme, no credentials, no
// path/query/hash; a single trailing slash is tolerated). Kept inline (not an
// import of realm.ts) so this loader stays free of realm.ts's module-scope env
// reads. Used to fail fast on a garbage PUBLIC_ORIGIN and REALMS entry.
function isBareOrigin(raw: string): boolean {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

// PUBLIC_ORIGIN, when set, must be a bare origin. realm.ts would otherwise silently
// resolve garbage to '' and fall back at boot; failing fast surfaces the misconfig.
function validatePublicOrigin(env: NodeJS.ProcessEnv): void {
  const raw = env.PUBLIC_ORIGIN;
  if (raw === undefined || raw.trim() === '') return;
  if (!isBareOrigin(raw)) {
    throw new Error(
      'PUBLIC_ORIGIN must be a bare http(s) origin (e.g. https://example.com) when set',
    );
  }
}

// A non-empty REALMS must contain at least one usable entry, mirroring
// server/realm.ts parseRealms' entry rule: a comma-separated list of
// Name=origin[=Type], where an entry survives when it has at least a Name and a url
// field and the url is either empty (the same-origin realm) or a bare origin. A
// non-empty REALMS with no survivor would silently collapse to a single default
// realm, so fail fast. Unset/empty REALMS is the documented single-realm default.
function validateRealms(env: NodeJS.ProcessEnv): void {
  const raw = env.REALMS;
  if (raw === undefined || raw.trim() === '') return;
  const hasUsableEntry = raw.split(',').some((part) => {
    const seg = part.trim();
    if (!seg) return false;
    const fields = seg.split('=').map((f) => f.trim());
    if (fields.length < 2) return false;
    const rawUrl = fields[1];
    // An empty url is the same-origin realm (kept by parseRealms); a non-empty url
    // must be a bare origin or parseRealms drops the entry.
    return rawUrl === '' || isBareOrigin(rawUrl);
  });
  if (!hasUsableEntry) {
    throw new Error('REALMS is set but contains no usable Name=origin entry');
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (databaseUrl === '') {
    // Fail fast at config load. Never include the value in the message: even an
    // empty one here, a future caller could pass a partial URL, so the message
    // stays value-free to avoid leaking a secret to logs.
    throw new Error('DATABASE_URL is required but was not set');
  }

  // Validate the flags that only gate behavior elsewhere (throw fast on garbage;
  // never echo a value). parseDispatch below throws on a garbage API_DISPATCH.
  validateBooleanFlag(env, REQUIRE_WEB_LOGIN_ENV);
  validateBooleanFlag(env, CONTENT_TYPE_ENFORCE_ENV);
  validateBooleanFlag(env, ORIGIN_CHECK_ENFORCE_ENV);
  validatePublicOrigin(env);
  validateRealms(env);

  return Object.freeze({
    dispatch: parseDispatch(env.API_DISPATCH),
    databaseUrl,
    port: numberOr(env.PORT, DEFAULT_PORT),
    allowDevCommands: env.ALLOW_DEV_COMMANDS === ALLOW_DEV_COMMANDS_ON,
    turnstileSecret: env.TURNSTILE_SECRET ?? DEFAULT_TURNSTILE_SECRET,
    maxWsPerIpHard: numberOr(env.MAX_WS_PER_IP_HARD, DEFAULT_MAX_WS_PER_IP_HARD),
    githubRepo: env.GITHUB_REPO ?? DEFAULT_GITHUB_REPO,
    githubToken: env.GITHUB_TOKEN ?? DEFAULT_GITHUB_TOKEN,
    chatLogRetentionDays: numberOr(env.CHAT_LOG_RETENTION_DAYS, DEFAULT_CHAT_LOG_RETENTION_DAYS),
    perfReportRetentionDays: numberOr(
      env.PERF_REPORT_RETENTION_DAYS,
      DEFAULT_PERF_REPORT_RETENTION_DAYS,
    ),
    requireWebLogin: resolveRequireWebLogin(env),
    metricsToken: env.METRICS_TOKEN ?? DEFAULT_METRICS_TOKEN,
  });
}
