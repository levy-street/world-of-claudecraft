// Materialised per-account wealth totals for the admin dashboard (p2p market
// oversight). One row per account: the purse sum over the account's characters
// plus the two in-transit escrow pools a player can reclaim (mail attachments,
// uncollected market proceeds), refreshed by the periodic sweep in
// server/account_wealth.ts.
//
// Why materialised rather than aggregated live: the purse lives inside the
// characters.state JSONB blob, so a live "ORDER BY total gold" would detoast
// every character's full state on every admin sort/page. The database-visible
// purse only advances on the 30 s autosave anyway, so a ~60 s sweep loses no
// freshness an admin query could ever observe. The account_wealth_total index
// serves the top-holders board directly; the accounts-list gold sort and the
// flagged-account gold trend read the materialised COLUMN (one bigint instead
// of a per-row blob detoast) but keep their surrounding join/aggregate cost,
// the same shape as the list's sibling sorts.
//
// Guild treasuries are deliberately NOT folded into total_copper: the guild
// bank keeps no depositor identity (src/sim/guild_bank.ts, the anonymous-pipe
// doctrine), so any per-member share would be fiction. The account detail
// endpoint surfaces each character's guild treasury as context instead.

import { pool } from './db';

// account_wealth is bounded (one row per account, cascade-deleted with the
// account), so it needs no retention registration: it can never grow past the
// accounts table it mirrors.
export const ACCOUNT_WEALTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_wealth (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  purse_copper BIGINT NOT NULL DEFAULT 0,
  mail_copper BIGINT NOT NULL DEFAULT 0,
  market_copper BIGINT NOT NULL DEFAULT 0,
  total_copper BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_wealth_total ON account_wealth (total_copper DESC);
`;

// The sweep's cross-process guard. The sweep queries are GLOBAL (they cover
// every realm's characters and world_state rows), so with several realm
// processes only one may run a pass at a time: N identical global upserts with
// no guaranteed row ordering are lock contention and a deadlock shape, not
// just wasted work. Same session-advisory-lock discipline as the retention
// sweep (server/retention_sweep.ts): the lock rides a dedicated client for the
// duration of the pass, a loser stands down until its next tick, and a client
// whose lock state is unknown is DESTROYED rather than pooled, because a
// leaked session lock on a pooled connection would silently stop every future
// pass in every process.
export const ACCOUNT_WEALTH_SWEEP_LOCK_KEY = 0x57_4f_43_03; // "WOC\x03"

/** Run one sweep pass under the global advisory lock. Returns false (without
 *  running) when a peer process holds the lock. */
export async function withAccountWealthSweepLock(run: () => Promise<void>): Promise<boolean> {
  const client = await pool.connect();
  let destroyClient = false;
  try {
    let acquired = false;
    try {
      const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
        ACCOUNT_WEALTH_SWEEP_LOCK_KEY,
      ]);
      acquired = result.rows[0]?.acquired === true;
    } catch (err) {
      destroyClient = true;
      throw err;
    }
    if (!acquired) return false;
    try {
      await run();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ACCOUNT_WEALTH_SWEEP_LOCK_KEY]);
      } catch {
        destroyClient = true;
      }
    }
    return true;
  } finally {
    client.release(destroyClient || undefined);
  }
}

/** Upsert every account's purse total from characters.state (the sweep's SQL
 *  arm). Accounts whose characters were all deleted get their purse zeroed so
 *  a stale row can never keep a vanished fortune on the rich list. */
export async function refreshAccountPurseTotals(): Promise<void> {
  await pool.query(
    `INSERT INTO account_wealth (account_id, purse_copper, total_copper, updated_at)
     SELECT c.account_id,
            COALESCE(sum(COALESCE((c.state->>'copper')::bigint, 0)), 0),
            COALESCE(sum(COALESCE((c.state->>'copper')::bigint, 0)), 0),
            now()
     FROM characters c
     GROUP BY c.account_id
     ON CONFLICT (account_id) DO UPDATE SET
       purse_copper = EXCLUDED.purse_copper,
       total_copper = EXCLUDED.purse_copper
         + account_wealth.mail_copper + account_wealth.market_copper,
       updated_at = now()
     WHERE account_wealth.purse_copper IS DISTINCT FROM EXCLUDED.purse_copper`,
  );
  await pool.query(
    `UPDATE account_wealth w SET
       purse_copper = 0,
       total_copper = w.mail_copper + w.market_copper,
       updated_at = now()
     WHERE w.purse_copper <> 0
       AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.account_id = w.account_id)`,
  );
}

export interface EscrowStateRow {
  key: string;
  data: unknown;
}

/** Every realm's mail and market blob (the escrow inputs the sweep parses in
 *  Node). The retained bare legacy 'market' rollback row does not match the
 *  'market:%' pattern and is deliberately excluded. */
export async function listEscrowStateRows(): Promise<EscrowStateRow[]> {
  const res = await pool.query(
    `SELECT key, data FROM world_state WHERE key LIKE 'mail:%' OR key LIKE 'market:%'`,
  );
  return res.rows.map((row) => ({ key: row.key, data: row.data }));
}

/** Per-character escrow totals resolved by stable character id, or (for legacy
 *  pre-rekey saves) by character name within the blob's realm. */
export interface EscrowCharacterTotal {
  characterId: number | null;
  characterName: string | null;
  realm: string | null;
  mailCopper: number;
  marketCopper: number;
}

/** Write the sweep's escrow totals: resolve each entry to its account, sum per
 *  account, upsert, and zero escrow on every account absent from this pass so
 *  collected mail or market gold leaves the total on the next sweep. */
export async function applyEscrowTotals(totals: EscrowCharacterTotal[]): Promise<void> {
  const ids = totals.map((t) => t.characterId ?? -1);
  const names = totals.map((t) => t.characterName ?? '');
  const realms = totals.map((t) => t.realm ?? '');
  const mail = totals.map((t) => String(t.mailCopper));
  const market = totals.map((t) => String(t.marketCopper));
  await pool.query(
    `WITH incoming AS (
       SELECT * FROM unnest(
         $1::int[], $2::text[], $3::text[], $4::bigint[], $5::bigint[]
       ) AS v(character_id, character_name, realm, mail_copper, market_copper)
     ),
     resolved AS (
       SELECT c.account_id,
              sum(i.mail_copper)::bigint AS mail_copper,
              sum(i.market_copper)::bigint AS market_copper
       FROM incoming i
       JOIN characters c
         ON (i.character_id > 0 AND c.id = i.character_id)
         OR (i.character_id <= 0 AND i.character_name <> ''
             AND c.name = i.character_name AND c.realm = i.realm)
       GROUP BY c.account_id
     ),
     upserted AS (
       INSERT INTO account_wealth (account_id, mail_copper, market_copper, total_copper, updated_at)
       SELECT account_id, mail_copper, market_copper, mail_copper + market_copper, now()
       FROM resolved
       ON CONFLICT (account_id) DO UPDATE SET
         mail_copper = EXCLUDED.mail_copper,
         market_copper = EXCLUDED.market_copper,
         total_copper = account_wealth.purse_copper
           + EXCLUDED.mail_copper + EXCLUDED.market_copper,
         updated_at = now()
       WHERE account_wealth.mail_copper IS DISTINCT FROM EXCLUDED.mail_copper
          OR account_wealth.market_copper IS DISTINCT FROM EXCLUDED.market_copper
       RETURNING account_id
     )
     UPDATE account_wealth w SET
       mail_copper = 0,
       market_copper = 0,
       total_copper = w.purse_copper,
       updated_at = now()
     WHERE (w.mail_copper <> 0 OR w.market_copper <> 0)
       AND NOT EXISTS (SELECT 1 FROM resolved r WHERE r.account_id = w.account_id)`,
    [ids, names, realms, mail, market],
  );
}

export interface TopWealthHolderRow {
  accountId: number;
  username: string;
  purseCopper: number;
  mailCopper: number;
  marketCopper: number;
  totalCopper: number;
  maxLevel: number;
  lastLogin: string | null;
  bannedAt: string | null;
  suspendedUntil: string | null;
  activeFlagCount: number;
  updatedAt: string;
}

/** The rich list: top accounts by materialised total, with the moderation
 *  badges and the active suspicion-flag count the flagged workflow feeds.
 *  Served through the TTL cache in server/account_wealth.ts, never
 *  per-request. */
export async function topWealthHolders(limit: number): Promise<TopWealthHolderRow[]> {
  const res = await pool.query(
    `SELECT w.account_id, a.username, w.purse_copper, w.mail_copper, w.market_copper,
            w.total_copper, a.last_login, a.banned_at, a.suspended_until, w.updated_at,
            COALESCE((SELECT max(c.level) FROM characters c WHERE c.account_id = w.account_id), 0)::int
              AS max_level,
            (SELECT count(*) FROM account_suspicion_flags f
             WHERE f.account_id = w.account_id
               AND f.status IN ('new', 'under_review'))::int AS active_flag_count
     FROM account_wealth w
     JOIN accounts a ON a.id = w.account_id
     ORDER BY w.total_copper DESC, w.account_id
     LIMIT $1`,
    [limit],
  );
  return res.rows.map((row) => ({
    accountId: Number(row.account_id),
    username: row.username,
    purseCopper: Number(row.purse_copper),
    mailCopper: Number(row.mail_copper),
    marketCopper: Number(row.market_copper),
    totalCopper: Number(row.total_copper),
    maxLevel: Number(row.max_level),
    lastLogin: row.last_login,
    bannedAt: row.banned_at,
    suspendedUntil: row.suspended_until,
    activeFlagCount: Number(row.active_flag_count),
    updatedAt: row.updated_at,
  }));
}

export interface AccountWealthCharacterRow {
  characterId: number;
  name: string;
  realm: string;
  level: number;
  copper: number;
  guildId: number | null;
  guildName: string | null;
  guildTreasuryCopper: number | null;
  guildMemberCount: number | null;
}

export interface AccountWealthBreakdown {
  accountId: number;
  purseCopper: number;
  mailCopper: number;
  marketCopper: number;
  totalCopper: number;
  updatedAt: string | null;
  characters: AccountWealthCharacterRow[];
}

/** One account's gold breakdown: per-character purse plus guild treasury
 *  context (shown, never summed; see the module header), and the account's
 *  materialised escrow totals. Null when the account does not exist. */
export async function accountWealthBreakdown(
  accountId: number,
): Promise<AccountWealthBreakdown | null> {
  const [account, wealth, characters] = await Promise.all([
    pool.query(`SELECT id FROM accounts WHERE id = $1`, [accountId]),
    pool.query(
      `SELECT purse_copper, mail_copper, market_copper, total_copper, updated_at
       FROM account_wealth WHERE account_id = $1`,
      [accountId],
    ),
    pool.query(
      `SELECT c.id, c.name, c.realm, c.level,
              COALESCE((c.state->>'copper')::bigint, 0) AS copper,
              g.id AS guild_id, g.name AS guild_name,
              COALESCE((gb.data->>'treasury')::bigint, 0) AS guild_treasury,
              (SELECT count(*) FROM guild_members m2 WHERE m2.guild_id = g.id)::int
                AS guild_member_count
       FROM characters c
       LEFT JOIN guild_members m ON m.character_id = c.id
       LEFT JOIN guilds g ON g.id = m.guild_id
       LEFT JOIN guild_banks gb ON gb.guild_id = g.id
       WHERE c.account_id = $1
       ORDER BY copper DESC, c.id`,
      [accountId],
    ),
  ]);
  if (!account.rows[0]) return null;
  const w = wealth.rows[0];
  return {
    accountId,
    purseCopper: w ? Number(w.purse_copper) : 0,
    mailCopper: w ? Number(w.mail_copper) : 0,
    marketCopper: w ? Number(w.market_copper) : 0,
    totalCopper: w ? Number(w.total_copper) : 0,
    updatedAt: w ? w.updated_at : null,
    characters: characters.rows.map((row) => ({
      characterId: Number(row.id),
      name: row.name,
      realm: row.realm,
      level: Number(row.level),
      copper: Number(row.copper),
      guildId: row.guild_id === null ? null : Number(row.guild_id),
      guildName: row.guild_name ?? null,
      guildTreasuryCopper: row.guild_id === null ? null : Number(row.guild_treasury),
      guildMemberCount: row.guild_id === null ? null : Number(row.guild_member_count),
    })),
  };
}

export interface LargeGoldMovementRow {
  id: number;
  characterId: number;
  characterName: string | null;
  op: string;
  container: string;
  copperDelta: number;
  createdAt: string;
}

/** Recent large gold movements for one account, from the append-only
 *  bank_ledger (the only per-op gold audit trail that exists; vendor, quest,
 *  trade, and mail flows are not ledgered and cannot appear here). */
export async function largeGoldMovementsForAccount(
  accountId: number,
  thresholdCopper: number,
  limit: number,
): Promise<LargeGoldMovementRow[]> {
  const res = await pool.query(
    `SELECT l.id, l.character_id, c.name AS character_name, l.op, l.container,
            l.copper_delta, l.created_at
     FROM bank_ledger l
     LEFT JOIN characters c ON c.id = l.character_id
     WHERE l.account_id = $1 AND abs(l.copper_delta) >= $2
     ORDER BY l.id DESC
     LIMIT $3`,
    [accountId, thresholdCopper, limit],
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    characterId: Number(row.character_id),
    characterName: row.character_name ?? null,
    op: row.op,
    container: row.container,
    copperDelta: Number(row.copper_delta),
    createdAt: row.created_at,
  }));
}
