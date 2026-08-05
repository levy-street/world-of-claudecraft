// Opt-in PostgreSQL 16 proof for the guild-name rollout and concurrency rules,
// and for the guild backoffice's production SQL. The default suite stays DB-free;
// set TEST_DATABASE_URL to exercise real locks, triggers, transaction visibility,
// and every read/write statement the admin guild endpoints issue.
//
// Two isolated Postgres schemas, because the two halves want different fixtures:
// the lock proofs below use a minimal table seeded with deliberate case-only
// collisions, while QUERY_SCHEMA (second block) carries the REAL boot DDL so the
// statements under test run against the columns, types, defaults, and indexes
// production actually has.

import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_GUILDS_SCHEMA } from '../server/admin_guilds_schema';
import {
  GUILD_NAME_ADVISORY_LOCK_SQL,
  GUILD_NAME_COLLISION_SQL,
  guildNameLockKey,
} from '../server/guild_name_db';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'admin_guilds_integration_test';
const REALM = 'integration';
const describeDb = DB_URL ? describe : describe.skip;

async function begin(client: PoolClient): Promise<void> {
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query('BEGIN');
}

async function lockAndCheck(
  client: PoolClient,
  name: string,
  excludedGuildId: number | null,
): Promise<boolean> {
  await client.query(GUILD_NAME_ADVISORY_LOCK_SQL, [guildNameLockKey(REALM, name)]);
  const collision = await client.query(GUILD_NAME_COLLISION_SQL, [REALM, name, excludedGuildId]);
  return collision.rowCount !== 0;
}

describeDb('admin guild name integrity (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 4 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
      await client.query(`
        CREATE TABLE accounts (id INT PRIMARY KEY);
        CREATE TABLE guilds (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          realm TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX guilds_realm_name ON guilds(realm, name);
        INSERT INTO accounts VALUES (1);
        INSERT INTO guilds (name, realm) VALUES
          ('Historical Name', '${REALM}'),
          ('HISTORICAL NAME', '${REALM}');
      `);
      await client.query(ADMIN_GUILDS_SCHEMA);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('installs over historical case collisions and guards old-binary writes', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
      const collisions = await client.query(
        `SELECT count(*)::int AS count
           FROM guilds
          WHERE realm = $1 AND lower(name) = lower($2)`,
        [REALM, 'Historical Name'],
      );
      expect(collisions.rows[0].count).toBe(2);

      await expect(
        client.query('INSERT INTO guilds (name, realm) VALUES ($1, $2)', [
          'historical NAME',
          REALM,
        ]),
      ).rejects.toMatchObject({ code: '23505', constraint: 'guilds_realm_lower_name_guard' });

      await client.query(
        `UPDATE guilds SET name = 'Remediated Name'
          WHERE name = 'HISTORICAL NAME' AND realm = $1`,
        [REALM],
      );
      const remaining = await client.query(
        'SELECT name FROM guilds WHERE realm = $1 ORDER BY name',
        [REALM],
      );
      expect(remaining.rows.map((row) => row.name)).toEqual(['Historical Name', 'Remediated Name']);
    } finally {
      client.release();
    }
  });

  it('serializes a trigger-only legacy insert behind a new-writer transaction', async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    const name = 'Mixed Version Race';
    try {
      await begin(first);
      expect(await lockAndCheck(first, name, null)).toBe(false);
      await first.query('INSERT INTO guilds (name, realm) VALUES ($1, $2)', [name, REALM]);

      await begin(second);
      let legacySettled = false;
      const legacyInsert = second
        .query('INSERT INTO guilds (name, realm) VALUES ($1, $2)', [
          name.toLocaleUpperCase('en-US'),
          REALM,
        ])
        .then(
          () => ({ error: null }),
          (error: unknown) => ({ error }),
        )
        .finally(() => {
          legacySettled = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(legacySettled).toBe(false);

      await first.query('COMMIT');
      const legacyOutcome = await legacyInsert;
      expect(legacyOutcome.error).toMatchObject({
        code: '23505',
        constraint: 'guilds_realm_lower_name_guard',
      });
      await second.query('ROLLBACK');

      const rows = await first.query(
        `SELECT count(*)::int AS count
           FROM guilds
          WHERE realm = $1 AND lower(name) = lower($2)`,
        [REALM, name],
      );
      expect(rows.rows[0].count).toBe(1);
    } finally {
      await first.query('ROLLBACK').catch(() => {});
      await second.query('ROLLBACK').catch(() => {});
      first.release();
      second.release();
    }
  });

  it('serializes competing create, create-vs-rename, and rename transactions', async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await begin(first);
      expect(await lockAndCheck(first, 'Create Race', null)).toBe(false);
      await first.query('INSERT INTO guilds (name, realm) VALUES ($1, $2)', ['Create Race', REALM]);

      await begin(second);
      const competingCreate = lockAndCheck(second, 'CREATE RACE', null);
      await first.query('COMMIT');
      expect(await competingCreate).toBe(true);
      await second.query('ROLLBACK');

      const seeded = await first.query(
        `INSERT INTO guilds (name, realm) VALUES
           ('Rename Source', $1),
           ('Other Source', $1)
         RETURNING id, name`,
        [REALM],
      );
      const renameSourceId = Number(seeded.rows.find((row) => row.name === 'Rename Source')?.id);
      const otherSourceId = Number(seeded.rows.find((row) => row.name === 'Other Source')?.id);

      await begin(first);
      expect(await lockAndCheck(first, 'Rename Target', renameSourceId)).toBe(false);
      await first.query('UPDATE guilds SET name = $1 WHERE id = $2', [
        'Rename Target',
        renameSourceId,
      ]);

      await begin(second);
      const createVsRename = lockAndCheck(second, 'RENAME TARGET', null);
      await first.query('COMMIT');
      expect(await createVsRename).toBe(true);
      await second.query('ROLLBACK');

      await begin(first);
      expect(await lockAndCheck(first, 'Shared Target', renameSourceId)).toBe(false);
      await first.query('UPDATE guilds SET name = $1 WHERE id = $2', [
        'Shared Target',
        renameSourceId,
      ]);

      await begin(second);
      const renameVsRename = lockAndCheck(second, 'SHARED TARGET', otherSourceId);
      await first.query('COMMIT');
      expect(await renameVsRename).toBe(true);
      await second.query('ROLLBACK');

      const duplicateGroups = await first.query(
        `SELECT count(*)::int AS count
           FROM (
             SELECT realm, lower(name)
               FROM guilds
              WHERE realm = $1
                AND lower(name) IN ('create race', 'rename target', 'shared target')
              GROUP BY realm, lower(name)
             HAVING count(*) > 1
           ) collisions`,
        [REALM],
      );
      expect(duplicateGroups.rows[0].count).toBe(0);
    } finally {
      await first.query('ROLLBACK').catch(() => {});
      await second.query('ROLLBACK').catch(() => {});
      first.release();
      second.release();
    }
  });
});

// ---------------------------------------------------------------------------
// The production statements, executed.
//
// Everything above proves the LOCKING rules against a minimal fixture. This
// block proves the SQL itself: the chained MATERIALIZED CTEs, the LEFT JOIN
// page ON true shape, count(...) OVER (), max(...) FILTER (...), the CTE named
// total carrying a column named total, and the alias named action are the most
// intricate statements in the guild backoffice, and a syntax or grouping error
// in any of them passes a mocked-pool suite and only fails in production.
//
// The fixture applies the REAL boot DDL in the REAL order ensureSchema uses, so
// these run against production's columns, types, defaults, and indexes.

const QUERY_SCHEMA = 'admin_guilds_query_integration_test';
const QUERY_REALM = 'QueryRealm';
const OTHER_REALM = 'OtherRealm';
const ROSTER_CAP = 100;

type GuildsDb = typeof import('../server/admin_guilds_db');
type AdminDb = typeof import('../server/admin_db');

describeDb('admin guild production SQL (real Postgres)', () => {
  let bootstrap: Pool;
  let guildsDb: GuildsDb;
  let adminDb: AdminDb;
  let dbPool: Pool;
  const guildIds = new Map<string, number>();
  let adminAccountId = 0;
  let nextCharacter = 0;

  async function seedGuild(
    client: PoolClient,
    name: string,
    realm: string,
    ranks: readonly string[],
  ): Promise<void> {
    const guild = await client.query(
      'INSERT INTO guilds (name, realm) VALUES ($1, $2) RETURNING id',
      [name, realm],
    );
    const guildId = Number(guild.rows[0].id);
    guildIds.set(name, guildId);
    for (const rank of ranks) {
      nextCharacter += 1;
      const account = await client.query(
        'INSERT INTO accounts (username, password_hash) VALUES ($1, $2) RETURNING id',
        [`user${nextCharacter}`, 'hash'],
      );
      const character = await client.query(
        `INSERT INTO characters (account_id, name, class, realm, level, state, last_login)
         VALUES ($1, $2, 'mage', $3, $4, $5, now()) RETURNING id`,
        [
          Number(account.rows[0].id),
          `Char${nextCharacter}`,
          realm,
          (nextCharacter % 60) + 1,
          JSON.stringify({ copper: nextCharacter * 10, xp: nextCharacter * 100 }),
        ],
      );
      await client.query(
        'INSERT INTO guild_members (character_id, guild_id, rank) VALUES ($1, $2, $3)',
        [Number(character.rows[0].id), guildId, rank],
      );
    }
  }

  function guildId(name: string): number {
    const id = guildIds.get(name);
    if (id === undefined) throw new Error(`guild "${name}" was not seeded`);
    return id;
  }

  async function guildNameNow(id: number): Promise<string | null> {
    const row = await bootstrap.query('SELECT name FROM guilds WHERE id = $1', [id]);
    return row.rows[0]?.name ?? null;
  }

  beforeAll(async () => {
    bootstrap = new Pool({
      connectionString: DB_URL,
      max: 4,
      options: `-c search_path=${QUERY_SCHEMA}`,
    });
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${QUERY_SCHEMA} CASCADE`);
    await bootstrap.query(`CREATE SCHEMA ${QUERY_SCHEMA}`);

    // The modules under test read DATABASE_URL and REALM_NAME at IMPORT time, so
    // both are pinned before the first dynamic import. process.loadEnvFile (the
    // server's env bootstrap) never overwrites an already-set key, so a developer's
    // .env cannot redirect this suite at the real database.
    process.env.DATABASE_URL = `${DB_URL}?options=-c%20search_path%3D${QUERY_SCHEMA}`;
    process.env.REALM_NAME = QUERY_REALM;

    const db = await import('../server/db');
    const social = await import('../server/social_db');
    const playerMetrics = await import('../server/player_metrics_db');
    const retention = await import('../server/play_session_retention_db');
    dbPool = db.pool as unknown as Pool;

    const client = await bootstrap.connect();
    try {
      // The same modules, in the same order, as ensureSchema's boot sequence.
      await client.query(db.SCHEMA);
      await client.query(playerMetrics.PLAYER_METRICS_SCHEMA);
      await client.query(retention.PLAY_SESSION_RETENTION_SCHEMA);
      await client.query(db.DAILY_REWARD_EXCLUDED_ACCOUNTS_VIEW_SQL);
      await client.query(social.SOCIAL_SCHEMA);
      await client.query(ADMIN_GUILDS_SCHEMA);

      const admin = await client.query(
        'INSERT INTO accounts (username, password_hash) VALUES ($1, $2) RETURNING id',
        ['moderator', 'hash'],
      );
      adminAccountId = Number(admin.rows[0].id);

      await seedGuild(client, 'Alpha Guild', QUERY_REALM, ['leader', 'officer', 'member']);
      await seedGuild(client, 'Beta Guild', QUERY_REALM, ['member']);
      await seedGuild(client, 'Ghost Guild', QUERY_REALM, []);
      await seedGuild(
        client,
        'Capped Guild',
        QUERY_REALM,
        Array.from({ length: ROSTER_CAP + 1 }, (_, index) => (index === 0 ? 'leader' : 'member')),
      );
      // The prefix filter escapes LIKE metacharacters, so searching "under_"
      // must find the literal underscore and NOT the wildcard match.
      await seedGuild(client, 'Under_Score', QUERY_REALM, []);
      await seedGuild(client, 'UnderX Guild', QUERY_REALM, []);
      await seedGuild(client, 'Rename Me', QUERY_REALM, ['leader', 'member']);
      await seedGuild(client, 'Occupied Name', QUERY_REALM, []);
      await seedGuild(client, 'CASE ONLY', QUERY_REALM, []);
      await seedGuild(client, 'Foreign Guild', OTHER_REALM, ['leader']);
    } finally {
      client.release();
    }

    guildsDb = await import('../server/admin_guilds_db');
    adminDb = await import('../server/admin_db');
  }, 120_000);

  afterAll(async () => {
    if (dbPool) await dbPool.end();
    if (!bootstrap) return;
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${QUERY_SCHEMA} CASCADE`);
    await bootstrap.end();
  });

  it('pins the roster cap the detail read and rename guard share', async () => {
    const social = await import('../server/social');
    expect(social.GUILD_MEMBER_LIMIT).toBe(ROSTER_CAP);
  });

  it('pages and counts the name-sorted branch, scoped to this realm', async () => {
    const firstPage = await guildsDb.listAdminGuilds('', 1, 3, 'name', 'asc');

    expect(firstPage.rows.map((row) => row.name)).toEqual([
      'Alpha Guild',
      'Beta Guild',
      'Capped Guild',
    ]);
    // Nine guilds live in this realm; the tenth belongs to another one.
    expect(firstPage.total).toBe(9);
    expect(firstPage.rows.every((row) => row.realm === QUERY_REALM)).toBe(true);

    const descending = await guildsDb.listAdminGuilds('', 1, 1, 'name', 'desc');
    expect(descending.rows[0].name).toBe('UnderX Guild');
    expect(descending.total).toBe(9);

    const everyName = (await guildsDb.listAdminGuilds('', 1, 50, 'name', 'asc')).rows.map(
      (row) => row.name,
    );
    expect(everyName).not.toContain('Foreign Guild');
  });

  it('resolves member counts and the leader name on the paged branch', async () => {
    const page = await guildsDb.listAdminGuilds('alpha', 1, 25, 'name', 'asc');

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].memberCount).toBe(3);
    expect(page.rows[0].leaderName).toBeTruthy();

    // A guild with no leader row must read null, not an arbitrary member.
    const beta = await guildsDb.listAdminGuilds('beta', 1, 25, 'name', 'asc');
    expect(beta.rows[0].memberCount).toBe(1);
    expect(beta.rows[0].leaderName).toBeNull();

    // An empty guild still returns a row: the LEFT JOIN must not drop it.
    const ghost = await guildsDb.listAdminGuilds('ghost', 1, 25, 'name', 'asc');
    expect(ghost.rows).toHaveLength(1);
    expect(ghost.rows[0].memberCount).toBe(0);
    expect(ghost.rows[0].leaderName).toBeNull();
  });

  it('orders and counts the aggregating member_count branch in both directions', async () => {
    const busiest = await guildsDb.listAdminGuilds('', 1, 4, 'member_count', 'desc');

    expect(busiest.rows.map((row) => [row.name, row.memberCount])).toEqual([
      ['Capped Guild', ROSTER_CAP + 1],
      ['Alpha Guild', 3],
      ['Rename Me', 2],
      ['Beta Guild', 1],
    ]);
    expect(busiest.total).toBe(9);

    const quietest = await guildsDb.listAdminGuilds('', 1, 3, 'member_count', 'asc');
    expect(quietest.rows.every((row) => row.memberCount === 0)).toBe(true);
    expect(quietest.total).toBe(9);
  });

  it('orders the created_at branch without losing the total', async () => {
    const newest = await guildsDb.listAdminGuilds('', 1, 2, 'created_at', 'desc');
    const oldest = await guildsDb.listAdminGuilds('', 1, 2, 'created_at', 'asc');

    expect(newest.total).toBe(9);
    expect(oldest.total).toBe(9);
    expect(oldest.rows[0].name).toBe('Alpha Guild');
    expect(newest.rows[0].name).not.toBe('Alpha Guild');
  });

  it('escapes LIKE metacharacters in the search prefix', async () => {
    const literal = await guildsDb.listAdminGuilds('Under_', 1, 25, 'name', 'asc');

    expect(literal.rows.map((row) => row.name)).toEqual(['Under_Score']);
    expect(literal.total).toBe(1);

    const both = await guildsDb.listAdminGuilds('under', 1, 25, 'name', 'asc');
    expect(both.total).toBe(2);
  });

  it('returns an empty page, with the true total, past the end of the results', async () => {
    for (const sort of ['name', 'created_at', 'member_count'] as const) {
      const beyond = await guildsDb.listAdminGuilds('', 99, 25, sort);
      expect(beyond.rows, sort).toEqual([]);
      expect(beyond.total, sort).toBe(9);
    }
  });

  it('reads a guild detail with its ranked roster', async () => {
    const detail = await guildsDb.adminGuildDetail(guildId('Alpha Guild'));

    expect(detail?.guild.name).toBe('Alpha Guild');
    expect(detail?.guild.memberCount).toBe(3);
    expect(detail?.members.map((member) => member.rank)).toEqual(['leader', 'officer', 'member']);
    expect(detail?.members.every((member) => member.username.startsWith('user'))).toBe(true);
    expect(detail?.members[0].level).toBeGreaterThan(0);
  });

  it('keeps an empty guild readable and reports a roster above the cap as truncated', async () => {
    const empty = await guildsDb.adminGuildDetail(guildId('Ghost Guild'));
    expect(empty?.guild.memberCount).toBe(0);
    expect(empty?.members).toEqual([]);

    // count(...) OVER () is evaluated before LIMIT, so memberCount stays the true
    // roster size while the rows stop at the cap. That gap is what the dashboard
    // renders as "showing the first N".
    const capped = await guildsDb.adminGuildDetail(guildId('Capped Guild'));
    expect(capped?.members).toHaveLength(ROSTER_CAP);
    expect(capped?.guild.memberCount).toBe(ROSTER_CAP + 1);
  });

  it('returns null for a missing guild and for one in another realm', async () => {
    expect(await guildsDb.adminGuildDetail(9_999_999)).toBeNull();
    expect(await guildsDb.adminGuildDetail(guildId('Foreign Guild'))).toBeNull();
  });

  it('renames a guild, audits it permanently, and returns its members', async () => {
    const target = guildId('Rename Me');

    const renamed = await guildsDb.renameAdminGuild(
      target,
      'Renamed Guild',
      'offensive name',
      adminAccountId,
    );

    expect(renamed).toMatchObject({
      result: { guildId: target, oldName: 'Rename Me', newName: 'Renamed Guild' },
    });
    expect('result' in renamed && renamed.result.memberCharacterIds).toHaveLength(2);
    expect(await guildNameNow(target)).toBe('Renamed Guild');

    const history = await guildsDb.listAdminGuildHistory(target);
    expect(history).toMatchObject([
      {
        oldName: 'Rename Me',
        newName: 'Renamed Guild',
        reason: 'offensive name',
        adminAccountId,
        adminUsername: 'moderator',
      },
    ]);
  });

  it('accepts a case-only rename, the remediation for a historical collision', async () => {
    const target = guildId('CASE ONLY');

    const renamed = await guildsDb.renameAdminGuild(target, 'Case Only', 're-case', adminAccountId);

    // The collision probe and the folded-name trigger both exclude the row itself,
    // so re-casing passes the guard that a genuine collision would trip.
    expect(renamed).toMatchObject({ result: { oldName: 'CASE ONLY', newName: 'Case Only' } });
    expect(await guildNameNow(target)).toBe('Case Only');

    const unchanged = await guildsDb.renameAdminGuild(target, 'Case Only', 'no-op', adminAccountId);
    expect(unchanged).toEqual({ error: 'same_name' });
  });

  it('refuses a folded-name collision, a missing guild, and an invalid request', async () => {
    const target = guildId('Alpha Guild');

    expect(
      await guildsDb.renameAdminGuild(target, 'occupied NAME', 'collide', adminAccountId),
    ).toEqual({ error: 'name_taken' });
    expect(await guildNameNow(target)).toBe('Alpha Guild');

    expect(
      await guildsDb.renameAdminGuild(9_999_999, 'Nowhere Guild', 'missing', adminAccountId),
    ).toEqual({ error: 'not_found' });
    expect(await guildsDb.renameAdminGuild(target, 'x', 'too short', adminAccountId)).toEqual({
      error: 'invalid_name',
    });
    expect(await guildsDb.renameAdminGuild(target, 'Fine Name', '  ', adminAccountId)).toEqual({
      error: 'invalid_reason',
    });
  });

  it('rolls the whole rename back when the roster is above the cap', async () => {
    const target = guildId('Capped Guild');

    expect(
      await guildsDb.renameAdminGuild(target, 'Too Many Members', 'oversized', adminAccountId),
    ).toEqual({ error: 'member_limit_exceeded' });

    // The UPDATE runs before the roster check, so the rollback is what protects
    // the name; a committed transaction here would rename it anyway.
    expect(await guildNameNow(target)).toBe('Capped Guild');
    expect(await guildsDb.listAdminGuildHistory(target)).toEqual([]);
  });

  it('returns null history for a guild that does not exist', async () => {
    expect(await guildsDb.listAdminGuildHistory(9_999_999)).toBeNull();
    expect(await guildsDb.listAdminGuildHistory(guildId('Foreign Guild'))).toBeNull();
  });

  it('surfaces guild renames in the realm-wide moderation history', async () => {
    const history = await adminDb.listModerationActions('all', adminAccountId, 1, 50);

    const renames = history.rows.filter((row) => row.source === 'guild');
    expect(renames.length).toBeGreaterThanOrEqual(2);
    expect(renames.every((row) => row.action === adminDb.GUILD_RENAME_ACTION)).toBe(true);
    expect(renames.every((row) => row.adminUsername === 'moderator')).toBe(true);
    // guild_name resolves to the guild's CURRENT name, not the audited one.
    expect(renames.map((row) => row.guildName)).toContain('Renamed Guild');
    expect(renames.every((row) => row.accountId === null && row.ip === null)).toBe(true);

    const mine = await adminDb.listModerationActions('mine', adminAccountId, 1, 50);
    expect(mine.rows.some((row) => row.source === 'guild')).toBe(true);

    // A rename is never a note, so the notes tab must not carry the guild arm.
    const notes = await adminDb.listModerationActions('notes', adminAccountId, 1, 50);
    expect(notes.rows.some((row) => row.source === 'guild')).toBe(false);
  });

  it('carries guild identity through the reworked character and account reads', async () => {
    const characters = await adminDb.listCharacters('Char', 'level', 'desc', 1, 5);

    expect(characters.rows).toHaveLength(5);
    expect(characters.total).toBeGreaterThan(ROSTER_CAP);
    const withGuild = characters.rows.find((row) => row.guildId !== null);
    expect(withGuild?.guildName).toBeTruthy();
    expect(withGuild?.guildRank).toBeTruthy();

    const roster = await guildsDb.adminGuildDetail(guildId('Alpha Guild'));
    const leader = roster?.members[0];
    if (!leader) throw new Error('the alpha roster lost its leader');
    const detail = await adminDb.accountDetail(leader.accountId);

    expect(detail?.username).toBe(leader.username);
    expect(detail?.characters[0]).toMatchObject({
      guildId: guildId('Alpha Guild'),
      guildName: 'Alpha Guild',
      guildRank: 'leader',
    });
  });
});
