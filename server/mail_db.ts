// The Ravenpost mail book's partitioned write path (#3561): the pieces that
// need no `pool`/`loadWorldState` access, split out of db.ts purely to stay
// under its monolith ceiling (server/CLAUDE.md). The pool-backed read/write
// wrappers (loadMailState, saveMailState, saveMailPartitions) stay in db.ts
// alongside loadMarketState/saveMarketState, which this mirrors; this module
// never imports db.ts (mail_partition_backfill.ts's own discipline), so
// db.ts can import from here without a cycle.

import type { MailSave } from '../src/sim/sim';
import { mailRecipientKey } from './mail_partition_backfill';

// Boot-ordering write gate for the partitioned mail rows, the same shape as
// assertMarketWriteGateOpen: before ensureSchema's mail partition backfill
// has run and recorded its marker, a realm process must not persist
// `mail:<realm>:r:*` rows, or the 30 s autosave could race ahead of the
// backfill and leave the realm with a mix of legacy and partitioned state.
let mailPartitionWriteGateOpen = false;

export function openMailPartitionWriteGate(): void {
  mailPartitionWriteGateOpen = true;
}

// Test-only: re-close the gate so a fresh test starts from the boot default.
export function closeMailPartitionWriteGateForTests(): void {
  mailPartitionWriteGateOpen = false;
}

export function assertMailPartitionWriteGateOpen(): void {
  if (!mailPartitionWriteGateOpen) {
    throw new Error(
      'mail partition write blocked: ensureSchema must confirm the mail partition marker first (see server/mail_partition_backfill.ts)',
    );
  }
}

// Minimal query surface both the pool and an in-transaction client satisfy.
export interface MailPartitionWriteClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export interface MailPartitionTransactionPool {
  connect(): Promise<MailPartitionWriteClient & { release(): void }>;
}

export async function writeMailPartitionsInTransaction(
  pool: MailPartitionTransactionPool,
  realm: string,
  partitions: readonly { recipientKey: string; letters: MailSave['mail'] }[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await writeMailPartitions(client, realm, partitions);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// The incremental autosave write (#3561): persists ONLY the given recipient
// partitions, split into at most one batched multi-row UPSERT (non-empty
// buckets) and one batched DELETE (a mailbox that emptied out: retention,
// server/CLAUDE.md "Hot paths", a `mail:<realm>:r:*` row must not survive
// forever once nothing is left in it), instead of re-serializing and
// re-writing the whole realm mailbook every 30 s. Last-write-wins de-dup by
// recipientKey is a defensive floor, not a live path today
// (MailIndex.takeDirty already returns unique keys): Postgres refuses to
// affect the same row twice in one ON CONFLICT DO UPDATE statement, so a
// future caller concatenating two drains would otherwise abort the whole
// write. An empty `partitions` array (a quiet interval with no mail
// mutations) issues no SQL at all.
//
// Known follow-up, not fixed here: no cap on how many rows land in one
// UPSERT/DELETE statement. A single dirty player action drains only a
// handful of recipients, but an unusually large drain (a mass system
// mailing, a bulk purge/rekey sweep) could in principle approach
// statement_timeout; a failed write's re-arm (mail_partition_rearm.ts) would
// then retry the SAME oversized batch and fail again. Chunking the batch
// (e.g. a few hundred partitions per statement) would close this; tracked
// as a follow-up rather than blocking #3561, since normal per-mutation
// drains are small by construction.
export async function writeMailPartitions(
  client: MailPartitionWriteClient,
  realm: string,
  partitions: readonly { recipientKey: string; letters: MailSave['mail'] }[],
): Promise<void> {
  if (partitions.length === 0) return;
  const byRecipient = new Map<string, MailSave['mail']>();
  for (const p of partitions) byRecipient.set(p.recipientKey, p.letters);

  const upsertKeys: string[] = [];
  const upsertDatas: string[] = [];
  const deleteKeys: string[] = [];
  for (const [recipientKey, letters] of byRecipient) {
    const key = mailRecipientKey(realm, recipientKey);
    if (letters.length === 0) deleteKeys.push(key);
    else {
      upsertKeys.push(key);
      upsertDatas.push(JSON.stringify({ mail: letters }));
    }
  }
  if (upsertKeys.length > 0) {
    await client.query(
      `INSERT INTO world_state (key, data, updated_at)
       SELECT k, d::jsonb, now() FROM UNNEST($1::text[], $2::text[]) AS t(k, d)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [upsertKeys, upsertDatas],
    );
  }
  if (deleteKeys.length > 0) {
    await client.query('DELETE FROM world_state WHERE key = ANY($1)', [deleteKeys]);
  }
}
