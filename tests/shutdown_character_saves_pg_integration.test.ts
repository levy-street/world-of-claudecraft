// Opt-in real PostgreSQL proof of GameServer's shutdown persistence barrier.
// TEST_DATABASE_URL must name a disposable local server with CREATE DATABASE.
// This suite creates a unique database and never boots external integrations.
// main.ts signal composition is pinned separately in shutdown_lifecycle.test.ts.
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GameServer } from '../server/game';
import { materialSourceConnection } from '../server/material_source_connection';
import { createShutdownHandler } from '../server/shutdown_lifecycle';

const adminUrl = process.env.TEST_DATABASE_URL;
const database = `shutdown_verify_${randomUUID().replaceAll('-', '')}`;
const describeDb = adminUrl ? describe : describe.skip;

describeDb('shutdown character persistence (real PostgreSQL)', () => {
  let admin: Pool;
  let fixture: Pool;
  let db: typeof import('../server/db');
  let Game: typeof GameServer;
  let realm: string;
  let sequence = 0;

  beforeAll(async () => {
    const url = new URL(adminUrl as string);
    url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.toString();
    admin = new Pool({ connectionString: adminUrl, max: 2 });
    await admin.query(`CREATE DATABASE ${database}`);
    db = await import('../server/db');
    await db.ensureSchema();
    fixture = new Pool({ ...materialSourceConnection(url.toString()), max: 3 });
    Game = (await import('../server/game')).GameServer;
    realm = (await import('../server/realm')).REALM;
  }, 120_000);

  afterAll(async () => {
    await db?.pool.end();
    await fixture?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin?.end();
  }, 30_000);

  async function player() {
    const name = `Shutdown${++sequence}`;
    const account = await fixture.query(
      "INSERT INTO accounts (username, password_hash) VALUES ($1, 'fixture') RETURNING id",
      [name],
    );
    const accountId = Number(account.rows[0].id);
    const row = await fixture.query(
      "INSERT INTO characters (account_id, name, class, realm, level, state) VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id",
      [accountId, name, realm],
    );
    const id = Number(row.rows[0].id);
    const nonce = randomUUID();
    expect(await db.acquireCharacterLease(id, accountId, nonce)).toBe(true);
    const game = new Game();
    const joined = game.join(
      { readyState: 1, send: vi.fn(), close: vi.fn() } as any,
      accountId,
      id,
      name,
      'warrior',
      null,
      false,
      { leaseNonce: nonce },
    );
    if ('error' in joined) throw new Error(joined.error);
    joined.blockListLoaded = true;
    game.sim.meta(joined.pid)!.copper = 1200;
    expect(await game.saveCharacter(joined)).toBe(true);
    game.sim.meta(joined.pid)!.copper = 1277;
    return { game, session: joined, id };
  }

  async function durable(id: number) {
    const result = await fixture.query(
      "SELECT (state->>'copper')::int AS copper, EXISTS (SELECT 1 FROM character_leases WHERE character_id = $1) AS leased FROM characters WHERE id = $1",
      [id],
    );
    return result.rows[0] as { copper: number; leased: boolean };
  }

  async function lockCharacter(id: number): Promise<PoolClient> {
    const lock = await fixture.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM characters WHERE id = $1 FOR UPDATE', [id]);
    return lock;
  }

  async function waitForBlockedSave(pattern = '%characters%') {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const result = await fixture.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1",
        [pattern],
      );
      if (result.rows[0].n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('save never reached its PostgreSQL row lock');
  }

  function shutdown(game: GameServer) {
    const releaseAll = vi.fn(() => db.releaseAllCharacterLeases());
    // The pool-close seam is observed so subsequent cases can reuse this pool.
    const closePool = vi.fn();
    const failed = vi.fn();
    const signal = createShutdownHandler(async () => {
      game.beginShutdown();
      await game.stop();
      await game.saveForShutdown();
      await releaseAll();
      closePool();
    }, failed);
    return { signal, releaseAll, closePool, failed };
  }

  it('commits a blocked departure before allowing global lease and pool teardown', async () => {
    const { game, session, id } = await player();
    const lock = await lockCharacter(id);
    const departure = game.leave(session, 'logout');
    const drain = shutdown(game);
    try {
      await waitForBlockedSave();
      const first = drain.signal();
      expect(drain.signal()).toBe(first);
      expect(await durable(id)).toEqual({ copper: 1200, leased: true });
      expect(drain.releaseAll).not.toHaveBeenCalled();
      expect(drain.closePool).not.toHaveBeenCalled();
      await lock.query('ROLLBACK');
      await Promise.all([departure, first]);
      expect(await durable(id)).toEqual({ copper: 1277, leased: false });
      expect(drain.releaseAll).toHaveBeenCalledTimes(1);
      expect(drain.closePool).toHaveBeenCalledTimes(1);
      expect(drain.failed).not.toHaveBeenCalled();
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await departure;
    }
  }, 30_000);

  it('reports a real rejected connected save without successful teardown', async () => {
    const { game, id } = await player();
    if (!Number.isSafeInteger(id)) throw new Error('invalid fixture id');
    await fixture.query(
      `CREATE FUNCTION reject_shutdown_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = ${id} THEN RAISE EXCEPTION 'shutdown fixture write rejected'; END IF; RETURN NEW; END $$`,
    );
    await fixture.query(
      'CREATE TRIGGER shutdown_save_rejection BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION reject_shutdown_save()',
    );
    try {
      const drain = shutdown(game);
      await drain.signal();
      expect(drain.failed).toHaveBeenCalledTimes(1);
      expect(drain.releaseAll).not.toHaveBeenCalled();
      expect(drain.closePool).not.toHaveBeenCalled();
      expect(await durable(id)).toEqual({ copper: 1200, leased: true });
    } finally {
      await fixture.query('DROP TRIGGER shutdown_save_rejection ON characters');
      await fixture.query('DROP FUNCTION reject_shutdown_save()');
    }
  }, 30_000);

  it('times out without cancelling a save or resuming global teardown after its late commit', async () => {
    const { game, session, id } = await player();
    const lock = await fixture.connect();
    const writer = await fixture.connect();
    await lock.query('SELECT pg_advisory_lock(91007)');
    // Hold an existing FIFO job at a real database wait. The departure's final
    // transaction queues behind it, without changing production save timeouts.
    const blockedWrite = game.enqueueCharacterWrite(id, async () => {
      await writer.query('SELECT pg_advisory_xact_lock(91007)');
    });
    const departure = game.leave(session, 'logout');
    const drain = shutdown(game);
    try {
      await waitForBlockedSave('%pg_advisory_xact_lock%');
      const started = performance.now();
      await drain.signal();
      const elapsed = performance.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(19_900);
      expect(elapsed).toBeLessThan(25_000);
      expect(drain.failed).toHaveBeenCalledTimes(1);
      expect(await durable(id)).toEqual({ copper: 1200, leased: true });
      expect(drain.releaseAll).not.toHaveBeenCalled();
      expect(drain.closePool).not.toHaveBeenCalled();
      await lock.query('SELECT pg_advisory_unlock(91007)');
      await departure;
      expect(await durable(id)).toEqual({ copper: 1277, leased: false });
      await drain.signal();
      expect(drain.releaseAll).not.toHaveBeenCalled();
      expect(drain.closePool).not.toHaveBeenCalled();
      console.log(
        `shutdown departure timeout verified after ${Math.round(elapsed)}ms; late commit preserved 1277 copper`,
      );
    } finally {
      await lock.query('SELECT pg_advisory_unlock(91007)');
      lock.release();
      await blockedWrite;
      writer.release();
      await departure;
    }
  }, 40_000);
});
