// The post-listen CONCURRENTLY index runner, moved whole out of server/db.ts
// (the monolith ratchet). db.ts re-exports it, so server/main.ts and every pg
// suite keep importing it from './db'. The two boot bindings it reads (the
// dedicated boot client's connection and the schema advisory lock key) come
// from the leaf server/db_boot_connection.ts, never from db.ts, so the two
// modules form no import cycle.

import { validateBankLedgerBatchReceiptsKeyShape } from './bank_ledger_batch_db';
import { CONCURRENT_INDEX_MIGRATIONS } from './concurrent_indexes';
import { SCHEMA_ADVISORY_LOCK_KEY, SOURCE_WRITER_CONNECTION } from './db_boot_connection';
import { attachSchemaNoticeForwarder } from './schema_notices';

/**
 * The post-commit CONCURRENTLY index builds. Split out of ensureSchema and run
 * AFTER the realm is listening (server/main.ts), which is a deliberate change
 * of what a slow build costs.
 *
 * These cannot run inside the schema transaction (CREATE INDEX CONCURRENTLY
 * forbids it), and they serialize across realm processes on the session-level
 * form of the schema advisory lock so simultaneous boots cannot race an index
 * name. On a small table that is invisible. On a genuinely large one it is not:
 * a concurrent build is two heap scans plus a wait for every transaction that
 * could see the table, and while the first realm builds it EVERY OTHER REALM
 * blocks on that lock. Held before `listen`, a rolling restart paid that stall
 * on every realm at once and none of them served players while they waited.
 * Held after `listen`, a slow build delays the INDEX, not the realm.
 *
 * The trade this makes explicit: a realm can now briefly serve a reader whose
 * index does not exist yet, so a reader that depends on one of these must carry
 * its own bound rather than assume the index (see GUILD_BANK_LOG_TIMEOUT_MS).
 * Failure is loud and NOT fatal: every entry is idempotent and self-healing, so
 * the next boot retries, and a realm that is already serving should not be
 * killed by an index build.
 *
 * The dedicated client escapes the pool's timeouts entirely, and the session
 * `SET statement_timeout = 0` additionally overrides any database- or
 * role-level timeout an operator set server-side; it closes immediately after,
 * so nothing leaks to pooled connections.
 */
export async function runConcurrentIndexMigrations(): Promise<void> {
  // Resolved at call time, not module scope: many suites module-mock 'pg' with
  // a Pool-only factory (the ensureSchema precedent in server/db.ts).
  const { Client } = await import('pg');
  const client = new Client({ ...SOURCE_WRITER_CONNECTION });
  // The post-listen fragments report through RAISE NOTICE too; without the
  // forwarder (schema_notices.ts) node-postgres discards them.
  attachSchemaNoticeForwarder(client);
  try {
    let locked = false;
    try {
      await client.connect();
      await client.query('SET statement_timeout = 0');
      await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_ADVISORY_LOCK_KEY]);
      locked = true;
      // A prior build may have died mid-CONCURRENTLY (a deploy-watchdog restart,
      // a crash), stranding an INVALID index that IF NOT EXISTS would treat as
      // existing forever, so the reader would sequential-scan for good. Each
      // entry drops its carcass first; the list and its order live in
      // server/concurrent_indexes.ts.
      for (const migration of CONCURRENT_INDEX_MIGRATIONS) {
        const invalidIndex = await client.query(migration.checkSql);
        if ((invalidIndex.rowCount ?? 0) > 0) {
          await client.query(migration.dropSql);
        }
        await client.query(migration.createSql);
        // A replacement must be valid before its superseded index disappears.
        // If CREATE throws (including an interrupted concurrent build), this is
        // never reached and the old index keeps serving until the next boot.
        if (migration.retireSql !== undefined) {
          await client.query(migration.retireSql);
        }
      }
      // The out-of-boot half of the receipts key-shape converge, INSIDE the
      // session advisory lock: ensureSchema re-adds a drifted constraint as
      // NOT VALID so boot never scans the keep-forever table; this VALIDATE
      // (SHARE UPDATE EXCLUSIVE, inserts keep flowing) proves the rows here.
      // In-lock on purpose: a concurrently booting realm waits at the schema
      // advisory lock holding no table lock (its waiting statement still holds a
      // snapshot, which a concurrent index build waits on: DEPLOY.md, Index
      // builds), while post-unlock it would run its
      // boot DDL (IF NOT EXISTS still takes ACCESS EXCLUSIVE/SHARE locks)
      // and block mid-DDL behind the scan, freezing logins and saves. The
      // helper bounds the scan in its own SET LOCAL transaction and swallows
      // failure loudly (NOT VALID survives, next boot retries); the index
      // loop's own throw skips it for the same next-boot retry.
      await validateBankLedgerBatchReceiptsKeyShape(client);
    } finally {
      if (locked) {
        await client
          .query('SELECT pg_advisory_unlock($1)', [SCHEMA_ADVISORY_LOCK_KEY])
          .catch(() => {});
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
}
