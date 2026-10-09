// Permanent account ownership, separate from each character's pending reveal and
// equipped companion. Keep forever: one bounded row per account, cascaded on delete.
import type { PoolClient } from 'pg';
import { type BuddyKey, buddyDef } from '../src/sim/content/buddies';
import type { CharacterState } from '../src/sim/sim';
import { pool, saveCharacterStateOnClient } from './db';
import { cancelDetachedBackend } from './db_backend_cancel';
import { createDbTransactionDeadline } from './db_transaction_deadline';

export const ACCOUNT_BUDDIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_buddies (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  owned TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT account_buddies_active_keys CHECK (
    cardinality(owned) <= 3 AND owned <@ ARRAY['horse','crystal_lich','forgemaw']::text[])
);`;

export function normalizeAccountBuddies(raw: unknown): BuddyKey[] {
  return Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter((key): key is BuddyKey => typeof key === 'string' && !!buddyDef(key)),
        ),
      ].sort()
    : [];
}

/** A join-time indexed scan of this account's characters, projecting only the
 * legacy owned keys in SQL. Queued grants transfer in the SAME statement before
 * deletion commits. Pending raid reveals remain character-local. */
const accountBuddyLoads = new Map<number, Promise<BuddyKey[]>>();
export function loadAccountBuddies(accountId: number): Promise<BuddyKey[]> {
  const pending = accountBuddyLoads.get(accountId);
  if (pending) return pending;
  const run = migrateAndLoadAccountBuddies(accountId).finally(() =>
    accountBuddyLoads.delete(accountId),
  );
  accountBuddyLoads.set(accountId, run);
  return run;
}

async function migrateAndLoadAccountBuddies(accountId: number): Promise<BuddyKey[]> {
  const result = await pool.query(
    `WITH legacy AS MATERIALIZED (
       SELECT c.id, c.state->'buddies'->'owned' AS owned
         FROM characters c WHERE c.account_id = $1
     ), queued AS (
       DELETE FROM character_buddy_grants g USING legacy c
        WHERE g.character_id = c.id RETURNING g.buddy_key
     ), keys AS (
       SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(owned) = 'array'
         THEN owned ELSE '[]'::jsonb END) AS key FROM legacy
       UNION SELECT buddy_key FROM queued
     )
     INSERT INTO account_buddies AS current (account_id, owned)
       SELECT $1, COALESCE(array_agg(DISTINCT key) FILTER
         (WHERE key = ANY($2::text[])), '{}') FROM keys
     ON CONFLICT (account_id) DO UPDATE SET owned = ARRAY(
       SELECT DISTINCT key FROM unnest(current.owned || EXCLUDED.owned) AS key ORDER BY key)
     RETURNING owned`,
    [accountId, ['horse', 'crystal_lich', 'forgemaw']],
  );
  return normalizeAccountBuddies(result.rows[0]?.owned);
}

/** A changed grant only; quiet autosaves never call this writer. */
export async function grantAccountBuddies(
  accountId: number,
  keys: readonly string[],
): Promise<BuddyKey[]> {
  const result = await pool.query(
    `INSERT INTO account_buddies AS current (account_id, owned) VALUES ($1, $2::text[])
     ON CONFLICT (account_id) DO UPDATE SET owned = ARRAY(
       SELECT DISTINCT key FROM unnest(current.owned || EXCLUDED.owned) AS key ORDER BY key)
     RETURNING owned`,
    [accountId, normalizeAccountBuddies(keys)],
  );
  return normalizeAccountBuddies(result.rows[0]?.owned);
}

export async function readAccountBuddyBatch(
  accountIds: readonly number[],
  observe?: (ms: number) => void,
): Promise<Map<number, BuddyKey[]>> {
  if (accountIds.length > 256) throw new Error('account buddy read batch exceeds 256');
  if (accountIds.length === 0) return new Map();
  const result = await pool.query(
    'SELECT account_id, owned FROM account_buddies WHERE account_id = ANY($1::int[])',
    [accountIds],
  );
  const start = performance.now();
  const rows = new Map(
    result.rows.map((row) => [Number(row.account_id), normalizeAccountBuddies(row.owned)]),
  );
  observe?.(performance.now() - start);
  return rows;
}

export interface BuddyPurchaseSnapshot {
  characterId: number;
  leaseNonce?: string;
  state: CharacterState;
}

/** Character FIFO is held by the caller, before checkout. Lock order is the
 * dedicated account buddy row, then character/storage rows. No other writer
 * takes these locks in reverse: ordinary grants write only account_buddies.
 * Mutation is synchronous after the lock; failure after it must quarantine the
 * live character, since an interrupted COMMIT cannot authorize a refund. */
export async function purchaseAccountBuddy(
  accountId: number,
  key: BuddyKey,
  prepare: (owned: readonly BuddyKey[]) => BuddyPurchaseSnapshot | null,
): Promise<BuddyKey[]> {
  const connection = await pool.connect();
  const transaction = createDbTransactionDeadline(connection, {
    operation: 'buddy purchase',
    timeoutMs: 10_000,
    cancelBackend: cancelDetachedBackend,
  });
  // The save seam consumes query only; the deadline wrapper owns the connection.
  const client = transaction as unknown as PoolClient;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
    // Join has created the row, so the normal purchase does no gratuitous upsert.
    const locked = await client.query(
      'SELECT owned FROM account_buddies WHERE account_id = $1 FOR NO KEY UPDATE',
      [accountId],
    );
    if (!locked.rows[0]) throw new Error('account buddy ownership was not loaded');
    const owned = normalizeAccountBuddies(locked.rows[0].owned);
    const snapshot = prepare(owned);
    if (owned.includes(key) || !snapshot) {
      await transaction.rollback();
      return owned;
    }
    if (
      !(await saveCharacterStateOnClient(
        client,
        snapshot.characterId,
        snapshot.state.level,
        snapshot.state,
        snapshot.leaseNonce,
      ))
    ) {
      throw new Error('buddy purchase character save fenced out');
    }
    const merged = normalizeAccountBuddies([...owned, ...(snapshot.state.buddies?.owned ?? [])]);
    await client.query('UPDATE account_buddies SET owned = $2::text[] WHERE account_id = $1', [
      accountId,
      merged,
    ]);
    await transaction.commit();
    return merged;
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.release();
  }
}
