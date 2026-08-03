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
import { enqueueLinkChange } from './discord_link_changes';
import { discordAvatarUrl } from './discord_oauth';
import { bustDiscordStatus } from './discord_status_cache';
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
-- The email captured from the Discord email scope, kept per-link as the record
-- of what Discord returned (the account's own recovery email is backfilled from
-- it separately, and may differ if the owner later sets their own). Additive +
-- idempotent so existing deployments upgrade on boot.
ALTER TABLE discord_links ADD COLUMN IF NOT EXISTS discord_email TEXT;
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
-- Carry the email captured at the OAuth callback through the first-time chooser so
-- the create-new / link-existing endpoints can seed the account's recovery email.
-- Additive + idempotent so existing deployments upgrade on boot.
ALTER TABLE discord_pending_logins ADD COLUMN IF NOT EXISTS discord_email TEXT;
ALTER TABLE discord_pending_logins ADD COLUMN IF NOT EXISTS discord_email_verified BOOLEAN NOT NULL DEFAULT FALSE;
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
-- RETENTION: KEEP FOREVER, deliberately. Two reasons, and the second is the one
-- that actually forecloses a prune:
--   1. It is the audit trail the authored reward balance is reconstructed and
--      disputed from. reward_points holds only the running totals, so a deleted
--      ledger row can never be re-derived from anything else.
--   2. For the ONE-TIME grants the partial dedupe_key index IS the idempotency
--      record ('link', 'guild_member', 'booster' in src/sim/discord_tier.ts):
--      their keys never change, so pruning an old row re-arms the grant and it
--      pays out a second time. (The daily grant is date-scoped and could safely
--      be pruned on its own; the one-time keys are what rule out a blanket prune.)
-- Growth is one row per grant or spend. The binding term is that daily grant, so
-- it is linear in daily-active linked accounts times days: order 365k rows a year
-- at the 1,000-DAU scale envelope, tens of MB a year with both indexes. That is
-- growth, not a bound, and it is accepted knowingly rather than overlooked. It
-- therefore registers NO prune with server/retention_sweep.ts; the ON DELETE
-- CASCADE on account_id still erases a deleted account's rows.
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
  discord_email: string | null;
  guild_member: boolean;
  linked_at: Date | string;
}

export async function discordForAccount(
  pool: Pool,
  accountId: number,
): Promise<DiscordLinkRow | null> {
  const res = await pool.query(
    `SELECT account_id, discord_user_id, discord_username, discord_avatar, discord_email, guild_member, linked_at
       FROM discord_links WHERE account_id = $1`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

/** The activity drain reads exactly these three columns; the projection is
 *  deliberately NARROWER than DiscordLinkRow so the per-poll batch never
 *  hauls emails or guild metadata into the feed path. */
export interface DiscordTagRow {
  account_id: number;
  discord_user_id: string;
  discord_avatar: string | null;
}

/**
 * Batched form of discordForAccount for the activity drain: ONE query over
 * the distinct account ids of a drained batch instead of a sequential
 * per-participant lookup (most players are unlinked, so the N+1 mostly
 * fetched nulls). Missing ids are simply absent from the map. Projects only
 * the tag columns the drain renders (never discord_email).
 */
export async function discordForAccounts(
  pool: Pool,
  accountIds: readonly number[],
): Promise<Map<number, DiscordTagRow>> {
  const out = new Map<number, DiscordTagRow>();
  if (accountIds.length === 0) return out;
  const res = await pool.query(
    `SELECT account_id, discord_user_id, discord_avatar
       FROM discord_links WHERE account_id = ANY($1::int[])`,
    [[...new Set(accountIds)]],
  );
  for (const row of res.rows) out.set(row.account_id, row);
  return out;
}

/**
 * The subset of a link row the batched read below selects: the identity the outbox
 * drain enriches items with, and nothing else. It is deliberately NOT the full
 * DiscordLinkRow, because that carries discord_email (see the SELECT note below).
 */
export type DiscordOutboxLinkRow = Pick<
  DiscordLinkRow,
  'account_id' | 'discord_user_id' | 'discord_username' | 'discord_avatar'
>;

/**
 * The discord_links rows for MANY accounts, in ONE statement: the set-based
 * sibling of discordForAccount, over a NARROWER column list.
 *
 * Called by the consolidated outbox drain (GET /internal/discord/outbox,
 * server/internal.ts), which resolves every drained relay issuer, activity
 * participant and link-change account to its Discord identity in one pass. The
 * per-item discordForAccount the relay GET still runs costs one round trip per
 * ITEM (the activity GET batches its own read via discordForAccounts above),
 * and a full drain carries thousands; collapsing that N+1 into a single
 * statement is invariant D1.
 *
 * discord_email is NOT selected, and that is the one deliberate difference from
 * discordForAccount's column list. A full drain resolves thousands of accounts at
 * once, so copying the column here would materialize thousands of email addresses
 * in the drain's row map, one accidental spread away from a response the bot
 * receives, to serve a field no caller on this path reads. The narrow return type
 * is what makes that structural rather than a convention: a handler cannot reach
 * for an address the row does not carry.
 *
 * Empty input short-circuits with ZERO statements rather than binding an empty
 * array. Ids are de-duplicated before binding, so an account appearing in several
 * streams of one drain is asked about once. An account with no link row simply
 * produces no row: absence IS the answer, which is what discordForAccount's null
 * says per account.
 */
export async function discordLinksForAccounts(
  pool: Pool,
  accountIds: readonly number[],
): Promise<DiscordOutboxLinkRow[]> {
  if (accountIds.length === 0) return [];
  const res = await pool.query(
    `SELECT account_id, discord_user_id, discord_username, discord_avatar
       FROM discord_links WHERE account_id = ANY($1::int[])`,
    [[...new Set(accountIds)]],
  );
  return res.rows;
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
    email: string | null;
    guildMember: boolean;
  },
): Promise<boolean> {
  const owner = await accountForDiscord(pool, info.discordUserId);
  if (owner !== null && owner !== accountId) return false;
  try {
    await pool.query(
      // Repointing the link at a DIFFERENT Discord identity invalidates the old
      // identity's bot-pushed guild meta (join date + special-role key), so both
      // reset to NULL on an id change; a same-id relink keeps them (the bot
      // re-pushes current values within one sync interval either way).
      `INSERT INTO discord_links (account_id, discord_user_id, discord_username, discord_avatar, discord_email, guild_member)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id) DO UPDATE SET
         discord_user_id = EXCLUDED.discord_user_id,
         discord_username = EXCLUDED.discord_username,
         discord_avatar = EXCLUDED.discord_avatar,
         discord_email = COALESCE(EXCLUDED.discord_email, discord_links.discord_email),
         guild_member = EXCLUDED.guild_member,
         discord_joined_at = CASE WHEN discord_links.discord_user_id = EXCLUDED.discord_user_id
                                  THEN discord_links.discord_joined_at ELSE NULL END,
         discord_role = CASE WHEN discord_links.discord_user_id = EXCLUDED.discord_user_id
                             THEN discord_links.discord_role ELSE NULL END,
         linked_at = now()`,
      [accountId, info.discordUserId, info.username, info.avatar, info.email, info.guildMember],
    );
  } catch (err) {
    // TOCTOU: another account claimed this discord_user_id between the check and
    // the upsert. discord_user_id is UNIQUE (not the ON CONFLICT target), so the
    // race surfaces as 23505 -> treat as "already owned" (409), not a 500.
    if (isUniqueViolation(err)) return false;
    throw err;
  }
  // The upsert landed (link, relink, or repoint, always for this accountId), so
  // the cached /api/discord core is stale. The refusal arms above write nothing
  // and must not evict a healthy snapshot.
  bustDiscordStatus(accountId);
  return true;
}

export async function unlinkDiscord(pool: Pool, accountId: number): Promise<void> {
  const res = await pool.query('DELETE FROM discord_links WHERE account_id = $1', [accountId]);
  // Bust only when a row was really deleted: a repeat unlink is an idempotent
  // no-op and must not evict a healthy /api/discord snapshot (busts ride real
  // writes only). A user who unlinks and immediately reloads must see
  // linked:false, which this bust guarantees within this process.
  if ((res.rowCount ?? 0) > 0) bustDiscordStatus(accountId);
}

// Update just the captured Discord email on an existing link, e.g. when a
// returning user re-consents and grants the email scope for the first time. A
// no-op when the grant carried no email, so it never wipes a previously captured
// address (the account's own recovery email is handled separately).
// No bustDiscordStatus here, STRUCTURALLY: discord_email is neither served by
// /api/discord nor present in its cached core (DiscordStatusCore.link is a
// narrowed projection that cannot carry it). If email ever joins that payload,
// widen the projection and add this writer's bust in the same change.
export async function setDiscordLinkEmail(
  pool: Pool,
  accountId: number,
  email: string | null,
): Promise<void> {
  if (!email) return;
  await pool.query('UPDATE discord_links SET discord_email = $2 WHERE account_id = $1', [
    accountId,
    email,
  ]);
}

export async function setDiscordGuildMember(
  pool: Pool,
  accountId: number,
  guildMember: boolean,
): Promise<void> {
  const res = await pool.query('UPDATE discord_links SET guild_member = $2 WHERE account_id = $1', [
    accountId,
    guildMember,
  ]);
  // guildMember rides the /api/discord payload. A matched row is a real write
  // (callers are login/link flows and the internal member route, each a genuine
  // membership event, so a same-value rewrite over-busting one account costs at
  // most one refresh); an account with no link row writes nothing and skips it.
  if ((res.rowCount ?? 0) > 0) bustDiscordStatus(accountId);
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
  discord_email: string | null;
  discord_email_verified: boolean;
  guild_member: boolean;
}

export async function createDiscordPendingLogin(
  pool: Pool,
  params: {
    token: string;
    discordUserId: string;
    username: string | null;
    avatar: string | null;
    email: string | null;
    emailVerified: boolean;
    guildMember: boolean;
    ttlMinutes: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO discord_pending_logins
       (token, discord_user_id, discord_username, discord_avatar, discord_email, discord_email_verified, guild_member, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' minutes')::interval)`,
    [
      params.token,
      params.discordUserId,
      params.username,
      params.avatar,
      params.email,
      params.emailVerified,
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
    `SELECT token, discord_user_id, discord_username, discord_avatar, discord_email, discord_email_verified, guild_member
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
      RETURNING token, discord_user_id, discord_username, discord_avatar, discord_email, discord_email_verified, guild_member`,
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
    // The one write funnel for every grant (link, guild, playtime, booster,
    // daily_active, operator clawbacks), so the change feed is wired here rather
    // than at the callers: this single site covers both dispatch arms of
    // /internal/discord/grant and /internal/discord/member. Reached only on a real
    // balance write: the zero/non-finite early return and the dedupe-key replay both
    // return above without touching reward_points. After COMMIT, never mid-
    // transaction. Unlinked accounts enqueue too (the playtime grant path); the
    // outbox drain is what filters by linkage. The /api/discord status bust rides
    // the same real-write placement (points/lifetimePoints/statusTier are payload
    // fields), and like the enqueue it must never fire on the no-op arms above.
    enqueueLinkChange({ accountId, kinds: ['points'] }, Date.now());
    bustDiscordStatus(accountId);
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
    // Spendable points moved only on the priced arm; a cost-0 title claim reads the
    // balance and leaves it untouched, so it is not a points transition. The refusal
    // arms (already claimed, cannot afford) roll back above and never reach here.
    if (price > 0) enqueueLinkChange({ accountId, kinds: ['points'] }, Date.now());
    // Unlike the feed above, the status bust fires on EVERY successful claim: a
    // cost-0 claim still adds a claimedSwagIds entry, which is a payload field.
    bustDiscordStatus(accountId);
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
  /** Top special-role key (levyst/admin/coredevs/devs/mods/artists), or null. */
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
 * The Discord user ids whose stored link still carries guild-membership state:
 * the guild_member flag or a special-role key. The bot fetches this after a
 * COMPLETE roster seed and diffs it against the live member list to clear flair
 * for members who left while the bot was offline (the live GUILD_MEMBER_REMOVE
 * path only covers leaves the bot observes). One seq scan over discord_links
 * (one row per linked account), called once per gateway connect.
 */
export async function discordIdsWithGuildFlair(pool: Pool): Promise<string[]> {
  const res = await pool.query(
    `SELECT discord_user_id FROM discord_links
      WHERE guild_member = TRUE OR discord_role IS NOT NULL`,
  );
  return res.rows.map((r) => String(r.discord_user_id));
}

// The widest instant a JS Date can represent (ECMA-262: +/-8.64e15 ms from the
// epoch). Number.isFinite admits values far beyond it, and new Date(1e20) is an
// Invalid Date whose toISOString() THROWS.
const MAX_EPOCH_MS = 8.64e15;

/**
 * A bot-pushed join timestamp as an ISO string, or null when it cannot represent
 * an instant.
 *
 * Dropping to null rather than throwing is load-bearing now that the push is ONE
 * statement. The old per-member loop built its Date inside the per-record call, so
 * an unusable value spoiled only its own record and every record before it had
 * already been written; here the whole batch is converted up front, so a single
 * out-of-range value would abort all 1000 records BEFORE any SQL ran, and the bot
 * would re-send the same poisoned set every sweep forever. Null is also the right
 * answer semantically: the column is written with COALESCE, so a null leaves the
 * stored join date alone instead of clearing it.
 */
function joinedAtIso(joinedAtMs: number | null): string | null {
  if (joinedAtMs === null || !Number.isFinite(joinedAtMs)) return null;
  if (Math.abs(joinedAtMs) > MAX_EPOCH_MS) return null;
  return new Date(joinedAtMs).toISOString();
}

/** One bot-pushed guild-metadata record, already validated by the caller. */
export interface DiscordMemberMetaRecord {
  discordUserId: string;
  nickname: string | null;
  joinedAtMs: number | null;
  roleKey: string | null;
}

/** What a bulk member-meta push actually did, per record class. */
export interface DiscordMemberMetaResult {
  /** Rows whose stored values really changed (a write landed). */
  changed: number;
  /** Rows that existed and already held the incoming values (no write needed). */
  skipped: number;
  /**
   * Ids with NO discord_links row, so nothing could be applied for them. The
   * caller needs the IDS, not just a count: an unlinked member's meta has to stay
   * dirty on the pusher's side so it is re-sent once they link.
   */
  unapplied: string[];
}

/** True for a Postgres deadlock abort (SQLSTATE 40P01). */
function isDeadlockAbort(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === '40P01';
}

/**
 * One statement, retried exactly once on a deadlock abort. The bulk upsert's
 * sorted input makes overlapping pushes AGREE on order best-effort, but
 * Postgres row locks follow the plan, never a subquery ORDER BY, so a deadlock
 * stays reachable; the victim's statement committed nothing, so re-running it
 * is clean (the change/skip classification re-reads live rows). One retry and
 * never a loop: a second abort means sustained contention, and the caller's
 * next sweep re-sends anyway.
 */
async function queryRetryingDeadlockOnce(
  pool: Pool,
  text: string,
  params: unknown[],
): Promise<{ rows: Record<string, unknown>[] }> {
  try {
    return await pool.query(text, params);
  } catch (err) {
    if (!isDeadlockAbort(err)) throw err;
    console.warn('setDiscordMemberMetaBulk: deadlock abort (40P01), retrying once');
    return await pool.query(text, params);
  }
}

/**
 * Upsert bot-pushed guild metadata (server join date, in-server nickname, top
 * special-role key) for MANY Discord users in ONE statement, and report what it
 * actually did rather than what it read.
 *
 * This replaces the per-member serial UPDATE the members-meta endpoint used to
 * run: a 1000-member push was 1000 round trips, and every one of them reported
 * success even when it matched no row. Three properties matter here:
 *
 *  1. ONE statement regardless of member count (unnest of four parallel arrays).
 *  2. A row whose stored values already match is NOT written. The `IS DISTINCT
 *     FROM` row comparison is NULL-safe per field, so a NULL-to-NULL column
 *     counts as unchanged rather than as a difference.
 *  3. The three outcomes are reported separately. A Discord member with no link
 *     row (every unlinked guild member) lands in `unapplied` instead of being
 *     counted as written, which is what lets a caller keep re-sending them until
 *     they link.
 *
 * The data-modifying CTE is load-bearing: `matched` (the linked subset of the
 * input) and `updated` read the SAME statement snapshot, so `skipped` is
 * derived as matched minus changed without evaluating the row comparison a
 * second time; the comparison lives ONLY in the UPDATE's WHERE, the one place
 * that stops a write. (`matched` used to carry its own copy as a `will_change`
 * column; at the 1000-record cap that joined discord_links twice and computed
 * the comparison twice per row for numbers the two counts already imply.)
 *
 * Duplicate ids are the caller's to remove; this de-duplicates defensively,
 * keeping the LAST occurrence, which is the state the old sequential loop left
 * behind (later writes overwrote earlier ones).
 */
export async function setDiscordMemberMetaBulk(
  pool: Pool,
  records: readonly DiscordMemberMetaRecord[],
): Promise<DiscordMemberMetaResult> {
  const byId = new Map<string, DiscordMemberMetaRecord>();
  for (const record of records) byId.set(record.discordUserId, record);
  // Sorted by id as a BEST-EFFORT deadlock reducer, not a guarantee. A
  // multi-row UPDATE takes its row locks in the order the plan feeds it, so two
  // overlapping pushes presenting the same ids in DIFFERENT orders can
  // deadlock, and Postgres aborts one of them. The old loop could not: it held
  // exactly one row lock per autocommitted statement. Overlap is reachable
  // (departed-flair clears run alongside the sweep, and several realm processes
  // write this realm-agnostic table), so every caller offers the same input
  // order; but the ORDER BY in the UPDATE's FROM subquery is a hint the planner
  // may reorder, never a locking directive, so the residual deadlock is handled
  // below: one retry on SQLSTATE 40P01 (the aborted statement committed
  // nothing, so the retry is clean), and a second abort propagates as the 500
  // the caller already turns into a next-sweep re-send.
  const deduped = [...byId.values()].sort((a, b) =>
    a.discordUserId < b.discordUserId ? -1 : a.discordUserId > b.discordUserId ? 1 : 0,
  );
  if (deduped.length === 0) return { changed: 0, skipped: 0, unapplied: [] };

  const ids = deduped.map((r) => r.discordUserId);
  const nicknames = deduped.map((r) => r.nickname);
  const joinedAt = deduped.map((r) => joinedAtIso(r.joinedAtMs));
  const roleKeys = deduped.map((r) => r.roleKey);

  // The in-server nickname (nick > global > username) is the preferred display
  // name; COALESCE keeps the OAuth-linked username when the bot sends nothing.
  // discord_role is assigned unconditionally, so a null CLEARS the stored role.
  // Both rules are carried identically into the change comparison, so "would this
  // write alter the row" is asked about the value that would actually be stored.
  const res = await queryRetryingDeadlockOnce(
    pool,
    `WITH input AS (
       SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[])
         AS t(discord_user_id, nickname, joined_at, role_key)
     ),
     matched AS (
       SELECT i.discord_user_id
         FROM input i
         JOIN discord_links dl ON dl.discord_user_id = i.discord_user_id
     ),
     updated AS (
       UPDATE discord_links dl
          SET discord_username = COALESCE(i.nickname, dl.discord_username),
              discord_joined_at = COALESCE(i.joined_at, dl.discord_joined_at),
              discord_role = i.role_key
         FROM (SELECT * FROM input ORDER BY discord_user_id) i
        WHERE dl.discord_user_id = i.discord_user_id
          AND (dl.discord_username, dl.discord_joined_at, dl.discord_role)
              IS DISTINCT FROM
              (COALESCE(i.nickname, dl.discord_username),
               COALESCE(i.joined_at, dl.discord_joined_at),
               i.role_key)
      RETURNING dl.account_id
     )
     SELECT (SELECT count(*) FROM updated) AS changed,
            (SELECT count(*) FROM matched)
              - (SELECT count(*) FROM updated) AS skipped,
            (SELECT COALESCE(array_agg(i.discord_user_id), ARRAY[]::text[])
               FROM input i
              WHERE NOT EXISTS (
                SELECT 1 FROM matched m WHERE m.discord_user_id = i.discord_user_id
              )) AS unapplied,
            (SELECT COALESCE(array_agg(account_id), ARRAY[]::int[])
               FROM updated) AS changed_account_ids`,
    [ids, nicknames, joinedAt, roleKeys],
  );
  const row = res.rows[0];
  // A changed row can move discord_username, which the /api/discord payload
  // serves, so every account whose row the UPDATE really wrote is busted; the
  // skipped and unapplied populations wrote nothing. account_id (not the pushed
  // discord id) because the status cache is keyed by account. Internal use only:
  // the reported result shape is unchanged, so the members-meta response body
  // the bot parses stays byte-identical. Deliberate over-bust: a change to
  // discord_role or discord_joined_at alone (columns the status payload does
  // not serve) still busts that account, costing one refresh; splitting the
  // RETURNING by column is not worth the statement complexity. A missing or
  // unparsed aggregate must not fail the push, but silently skipping busts
  // while rows changed would be an invisible staleness hole, so it warns.
  const changedAccountIds = Array.isArray(row?.changed_account_ids)
    ? row.changed_account_ids
    : null;
  if (changedAccountIds === null) {
    if (Number(row?.changed ?? 0) > 0)
      console.warn('setDiscordMemberMetaBulk: changed_account_ids missing; status busts skipped');
  } else {
    for (const accountId of changedAccountIds) {
      // Positive integers only: account ids are positive serials, and the
      // looser isFinite let a null element coerce to 0 (Number(null) is 0)
      // and bust a key no real account holds. Real aggregate rows are INT
      // PKs, so this rejects only junk.
      const id = Number(accountId);
      if (Number.isInteger(id) && id > 0) bustDiscordStatus(id);
    }
  }
  return {
    changed: Number(row?.changed ?? 0),
    skipped: Number(row?.skipped ?? 0),
    unapplied: Array.isArray(row?.unapplied) ? row.unapplied.map((id: unknown) => String(id)) : [],
  };
}

/** One linked member's flex payload source row, straight off the batched read. */
export interface DiscordFlexBatchRow {
  discord_user_id: string;
  account_id: number;
  discord_username: string | null;
  points: number;
  lifetime_points: number;
  /** The account's top character on this realm, or nulls when it has none. */
  character_name: string | null;
  character_class: string | null;
  character_level: number | null;
}

/**
 * Everything the Discord flex embed needs for MANY Discord ids, in ONE statement.
 *
 * The per-account path (discordFlexForAccount in server/discord.ts) costs four
 * round trips per user: the link lookup, then highestCharacterForAccount,
 * loadRewardState and discordForAccount. Asking it once per online Discord user
 * is what amplified a single bot sweep into hundreds of uncached queries. This
 * answers the whole batch with one round trip whose statement count does not move
 * with the batch size.
 *
 * UNLINKED ids simply produce no row: the caller learns an id is unlinked by its
 * ABSENCE from the result, and nothing is ever fabricated for it.
 *
 * Only narrow scalar columns are selected, never the character `state` JSONB blob
 * (a 1000-member batch would drag megabytes of character state across the wire
 * for one integer). That claim is about the WIRE: server-side, the level
 * projection and the lifetimeXp ORDER BY still read `state` and therefore
 * detoast it once per candidate character row before the LATERAL's LIMIT 1
 * discards all but one, roughly 3000 detoasts per capped request at the D18
 * envelope. Measured against TOASTed production-shaped blobs (~32 KiB each) in
 * tests/discord_db_integration.test.ts: 38 ms raw at the 1000-id cap (54k
 * shared-hit buffers), far inside the 15 s session statement timeout, which is
 * why this rides the default with no runWithStatementTimeout allowance; the
 * integration suite bounds it and logs the current figure on every DB-gated
 * run. `account_id` rides along as the row's identity even though
 * the flex payload itself does not render it: it is what lets a caller join a
 * row back to an account without a second lookup, and it is one int per row.
 * Everything else selected IS a payload field. The level is projected
 * SQL-side with the same `state.level` over column-level precedence the
 * per-account path applies in TypeScript. The guard around that projection makes
 * it TOTAL, and all three of its parts are load-bearing: a bare `::int` cast
 * raises on a non-numeric `level`, `jsonb_typeof` alone still admits a FLOAT
 * (`'40.5'::int` raises too, which is why the cast goes through `numeric`), and
 * `numeric::int` still raises out-of-range without the bounds test. Any one of
 * those would take the WHOLE batch down over a single malformed character row,
 * where the per-account path (`ch.state?.level ?? ch.level` in TypeScript)
 * shrugs and answers. Falling back to the column matches what the row claims.
 * Note the sibling `lifetimeXp` cast in the ORDER BY needs no such guard: the two
 * expression indexes in server/db.ts are built on it, so a value that cannot cast
 * could never have been stored. `state.level` has no equivalent proof.
 *
 * KEEP THE LATERAL'S ORDER BY IN LOCKSTEP with highestCharacterForAccount in
 * server/db.ts. Both endpoints stay live, so if the two disagree about which
 * character is "top" the bot shows a different character depending on which one
 * it called. server/db.ts cannot be imported here (db.ts imports THIS module for
 * DISCORD_SCHEMA, so the dependency runs one way only), which is why the ordering
 * is restated rather than shared; tests/discord_db.test.ts pins this copy.
 */
export async function discordFlexRowsForDiscordIds(
  pool: Pool,
  discordUserIds: readonly string[],
  realm: string,
): Promise<DiscordFlexBatchRow[]> {
  if (discordUserIds.length === 0) return [];
  const res = await pool.query(
    `SELECT dl.discord_user_id,
            dl.account_id,
            dl.discord_username,
            COALESCE(rp.points, 0) AS points,
            COALESCE(rp.lifetime_points, 0) AS lifetime_points,
            ch.name AS character_name,
            ch.class AS character_class,
            ch.level AS character_level
       FROM discord_links dl
       LEFT JOIN reward_points rp ON rp.account_id = dl.account_id
       LEFT JOIN LATERAL (
         SELECT c.name, c.class,
                CASE WHEN jsonb_typeof(c.state->'level') = 'number'
                     THEN CASE WHEN (c.state->>'level')::numeric
                                    BETWEEN -2147483648 AND 2147483647
                               THEN (c.state->>'level')::numeric::int ELSE c.level END
                     ELSE c.level END AS level
           FROM characters c
          WHERE c.account_id = dl.account_id AND c.realm = $2
          ORDER BY c.level DESC, ((c.state->>'lifetimeXp')::bigint) DESC NULLS LAST, c.id ASC
          LIMIT 1
       ) ch ON TRUE
      WHERE dl.discord_user_id = ANY($1::text[])`,
    // De-duplicated like the sibling discordLinksForAccounts, not left to the
    // caller: today's one caller sanitizes into a Set already, but a second
    // caller would silently inherit that unstated requirement, and repeats in a
    // ScalarArrayOpExpr waste probes for nothing.
    [[...new Set(discordUserIds)], realm],
  );
  return res.rows.map((row) => ({
    discord_user_id: String(row.discord_user_id),
    account_id: Number(row.account_id),
    discord_username: row.discord_username ?? null,
    points: Number(row.points ?? 0),
    lifetime_points: Number(row.lifetime_points ?? 0),
    character_name: row.character_name ?? null,
    character_class: row.character_class ?? null,
    // Nullish, not `=== null`: an ABSENT key is undefined, and Number(undefined)
    // is NaN, which would ride out to the wire as a level of null-after-JSON.
    character_level: row.character_level == null ? null : Number(row.character_level),
  }));
}
