import { Pool } from 'pg';
import { isUniqueViolation } from './http_util';
import type { CharacterState, MarketSave } from '../src/sim/sim';
import type { ArenaFormat, PlayerClass } from '../src/sim/types';
import type { ChatLogRow } from './chat_log';
import { SOCIAL_SCHEMA } from './social_db';
import { FLOW_LEDGER_SCHEMA } from './flow_ledger_db';
import { BUYBACK_BATCHES_SCHEMA } from './payout_db';
import { seedChatFilterDefaults } from './chat_filter_db';
import { REALM } from './realm';

try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; production usually injects DATABASE_URL directly.
}
try {
  // Local-dev convenience: also load .env.local so the server can reuse the
  // client's VITE_* values (e.g. the Solana RPC + $WOC mint) for the in-world
  // holder-tier reads. Existing keys from .env are not overwritten. In
  // production these come from real env vars (SOLANA_RPC_URL / WOC_MINT).
  process.loadEnvFile?.('.env.local');
} catch {
  // .env.local is optional.
}

export const DATABASE_URL =
  process.env.DATABASE_URL ?? (() => {
    throw new Error('DATABASE_URL is required. For local dev, copy .env.example to .env and run through docker compose.');
  })();

export const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const REALM_SQL_DEFAULT = REALM.replace(/'/g, "''");
const LIFETIME_XP_EXPR = "((state->>'lifetimeXp')::bigint)";

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
-- Max-Level XP Overflow leaderboard: indexed lifetime-XP sort key. The first
-- index serves the realm-scoped in-game panel; the second serves the global
-- (cross-realm) home-page board.
CREATE INDEX IF NOT EXISTS characters_lifetime_xp
  ON characters (realm, ${LIFETIME_XP_EXPR} DESC);
CREATE INDEX IF NOT EXISTS characters_lifetime_xp_global
  ON characters (${LIFETIME_XP_EXPR} DESC);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
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
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS accounts_created_at ON accounts(created_at DESC);
CREATE INDEX IF NOT EXISTS accounts_created_ip_created ON accounts(created_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS accounts_created_user_agent_created ON accounts(created_user_agent, created_at DESC);
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
CREATE TABLE IF NOT EXISTS world_state (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
-- intentionally out of scope here — this just captures the relationship so it
-- can be synced to rewards later.
CREATE TABLE IF NOT EXISTS referrals (
  referee_account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  referrer_account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(referrer_account_id);
`;

export async function ensureSchema(): Promise<void> {
  // In the process-per-realm model several server processes boot against the
  // same database at once. Their idempotent CREATE/ALTER statements would
  // otherwise deadlock when run concurrently, so serialize schema setup behind
  // a transaction-scoped advisory lock (auto-released on COMMIT). The lock key
  // is an arbitrary constant shared by every process.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [0x57_4f_43_01]); // "WOC\x01"
    await client.query(SCHEMA);
    await client.query(SOCIAL_SCHEMA);
    await client.query(FLOW_LEDGER_SCHEMA);
    await client.query(BUYBACK_BATCHES_SCHEMA);
    // Seed the chat-filter word lists + config on first boot only (idempotent).
    // Runs under the same advisory lock so concurrent realm boots don't race.
    await seedChatFilterDefaults(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface AccountRow {
  id: number;
  username: string;
  password_hash: string;
}

export interface AccountModerationStatus {
  locked: boolean;
  banned: boolean;
  suspendedUntil: string | null;
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

export function normalizeAccountCosmetics(value: unknown): AccountCosmetics {
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    completedQuestIds: uniqueStrings(src.completedQuestIds),
    mechChromaIds: uniqueStrings(src.mechChromaIds),
  };
}

export async function loadAccountCosmetics(accountId: number): Promise<AccountCosmetics> {
  const res = await pool.query('SELECT cosmetics FROM accounts WHERE id = $1', [accountId]);
  return normalizeAccountCosmetics(res.rows[0]?.cosmetics);
}

async function saveAccountCosmetics(accountId: number, cosmetics: AccountCosmetics): Promise<AccountCosmetics> {
  const res = await pool.query(
    'UPDATE accounts SET cosmetics = $2 WHERE id = $1 RETURNING cosmetics',
    [accountId, cosmetics],
  );
  return normalizeAccountCosmetics(res.rows[0]?.cosmetics ?? cosmetics);
}

export async function markAccountQuestComplete(accountId: number, questId: string): Promise<AccountCosmetics> {
  const cosmetics = await loadAccountCosmetics(accountId);
  const completedQuestIds = cosmetics.completedQuestIds.includes(questId)
    ? cosmetics.completedQuestIds
    : [...cosmetics.completedQuestIds, questId];
  return saveAccountCosmetics(accountId, { ...cosmetics, completedQuestIds });
}

export async function grantAccountMechChroma(accountId: number, chromaId: string): Promise<AccountCosmetics> {
  const cosmetics = await loadAccountCosmetics(accountId);
  const mechChromaIds = cosmetics.mechChromaIds.includes(chromaId)
    ? cosmetics.mechChromaIds
    : [...cosmetics.mechChromaIds, chromaId];
  return saveAccountCosmetics(accountId, { ...cosmetics, mechChromaIds });
}

export async function revokeAccountMechChroma(accountId: number, chromaId: string): Promise<AccountCosmetics> {
  const cosmetics = await loadAccountCosmetics(accountId);
  const mechChromaIds = cosmetics.mechChromaIds.filter((id) => id !== chromaId);
  return saveAccountCosmetics(accountId, { ...cosmetics, mechChromaIds });
}

function cleanMetadataText(value: string | null | undefined, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

export async function createAccount(username: string, passwordHash: string, meta: RequestMetadata = {}): Promise<AccountRow> {
  const res = await pool.query(
    `INSERT INTO accounts (username, password_hash, created_ip, created_user_agent)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, password_hash`,
    [username, passwordHash, cleanMetadataText(meta.ip, 128), cleanMetadataText(meta.userAgent, 512)],
  );
  return res.rows[0];
}

export async function findAccount(username: string): Promise<AccountRow | null> {
  const res = await pool.query('SELECT id, username, password_hash FROM accounts WHERE username = $1', [username]);
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

export async function saveToken(token: string, accountId: number, ttlHours = 24 * 7): Promise<void> {
  await pool.query(
    `INSERT INTO auth_tokens (token, account_id, expires_at) VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [token, accountId, String(ttlHours)],
  );
}

export async function accountForToken(token: string): Promise<number | null> {
  const res = await pool.query(
    'SELECT account_id FROM auth_tokens WHERE token = $1 AND expires_at > now()',
    [token],
  );
  return res.rows[0]?.account_id ?? null;
}

export interface AccountInfoRow {
  id: number;
  username: string;
  password_hash: string;
  email: string | null;
  created_at: string;
  deactivated_at: string | null;
}

// Full account record by id — used by the self-service account portal
// (whoami, password change, email, deactivate). Distinct from findAccount,
// which keys on username for the login path.
export async function accountById(accountId: number): Promise<AccountInfoRow | null> {
  const res = await pool.query(
    'SELECT id, username, password_hash, email, created_at, deactivated_at FROM accounts WHERE id = $1',
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

export async function updatePasswordHash(accountId: number, passwordHash: string): Promise<void> {
  await pool.query('UPDATE accounts SET password_hash = $2 WHERE id = $1', [accountId, passwordHash]);
}

// Revoke every token for an account except (optionally) the one in hand.
// A password change keeps the current device signed in (pass its token);
// a deactivate revokes everything (pass null).
export async function revokeTokensExcept(accountId: number, keepToken: string | null): Promise<void> {
  if (keepToken) {
    await pool.query('DELETE FROM auth_tokens WHERE account_id = $1 AND token <> $2', [accountId, keepToken]);
  } else {
    await pool.query('DELETE FROM auth_tokens WHERE account_id = $1', [accountId]);
  }
}

export async function revokeToken(token: string): Promise<void> {
  await pool.query('DELETE FROM auth_tokens WHERE token = $1', [token]);
}

export async function setAccountEmail(accountId: number, email: string | null): Promise<void> {
  await pool.query('UPDATE accounts SET email = $2 WHERE id = $1', [accountId, email]);
}

export async function setAccountDeactivated(accountId: number, deactivated: boolean): Promise<void> {
  await pool.query(
    `UPDATE accounts SET deactivated_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`,
    [accountId, deactivated],
  );
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
    // races to a 23505 — treat it as "already owned" (→ 409), not a 500.
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
    [card.characterId, card.accountId, card.slug, card.png, card.title, card.description, card.locale, REALM],
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
// ~4 MB) PNG bytes — keeps getPlayerCardBySlug's heavy SELECT for the image route.
export async function getPlayerCardMetaBySlug(slug: string): Promise<{ title: string; description: string; locale: string } | null> {
  const res = await pool.query('SELECT title, description, locale FROM player_cards WHERE slug = $1', [slug]);
  const row = res.rows[0];
  return row ? { title: row.title ?? '', description: row.description ?? '', locale: row.locale ?? 'en' } : null;
}

// The account that owns a card slug — i.e. the referrer credited when someone
// signs up through their link.
export async function accountForSlug(slug: string): Promise<number | null> {
  const res = await pool.query('SELECT account_id FROM player_cards WHERE slug = $1', [slug]);
  return res.rows[0]?.account_id ?? null;
}

// Record that `referee` joined via `referrer`'s `slug`. Idempotent: only the
// first referral for a given referee is kept (PK on referee_account_id).
export async function recordReferral(refereeAccountId: number, referrerAccountId: number, slug: string): Promise<void> {
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
// canonical progression metric — encodes level plus post-cap overflow), for the
// player card's "Top N%" flex. Ownership + realm are enforced via the caller's
// account; returns null when the character isn't the caller's. rank is 1-based
// (1 = highest lifetime XP on the realm); total is the realm population.
export async function lifetimeXpStanding(
  accountId: number,
  characterId: number,
): Promise<{ rank: number; total: number } | null> {
  // One round-trip: the `own` subquery yields this character's lifetime XP and
  // gates ownership/realm. The count-ahead predicate uses the same expression
  // as characters_lifetime_xp so PostgreSQL can use that expression index.
  const res = await pool.query(
    `SELECT
       (SELECT count(*) FROM characters
         WHERE realm = $1 AND ${LIFETIME_XP_EXPR} > own.xp)::int AS ahead,
       (SELECT count(*) FROM characters WHERE realm = $1)::int AS total
     FROM (SELECT COALESCE(${LIFETIME_XP_EXPR}, 0) AS xp
             FROM characters WHERE id = $2 AND account_id = $3 AND realm = $1) own`,
    [REALM, characterId, accountId],
  );
  if ((res.rowCount ?? 0) === 0) return null; // character isn't the caller's
  return { rank: (res.rows[0]?.ahead ?? 0) + 1, total: res.rows[0]?.total ?? 0 };
}

export async function moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus> {
  const res = await pool.query(
    `SELECT banned_at, suspended_until, moderation_reason, chat_muted_until, chat_strikes, deactivated_at
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  const row = res.rows[0];
  if (!row) {
    return { locked: false, banned: false, suspendedUntil: null, reason: '', message: '', chatMutedUntil: null, chatStrikes: 0 };
  }
  const mutedUntilDate = row.chat_muted_until ? new Date(row.chat_muted_until) : null;
  const chatMutedUntil = mutedUntilDate && mutedUntilDate.getTime() > Date.now()
    ? mutedUntilDate.toISOString()
    : null;
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
      reason: '',
      message: 'This account has been deactivated.',
      chatMutedUntil,
      chatStrikes,
    };
  }
  return { locked: false, banned: false, suspendedUntil: null, reason: '', message: '', chatMutedUntil, chatStrikes };
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
}

// Character reads/writes are scoped to this process's realm: an account may
// hold characters on several realms (each served by its own process), but a
// process only ever lists, loads, or creates characters on its own realm.
export async function listCharacters(accountId: number): Promise<CharacterRow[]> {
  const res = await pool.query(
    'SELECT id, account_id, name, class, level, state, is_gm, force_rename FROM characters WHERE account_id = $1 AND realm = $2 ORDER BY id',
    [accountId, REALM],
  );
  return res.rows;
}

export async function getCharacter(accountId: number, characterId: number): Promise<CharacterRow | null> {
  const res = await pool.query(
    'SELECT id, account_id, name, class, level, state, is_gm, force_rename FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3',
    [characterId, accountId, REALM],
  );
  return res.rows[0] ?? null;
}

export async function findCharacterReportTargetByName(name: string): Promise<{ accountId: number; characterId: number; characterName: string } | null> {
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
  return row ? { accountId: Number(row.account_id), characterId: Number(row.id), characterName: row.name } : null;
}

export async function createCharacter(accountId: number, name: string, cls: PlayerClass, state: CharacterState | null = null): Promise<CharacterRow> {
  const res = await pool.query(
    'INSERT INTO characters (account_id, name, class, realm, state) VALUES ($1, $2, $3, $4, $5) RETURNING id, account_id, name, class, level, state, is_gm, force_rename',
    [accountId, name, cls, REALM, state ? JSON.stringify(state) : null],
  );
  return res.rows[0];
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
    const account = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if ((account.rowCount ?? 0) === 0) { await client.query('ROLLBACK'); return null; }
    const count = await client.query(
      'SELECT count(*)::int AS n FROM characters WHERE account_id = $1 AND realm = $2',
      [accountId, REALM],
    );
    if (Number(count.rows[0]?.n ?? 0) >= limit) { await client.query('ROLLBACK'); return null; }
    const res = await client.query(
      'INSERT INTO characters (account_id, name, class, realm, state) VALUES ($1, $2, $3, $4, $5) RETURNING id, account_id, name, class, level, state, is_gm, force_rename',
      [accountId, name, cls, REALM, state ? JSON.stringify(state) : null],
    );
    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteCharacter(accountId: number, characterId: number): Promise<boolean> {
  const res = await pool.query('DELETE FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3', [characterId, accountId, REALM]);
  return (res.rowCount ?? 0) > 0;
}

// How many characters this account has on each realm — deliberately NOT
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

export async function renameCharacter(accountId: number, characterId: number, name: string): Promise<CharacterRow | null> {
  const res = await pool.query(
    `UPDATE characters
     SET name = $3, force_rename = FALSE, updated_at = now()
     WHERE id = $1 AND account_id = $2 AND realm = $4
     RETURNING id, account_id, name, class, level, state, is_gm, force_rename`,
    [characterId, accountId, name, REALM],
  );
  return res.rows[0] ?? null;
}

export async function saveCharacterState(characterId: number, level: number, state: CharacterState): Promise<void> {
  await pool.query(
    'UPDATE characters SET level = $2, state = $3, updated_at = now() WHERE id = $1',
    [characterId, level, JSON.stringify(state)],
  );
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

export async function topArenaRatings(limit = 20, format: ArenaFormat = '1v1'): Promise<ArenaLeaderRow[]> {
  const fmt: ArenaFormat = format === '2v2' ? '2v2' : '1v1';
  const ratingExpr = fmt === '2v2'
    ? "COALESCE((state->>'arena2v2Rating')::int, 1500)"
    : "COALESCE((state->>'arena1v1Rating')::int, (state->>'arenaRating')::int, 1500)";
  const winsExpr = fmt === '2v2'
    ? "COALESCE((state->>'arena2v2Wins')::int, 0)"
    : "COALESCE((state->>'arena1v1Wins')::int, (state->>'arenaWins')::int, 0)";
  const lossesExpr = fmt === '2v2'
    ? "COALESCE((state->>'arena2v2Losses')::int, 0)"
    : "COALESCE((state->>'arena1v1Losses')::int, (state->>'arenaLosses')::int, 0)";
  const res = await pool.query(
    `SELECT name, class, level,
            ${ratingExpr} AS rating,
            ${winsExpr} AS wins,
            ${lossesExpr} AS losses
       FROM characters
      WHERE realm = $1
        AND state IS NOT NULL
        AND ${winsExpr} + ${lossesExpr} > 0
      ORDER BY rating DESC, wins DESC, name ASC
      LIMIT $2`,
    [REALM, Math.max(1, Math.min(100, limit))],
  );
  return res.rows.map((r) => ({
    name: r.name, class: r.class, level: r.level,
    rating: Number(r.rating), wins: Number(r.wins), losses: Number(r.losses),
  }));
}

// ---------------------------------------------------------------------------
// Lifetime-XP leaderboard (Max-Level XP Overflow). Ranks characters by the
// `lifetimeXp` stored in their state JSONB. Realm-scoped (FR-4.3) and backed by
// the `characters_lifetime_xp` index. Read through the server-side cache in
// main.ts — never run per request under load.
// ---------------------------------------------------------------------------

export interface LifetimeXpLeaderRow {
  name: string;
  class: PlayerClass;
  level: number;
  realm: string;
  lifetimeXp: number;
  prestigeRank: number;
}

// `global: true` ranks across every realm (for the home-page board); otherwise
// it is scoped to this process's realm (the in-game panel). Both paths sort on
// the indexed lifetime-XP expression and are read through the main.ts cache.
export async function topLifetimeXp(limit = 100, opts: { global?: boolean } = {}): Promise<LifetimeXpLeaderRow[]> {
  const cap = Math.max(1, Math.min(100, limit));
  const res = opts.global
    ? await pool.query(
        `SELECT name, class, level, realm,
                COALESCE((state->>'lifetimeXp')::bigint, 0) AS lifetime_xp,
                COALESCE((state->>'prestigeRank')::int, 0)  AS prestige_rank
           FROM characters
          WHERE state IS NOT NULL
            AND COALESCE((state->>'lifetimeXp')::bigint, 0) > 0
          ORDER BY lifetime_xp DESC, level DESC, name ASC
          LIMIT $1`,
        [cap],
      )
    : await pool.query(
        `SELECT name, class, level, realm,
                COALESCE((state->>'lifetimeXp')::bigint, 0) AS lifetime_xp,
                COALESCE((state->>'prestigeRank')::int, 0)  AS prestige_rank
           FROM characters
          WHERE realm = $1 AND state IS NOT NULL
            AND COALESCE((state->>'lifetimeXp')::bigint, 0) > 0
          ORDER BY lifetime_xp DESC, level DESC, name ASC
          LIMIT $2`,
        [REALM, cap],
      );
  return res.rows.map((r) => ({
    name: r.name, class: r.class, level: r.level, realm: r.realm,
    lifetimeXp: Number(r.lifetime_xp), prestigeRank: Number(r.prestige_rank),
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
      row.schemaVersion, row.releaseVersion, row.buildId, row.sessionId, row.accountId, row.characterId, row.realm,
      row.graphicsPreset, row.gfxTier, row.autoGovernor, row.targetFps, row.renderScale, row.effectiveRenderScale,
      row.fpsAvg, row.frameP95Ms, row.frameP99Ms, row.longFrameCount,
      row.rendererCalls, row.rendererTriangles, row.rendererTextures, row.rendererPrograms, row.contextLostCount,
      row.longTaskCount, row.longTaskP95Ms, row.memoryUsedMb, row.memoryLimitMb,
      row.dpr, row.viewportBucket, row.deviceMemory, row.hardwareConcurrency, row.mobileTouch,
      row.browserFamily, row.osFamily, row.glVendor, row.glRendererBucket, row.zoneOrScenario, row.source,
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
// here under the 'market' key — listings + per-seller collections.
// ---------------------------------------------------------------------------

export async function loadWorldState<T>(key: string): Promise<T | null> {
  const res = await pool.query('SELECT data FROM world_state WHERE key = $1', [key]);
  return (res.rows[0]?.data as T) ?? null;
}

export async function saveWorldState(key: string, data: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO world_state (key, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [key, JSON.stringify(data)],
  );
}

export async function loadMarketState(): Promise<MarketSave | null> {
  return loadWorldState<MarketSave>('market');
}

export async function saveMarketState(save: MarketSave): Promise<void> {
  await saveWorldState('market', save);
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
): Promise<number> {
  const res = await pool.query(
    `INSERT INTO play_sessions (account_id, character_id, character_name, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [accountId, characterId, characterName, cleanMetadataText(meta.ip, 128), cleanMetadataText(meta.userAgent, 512)],
  );
  return res.rows[0].id;
}

export async function closePlaySession(sessionId: number): Promise<void> {
  await pool.query('UPDATE play_sessions SET ended_at = now() WHERE id = $1 AND ended_at IS NULL', [sessionId]);
}

// Sessions left open by a crash have an unknown duration; close them at their
// start time so they don't inflate playtime stats forever. Scope this to the
// current realm: in the process-per-realm model peers share one database, and
// an unscoped UPDATE would force-close sessions still live on other realms.
export async function closeOrphanSessions(): Promise<number> {
  const res = await pool.query(
    `UPDATE play_sessions ps
        SET ended_at = ps.started_at
       FROM characters c
      WHERE ps.character_id = c.id
        AND c.realm = $1
        AND ps.ended_at IS NULL`,
    [REALM],
  );
  return res.rowCount ?? 0;
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
  const res = await pool.query(
    `DELETE FROM chat_logs WHERE created_at < now() - ($1 || ' days')::interval`,
    [String(Math.floor(retentionDays))],
  );
  return res.rowCount ?? 0;
}
