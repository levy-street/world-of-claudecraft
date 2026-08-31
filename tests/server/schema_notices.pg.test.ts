// Real-pg proof for the notice filter's routine names. Hand-built notice
// objects cannot catch a wrong routine name (a typo'd SKIP_NOTICE_ROUTINES
// entry stays green against fakes forever), so this suite drives the actual
// idempotent DDL shapes the boot emits through a Client with the forwarder
// attached and asserts nothing reaches the boot log, then proves the
// fail-open side with a real plpgsql RAISE (the positive control that the
// rig actually surfaces notices at all). Notices arrive on the protocol
// stream BEFORE their query's completion, so each awaited query has already
// delivered its notices when the assertion runs.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { attachSchemaNoticeForwarder } from '../../server/schema_notices';

const url = process.env.TEST_DATABASE_URL ?? '';
const d = url === '' ? describe.skip : describe;

// A private scratch schema, the repo idiom for database-gated suites, so the
// probe table can never collide with (or damage) a database that already
// carries the game schema.
const SCHEMA = 'schema_notices_pg_test';

d('schema notice forwarder against real PostgreSQL', () => {
  let client: import('pg').Client;

  beforeAll(async () => {
    const { Client } = await import('pg');
    client = new Client({ connectionString: url });
    attachSchemaNoticeForwarder(client);
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET search_path = ${SCHEMA}`);
  }, 30_000);

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await client.end().catch(() => {});
  });

  it('forwards nothing for the real idempotent-DDL skip shapes, DROP CONSTRAINT IF EXISTS included', async () => {
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await client.query('CREATE TABLE IF NOT EXISTS notice_probe (id INT PRIMARY KEY)');
      // The already-exists family (42P07 / 42701).
      await client.query('CREATE TABLE IF NOT EXISTS notice_probe (id INT PRIMARY KEY)');
      await client.query('ALTER TABLE notice_probe ADD COLUMN IF NOT EXISTS id INT');
      await client.query('CREATE INDEX IF NOT EXISTS notice_probe_id ON notice_probe (id)');
      await client.query('CREATE INDEX IF NOT EXISTS notice_probe_id ON notice_probe (id)');
      // The does-not-exist drop-skip family (SQLSTATE 00000, routine-keyed).
      await client.query('DROP INDEX IF EXISTS notice_probe_missing');
      await client.query('DROP TRIGGER IF EXISTS notice_probe_missing ON notice_probe');
      // The boot DDL's DROP CONSTRAINT IF EXISTS shape (server/social_db.ts
      // twice, server/player_metrics_db.ts once): SQLSTATE 00000, routine
      // ATExecDropConstraint. Before that routine joined the skip set, three
      // of these noise lines survived per boot per realm.
      await client.query('ALTER TABLE notice_probe DROP CONSTRAINT IF EXISTS notice_probe_missing');
      expect(warns).not.toHaveBeenCalled();
    } finally {
      warns.mockRestore();
    }
  });

  it('still forwards a real plpgsql RAISE NOTICE report (the rig sees notices at all)', async () => {
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await client.query("DO $$ BEGIN RAISE NOTICE 'schema-notices-pg-probe'; END $$");
      expect(warns).toHaveBeenCalledTimes(1);
      expect(String(warns.mock.calls[0][0])).toBe('[schema] schema-notices-pg-probe');
    } finally {
      warns.mockRestore();
    }
  });
});
