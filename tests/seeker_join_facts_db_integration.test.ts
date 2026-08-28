// Opt-in real-Postgres coverage for the fresh-join account facts read since it
// spans two schema modules: bankBonusFactsForAccount (server/db.ts) now probes
// seeker_entitlement_claims (server/seeker_entitlement_db.ts) for the Seeker
// promotional mount grant, and a probe that does not resolve would fail EVERY
// login, not just the Seeker feature. The default suite stays DB-free; set
// TEST_DATABASE_URL to run it (it skips green without one). The DDL below is
// the production statements in the order ensureSchema applies them.

import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'seeker_join_facts_integration_test';
const REALM = 'SeekerFactsRealm';
const describeDb = DB_URL ? describe : describe.skip;

type Db = typeof import('../server/db');

function planIndexNames(plan: Record<string, unknown>): string[] {
  const names: string[] = [];
  const visit = (node: Record<string, unknown>): void => {
    if (typeof node['Index Name'] === 'string') names.push(node['Index Name']);
    const children = Array.isArray(node.Plans) ? node.Plans : [];
    for (const child of children) {
      if (child && typeof child === 'object') visit(child as Record<string, unknown>);
    }
  };
  visit(plan);
  return names;
}

describeDb('fresh-join account facts with the Seeker claim probe (real Postgres)', () => {
  let bootstrap: Pool;
  let db: Db;
  let dbPool: Pool;
  const accountIds = new Map<string, number>();

  async function seedAccount(client: PoolClient, username: string): Promise<number> {
    const inserted = await client.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'hash') RETURNING id`,
      [username],
    );
    const id = Number(inserted.rows[0].id);
    accountIds.set(username, id);
    return id;
  }

  function accountId(username: string): number {
    const id = accountIds.get(username);
    if (id === undefined) throw new Error(`account "${username}" was not seeded`);
    return id;
  }

  beforeAll(async () => {
    bootstrap = new Pool({
      connectionString: DB_URL,
      max: 2,
      options: `-c search_path=${SCHEMA}`,
    });
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await bootstrap.query(`CREATE SCHEMA ${SCHEMA}`);

    // server/db.ts reads DATABASE_URL (and server/realm.ts REALM_NAME) at IMPORT
    // time, so both are pinned before the dynamic import; process.loadEnvFile
    // never overwrites a set key, so a developer's .env cannot redirect this
    // suite at the real database.
    process.env.DATABASE_URL = `${DB_URL}?options=-c%20search_path%3D${SCHEMA}`;
    process.env.REALM_NAME = REALM;
    // Every module below imports ./db, so none may be a static import above:
    // a static import would evaluate db.ts (and build its pool) before this
    // line, against whatever DATABASE_URL the runner started with.
    db = await import('../server/db');
    const { DISCORD_SCHEMA } = await import('../server/discord_db');
    const { SEEKER_ENTITLEMENT_SCHEMA } = await import('../server/seeker_entitlement_db');
    dbPool = db.pool as unknown as Pool;

    const client = await bootstrap.connect();
    try {
      // The same modules, in the same order, as ensureSchema's boot sequence:
      // the core schema (accounts, characters, wallet_links, referrals), the
      // Discord module (discord_links), then the Seeker claim ledger.
      await client.query(db.SCHEMA);
      await client.query(DISCORD_SCHEMA);
      await client.query(SEEKER_ENTITLEMENT_SCHEMA);
      const claimant = await seedAccount(client, 'claimant');
      await seedAccount(client, 'bystander');
      await client.query(
        `INSERT INTO seeker_entitlement_claims (mint, account_id, claimant_wallet, proof_version)
         VALUES ('mint-integration-a', $1, 'wallet-a', 'sgt-v1')`,
        [claimant],
      );
    } finally {
      client.release();
    }
  }, 120_000);

  afterAll(async () => {
    if (dbPool) await dbPool.end();
    if (!bootstrap) return;
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await bootstrap.end();
  });

  it('resolves against the real DDL and reads the claim as the seekerEntitled fact', async () => {
    const entitled = await db.bankBonusFactsForAccount(accountId('claimant'));
    expect(entitled.seekerEntitled).toBe(true);
    // The bank facts still come back alongside it (one round trip, one row).
    expect(entitled.characterCount).toBe(0);
    expect(entitled.walletLinked).toBe(false);

    const plain = await db.bankBonusFactsForAccount(accountId('bystander'));
    expect(plain.seekerEntitled).toBe(false);

    // A missing account keeps the all-false shape, seekerEntitled included.
    const missing = await db.bankBonusFactsForAccount(999_999);
    expect(missing).toEqual({
      emailVerified: false,
      discordLinked: false,
      walletLinked: false,
      qualifiedReferrals: 0,
      characterCount: 0,
      seekerEntitled: false,
    });
  });

  it('answers the claim probe off the UNIQUE (account_id) index, never a sequential scan', async () => {
    const client = await bootstrap.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
      const explained = await client.query(
        `EXPLAIN (FORMAT JSON)
         SELECT EXISTS(SELECT 1 FROM seeker_entitlement_claims sc WHERE sc.account_id = $1)`,
        [accountId('claimant')],
      );
      const root = explained.rows[0]['QUERY PLAN'][0].Plan as Record<string, unknown>;
      expect(planIndexNames(root)).toContain('seeker_entitlement_claims_account_id_key');
      expect(JSON.stringify(root)).not.toContain('"Seq Scan"');
    } finally {
      client.release();
    }
  });
});
