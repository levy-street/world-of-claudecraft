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
  applyOfflineCharacterSaveBounds,
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

  /**
   * Block until some OTHER backend in the verify database is parked on a
   * heavyweight lock. The mid-wait race below has to fit inside the fenced
   * write's own 2s lock bound, so a fixed sleep is the wrong tool in both
   * directions: too short and the contender has not reached its wait yet (the
   * test races nothing and passes vacuously, the exact failure family this
   * phase is cleaning up), too long and the bound fires before the race is
   * set up. Polling pg_stat_activity waits for the real state instead.
   */
  async function waitForRowLockWaiter(deadlineMs = 1_200): Promise<void> {
    const until = Date.now() + deadlineMs;
    for (;;) {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'active'
            AND wait_event_type = 'Lock'
            AND pid <> pg_backend_pid()`,
      );
      if (Number(res.rows[0].n) > 0) return;
      if (Date.now() > until) throw new Error('no backend ever parked on the row lock');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
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

    it('REFUSES a lease that commits WHILE the write is parked on a contended row', async () => {
      // THE PHASE 18 QA DATABASE REVIEW'S REPRODUCED WRITE LOSS. The unleased
      // fence's NOT EXISTS is UNCORRELATED with the row it gates (its only
      // reference is $1, never an outer column), so PostgreSQL hoists it into
      // an InitPlan and gates the whole statement on a One-Time Filter: a
      // verdict decided BEFORE the characters row lock is taken. After a lock
      // wait, EvalPlanQual re-checks only the target row's OWN columns and
      // never re-runs an InitPlan, so a lease committed during that wait was
      // invisible and the write LANDED over a now-live session. The session
      // was handed the pre-write blob at its handshake (server/ws_auth.ts), so
      // its next autosave clobbered the write while the caller had already
      // been told { ok: true } and had already committed an audit row for a
      // strip that would not survive. The fix takes the characters row lock
      // FIRST, so the lease check is evaluated with the lock already held.
      const id = await makeCharacter();
      const holder = await pool.connect();
      let raced: unknown;
      // Exactly the lock a live session's own save holds: an UPDATE of
      // non-key columns takes FOR NO KEY UPDATE, which deliberately does NOT
      // conflict with the FOR KEY SHARE a character_leases INSERT takes on its
      // FK parent. That non-conflict is what lets a login land mid-wait in
      // production, and it is what lets this test land one.
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM characters WHERE id = $1 FOR NO KEY UPDATE', [id]);
      // No lease stands yet, so the write starts admissible and parks on the row.
      const write = db
        .saveOfflineCharacterState(id, 7, STATE('raced-by-a-login'))
        .catch((err: unknown) => {
          raced = err;
          return null;
        });
      try {
        await waitForRowLockWaiter();
        // The login lands mid-wait and COMMITS its lease.
        await grantLease(id, 'login-during-the-wait', 3600);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }

      // Not a lock timeout, not a throw: an honest fence refusal.
      expect(raced).toBeUndefined();
      expect(await write).toBe(false);
      expect(await markerOf(id)).toBeUndefined();
    }, 30_000);

    it('still LANDS after waiting out a contender when no lease ever appears', async () => {
      // The other half of the pin above: taking the row lock first must not
      // turn every contended write into a refusal. Same contention, same wait,
      // no login, so the write is admitted the moment the holder lets go.
      const id = await makeCharacter();
      const holder = await pool.connect();
      let raced: unknown;
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM characters WHERE id = $1 FOR NO KEY UPDATE', [id]);
      const write = db
        .saveOfflineCharacterState(id, 7, STATE('waited-then-landed'))
        .catch((err: unknown) => {
          raced = err;
          return null;
        });
      try {
        await waitForRowLockWaiter();
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }

      expect(raced).toBeUndefined();
      expect(await write).toBe(true);
      expect(await markerOf(id)).toBe('waited-then-landed');
    }, 30_000);

    it('holds FOR UPDATE, the one mode that shuts a lease acquire out mid-write', async () => {
      // The second half of the lock-first fix, and the reason the pre-write
      // lock is FOR UPDATE rather than the FOR NO KEY UPDATE the write itself
      // takes. A character_leases INSERT takes FOR KEY SHARE on its FK parent
      // row; FOR NO KEY UPDATE does not conflict with that (which is exactly
      // how the write loss above got its lease in mid-wait), while FOR UPDATE
      // does. So while the fenced write holds its lock, no fresh lease can
      // commit at all. Both arms run here, because only the control proves the
      // stronger mode is doing the work.
      const id = await makeCharacter();
      const acquire = async (mode: string): Promise<string | undefined> => {
        const holder = await pool.connect();
        const login = await pool.connect();
        try {
          await holder.query('BEGIN');
          await holder.query(`SELECT 1 FROM characters WHERE id = $1 ${mode}`, [id]);
          await login.query('BEGIN');
          // A short bound: this asks whether the acquire is BLOCKED, not how
          // patiently it waits.
          await login.query('SET LOCAL lock_timeout = 400');
          try {
            await login.query(
              `INSERT INTO character_leases (character_id, realm, holder, nonce, expires_at)
                 VALUES ($1, $2, $3, $4, now() + make_interval(secs => 3600))
               ON CONFLICT (character_id) DO NOTHING`,
              [id, realm, db.PROCESS_LEASE_HOLDER, `probe-${mode}`],
            );
            return undefined;
          } catch (err) {
            return (err as { code?: string }).code;
          }
        } finally {
          await login.query('ROLLBACK').catch(() => {});
          await holder.query('ROLLBACK').catch(() => {});
          login.release();
          holder.release();
        }
      };

      // The control: the lock the UPDATE alone would take lets the login in.
      expect(await acquire('FOR NO KEY UPDATE')).toBeUndefined();
      // The production lock does not. That the shipped statement really asks
      // for this mode is pinned beside the bound sequence, in
      // tests/server/save_offline_character_state.test.ts.
      expect(await acquire('FOR UPDATE')).toBe('55P03');
    }, 30_000);

    it('bounds a lock ACQUISITION, never the statement (the corrected residual)', async () => {
      // The Phase 18 record said the lock bound capped the fenced write's
      // whole exposure window at two seconds. It does not: lock_timeout
      // applies per lock acquisition, so it never stops a statement that is
      // RUNNING rather than waiting, and a statement that re-acquires as its
      // tuple's holder changes gets a fresh allowance each time (the review
      // measured 2,909 ms of real wait under this same 2s bound). The bound on
      // the whole write is the STATEMENT bound. Driven through the production
      // bound applier so the figures under test are the shipped ones.
      const overLockBoundSec = (OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS + 500) / 1000;
      const startedAt = Date.now();
      await db.runWithStatementTimeout(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS, async (q) => {
        await applyOfflineCharacterSaveBounds(q);
        await q(`SELECT pg_sleep(${overLockBoundSec})`);
      });
      // It ran well past the lock bound and was not cancelled.
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS);

      // The statement bound is what actually stops it, with 57014, not 55P03.
      let code: string | undefined;
      const cancelledAt = Date.now();
      await expect(
        db
          .runWithStatementTimeout(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS, async (q) => {
            await applyOfflineCharacterSaveBounds(q);
            await q('SELECT pg_sleep(30)');
          })
          .catch((err: unknown) => {
            code = (err as { code?: string }).code;
            throw err;
          }),
      ).rejects.toThrow();
      const waited = Date.now() - cancelledAt;
      expect(code).toBe('57014');
      expect(waited).toBeGreaterThanOrEqual(
        OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS - LOCK_WAIT_SLACK_MS,
      );
    }, 30_000);
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

    it("refuses this session's save once its own lease has EXPIRED (qr-19-nonce-fence-expiry-term)", async () => {
      const id = await makeCharacter();
      await grantLease(id, 'session-a', 3600);
      expect(await db.saveCharacterState(id, 7, STATE('before-expiry'), 'session-a')).toBe(true);
      expect(await markerOf(id)).toBe('before-expiry');
      // Re-stamp the SAME holder+nonce lease as already expired (secondsFromNow
      // negative). Before the expiry qualifier the nonce fence matched on
      // holder+nonce alone and this save LANDED over a landed strip; the
      // qr-19-nonce-fence-expiry-term qualifier refuses it. Removing the
      // `AND expires_at > now()` term from the nonce arm reds this arm (the save
      // returns true and the marker becomes after-expiry).
      await grantLease(id, 'session-a', -60);
      expect(await db.saveCharacterState(id, 8, STATE('after-expiry'), 'session-a')).toBe(false);
      expect(await markerOf(id)).toBe('before-expiry');
    });

    it('nonce: REFUSES a displaced lease that lands WHILE the save is parked on the row (qr-19-live-nonce-fence-write-loss)', async () => {
      // The LIVE twin of the offline displacement race the Phase 18 QA
      // reproduced. The nonce fence's EXISTS is UNCORRELATED with the row it
      // gates, so Postgres hoists it into an InitPlan decided BEFORE the row
      // lock, and EvalPlanQual never re-runs an InitPlan after a lock wait.
      // Without the lock-first fix a takeover that rotated the nonce mid-wait was
      // invisible and session-A's autosave landed over session-B's world.
      const id = await makeCharacter();
      await grantLease(id, 'session-a', 3600);
      expect(await db.saveCharacterState(id, 5, STATE('a-owns'), 'session-a')).toBe(true);
      const holder = await pool.connect();
      let raced: unknown;
      // The lock a live save's own UPDATE takes: FOR NO KEY UPDATE does NOT
      // conflict with the FOR KEY SHARE a character_leases INSERT takes on its FK
      // parent, which is exactly how the takeover lands its lease mid-wait.
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM characters WHERE id = $1 FOR NO KEY UPDATE', [id]);
      // session-A's fenced save starts admissible (its lease still stands) and parks.
      const write = db
        .saveCharacterState(id, 6, STATE('a-clobbers-b'), 'session-a')
        .catch((err: unknown) => {
          raced = err;
          return null;
        });
      try {
        await waitForRowLockWaiter();
        // A takeover displaces the lease to session-B mid-wait (nonce rotated).
        await grantLease(id, 'session-b', 3600);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
      // Not a lock timeout, not a throw: an honest fence refusal.
      expect(raced).toBeUndefined();
      expect(await write).toBe(false);
      expect(await markerOf(id)).toBe('a-owns');
    }, 30_000);

    it('nonce: still LANDS after waiting out a contender when no takeover happens', async () => {
      // The other half of the pin above: the lock-first fix must not turn every
      // contended save into a refusal. Same contention, same wait, no takeover,
      // so session-A's save is admitted the moment the holder lets go.
      const id = await makeCharacter();
      await grantLease(id, 'session-a', 3600);
      const holder = await pool.connect();
      let raced: unknown;
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM characters WHERE id = $1 FOR NO KEY UPDATE', [id]);
      const write = db
        .saveCharacterState(id, 6, STATE('waited-then-landed'), 'session-a')
        .catch((err: unknown) => {
          raced = err;
          return null;
        });
      try {
        await waitForRowLockWaiter();
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
      expect(raced).toBeUndefined();
      expect(await write).toBe(true);
      expect(await markerOf(id)).toBe('waited-then-landed');
    }, 30_000);

    it('the unfenced arm (no nonce) still lands regardless of leases (the legacy shape)', async () => {
      const id = await makeCharacter();
      await grantLease(id, 'whoever', 3600);
      expect(await db.saveCharacterState(id, 7, STATE('unfenced'))).toBe(true);
      expect(await markerOf(id)).toBe('unfenced');
    });
  });
});
