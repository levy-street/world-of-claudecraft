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

import { BANK_LEDGER_LARGE_MOVEMENT_PREDICATE_SQL } from './bank_ledger_indexes';
import { DB_HEAVY_STATEMENT_TIMEOUT_MS, pool, runWithStatementTimeout } from './db';
import { MAIL_PARTITION_MARKER_PREFIX, MAIL_RECIPIENT_KEY_INFIX } from './mail_partition_backfill';

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

export type AccountWealthSweepLockError = (scope: 'unlock', err: unknown) => void;

const defaultLockError: AccountWealthSweepLockError = (scope, err) =>
  console.error(`account wealth sweep ${scope} failed:`, err);

/** Run one sweep pass under the global advisory lock. Returns false (without
 *  running) when a peer process holds the lock. A failed unlock is reported
 *  through onError (default console.error) before the client is destroyed:
 *  that arm is the module header's poisoned-lock hazard, so it must never be
 *  silent. */
export async function withAccountWealthSweepLock(
  run: () => Promise<void>,
  onError: AccountWealthSweepLockError = defaultLockError,
): Promise<boolean> {
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
      } catch (err) {
        onError('unlock', err);
        destroyClient = true;
      }
    }
    return true;
  } finally {
    client.release(destroyClient || undefined);
  }
}

/** Row counts of one purse refresh: rows whose purse changed (inserted or
 *  updated; the IS DISTINCT FROM guard skips the rest) and orphan rows zeroed. */
export interface AccountPurseRefreshCounts {
  rowsChanged: number;
  orphansZeroed: number;
}

/** Upsert every account's purse total from characters.state (the sweep's SQL
 *  arm). Accounts whose characters were all deleted get their purse zeroed so
 *  a stale row can never keep a vanished fortune on the rich list.
 *
 *  Both statements scan every characters.state blob, so each rides the heavy
 *  allowance: on the pool default a scan that outgrows 15 s would be cancelled
 *  and retried, identically doomed, every sweep tick. One transaction PER
 *  statement, not one around both: the upsert's ON CONFLICT locks every
 *  conflicting row even when the DO UPDATE WHERE guard skips it, and those
 *  locks must release at the statement's own commit rather than be held
 *  through a second full scan (an account deletion cascading into
 *  account_wealth would block for the pair otherwise). */
export async function refreshAccountPurseTotals(): Promise<AccountPurseRefreshCounts> {
  const upsert = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
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
    ),
  );
  const zero = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `UPDATE account_wealth w SET
       purse_copper = 0,
       total_copper = w.mail_copper + w.market_copper,
       updated_at = now()
     WHERE w.purse_copper <> 0
       AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.account_id = w.account_id)`,
    ),
  );
  return { rowsChanged: upsert.rowCount ?? 0, orphansZeroed: zero.rowCount ?? 0 };
}

export interface EscrowStateRow {
  key: string;
  data: unknown;
}

/** Every realm's mail and market blob (the escrow inputs the sweep parses in
 *  Node), plus mail partition markers so retained legacy blobs can be ignored.
 *  The retained bare legacy 'market' rollback row does not match 'market:%'. */
export async function listEscrowStateRows(): Promise<EscrowStateRow[]> {
  const res = await pool.query(
    `SELECT key, data FROM world_state
     WHERE key LIKE 'mail:%' OR key LIKE 'market:%' OR key LIKE '${MAIL_PARTITION_MARKER_PREFIX}%'`,
  );
  return res.rows.map((row) => ({ key: row.key, data: row.data }));
}

// Number.MAX_SAFE_INTEGER, the id-key bound the retired Node fold enforced via
// Number.isSafeInteger; the SQL arm must draw the identical line so a key just
// past it stays name-resolved on both sides.
const MAX_SAFE_INTEGER_SQL = '9007199254740991';

// The one-statement work_mem raise for the escrow aggregate. Measured on a
// 134k-letter, 103 MB book (PostgreSQL 16): at the stock 4 MB the pass
// spills ~145 MB of temp-file writes and re-reads every tick (690 ms); at
// 128 MB the sort fits but the expansion tuplestore still spills ~107 MB
// (565 ms); at 256 MB nothing spills (500 ms). A book grown past the bound
// degrades back to a graceful spill, never a failure. Safe to hold: exactly
// one statement runs under it per pass, and the sweep is globally serialized
// across realm processes by the advisory lock, so the allocation can never
// multiply.
export const ESCROW_AGGREGATE_WORK_MEM = '256MB';

/** Per-character escrow totals aggregated INSIDE Postgres. The jsonb
 *  expansion of every realm's mail and market blob never leaves the database:
 *  the result set is proportional to the number of distinct recipients with
 *  escrowed copper, never to the size of the books (the production mail row
 *  has been 89 MB; shipping and JSON.parse-ing it in Node blocked the world
 *  loop for hundreds of ms every sweep tick).
 *
 *  Semantics mirror the Node fold `escrowTotalsFromStateRows` exactly (that
 *  fold is retained in server/account_wealth.ts as the parity oracle, pinned
 *  by tests/account_wealth_pg_integration.test.ts): realm is everything after
 *  the key's first colon, partitioned `mail:<realm>:r:*` rows count as mail
 *  for their realm, and a retained legacy `mail:<realm>` row is ignored once
 *  that realm has either a partition marker or any partition row; the bare
 *  legacy 'market' rollback row does not match 'market:%' and is excluded; a
 *  letter or collection entry counts only when its recipient key is a string
 *  and its copper is a number whose floor is at least 1; keys are trimmed and
 *  the house-stock '' key is skipped; an all-digit key within
 *  Number.MAX_SAFE_INTEGER resolves by character id (merged across realms),
 *  anything else stays a realm-scoped legacy name.
 *
 *  Both expansions scan every realm's blobs, so the read rides the heavy
 *  allowance like refreshAccountPurseTotals. The CASE around each
 *  jsonb_array_elements input is load-bearing: the lateral evaluates before
 *  any WHERE guard could, and a malformed blob whose 'mail'/'collections' is
 *  not an array must yield zero rows, not fail the whole sweep. */
export async function aggregateEscrowTotals(): Promise<EscrowCharacterTotal[]> {
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, async (query) => {
    // SET LOCAL: scoped to this transaction only (see the constant's comment).
    await query(`SET LOCAL work_mem = '${ESCROW_AGGREGATE_WORK_MEM}'`);
    // Statement shape notes, all load-bearing:
    // - The inner OFFSET 0 subqueries compute each blob's array datum ONCE;
    //   without the barrier the planner inlines the expression into both the
    //   jsonb_typeof guard and the value use and detoasts the 89 MB blob
    //   twice per pass.
    // - The CASE around each jsonb_array_elements input yields NULL (zero
    //   rows) for a malformed non-array 'mail'/'collections' instead of
    //   failing the whole sweep; the copper upper bound below serves the
    //   same must-not-abort rule for absurd stored values that would
    //   overflow the bigint pipeline (the retired Node fold would have
    //   mis-summed those in doubles and then failed in applyEscrowTotals).
    // - The id-key test and the copper guard are both CASE-armored, never
    //   bare AND chains: PostgreSQL does not guarantee AND evaluation order,
    //   so the digit-bounding regex must run before raw_key's ::numeric cast
    //   (leading zeros aside, 16 significant digits), and copper's
    //   jsonb_typeof check must run before its cast (a non-number copper
    //   would otherwise abort the whole sweep if the planner ever reordered
    //   the quals). CASE is the one construct whose evaluation order is
    //   guaranteed.
    return query(
      `WITH mail_rows AS (
          SELECT rest,
                 strpos(rest, '${MAIL_RECIPIENT_KEY_INFIX}') AS partition_sep,
                 data
          FROM (
            SELECT substr(w.key, strpos(w.key, ':') + 1) AS rest, w.data
            FROM world_state w WHERE w.key LIKE 'mail:%' OFFSET 0
          ) raw_mail
        ),
        mail_books AS (
          SELECT CASE WHEN partition_sep > 0
                      THEN substr(rest, 1, partition_sep - 1)
                      ELSE rest
                 END AS realm,
                 partition_sep > 0 AS is_partition,
                 data->'mail' AS arr
          FROM mail_rows
          WHERE rest <> ''
        ),
        migrated_mail_realms AS (
          SELECT substr(w.key, ${MAIL_PARTITION_MARKER_PREFIX.length + 1}) AS realm
          FROM world_state w
          WHERE w.key LIKE '${MAIL_PARTITION_MARKER_PREFIX}%'
            AND substr(w.key, ${MAIL_PARTITION_MARKER_PREFIX.length + 1}) <> ''
          UNION
          SELECT realm FROM mail_books WHERE is_partition
        ),
        books AS (
          SELECT realm, true AS is_mail,
                 CASE WHEN jsonb_typeof(arr) = 'array' THEN arr END AS arr
          FROM mail_books mb
          WHERE mb.is_partition
             OR NOT EXISTS (SELECT 1 FROM migrated_mail_realms mmr WHERE mmr.realm = mb.realm)
          UNION ALL
          SELECT realm, false,
                 CASE WHEN jsonb_typeof(arr) = 'array' THEN arr END
         FROM (SELECT substr(w.key, strpos(w.key, ':') + 1) AS realm, w.data->'collections' AS arr
               FROM world_state w WHERE w.key LIKE 'market:%' OFFSET 0) c
       ),
       entries AS (
         SELECT b.realm, b.is_mail,
                btrim(
                  CASE WHEN b.is_mail THEN elem->>'recipientKey' ELSE elem->>'key' END,
                  E' \\t\\n\\r\\f\\v'
                ) AS raw_key,
                floor(cn.copper_numeric)::bigint AS copper
         FROM books b
         CROSS JOIN LATERAL jsonb_array_elements(b.arr) AS elem
         CROSS JOIN LATERAL (
           SELECT CASE WHEN jsonb_typeof(elem->'copper') = 'number'
                       THEN (elem->>'copper')::numeric END AS copper_numeric
         ) cn
         WHERE jsonb_typeof(
                 CASE WHEN b.is_mail THEN elem->'recipientKey' ELSE elem->'key' END
               ) = 'string'
           AND cn.copper_numeric >= 1
           AND cn.copper_numeric < 9007199254740992
       ),
       keyed AS (
         SELECT CASE WHEN raw_key ~ '^0*[0-9]{1,16}$' THEN
                  CASE WHEN raw_key::numeric <= ${MAX_SAFE_INTEGER_SQL}
                       THEN (raw_key::numeric)::bigint END
                END AS character_id,
                realm, raw_key, copper, is_mail
         FROM entries
         WHERE raw_key <> ''
       )
       SELECT character_id,
              CASE WHEN character_id IS NULL THEN raw_key END AS character_name,
              CASE WHEN character_id IS NULL THEN realm END AS realm,
              COALESCE(sum(copper) FILTER (WHERE is_mail), 0)::bigint AS mail_copper,
              COALESCE(sum(copper) FILTER (WHERE NOT is_mail), 0)::bigint AS market_copper
       FROM keyed
       GROUP BY character_id,
                CASE WHEN character_id IS NULL THEN raw_key END,
                CASE WHEN character_id IS NULL THEN realm END`,
    );
  });
  return res.rows.map((row) => ({
    characterId: row.character_id === null ? null : Number(row.character_id),
    characterName: row.character_name ?? null,
    realm: row.realm ?? null,
    mailCopper: Number(row.mail_copper),
    marketCopper: Number(row.market_copper),
  }));
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
 *  collected mail or market gold leaves the total on the next sweep. Returns
 *  the number of stale escrow rows zeroed (the outer UPDATE's count). */
export async function applyEscrowTotals(totals: EscrowCharacterTotal[]): Promise<number> {
  const ids = totals.map((t) => t.characterId ?? -1);
  const names = totals.map((t) => t.characterName ?? '');
  const realms = totals.map((t) => t.realm ?? '');
  const mail = totals.map((t) => String(t.mailCopper));
  const market = totals.map((t) => String(t.marketCopper));
  const res = await pool.query(
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
  return res.rowCount ?? 0;
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

// Far BELOW the pool default, same reasoning as GUILD_BANK_LOG_TIMEOUT_MS in
// server/db.ts: the intended cost is a bounded backward scan of the
// bank_ledger_account_large_recent index, but that index is built CONCURRENTLY after
// listen (server/bank_ledger_indexes.ts), so a realm can serve this read
// before it exists, and a missing or INVALID index turns it into a sequential
// scan of a keep-forever table. Two seconds fails this one admin read instead
// of pinning pooled clients for the full 15 s default.
export const LARGE_GOLD_MOVEMENTS_TIMEOUT_MS = 2_000;

/** Recent large gold movements for one account, from the append-only
 *  bank_ledger (the only per-op gold audit trail that exists; vendor, quest,
 *  trade, and mail flows are not ledgered and cannot appear here). */
export async function largeGoldMovementsForAccount(
  accountId: number,
  limit: number,
): Promise<LargeGoldMovementRow[]> {
  const res = await runWithStatementTimeout(LARGE_GOLD_MOVEMENTS_TIMEOUT_MS, (query) =>
    query(
      `SELECT l.id, l.character_id, c.name AS character_name, l.op, l.container,
            l.copper_delta, l.created_at
     FROM bank_ledger l
     LEFT JOIN characters c ON c.id = l.character_id
     WHERE l.account_id = $1 AND ${BANK_LEDGER_LARGE_MOVEMENT_PREDICATE_SQL}
     ORDER BY l.id DESC
     LIMIT $2`,
      [accountId, limit],
    ),
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
