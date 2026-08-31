// Opt-in REAL-Postgres proof for the lease-fenced character save statements
// (server/character_save_statement.ts via server/db.ts).
//
// WHY THIS FILE EXISTS. tests/server/character_save_statement.test.ts pins the
// SQL text of all three fences and tests/server/save_offline_character_state.test.ts
// pins the rowCount mapping over a MOCKED pool, so the `unleased` fence's real
// predicate, NOT EXISTS over character_leases with an expires_at qual, had
// never been evaluated by a database (the phase 13 QA final gate's one missing
// suite). This is the fence that decides whether an operator's legendary-name
// strip lands or is refused (D13-5's login-race closure), so its live
// semantics get the same REAL-schema proof the guild bank's dupe-critical SQL
// has: a live lease refuses, an expired one admits, a released one admits, and
// the nonce fence admits only the holder's own nonce.
//
// DISPOSABLE DATABASE, NEVER A SHARED ONE (the guild_bank_pg_integration
// recipe verbatim): the suite DROPs and CREATEs its own database on the server
// TEST_DATABASE_URL points at and boots the real ensureSchema() into it.
// Without TEST_DATABASE_URL the file skips green and the DB-free floor is
// unchanged.

import type { Pool as PgPool } from 'pg';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS,
  OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS,
} from '../server/offline_character_save_db';
import type { CharacterState } from '../src/sim/sim';

/** How early the lock bound may fire and still count as "waited on the lock".
 *  PostgreSQL checks lock_timeout on its own clock and the measurement here
 *  includes the round trips, so a small slack keeps the floor from flaking
 *  without letting an instant failure (a bound that never engaged) pass. */
const LOCK_WAIT_SLACK_MS = 250;

const ADMIN_URL = process.env.TEST_DATABASE_URL;
// PER-RUN NAME, a deliberate divergence from the guild_bank_pg_integration
// recipe this suite otherwise copies verbatim (the Phase 18 database review's
// B4). That recipe uses a FIXED database name and, in beforeAll,
// pg_terminate_backend's every connection to it before the DROP. With a fixed
// name that is a cross-run kill switch: two runs against the same server (a
// second worktree, a second vitest worker, a local run beside a watch) tear
// down each other's database mid-suite, and the loser fails with confusing
// connection errors that look like a real fence bug. The suffix makes the
// database this run's own, so the terminate can only ever reach connections
// this run opened, and afterAll drops it rather than leaving one named
// database per run behind. VITEST_WORKER_ID is stable per worker within a run;
// the pid covers a direct (non-vitest) invocation.
const VERIFY_DB = `wocc_character_save_verify_${process.env.VITEST_WORKER_ID ?? process.pid}`;

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load; nothing above statically
// imports a server module that BUILDS A POOL, so this assignment still points
// the module under test at the disposable database (the guild bank suite's
// ordering trick). The one static server import above is
// offline_character_save_db, which holds no pool of its own (db.ts injects the
// transaction runner), so hoisting it ahead of this line changes nothing.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

const STATE = (marker: string) =>
  ({ level: 5, marker, questLog: [], questsDone: [], inventory: [] }) as unknown as CharacterState;

describeDb('lease-fenced character saves (REAL Postgres)', () => {
  let admin: PgPool;
  let pool: PgPool;
  let db: typeof import('../server/db');
  // The OFFLINE writers behind the unleased fence (the Phase 18
  // unfenced-offline-writers item) and the refusal arm's existence probe
  // (clear-item-name-select1), imported the same deferred way.
  let characters: typeof import('../server/characters');
  let pbe: typeof import('../server/pbe_boost');
  let clearItemNameDb: typeof import('../server/clear_item_name_db');
  let logger: typeof import('../server/http/logger').logger;
  let realm: string;

  let nextSeq = 0;
  const seq = () => ++nextSeq;

  async function makeCharacter(): Promise<number> {
    const acc = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`csverify_${seq()}`],
    );
    const res = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id`,
      [Number(acc.rows[0].id), `CSVerify${seq()}`, realm],
    );
    return Number(res.rows[0].id);
  }

  async function grantLease(characterId: number, nonce: string, secondsFromNow: number) {
    await pool.query(
      `INSERT INTO character_leases (character_id, realm, holder, nonce, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
       ON CONFLICT (character_id)
       DO UPDATE SET holder = EXCLUDED.holder, nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
      [characterId, realm, db.PROCESS_LEASE_HOLDER, nonce, secondsFromNow],
    );
  }

  async function markerOf(characterId: number): Promise<string | undefined> {
    const res = await pool.query(
      `SELECT state->>'marker' AS marker FROM characters WHERE id = $1`,
      [characterId],
    );
    return res.rows[0]?.marker ?? undefined;
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../server/db');
    characters = await import('../server/characters');
    pbe = await import('../server/pbe_boost');
    clearItemNameDb = await import('../server/clear_item_name_db');
    logger = (await import('../server/http/logger')).logger;
    realm = (await import('../server/realm')).REALM;
    await db.ensureSchema();

    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 8 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    // Drop the per-run database, or the server accumulates one per run
    // (the fixed-name recipe reuses its single database instead). Best
    // effort: a failure here must never fail an otherwise green suite, and
    // the next run's beforeAll DROPs IF EXISTS anyway.
    await admin?.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`).catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  describe('the unleased fence (saveOfflineCharacterState, the D13-5 strip write)', () => {
    it('lands on a character with NO lease row at all', async () => {
      const id = await makeCharacter();
      expect(await db.saveOfflineCharacterState(id, 7, STATE('no-lease'))).toBe(true);
      expect(await markerOf(id)).toBe('no-lease');
    });

    it('REFUSES while a live lease stands, touching nothing', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'live-nonce', 3600);
      expect(await db.saveOfflineCharacterState(id, 7, STATE('must-not-land'))).toBe(false);
      expect(await markerOf(id)).toBeUndefined();
    });

    it('lands once the lease is EXPIRED (the crashed-process arm), and after a release', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'stale-nonce', -60);
      expect(await db.saveOfflineCharacterState(id, 7, STATE('expired-ok'))).toBe(true);
      expect(await markerOf(id)).toBe('expired-ok');

      const released = await makeCharacter();
      await grantLease(released, 'gone-nonce', 3600);
      await pool.query(`DELETE FROM character_leases WHERE character_id = $1`, [released]);
      expect(await db.saveOfflineCharacterState(released, 7, STATE('released-ok'))).toBe(true);
      expect(await markerOf(released)).toBe('released-ok');
    });

    it('is fenced per CHARACTER: a neighbour holding a live lease blocks only itself', async () => {
      const leased = await makeCharacter();
      const free = await makeCharacter();
      await grantLease(leased, 'live-nonce', 3600);
      expect(await db.saveOfflineCharacterState(free, 7, STATE('free-ok'))).toBe(true);
      expect(await db.saveOfflineCharacterState(leased, 7, STATE('still-blocked'))).toBe(false);
      expect(await markerOf(free)).toBe('free-ok');
      expect(await markerOf(leased)).toBeUndefined();
    });

    it('answers false, never a throw, for a character row that does not exist', async () => {
      expect(await db.saveOfflineCharacterState(999_999, 7, STATE('ghost'))).toBe(false);
    });

    it('fails FAST on a contended row: the lock bound fires, never the statement bound', async () => {
      // The Phase 18 database review's B1, proved against a real lock rather
      // than a SET LOCAL text pin. Before this the offline writer ran under
      // statement_timeout alone (at the 60s heavy tier), so a fence UPDATE
      // contending with a live session's save waited the FULL statement
      // allowance with a pooled client pinned for all of it. Now the
      // transaction carries lock_timeout 2s, so the wait ends there and the
      // caller learns it was contention (55P03), not a fence refusal or a
      // hang.
      const id = await makeCharacter();
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        // A real conflicting row lock, taken exactly the way a live save's
        // UPDATE takes it, and held open for the whole attempt.
        await holder.query('SELECT 1 FROM characters WHERE id = $1 FOR UPDATE', [id]);

        const startedAt = Date.now();
        let code: string | undefined;
        await expect(
          db.saveOfflineCharacterState(id, 7, STATE('contended')).catch((err: unknown) => {
            code = (err as { code?: string }).code;
            throw err;
          }),
        ).rejects.toThrow();
        const waited = Date.now() - startedAt;

        // lock_not_available, the lock_timeout's own SQLSTATE: not 57014
        // (statement timeout) and not a silent 0-row answer.
        expect(code).toBe('55P03');
        // It gave up at the LOCK bound, comfortably inside the statement
        // bound that used to be the only one. The floor keeps this honest:
        // an instant failure would mean it never waited on the lock at all.
        expect(waited).toBeGreaterThanOrEqual(
          OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS - LOCK_WAIT_SLACK_MS,
        );
        expect(waited).toBeLessThan(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
      // The contended attempt wrote nothing, and the row is writable again
      // the moment the holder lets go.
      expect(await markerOf(id)).toBeUndefined();
      expect(await db.saveOfflineCharacterState(id, 7, STATE('after-release'))).toBe(true);
      expect(await markerOf(id)).toBe('after-release');
    }, 30_000);

    it('REFUSES a cross-realm character id, touching nothing (the realm qualifier)', async () => {
      // The Phase 17 security review's defense-in-depth arm: the offline
      // writer takes a bare id from an admin route, so the statement itself
      // pins the row's realm instead of trusting every caller's pre-checks.
      const acc = await pool.query(
        `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
        [`csvrealm_${seq()}`],
      );
      const other = await pool.query(
        `INSERT INTO characters (account_id, name, class, realm, level, state)
           VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id`,
        [Number(acc.rows[0].id), `CSVerifyX${seq()}`, `${realm}-other`],
      );
      const id = Number(other.rows[0].id);
      expect(await db.saveOfflineCharacterState(id, 7, STATE('cross-realm'))).toBe(false);
      expect(await markerOf(id)).toBeUndefined();
    });
  });

  describe('the OFFLINE writers behind the unleased fence (the Phase 18 unfenced-offline-writers item)', () => {
    // Every offline writer in the tree rides saveOfflineCharacterState now:
    // the two signer sweeps in server/characters.ts (rename, reclaim) and the
    // PBE boost's registration-time roster save. Each is driven through its
    // REAL entry (the same function production calls) against the real
    // fence: it lands with no lease, refuses while a live lease stands
    // touching nothing, and scopes per character. A refusal follows each
    // writer's swallow-and-log contract (a logged line, never a throw).
    const SIGNED = (marker: string, signer: string) =>
      ({
        level: 5,
        marker,
        questLog: [],
        questsDone: [],
        inventory: [{ itemId: 'iron_ore', count: 1, instance: { signer } }],
      }) as unknown as CharacterState;

    async function signerOf(characterId: number): Promise<string | undefined> {
      const res = await pool.query(
        `SELECT state->'inventory'->0->'instance'->>'signer' AS signer FROM characters WHERE id = $1`,
        [characterId],
      );
      return res.rows[0]?.signer ?? undefined;
    }

    async function levelOf(characterId: number): Promise<number | undefined> {
      const res = await pool.query(`SELECT level FROM characters WHERE id = $1`, [characterId]);
      return res.rows[0] ? Number(res.rows[0].level) : undefined;
    }

    const stubBooks = () => ({
      rekeyMarketSeller: () => false,
      saveMarket: async () => {},
      rekeyMailOwner: () => false,
      saveMail: async () => {},
    });

    let consoleError: ReturnType<typeof vi.spyOn>;
    let loggerError: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('the rename own-signer sweep lands with no lease and refuses under a live one, per character', async () => {
      const free = await makeCharacter();
      const leased = await makeCharacter();
      await grantLease(leased, 'live-nonce', 3600);

      await characters.rekeyRenamedCharacterOwnSigner(
        free,
        9,
        SIGNED('rename-ok', 'Oldname'),
        'Oldname',
        'Newname',
      );
      expect(await signerOf(free)).toBe('Newname');
      expect(await markerOf(free)).toBe('rename-ok');
      expect(await levelOf(free)).toBe(9);
      expect(consoleError).not.toHaveBeenCalled();

      // The neighbour's live lease refuses ONLY the neighbour: nothing lands,
      // nothing throws, one logged line.
      await expect(
        characters.rekeyRenamedCharacterOwnSigner(
          leased,
          9,
          SIGNED('must-not-land', 'Oldname'),
          'Oldname',
          'Newname',
        ),
      ).resolves.toBeUndefined();
      expect(await signerOf(leased)).toBeUndefined();
      expect(await markerOf(leased)).toBeUndefined();
      expect(await levelOf(leased)).toBe(1);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(String(consoleError.mock.calls[0][0])).toContain('lease');
    });

    it('the reclaim holder sweep lands with no lease and refuses under a live one, per character', async () => {
      const free = await makeCharacter();
      const leased = await makeCharacter();
      await grantLease(leased, 'live-nonce', 3600);

      await characters.rekeyReclaimedCharacterWorldState(stubBooks(), {
        id: free,
        archivedName: 'Freeda',
        freedName: 'Freed',
        level: 4,
        state: SIGNED('reclaim-ok', 'Freed'),
      });
      expect(await signerOf(free)).toBe('Freeda');
      expect(await markerOf(free)).toBe('reclaim-ok');
      expect(await levelOf(free)).toBe(4);
      expect(consoleError).not.toHaveBeenCalled();

      await expect(
        characters.rekeyReclaimedCharacterWorldState(stubBooks(), {
          id: leased,
          archivedName: 'Freeda',
          freedName: 'Freed',
          level: 4,
          state: SIGNED('must-not-land', 'Freed'),
        }),
      ).resolves.toBeUndefined();
      expect(await signerOf(leased)).toBeUndefined();
      expect(await markerOf(leased)).toBeUndefined();
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(String(consoleError.mock.calls[0][0])).toContain('lease');
    });

    it('the PBE boost roster save lands the level column with no lease and refuses under a live one', async () => {
      const free = await makeCharacter();
      const leased = await makeCharacter();
      await grantLease(leased, 'live-nonce', 3600);

      await pbe.defaultBoostDeps.saveState(free, pbe.BOOST_LEVEL, STATE('boost-ok'));
      expect(await levelOf(free)).toBe(pbe.BOOST_LEVEL);
      expect(await markerOf(free)).toBe('boost-ok');
      expect(loggerError).not.toHaveBeenCalled();

      await expect(
        pbe.defaultBoostDeps.saveState(leased, pbe.BOOST_LEVEL, STATE('must-not-land')),
      ).resolves.toBeUndefined();
      expect(await levelOf(leased)).toBe(1);
      expect(await markerOf(leased)).toBeUndefined();
      expect(loggerError).toHaveBeenCalledTimes(1);
    });

    it('the writers land once the lease is EXPIRED (the crashed-process arm)', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'stale-nonce', -60);
      await characters.rekeyRenamedCharacterOwnSigner(
        id,
        9,
        SIGNED('expired-ok', 'Oldname'),
        'Oldname',
        'Newname',
      );
      expect(await signerOf(id)).toBe('Newname');
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe('the existence probe (characterStateExists, the clear-item-name refusal arm)', () => {
    // The SELECT 1 the refusal arm asks instead of re-loading the blob (the
    // Phase 18 clear-item-name-select1 item): it must answer exactly what
    // the first load (getCharacterById, id-realm) plus its state-not-null
    // qualifier answers, so a lease refusal and a vanished row can never be
    // confused in either direction.
    it('answers true for a row carrying a state on this realm', async () => {
      const id = await makeCharacter();
      expect(await clearItemNameDb.characterStateExists(id)).toBe(true);
      // A live lease does not change existence: this is what lets the
      // refusal arm read a fenced-out write as the retry line.
      await grantLease(id, 'live-nonce', 3600);
      expect(await clearItemNameDb.characterStateExists(id)).toBe(true);
    });

    it("answers false for a null-state row, a missing row, and another realm's row", async () => {
      const acc = await pool.query(
        `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
        [`csprobe_${seq()}`],
      );
      const nullState = await pool.query(
        `INSERT INTO characters (account_id, name, class, realm, level, state)
           VALUES ($1, $2, 'warrior', $3, 1, NULL) RETURNING id`,
        [Number(acc.rows[0].id), `CSProbe${seq()}`, realm],
      );
      expect(await clearItemNameDb.characterStateExists(Number(nullState.rows[0].id))).toBe(false);
      expect(await clearItemNameDb.characterStateExists(999_998)).toBe(false);
      const other = await pool.query(
        `INSERT INTO characters (account_id, name, class, realm, level, state)
           VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id`,
        [Number(acc.rows[0].id), `CSProbeX${seq()}`, `${realm}-other`],
      );
      expect(await clearItemNameDb.characterStateExists(Number(other.rows[0].id))).toBe(false);
    });
  });

  describe('the nonce fence (saveCharacterState, the live-session save)', () => {
    it('lands with the holder-and-nonce the lease carries, refuses a displaced nonce', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'session-a', 3600);
      expect(await db.saveCharacterState(id, 7, STATE('own-nonce'), 'session-a')).toBe(true);
      expect(await markerOf(id)).toBe('own-nonce');
      // A takeover replaced the nonce: the displaced session's fenced write
      // touches nothing (the zombie-overwrite closure).
      await grantLease(id, 'session-b', 3600);
      expect(await db.saveCharacterState(id, 8, STATE('zombie'), 'session-a')).toBe(false);
      expect(await markerOf(id)).toBe('own-nonce');
    });

    it('the unfenced arm (no nonce) still lands regardless of leases (the legacy shape)', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'whoever', 3600);
      expect(await db.saveCharacterState(id, 7, STATE('unfenced'))).toBe(true);
      expect(await markerOf(id)).toBe('unfenced');
    });
  });
});
