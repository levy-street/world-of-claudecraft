import { Pool } from 'pg';
import type { CharacterState, MarketSave } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import type { ChatLogRow } from './chat_log';
import { SOCIAL_SCHEMA } from './social_db';
import { REALM } from './realm';

try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; production usually injects DATABASE_URL directly.
}

export const DATABASE_URL =
  process.env.DATABASE_URL ?? (() => {
    throw new Error('DATABASE_URL is required. For local dev, copy .env.example to .env and run through docker compose.');
  })();

export const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const SCHEMA = `
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
  level INT NOT NULL DEFAULT 1,
  state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS characters_account ON characters(account_id);
-- Max-Level XP Overflow leaderboard: indexed lifetime-XP sort key. The first
-- index serves the realm-scoped in-game panel; the second serves the global
-- (cross-realm) home-page board.
CREATE INDEX IF NOT EXISTS characters_lifetime_xp
  ON characters (realm, ((state->>'lifetimeXp')::bigint) DESC);
CREATE INDEX IF NOT EXISTS characters_lifetime_xp_global
  ON characters (((state->>'lifetimeXp')::bigint) DESC);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
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
CREATE TABLE IF NOT EXISTS world_state (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
}

export async function createAccount(username: string, passwordHash: string): Promise<AccountRow> {
  const res = await pool.query(
    'INSERT INTO accounts (username, password_hash) VALUES ($1, $2) RETURNING id, username, password_hash',
    [username, passwordHash],
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


export async function touchLogin(accountId: number): Promise<void> {
  await pool.query('UPDATE accounts SET last_login = now() WHERE id = $1', [accountId]);
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

export async function moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus> {
  const res = await pool.query(
    `SELECT banned_at, suspended_until, moderation_reason
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  const row = res.rows[0];
  if (!row) {
    return { locked: false, banned: false, suspendedUntil: null, reason: '', message: '' };
  }
  if (row.banned_at) {
    return {
      locked: true,
      banned: true,
      suspendedUntil: null,
      reason: row.moderation_reason ?? '',
      message: 'This account has been banned.',
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
    };
  }
  return { locked: false, banned: false, suspendedUntil: null, reason: '', message: '' };
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

export async function createCharacter(accountId: number, name: string, cls: PlayerClass): Promise<CharacterRow> {
  const res = await pool.query(
    'INSERT INTO characters (account_id, name, class, realm) VALUES ($1, $2, $3, $4) RETURNING id, account_id, name, class, level, state, is_gm, force_rename',
    [accountId, name, cls, REALM],
  );
  return res.rows[0];
}

export async function deleteCharacter(accountId: number, characterId: number): Promise<boolean> {
  const res = await pool.query('DELETE FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3', [characterId, accountId, REALM]);
  return (res.rowCount ?? 0) > 0;
}

// How many characters this account has on each realm — deliberately NOT
// realm-scoped, so the realm-list screen can show "N characters" per realm
// like WoW. Keyed by realm name.
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

export async function topArenaRatings(limit = 20): Promise<ArenaLeaderRow[]> {
  const res = await pool.query(
    `SELECT name, class, level,
            COALESCE((state->>'arenaRating')::int, 1500) AS rating,
            COALESCE((state->>'arenaWins')::int, 0)     AS wins,
            COALESCE((state->>'arenaLosses')::int, 0)   AS losses
       FROM characters
      WHERE state IS NOT NULL
        AND COALESCE((state->>'arenaWins')::int, 0) + COALESCE((state->>'arenaLosses')::int, 0) > 0
      ORDER BY rating DESC, wins DESC, name ASC
      LIMIT $1`,
    [Math.max(1, Math.min(100, limit))],
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
): Promise<number> {
  const res = await pool.query(
    'INSERT INTO play_sessions (account_id, character_id, character_name) VALUES ($1, $2, $3) RETURNING id',
    [accountId, characterId, characterName],
  );
  return res.rows[0].id;
}

export async function closePlaySession(sessionId: number): Promise<void> {
  await pool.query('UPDATE play_sessions SET ended_at = now() WHERE id = $1 AND ended_at IS NULL', [sessionId]);
}

// Sessions left open by a crash have an unknown duration; close them at their
// start time so they don't inflate playtime stats forever.
export async function closeOrphanSessions(): Promise<number> {
  const res = await pool.query('UPDATE play_sessions SET ended_at = started_at WHERE ended_at IS NULL');
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
