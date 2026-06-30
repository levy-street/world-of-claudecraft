// Discord integration persistence (SQL only). Schema is a const string appended
// to ensureSchema() in db.ts (like SOCIAL_SCHEMA / OAUTH_SCHEMA); every query
// function takes the shared `pool` as an argument so this module never imports
// db.ts, keeping db.ts <-> discord_db.ts cycle-free.
//
// Three concerns live here:
//  1. discord_links        - the durable 1:1 account <-> Discord identity mirror
//                            (mirrors wallet_links), written after OAuth verify.
//  2. discord_oauth_states - single-use, short-lived OAuth `state` + PKCE verifier
//                            rows (mirrors wallet_link_challenges), the CSRF guard.
//  3. reward_points/ledger/swag_claims - the AUTHORED reward economy. Unlike the
//                            chain-sourced $WOC balance, the server OWNS this
//                            balance, so it is stored, audited (append-only
//                            ledger), and mutated server-side only.
import type { Pool } from 'pg';
import { discordStatusIndexForPoints } from '../src/sim/discord_tier';
import { discordAvatarUrl } from './discord_oauth';
import { isUniqueViolation } from './http_util';

export const DISCORD_SCHEMA = `
-- One Discord identity per account (account_id PK) and one account per Discord
-- user (discord_user_id UNIQUE). ON DELETE CASCADE so deleting an account drops
-- the link. Ownership is proven by an OAuth code exchange (see discord_oauth_states).
CREATE TABLE IF NOT EXISTS discord_links (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL UNIQUE,
  discord_username TEXT,
  discord_avatar TEXT,
  guild_member BOOLEAN NOT NULL DEFAULT FALSE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Bot-pushed guild metadata: when they joined the Discord server (for "member
-- since") and their top staff/special role key (for the in-world name color +
-- tag). Additive + idempotent so existing deployments upgrade on boot.
ALTER TABLE discord_links ADD COLUMN IF NOT EXISTS discord_joined_at TIMESTAMPTZ;
ALTER TABLE discord_links ADD COLUMN IF NOT EXISTS discord_role TEXT;
-- Single-use, short-lived OAuth state rows. The PKCE verifier is stored
-- server-side (never round-tripped through the browser); consuming a state row
-- deletes it (replay + CSRF protection). account_id is set only for 'link' mode.
CREATE TABLE IF NOT EXISTS discord_oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  mode TEXT NOT NULL,
  account_id INT REFERENCES accounts(id) ON DELETE CASCADE,
  redirect_to TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discord_oauth_states_expires ON discord_oauth_states(expires_at);
-- Single-use, short-lived "what next?" rows for a FIRST-TIME Discord login. The
-- callback has VERIFIED the Discord identity (via the OAuth code exchange) but the
-- player has not yet chosen to create a new account or link an existing one, so the
-- verified identity is parked here under an unguessable token. The chooser endpoints
-- (login/new, login/link) consume it. No account_id: by definition this Discord id
-- is not linked to any account yet. Mirrors discord_oauth_states (CSRF/replay guard).
CREATE TABLE IF NOT EXISTS discord_pending_logins (
  token TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  discord_avatar TEXT,
  guild_member BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discord_pending_logins_expires ON discord_pending_logins(expires_at);
-- Authored, account-wide reward balance. points = spendable, lifetime_points =
-- monotonic total that drives the status tier (status never drops on a spend).
CREATE TABLE IF NOT EXISTS reward_points (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  points BIGINT NOT NULL DEFAULT 0,
  lifetime_points BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Append-only audit of every grant/spend. dedupe_key makes one-time and
-- once-per-day grants exactly-once (partial UNIQUE below); spends use a NULL key.
CREATE TABLE IF NOT EXISTS reward_ledger (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  delta BIGINT NOT NULL,
  reason TEXT NOT NULL,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reward_ledger_account ON reward_ledger(account_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS reward_ledger_dedupe ON reward_ledger(account_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
-- Idempotent swag claims (one per account per swag id). cost is the points
-- deducted at claim; status tracks real-world fulfilment for physical swag.
CREATE TABLE IF NOT EXISTS swag_claims (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  swag_id TEXT NOT NULL,
  cost BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'granted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, swag_id)
);
CREATE INDEX IF NOT EXISTS swag_claims_account ON swag_claims(account_id);
`;

// ── Discord identity link (mirrors wallet_links) ───────────────────────────────

export interface DiscordLinkRow {
  account_id: number;
  discord_user_id: string;
  discord_username: string | null;
  discord_avatar: string | null;
  guild_member: boolean;
  linked_at: Date | string;
}

export async function discordForAccount(
  pool: Pool,
  accountId: number,
): Promise<DiscordLinkRow | null> {
  const res = await pool.query(
    `SELECT account_id, discord_user_id, discord_username, discord_avatar, guild_member, linked_at
       FROM discord_links WHERE account_id = $1`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

export async function accountForDiscord(pool: Pool, discordUserId: string): Promise<number | null> {
  const res = await pool.query('SELECT account_id FROM discord_links WHERE discord_user_id = $1', [
    discordUserId,
  ]);
  return res.rows[0]?.account_id ?? null;
}

/**
 * Link a Discord identity to an account. One Discord per account (account_id PK)
 * and one account per Discord (discord_user_id UNIQUE). Returns false when the
 * Discord id is already owned by a DIFFERENT account so the caller can 409.
 */
export async function linkDiscordToAccount(
  pool: Pool,
  accountId: number,
  info: {
    discordUserId: string;
    username: string | null;
    avatar: string | null;
    guildMember: boolean;
  },
): Promise<boolean> {
  const owner = await accountForDiscord(pool, info.discordUserId);
  if (owner !== null && owner !== accountId) return false;
  try {
    await pool.query(
      `INSERT INTO discord_links (account_id, discord_user_id, discord_username, discord_avatar, guild_member)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id) DO UPDATE SET
         discord_user_id = EXCLUDED.discord_user_id,
         discord_username = EXCLUDED.discord_username,
         discord_avatar = EXCLUDED.discord_avatar,
         guild_member = EXCLUDED.guild_member,
         linked_at = now()`,
      [accountId, info.discordUserId, info.username, info.avatar, info.guildMember],
    );
  } catch (err) {
    // TOCTOU: another account claimed this discord_user_id between the check and
    // the upsert. discord_user_id is UNIQUE (not the ON CONFLICT target), so the
    // race surfaces as 23505 -> treat as "already owned" (409), not a 500.
    if (isUniqueViolation(err)) return false;
    throw err;
  }
  return true;
}

export async function unlinkDiscord(pool: Pool, accountId: number): Promise<void> {
  await pool.query('DELETE FROM discord_links WHERE account_id = $1', [accountId]);
}

export async function setDiscordGuildMember(
  pool: Pool,
  accountId: number,
  guildMember: boolean,
): Promise<void> {
  await pool.query('UPDATE discord_links SET guild_member = $2 WHERE account_id = $1', [
    accountId,
    guildMember,
  ]);
}

// ── OAuth state (mirrors wallet_link_challenges) ──────────────────────────────

export interface DiscordOAuthStateRow {
  state: string;
  code_verifier: string;
  mode: string;
  account_id: number | null;
  redirect_to: string | null;
}

export async function createDiscordOAuthState(
  pool: Pool,
  params: {
    state: string;
    codeVerifier: string;
    mode: string;
    accountId: number | null;
    redirectTo: string | null;
    ttlMinutes: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO discord_oauth_states (state, code_verifier, mode, account_id, redirect_to, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [
      params.state,
      params.codeVerifier,
      params.mode,
      params.accountId,
      params.redirectTo,
      String(params.ttlMinutes),
    ],
  );
}

/** Atomically consume an unexpired state row (single use). Null if missing/expired. */
export async function consumeDiscordOAuthState(
  pool: Pool,
  state: string,
): Promise<DiscordOAuthStateRow | null> {
  const res = await pool.query(
    `DELETE FROM discord_oauth_states
      WHERE state = $1 AND expires_at > now()
      RETURNING state, code_verifier, mode, account_id, redirect_to`,
    [state],
  );
  return res.rows[0] ?? null;
}

export async function pruneDiscordOAuthStates(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM discord_oauth_states WHERE expires_at <= now()');
}

// ── Pending first-time logins (verified Discord identity, choice not yet made) ──

export interface DiscordPendingLoginRow {
  token: string;
  discord_user_id: string;
  discord_username: string | null;
  discord_avatar: string | null;
  guild_member: boolean;
}

export async function createDiscordPendingLogin(
  pool: Pool,
  params: {
    token: string;
    discordUserId: string;
    username: string | null;
    avatar: string | null;
    guildMember: boolean;
    ttlMinutes: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO discord_pending_logins
       (token, discord_user_id, discord_username, discord_avatar, guild_member, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [
      params.token,
      params.discordUserId,
      params.username,
      params.avatar,
      params.guildMember,
      String(params.ttlMinutes),
    ],
  );
}

/**
 * Read an unexpired pending-login row WITHOUT consuming it. The link-existing flow
 * peeks first so a wrong password (or a 2FA challenge) leaves the token reusable
 * for the retry; only the final commit calls consumeDiscordPendingLogin.
 */
export async function peekDiscordPendingLogin(
  pool: Pool,
  token: string,
): Promise<DiscordPendingLoginRow | null> {
  const res = await pool.query(
    `SELECT token, discord_user_id, discord_username, discord_avatar, guild_member
       FROM discord_pending_logins WHERE token = $1 AND expires_at > now()`,
    [token],
  );
  return res.rows[0] ?? null;
}

/** Atomically consume an unexpired pending-login row (single use). Null if gone/expired. */
export async function consumeDiscordPendingLogin(
  pool: Pool,
  token: string,
): Promise<DiscordPendingLoginRow | null> {
  const res = await pool.query(
    `DELETE FROM discord_pending_logins
      WHERE token = $1 AND expires_at > now()
      RETURNING token, discord_user_id, discord_username, discord_avatar, guild_member`,
    [token],
  );
  return res.rows[0] ?? null;
}

export async function pruneDiscordPendingLogins(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM discord_pending_logins WHERE expires_at <= now()');
}

// ── Reward economy (authored balance + ledger + swag) ─────────────────────────

export interface RewardState {
  points: number;
  lifetimePoints: number;
}

function rowToRewardState(
  row: { points?: unknown; lifetime_points?: unknown } | undefined,
): RewardState {
  return {
    points: Number(row?.points ?? 0),
    lifetimePoints: Number(row?.lifetime_points ?? 0),
  };
}

export async function loadRewardState(pool: Pool, accountId: number): Promise<RewardState> {
  const res = await pool.query(
    'SELECT points, lifetime_points FROM reward_points WHERE account_id = $1',
    [accountId],
  );
  return rowToRewardState(res.rows[0]);
}

/**
 * Credit reward points server-side. Positive `delta` grants add to both spendable
 * and lifetime (lifetime never decreases, so status is sticky). A `dedupeKey`
 * makes the grant exactly-once: a second grant with the same (account_id,
 * dedupe_key) is a no-op that returns the unchanged balance. Wrapped in a
 * transaction so the ledger row and the balance update never diverge.
 */
export async function grantRewardPoints(
  pool: Pool,
  accountId: number,
  delta: number,
  reason: string,
  dedupeKey: string | null = null,
): Promise<RewardState> {
  const amount = Math.trunc(delta);
  if (!Number.isFinite(amount) || amount === 0) return loadRewardState(pool, accountId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (dedupeKey) {
      const ins = await client.query(
        // The dedupe index is PARTIAL (reward_ledger_dedupe ... WHERE dedupe_key IS
        // NOT NULL), so the ON CONFLICT must repeat that predicate for Postgres to
        // select it as the arbiter index (else: "no unique/exclusion constraint
        // matching the ON CONFLICT specification").
        `INSERT INTO reward_ledger (account_id, delta, reason, dedupe_key) VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
        [accountId, amount, reason, dedupeKey],
      );
      if (ins.rowCount === 0) {
        // Already granted under this key: leave the balance untouched.
        const cur = await client.query(
          'SELECT points, lifetime_points FROM reward_points WHERE account_id = $1',
          [accountId],
        );
        await client.query('COMMIT');
        return rowToRewardState(cur.rows[0]);
      }
    } else {
      await client.query(
        'INSERT INTO reward_ledger (account_id, delta, reason) VALUES ($1, $2, $3)',
        [accountId, amount, reason],
      );
    }
    const upd = await client.query(
      // On a brand-new row, floor points at 0: a negative grant (bot/operator
      // clawback) on an account with no balance must not manufacture a negative
      // balance. Existing rows update by the signed delta as normal.
      `INSERT INTO reward_points (account_id, points, lifetime_points)
       VALUES ($1, GREATEST($2, 0), GREATEST($2, 0))
       ON CONFLICT (account_id) DO UPDATE SET
         points = reward_points.points + $2,
         lifetime_points = reward_points.lifetime_points + GREATEST($2, 0),
         updated_at = now()
       RETURNING points, lifetime_points`,
      [accountId, amount],
    );
    await client.query('COMMIT');
    return rowToRewardState(upd.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type SwagClaimResult =
  | { ok: true; reason: 'ok'; points: number }
  | { ok: false; reason: 'claimed' | 'points' };

/**
 * Claim a swag item idempotently and atomically. The UNIQUE(account_id, swag_id)
 * row is the exactly-once guard; the points deduction is guarded by points>=cost
 * in the same transaction. The TIER eligibility check is the caller's job (it
 * needs the swag catalog); this enforces "not already claimed" + "can afford".
 */
export async function claimSwag(
  pool: Pool,
  accountId: number,
  swagId: string,
  cost: number,
): Promise<SwagClaimResult> {
  const price = Math.max(0, Math.trunc(cost));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query(
      `INSERT INTO swag_claims (account_id, swag_id, cost) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, swag_id) DO NOTHING RETURNING id`,
      [accountId, swagId, price],
    );
    if (claim.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'claimed' };
    }
    let points = 0;
    if (price > 0) {
      const spend = await client.query(
        `UPDATE reward_points SET points = points - $2, updated_at = now()
          WHERE account_id = $1 AND points >= $2 RETURNING points`,
        [accountId, price],
      );
      if (spend.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'points' };
      }
      points = Number(spend.rows[0].points);
      await client.query(
        'INSERT INTO reward_ledger (account_id, delta, reason) VALUES ($1, $2, $3)',
        [accountId, -price, `swag:${swagId}`],
      );
    } else {
      const cur = await client.query('SELECT points FROM reward_points WHERE account_id = $1', [
        accountId,
      ]);
      points = Number(cur.rows[0]?.points ?? 0);
    }
    await client.query('COMMIT');
    return { ok: true, reason: 'ok', points };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listSwagClaims(pool: Pool, accountId: number): Promise<string[]> {
  const res = await pool.query('SELECT swag_id FROM swag_claims WHERE account_id = $1', [
    accountId,
  ]);
  return res.rows.map((r) => r.swag_id as string);
}

/**
 * The in-world Discord status-tier index for an account: 0 when the account has
 * no linked Discord (so unlinked players never get a flair badge), otherwise the
 * rung derived from lifetime reward points. One round-trip (join), for the
 * off-tick nameplate-flair refresh.
 */
export async function discordTierForAccount(pool: Pool, accountId: number): Promise<number> {
  const res = await pool.query(
    `SELECT COALESCE(rp.lifetime_points, 0) AS lifetime_points
       FROM discord_links dl
       LEFT JOIN reward_points rp ON rp.account_id = dl.account_id
      WHERE dl.account_id = $1`,
    [accountId],
  );
  if (res.rows.length === 0) return 0; // not linked -> no flair
  return discordStatusIndexForPoints(Number(res.rows[0].lifetime_points ?? 0));
}

export interface DiscordFlair {
  tier: number;
  avatarUrl: string | null;
  name: string | null;
  /** Epoch ms the member joined the Discord server, or null (for "member since"). */
  joinedAtMs: number | null;
  /** Top special-role key (levyst/devs/mods/artists), or null. */
  role: string | null;
}

/**
 * Full nameplate/inspect flair for an account: status tier + Discord PFP + handle.
 * Null when the account has no linked Discord (so unlinked players broadcast
 * nothing). One round-trip joining the link to the reward balance.
 */
export async function discordFlairForAccount(
  pool: Pool,
  accountId: number,
): Promise<DiscordFlair | null> {
  const res = await pool.query(
    `SELECT dl.discord_user_id, dl.discord_username, dl.discord_avatar,
            dl.discord_joined_at, dl.discord_role,
            COALESCE(rp.lifetime_points, 0) AS lifetime_points
       FROM discord_links dl
       LEFT JOIN reward_points rp ON rp.account_id = dl.account_id
      WHERE dl.account_id = $1`,
    [accountId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const joined = row.discord_joined_at ? new Date(row.discord_joined_at).getTime() : null;
  return {
    tier: discordStatusIndexForPoints(Number(row.lifetime_points ?? 0)),
    avatarUrl: discordAvatarUrl(row.discord_user_id, row.discord_avatar, 64),
    name: row.discord_username ?? null,
    joinedAtMs: joined !== null && Number.isFinite(joined) ? joined : null,
    role: typeof row.discord_role === 'string' ? row.discord_role : null,
  };
}

/**
 * Upsert bot-pushed guild metadata (server join date + top special-role key) for a
 * Discord user, matched by discord_user_id. No-op when the id is not linked. Both
 * fields are optional; pass null to leave a field unchanged is NOT supported here
 * (callers always send the current values).
 */
export async function setDiscordMemberMeta(
  pool: Pool,
  discordUserId: string,
  nickname: string | null,
  joinedAtMs: number | null,
  roleKey: string | null,
): Promise<void> {
  const joinedAt = joinedAtMs !== null && Number.isFinite(joinedAtMs) ? new Date(joinedAtMs) : null;
  // The in-server nickname (nick > global > username) is the preferred display
  // name; COALESCE keeps the OAuth-linked username when the bot sends nothing.
  await pool.query(
    `UPDATE discord_links
        SET discord_username = COALESCE($2, discord_username),
            discord_joined_at = COALESCE($3, discord_joined_at),
            discord_role = $4
      WHERE discord_user_id = $1`,
    [discordUserId, nickname, joinedAt, roleKey],
  );
}
