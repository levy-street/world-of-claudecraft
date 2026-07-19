import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult } from 'pg';
import {
  type AccountFlair,
  EMPTY_ACCOUNT_FLAIR,
  normalizeAccountFlair,
} from '../src/sim/account_flair';
import { LEADERBOARD_MAX } from '../src/sim/leaderboard_page';
import { sanitizeRemovedZone1Content } from '../src/sim/removed_zone1_content';
import type { CharacterState, MailSave, MarketSave } from '../src/sim/sim';
import type { ArenaFormat, PlayerClass } from '../src/sim/types';
import { APPLE_AUTH_SCHEMA } from './apple_auth_db';
import type { BankBonusFacts } from './bank_entitlements';
import { seedChatFilterDefaults } from './chat_filter_db';
import type { ChatLogRow } from './chat_log';
import {
  DAILY_REWARD_EVENTS_CONCURRENT_INDEX_SQL,
  DAILY_REWARD_EVENTS_INVALID_INDEX_CHECK_SQL,
  DAILY_REWARD_EVENTS_INVALID_INDEX_DROP_SQL,
} from './daily_rewards_schema';
import type { RankedDeedsAccount } from './deeds_board';
import { DISCORD_SCHEMA } from './discord_db';
import { GITHUB_SCHEMA } from './github_db';
import { isUniqueViolation } from './http_util';
import { MAPS_SCHEMA } from './maps_db';
import {
  LEGACY_MARKET_KEY,
  MARKET_BACKFILL_MARKER_KEY,
  MARKET_KEY_PREFIX,
  marketStateKey,
  runMarketBackfill,
} from './market_backfill';
import { OAUTH_SCHEMA } from './oauth_db';
import {
  closeOrphanPlayerSessions,
  closePlayerSession,
  openPlayerSession,
  PLAYER_METRICS_CONCURRENT_INDEX_SQL,
  PLAYER_METRICS_INVALID_INDEX_CHECK_SQL,
  PLAYER_METRICS_INVALID_INDEX_DROP_SQL,
  PLAYER_METRICS_SCHEMA,
  recordCharacterCreation,
} from './player_metrics_db';
import { RATELIMIT_PRUNE_SQL, RATELIMIT_SCHEMA } from './ratelimit_db';
import { REALM } from './realm';
import { chooseArchiveName } from './reclaim_name';
import { SOCIAL_SCHEMA } from './social_db';
import { USER_ASSETS_SCHEMA } from './user_assets_db';

// The realm-market key helpers and the backfill marker key live in
// server/market_backfill.ts (a *_db-style module with no db.ts dependency, so
// db.ts can import it without a cycle). Only marketStateKey was ever part of
// db.ts's public surface; re-export just that one so its pre-existing
// consumers (the market tests) keep importing it from ./db unchanged.
export { marketStateKey } from './market_backfill';

// The actual load lives in server/env.ts so import-time readers other than
// db.ts (realm.ts via main.ts's first import) share one bootstrap.
import './env';

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  (() => {
    throw new Error(
      'DATABASE_URL is required. For local dev, copy .env.example to .env and run through docker compose.',
    );
  })();

// Max Postgres clients this realm process keeps in its pool (count). Shared
// across the HTTP request path and the game loop. The pool is timeout-bounded on
// every axis below so a slow or unreachable database degrades into fast, isolated
// query failures instead of a process-wide stall.
export const DB_POOL_MAX_CLIENTS = 10;

// Pool checkout / connect wait: how long pool.connect() (and every pool.query,
// which checks a client out first) may block waiting for a free client or a new
// TCP connect before it rejects. A slow database must fail a request fast rather
// than queue the whole handshake path behind an exhausted pool forever.
export const DB_POOL_CONNECT_TIMEOUT_MS = 5000;

// Server-side default statement timeout per session, applied as a connection
// startup parameter so every query on every pooled client is bounded by the
// database itself. The known heavy aggregates raise it per-transaction via
// runWithStatementTimeout; any ordinary request query that runs past this is a
// runaway and the database cancels it.
export const DB_STATEMENT_TIMEOUT_MS = 15_000;

// The raised per-transaction allowance for the known heavy reads (the cached
// leaderboard / board / metrics aggregates and the final character save, plus the
// on-demand admin reads: the sessions-by-day chart, the client perf summary, the
// account-detail playtime aggregate, and the chat-log prune), applied via
// runWithStatementTimeout. Bounded so even an exempted scan that goes runaway still
// dies rather than pinning a pooled client indefinitely.
export const DB_HEAVY_STATEMENT_TIMEOUT_MS = 60_000;

// Client-side backstop timeout per connection. query_timeout is enforced in the
// driver, NOT the database, so a SET LOCAL cannot lift it: it MUST sit strictly
// above the heaviest server-side allowance or it would kill the very queries
// runWithStatementTimeout raises DB_HEAVY_STATEMENT_TIMEOUT_MS for. The server-side
// statement_timeout is the real working limit; this only catches a black-holed
// server that accepted a query and then never answers (so no server-side timer
// ever fires), one layer outside the heavy allowance.
export const DB_QUERY_TIMEOUT_MS = DB_HEAVY_STATEMENT_TIMEOUT_MS + 5000;

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: DB_POOL_MAX_CLIENTS,
  connectionTimeoutMillis: DB_POOL_CONNECT_TIMEOUT_MS,
  statement_timeout: DB_STATEMENT_TIMEOUT_MS,
  query_timeout: DB_QUERY_TIMEOUT_MS,
});

// An idle pooled client can emit 'error' with no query in flight (a backend
// termination, a dropped TCP connection). Unhandled, pg re-emits it on the Pool
// where it becomes an uncaught exception that crashes the realm process. Swallow
// it to a logged, counted event; pg discards the broken client and the next
// checkout transparently opens a fresh one. Dev-channel English is fine here (a
// log, never player text). The real pg Pool is an EventEmitter; a few db-layer
// unit tests replace it with a minimal fake that omits .on, so guard the
// registration by capability rather than force every such fake to grow the event
// surface (the real registration is exercised in tests/server/tunables.test.ts).
let poolClientErrorCount = 0;
if (typeof pool.on === 'function') {
  pool.on('error', (err) => {
    poolClientErrorCount++;
    console.error('pg pool: idle client error (client discarded)', err);
  });
}

/** Count of idle pooled-client 'error' events seen since boot (tests + future metrics). */
export function getPoolClientErrorCount(): number {
  return poolClientErrorCount;
}

/**
 * Run `fn` inside ONE transaction on a dedicated pooled client whose
 * statement_timeout is raised to `timeoutMs` for the duration (SET LOCAL, so it
 * reverts at COMMIT/ROLLBACK and never leaks to the next checkout). For the known
 * heavy reads whose legitimate runtime can exceed the default DB_STATEMENT_TIMEOUT_MS.
 * The wrapped `query` handed to `fn` runs on the same client inside the same
 * transaction, so every statement it issues is covered by the raised timeout. The
 * transaction runs at the default READ COMMITTED isolation, where each statement
 * takes its own snapshot: this raises the allowance for every statement but does
 * NOT give a multi-statement read one consistent snapshot.
 *
 * SET LOCAL cannot take a bind parameter, so `timeoutMs` is interpolated into the
 * statement text as an integer; validating it as a non-negative safe integer here
 * is therefore the injection guard, since no other value can reach the SQL text.
 */
export async function runWithStatementTimeout<T>(
  timeoutMs: number,
  fn: (query: (text: string, values?: unknown[]) => Promise<QueryResult>) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new Error(
      `runWithStatementTimeout: timeoutMs must be a non-negative safe integer, got ${timeoutMs}`,
    );
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const result = await fn((text, values) => client.query(text, values));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const REALM_SQL_DEFAULT = REALM.replace(/'/g, "''");
const LIFETIME_XP_EXPR = "((state->>'lifetimeXp')::bigint)";

// The one eligibility predicate every public board query embeds VERBATIM (via
// a JOIN or EXISTS over `accounts a`): banned and currently-suspended accounts
// are delisted from every player-derived board, and an expired suspension
// relists on its own. Exported so the board queries here, the daily-rewards
// board reads (daily_rewards_db.ts), and the moderation guard test all bind to
// the same fragment. Static text, never interpolated with user input.
export const ELIGIBLE_ACCOUNT_SQL =
  'a.banned_at IS NULL AND (a.suspended_until IS NULL OR a.suspended_until <= now())';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_tokens_account ON auth_tokens(account_id);
-- Token scope: 'full' sessions can do anything; 'read' tokens (companion apps,
-- OAuth character:read) are accepted only on read routes and rejected on every
-- mutating route. Defaulting to 'full' means every pre-existing session keeps
-- full power with no behavior change. The label column names a companion/OAuth
-- token in the account portal so a user can revoke a specific one.
ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'full';
ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS label TEXT;
CREATE TABLE IF NOT EXISTS characters (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT UNIQUE NOT NULL,
  class TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  level INT NOT NULL DEFAULT 1,
  state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS characters_account ON characters(account_id);
ALTER TABLE characters ADD COLUMN IF NOT EXISTS realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}';
-- Last time this character entered the world (stamped on join). Drives the
-- "last seen" readout on offline guild-roster rows. Nullable: a character that
-- has never entered the world since this column was added reads NULL.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;
-- Max-Level XP Overflow leaderboard: indexed lifetime-XP sort key. The first
-- index serves the realm-scoped in-game panel; the second serves the global
-- (cross-realm) home-page board.
CREATE INDEX IF NOT EXISTS characters_lifetime_xp
  ON characters (realm, ${LIFETIME_XP_EXPR} DESC);
CREATE INDEX IF NOT EXISTS characters_lifetime_xp_global
  ON characters (${LIFETIME_XP_EXPR} DESC);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
-- Fine-grained admin roles. admin_roles is the single SOURCE OF TRUTH for what
-- an operator may do (staff_db.ts effectiveAdminRoles derives nothing from
-- is_admin); is_admin stays only the "is staff" flag every existing call-site
-- reads AND the kill switch: is_admin FALSE means not staff whatever admin_roles
-- says, so a manual "SET is_admin = FALSE" always revokes. Every role write
-- keeps is_admin in sync (is_admin = roles non-empty). Derivation flows one way
-- only: roles -> is_admin, never back.
--
-- The column is nullable ON PURPOSE, three-valued: NULL = "roles never defined"
-- (a pre-permission legacy account, or a brand-new non-staff row), '{}' = an
-- EXPLICIT empty set (fully revoked). The one-time backfill below keys on NULL,
-- so it migrates a genuine legacy admin exactly once and then no-ops forever; a
-- manual half-revoke ("SET admin_roles = '{}'" without touching is_admin) writes
-- '{}', not NULL, so it can never be resurrected to a role. Legacy admins are
-- migrated to the admin role (the full toolset MINUS staff.manage), not
-- superadmin:
-- staff-role management requires a deliberate superadmin grant via
-- scripts/grant_admin.mjs. The DROP NOT NULL reconciles any pre-release column
-- that was created with the earlier "NOT NULL DEFAULT '{}'" shape.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_roles TEXT[];
ALTER TABLE accounts ALTER COLUMN admin_roles DROP NOT NULL;
UPDATE accounts SET admin_roles = '{admin}' WHERE is_admin AND admin_roles IS NULL;
-- Staff-page lookup: accounts is the largest table, so give the rare staff
-- rows a small partial index.
CREATE INDEX IF NOT EXISTS accounts_staff ON accounts(username) WHERE is_admin;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS chat_muted_until TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS chat_mute_reason TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_ip TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_user_agent TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_login_ip TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_login_user_agent TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cosmetics JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Paid weapon ownership and loadouts live outside accounts.cosmetics. Older game
-- binaries replace that JSON document wholesale, so keeping paid state there would
-- let a rolling deploy or rollback erase entitlements. The one-time backfill reads
-- the legacy keys for accounts that received them before this table existed; once a
-- row exists here it is authoritative and old binaries cannot mutate it.
CREATE TABLE IF NOT EXISTS account_weapon_cosmetics (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  skin_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  loadout JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_weapon_cosmetics_skin_ids_array
    CHECK (jsonb_typeof(skin_ids) = 'array'),
  CONSTRAINT account_weapon_cosmetics_loadout_object
    CHECK (jsonb_typeof(loadout) = 'object')
);
INSERT INTO account_weapon_cosmetics AS awc (account_id, skin_ids, loadout)
SELECT
  id,
  CASE WHEN jsonb_typeof(cosmetics -> 'weaponSkinIds') = 'array'
    THEN cosmetics -> 'weaponSkinIds' ELSE '[]'::jsonb END,
  CASE WHEN jsonb_typeof(cosmetics -> 'weaponSkinLoadout') = 'object'
    THEN cosmetics -> 'weaponSkinLoadout' ELSE '{}'::jsonb END
FROM accounts
WHERE cosmetics ? 'weaponSkinIds' OR cosmetics ? 'weaponSkinLoadout'
-- This is deliberately insert-only. Re-merging the legacy document on every
-- startup would let a rolled-back binary resurrect a stale, previously-cleared
-- loadout. Once the dedicated row exists it is the sole authority.
ON CONFLICT (account_id) DO NOTHING;
-- Operator-set account flair (cosmetic, no gameplay effect): the "AI-operated
-- account" mark that prefixes the character name with [AI], and an official
-- streamer's platform links. Both are written ONLY from the admin dashboard
-- (moderation.act) and audited in account_moderation_actions. streamer_links is
-- a JSONB bag keyed by platform; it is UNTRUSTED at read time and always run back
-- through normalizeAccountFlair (src/sim/account_flair.ts), which is also the one
-- gate the write path uses, so a link that somehow reached the column cannot
-- reach a client. is_streamer is kept separate from the links so an operator can
-- switch the flair off without losing the URLs they typed.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_ai BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_streamer BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS streamer_links JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
-- Whether the account has a password the OWNER set (and therefore can log in with
-- via username + password). Defaults TRUE so every existing account keeps its
-- usable password. Discord-provisioned accounts are created with FALSE: they have
-- only a random unguessable placeholder hash, so they are reachable ONLY through
-- Discord until a real password is set (which flips this back to TRUE). The unlink
-- path reads this to avoid stranding a Discord-only account with no way back in.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT TRUE;
-- Transactional + marketing email support. locale picks the language the server
-- renders outbound mail in (emails have no client in the loop, so they are
-- localized server-side, unlike chat which the client re-localizes). The
-- marketing fields gate non-transactional mail behind explicit opt-in and give
-- every account a stable unsubscribe token.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS locale TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT;
-- Deed broadcast opt-out. When FALSE the server skips the guild/friend
-- broadcast of this account's marquee deed unlocks (the earner's own client
-- toast is local and unaffected). Defaults TRUE so broadcasts are on unless
-- the player opts out; the flag never gates the unlock itself.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deed_broadcasts BOOLEAN NOT NULL DEFAULT TRUE;
-- Index + collision guard for the public unsubscribe lookup. Partial (the column
-- is NULL until an account first opts in) and UNIQUE so two accounts can never
-- share a token. The token is a low-sensitivity capability (its only power is to
-- opt the account out of marketing), not an auth credential.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_unsubscribe_token
  ON accounts(unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;
-- Pending email-change verifications. We store only the SHA-256 of the token so
-- a DB leak cannot be replayed into an inbox hijack. Each row is single-use
-- (consumed_at) and time-boxed (expires_at).
CREATE TABLE IF NOT EXISTS email_change_requests (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS email_change_requests_token ON email_change_requests(token_hash);
CREATE INDEX IF NOT EXISTS email_change_requests_account ON email_change_requests(account_id);
-- Pending self-service password resets. Same posture as email_change_requests:
-- only the SHA-256 of the token is stored (a DB leak cannot be replayed into a
-- takeover), each row is single-use (consumed_at) and time-boxed (expires_at).
-- No payload column; account_id is the reset target.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS password_reset_requests_token ON password_reset_requests(token_hash);
CREATE INDEX IF NOT EXISTS password_reset_requests_account ON password_reset_requests(account_id);
-- Audit trail for every outbound email attempt (success or failure). Doubles as
-- the source for any future per-account send rate limiting.
CREATE TABLE IF NOT EXISTS email_log (
  id BIGSERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  to_email TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'transactional',
  ok BOOLEAN NOT NULL,
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_account ON email_log(account_id, sent_at DESC);
-- Optional TOTP two-factor auth. totp_secret holds the confirmed base32 secret
-- (NULL until 2FA is fully enabled); totp_pending_secret holds a secret minted
-- by setup but not yet confirmed with a live code, so a botched enrolment never
-- locks anyone out. totp_enabled_at gates the login challenge. totp_last_window
-- is the highest TOTP counter already accepted at login: a code may be used at
-- most once, so a stolen code cannot be replayed inside its own 30s window.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_last_window BIGINT;
-- Single-use 2FA recovery codes. Only the SHA-256 of each code is stored (the
-- plaintext is shown to the user once at enrolment), and a code is burned by
-- stamping consumed_at, mirroring the email-change token posture.
CREATE TABLE IF NOT EXISTS account_totp_recovery (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ
);
-- Composite unique index: enforces one row per (account, code) AND, with
-- account_id leading, also serves the by-account lookups (consume, count, purge).
CREATE UNIQUE INDEX IF NOT EXISTS account_totp_recovery_hash ON account_totp_recovery(account_id, code_hash);
CREATE INDEX IF NOT EXISTS accounts_created_at ON accounts(created_at DESC);
CREATE INDEX IF NOT EXISTS accounts_created_ip_created ON accounts(created_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS accounts_created_user_agent_created ON accounts(created_user_agent, created_at DESC);
CREATE INDEX IF NOT EXISTS accounts_last_login_ip_login ON accounts(last_login_ip, last_login DESC);
ALTER TABLE characters ADD COLUMN IF NOT EXISTS is_gm BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS force_rename BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS play_sessions (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  character_name TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
CREATE INDEX IF NOT EXISTS play_sessions_account ON play_sessions(account_id);
CREATE INDEX IF NOT EXISTS play_sessions_started ON play_sessions(started_at);
CREATE INDEX IF NOT EXISTS play_sessions_ip_started ON play_sessions(ip_address, started_at DESC);
-- Per-character load lease: at most one process may have a character loaded
-- in-world at a time, the guard against a cross-process double-load dupe. The
-- row IS the lease; holder names one process boot; crash recovery is
-- expiry-based (heartbeats ride the autosave loop, and an expired lease is
-- reclaimable by the next process that loads the character). No realm DEFAULT
-- here on purpose: the realm ... DEFAULT '<realm>' pattern the older tables use
-- is last-boot-wins across realm processes sharing one database, so this table
-- demands an explicit realm value on every insert. realm is informational for
-- ops only; the lease key is character_id alone (character ids are globally
-- unique, characters.id SERIAL in the one shared DB). nonce is a per-join fence:
-- every acquire stamps a fresh one, and a release matches on it, so a late
-- fire-and-forget release (a grace-expiry sweep's, a takeover's) whose nonce a
-- newer acquire has already overwritten becomes a no-op instead of eating the
-- live session's re-acquired row.
CREATE TABLE IF NOT EXISTS character_leases (
  character_id INT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  realm TEXT NOT NULL,
  holder TEXT NOT NULL,
  nonce TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS character_leases_holder ON character_leases(holder);
-- Stamped from the authenticated account at every acquire (the ownership gate
-- getCharacter(accountId, characterId) precedes the acquire, so this is always the
-- character's true owner). It lets the owner reclaim a lease stranded by a dead or
-- wedged process before its TTL expires. NULL rows predate this column and can never
-- be stolen by the account-match arm (plain SQL equality makes a NULL account_id fail
-- every predicate arm except expiry: fail closed). No default, no index, no backfill;
-- the auth_tokens.scope ALTER above is the ADD COLUMN IF NOT EXISTS precedent.
ALTER TABLE character_leases ADD COLUMN IF NOT EXISTS account_id INT;
CREATE TABLE IF NOT EXISTS admin_online_samples (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  online_players INT NOT NULL,
  online_accounts INT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_online_samples_realm_sampled
  ON admin_online_samples(realm, sampled_at DESC);
CREATE TABLE IF NOT EXISTS site_presence_sessions (
  visitor_id TEXT PRIMARY KEY,
  page TEXT NOT NULL DEFAULT 'unknown',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS site_presence_sessions_last_seen
  ON site_presence_sessions(last_seen_at DESC);
CREATE TABLE IF NOT EXISTS admin_site_presence_samples (
  id BIGSERIAL PRIMARY KEY,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_visitors INT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_site_presence_samples_sampled
  ON admin_site_presence_samples(sampled_at DESC);
CREATE TABLE IF NOT EXISTS chat_logs (
  id BIGSERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  character_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_logs_created ON chat_logs(created_at);
CREATE INDEX IF NOT EXISTS chat_logs_character ON chat_logs(character_id, created_at);
CREATE TABLE IF NOT EXISTS player_reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  reporter_character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  reporter_character_name TEXT NOT NULL DEFAULT '',
  reported_account_id INT REFERENCES accounts(id) ON DELETE CASCADE,
  reported_character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  reported_character_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  review_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS player_reports_reported_status ON player_reports(reported_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS player_reports_reporter_created ON player_reports(reporter_account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS bug_reports (
  id BIGSERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  character_name TEXT NOT NULL DEFAULT '',
  realm TEXT NOT NULL DEFAULT '',
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  pos_z REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  screenshot TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bug_reports_account_created ON bug_reports(account_id, created_at DESC);
-- Serves the admin list (ORDER BY created_at DESC, no status filter), mirroring
-- accounts_created_at. A (status, created_at) composite would not satisfy this
-- ordering without a leading-column filter.
CREATE INDEX IF NOT EXISTS bug_reports_created ON bug_reports(created_at DESC);
CREATE TABLE IF NOT EXISTS account_moderation_actions (
  id BIGSERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE CASCADE,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_moderation_actions_account ON account_moderation_actions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_moderation_actions_created ON account_moderation_actions(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS account_moderation_actions_admin_created ON account_moderation_actions(admin_account_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS account_moderation_actions_admin_action_created ON account_moderation_actions(admin_account_id, action, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS blocked_ips (
  id SERIAL PRIMARY KEY,
  ip TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT '',
  created_by_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS blocked_ip_actions (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  action TEXT NOT NULL,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blocked_ip_actions_ip ON blocked_ip_actions(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS blocked_ip_actions_created ON blocked_ip_actions(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS blocked_ip_actions_admin_created ON blocked_ip_actions(admin_account_id, created_at DESC, id DESC);
-- Audit trail for staff role changes (dashboard staff page; the grant script
-- writes here too, with admin_account_id NULL).
CREATE TABLE IF NOT EXISTS admin_role_changes (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  roles_before TEXT[] NOT NULL,
  roles_after TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Serves the global history view (ORDER BY created_at DESC, id DESC LIMIT n).
CREATE INDEX IF NOT EXISTS admin_role_changes_created ON admin_role_changes(created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS world_state (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Bot-detector runtime config overrides (the admin Bot Detector > Configuration
-- panel): one JSONB document per realm ({ [fieldId]: value }, validated by the
-- detector). Applied live on save and re-applied at boot right after the
-- detector is constructed.
CREATE TABLE IF NOT EXISTS bot_detector_config (
  realm TEXT PRIMARY KEY DEFAULT '${REALM_SQL_DEFAULT}',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS bot_detector_config_changes (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  before_data JSONB NOT NULL,
  after_data JSONB NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_detector_config_changes_realm
  ON bot_detector_config_changes(realm, created_at DESC, id DESC);
-- Chat moderation: per-account timed mute + running strike count for the
-- hard-word (slur) enforcement ladder. A mute blocks chat only, never login.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS chat_muted_until TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS chat_strikes INT NOT NULL DEFAULT 0;
-- Admin-managed filter word lists. tier 'soft' = cosmetic (masked client-side
-- when the player's filter is on); tier 'hard' = enforced (blocked + escalated).
CREATE TABLE IF NOT EXISTS chat_filter_words (
  id SERIAL PRIMARY KEY,
  word TEXT NOT NULL,
  tier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tier, word)
);
-- Single-row escalation config (warnings then a mute ladder, in seconds).
CREATE TABLE IF NOT EXISTS chat_filter_config (
  id INT PRIMARY KEY DEFAULT 1,
  warnings_before_mute INT NOT NULL DEFAULT 1,
  mute_ladder_seconds INT[] NOT NULL DEFAULT '{600,3600,86400}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_filter_config_singleton CHECK (id = 1)
);
-- Hard-word incident log, surfaced per-account in the moderation dashboard.
CREATE TABLE IF NOT EXISTS chat_violations (
  id BIGSERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE CASCADE,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  character_name TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  mute_seconds INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_violations_account ON chat_violations(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS client_perf_reports (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  schema_version INT NOT NULL DEFAULT 1,
  release_version TEXT NOT NULL DEFAULT '',
  build_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  graphics_preset TEXT NOT NULL DEFAULT '',
  gfx_tier TEXT NOT NULL DEFAULT '',
  auto_governor BOOLEAN NOT NULL DEFAULT FALSE,
  target_fps INT NOT NULL DEFAULT 0,
  render_scale REAL NOT NULL DEFAULT 1,
  effective_render_scale REAL NOT NULL DEFAULT 1,
  fps_avg REAL NOT NULL DEFAULT 0,
  frame_p95_ms REAL NOT NULL DEFAULT 0,
  frame_p99_ms REAL NOT NULL DEFAULT 0,
  long_frame_count INT NOT NULL DEFAULT 0,
  renderer_calls INT NOT NULL DEFAULT 0,
  renderer_triangles INT NOT NULL DEFAULT 0,
  renderer_textures INT NOT NULL DEFAULT 0,
  renderer_programs INT NOT NULL DEFAULT 0,
  context_lost_count INT NOT NULL DEFAULT 0,
  long_task_count INT NOT NULL DEFAULT 0,
  long_task_p95_ms REAL NOT NULL DEFAULT 0,
  memory_used_mb REAL,
  memory_limit_mb REAL,
  dpr REAL NOT NULL DEFAULT 1,
  viewport_bucket TEXT NOT NULL DEFAULT '',
  device_memory REAL,
  hardware_concurrency INT NOT NULL DEFAULT 0,
  mobile_touch BOOLEAN NOT NULL DEFAULT FALSE,
  browser_family TEXT NOT NULL DEFAULT '',
  os_family TEXT NOT NULL DEFAULT '',
  gl_vendor TEXT NOT NULL DEFAULT '',
  gl_renderer_bucket TEXT NOT NULL DEFAULT '',
  zone_or_scenario TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'gameplay',
  raw_summary JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS client_perf_reports_created ON client_perf_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS client_perf_reports_release_created ON client_perf_reports(release_version, created_at DESC);
CREATE INDEX IF NOT EXISTS client_perf_reports_gpu_created ON client_perf_reports(gl_renderer_bucket, created_at DESC);
CREATE INDEX IF NOT EXISTS client_perf_reports_session_created ON client_perf_reports(session_id, created_at DESC);
-- Non-custodial Solana wallet links (PRD: docs/prd/woc/wallet-link.md). One
-- wallet per account (account_id is the PK) and one account per wallet (pubkey
-- is UNIQUE). The server never holds keys; ownership is proven by a signed
-- challenge (see wallet_link_challenges) and this table is just the mirror.
CREATE TABLE IF NOT EXISTS wallet_links (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  pubkey TEXT NOT NULL UNIQUE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Single-use, short-lived sign-to-link challenges. The full message the wallet
-- must sign is stored server-side so the client cannot choose what gets signed;
-- consuming a challenge deletes it (replay protection).
CREATE TABLE IF NOT EXISTS wallet_link_challenges (
  nonce TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_link_challenges_account ON wallet_link_challenges(account_id);
-- Steam account links (the deeds achievement mirror). Copies the wallet_links
-- shape: one Steam account per WoCC account (account_id is the PK) and one
-- WoCC account per Steam id (steam_id is UNIQUE). A row is a cosmetic-mirror
-- pointer only, proven by a server-verified session ticket at link time
-- (server/steam/): it is NEVER an identity or session source, and login stays
-- email + Discord only. Accessors live in server/steam/steam_db.ts. Purely
-- additive leaf: a pre-Steam rollback binary never references it, and the
-- CASCADE keeps account deletion consistent even under old code.
CREATE TABLE IF NOT EXISTS steam_links (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  steam_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS daily_reward_days (
  day TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  prize_pool_usd NUMERIC NOT NULL,
  woc_usd_price NUMERIC,
  finalized_at TIMESTAMPTZ,
  discord_announced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, realm)
);
ALTER TABLE daily_reward_days ADD COLUMN IF NOT EXISTS discord_announced_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS daily_reward_scores (
  day TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  points INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, realm, account_id)
);
CREATE INDEX IF NOT EXISTS daily_reward_scores_rank
  ON daily_reward_scores(day, realm, points DESC, updated_at ASC);
CREATE TABLE IF NOT EXISTS daily_reward_bans (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE daily_reward_bans ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS daily_reward_ip_bans (
  ip_address TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW daily_reward_excluded_accounts AS
SELECT account_id, reason FROM daily_reward_bans
 WHERE expires_at IS NULL OR expires_at > now()
UNION
SELECT a.id AS account_id, ib.reason
  FROM accounts a
  JOIN daily_reward_ip_bans ib
    ON ib.ip_address = a.last_login_ip
    OR EXISTS (
      SELECT 1 FROM play_sessions ps
       WHERE ps.account_id = a.id AND ps.ip_address = ib.ip_address
    );
CREATE TABLE IF NOT EXISTS daily_reward_events (
  id BIGSERIAL PRIMARY KEY,
  day TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  points INT NOT NULL,
  idempotency_key TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (day, realm, account_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS daily_reward_spins (
  day TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  outcome_key TEXT NOT NULL,
  points INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, realm, account_id)
);
CREATE TABLE IF NOT EXISTS daily_reward_tasks (
  day TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  task_id TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'manual',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  points INT NOT NULL,
  base_points INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (day, realm, task_id)
);
ALTER TABLE daily_reward_tasks ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE daily_reward_tasks ADD COLUMN IF NOT EXISTS base_points INT NOT NULL DEFAULT 0;
ALTER TABLE daily_reward_tasks ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE daily_reward_tasks SET base_points = points WHERE base_points = 0 AND points > 0;
CREATE TABLE IF NOT EXISTS daily_reward_task_completions (
  day TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  points INT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, realm, account_id, task_id)
);
CREATE TABLE IF NOT EXISTS daily_reward_payouts (
  day TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  rank INT NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  wallet_pubkey TEXT,
  points INT NOT NULL,
  prize_percent NUMERIC NOT NULL,
  prize_usd NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_signature TEXT,
  error TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, realm, rank)
);
ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS voided_by_id TEXT;
ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS voided_by_username TEXT;
ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE daily_reward_payouts ADD COLUMN IF NOT EXISTS signed_transaction TEXT;
CREATE INDEX IF NOT EXISTS daily_reward_payouts_status
  ON daily_reward_payouts(status, day DESC, realm);
CREATE TABLE IF NOT EXISTS daily_reward_payout_moderation_audit (
  id BIGSERIAL PRIMARY KEY,
  day TEXT NOT NULL,
  realm TEXT NOT NULL,
  rank INT NOT NULL,
  account_id INT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('void', 'restore')),
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_reward_payout_moderation_target
  ON daily_reward_payout_moderation_audit(day, realm, rank, created_at DESC);
CREATE TABLE IF NOT EXISTS daily_reward_payout_attempts (
  id BIGSERIAL PRIMARY KEY,
  day TEXT NOT NULL,
  realm TEXT NOT NULL,
  rank INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('payout', 'resend')),
  operation_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'paid', 'failed')),
  tx_signature TEXT NOT NULL UNIQUE,
  signed_transaction TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (day, realm, rank) REFERENCES daily_reward_payouts(day, realm, rank)
);
CREATE INDEX IF NOT EXISTS daily_reward_payout_attempts_target
  ON daily_reward_payout_attempts(day, realm, rank, created_at DESC);
ALTER TABLE daily_reward_payout_attempts ADD COLUMN IF NOT EXISTS operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS daily_reward_payout_attempts_operation
  ON daily_reward_payout_attempts(day, realm, rank, kind, operation_id)
  WHERE operation_id IS NOT NULL;
-- Shareable player cards (docs/prd/woc/player-card.md). One card per character;
-- the PNG is composited client-side and stored here as bytes so any realm
-- process (all share this database) can serve /p/<slug> and the OG image. slug
-- is globally unique and is the public, referral-friendly handle.
CREATE TABLE IF NOT EXISTS player_cards (
  character_id INT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  png BYTEA NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'en',
  realm TEXT NOT NULL DEFAULT '${REALM_SQL_DEFAULT}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE player_cards ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en';
CREATE INDEX IF NOT EXISTS player_cards_account ON player_cards(account_id);
-- Referral capture: when a new account registers via someone's card link
-- (?ref=<slug>) we record who referred whom, once per referee. Reward payout is
-- intentionally out of scope here: this just captures the relationship so it
-- can be synced to rewards later.
CREATE TABLE IF NOT EXISTS referrals (
  referee_account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  referrer_account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(referrer_account_id);
-- Append-only audit ledger, one row per SUCCESSFUL bank op, written fire-and-forget
-- off the game loop; rows are never updated or deleted by the server. The container
-- discriminator is guild-bank readiness: v1 writes only 'personal' with a NULL
-- container_id, while the future guild bank writes 'guild' plus the guild id into
-- this SAME table. realm carries no DEFAULT deliberately: the interpolated-default
-- pattern is last-boot-wins across realm processes, so every insert passes realm
-- explicitly.
CREATE TABLE IF NOT EXISTS bank_ledger (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  op TEXT NOT NULL,
  item_id TEXT,
  count INT,
  instance JSONB,
  copper_delta BIGINT NOT NULL DEFAULT 0,
  purchased_slots_after INT NOT NULL,
  container TEXT NOT NULL DEFAULT 'personal',
  container_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_ledger_character ON bank_ledger(character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bank_ledger_created ON bank_ledger(created_at);
-- Earned-deed records: one row per (character, deed), written fire-and-forget
-- off the game loop by server/deeds_records.ts, an OBSERVER of the sim's
-- deedUnlocked events. The characters.state blob stays the gameplay source of
-- truth; this table only indexes it for rarity aggregates, account roll-ups,
-- and sheet reads, and no server path grants or revokes a deed. realm carries
-- no DEFAULT deliberately: the interpolated-default pattern is last-boot-wins
-- across realm processes, so every insert passes realm explicitly. account_id
-- is a snapshot of the owner at unlock time (a future character-transfer
-- feature must update or re-derive it). earned_at is the server clock (the
-- sim's utcDay stamp lives in the state blob and is not duplicated here).
-- UNIQUE (character_id, deed_id) is the idempotence backbone: retro re-emits
-- and crash-replays collapse into no-ops.
CREATE TABLE IF NOT EXISTS character_deeds (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deed_id TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (character_id, deed_id)
);
-- character_deeds_deed (a lone index on deed_id) was retired: no query seeks
-- by deed_id. insertCharacterDeed's ON CONFLICT rides the UNIQUE (character_id,
-- deed_id) index, deedRarityCounts groups by deed_id but cannot seek on it,
-- and the board and account reads use their own indexes below, so the index
-- was pure write amplification. The statement below removes it idempotently to
-- converge databases that booted the earlier schema; a no-op where it never
-- existed.
DROP INDEX IF EXISTS character_deeds_deed;
-- Per-account roll-up reads: earnedDeedIdsForAccount (server/deeds_db.ts,
-- the Steam reconcile-on-link push) filters on account_id through this
-- index. The Renown board's deedsBoardRanked read stays a full-table hash
-- aggregation (cached in main.ts) and does not use it.
CREATE INDEX IF NOT EXISTS character_deeds_account ON character_deeds(account_id);
CREATE INDEX IF NOT EXISTS character_deeds_character_earned
  ON character_deeds(character_id, earned_at DESC);
`;

const SCHEMA_ADVISORY_LOCK_KEY = 0x57_4f_43_01; // "WOC\x01"

export async function ensureSchema(): Promise<void> {
  // In the process-per-realm model several server processes boot against the
  // same database at once. Their idempotent CREATE/ALTER statements would
  // otherwise deadlock when run concurrently, so serialize schema setup behind
  // a transaction-scoped advisory lock (auto-released on COMMIT). The lock key
  // is an arbitrary constant shared by every process.
  //
  // Boot runs on a DEDICATED client, never the pool: the pool carries a
  // driver-side query_timeout, a per-query timer that SET LOCAL cannot lift,
  // and the advisory-lock wait plus the one-shot market backfill may
  // legitimately outlast any per-request budget. This client is constructed
  // with the connection string alone, so no statement_timeout or query_timeout
  // config applies to boot at all. pg's Client is resolved at call time rather
  // than imported at module scope because many test suites module-mock 'pg'
  // with a Pool-only factory and never boot the schema; a top-level named
  // import would invalidate every one of those mocks.
  const { Client } = await import('pg');
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    // Inside the try so the finally's end() always runs, even on a connect
    // failure (end() on a never-connected client is a harmless no-op).
    await client.connect();
    await client.query('BEGIN');
    // Boot DDL serializes on the advisory lock across every realm process, so it
    // can legitimately wait far longer than any per-request budget. The dedicated
    // client above escapes the pool's timeouts; this SET LOCAL additionally
    // overrides any database- or role-level statement_timeout an operator may
    // have set server-side (SET LOCAL reverts at COMMIT).
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_ADVISORY_LOCK_KEY]);
    await client.query(SCHEMA);
    // Compact player analytics facts depend on accounts, characters, and
    // play_sessions from the core schema. The tables start empty and collect
    // lifecycle facts prospectively, so boot never runs a production backfill.
    await client.query(PLAYER_METRICS_SCHEMA);
    await client.query(SOCIAL_SCHEMA);
    await client.query(OAUTH_SCHEMA);
    // Discord integration tables (links, oauth states, pending logins, reward
    // economy). FK-references accounts(id), so it runs after SCHEMA. Applied
    // unconditionally (idempotent) so the tables exist before the feature is
    // enabled, like the other schema modules.
    await client.query(DISCORD_SCHEMA);
    await client.query(APPLE_AUTH_SCHEMA);
    // GitHub link tables (links + oauth states) for the developer badge.
    // FK-references accounts(id), so it runs after SCHEMA. Applied unconditionally
    // (idempotent), like the Discord tables.
    await client.query(GITHUB_SCHEMA);
    // Tier-2 global rate-limit backstop table (pg-backed fixed-window counters,
    // one row per (policy, key)) for the multi-realm deployment. Applied
    // unconditionally (idempotent), like the Discord/GitHub tables. See
    // server/ratelimit_db.ts.
    await client.query(RATELIMIT_SCHEMA);
    // Fail-fast at boot if rate_limits did not materialize: the tier-2 limiter
    // depends on it, and a defined-but-unwired schema shipped once before
    // (DISCORD_SCHEMA, PR #1044). to_regclass sees the uncommitted DDL on this
    // same client inside the transaction. Scoped to this one table on purpose
    // (the other schemas stay test-guarded).
    const rateLimitsReg = await client.query("SELECT to_regclass('public.rate_limits') AS reg");
    if (!rateLimitsReg.rows[0]?.reg) {
      throw new Error(
        'rate_limits table missing after DDL: RATELIMIT_SCHEMA (server/ratelimit_db.ts) was not applied',
      );
    }
    // Reclaim expired tier-2 windows at boot (rows older than two windows are
    // dead by construction; see RATELIMIT_PRUNE_SQL). A concurrent serving realm
    // is unaffected: only expired windows match, and a racing UPSERT on a pruned
    // key simply re-inserts a fresh row.
    await client.query(RATELIMIT_PRUNE_SQL);
    // Map editor tables: saved/forked custom maps and uploaded GLB assets.
    // Both FK-reference accounts(id), so they run after SCHEMA. Applied
    // unconditionally (idempotent), like the other schema modules.
    await client.query(MAPS_SCHEMA);
    await client.query(USER_ASSETS_SCHEMA);
    // Seed the chat-filter word lists + config on first boot only (idempotent).
    // Runs under the same advisory lock so concurrent realm boots don't race.
    await seedChatFilterDefaults(client);
    // Partitioned World Market backfill. Runs inside this same
    // advisory-lock transaction (so a concurrent realm boot cannot race it) and
    // AFTER the schema modules exist. It splits any surviving pre-scoping
    // 'market' blob per seller realm, RETAINS the legacy row as a rollback
    // artifact, and records a marker row so every later boot is a no-op. See
    // server/market_backfill.ts.
    const marketBackfillDryRun = process.env.MARKET_BACKFILL_DRY_RUN === '1';
    const backfill = await runMarketBackfill({
      client,
      realm: REALM,
      dryRun: marketBackfillDryRun,
      log: (line) => console.log(line),
    });
    if (marketBackfillDryRun) {
      // Deliberate halt: the runner logged the per-realm plan and wrote nothing
      // (no partitions, no marker). Stop the boot so an operator can inspect the
      // plan before applying. The ROLLBACK in the catch is harmless: the DDL is
      // idempotent and the dry run wrote nothing.
      throw new Error(
        'MARKET_BACKFILL_DRY_RUN halted boot after computing the market backfill plan: no changes were written and the boot was stopped deliberately, unset MARKET_BACKFILL_DRY_RUN to apply',
      );
    }
    if (backfill.ran) {
      console.log(
        `[market-backfill] applied for realm ${REALM} (legacyRowFound=${backfill.legacyRowFound})`,
      );
    }
    await client.query('COMMIT');
    // CREATE INDEX CONCURRENTLY cannot run inside the schema transaction. Keep
    // the session-level form of the same advisory lock while running this
    // post-commit migration so simultaneous realm boots cannot race the index
    // name. The concurrent build permits normal play_sessions writes to continue.
    // The boot transaction's SET LOCAL statement_timeout = 0 reverted at the
    // COMMIT above, so re-disable it session-wide first: the advisory-lock wait
    // and the concurrent build can both outlast an operator-set database- or
    // role-level statement_timeout, and this dedicated client closes right
    // after, so the session setting never leaks to pooled connections.
    await client.query('SET statement_timeout = 0');
    let concurrentMigrationLocked = false;
    try {
      await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_ADVISORY_LOCK_KEY]);
      concurrentMigrationLocked = true;
      // A prior boot's build may have died mid-CONCURRENTLY (a deploy-watchdog
      // restart, a crash), stranding an INVALID index that IF NOT EXISTS would
      // treat as existing forever. Drop the carcass so the build self-heals.
      const invalidIndex = await client.query(PLAYER_METRICS_INVALID_INDEX_CHECK_SQL);
      if ((invalidIndex.rowCount ?? 0) > 0) {
        await client.query(PLAYER_METRICS_INVALID_INDEX_DROP_SQL);
      }
      await client.query(PLAYER_METRICS_CONCURRENT_INDEX_SQL);
      const invalidDailyRewardIndex = await client.query(
        DAILY_REWARD_EVENTS_INVALID_INDEX_CHECK_SQL,
      );
      if ((invalidDailyRewardIndex.rowCount ?? 0) > 0) {
        await client.query(DAILY_REWARD_EVENTS_INVALID_INDEX_DROP_SQL);
      }
      await client.query(DAILY_REWARD_EVENTS_CONCURRENT_INDEX_SQL);
    } finally {
      if (concurrentMigrationLocked) {
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_ADVISORY_LOCK_KEY]);
      }
    }
    // Open the market write gate only AFTER a successful COMMIT, so no market
    // write can land before the marker is durable. Opens on the no-op path too
    // (backfill.ran === false, i.e. the marker already existed).
    openMarketWriteGate();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    // Dedicated client, not a pool checkout: close the connection outright.
    await client.end().catch(() => {});
  }
}

export interface AccountRow {
  id: number;
  username: string;
  password_hash: string;
  // Recovery email (nullable): the login path selects it so the handler can tell
  // the client whether a pre-existing account still needs to set one.
  email?: string | null;
  // Present on the login path (findAccount): null/undefined when 2FA is off.
  totp_secret?: string | null;
  totp_enabled_at?: string | null;
  totp_last_window?: string | number | null;
}

export interface AccountModerationStatus {
  locked: boolean;
  banned: boolean;
  suspendedUntil: string | null;
  // True only for a self-deactivated account (locked, not banned, no active
  // suspension). Lets a caller distinguish the deactivation lock from a
  // suspension so it can surface the correct message/code (e.g. the API pipeline
  // requireAccount maps it to account.deactivated, not moderation.suspended).
  deactivated?: boolean;
  reason: string;
  message: string;
  // Chat mute is independent of `locked`: a muted account can still log in and
  // play, it just can't send chat until `chatMutedUntil` passes. Surfaced here
  // so the WS auth handshake can seed the live session without a second query.
  chatMutedUntil: string | null;
  chatStrikes: number;
}

export interface AccountChatMuteStatus {
  mutedUntil: string | null;
  reason: string;
}

export interface RequestMetadata {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: string[];
  // Season 1 Armory weapon skins: owned skin ids (granted on Claudium spend,
  // reconciled from the economy service) and the applied-skin-per-weapon-type
  // loadout. Account-wide by design; characters never carry either.
  weaponSkinIds: string[];
  weaponSkinLoadout: Record<string, string>;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.length > 0) out[key] = entry;
  }
  return out;
}

export function normalizeAccountCosmetics(value: unknown): AccountCosmetics {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    completedQuestIds: uniqueStrings(src.completedQuestIds),
    mechChromaIds: uniqueStrings(src.mechChromaIds),
    weaponSkinIds: uniqueStrings(src.weaponSkinIds),
    weaponSkinLoadout: stringRecord(src.weaponSkinLoadout),
  };
}

interface AccountCosmeticsRow {
  cosmetics?: unknown;
  weapon_skin_ids?: unknown;
  weapon_skin_loadout?: unknown;
}

function normalizeAccountCosmeticsRow(row: AccountCosmeticsRow | undefined): AccountCosmetics {
  const base = normalizeAccountCosmetics(row?.cosmetics);
  return {
    ...base,
    weaponSkinIds:
      row?.weapon_skin_ids === null || row?.weapon_skin_ids === undefined
        ? base.weaponSkinIds
        : uniqueStrings(row.weapon_skin_ids),
    weaponSkinLoadout:
      row?.weapon_skin_loadout === null || row?.weapon_skin_loadout === undefined
        ? base.weaponSkinLoadout
        : stringRecord(row.weapon_skin_loadout),
  };
}

export async function loadAccountCosmetics(accountId: number): Promise<AccountCosmetics> {
  const res = await pool.query(
    `SELECT a.cosmetics,
            awc.skin_ids AS weapon_skin_ids,
            awc.loadout AS weapon_skin_loadout
       FROM accounts a
       LEFT JOIN account_weapon_cosmetics awc ON awc.account_id = a.id
      WHERE a.id = $1`,
    [accountId],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}

/**
 * The account's operator-set flair (AI mark + streamer links). The stored JSONB is
 * treated as untrusted: the row always goes back through normalizeAccountFlair, so
 * a link that is not a plain https URL on the platform's own host is dropped here
 * rather than shipped to a client. An unknown account reads as no flair.
 */
export async function loadAccountFlair(accountId: number): Promise<AccountFlair> {
  const res = await pool.query(
    'SELECT is_ai, is_streamer, streamer_links FROM accounts WHERE id = $1',
    [accountId],
  );
  const row = res.rows[0];
  if (!row) return EMPTY_ACCOUNT_FLAIR;
  return normalizeAccountFlair({
    ai: row.is_ai,
    streamer: row.is_streamer,
    links: row.streamer_links,
  });
}

async function addAccountCosmeticId(
  accountId: number,
  key: 'completedQuestIds' | 'mechChromaIds',
  value: string,
): Promise<AccountCosmetics> {
  const res = await pool.query(
    `WITH updated AS (
       UPDATE accounts
          SET cosmetics = jsonb_set(
            COALESCE(cosmetics, '{}'::jsonb), ARRAY[$2::text],
            (SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v), '[]'::jsonb)
               FROM (
                 SELECT DISTINCT v FROM (
                   SELECT jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(cosmetics -> $2) = 'array'
                       THEN cosmetics -> $2 ELSE '[]'::jsonb END) AS v
                   UNION ALL SELECT $3::text
                 ) merged
               ) uniq))
        WHERE id = $1
        RETURNING id, cosmetics
     )
     SELECT updated.cosmetics,
            awc.skin_ids AS weapon_skin_ids,
            awc.loadout AS weapon_skin_loadout
       FROM updated
       LEFT JOIN account_weapon_cosmetics awc ON awc.account_id = updated.id`,
    [accountId, key, value],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}

export async function markAccountQuestComplete(
  accountId: number,
  questId: string,
): Promise<AccountCosmetics> {
  return addAccountCosmeticId(accountId, 'completedQuestIds', questId);
}

export async function grantAccountMechChroma(
  accountId: number,
  chromaId: string,
): Promise<AccountCosmetics> {
  return addAccountCosmeticId(accountId, 'mechChromaIds', chromaId);
}

export async function revokeAccountMechChroma(
  accountId: number,
  chromaId: string,
): Promise<AccountCosmetics> {
  const res = await pool.query(
    `WITH updated AS (
       UPDATE accounts
          SET cosmetics = jsonb_set(
            COALESCE(cosmetics, '{}'::jsonb), '{mechChromaIds}',
            (SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY ord), '[]'::jsonb)
               FROM jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(cosmetics -> 'mechChromaIds') = 'array'
                   THEN cosmetics -> 'mechChromaIds' ELSE '[]'::jsonb END)
                 WITH ORDINALITY AS entries(v, ord)
              WHERE v <> $2))
        WHERE id = $1
        RETURNING id, cosmetics
     )
     SELECT updated.cosmetics,
            awc.skin_ids AS weapon_skin_ids,
            awc.loadout AS weapon_skin_loadout
       FROM updated
       LEFT JOIN account_weapon_cosmetics awc ON awc.account_id = updated.id`,
    [accountId, chromaId],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}

/** Additive union in the rollback-safe paid-entitlement row. */
export async function grantAccountWeaponSkins(
  accountId: number,
  skinIds: string[],
): Promise<AccountCosmetics> {
  const res = await pool.query(
    `WITH upserted AS (
       INSERT INTO account_weapon_cosmetics AS awc (account_id, skin_ids)
       VALUES ($1, to_jsonb($2::text[]))
       ON CONFLICT (account_id) DO UPDATE SET
         skin_ids = (
           SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v), '[]'::jsonb)
             FROM (
               SELECT DISTINCT value AS v
                 FROM jsonb_array_elements_text(awc.skin_ids || EXCLUDED.skin_ids)
             ) merged),
         updated_at = now()
       RETURNING account_id, skin_ids, loadout
     )
     SELECT a.cosmetics,
            upserted.skin_ids AS weapon_skin_ids,
            upserted.loadout AS weapon_skin_loadout
       FROM upserted
       JOIN accounts a ON a.id = upserted.account_id`,
    [accountId, skinIds.filter((id) => id)],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}

/** Replace the applied-skin-per-weapon-type loadout in the paid-state row. */
export async function setAccountWeaponSkinLoadout(
  accountId: number,
  loadout: Record<string, string>,
): Promise<AccountCosmetics> {
  const cleanLoadout = stringRecord(loadout);
  const res = await pool.query(
    `WITH upserted AS (
       INSERT INTO account_weapon_cosmetics AS awc (account_id, loadout)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (account_id) DO UPDATE SET
         loadout = EXCLUDED.loadout,
         updated_at = now()
       RETURNING account_id, skin_ids, loadout
     )
     SELECT a.cosmetics,
            upserted.skin_ids AS weapon_skin_ids,
            upserted.loadout AS weapon_skin_loadout
       FROM upserted
       JOIN accounts a ON a.id = upserted.account_id`,
    [accountId, JSON.stringify(cleanLoadout)],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}

function cleanMetadataText(value: string | null | undefined, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

export async function createAccount(
  username: string,
  passwordHash: string,
  meta: RequestMetadata = {},
  // passwordSet=false marks an account whose password is a placeholder the owner
  // never chose (a Discord-provisioned account). Defaults TRUE for every normal
  // (register / portal) signup so nothing changes for them.
  opts: { passwordSet?: boolean } = {},
): Promise<AccountRow> {
  const res = await pool.query(
    `INSERT INTO accounts (username, password_hash, created_ip, created_user_agent, password_set)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, password_hash`,
    [
      username,
      passwordHash,
      cleanMetadataText(meta.ip, 128),
      cleanMetadataText(meta.userAgent, 512),
      opts.passwordSet ?? true,
    ],
  );
  return res.rows[0];
}

export async function findAccount(username: string): Promise<AccountRow | null> {
  const res = await pool.query(
    `SELECT id, username, password_hash, email, totp_secret, totp_enabled_at, totp_last_window
     FROM accounts WHERE username = $1`,
    [username],
  );
  return res.rows[0] ?? null;
}

export async function getAccountsCount(): Promise<number> {
  const res = await pool.query('SELECT COUNT(*)::int AS count FROM accounts');
  return res.rows[0]?.count ?? 0;
}

export async function touchLogin(accountId: number, meta: RequestMetadata = {}): Promise<void> {
  await pool.query(
    `UPDATE accounts
     SET last_login = now(), last_login_ip = $2, last_login_user_agent = $3
     WHERE id = $1`,
    [accountId, cleanMetadataText(meta.ip, 128), cleanMetadataText(meta.userAgent, 512)],
  );
}

// A bearer token's authority. 'full' is a normal web session; 'read' is a
// companion-app / OAuth character:read token, accepted only on read routes.
export type TokenScope = 'full' | 'read';

// The single scope policy, named so it is testable and can't drift: only a full
// token may hit a mutating/owner-action route; read and full may hit read routes.
export function scopeAllowsMutation(scope: TokenScope): boolean {
  return scope === 'full';
}
export function scopeAllowsRead(scope: TokenScope): boolean {
  return scope === 'read' || scope === 'full';
}

export async function saveToken(
  token: string,
  accountId: number,
  ttlHours = 24 * 7,
  scope: TokenScope = 'full',
  label: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO auth_tokens (token, account_id, expires_at, scope, label)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval, $4, $5)`,
    [token, accountId, String(ttlHours), scope, label],
  );
}

export async function accountForToken(token: string): Promise<number | null> {
  const res = await pool.query(
    'SELECT account_id FROM auth_tokens WHERE token = $1 AND expires_at > now()',
    [token],
  );
  return res.rows[0]?.account_id ?? null;
}

// Account + scope for a live token. Mirrors accountForToken but also returns the
// token's scope so read routes can accept 'read'|'full' while mutating routes
// (via bearerActiveAccount) reject anything that is not 'full'. Old tokens
// predating the scope column read as 'full' via the column default.
export async function accountAndScopeForToken(
  token: string,
): Promise<{ accountId: number; scope: TokenScope } | null> {
  const res = await pool.query(
    'SELECT account_id, scope FROM auth_tokens WHERE token = $1 AND expires_at > now()',
    [token],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { accountId: row.account_id, scope: row.scope === 'read' ? 'read' : 'full' };
}

export interface AccountInfoRow {
  id: number;
  username: string;
  password_hash: string;
  // Whether the owner set a real password (false for a Discord-provisioned account
  // that still only has its placeholder hash). The unlink + portal flows read it.
  password_set: boolean;
  email: string | null;
  created_at: string;
  deactivated_at: string | null;
  locale: string | null;
  marketing_opt_in: boolean;
}

// Full account record by id, used by the self-service account portal
// (whoami, password change, email, deactivate). Distinct from findAccount,
// which keys on username for the login path.
export async function accountById(accountId: number): Promise<AccountInfoRow | null> {
  const res = await pool.query(
    `SELECT id, username, password_hash, password_set, email, created_at, deactivated_at, locale, marketing_opt_in
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

// Account-wide character count across every realm. The account portal is an
// account-wide self-service surface, so it counts all of the account's
// characters (unlike realm-scoped listCharacters).
export async function characterCountForAccount(accountId: number): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM characters WHERE account_id = $1`,
    [accountId],
  );
  return res.rows[0]?.count ?? 0;
}

// Stamp a character's last world-entry time. Called best-effort on join; drives
// the "last seen" readout on guild-roster rows.
export async function touchCharacterLogin(characterId: number): Promise<void> {
  await pool.query('UPDATE characters SET last_login = now() WHERE id = $1', [characterId]);
}

export async function updatePasswordHash(accountId: number, passwordHash: string): Promise<void> {
  // Setting a password always makes it a real, owner-chosen one, so mark the
  // account usable (a no-op for accounts that were already password_set = TRUE,
  // and the conversion step for a Discord-provisioned account).
  await pool.query('UPDATE accounts SET password_hash = $2, password_set = TRUE WHERE id = $1', [
    accountId,
    passwordHash,
  ]);
}

// Revoke every token for an account except (optionally) the one in hand.
// A password change keeps the current device signed in (pass its token);
// a deactivate revokes everything (pass null).
export async function revokeTokensExcept(
  accountId: number,
  keepToken: string | null,
): Promise<void> {
  if (keepToken) {
    await pool.query('DELETE FROM auth_tokens WHERE account_id = $1 AND token <> $2', [
      accountId,
      keepToken,
    ]);
  } else {
    await pool.query('DELETE FROM auth_tokens WHERE account_id = $1', [accountId]);
  }
}

export async function revokeToken(token: string): Promise<void> {
  await pool.query('DELETE FROM auth_tokens WHERE token = $1', [token]);
}

// Revoke a read-scoped token by value (OAuth/RFC-7009 revocation, companion
// logout). Restricted to scope='read' so a presented full web-session token can
// never be deleted through this path. Returns true if a row was removed.
export async function revokeReadToken(token: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM auth_tokens WHERE token = $1 AND scope = 'read'`, [
    token,
  ]);
  return (res.rowCount ?? 0) > 0;
}

// ── Companion read-only tokens (scope='read') ──────────────────────────────
// Long-lived (default 90-day) read tokens a user can paste into a companion app
// instead of running the OAuth flow. They are ordinary auth_tokens rows with
// scope='read', so they work on /sheet and are rejected on every mutation.

export interface CompanionTokenRow {
  prefix: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
}

export async function createCompanionToken(
  token: string,
  accountId: number,
  label: string | null,
  ttlHours = 24 * 90,
): Promise<void> {
  await saveToken(token, accountId, ttlHours, 'read', label);
}

// Live (unexpired) read tokens for an account. Never returns the full secret,
// only an 8-char prefix for display, so a leaked portal response can't be
// replayed as a bearer token.
export async function listCompanionTokens(accountId: number): Promise<CompanionTokenRow[]> {
  const res = await pool.query(
    `SELECT token, label, created_at, expires_at
       FROM auth_tokens
      WHERE account_id = $1 AND scope = 'read' AND expires_at > now()
      ORDER BY created_at DESC`,
    [accountId],
  );
  return res.rows.map((r) => ({
    prefix: String(r.token).slice(0, 8),
    label: r.label ?? null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

// Revoke one of the account's read tokens, addressed by its 8-char prefix (what
// the portal lists). Scoped to scope='read' so this can never delete the
// caller's own full web session. Returns true if a row was removed.
export async function revokeCompanionToken(accountId: number, prefix: string): Promise<boolean> {
  if (!/^[a-f0-9]{8}$/.test(prefix)) return false;
  const res = await pool.query(
    `DELETE FROM auth_tokens
      WHERE account_id = $1 AND scope = 'read' AND left(token, 8) = $2`,
    [accountId, prefix],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function setAccountEmail(accountId: number, email: string | null): Promise<void> {
  await pool.query('UPDATE accounts SET email = $2 WHERE id = $1', [accountId, email]);
}

// Fill the recovery email ONLY when the account has none yet, never overwriting an
// address the owner already set (that can only change through the verified change
// flow). Used by the Discord capture path: a Discord-verified address seeds the
// recovery email + stamps email_verified_at, but a fresh Discord grant must never
// clobber an existing one. Idempotent (the WHERE makes a second call a no-op) and
// race-safe (the guard is in the UPDATE, not a read-then-write). Returns true when
// a row was actually filled.
export async function backfillAccountEmailIfEmpty(
  accountId: number,
  email: string,
  verified: boolean,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE accounts
       SET email = $2,
           email_verified_at = CASE WHEN $3 THEN now() ELSE email_verified_at END
     WHERE id = $1 AND (email IS NULL OR email = '')`,
    [accountId, email, verified],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function setAccountDeactivated(
  accountId: number,
  deactivated: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE accounts SET deactivated_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`,
    [accountId, deactivated],
  );
}

export async function setAccountLocale(accountId: number, locale: string | null): Promise<void> {
  await pool.query('UPDATE accounts SET locale = $2 WHERE id = $1', [accountId, locale]);
}

export async function setAccountMarketingOptIn(accountId: number, optIn: boolean): Promise<void> {
  await pool.query('UPDATE accounts SET marketing_opt_in = $2 WHERE id = $1', [accountId, optIn]);
}

// Lazily mint (and return) a stable per-account unsubscribe token. NULL-safe and
// idempotent: COALESCE keeps the existing token if one is already set, so the
// same unsubscribe link stays valid for the life of the account.
export async function ensureUnsubscribeToken(accountId: number, fresh: string): Promise<string> {
  const res = await pool.query(
    'UPDATE accounts SET unsubscribe_token = COALESCE(unsubscribe_token, $2) WHERE id = $1 RETURNING unsubscribe_token',
    [accountId, fresh],
  );
  return res.rows[0]?.unsubscribe_token ?? fresh;
}

export async function accountByUnsubscribeToken(token: string): Promise<number | null> {
  const res = await pool.query('SELECT id FROM accounts WHERE unsubscribe_token = $1', [token]);
  return res.rows[0]?.id ?? null;
}

// Minimal target descriptor for the outbound-mail glue (admin + system paths)
// that only needs where to send and in what language, not the full record.
export interface AccountMailTarget {
  id: number;
  username: string;
  email: string | null;
  locale: string | null;
  marketing_opt_in: boolean;
}

export async function accountMailTarget(accountId: number): Promise<AccountMailTarget | null> {
  const res = await pool.query(
    'SELECT id, username, email, locale, marketing_opt_in FROM accounts WHERE id = $1',
    [accountId],
  );
  return res.rows[0] ?? null;
}

export async function createEmailChangeRequest(
  accountId: number,
  newEmail: string,
  tokenHash: string,
  ttlHours: number,
): Promise<void> {
  // Invalidate any still-pending request for this account first: only the most
  // recent change link should be live (a user who re-requests supersedes the
  // old address), and this keeps the table from accumulating dead rows.
  await pool.query(
    'DELETE FROM email_change_requests WHERE account_id = $1 AND consumed_at IS NULL',
    [accountId],
  );
  await pool.query(
    `INSERT INTO email_change_requests (account_id, new_email, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
    [accountId, newEmail, tokenHash, String(ttlHours)],
  );
}

// Atomically consume a pending email-change token and apply it. The single
// UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() is the race guard:
// a replayed or expired link affects zero rows and returns null, and two
// concurrent clicks can never both win. On success we also stamp the new address
// onto the account (verified) in the same call.
export async function consumeEmailChangeRequest(
  tokenHash: string,
): Promise<{ accountId: number; newEmail: string } | null> {
  // Both writes run in one transaction on a single client: the token is burned
  // and the address applied atomically, so a failure on the second write can
  // never leave a consumed-but-unapplied request (a dead verify link with the
  // email never changed). The claiming UPDATE still row-locks the matched row,
  // so concurrent/replayed clicks serialize and exactly one wins.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query(
      `UPDATE email_change_requests
       SET consumed_at = now()
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING account_id, new_email`,
      [tokenHash],
    );
    const row = claim.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('UPDATE accounts SET email = $2, email_verified_at = now() WHERE id = $1', [
      row.account_id,
      row.new_email,
    ]);
    await client.query('COMMIT');
    return { accountId: row.account_id, newEmail: row.new_email };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function createPasswordResetRequest(
  accountId: number,
  tokenHash: string,
  ttlHours: number,
): Promise<void> {
  // Invalidate any still-pending reset for this account first: only the most
  // recent link stays live, and this keeps the table from accumulating dead rows.
  await pool.query(
    'DELETE FROM password_reset_requests WHERE account_id = $1 AND consumed_at IS NULL',
    [accountId],
  );
  await pool.query(
    `INSERT INTO password_reset_requests (account_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [accountId, tokenHash, String(ttlHours)],
  );
}

// Atomically consume a pending password-reset token, set the new password, and
// revoke every session, all in one transaction. The claiming UPDATE ... WHERE
// consumed_at IS NULL AND expires_at > now() is the race + replay guard: a
// replayed or expired link matches zero rows and returns null, and two concurrent
// clicks can never both win. Deleting all auth_tokens signs out every device,
// which is the right posture for a reset (the account may be recovering from a
// compromise), unlike the change-password path that keeps the current device.
export async function consumePasswordResetRequest(
  tokenHash: string,
  newPasswordHash: string,
): Promise<{ accountId: number } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query(
      `UPDATE password_reset_requests
       SET consumed_at = now()
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING account_id`,
      [tokenHash],
    );
    const row = claim.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }
    // Mirror updatePasswordHash: setting a password always marks the account
    // usable (this is also how a Discord-provisioned account that added an email
    // could gain a password).
    await client.query(
      'UPDATE accounts SET password_hash = $2, password_set = TRUE WHERE id = $1',
      [row.account_id, newPasswordHash],
    );
    await client.query('DELETE FROM auth_tokens WHERE account_id = $1', [row.account_id]);
    await client.query('COMMIT');
    return { accountId: row.account_id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface EmailLogEntry {
  accountId: number | null;
  event: string;
  toEmail: string;
  category: string;
  ok: boolean;
  error?: string | null;
}

export async function recordEmailLog(entry: EmailLogEntry): Promise<void> {
  await pool.query(
    `INSERT INTO email_log (account_id, event, to_email, category, ok, error)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.accountId, entry.event, entry.toEmail, entry.category, entry.ok, entry.error ?? null],
  );
}

// ── Two-factor auth (TOTP) ──────────────────────────────────────────────────

export interface TotpState {
  secret: string | null;
  pendingSecret: string | null;
  enabledAt: string | null;
  lastWindow: number | null;
}

export async function getTotpState(accountId: number): Promise<TotpState | null> {
  const res = await pool.query(
    `SELECT totp_secret, totp_pending_secret, totp_enabled_at, totp_last_window
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    secret: row.totp_secret ?? null,
    pendingSecret: row.totp_pending_secret ?? null,
    enabledAt: row.totp_enabled_at ?? null,
    lastWindow:
      row.totp_last_window === null || row.totp_last_window === undefined
        ? null
        : Number(row.totp_last_window),
  };
}

export async function accountTwoFactorEnabled(accountId: number): Promise<boolean> {
  const res = await pool.query('SELECT totp_enabled_at FROM accounts WHERE id = $1', [accountId]);
  return !!res.rows[0]?.totp_enabled_at;
}

// Stash a not-yet-confirmed secret from the setup step. Clears any prior pending
// secret so a re-run of setup always supersedes an abandoned one.
export async function setTotpPending(accountId: number, secret: string): Promise<void> {
  await pool.query('UPDATE accounts SET totp_pending_secret = $2 WHERE id = $1', [
    accountId,
    secret,
  ]);
}

// Promote the pending secret to active in one transaction with a fresh batch of
// recovery codes, so enabling 2FA and its recovery codes can never half-apply.
export async function enableTotp(
  accountId: number,
  secret: string,
  recoveryHashes: string[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE accounts
       SET totp_secret = $2, totp_pending_secret = NULL, totp_enabled_at = now(), totp_last_window = NULL
       WHERE id = $1`,
      [accountId, secret],
    );
    await client.query('DELETE FROM account_totp_recovery WHERE account_id = $1', [accountId]);
    for (const hash of recoveryHashes) {
      await client.query(
        'INSERT INTO account_totp_recovery (account_id, code_hash) VALUES ($1, $2)',
        [accountId, hash],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function disableTotp(accountId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE accounts
       SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_window = NULL
       WHERE id = $1`,
      [accountId],
    );
    await client.query('DELETE FROM account_totp_recovery WHERE account_id = $1', [accountId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Atomically claim a TOTP window at login. The conditional UPDATE is the race
// guard AND the replay guard in one: it succeeds (rowCount 1) only if this
// counter is strictly newer than the last accepted one, so two concurrent
// logins presenting the same fresh code cannot both win, and a code can never be
// replayed once its window has been claimed. Returns true when the claim won.
export async function claimTotpWindow(accountId: number, counter: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE accounts SET totp_last_window = $2
     WHERE id = $1 AND (totp_last_window IS NULL OR totp_last_window < $2)
     RETURNING id`,
    [accountId, counter],
  );
  return (res.rowCount ?? 0) > 0;
}

// Burn a recovery code atomically. The UPDATE ... WHERE consumed_at IS NULL is
// the race guard: a code matches at most one unconsumed row, and two concurrent
// uses of the same code can never both win.
export async function consumeRecoveryCode(accountId: number, codeHash: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE account_totp_recovery SET consumed_at = now()
     WHERE account_id = $1 AND code_hash = $2 AND consumed_at IS NULL
     RETURNING id`,
    [accountId, codeHash],
  );
  return (res.rowCount ?? 0) > 0;
}

// GDPR-style data export bundle: the account's own profile plus every character
// it owns on this realm, as plain JSON. Excludes secrets (password hash, tokens).
export async function exportAccountData(
  accountId: number,
): Promise<Record<string, unknown> | null> {
  const acct = await accountById(accountId);
  if (!acct) return null;
  const characters = await listCharacters(accountId);
  const twoFactorEnabled = await accountTwoFactorEnabled(accountId);
  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: acct.id,
      username: acct.username,
      email: acct.email,
      createdAt: acct.created_at,
      locale: acct.locale,
      marketingOptIn: acct.marketing_opt_in,
      twoFactorEnabled,
    },
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      class: c.class,
      level: c.level,
      state: c.state,
    })),
  };
}

// ── Non-custodial Solana wallet links ──────────────────────────────────────

export interface WalletLinkRow {
  account_id: number;
  pubkey: string;
  linked_at: string;
}

export async function createWalletChallenge(
  nonce: string,
  accountId: number,
  address: string,
  message: string,
  ttlMinutes = 10,
): Promise<void> {
  await pool.query(
    `INSERT INTO wallet_link_challenges (nonce, account_id, address, message, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
    [nonce, accountId, address, message, String(ttlMinutes)],
  );
}

// Atomically consume a challenge: returns the stored address+message if the
// nonce belongs to this account and is unexpired, deleting the row so a
// signature can never be replayed against it twice.
export async function consumeWalletChallenge(
  nonce: string,
  accountId: number,
): Promise<{ address: string; message: string } | null> {
  const res = await pool.query(
    `DELETE FROM wallet_link_challenges
     WHERE nonce = $1 AND account_id = $2 AND expires_at > now()
     RETURNING address, message`,
    [nonce, accountId],
  );
  return res.rows[0] ?? null;
}

export async function pruneWalletChallenges(): Promise<void> {
  await pool.query('DELETE FROM wallet_link_challenges WHERE expires_at <= now()');
}

export async function walletForAccount(accountId: number): Promise<WalletLinkRow | null> {
  const res = await pool.query(
    'SELECT account_id, pubkey, linked_at FROM wallet_links WHERE account_id = $1',
    [accountId],
  );
  return res.rows[0] ?? null;
}

export async function accountForWallet(pubkey: string): Promise<number | null> {
  const res = await pool.query('SELECT account_id FROM wallet_links WHERE pubkey = $1', [pubkey]);
  return res.rows[0]?.account_id ?? null;
}

// One wallet per account (account_id PK) and one account per wallet (pubkey
// UNIQUE). Upserts the caller's link; returns false when the wallet is already
// owned by a different account so the handler can surface a 409.
export async function linkWalletToAccount(accountId: number, pubkey: string): Promise<boolean> {
  const owner = await accountForWallet(pubkey);
  if (owner !== null && owner !== accountId) return false;
  try {
    await pool.query(
      `INSERT INTO wallet_links (account_id, pubkey) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET pubkey = EXCLUDED.pubkey, linked_at = now()`,
      [accountId, pubkey],
    );
  } catch (err) {
    // TOCTOU: another account claimed this pubkey between the check above and
    // here. The pubkey column is UNIQUE (not the ON CONFLICT target), so that
    // races to a 23505: treat it as "already owned" (409), not a 500.
    if (isUniqueViolation(err)) return false;
    throw err;
  }
  return true;
}

export async function unlinkWallet(accountId: number): Promise<void> {
  await pool.query('DELETE FROM wallet_links WHERE account_id = $1', [accountId]);
}

// ── Shareable player cards + referrals ─────────────────────────────────────

export interface PlayerCardRow {
  characterId: number;
  accountId: number;
  png: Buffer;
  title: string;
  description: string;
  locale: string;
}

// True when `slug` is free, or already owned by `exceptCharacterId` (so a
// character can re-publish under its own existing slug). Lets the handler pick a
// collision-free slug before the upsert.
export async function slugAvailable(slug: string, exceptCharacterId: number): Promise<boolean> {
  const res = await pool.query('SELECT character_id FROM player_cards WHERE slug = $1', [slug]);
  const owner = res.rows[0]?.character_id;
  return owner === undefined || owner === exceptCharacterId;
}

export async function upsertPlayerCard(card: {
  characterId: number;
  accountId: number;
  slug: string;
  png: Buffer;
  title: string;
  description: string;
  locale: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO player_cards (character_id, account_id, slug, png, title, description, locale, realm, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (character_id)
     DO UPDATE SET slug = EXCLUDED.slug, png = EXCLUDED.png, title = EXCLUDED.title,
                   description = EXCLUDED.description, locale = EXCLUDED.locale, updated_at = now()`,
    [
      card.characterId,
      card.accountId,
      card.slug,
      card.png,
      card.title,
      card.description,
      card.locale,
      REALM,
    ],
  );
}

export async function getPlayerCardBySlug(slug: string): Promise<PlayerCardRow | null> {
  const res = await pool.query(
    'SELECT character_id, account_id, png, title, description, locale FROM player_cards WHERE slug = $1',
    [slug],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    characterId: Number(row.character_id),
    accountId: Number(row.account_id),
    png: row.png as Buffer,
    title: row.title ?? '',
    description: row.description ?? '',
    locale: row.locale ?? 'en',
  };
}

// Metadata-only read for the OG-unfurl HTML page, which doesn't need the (up to
// ~4 MB) PNG bytes, keeps getPlayerCardBySlug's heavy SELECT for the image route.
export async function getPlayerCardMetaBySlug(
  slug: string,
): Promise<{ title: string; description: string; locale: string; updatedAt: number } | null> {
  const res = await pool.query(
    'SELECT title, description, locale, updated_at FROM player_cards WHERE slug = $1',
    [slug],
  );
  const row = res.rows[0];
  if (!row) return null;
  // `updated_at` (a per-publish timestamp) is the og:image cache-buster: a
  // re-published card gets a new ?v= so social/browser caches re-fetch the new PNG
  // instead of serving the stale one. Surface it as epoch ms (0 when absent) so the
  // caller versions the URL directly without re-parsing a string.
  const updatedAt = row.updated_at != null ? new Date(row.updated_at).getTime() : 0;
  return {
    title: row.title ?? '',
    description: row.description ?? '',
    locale: row.locale ?? 'en',
    updatedAt,
  };
}

// The account that owns a card slug, i.e. the referrer credited when someone
// signs up through their link.
export async function accountForSlug(slug: string): Promise<number | null> {
  const res = await pool.query('SELECT account_id FROM player_cards WHERE slug = $1', [slug]);
  return res.rows[0]?.account_id ?? null;
}

// Record that `referee` joined via `referrer`'s `slug`. Idempotent: only the
// first referral for a given referee is kept (PK on referee_account_id).
export async function recordReferral(
  refereeAccountId: number,
  referrerAccountId: number,
  slug: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO referrals (referee_account_id, referrer_account_id, slug)
     VALUES ($1, $2, $3)
     ON CONFLICT (referee_account_id) DO NOTHING`,
    [refereeAccountId, referrerAccountId, slug],
  );
}

export async function referralCountForAccount(accountId: number): Promise<number> {
  const res = await pool.query(
    'SELECT count(*)::int AS n FROM referrals WHERE referrer_account_id = $1',
    [accountId],
  );
  return res.rows[0]?.n ?? 0;
}

// The account facts that drive the bank bonus-slot registry (server/bank_entitlements.ts),
// read in ONE round trip because this runs at every fresh join. Cross-table reads are
// fine from here (discord_links DDL lives in server/discord_db.ts, wallet_links + referrals
// above): the query is the natural home for the join. A missing account returns all-false/0
// (the FROM accounts row is absent, so res.rows[0] is undefined and the fallback applies).
//   - emailVerified: the RESOLVED criterion, email_verified_at IS NOT NULL, never email-present.
//   - discordLinked / walletLinked: a link ROW is the whole proof. NEVER a balance, holder tier,
//     or any chain state (the $WOC PRDs pin cosmetic-only; a wallet's contents are out of scope).
//   - qualifiedReferrals: referrals this account referred whose referee owns ANY character at
//     level >= 10 (the denormalized characters.level; deliberately realm-agnostic, referrals are
//     account-global; the characters_account index covers the probe). Counted RAW; the cap is
//     registry data applied in computeBankBonus.
export async function bankBonusFactsForAccount(accountId: number): Promise<BankBonusFacts> {
  const res = await pool.query(
    `SELECT
       (a.email_verified_at IS NOT NULL) AS email_verified,
       EXISTS(SELECT 1 FROM discord_links dl WHERE dl.account_id = $1) AS discord_linked,
       EXISTS(SELECT 1 FROM wallet_links wl WHERE wl.account_id = $1) AS wallet_linked,
       (SELECT count(*)::int FROM referrals r
          WHERE r.referrer_account_id = $1
            AND EXISTS(
              SELECT 1 FROM characters c
              WHERE c.account_id = r.referee_account_id AND c.level >= 10
            )) AS qualified_referrals
     FROM accounts a
     WHERE a.id = $1`,
    [accountId],
  );
  const row = res.rows[0];
  return {
    emailVerified: !!row?.email_verified,
    discordLinked: !!row?.discord_linked,
    walletLinked: !!row?.wallet_linked,
    qualifiedReferrals: row?.qualified_referrals ?? 0,
  };
}

// This account's published-card slug, if any (one slug per card; an account can
// have several characters, so return the most recently updated card's slug for
// referral display).
export async function primarySlugForAccount(accountId: number): Promise<string | null> {
  const res = await pool.query(
    'SELECT slug FROM player_cards WHERE account_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [accountId],
  );
  return res.rows[0]?.slug ?? null;
}

// Where a character ranks among all characters on its realm by lifetime XP (the
// canonical progression metric, encodes level plus post-cap overflow), for the
// player card's "Top N%" flex. Ownership + realm are enforced via the caller's
// account; returns null when the character isn't the caller's. rank is 1-based
// (1 = highest lifetime XP on the realm); total is the ELIGIBLE realm
// population (both counts embed the same ELIGIBLE_ACCOUNT_SQL delisting as the
// boards, so a banned/suspended account absent from every board is not counted
// ahead or in the total here either).
export async function lifetimeXpStanding(
  accountId: number,
  characterId: number,
): Promise<{ rank: number; total: number } | null> {
  // One round-trip: the `own` subquery yields this character's lifetime XP and
  // gates ownership/realm (ungated by eligibility: the owner may view their own
  // rank regardless). The count-ahead predicate uses the same expression as
  // characters_lifetime_xp so PostgreSQL can use that expression index.
  const res = await pool.query(
    `SELECT
       (SELECT count(*) FROM characters
         WHERE realm = $1 AND ${LIFETIME_XP_EXPR} > own.xp
           AND EXISTS (SELECT 1 FROM accounts a
                        WHERE a.id = characters.account_id AND ${ELIGIBLE_ACCOUNT_SQL}))::int AS ahead,
       (SELECT count(*) FROM characters
         WHERE realm = $1
           AND EXISTS (SELECT 1 FROM accounts a
                        WHERE a.id = characters.account_id AND ${ELIGIBLE_ACCOUNT_SQL}))::int AS total
     FROM (SELECT COALESCE(${LIFETIME_XP_EXPR}, 0) AS xp
             FROM characters WHERE id = $2 AND account_id = $3 AND realm = $1) own`,
    [REALM, characterId, accountId],
  );
  if ((res.rowCount ?? 0) === 0) return null; // character isn't the caller's
  return { rank: (res.rows[0]?.ahead ?? 0) + 1, total: res.rows[0]?.total ?? 0 };
}

// Realm-scoped lifetime-XP rank for a character addressed by id, WITHOUT an
// ownership check, for the public character sheet / profile page, where rank is
// shown for any player. Same expression-index predicate as lifetimeXpStanding,
// and the same eligibility gate on both counts: total is the ELIGIBLE realm
// population (same ELIGIBLE_ACCOUNT_SQL delisting as the boards), and a delisted
// higher-XP account is not counted ahead. UNLIKE lifetimeXpStanding, the `own`
// subquery is ALSO eligibility-gated here: this feeds UNAUTHENTICATED public
// surfaces (GET /c/:name, GET /api/public/characters/:name/sheet), so a banned
// or suspended account must not publicly show a rank at all. The bearer-only
// self-view (lifetimeXpStanding) keeps its own subquery ungated so an owner
// still sees their own rank. Returns null when no such character exists on this
// realm OR when the viewed account is delisted (the callers render name/level
// with no rank line on null, so this is not a 404).
export async function lifetimeXpRankForCharacter(
  characterId: number,
): Promise<{ rank: number; total: number } | null> {
  const res = await pool.query(
    `SELECT
       (SELECT count(*) FROM characters
         WHERE realm = $1 AND ${LIFETIME_XP_EXPR} > own.xp
           AND EXISTS (SELECT 1 FROM accounts a
                        WHERE a.id = characters.account_id AND ${ELIGIBLE_ACCOUNT_SQL}))::int AS ahead,
       (SELECT count(*) FROM characters
         WHERE realm = $1
           AND EXISTS (SELECT 1 FROM accounts a
                        WHERE a.id = characters.account_id AND ${ELIGIBLE_ACCOUNT_SQL}))::int AS total
     FROM (SELECT COALESCE(${LIFETIME_XP_EXPR}, 0) AS xp,
                  EXISTS (SELECT 1 FROM accounts a
                           WHERE a.id = characters.account_id AND ${ELIGIBLE_ACCOUNT_SQL}) AS eligible
             FROM characters WHERE id = $2 AND realm = $1) own`,
    [REALM, characterId],
  );
  if ((res.rowCount ?? 0) === 0) return null;
  // The subject's own account is banned or suspended: a public surface shows no
  // rank for a delisted account (its bearer-authenticated self-view still does).
  if (!res.rows[0]?.eligible) return null;
  return { rank: (res.rows[0]?.ahead ?? 0) + 1, total: res.rows[0]?.total ?? 0 };
}

export async function moderationStatusForAccount(
  accountId: number,
): Promise<AccountModerationStatus> {
  const res = await pool.query(
    `SELECT banned_at, suspended_until, moderation_reason, chat_muted_until, chat_strikes, deactivated_at
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  const row = res.rows[0];
  if (!row) {
    return {
      locked: false,
      banned: false,
      suspendedUntil: null,
      reason: '',
      message: '',
      chatMutedUntil: null,
      chatStrikes: 0,
    };
  }
  const mutedUntilDate = row.chat_muted_until ? new Date(row.chat_muted_until) : null;
  const chatMutedUntil =
    mutedUntilDate && mutedUntilDate.getTime() > Date.now() ? mutedUntilDate.toISOString() : null;
  const chatStrikes = Number(row.chat_strikes ?? 0);
  // Admin-imposed states (ban, then active suspension) outrank a self-imposed
  // deactivation: a banned+deactivated account must still surface the ban reason
  // and label, not be relabelled "deactivated". All branches resolve to locked.
  if (row.banned_at) {
    return {
      locked: true,
      banned: true,
      suspendedUntil: null,
      reason: row.moderation_reason ?? '',
      message: 'This account has been banned.',
      chatMutedUntil,
      chatStrikes,
    };
  }
  const suspendedUntil = row.suspended_until ? new Date(row.suspended_until) : null;
  if (suspendedUntil && suspendedUntil.getTime() > Date.now()) {
    return {
      locked: true,
      banned: false,
      suspendedUntil: suspendedUntil.toISOString(),
      reason: row.moderation_reason ?? '',
      message: `This account is suspended until ${suspendedUntil.toUTCString()}.`,
      chatMutedUntil,
      chatStrikes,
    };
  }
  // A self-deactivated account is locked out of login + WS auth (same gate as
  // banned/suspended) until an admin reactivates it.
  if (row.deactivated_at) {
    return {
      locked: true,
      banned: false,
      suspendedUntil: null,
      deactivated: true,
      reason: '',
      message: 'This account has been deactivated.',
      chatMutedUntil,
      chatStrikes,
    };
  }
  return {
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil,
    chatStrikes,
  };
}

export async function chatMuteStatusForAccount(accountId: number): Promise<AccountChatMuteStatus> {
  const res = await pool.query(
    `SELECT chat_muted_until, chat_mute_reason
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  const row = res.rows[0];
  const mutedUntil = row?.chat_muted_until ? new Date(row.chat_muted_until) : null;
  if (!mutedUntil || mutedUntil.getTime() <= Date.now()) return { mutedUntil: null, reason: '' };
  return {
    mutedUntil: mutedUntil.toISOString(),
    reason: row.chat_mute_reason ?? '',
  };
}

export interface CharacterRow {
  id: number;
  account_id: number;
  name: string;
  class: PlayerClass;
  level: number;
  state: CharacterState | null;
  is_gm: boolean;
  force_rename: boolean;
  last_played?: Date | string | null;
  playtime_seconds?: string | number | null;
}

// The account's "top" character on this realm (highest level, then lifetime XP),
// for the Discord nameplate flair / level-on-nickname. Realm-scoped like the other
// reads. Fully parameterized: the only inputs (accountId, REALM) are bound as $1/$2;
// the ORDER BY uses a static JSONB expression literal (Postgres does not allow a
// bound parameter for an ORDER BY expression), so the query string carries no
// interpolation and there is no injection surface.
export async function highestCharacterForAccount(accountId: number): Promise<CharacterRow | null> {
  const res = await pool.query(
    `SELECT id, account_id, name, class, level, state, is_gm, force_rename
       FROM characters
      WHERE account_id = $1 AND realm = $2
      ORDER BY level DESC, ((state->>'lifetimeXp')::bigint) DESC NULLS LAST, id ASC
      LIMIT 1`,
    [accountId, REALM],
  );
  return res.rows[0] ?? null;
}

// Character reads/writes are scoped to this process's realm: an account may
// hold characters on several realms (each served by its own process), but a
// process only ever lists, loads, or creates characters on its own realm.
export async function listCharacters(accountId: number): Promise<CharacterRow[]> {
  const res = await pool.query(
    `SELECT c.id, c.account_id, c.name, c.class, c.level, c.state, c.is_gm, c.force_rename,
            ps.last_played, ps.playtime_seconds
       FROM characters c
       LEFT JOIN (
         SELECT character_id,
                MAX(started_at) AS last_played,
                COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))), 0)::bigint AS playtime_seconds
           FROM play_sessions
          WHERE account_id = $1
          GROUP BY character_id
       ) ps ON ps.character_id = c.id
      WHERE c.account_id = $1 AND c.realm = $2
      ORDER BY c.id`,
    [accountId, REALM],
  );
  return res.rows;
}

export async function getCharacter(
  accountId: number,
  characterId: number,
): Promise<CharacterRow | null> {
  const res = await pool.query(
    'SELECT id, account_id, name, class, level, state, is_gm, force_rename FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3',
    [characterId, accountId, REALM],
  );
  return res.rows[0] ?? null;
}

// Active character names on this realm for the public character sitemap, ranked
// by lifetime XP so the most significant players lead the file. Capped by the
// caller (sitemap protocol allows 50k URLs/file).
export async function listCharacterNamesForSitemap(limit = 50000): Promise<string[]> {
  const res = await pool.query(
    `SELECT name FROM characters WHERE realm = $1 ORDER BY ${LIFETIME_XP_EXPR} DESC NULLS LAST LIMIT $2`,
    [REALM, Math.max(0, Math.min(50000, Math.floor(limit)))],
  );
  return res.rows.map((r) => r.name as string);
}

// Realm-scoped character read by id WITHOUT an ownership check, for the public
// character sheet / profile page, which serve any character on the realm. Returns
// the same shape as getCharacter so the sheet normalizer treats both alike.
export async function getCharacterById(characterId: number): Promise<CharacterRow | null> {
  const res = await pool.query(
    'SELECT id, account_id, name, class, level, state, is_gm, force_rename FROM characters WHERE id = $1 AND realm = $2',
    [characterId, REALM],
  );
  return res.rows[0] ?? null;
}

export async function findCharacterReportTargetByName(
  name: string,
): Promise<{ accountId: number; characterId: number; characterName: string } | null> {
  const term = name.trim();
  if (!term) return null;
  const res = await pool.query(
    `SELECT account_id, id, name
     FROM characters
     WHERE realm = $1 AND lower(name) = lower($2)
     LIMIT 1`,
    [REALM, term],
  );
  const row = res.rows[0];
  return row
    ? { accountId: Number(row.account_id), characterId: Number(row.id), characterName: row.name }
    : null;
}

// Guild display name for a character (realm-scoped), or null when unguilded.
// Read here rather than via PgSocialDb so the character-sheet/profile routes can
// fetch it without constructing a SocialService, and to avoid a db↔social_db
// import cycle. Mirrors the guilds/guild_members join in social_db.ts.
export async function guildNameForCharacter(characterId: number): Promise<string | null> {
  const res = await pool.query(
    `SELECT g.name
       FROM guild_members gm
       JOIN guilds g ON g.id = gm.guild_id
      WHERE gm.character_id = $1 AND g.realm = $2
      LIMIT 1`,
    [characterId, REALM],
  );
  return res.rows[0]?.name ?? null;
}

export async function createCharacterCapped(
  accountId: number,
  name: string,
  cls: PlayerClass,
  limit = 10,
  state: CharacterState | null = null,
): Promise<CharacterRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [
      accountId,
    ]);
    if ((account.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const count = await client.query(
      'SELECT count(*)::int AS n FROM characters WHERE account_id = $1 AND realm = $2',
      [accountId, REALM],
    );
    if (Number(count.rows[0]?.n ?? 0) >= limit) {
      await client.query('ROLLBACK');
      return null;
    }
    const res = await client.query(
      'INSERT INTO characters (account_id, name, class, realm, state) VALUES ($1, $2, $3, $4, $5) RETURNING id, account_id, name, class, level, state, is_gm, force_rename',
      [accountId, name, cls, REALM, state ? JSON.stringify(state) : null],
    );
    await recordCharacterCreation(client, accountId, REALM);
    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Reclaim a character name abandoned by a deactivated ("invalid") account.
// Character names are unique per (realm, lower(name)), and deactivation is a
// soft delete (accounts.deactivated_at) that leaves the account's characters in
// place, so an abandoned name stays reserved forever, blocking the original
// player from recreating it on a new account. Classic MMOs free the names of
// deactivated/deleted accounts; this releases such a name by archiving the
// orphaned character (a suffixed placeholder name + force_rename) so its row
// stays valid and the original owner is prompted to pick a new name if they
// ever reactivate. A name held by a live account, or by a banned account (a
// moderation hold we must not undo), is left reserved. Returns whether a name
// was released; the caller then retries the create. Race-safe: the holder row
// is locked FOR UPDATE and the (realm, lower(name)) unique index is the real
// guard on the subsequent insert.
export async function reclaimDeactivatedName(name: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const holder = await client.query(
      `SELECT c.id, c.name, a.deactivated_at, a.banned_at
         FROM characters c JOIN accounts a ON a.id = c.account_id
        WHERE c.realm = $1 AND lower(c.name) = lower($2)
        FOR UPDATE OF c`,
      [REALM, name],
    );
    const row = holder.rows[0];
    // Free already, held by a live account, or under a moderation ban: nothing to reclaim.
    if (!row || row.deactivated_at == null || row.banned_at != null) {
      await client.query('ROLLBACK');
      return false;
    }
    // Find an archival placeholder for the orphaned character that collides with
    // no other name in this realm (case-insensitive), mirroring the dedupe scheme.
    // The scan/increment/fallback decision lives in the pure chooseArchiveName;
    // here we just supply the SQL-backed "is this candidate already taken?" probe.
    const freed = await chooseArchiveName(row.name, row.id, async (candidate) => {
      const clash = await client.query(
        `SELECT 1 FROM characters WHERE realm = $1 AND lower(name) = lower($2) AND id <> $3 LIMIT 1`,
        [REALM, candidate, row.id],
      );
      return (clash.rowCount ?? 0) > 0;
    });
    await client.query(
      `UPDATE characters SET name = $2, force_rename = TRUE, updated_at = now() WHERE id = $1`,
      [row.id, freed],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteCharacter(accountId: number, characterId: number): Promise<boolean> {
  const res = await pool.query(
    'DELETE FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3',
    [characterId, accountId, REALM],
  );
  return (res.rowCount ?? 0) > 0;
}

// How many characters this account has on each realm, deliberately NOT
// realm-scoped, so the realm-list screen can show "N characters" per realm
// like classic MMOs. Keyed by realm name.
export async function characterCountsByRealm(accountId: number): Promise<Record<string, number>> {
  const res = await pool.query(
    'SELECT realm, count(*)::int AS n FROM characters WHERE account_id = $1 GROUP BY realm',
    [accountId],
  );
  const out: Record<string, number> = {};
  for (const r of res.rows) out[r.realm] = r.n;
  return out;
}

export interface CharacterSearchRow {
  name: string;
  cls: PlayerClass;
  level: number;
}

// Realm-scoped username typeahead: case-insensitive prefix match, capped.
// Wildcards in the input are escaped so they can't widen the match.
export async function searchCharacters(prefix: string, limit = 8): Promise<CharacterSearchRow[]> {
  const term = prefix.trim();
  if (!term) return [];
  const escaped = term.replace(/[\\%_]/g, (m) => `\\${m}`);
  const res = await pool.query(
    `SELECT name, class AS cls, level FROM characters
     WHERE realm = $1 AND lower(name) LIKE lower($2) ESCAPE '\\' ORDER BY name LIMIT $3`,
    [REALM, `${escaped}%`, Math.min(20, Math.max(1, limit))],
  );
  return res.rows;
}

export async function renameCharacter(
  accountId: number,
  characterId: number,
  name: string,
): Promise<CharacterRow | null> {
  // A rename is only ever sanctioned by a moderator's "Force name change", which
  // sets force_rename. Gating the UPDATE on `force_rename = TRUE` makes the server
  // authoritative (the UI hides the control, but the API must not trust that) and
  // is race-free: a successful rename clears the flag, so it self-limits to exactly
  // one rename per moderator action.
  const res = await pool.query(
    `UPDATE characters
     SET name = $3, force_rename = FALSE, updated_at = now()
     WHERE id = $1 AND account_id = $2 AND realm = $4 AND force_rename = TRUE
     RETURNING id, account_id, name, class, level, state, is_gm, force_rename`,
    [characterId, accountId, name, REALM],
  );
  return res.rows[0] ?? null;
}

// Persist a character row. Returns true when the write landed. When a leaseNonce is
// given the UPDATE is fenced to the current lease holder+nonce in the SAME statement:
// a displaced session (its lease reclaimed by a same-account takeover, which rotated
// the nonce) matches no lease row, the UPDATE touches nothing, and this returns false
// so the caller can refuse to overwrite the live session's state. The fence rides the
// write statement itself and never a separate pre-check, because a check-then-write
// pair would race the takeover that steals the lease between the two. The no-nonce path
// (tests, resumes, meta-less sessions) writes unconditionally and returns true, exactly
// as before.
export async function saveCharacterState(
  characterId: number,
  level: number,
  state: CharacterState,
  leaseNonce?: string,
): Promise<boolean> {
  const cleanState = sanitizeRemovedZone1Content(state).state;
  // A character save should wait out a slow database rather than lose state, so
  // run it on the raised heavy allowance; still bounded so a leave / shutdown
  // flush cannot hang past the container stop grace.
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    leaseNonce === undefined
      ? query('UPDATE characters SET level = $2, state = $3, updated_at = now() WHERE id = $1', [
          characterId,
          level,
          JSON.stringify(cleanState),
        ])
      : query(
          `UPDATE characters SET level = $2, state = $3, updated_at = now()
            WHERE id = $1
              AND EXISTS (
                SELECT 1 FROM character_leases
                 WHERE character_id = $1 AND holder = $4 AND nonce = $5
              )`,
          [characterId, level, JSON.stringify(cleanState), PROCESS_LEASE_HOLDER, leaseNonce],
        ),
  );
  return leaseNonce === undefined ? true : (res.rowCount ?? 0) > 0;
}

// Persist a character row AND this realm's World Market + Ravenpost mail blobs
// in ONE transaction. They live in different tables (characters / world_state),
// but a Market listing and a mail attachment are both escrows: the item leaves
// the character's bags (character state) and becomes a listing / a letter
// parcel (world state) in the same Sim action. Saving them as independent
// writes lets an unclean crash persist one half and not the other, vaporising
// the item or duplicating it across bags and book. The leave path uses this so
// a logout flush of bags can never tear away from either escrow.
export async function saveCharacterAndMarketState(
  characterId: number,
  level: number,
  state: CharacterState,
  market: MarketSave,
  mail: MailSave,
  leaseNonce?: string,
): Promise<boolean> {
  // Gate the escrow flush on the boot backfill just like saveMarketState:
  // this writes the realm-market row, so it must not run before ensureSchema
  // has confirmed the marker and opened the gate. Checked before any pool work.
  assertMarketWriteGateOpen();
  const cleanState = sanitizeRemovedZone1Content(state).state;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same rationale as saveCharacterState: a logout / shutdown escrow flush should
    // wait out a slow database rather than lose the character + market blobs, so
    // raise this transaction to the heavy allowance; still bounded so shutdown
    // cannot hang past the container stop grace. SET LOCAL reverts at COMMIT.
    await client.query(`SET LOCAL statement_timeout = ${DB_HEAVY_STATEMENT_TIMEOUT_MS}`);
    // Fence the bag half on the current lease holder+nonce when one is given (same
    // in-statement fence as saveCharacterState). If a same-account takeover rotated
    // the nonce out from under this displaced session, the character UPDATE matches
    // no row: ROLL BACK before touching the market/mail rows and report false. The
    // escrow halves must never land without the bag half, and a displaced session
    // must not overwrite the realm's shared Market/Ravenpost escrow either.
    const charRes =
      leaseNonce === undefined
        ? await client.query(
            'UPDATE characters SET level = $2, state = $3, updated_at = now() WHERE id = $1',
            [characterId, level, JSON.stringify(cleanState)],
          )
        : await client.query(
            `UPDATE characters SET level = $2, state = $3, updated_at = now()
              WHERE id = $1
                AND EXISTS (
                  SELECT 1 FROM character_leases
                   WHERE character_id = $1 AND holder = $4 AND nonce = $5
                )`,
            [characterId, level, JSON.stringify(cleanState), PROCESS_LEASE_HOLDER, leaseNonce],
          );
    if (leaseNonce !== undefined && (charRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `INSERT INTO world_state (key, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      // Same realm-scoped key loadMarketState/saveMarketState use: the leave
      // flush must land where the market is read back, or the escrowed listing
      // is written to a key nothing loads and the item is stranded on next boot.
      [marketStateKey(REALM), JSON.stringify(market)],
    );
    await client.query(
      `INSERT INTO world_state (key, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [mailStateKey(REALM), JSON.stringify(mail)],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function isAdminAccount(accountId: number): Promise<boolean> {
  const res = await pool.query('SELECT is_admin FROM accounts WHERE id = $1', [accountId]);
  return res.rows[0]?.is_admin === true;
}

// ---------------------------------------------------------------------------
// Arena rankings: the Ashen Coliseum's all-time ladder. Ratings/records live
// inside each character's state JSONB (no schema migration needed); only
// characters who have actually fought a bout appear.
// ---------------------------------------------------------------------------

export interface ArenaLeaderRow {
  name: string;
  class: PlayerClass;
  level: number;
  rating: number;
  wins: number;
  losses: number;
}

export async function topArenaRatings(
  limit = 20,
  format: ArenaFormat = '1v1',
): Promise<ArenaLeaderRow[]> {
  const fmt: ArenaFormat = format === '2v2' ? '2v2' : '1v1';
  const ratingExpr =
    fmt === '2v2'
      ? "COALESCE((state->>'arena2v2Rating')::int, 1500)"
      : "COALESCE((state->>'arena1v1Rating')::int, (state->>'arenaRating')::int, 1500)";
  const winsExpr =
    fmt === '2v2'
      ? "COALESCE((state->>'arena2v2Wins')::int, 0)"
      : "COALESCE((state->>'arena1v1Wins')::int, (state->>'arenaWins')::int, 0)";
  const lossesExpr =
    fmt === '2v2'
      ? "COALESCE((state->>'arena2v2Losses')::int, 0)"
      : "COALESCE((state->>'arena1v1Losses')::int, (state->>'arenaLosses')::int, 0)";
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT name, class, level,
            ${ratingExpr} AS rating,
            ${winsExpr} AS wins,
            ${lossesExpr} AS losses
       FROM characters
      WHERE realm = $1
        AND state IS NOT NULL
        AND ${winsExpr} + ${lossesExpr} > 0
        AND EXISTS (SELECT 1 FROM accounts a
                     WHERE a.id = characters.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
      ORDER BY rating DESC, wins DESC, name ASC
      LIMIT $2`,
      [REALM, Math.max(1, Math.min(100, limit))],
    ),
  );
  return res.rows.map((r) => ({
    name: r.name,
    class: r.class,
    level: r.level,
    rating: Number(r.rating),
    wins: Number(r.wins),
    losses: Number(r.losses),
  }));
}

// ---------------------------------------------------------------------------
// Lifetime-XP leaderboard (Max-Level XP Overflow). Ranks characters by the
// `lifetimeXp` stored in their state JSONB. Realm-scoped (FR-4.3) and backed by
// the `characters_lifetime_xp` index. Read through the server-side cache in
// main.ts, never run per request under load.
// ---------------------------------------------------------------------------

export interface LifetimeXpLeaderRow {
  name: string;
  class: PlayerClass;
  level: number;
  realm: string;
  lifetimeXp: number;
  prestigeRank: number;
  // The selected Book of Deeds title (a deed id the client localizes; never
  // English), null when untitled. The charactersForDeedsBoard read shape.
  activeTitle: string | null;
}

// `global: true` ranks across every realm (for the home-page board); otherwise
// it is scoped to this process's realm (the in-game panel). Both paths sort on
// the indexed lifetime-XP expression and are read through the main.ts cache.
export async function topLifetimeXp(
  limit = 100,
  opts: { global?: boolean } = {},
): Promise<LifetimeXpLeaderRow[]> {
  // Capped at LEADERBOARD_MAX (1000): the in-game board pages through this whole
  // cached window, so a realm with hundreds of max-level players is fully ranked.
  const cap = Math.max(1, Math.min(LEADERBOARD_MAX, limit));
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    opts.global
      ? query(
          `SELECT name, class, level, realm,
                COALESCE((state->>'lifetimeXp')::bigint, 0) AS lifetime_xp,
                COALESCE((state->>'prestigeRank')::int, 0)  AS prestige_rank,
                state->>'activeTitle' AS active_title
           FROM characters
          WHERE state IS NOT NULL
            AND COALESCE((state->>'lifetimeXp')::bigint, 0) > 0
            AND EXISTS (SELECT 1 FROM accounts a
                         WHERE a.id = characters.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
          ORDER BY lifetime_xp DESC, level DESC, name ASC
          LIMIT $1`,
          [cap],
        )
      : query(
          `SELECT name, class, level, realm,
                COALESCE((state->>'lifetimeXp')::bigint, 0) AS lifetime_xp,
                COALESCE((state->>'prestigeRank')::int, 0)  AS prestige_rank,
                state->>'activeTitle' AS active_title
           FROM characters
          WHERE realm = $1 AND state IS NOT NULL
            AND COALESCE((state->>'lifetimeXp')::bigint, 0) > 0
            AND EXISTS (SELECT 1 FROM accounts a
                         WHERE a.id = characters.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
          ORDER BY lifetime_xp DESC, level DESC, name ASC
          LIMIT $2`,
          [REALM, cap],
        ),
  );
  return res.rows.map((r) => ({
    name: r.name,
    class: r.class,
    level: r.level,
    realm: r.realm,
    lifetimeXp: Number(r.lifetime_xp),
    prestigeRank: Number(r.prestige_rank),
    // Normalized like charactersForDeedsBoard: a non-empty string or null.
    activeTitle:
      typeof r.active_title === 'string' && r.active_title !== '' ? r.active_title : null,
  }));
}

// ---------------------------------------------------------------------------
// Guild high-score board: ranks guilds by the SUM of every member's lifetimeXp.
// Aggregate JOIN of guilds -> guild_members -> characters (all in this pool); an
// INNER JOIN drops guilds with no seated members. Realm-scoped (the in-game
// panel) or global (cross-realm), mirroring topLifetimeXp. Read through the
// server-side cache in main.ts, never run per request under load.
// ---------------------------------------------------------------------------

export interface GuildLeaderRow {
  name: string;
  realm: string;
  memberCount: number;
  totalLifetimeXp: number;
  topLevel: number;
}

export async function topGuilds(
  limit = 100,
  opts: { global?: boolean } = {},
): Promise<GuildLeaderRow[]> {
  // Capped at LEADERBOARD_MAX (1000) like the player board, so a realm with many
  // guilds is fully ranked through the cached window.
  const cap = Math.max(1, Math.min(LEADERBOARD_MAX, limit));
  const selectAgg = `g.name, g.realm,
                COUNT(gm.character_id)                                AS member_count,
                COALESCE(SUM(COALESCE((c.state->>'lifetimeXp')::bigint, 0)), 0) AS total_lifetime_xp,
                COALESCE(MAX(COALESCE((c.state->>'level')::int, 0)), 0)         AS top_level`;
  // The eligibility predicate applies to the MEMBER characters inside the SUM:
  // a banned or suspended member's XP stops inflating the guild score (and its
  // seat leaves member_count) without delisting the whole guild. A guild whose
  // every member is ineligible drops off the board like any empty guild.
  const fromJoin = `FROM guilds g
           JOIN guild_members gm ON gm.guild_id = g.id
           JOIN characters c ON c.id = gm.character_id
            AND EXISTS (SELECT 1 FROM accounts a
                         WHERE a.id = c.account_id AND ${ELIGIBLE_ACCOUNT_SQL})`;
  const groupOrder = `GROUP BY g.id, g.name, g.realm
          ORDER BY total_lifetime_xp DESC, member_count DESC, g.name ASC`;
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    opts.global
      ? query(
          `SELECT ${selectAgg}
           ${fromJoin}
          WHERE c.state IS NOT NULL
          ${groupOrder}
          LIMIT $1`,
          [cap],
        )
      : query(
          `SELECT ${selectAgg}
           ${fromJoin}
          WHERE g.realm = $1 AND c.state IS NOT NULL
          ${groupOrder}
          LIMIT $2`,
          [REALM, cap],
        ),
  );
  return res.rows.map((r) => ({
    name: r.name,
    realm: r.realm,
    memberCount: Number(r.member_count),
    totalLifetimeXp: Number(r.total_lifetime_xp),
    topLevel: Number(r.top_level),
  }));
}

// ---------------------------------------------------------------------------
// Renown board read (the account-level deeds leaderboard). Renown values are
// content-owned (server/deeds_board.ts doctrine: never stored in SQL, so a
// rebalance needs no migration), so the caller passes the whole content table
// as two parallel arrays plus the score floor and the roll-up runs IN Postgres.
// The read is cache-fronted in main.ts, never run per request under load.
// ---------------------------------------------------------------------------

// The account-level Renown ranking, aggregated IN Postgres and cross-realm (the
// board is account-level and accounts span realms, so it has exactly one global
// scope). Renown values come in as `renowns` parallel to `deedIds` (the content
// table, never SQL), and `floor` is the entry cutoff. The query pushes the
// counted-set roll-up, the floor, the display-character pick, and the final
// ordering into the database, so only the ranked accounts cross the wire, never
// the whole character_deeds table (the roll-up is a full-table hash aggregate by
// design; deliberately no LIMIT, so it can never become a cap that drops a
// legitimate account). The output maps 1:1 onto computeDeedsBoard(...).ranked
// (server/deeds_board.ts is the executable spec this mirrors): per account the
// SCORING SET is the distinct renown-bearing deed ids, so a deed earned by two
// characters scores once; zero-renown deeds sit outside the scoring set (they
// never score and never move the tie-break); the floor is inclusive;
// completionTime is max over the scoring set of each deed's EARLIEST earn; the
// display character is the account's highest per-character Renown character,
// ties to the lowest id; ordering is renown desc, completion asc, accountId
// asc.
export async function deedsBoardRanked(
  deedIds: readonly string[],
  renowns: readonly number[],
  floor: number,
): Promise<{ ranked: RankedDeedsAccount[]; totalRanked: number; unknownDeedIds: string[] }> {
  // Both reads run in ONE raised-timeout transaction: the roll-up is a full-table
  // hash aggregate and the unknown-id side read a DISTINCT scan, so a large
  // character_deeds table can legitimately exceed the default statement timeout.
  // The shared transaction raises the allowance once and reuses one client; it
  // does NOT give the two reads a single snapshot (READ COMMITTED, see the
  // runWithStatementTimeout header), so a commit landing between them can skew
  // the pair by one refresh cycle. Acceptable here: the board is a TTL-cached
  // cosmetic aggregate and the next refresh converges.
  return runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, async (query) => {
    const res = await query(
      `WITH renown(deed_id, renown) AS (
       SELECT * FROM unnest($1::text[], $2::int[]) AS u(deed_id, renown) WHERE u.renown > 0
     ),
     per_deed AS (
       SELECT cd.account_id, cd.deed_id, min(cd.earned_at) AS first_earned
         FROM character_deeds cd
         JOIN characters c ON c.id = cd.character_id
         JOIN accounts a ON a.id = cd.account_id
         JOIN renown r ON r.deed_id = cd.deed_id
        WHERE ${ELIGIBLE_ACCOUNT_SQL}
        GROUP BY cd.account_id, cd.deed_id
     ),
     account_agg AS (
       SELECT pd.account_id,
              sum(r.renown)::int AS renown,
              max(pd.first_earned) AS completion_time
         FROM per_deed pd
         JOIN renown r ON r.deed_id = pd.deed_id
        GROUP BY pd.account_id
       HAVING sum(r.renown) >= $3
     ),
     per_char AS (
       SELECT cd.account_id, cd.character_id, sum(r.renown)::int AS char_renown
         FROM character_deeds cd
         JOIN characters c ON c.id = cd.character_id
         JOIN accounts a ON a.id = cd.account_id
         JOIN renown r ON r.deed_id = cd.deed_id
        WHERE ${ELIGIBLE_ACCOUNT_SQL}
        GROUP BY cd.account_id, cd.character_id
     ),
     display AS (
       SELECT DISTINCT ON (account_id) account_id, character_id
         FROM per_char
        ORDER BY account_id, char_renown DESC, character_id ASC
     )
     SELECT aa.account_id,
            aa.renown,
            aa.completion_time,
            d.character_id AS display_character_id
       FROM account_agg aa
       JOIN display d ON d.account_id = aa.account_id
      ORDER BY aa.renown DESC, aa.completion_time ASC, aa.account_id ASC`,
      [deedIds, renowns, floor],
    );
    const ranked: RankedDeedsAccount[] = res.rows.map((r) => ({
      accountId: Number(r.account_id),
      renown: Number(r.renown),
      // TIMESTAMPTZ back to epoch ms (Date via pg; string tolerated for driver
      // config drift), matching computeDeedsBoard's earnedMs.
      completionTime: new Date(r.completion_time).getTime(),
      displayCharacterId: Number(r.display_character_id),
    }));
    // Deed ids present in character_deeds but absent from the content table
    // entirely (removed or renamed content), for the same warn computeDeedsBoard
    // emitted. A cheap side read kept off the aggregation's hot path: scored rows
    // already excluded these via the renown join, so this never shrinks a score,
    // only surfaces the ids. A zero-renown KNOWN deed is not flagged (its id is in
    // $1), matching computeDeedsBoard's def-present test.
    const unknown = await query(
      `SELECT DISTINCT deed_id FROM character_deeds WHERE deed_id <> ALL($1::text[])`,
      [deedIds],
    );
    const unknownDeedIds = unknown.rows.map((r) => String(r.deed_id)).sort();
    return { ranked, totalRanked: ranked.length, unknownDeedIds };
  });
}

/** The display-character fill for ranked accounts: name, realm, class, level,
 *  and the selected title (a deed id the client localizes; never English). */
export interface DeedsBoardCharacterRow {
  id: number;
  name: string;
  class: PlayerClass;
  level: number;
  realm: string;
  activeTitle: string | null;
}

// One IN query for the board's display characters. Names/realms are read live
// at each cache refresh (never persisted in the board), so a rename shows
// within one board TTL.
export async function charactersForDeedsBoard(
  characterIds: readonly number[],
): Promise<DeedsBoardCharacterRow[]> {
  if (characterIds.length === 0) return [];
  const res = await pool.query(
    `SELECT id, name, class, level, realm, state->>'activeTitle' AS active_title
       FROM characters
      WHERE id = ANY($1::int[])`,
    [characterIds],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    class: r.class,
    level: Number(r.level),
    realm: r.realm,
    activeTitle:
      typeof r.active_title === 'string' && r.active_title !== '' ? r.active_title : null,
  }));
}

// ---------------------------------------------------------------------------
// Client performance telemetry: small, sanitized summaries from the browser.
// Kept separate from play sessions because reports can come from offline
// benchmark runs with no account, and one session may emit several samples.
// ---------------------------------------------------------------------------

export interface ClientPerfReportInsert {
  schemaVersion: number;
  releaseVersion: string;
  buildId: string;
  sessionId: string;
  accountId: number | null;
  characterId: number | null;
  realm: string;
  graphicsPreset: string;
  gfxTier: string;
  autoGovernor: boolean;
  targetFps: number;
  renderScale: number;
  effectiveRenderScale: number;
  fpsAvg: number;
  frameP95Ms: number;
  frameP99Ms: number;
  longFrameCount: number;
  rendererCalls: number;
  rendererTriangles: number;
  rendererTextures: number;
  rendererPrograms: number;
  contextLostCount: number;
  longTaskCount: number;
  longTaskP95Ms: number;
  memoryUsedMb: number | null;
  memoryLimitMb: number | null;
  dpr: number;
  viewportBucket: string;
  deviceMemory: number | null;
  hardwareConcurrency: number;
  mobileTouch: boolean;
  browserFamily: string;
  osFamily: string;
  glVendor: string;
  glRendererBucket: string;
  zoneOrScenario: string;
  source: string;
  rawSummary: Record<string, unknown>;
}

export async function insertClientPerfReport(row: ClientPerfReportInsert): Promise<void> {
  await pool.query(
    `INSERT INTO client_perf_reports (
       schema_version, release_version, build_id, session_id, account_id, character_id, realm,
       graphics_preset, gfx_tier, auto_governor, target_fps, render_scale, effective_render_scale,
       fps_avg, frame_p95_ms, frame_p99_ms, long_frame_count,
       renderer_calls, renderer_triangles, renderer_textures, renderer_programs, context_lost_count,
       long_task_count, long_task_p95_ms, memory_used_mb, memory_limit_mb,
       dpr, viewport_bucket, device_memory, hardware_concurrency, mobile_touch,
       browser_family, os_family, gl_vendor, gl_renderer_bucket, zone_or_scenario, source, raw_summary
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17,
       $18, $19, $20, $21, $22,
       $23, $24, $25, $26,
       $27, $28, $29, $30, $31,
       $32, $33, $34, $35, $36, $37, $38
     )`,
    [
      row.schemaVersion,
      row.releaseVersion,
      row.buildId,
      row.sessionId,
      row.accountId,
      row.characterId,
      row.realm,
      row.graphicsPreset,
      row.gfxTier,
      row.autoGovernor,
      row.targetFps,
      row.renderScale,
      row.effectiveRenderScale,
      row.fpsAvg,
      row.frameP95Ms,
      row.frameP99Ms,
      row.longFrameCount,
      row.rendererCalls,
      row.rendererTriangles,
      row.rendererTextures,
      row.rendererPrograms,
      row.contextLostCount,
      row.longTaskCount,
      row.longTaskP95Ms,
      row.memoryUsedMb,
      row.memoryLimitMb,
      row.dpr,
      row.viewportBucket,
      row.deviceMemory,
      row.hardwareConcurrency,
      row.mobileTouch,
      row.browserFamily,
      row.osFamily,
      row.glVendor,
      row.glRendererBucket,
      row.zoneOrScenario,
      row.source,
      JSON.stringify(row.rawSummary),
    ],
  );
}

// Keeps production telemetry bounded. PERF_REPORT_RETENTION_DAYS=0 disables
// pruning for a short manual capture window.
export async function pruneClientPerfReports(retentionDays: number): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await pool.query(
    `DELETE FROM client_perf_reports
      WHERE created_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return res.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// World state: a tiny key→JSONB store for shared, global game state that isn't
// tied to one character. The World Market (the Merchant's auction house) lives
// here under the per-realm `market:<realm>` key, listings plus per-seller
// collections. See loadMarketState/saveMarketState below.
// ---------------------------------------------------------------------------

export async function loadWorldState<T>(key: string): Promise<T | null> {
  const res = await pool.query('SELECT data FROM world_state WHERE key = $1', [key]);
  return (res.rows[0]?.data as T) ?? null;
}

export async function saveWorldState(key: string, data: unknown): Promise<void> {
  // The pre-scoping bare 'market' row is RETAINED as the rollback artifact for
  // the partitioned market backfill (server/market_backfill.ts) and is never
  // written again: reject any attempt to persist it, gate open or not.
  if (key === LEGACY_MARKET_KEY) {
    throw new Error(
      'legacy market key is read-only: the pre-scoping "market" row is retained as a rollback artifact (see server/market_backfill.ts)',
    );
  }
  // A realm-market write must not race ahead of the boot backfill: block every
  // `market:<realm>` write until ensureSchema has confirmed the marker row and
  // opened the gate (openMarketWriteGate).
  if (key.startsWith(MARKET_KEY_PREFIX)) {
    assertMarketWriteGateOpen();
  }
  await pool.query(
    `INSERT INTO world_state (key, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [key, JSON.stringify(data)],
  );
}

// Boot-ordering write gate for the World Market. Before ensureSchema's
// partitioned backfill (server/market_backfill.ts) has run and recorded its
// marker row, a realm process must not persist its market: the 30 s autosave
// could otherwise overwrite a realm partition the backfill has not produced
// yet. ensureSchema opens the gate only AFTER its advisory-lock transaction
// COMMITs (also when the marker pre-existed and the backfill was a no-op).
let marketWriteGateOpen = false;

export function openMarketWriteGate(): void {
  marketWriteGateOpen = true;
}

// Test-only: re-close the gate so a fresh test starts from the boot default.
// (vi.resetModules also yields a fresh CLOSED gate; this is the in-file reset.)
export function closeMarketWriteGateForTests(): void {
  marketWriteGateOpen = false;
}

function assertMarketWriteGateOpen(): void {
  if (!marketWriteGateOpen) {
    throw new Error(
      'market write blocked: ensureSchema must confirm the backfill marker first before any market:<realm> write (see server/market_backfill.ts)',
    );
  }
}

// The World Market is realm-scoped like characters, friends, guilds and
// presence: each realm process keeps its own listings under `market:<realm>`.
// Before this scoping the market lived in a single bare 'market' row shared by
// every realm pointed at the same DATABASE_URL, so two realms silently
// overwrote each other's listings and proceeds (and stomped nextListingId).
//
// Migration is NOT lazy here: ensureSchema runs a partitioned backfill
// (server/market_backfill.ts) inside its advisory-lock transaction, splitting
// the legacy blob per seller realm, RETAINING the legacy row as a rollback
// artifact, and recording completion in the MARKET_BACKFILL_MARKER_KEY marker
// row. Every market write is gated on that marker (openMarketWriteGate) so a
// racing autosave can never overtake the backfill. loadMarketState is a pure
// READ: it serves the realm row, and only a pre-backfill database (no marker)
// still falls back to the retained legacy row, never writing or deleting it.
export async function loadMarketState(): Promise<MarketSave | null> {
  const own = await loadWorldState<MarketSave>(marketStateKey(REALM));
  if (own !== null) return own;
  // No realm row. If the ensureSchema backfill has recorded its marker, a
  // backfilled database never serves the stale legacy blob (this realm simply
  // has no market yet, which is correct). Only a database that predates the
  // backfill (no marker) falls back to a plain back-compat READ of the retained
  // legacy row; the backfill owns adoption, so this path never writes or deletes.
  // On a normal boot this fallback is unreachable (ensureSchema always confirms
  // the marker before game.loadMarket runs); it is a defensive net for an
  // out-of-band caller hitting a pre-backfill database.
  const marker = await loadWorldState<unknown>(MARKET_BACKFILL_MARKER_KEY);
  if (marker !== null) return null;
  return loadWorldState<MarketSave>(LEGACY_MARKET_KEY);
}

export async function saveMarketState(save: MarketSave): Promise<void> {
  assertMarketWriteGateOpen();
  await saveWorldState(marketStateKey(REALM), save);
}

// The Ravenpost mail book: realm-scoped like the market, one JSONB blob per
// realm under `mail:<realm>`. Born realm-scoped, so no legacy migration.
export function mailStateKey(realm: string): string {
  return `mail:${realm}`;
}

export async function loadMailState(): Promise<MailSave | null> {
  return loadWorldState<MailSave>(mailStateKey(REALM));
}

export async function saveMailState(save: MailSave): Promise<void> {
  await saveWorldState(mailStateKey(REALM), save);
}

// ---------------------------------------------------------------------------
// Play sessions: one row per character login, closed on logout. Powers the
// admin dashboard's playtime / DAU / sessions-per-day metrics.
// ---------------------------------------------------------------------------

export async function openPlaySession(
  accountId: number,
  characterId: number,
  characterName: string,
  meta: RequestMetadata = {},
  initialLevel = 1,
): Promise<number> {
  return openPlayerSession(pool, {
    accountId,
    characterId,
    characterName,
    realm: REALM,
    initialLevel,
    ipAddress: cleanMetadataText(meta.ip, 128),
    userAgent: cleanMetadataText(meta.userAgent, 512),
  });
}

export async function closePlaySession(sessionId: number, maxLevel = 1): Promise<void> {
  await closePlayerSession(pool, sessionId, REALM, maxLevel);
}

// Sessions left open by a crash have an unknown duration; close them at their
// start time so they don't inflate playtime stats forever. Scope this to the
// current realm: in the process-per-realm model peers share one database, and
// an unscoped UPDATE would force-close sessions still live on other realms.
export async function closeOrphanSessions(): Promise<number> {
  return closeOrphanPlayerSessions(pool, REALM);
}

// ---------------------------------------------------------------------------
// Character load leases: the cross-process double-load dupe guard. At most one
// process may hold a character in-world at a time. A row in character_leases IS
// the lease; it self-releases via expiry after a crash, so no client checkout
// or advisory lock is pinned for the session's whole length (that would starve
// the pool this shares with HTTP). heartbeats ride the 30s autosave loop.
// ---------------------------------------------------------------------------

// Lease lifetime with no heartbeat before an expired lease is reclaimable. Set
// to three missed 30s autosave heartbeats so a brief GC pause or an autosave
// that runs long never lets a peer steal a live character; only a genuine crash
// (or a clean shutdown that deletes the lease) frees it early.
export const LEASE_TTL_SECONDS = 90;

// One value per process boot: realm name plus a per-boot UUID. Realm alone must
// NOT identify the holder, because two processes accidentally started on the
// SAME realm name is exactly the double-load accident this table guards; if they
// shared a holder the second would treat the first's lease as its own and load
// the character anyway. The UUID keeps every boot distinct.
export const PROCESS_LEASE_HOLDER = `${REALM}#${randomUUID()}`;

// Claim (or renew) the lease for one character. Returns true when this process
// now holds it, false when a live lease belongs to a foreign holder AND a foreign
// account (fail closed: the caller must refuse the join). The ON CONFLICT UPDATE
// fires when the existing lease has expired (crash reclaim) OR is already ours (a
// linkdead resume on the same process re-extends its own lease instead of refusing
// itself) OR belongs to the same account (the owner reclaiming a lease stranded by
// a dead or wedged process before its TTL expires). A live lease that is none of
// those matches no arm, so rowCount stays 0. Every acquire stamps a fresh nonce
// (the caller passes a per-join value): a later releaseCharacterLease matches on
// that nonce, so an older join's stale release cannot delete the row this acquire
// re-stamped, and a same-account reclaim rotates the nonce out from under any
// displaced session, whose fenced writes then fail. accountId is the authenticated
// owner (getCharacter gated the caller before this runs).
export async function acquireCharacterLease(
  characterId: number,
  accountId: number,
  nonce: string,
  holder = PROCESS_LEASE_HOLDER,
): Promise<boolean> {
  const res = await pool.query(
    // The nonce rotation needs no extra code: this ONE atomic statement already
    // re-stamps nonce = EXCLUDED.nonce, which IS the fence rotation. The account arm
    // uses PLAIN EQUALITY (never IS NOT DISTINCT FROM): SQL NULL semantics make a
    // NULL account_id row (a lease that predates this column) fail the account arm
    // and every arm except expiry, which is exactly the locked fail-closed behavior.
    `INSERT INTO character_leases (character_id, realm, holder, nonce, account_id, acquired_at, heartbeat_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, now(), now(), now() + make_interval(secs => $6))
     ON CONFLICT (character_id) DO UPDATE
       SET realm = EXCLUDED.realm,
           holder = EXCLUDED.holder,
           nonce = EXCLUDED.nonce,
           account_id = EXCLUDED.account_id,
           acquired_at = now(),
           heartbeat_at = now(),
           expires_at = EXCLUDED.expires_at
       WHERE character_leases.expires_at < now() OR character_leases.holder = EXCLUDED.holder OR character_leases.account_id = EXCLUDED.account_id`,
    [characterId, REALM, holder, nonce, accountId, LEASE_TTL_SECONDS],
  );
  return (res.rowCount ?? 0) > 0;
}

// Drop the lease for one character on a clean leave. Guarded on holder so this
// never deletes a lease that another process has already reclaimed (e.g. after
// our own lease expired and a peer took over). When a nonce is given it is also
// matched, the fence that makes a stale release a no-op: if a newer acquire has
// re-stamped the row with a different nonce (a reconnect that raced this leave),
// the DELETE finds nothing and the live session keeps its lease. The no-nonce
// arm is for callers that created a session without one (direct game.join in
// tests); it deletes on holder alone as before.
export async function releaseCharacterLease(
  characterId: number,
  nonce?: string,
  holder = PROCESS_LEASE_HOLDER,
): Promise<void> {
  if (nonce === undefined) {
    await pool.query('DELETE FROM character_leases WHERE character_id = $1 AND holder = $2', [
      characterId,
      holder,
    ]);
    return;
  }
  await pool.query(
    'DELETE FROM character_leases WHERE character_id = $1 AND holder = $2 AND nonce = $3',
    [characterId, holder, nonce],
  );
}

// Extend every lease this process holds in one statement, called from the
// autosave loop. A lease already reclaimed by another holder is not matched, so
// this can never steal one back.
export async function heartbeatCharacterLeases(holder = PROCESS_LEASE_HOLDER): Promise<void> {
  await pool.query(
    `UPDATE character_leases
        SET heartbeat_at = now(),
            expires_at = now() + make_interval(secs => $2)
      WHERE holder = $1`,
    [holder, LEASE_TTL_SECONDS],
  );
}

// Shutdown sweep: drop every lease this process holds so a clean restart never
// waits out the TTL before its characters can reload.
export async function releaseAllCharacterLeases(holder = PROCESS_LEASE_HOLDER): Promise<void> {
  await pool.query('DELETE FROM character_leases WHERE holder = $1', [holder]);
}

// ---------------------------------------------------------------------------
// Chat logs: one row per sent say/party message, written in batches by the
// ChatLogger in game.ts. Name is denormalized so logs survive character
// deletion (the FK goes NULL but the row keeps its meaning for moderation).
// ---------------------------------------------------------------------------

export async function insertChatLogs(rows: ChatLogRow[]): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO chat_logs (account_id, character_id, character_name, channel, message)
     SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::text[])`,
    [
      rows.map((r) => r.accountId),
      rows.map((r) => r.characterId),
      rows.map((r) => r.characterName),
      rows.map((r) => r.channel),
      rows.map((r) => r.message),
    ],
  );
}

// Keeps the table bounded; CHAT_LOG_RETENTION_DAYS=0 disables pruning.
export async function pruneChatLogs(retentionDays: number): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(`DELETE FROM chat_logs WHERE created_at < now() - ($1 || ' days')::interval`, [
      String(Math.floor(retentionDays)),
    ]),
  );
  return res.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Bank ledger: one append-only row per SUCCESSFUL bank op, written fire-and-forget
// off the game loop by server/bank_ledger.ts. See the bank_ledger DDL block in
// SCHEMA above; realm is passed explicitly (the table carries no DEFAULT), and
// container is always 'personal' with a NULL container_id until the guild bank
// lands. `instance` is the item's per-instance payload (or null for a plain
// fungible stack / a buy_slots row), serialized the same way as characters.state.
// ---------------------------------------------------------------------------

export interface BankLedgerRow {
  realm: string;
  characterId: number;
  accountId: number;
  op: 'deposit' | 'withdraw' | 'buy_slots';
  itemId: string | null;
  count: number | null;
  instance: unknown;
  copperDelta: number;
  purchasedSlotsAfter: number;
  container: 'personal';
  containerId: null;
}

export async function insertBankLedgerRow(row: BankLedgerRow): Promise<void> {
  await pool.query(
    `INSERT INTO bank_ledger
       (realm, character_id, account_id, op, item_id, count, instance,
        copper_delta, purchased_slots_after, container, container_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      row.realm,
      row.characterId,
      row.accountId,
      row.op,
      row.itemId,
      row.count,
      row.instance == null ? null : JSON.stringify(row.instance),
      row.copperDelta,
      row.purchasedSlotsAfter,
      row.container,
      row.containerId,
    ],
  );
}
