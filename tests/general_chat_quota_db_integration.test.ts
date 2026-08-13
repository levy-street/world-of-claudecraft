// Opt-in PostgreSQL 16 proof for the cross-realm General quota. The default
// suite stays DB-free; set TEST_DATABASE_URL to a disposable database. This
// file creates an isolated schema and points the production Pool/Client at it
// through libpq's per-connection search_path option.

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'general_chat_quota_integration_test';
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

let scopedUrl = '';
let db: typeof import('../server/db');
let quota: typeof import('../server/general_chat_quota_db');

async function bootstrapQuery(sql: string): Promise<void> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function notificationCollector() {
  const client = new Client({ connectionString: scopedUrl });
  const notifications: string[] = [];
  client.on('notification', (message) => notifications.push(message.payload ?? ''));
  return {
    notifications,
    async start() {
      await client.connect();
      await client.query(`LISTEN general_chat_quota_changed`);
    },
    async stop() {
      await client.end();
    },
  };
}

describeDb('General chat quota (real PostgreSQL)', () => {
  beforeAll(async () => {
    await bootstrapQuery(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`);
    const url = new URL(TEST_DATABASE_URL!);
    url.searchParams.set('options', `-csearch_path=${SCHEMA}`);
    scopedUrl = url.toString();
    process.env.DATABASE_URL = scopedUrl;
    quota = await import('../server/general_chat_quota_db');
    db = await import('../server/db');
    await db.pool.query(`
      CREATE TABLE accounts (id INT PRIMARY KEY);
      CREATE TABLE account_moderation_actions (
        id BIGSERIAL PRIMARY KEY,
        account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ
      );
    `);
    await db.pool.query(quota.GENERAL_CHAT_QUOTA_SCHEMA);
  });

  beforeEach(async () => {
    await db.pool.query(`
      DROP TRIGGER IF EXISTS quota_deferred_failure ON account_general_chat_rate_limits;
      DROP FUNCTION IF EXISTS quota_deferred_failure();
      DROP TRIGGER IF EXISTS quota_denied_update_failure ON account_general_chat_rate_limits;
      DROP FUNCTION IF EXISTS quota_denied_update_failure();
      TRUNCATE account_moderation_actions, account_general_chat_rate_limits, accounts RESTART IDENTITY CASCADE;
      INSERT INTO accounts (id) VALUES (1), (2), (3);
    `);
  });

  afterAll(async () => {
    if (quota) await quota.closeGeneralChatQuotaPool();
    if (db) await db.pool.end();
    if (TEST_DATABASE_URL) await bootstrapQuery(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  });

  it('admits exactly X, denies X+1 without mutating the row, and expires on database time', async () => {
    await expect(quota.consumeGeneralChatQuota(1)).resolves.toEqual({ status: 'unlimited' });
    await quota.setGeneralChatRateLimit({
      accountId: 1,
      adminAccountId: 2,
      rateLimit: { messages: 2, windowMinutes: 1 },
      reason: 'integration limit',
    });

    await expect(quota.consumeGeneralChatQuota(1)).resolves.toEqual({ status: 'allowed' });
    await expect(quota.consumeGeneralChatQuota(1)).resolves.toEqual({ status: 'allowed' });
    await db.pool.query(`
      CREATE FUNCTION quota_denied_update_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'denied quota attempted a tuple update';
      END $$;
      CREATE TRIGGER quota_denied_update_failure
        BEFORE UPDATE ON account_general_chat_rate_limits
        FOR EACH ROW EXECUTE FUNCTION quota_denied_update_failure();
    `);
    const denied = await quota.consumeGeneralChatQuota(1);
    expect(denied).toMatchObject({ status: 'denied' });
    if (denied.status === 'denied') expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(
      await db.pool.query(
        `SELECT message_count FROM account_general_chat_rate_limits WHERE account_id = 1`,
      ),
    ).toMatchObject({ rows: [{ message_count: 2 }] });
    await db.pool.query(`
      DROP TRIGGER quota_denied_update_failure ON account_general_chat_rate_limits;
      DROP FUNCTION quota_denied_update_failure();
    `);

    await db.pool.query(
      `UPDATE account_general_chat_rate_limits
          SET window_started_at = statement_timestamp() - interval '2 minutes'
        WHERE account_id = 1`,
    );
    await expect(quota.consumeGeneralChatQuota(1)).resolves.toEqual({ status: 'allowed' });
    expect(
      await db.pool.query(
        `SELECT message_count FROM account_general_chat_rate_limits WHERE account_id = 1`,
      ),
    ).toMatchObject({ rows: [{ message_count: 1 }] });
  });

  it('sets, idempotently reuses, and clears with one audit and post-commit notification each', async () => {
    const listener = notificationCollector();
    await listener.start();
    try {
      const policy = { messages: 3, windowMinutes: 5 };
      await expect(
        quota.setGeneralChatRateLimit({
          accountId: 1,
          adminAccountId: 2,
          rateLimit: policy,
          reason: 'set policy',
        }),
      ).resolves.toMatchObject({ before: null, after: policy, changed: true });
      await vi.waitFor(() => expect(listener.notifications).toHaveLength(1));
      expect(JSON.parse(listener.notifications[0])).toEqual({ accountId: 1 });

      await expect(
        quota.setGeneralChatRateLimit({
          accountId: 1,
          adminAccountId: 2,
          rateLimit: policy,
          reason: 'same policy',
        }),
      ).resolves.toMatchObject({ before: policy, after: policy, changed: false });
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(listener.notifications).toHaveLength(1);
      expect(
        await db.pool.query(`SELECT count(*)::int AS count FROM account_moderation_actions`),
      ).toMatchObject({ rows: [{ count: 1 }] });

      await expect(
        quota.setGeneralChatRateLimit({
          accountId: 1,
          adminAccountId: 2,
          rateLimit: null,
          reason: 'clear policy',
        }),
      ).resolves.toMatchObject({ before: policy, after: null, changed: true });
      await vi.waitFor(() => expect(listener.notifications).toHaveLength(2));
      await expect(quota.generalChatRateLimitForAccount(1)).resolves.toBeNull();
      expect(
        await db.pool.query(`SELECT count(*)::int AS count FROM account_moderation_actions`),
      ).toMatchObject({ rows: [{ count: 2 }] });
    } finally {
      await listener.stop();
    }
  });

  it('serializes concurrent realms and suppresses durable state and NOTIFY on commit rollback', async () => {
    const listener = notificationCollector();
    await listener.start();
    try {
      const policy = { messages: 1, windowMinutes: 1 };
      const setters = await Promise.all([
        quota.setGeneralChatRateLimit({
          accountId: 1,
          adminAccountId: 2,
          rateLimit: policy,
          reason: 'concurrent policy',
        }),
        quota.setGeneralChatRateLimit({
          accountId: 1,
          adminAccountId: 2,
          rateLimit: policy,
          reason: 'concurrent policy',
        }),
      ]);
      expect(setters.map((result) => result.changed).sort()).toEqual([false, true]);
      await vi.waitFor(() => expect(listener.notifications).toHaveLength(1));
      expect(
        await db.pool.query(`SELECT count(*)::int AS count FROM account_moderation_actions`),
      ).toMatchObject({ rows: [{ count: 1 }] });

      const consumes = await Promise.all([
        quota.consumeGeneralChatQuota(1),
        quota.consumeGeneralChatQuota(1),
      ]);
      expect(consumes.filter((result) => result.status === 'allowed')).toHaveLength(1);
      const concurrentDenied = consumes.find((result) => result.status === 'denied');
      expect(concurrentDenied).toMatchObject({ status: 'denied' });
      if (concurrentDenied?.status === 'denied') {
        // The denied statement must read the post-lock window, not its stale
        // pre-wait snapshot (which would collapse this to the 1-second fallback).
        expect(concurrentDenied.retryAfterSeconds).toBeGreaterThan(30);
      }

      await db.pool.query(`
        CREATE FUNCTION quota_deferred_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced deferred quota failure';
        END $$;
        CREATE CONSTRAINT TRIGGER quota_deferred_failure
          AFTER UPDATE ON account_general_chat_rate_limits
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW EXECUTE FUNCTION quota_deferred_failure();
      `);
      await expect(
        quota.setGeneralChatRateLimit({
          accountId: 1,
          adminAccountId: 2,
          rateLimit: { messages: 2, windowMinutes: 2 },
          reason: 'must roll back',
        }),
      ).rejects.toThrow('forced deferred quota failure');
      await new Promise((resolve) => setTimeout(resolve, 75));

      await expect(quota.generalChatRateLimitForAccount(1)).resolves.toEqual(policy);
      expect(listener.notifications).toHaveLength(1);
      expect(
        await db.pool.query(`SELECT count(*)::int AS count FROM account_moderation_actions`),
      ).toMatchObject({ rows: [{ count: 1 }] });
    } finally {
      await listener.stop();
    }
  });

  it('allows reciprocal staff-target policy edits without a foreign-key deadlock', async () => {
    const edits = await Promise.all([
      quota.setGeneralChatRateLimit({
        accountId: 1,
        adminAccountId: 2,
        rateLimit: { messages: 2, windowMinutes: 3 },
        reason: 'first reciprocal edit',
      }),
      quota.setGeneralChatRateLimit({
        accountId: 2,
        adminAccountId: 1,
        rateLimit: { messages: 4, windowMinutes: 5 },
        reason: 'second reciprocal edit',
      }),
    ]);
    expect(edits.every((edit) => edit.changed)).toBe(true);
    expect(
      await db.pool.query(
        `SELECT account_id, admin_account_id
         FROM account_moderation_actions
         ORDER BY account_id`,
      ),
    ).toMatchObject({
      rows: [
        { account_id: 1, admin_account_id: 2 },
        { account_id: 2, admin_account_id: 1 },
      ],
    });
  });
});
