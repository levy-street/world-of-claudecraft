// The atomic roster page purchase against a REAL Postgres
// (server/guild_roster_page_db.ts): the compare-and-set, the receipt, and the
// lease-fenced character save share one COMMIT, a stale count or a lost lease
// writes nothing, and two purchases racing from the same count buy exactly
// one page. Set TEST_DATABASE_URL to run (CI does); skipped otherwise. The
// unit suite (tests/guild_roster_page_db.test.ts) fakes the save seams, so
// this is the one place the real statements, locks, and constraints meet.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CharacterState } from '../src/sim/character_state';
import { Sim } from '../src/sim/sim';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_guild_roster_page_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load and builds its pool from it.
// Nothing above is a static import of a server module, so this assignment runs
// first and points the boot path at the disposable database.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

const REALM_NAME = 'roster-verify';
const LEASE = 'lease-roster-1';

/** A REAL serialized character (the save path sanitizes bags, quests, and
 *  friends, so a bare object is not a CharacterState), with the purse set. */
function characterState(copper: number): CharacterState {
  const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true });
  const state = sim.serializeCharacter(sim.playerId);
  if (!state) throw new Error('sim did not serialize its player');
  return { ...state, copper };
}

describeDb('guild roster page purchase against real Postgres', () => {
  let admin: Pool;
  let pool: Pool;
  let db: typeof import('../server/db');
  let pageDb: typeof import('../server/guild_roster_page_db');
  let seq = 0;

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
    pageDb = await import('../server/guild_roster_page_db');
    await db.ensureSchema();
    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 8 });
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  interface Fixture {
    accountId: number;
    characterId: number;
    guildId: number;
  }

  async function seed(rank: 'leader' | 'officer' = 'leader'): Promise<Fixture> {
    seq += 1;
    const account = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`roster-fixture-${seq}`],
    );
    const accountId = Number(account.rows[0].id);
    const character = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 10, '{"copper": 500000}'::jsonb) RETURNING id`,
      [accountId, `RosterChar${seq}`, REALM_NAME],
    );
    const characterId = Number(character.rows[0].id);
    await pool.query(
      `INSERT INTO character_leases (character_id, realm, holder, nonce, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
      [characterId, REALM_NAME, db.PROCESS_LEASE_HOLDER, LEASE],
    );
    const guild = await pool.query(
      `INSERT INTO guilds (name, realm) VALUES ($1, $2) RETURNING id`,
      [`Roster Guild ${seq}`, REALM_NAME],
    );
    const guildId = Number(guild.rows[0].id);
    await pool.query(
      `INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, $3)`,
      [guildId, characterId, rank],
    );
    return { accountId, characterId, guildId };
  }

  function args(
    f: Fixture,
    over: Partial<import('../server/guild_roster_page_db').GuildRosterPageArgs> = {},
  ) {
    seq += 1;
    return {
      guildId: f.guildId,
      expectedPages: 0,
      characterId: f.characterId,
      accountId: f.accountId,
      level: 10,
      state: characterState(100_000),
      leaseNonce: LEASE,
      storageEffects: [],
      ledgerEffects: undefined,
      receipt: { batchKey: `roster:verify:${seq}`, copper: 400_000 },
      ...over,
    };
  }

  function deps() {
    return { pool: pool as never, bustGuildRoster: vi.fn() };
  }

  async function rosterState(f: Fixture) {
    const guild = await pool.query('SELECT roster_pages FROM guilds WHERE id = $1', [f.guildId]);
    const receipts = await pool.query(
      'SELECT page, character_id, copper FROM guild_roster_receipts WHERE guild_id = $1 ORDER BY page',
      [f.guildId],
    );
    const character = await pool.query(
      `SELECT level, state->>'copper' AS copper FROM characters WHERE id = $1`,
      [f.characterId],
    );
    return {
      pages: Number(guild.rows[0].roster_pages),
      receipts: receipts.rows.map((r) => ({
        page: Number(r.page),
        characterId: Number(r.character_id),
        copper: Number(r.copper),
      })),
      level: Number(character.rows[0].level),
      copper: Number(character.rows[0].copper),
    };
  }

  it('commits the page, the receipt, and the charged purse in one COMMIT', async () => {
    const f = await seed();
    const d = deps();
    await expect(pageDb.buyGuildRosterPageAtomic(d, args(f))).resolves.toEqual({
      durability: 'committed',
      pages: 1,
    });
    expect(await rosterState(f)).toEqual({
      pages: 1,
      receipts: [{ page: 1, characterId: f.characterId, copper: 400_000 }],
      level: 10,
      copper: 100_000,
    });
    expect(d.bustGuildRoster).toHaveBeenCalledWith(f.guildId);
  });

  it('a stale count writes nothing: no page, no receipt, no save', async () => {
    const f = await seed();
    await pageDb.buyGuildRosterPageAtomic(deps(), args(f));
    const stale = await pageDb.buyGuildRosterPageAtomic(
      deps(),
      args(f, { expectedPages: 0, state: characterState(77_777) }),
    );
    expect(stale).toEqual({ durability: 'not_committed', reason: 'stale' });
    const state = await rosterState(f);
    expect(state.pages).toBe(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.copper).toBe(100_000);
  });

  it('a lost lease rolls the page and the receipt back with the save', async () => {
    const f = await seed();
    const result = await pageDb.buyGuildRosterPageAtomic(
      deps(),
      args(f, { leaseNonce: 'lease-somebody-else' }),
    );
    expect(result).toEqual({ durability: 'not_committed', reason: 'lease_lost' });
    expect(await rosterState(f)).toEqual({ pages: 0, receipts: [], level: 10, copper: 500_000 });
  });

  it('a buyer who is no longer the Guild Master misses the compare-and-set', async () => {
    const f = await seed('officer');
    await expect(pageDb.buyGuildRosterPageAtomic(deps(), args(f))).resolves.toEqual({
      durability: 'not_committed',
      reason: 'stale',
    });
    expect((await rosterState(f)).pages).toBe(0);
  });

  it('two purchases racing from the same count buy exactly one page', async () => {
    const f = await seed();
    const [a, b] = await Promise.all([
      pageDb.buyGuildRosterPageAtomic(deps(), args(f)),
      pageDb.buyGuildRosterPageAtomic(deps(), args(f)),
    ]);
    const outcomes = [a.durability, b.durability].sort();
    expect(outcomes).toEqual(['committed', 'not_committed']);
    const loser = a.durability === 'committed' ? b : a;
    expect(loser).toEqual({ durability: 'not_committed', reason: 'stale' });
    const state = await rosterState(f);
    expect(state.pages).toBe(1);
    expect(state.receipts).toHaveLength(1);
  });

  it('a tampered negative count heals to page one instead of refusing forever', async () => {
    const f = await seed();
    await pool.query('UPDATE guilds SET roster_pages = -5 WHERE id = $1', [f.guildId]);
    await expect(pageDb.buyGuildRosterPageAtomic(deps(), args(f))).resolves.toEqual({
      durability: 'committed',
      pages: 1,
    });
    expect((await rosterState(f)).pages).toBe(1);
  });
});
