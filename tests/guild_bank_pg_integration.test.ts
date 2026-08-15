// Opt-in REAL-Postgres proof for the guild bank's dupe-critical SQL.
//
// WHY THIS FILE EXISTS. Every other guild bank persistence suite
// (tests/guild_bank_db.test.ts, guild_bank_persistence.test.ts,
// audit_conc_guild_bank.test.ts, audit_conservation_property.test.ts) mocks
// server/db with an in-memory store that honours the lease fence. Those pin the
// PROTOCOL above the SQL: which statements run, in what order, and what the
// caller does with the result. They cannot prove the SQL itself, because there
// is no transaction to roll back, no row lock to contend for, no foreign key to
// cascade, and no planner. The duplication audit recorded exactly that gap.
// This suite closes it by driving the REAL exported functions against a REAL
// PostgreSQL 16 server with the REAL boot schema.
//
// DISPOSABLE DATABASE, NEVER A SHARED ONE. The suite DROPs and CREATEs its own
// database (VERIFY_DB below) on the server TEST_DATABASE_URL points at,
// and refuses to run if that name would collide with the URL's own database.
// It boots the real ensureSchema() into it, so every statement under test runs
// against production's columns, defaults, constraints, and indexes.
//
// Gated on TEST_DATABASE_URL like every other *_integration.test.ts: without it
// the file skips green and CI's DB-free floor is unchanged.

import type { Pool as PgPool, PoolClient } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GuildBankOpDelta } from '../src/sim/guild_bank';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_guild_bank_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load and builds its pool from it.
// Nothing above is a static import of a server module, so this assignment runs
// first and points the module under test at the disposable database. The same
// ordering trick tests/play_session_retention_integration.test.ts uses.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

// Deltas are the escrow payload: one session's OWN unflushed book ops. Helpers
// so each case reads as the movement it is testing rather than as field noise.
function goldDelta(op: 'deposit_gold' | 'withdraw_gold', copper: number): GuildBankOpDelta {
  return {
    op,
    itemId: null,
    count: null,
    instance: null,
    copperDelta: op === 'deposit_gold' ? copper : -copper,
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 0,
  };
}

function itemDelta(op: 'deposit' | 'withdraw', itemId: string, count: number): GuildBankOpDelta {
  return {
    op,
    itemId,
    count,
    instance: null,
    copperDelta: 0,
    purchasedSlotsBefore: 24,
    purchasedSlotsAfter: 24,
  };
}

const CHAR_STATE = (marker: string) =>
  ({ level: 5, marker, questLog: [], questsDone: [], inventory: [] }) as never;

describeDb('guild bank persistence (REAL Postgres)', () => {
  let admin: PgPool;
  let pool: PgPool;
  let db: typeof import('../server/db');
  let bankState: typeof import('../server/guild_bank_state');
  let social: typeof import('../server/social');
  let socialDb: typeof import('../server/social_db');
  let realm: string;

  // Monotonic fixture ids so cases never collide on a shared database.
  let nextSeq = 0;
  const seq = () => ++nextSeq;

  async function makeAccount(): Promise<number> {
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`gbverify_${seq()}`],
    );
    return Number(res.rows[0].id);
  }

  async function makeCharacter(accountId: number): Promise<number> {
    const res = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 1, '{}'::jsonb) RETURNING id`,
      [accountId, `GBVerify${seq()}`, realm],
    );
    return Number(res.rows[0].id);
  }

  // A real character_leases row, so the fenced UPDATE in characterUpdateStatement
  // has something to match (and something to MISS when handed a stale nonce).
  async function grantLease(characterId: number, nonce: string): Promise<void> {
    await pool.query(
      `INSERT INTO character_leases (character_id, realm, holder, nonce, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 hour')
       ON CONFLICT (character_id) DO UPDATE SET holder = EXCLUDED.holder, nonce = EXCLUDED.nonce`,
      [characterId, realm, db.PROCESS_LEASE_HOLDER, nonce],
    );
  }

  async function makeGuild(name?: string): Promise<number> {
    const res = await pool.query(`INSERT INTO guilds (name, realm) VALUES ($1, $2) RETURNING id`, [
      name ?? `GBVerifyGuild${seq()}`,
      realm,
    ]);
    return Number(res.rows[0].id);
  }

  async function bookOf(guildId: number): Promise<Record<string, unknown> | null> {
    const res = await pool.query('SELECT data FROM guild_banks WHERE guild_id = $1', [guildId]);
    return res.rows[0] ? (res.rows[0].data as Record<string, unknown>) : null;
  }

  async function characterRow(id: number): Promise<{ level: number; marker: unknown }> {
    const res = await pool.query('SELECT level, state FROM characters WHERE id = $1', [id]);
    return {
      level: Number(res.rows[0].level),
      marker: (res.rows[0].state as { marker?: unknown } | null)?.marker ?? null,
    };
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    // Never drop the database the caller pointed us at.
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../server/db');
    bankState = await import('../server/guild_bank_state');
    social = await import('../server/social');
    socialDb = await import('../server/social_db');
    realm = (await import('../server/realm')).REALM;

    // The REAL boot path: every table, column, default, constraint and index
    // the server actually creates, plus the post-listen CONCURRENTLY builds.
    await db.ensureSchema();
    await db.runConcurrentIndexMigrations();

    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 12 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  // -------------------------------------------------------------------------
  // 1. The escrow transaction, end to end, with real transaction semantics.
  // -------------------------------------------------------------------------
  describe('the escrow transaction commits or rolls back BOTH halves', () => {
    it('commits the character half and the book half together', async () => {
      const acct = await makeAccount();
      const charId = await makeCharacter(acct);
      const guildId = await makeGuild();
      await grantLease(charId, 'nonce-ok');

      const results: import('../server/db').GuildBankWriteResult[] = [];
      const ok = await db.saveCharacterAndGuildBankState(
        charId,
        7,
        CHAR_STATE('committed'),
        [
          {
            guildId,
            deltas: [goldDelta('deposit_gold', 500), itemDelta('deposit', 'wolf_fang', 3)],
          },
        ],
        'nonce-ok',
        results,
      );

      expect(ok).toBe(true);
      expect(results).toEqual([{ guildId, written: true, deficit: null, rowUnusable: false }]);

      // Character half: durable.
      expect(await characterRow(charId)).toEqual({ level: 7, marker: 'committed' });
      // Book half: durable, in the SAME row the boot read will load.
      const book = await bookOf(guildId);
      expect(book).toMatchObject({ treasury: 500 });
      expect((book as { inventory: { itemId: string; count: number }[] }).inventory).toEqual([
        { itemId: 'wolf_fang', count: 3 },
      ]);
    });

    it('rolls BOTH halves back when the lease fence misses', async () => {
      const acct = await makeAccount();
      const charId = await makeCharacter(acct);
      const guildId = await makeGuild();
      await grantLease(charId, 'nonce-live');

      // A committed baseline both halves must be found at after the fence miss.
      await db.saveCharacterAndGuildBankState(
        charId,
        3,
        CHAR_STATE('baseline'),
        [{ guildId, deltas: [goldDelta('deposit_gold', 250)] }],
        'nonce-live',
      );
      expect(await characterRow(charId)).toEqual({ level: 3, marker: 'baseline' });
      expect(await bookOf(guildId)).toMatchObject({ treasury: 250 });

      // The displaced session: its nonce was rotated out by a takeover. The
      // fenced UPDATE matches no row, so the transaction must ROLL BACK before
      // the guild_banks row is touched OR locked.
      const displaced = await db.saveCharacterAndGuildBankState(
        charId,
        99,
        CHAR_STATE('displaced'),
        [{ guildId, deltas: [goldDelta('deposit_gold', 1_000_000)] }],
        'nonce-stale',
      );

      expect(displaced).toBe(false);
      // Neither half moved. This is the invariant the whole feature rests on:
      // "if the book half cannot be applied, the character half must not commit"
      // and its mirror, "if the character half is fenced out, the book half must
      // not commit either".
      expect(await characterRow(charId)).toEqual({ level: 3, marker: 'baseline' });
      expect(await bookOf(guildId)).toMatchObject({ treasury: 250 });
    });

    it('rolls the CHARACTER half back when a book half is refused (real deficit)', async () => {
      const acct = await makeAccount();
      const charId = await makeCharacter(acct);
      const guildId = await makeGuild();
      await grantLease(charId, 'nonce-deficit');

      await db.saveCharacterAndGuildBankState(
        charId,
        4,
        CHAR_STATE('before-deficit'),
        [{ guildId, deltas: [goldDelta('deposit_gold', 100)] }],
        'nonce-deficit',
      );

      // This session consumed value durable truth never held (another officer's
      // deposit is not durable). The merge refuses, writeGuildBankRows aborts
      // the transaction, and the character UPDATE that already SUCCEEDED inside
      // it must be undone by the real ROLLBACK.
      let refused: unknown = null;
      await db
        .saveCharacterAndGuildBankState(
          charId,
          50,
          CHAR_STATE('after-deficit'),
          [{ guildId, deltas: [goldDelta('withdraw_gold', 5000)] }],
          'nonce-deficit',
        )
        .catch((err) => {
          refused = err;
        });

      expect(refused).toBeInstanceOf(bankState.GuildBankEscrowRefused);
      expect(await characterRow(charId)).toEqual({ level: 4, marker: 'before-deficit' });
      expect(await bookOf(guildId)).toMatchObject({ treasury: 100 });
    });

    it('carries the same fence and rollback through the leave-flush sibling', async () => {
      const acct = await makeAccount();
      const charId = await makeCharacter(acct);
      const guildId = await makeGuild();
      await grantLease(charId, 'nonce-leave');
      const market = { listings: [] } as never;
      const mail = { mail: [] } as never;

      expect(
        await db.saveCharacterAndMarketState(
          charId,
          11,
          CHAR_STATE('leave-ok'),
          market,
          mail,
          'nonce-leave',
          [{ guildId, deltas: [goldDelta('deposit_gold', 700)] }],
        ),
      ).toBe(true);
      expect(await bookOf(guildId)).toMatchObject({ treasury: 700 });

      expect(
        await db.saveCharacterAndMarketState(
          charId,
          77,
          CHAR_STATE('leave-fenced'),
          market,
          mail,
          'nonce-wrong',
          [{ guildId, deltas: [goldDelta('deposit_gold', 700)] }],
        ),
      ).toBe(false);
      expect(await characterRow(charId)).toEqual({ level: 11, marker: 'leave-ok' });
      expect(await bookOf(guildId)).toMatchObject({ treasury: 700 });
    });
  });

  // -------------------------------------------------------------------------
  // 2. The FK cascade and the two guards that stand in front of it.
  // -------------------------------------------------------------------------
  describe('the guilds DELETE cascade and its guards', () => {
    it('cascades guild_banks away with the guilds row, and PRESERVES the ledger', async () => {
      const acct = await makeAccount();
      const charId = await makeCharacter(acct);
      const guildId = await makeGuild();
      await grantLease(charId, 'nonce-cascade');
      await db.saveCharacterAndGuildBankState(
        charId,
        2,
        CHAR_STATE('cascade'),
        [{ guildId, deltas: [goldDelta('deposit_gold', 900)] }],
        'nonce-cascade',
      );
      await pool.query(
        `INSERT INTO guild_members (character_id, guild_id, rank) VALUES ($1, $2, 'leader')`,
        [charId, guildId],
      );
      await db.insertBankLedgerRow({
        realm,
        characterId: charId,
        accountId: acct,
        op: 'deposit_gold',
        itemId: null,
        count: null,
        instance: null,
        copperDelta: 900,
        purchasedSlotsAfter: 0,
        container: 'guild',
        containerId: guildId,
      } as never);

      expect(await bookOf(guildId)).not.toBeNull();

      // The REAL statement PgSocialDb.deleteGuild issues.
      await new socialDb.PgSocialDb(pool as never).deleteGuild(guildId);

      // The cascade destroys the DURABLE BOOK. This is the destructive power
      // both guards exist to stand in front of.
      expect(await bookOf(guildId)).toBeNull();
      expect(
        (await pool.query('SELECT 1 FROM guild_members WHERE guild_id = $1', [guildId])).rowCount,
      ).toBe(0);
      // bank_ledger has NO foreign key to guilds (container_id is a plain
      // BIGINT), so the keep-forever anti-dupe audit trail SURVIVES the
      // disband. Pinned because a well-meaning future FK here would silently
      // delete the evidence a dupe investigation depends on.
      expect(
        (await pool.query('SELECT 1 FROM bank_ledger WHERE container_id = $1', [guildId])).rowCount,
      ).toBe(1);
    });

    it('the empty-bank guard refuses the DELETE while the book holds value', async () => {
      const { guildId, charId, tx, svc } = await disbandFixture({ copper: 250, items: 0 });
      await svc.guildDisband({ characterId: charId, name: 'Leader' });

      // No DELETE was issued: guild and its durable book both survive.
      expect((await pool.query('SELECT 1 FROM guilds WHERE id = $1', [guildId])).rowCount).toBe(1);
      expect(await bookOf(guildId)).not.toBeNull();
      expect(tx.errors).toContain(
        'The guild bank must be emptied before the guild can be disbanded.',
      );
      // The window opened for the guard must be CLOSED again on the refusal arm,
      // or that guild's bank stays refused until the realm restarts.
      expect(tx.beginCalls).toBe(1);
      expect(tx.endCalls).toBe(1);
    });

    it('the guard fails CLOSED when no book is loaded (null holdings)', async () => {
      const { guildId, charId, tx, svc } = await disbandFixture({ holdings: null });
      await svc.guildDisband({ characterId: charId, name: 'Leader' });

      expect((await pool.query('SELECT 1 FROM guilds WHERE id = $1', [guildId])).rowCount).toBe(1);
      expect(await bookOf(guildId)).not.toBeNull();
      // endGuildBankDelete must NOT be called when begin returned null: the
      // window was not taken and releasing it would open the gap under whoever
      // holds it.
      expect(tx.endCalls).toBe(0);
    });

    it('an EMPTY bank deletes, and the window spans the DELETE and its hooks', async () => {
      const { guildId, charId, tx, svc } = await disbandFixture({ copper: 0, items: 0 });
      await svc.guildDisband({ characterId: charId, name: 'Leader' });

      expect((await pool.query('SELECT 1 FROM guilds WHERE id = $1', [guildId])).rowCount).toBe(0);
      expect(await bookOf(guildId)).toBeNull();
      // The whole point of the window: it is still OPEN at the post-commit
      // hook, which runs after the DELETE has already committed and taken the
      // guild_banks row with it. An op landing in that gap is therefore refused
      // rather than destroyed by the cascade with its dirty mark wiped.
      expect(tx.windowOpenAtDisbandHook).toBe(true);
      expect(await tx.rowGoneAtDisbandHook).toBe(true);
      expect(tx.endCalls).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Row-lock ordering under genuine concurrency.
  // -------------------------------------------------------------------------
  describe('row-lock ordering', () => {
    it('REVERSED lock order really does deadlock (the negative control)', async () => {
      const a = await makeGuild();
      const b = await makeGuild();
      await seedBook(a);
      await seedBook(b);
      const [lo, hi] = a < b ? [a, b] : [b, a];

      const errors = await racePair(
        [lo, hi],
        [hi, lo], // deliberately reversed: the ordering the fix removes
      );
      // Postgres 40P01. Without the ascending sort in collectGuildBankDeltas
      // this is what two overlapping escrow saves would do to each other.
      expect(errors.some((e) => (e as { code?: string })?.code === '40P01')).toBe(true);
    }, 30_000);

    it('ASCENDING lock order never deadlocks over the same rows', async () => {
      const a = await makeGuild();
      const b = await makeGuild();
      await seedBook(a);
      await seedBook(b);
      const [lo, hi] = a < b ? [a, b] : [b, a];

      for (let i = 0; i < 10; i++) {
        const errors = await racePair([lo, hi], [lo, hi]);
        expect(errors).toEqual([]);
      }
    }, 30_000);

    it('collectGuildBankDeltas emits ascending guild ids whatever order it is handed', () => {
      const saves = bankState.collectGuildBankDeltas(
        () => ({}),
        () => [],
        [90, 12, 55, 3],
      );
      expect(saves.map((s) => s.guildId)).toEqual([3, 12, 55, 90]);
    });

    it('concurrent escrow saves over overlapping books neither deadlock nor lose a delta', async () => {
      const guilds: number[] = [];
      for (let i = 0; i < 4; i++) guilds.push(await makeGuild());
      guilds.sort((x, y) => x - y);
      const sessions = await makeSessions(6);

      // Each session hands the collector a DIFFERENT order (rotated, and
      // reversed on odd sessions), so every pair of sessions disagrees about
      // lock order somewhere. That disagreement is precisely what the
      // ascending sort inside collectGuildBankDeltas exists to erase; remove
      // the sort and these transactions deadlock against each other.
      const hostileOrder = (i: number): number[] => {
        const rotated = [...guilds.slice(i % guilds.length), ...guilds.slice(0, i % guilds.length)];
        return i % 2 === 1 ? rotated.reverse() : rotated;
      };

      const ROUNDS = 30;
      const failures: unknown[] = [];
      for (let round = 0; round < ROUNDS; round++) {
        await Promise.all(
          sessions.map((s, i) =>
            db
              .saveCharacterAndGuildBankState(
                s.charId,
                1,
                CHAR_STATE(`round-${round}`),
                // Every session carries EVERY book, through the real collector,
                // so all six transactions contend for all four rows.
                bankState.collectGuildBankDeltas(
                  () => ({}),
                  () => [goldDelta('deposit_gold', 10)],
                  hostileOrder(i + round),
                ),
                s.nonce,
              )
              .catch((err) => failures.push(err)),
          ),
        );
      }

      expect(failures).toEqual([]);
      // Conservation: 6 sessions x 30 rounds x 10 copper into each of 4 books.
      for (const guildId of guilds) {
        expect(await bookOf(guildId)).toMatchObject({
          treasury: sessions.length * ROUNDS * 10,
        });
      }
    }, 180_000);
  });

  // -------------------------------------------------------------------------
  // 4. SELECT ... FOR UPDATE in the merge path.
  // -------------------------------------------------------------------------
  describe('SELECT ... FOR UPDATE serializes the read-modify-write', () => {
    it('an UNLOCKED read-modify-write really does lose an update (the negative control)', async () => {
      const guildId = await makeGuild();
      await seedBook(guildId, 0);

      const unlockedWriter = async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const cur = await c.query('SELECT data FROM guild_banks WHERE guild_id = $1', [guildId]);
          const base = Number((cur.rows[0].data as { treasury: number }).treasury);
          await new Promise((r) => setTimeout(r, 40));
          await c.query('UPDATE guild_banks SET data = $2 WHERE guild_id = $1', [
            guildId,
            JSON.stringify({ treasury: base + 100, inventory: [], purchasedSlots: 0 }),
          ]);
          await c.query('COMMIT');
        } finally {
          c.release();
        }
      };
      await Promise.all([unlockedWriter(), unlockedWriter()]);

      // 100, not 200: one writer's work was discarded. This is the shape the
      // FOR UPDATE exists to prevent, and it proves the assertions below are
      // capable of failing.
      expect(await bookOf(guildId)).toMatchObject({ treasury: 100 });
    }, 30_000);

    it('two concurrent writers of the SAME existing book both land', async () => {
      const guildId = await makeGuild();
      await seedBook(guildId, 0);
      const writers = await makeSessions(3);

      const ROUNDS = 20;
      for (let r = 0; r < ROUNDS; r++) {
        await Promise.all(
          writers.map((s) =>
            db.saveCharacterAndGuildBankState(
              s.charId,
              1,
              CHAR_STATE('lock'),
              [{ guildId, deltas: [goldDelta('deposit_gold', 100)] }],
              s.nonce,
            ),
          ),
        );
      }
      expect(await bookOf(guildId)).toMatchObject({ treasury: writers.length * ROUNDS * 100 });
    }, 120_000);

    it('the seed-then-relock closes the NO-ROW lost-update window', async () => {
      // FOR UPDATE locks ROWS: with no guild_banks row yet it locks NOTHING, so
      // two processes would both merge onto the empty base and the second
      // upsert would discard the first. writeGuildBankRow seeds the row
      // (ON CONFLICT DO NOTHING) and RE-READS it under the lock. Every guild
      // below starts with NO row, which is the only state that window exists in,
      // and it only happens once per guild for the realm's whole life, so the
      // sample is wide rather than deep.
      const writers = await makeSessions(3);
      const fresh: number[] = [];
      for (let i = 0; i < 25; i++) fresh.push(await makeGuild());

      for (const guildId of fresh) {
        expect(await bookOf(guildId)).toBeNull();
        await Promise.all(
          writers.map((s) =>
            db.saveCharacterAndGuildBankState(
              s.charId,
              1,
              CHAR_STATE('cold'),
              [{ guildId, deltas: [goldDelta('deposit_gold', 100)] }],
              s.nonce,
            ),
          ),
        );
      }

      for (const guildId of fresh) {
        expect(await bookOf(guildId)).toMatchObject({ treasury: writers.length * 100 });
        expect(
          (await pool.query('SELECT 1 FROM guild_banks WHERE guild_id = $1', [guildId])).rowCount,
        ).toBe(1);
      }
    }, 180_000);
  });

  // -------------------------------------------------------------------------
  // 5. The activity log read, against the real table and the real index.
  // -------------------------------------------------------------------------
  describe('loadGuildBankLogRows against real rows', () => {
    it('filters the op allowlist, resolves the name, orders by id DESC and honours the limit', async () => {
      const acct = await makeAccount();
      const charId = await makeCharacter(acct);
      const guildId = await makeGuild();
      const otherGuild = await makeGuild();
      const name = (await pool.query('SELECT name FROM characters WHERE id = $1', [charId])).rows[0]
        .name as string;

      const write = (op: string, containerId: number) =>
        db.insertBankLedgerRow({
          realm,
          characterId: charId,
          accountId: acct,
          op,
          itemId: null,
          count: null,
          instance: null,
          copperDelta: 1,
          purchasedSlotsAfter: 0,
          container: 'guild',
          containerId,
        } as never);

      await write('deposit_gold', guildId);
      await write('escrow_deficit', guildId); // hidden: never leaves the server
      await write('withdraw_gold', guildId);
      await write('counterparty_orphan', guildId); // hidden
      await write('buy_slots', guildId);
      await write('deposit_gold', otherGuild); // another guild's row

      const rows = await db.loadGuildBankLogRows(guildId, 2, [
        'deposit_gold',
        'withdraw_gold',
        'buy_slots',
      ]);
      expect(rows.map((r) => r.op)).toEqual(['buy_slots', 'withdraw_gold']);
      expect(rows[0].characterName).toBe(name);

      const all = await db.loadGuildBankLogRows(guildId, 50, [
        'deposit_gold',
        'withdraw_gold',
        'buy_slots',
      ]);
      expect(all).toHaveLength(3);
      // The two diagnostic ops are excluded in SQL, not client-side.
      expect(all.some((r) => r.op === 'escrow_deficit' || r.op === 'counterparty_orphan')).toBe(
        false,
      );
    });

    it('uses the partial index and never a sequential scan', async () => {
      const plan = await pool.query(
        `EXPLAIN (FORMAT JSON)
         SELECT bl.id, bl.created_at, bl.op, bl.item_id, bl.count, bl.copper_delta,
                c.name AS character_name
           FROM bank_ledger bl
           LEFT JOIN characters c ON c.id = bl.character_id
          WHERE bl.container = 'guild' AND bl.container_id = $1
            AND bl.op = ANY($2::text[])
          ORDER BY bl.id DESC
          LIMIT $3`,
        [1, ['deposit_gold'], 50],
      );
      const text = JSON.stringify(plan.rows[0]);
      expect(text).toContain('bank_ledger_container_recent');
    });
  });

  // -------------------------------------------------------------------------
  // 6. ensureSchema is additive and idempotent against a POPULATED database.
  // -------------------------------------------------------------------------
  describe('boot is idempotent on a populated database', () => {
    it('re-applying the whole schema changes no column, index or row', async () => {
      // Everything above has already populated this database with accounts,
      // characters, leases, guilds, books and ledger rows, which is exactly the
      // state a redeploy re-applies the DDL against.
      const fingerprint = async () => {
        const cols = await pool.query(
          `SELECT table_name, column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, column_name`,
        );
        const idx = await pool.query(
          `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
            ORDER BY indexname`,
        );
        const cons = await pool.query(
          `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace ORDER BY conname`,
        );
        return JSON.stringify({ cols: cols.rows, idx: idx.rows, cons: cons.rows });
      };
      const counts = async () => {
        const res = await pool.query(
          `SELECT (SELECT count(*) FROM guild_banks) AS books,
                  (SELECT count(*) FROM bank_ledger) AS ledger,
                  (SELECT count(*) FROM characters) AS chars,
                  (SELECT coalesce(sum((data->>'treasury')::bigint), 0) FROM guild_banks) AS copper`,
        );
        return res.rows[0];
      };

      const beforeSchema = await fingerprint();
      const beforeCounts = await counts();
      expect(Number(beforeCounts.books)).toBeGreaterThan(0);
      expect(Number(beforeCounts.ledger)).toBeGreaterThan(0);

      await db.ensureSchema();
      await db.runConcurrentIndexMigrations();
      await db.ensureSchema();
      await db.runConcurrentIndexMigrations();

      expect(await fingerprint()).toBe(beforeSchema);
      expect(await counts()).toEqual(beforeCounts);

      // The new surface specifically: every column and index this branch adds
      // is present and unchanged after the re-apply.
      const guildBankCols = await pool.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'guild_banks' ORDER BY ordinal_position`,
      );
      expect(guildBankCols.rows).toEqual([
        { column_name: 'guild_id', data_type: 'integer', is_nullable: 'NO' },
        { column_name: 'realm', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'data', data_type: 'jsonb', is_nullable: 'NO' },
        { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      ]);
      const counterparty = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'bank_ledger'
            AND column_name IN ('counterparty_copper_delta', 'counterparty_count')
          ORDER BY column_name`,
      );
      // NULLABLE WITH NO DEFAULT: NULL means NOT RECORDED, and a DEFAULT 0
      // would turn every legacy row into a false all-clear for the audit.
      expect(counterparty.rows).toEqual([
        {
          column_name: 'counterparty_copper_delta',
          data_type: 'bigint',
          is_nullable: 'YES',
          column_default: null,
        },
        {
          column_name: 'counterparty_count',
          data_type: 'integer',
          is_nullable: 'YES',
          column_default: null,
        },
      ]);
      const partial = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'bank_ledger_container_recent'`,
      );
      expect(partial.rows[0].indexdef).toContain('(container_id, id DESC)');
      expect(partial.rows[0].indexdef).toContain("WHERE (container = 'guild'::text)");
      const valid = await pool.query(
        `SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('bank_ledger_container_recent')`,
      );
      expect(valid.rows[0].indisvalid).toBe(true);
    }, 120_000);
  });

  // ---- fixtures ------------------------------------------------------------

  async function seedBook(guildId: number, treasury = 0): Promise<void> {
    await pool.query(
      `INSERT INTO guild_banks (guild_id, realm, data) VALUES ($1, $2, $3)
       ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
      [guildId, realm, JSON.stringify({ treasury, inventory: [], purchasedSlots: 0 })],
    );
  }

  async function makeSessions(n: number): Promise<{ charId: number; nonce: string }[]> {
    const out: { charId: number; nonce: string }[] = [];
    for (let i = 0; i < n; i++) {
      const acct = await makeAccount();
      const charId = await makeCharacter(acct);
      const nonce = `sess-${charId}`;
      await grantLease(charId, nonce);
      out.push({ charId, nonce });
    }
    return out;
  }

  // Two transactions that each take two guild_banks row locks in the given
  // order, synchronised so both hold their FIRST lock before either asks for
  // its second. Returns whatever errors Postgres raised.
  //
  // The barrier releases on BOTH arrivals or after a short grace, deliberately:
  // under ASCENDING order the second transaction blocks on the first row lock
  // and can never arrive, so a strict two-party barrier would wedge the harness
  // rather than test the product. Under REVERSED order both DO arrive, so the
  // grace never fires and the deadlock is forced, not hoped for.
  const BARRIER_GRACE_MS = 250;
  async function racePair(first: readonly number[], second: readonly number[]): Promise<unknown[]> {
    const clients = [await pool.connect(), await pool.connect()];
    const errors: unknown[] = [];
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    const arrive = () => {
      if (++arrived === 2) release();
      return Promise.race([barrier, new Promise((r) => setTimeout(r, BARRIER_GRACE_MS))]);
    };
    const run = async (c: PoolClient, order: readonly number[]) => {
      try {
        await c.query('BEGIN');
        await c.query('SELECT 1 FROM guild_banks WHERE guild_id = $1 FOR UPDATE', [order[0]]);
        await arrive();
        await c.query('SELECT 1 FROM guild_banks WHERE guild_id = $1 FOR UPDATE', [order[1]]);
        await c.query('COMMIT');
      } catch (err) {
        errors.push(err);
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    };
    await Promise.all([run(clients[0], first), run(clients[1], second)]);
    return errors;
  }

  // A real SocialService over a real PgSocialDb, with only the transport faked
  // (it is the seam to the live sim, which has no place in a SQL proof). The
  // DELETE, the membership reads and the cascade are all the production ones.
  async function disbandFixture(opts: {
    copper?: number;
    items?: number;
    holdings?: null;
  }): Promise<{
    guildId: number;
    charId: number;
    tx: DisbandTransport;
    svc: import('../server/social').SocialService;
  }> {
    const acct = await makeAccount();
    const charId = await makeCharacter(acct);
    const guildId = await makeGuild();
    await grantLease(charId, `disband-${charId}`);
    await db.saveCharacterAndGuildBankState(
      charId,
      1,
      CHAR_STATE('disband'),
      [{ guildId, deltas: [goldDelta('deposit_gold', opts.copper ?? 0)] }],
      `disband-${charId}`,
    );
    await pool.query(
      `INSERT INTO guild_members (character_id, guild_id, rank) VALUES ($1, $2, 'leader')`,
      [charId, guildId],
    );
    const holdings =
      opts.holdings === null ? null : { copper: opts.copper ?? 0, items: opts.items ?? 0 };
    const tx = new DisbandTransport(holdings, () =>
      pool.query('SELECT 1 FROM guilds WHERE id = $1', [guildId]).then((r) => r.rowCount === 0),
    );
    const svc = new social.SocialService(
      new socialDb.PgSocialDb(pool as never),
      tx as never,
      () => Date.now(),
      // Screening is irrelevant to the disband/cascade cases under test; the
      // ctor requires it explicitly so no site fails open by omission.
      () => false,
    );
    return { guildId, charId, tx, svc };
  }
});

// A SocialTransport stub that records only what the cascade proof needs: how
// many times the delete window opened and closed, whether it was still OPEN at
// the moment the row went away, and every error line the service voiced.
class DisbandTransport {
  errors: string[] = [];
  beginCalls = 0;
  endCalls = 0;
  windowOpen = false;
  windowOpenAtDisbandHook = false;
  // Resolves to whether the guilds row was already gone at the instant the
  // post-commit hook fired. Started INSIDE the hook so the read cannot drift.
  rowGoneAtDisbandHook: Promise<boolean> = Promise.resolve(false);

  constructor(
    private readonly holdings: { copper: number; items: number } | null,
    private readonly deleted: () => Promise<boolean>,
  ) {}

  byCharacterId(id: number) {
    return { characterId: id, name: 'Leader' };
  }
  byName() {
    return null;
  }
  isOnline() {
    return false;
  }
  locationOf() {
    return null;
  }
  deliver(_id: number, events: { type: string; text?: string }[]) {
    for (const e of events) if (e.type === 'error' && e.text) this.errors.push(e.text);
  }
  pushSnapshot() {}
  onGuildRenamed() {}
  onBlocksChanged() {}
  onIgnoresChanged() {}
  onGuildFounded() {}
  onGuildMembershipChanged() {}
  onGuildCreated() {}
  onGuildDisbanded() {
    this.windowOpenAtDisbandHook = this.windowOpen;
    // The hook fires immediately after the committed DELETE, so this read
    // observes the database at the instant the durable row went away.
    this.rowGoneAtDisbandHook = this.deleted();
  }
  beginGuildBankDelete() {
    this.beginCalls++;
    if (this.holdings === null) return null;
    this.windowOpen = true;
    return this.holdings;
  }
  endGuildBankDelete() {
    this.endCalls++;
    this.windowOpen = false;
  }
  isBlocking() {
    return false;
  }
  blockListLoaded() {
    return true;
  }
  isIgnoringChat() {
    return false;
  }
  chatFlairFor() {
    return undefined;
  }
}
