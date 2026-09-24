// Opt-in real-Postgres proof of outcome atomicity, replay idempotence, and
// bounded due-claim paging. This suite owns only its disposable database.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  insertCustodyParcelRowIn,
  MAIL_CUSTODY_PARCELS_SCHEMA,
} from '../server/mail_custody_overlay';
import { mailRecipientKey } from '../server/mail_partition_backfill';
import { REALM } from '../server/realm';
import { commitVaultDirectClaim } from '../server/vault_direct_claim';
import { loadVaultMailRecovery } from '../server/vault_mail_recovery_db';
import { VaultRewardService } from '../server/vault_reward_service';
import {
  createVaultRewardsDb,
  markVaultRewardClaimBooked,
  VAULT_REWARDS_SCHEMA,
  type VaultOutcomeInput,
  vaultCustodyParcelStatus,
  vaultRewardClaimChannel,
} from '../server/vault_rewards_db';
import type { CharacterState } from '../src/sim/character_state';
import { HOARD_BASE_ITEM_IDS, hoardLootVariantId } from '../src/sim/content/hoard_loot';
import type { Sim } from '../src/sim/sim';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_vault_rewards_verify';
const describeDb = ADMIN_URL ? describe : describe.skip;

function verifyUrl(admin: string): string {
  const url = new URL(admin);
  url.pathname = `/${VERIFY_DB}`;
  return url.toString();
}

describeDb('vault reward ledger (REAL Postgres)', () => {
  let admin: Pool;
  let pool: Pool;

  beforeAll(async () => {
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    expect(own).not.toBe(VERIFY_DB);
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);
    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 4 });
    await pool.query(VAULT_REWARDS_SCHEMA);
    await pool.query(MAIL_CUSTODY_PARCELS_SCHEMA);
    await pool.query(
      `CREATE TABLE characters (id BIGINT PRIMARY KEY, realm TEXT NOT NULL, state JSONB)`,
    );
    await pool.query(`CREATE TABLE world_state (key TEXT PRIMARY KEY, data JSONB)`);
    await pool.query(
      `CREATE TABLE vault_test_characters (character_id BIGINT PRIMARY KEY, state JSONB NOT NULL)`,
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  const due = new Date('2026-09-24T00:05:00.000Z');
  const outcome: VaultOutcomeInput = {
    attemptId: '72:1',
    ownerCharacterId: 72,
    claims: [
      {
        characterId: 72,
        recipientName: 'Owner',
        items: [{ itemId: 'rusty_hatchet', count: 1 }],
        copper: 125,
        mailDueAt: due,
      },
      {
        characterId: 73,
        recipientName: 'Guest',
        items: [{ itemId: 'treasure_map_b', count: 1 }],
        copper: 80,
        mailDueAt: due,
      },
    ],
  };

  it('reads the capped paid-cycle usage before and after a mail-backed claim', async () => {
    const db = createVaultRewardsDb(pool, 'GuestUsageRealm');
    expect(await db.guestPayoutsForCycle(801, 'wq1_10')).toBe(0);
    await pool.query(`INSERT INTO characters (id, realm, state) VALUES ($1, $2, $3::jsonb)`, [
      801,
      'GuestUsageRealm',
      JSON.stringify({ worldQuests: { vaultGuestCycle: 'wq1_10', vaultGuestPayouts: 1 } }),
    ]);
    for (let n = 1; n <= 3; n++) {
      await db.commitVaultOutcome({
        attemptId: `801:usage:${n}`,
        ownerCharacterId: 800,
        claims: [
          { characterId: 800, recipientName: 'Owner', items: [], copper: 1, mailDueAt: due },
          {
            characterId: 801,
            recipientName: 'Guest',
            items: [],
            copper: 1,
            mailDueAt: due,
            guestCycle: 'wq1_10',
          },
        ],
      });
      expect(await db.guestPayoutsForCycle(801, 'wq1_10')).toBe(Math.min(3, n + 1));
    }
    expect((await db.loadVaultOutcome('801:usage:3'))?.claims[1].copper).toBe(0);
    expect(await db.guestPayoutsForCycle(801, 'wq1_11')).toBe(0);
  });

  it('atomically records every participant, preserves the first payload, and pages due claims', async () => {
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    const results = await Promise.all([
      db.commitVaultOutcome(outcome),
      db.commitVaultOutcome(outcome),
    ]);
    expect(results.sort()).toEqual(['already_committed', 'created']);
    expect(await db.loadVaultOutcome(outcome.attemptId)).toMatchObject({
      attemptId: outcome.attemptId,
      ownerCharacterId: 72,
      claims: [
        { characterId: 72, copper: 125 },
        { characterId: 73, copper: 80 },
      ],
    });
    await expect(
      db.commitVaultOutcome({
        ...outcome,
        claims: [{ ...outcome.claims[0], copper: 999 }, outcome.claims[1]],
      }),
    ).rejects.toThrow('conflicting vault outcome payload');
    expect(await db.dueVaultRewardClaims(10, new Date(due.getTime() - 1))).toEqual([]);
    expect((await db.dueVaultRewardClaims(1, due)).map((claim) => claim.characterId)).toEqual([72]);
    expect((await db.dueVaultRewardClaims(10, due)).map((claim) => claim.characterId)).toEqual([
      72, 73,
    ]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect(await markVaultRewardClaimBooked(client, 'VaultRealm', '72:1', 72, 'mail')).toBe(true);
      expect(await markVaultRewardClaimBooked(client, 'VaultRealm', '72:1', 72, 'direct')).toBe(
        false,
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect((await db.dueVaultRewardClaims(10, due)).map((claim) => claim.characterId)).toEqual([
      73,
    ]);
    const index = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'vault_reward_claims'
       AND indexname = 'vault_reward_claims_due_mail'`,
    );
    expect(index.rowCount).toBe(1);
  });

  it('rolls back the outcome if a later participant claim insert fails', async () => {
    await pool.query(`
      CREATE FUNCTION reject_vault_claim() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.character_id = 99 THEN
          RAISE EXCEPTION 'forced claim insert failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_vault_claim BEFORE INSERT ON vault_reward_claims
      FOR EACH ROW EXECUTE FUNCTION reject_vault_claim();
    `);
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    await expect(
      db.commitVaultOutcome({
        attemptId: '72:2',
        ownerCharacterId: 72,
        claims: [outcome.claims[0], { ...outcome.claims[1], characterId: 99 }],
      }),
    ).rejects.toThrow('forced claim insert failure');
    expect(await db.loadVaultOutcome('72:2')).toBeNull();
    const rows = await pool.query(
      `SELECT count(*)::int AS count FROM vault_reward_claims
       WHERE realm = 'VaultRealm' AND attempt_id = '72:2'`,
    );
    expect(rows.rows[0].count).toBe(0);
  });

  it('commits a direct reward with its claim marker; a competing mail CAS cannot duplicate it', async () => {
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    const claim = (await db.loadVaultOutcome('72:1'))?.claims.find((row) => row.characterId === 73);
    expect(claim).toBeDefined();
    if (!claim) throw new Error('guest claim missing');
    const state = {
      level: 20,
      xp: 0,
      copper: 10,
      hp: 100,
      resource: 0,
      pos: { x: 0, z: 0 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
      worldQuests: { cycle: '2026-09-23', progress: [] },
    } as unknown as CharacterState;
    await pool.query('INSERT INTO vault_test_characters VALUES ($1, $2::jsonb)', [
      73,
      JSON.stringify(state),
    ]);
    const direct = await commitVaultDirectClaim(
      {
        pool,
        saveCharacter: async (client, saved) => {
          const result = await client.query(
            'UPDATE vault_test_characters SET state = $2::jsonb WHERE character_id = $1',
            [73, JSON.stringify(saved)],
          );
          return result.rowCount === 1;
        },
      },
      { realm: 'VaultRealm', attemptId: '72:1', claim, owner: false, state },
    );
    expect(direct).toBe('delivered');
    const stored = await pool.query(
      'SELECT state FROM vault_test_characters WHERE character_id = 73',
    );
    expect(stored.rows[0].state.copper).toBe(90);
    expect(stored.rows[0].state.inventory).toEqual([{ itemId: 'treasure_map_b', count: 1 }]);
    expect(await db.dueVaultRewardClaims(10, due)).toEqual([]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect(await markVaultRewardClaimBooked(client, 'VaultRealm', '72:1', 73, 'mail')).toBe(
        false,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('rolls a mail parcel and claim marker back together, then books both once', async () => {
    await pool.query(
      `INSERT INTO characters (id, realm, state) VALUES (72, 'VaultRealm', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    await db.commitVaultOutcome({
      attemptId: '72:3',
      ownerCharacterId: 72,
      claims: [{ ...outcome.claims[0], items: [{ itemId: 'thorium_ore', count: 2 }], copper: 44 }],
    });
    const row = {
      custodyRef: 'vault:VaultRealm:72:3:72',
      recipient: { key: '72', name: 'Owner' },
      letter: 'vault_reward' as const,
      items: [{ itemId: 'thorium_ore', count: 2 }],
      copper: 44,
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await insertCustodyParcelRowIn((sql, values) => client.query(sql, values), row);
      expect(await markVaultRewardClaimBooked(client, 'VaultRealm', '72:3', 72, 'mail')).toBe(true);
      await client.query('ROLLBACK');
      expect(
        (
          await pool.query('SELECT * FROM mail_custody_parcels WHERE custody_ref = $1', [
            row.custodyRef,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (await db.dueVaultRewardClaims(10, due)).some((claim) => claim.attemptId === '72:3'),
      ).toBe(true);
      await client.query('BEGIN');
      await insertCustodyParcelRowIn((sql, values) => client.query(sql, values), row);
      expect(await markVaultRewardClaimBooked(client, 'VaultRealm', '72:3', 72, 'mail')).toBe(true);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const parcels = await pool.query(
      'SELECT items, copper FROM mail_custody_parcels WHERE custody_ref = $1',
      [row.custodyRef],
    );
    expect(parcels.rows).toEqual([{ items: row.items, copper: '44' }]);
    expect(await vaultCustodyParcelStatus(pool, REALM, row)).toBe('matching');
    expect(
      await vaultCustodyParcelStatus(pool, REALM, {
        ...row,
        items: [{ count: 2, itemId: 'thorium_ore' }],
      }),
    ).toBe('matching');
    expect(await vaultCustodyParcelStatus(pool, REALM, { ...row, copper: 45 })).toBe('conflict');
    expect(await loadVaultMailRecovery(pool, REALM, 72, row.custodyRef)).toMatchObject({
      copper: 44,
      items: row.items,
    });
    await pool.query(`INSERT INTO world_state (key, data) VALUES ($1, $2::jsonb)`, [
      mailRecipientKey(REALM, '72'),
      JSON.stringify({
        mail: [
          {
            recipientKey: '72',
            recipientName: 'Owner',
            letterId: 'hoard_vault_reward',
            custodyRef: row.custodyRef,
            copper: 10,
            items: [],
            read: true,
            vaultRewardCredited: true,
          },
        ],
      }),
    ]);
    expect(await loadVaultMailRecovery(pool, REALM, 72, row.custodyRef)).toMatchObject({
      copper: 10,
      items: [],
      read: true,
      vaultRewardCredited: true,
    });
    await pool.query('UPDATE world_state SET data = $2::jsonb WHERE key = $1', [
      mailRecipientKey(REALM, '72'),
      JSON.stringify({
        mail: [
          {
            recipientKey: '72',
            recipientName: 'Owner',
            letterId: 'hoard_vault_reward',
            custodyRef: row.custodyRef,
            copper: 0,
            items: [],
            read: true,
            vaultRewardCredited: true,
          },
        ],
      }),
    ]);
    expect(await loadVaultMailRecovery(pool, REALM, 72, row.custodyRef)).toBeNull();
    expect(
      (await db.dueVaultRewardClaims(10, due)).some((claim) => claim.attemptId === '72:3'),
    ).toBe(false);
  });

  it('waits for an ambiguous character and mail save before restoring a vault letter', async () => {
    await pool.query(
      `INSERT INTO characters (id, realm, state) VALUES (72, 'VaultRealm', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );
    const ref = 'vault:VaultRealm:72:late-commit:72';
    const key = mailRecipientKey(REALM, '72');
    const letter = (copper: number) => ({
      mail: [
        {
          recipientKey: '72',
          recipientName: 'Owner',
          letterId: 'hoard_vault_reward',
          custodyRef: ref,
          copper,
          items: copper > 0 ? [{ itemId: 'thorium_ore', count: 1 }] : [],
          read: copper === 0,
        },
      ],
    });
    await pool.query(
      `INSERT INTO world_state (key, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
      [key, JSON.stringify(letter(19))],
    );
    const oldSave = await pool.connect();
    try {
      await oldSave.query('BEGIN');
      await oldSave.query('UPDATE characters SET state = $2::jsonb WHERE id = $1', [
        72,
        JSON.stringify({ vaultRewardCredited: true }),
      ]);
      await oldSave.query('UPDATE world_state SET data = $2::jsonb WHERE key = $1', [
        key,
        JSON.stringify(letter(0)),
      ]);
      let settled = false;
      const recovery = loadVaultMailRecovery(pool, REALM, 72, ref).then((source) => {
        settled = true;
        return source;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      await oldSave.query('COMMIT');
      expect(await recovery).toBeNull();
    } finally {
      await oldSave.query('ROLLBACK').catch(() => {});
      oldSave.release();
    }
  });

  it('defers a full mailbox claim and wakes its oldest pending reward after collection', async () => {
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    const attemptId = '72:mail-cap';
    await db.commitVaultOutcome({
      attemptId,
      ownerCharacterId: 72,
      claims: [{ ...outcome.claims[0], mailDueAt: due }],
    });
    const later = new Date(due.getTime() + 600_000);
    expect(await db.deferVaultRewardClaim(attemptId, 72, later)).toBe(true);
    await db.commitVaultOutcome({
      attemptId: '72:mail-cap-second',
      ownerCharacterId: 72,
      claims: [{ ...outcome.claims[0], mailDueAt: due }],
    });
    expect(await db.deferVaultRewardClaim('72:mail-cap-second', 72, later)).toBe(true);
    await pool.query(
      `UPDATE vault_reward_claims
          SET mail_capacity_deferred_at = CASE attempt_id
            WHEN $2 THEN $4::timestamptz ELSE $5::timestamptz END
        WHERE realm = $1 AND character_id = $3 AND attempt_id IN ($2, $6)`,
      ['VaultRealm', attemptId, 72, due, later, '72:mail-cap-second'],
    );
    expect(await db.deferVaultRewardClaim(attemptId, 72, new Date(later.getTime() + 600_000))).toBe(
      true,
    );
    expect(
      (await db.dueVaultRewardClaims(100, due)).some((claim) => claim.attemptId === attemptId),
    ).toBe(false);
    const awakened = await db.wakeOldestVaultRewardClaim(72, due);
    expect(awakened?.attemptId).toBe(attemptId);
    expect((await db.wakeOldestVaultRewardClaim(72, due))?.attemptId).toBe('72:mail-cap-second');
    await db.commitVaultOutcome({
      attemptId: '72:not-yet-due',
      ownerCharacterId: 72,
      claims: [{ ...outcome.claims[0], mailDueAt: later }],
    });
    expect(await db.wakeOldestVaultRewardClaim(72, due)).toBeNull();
    expect(
      (await db.dueVaultRewardClaims(100, due)).some((claim) => claim.attemptId === attemptId),
    ).toBe(true);
  });

  it('reserves at most three guest payouts per cycle at clear, even before any chest or mail claim', async () => {
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    for (let sequence = 10; sequence < 14; sequence++) {
      const attemptId = `72:${sequence}`;
      const input: VaultOutcomeInput = {
        attemptId,
        ownerCharacterId: 72,
        claims: [
          { ...outcome.claims[0] },
          { ...outcome.claims[1], characterId: 74, guestCycle: 'cycle-1' },
        ],
      };
      expect(await db.commitVaultOutcome(input)).toBe('created');
      expect(await db.commitVaultOutcome(input)).toBe('already_committed');
      const guest = (await db.loadVaultOutcome(attemptId))?.claims.find(
        (claim) => claim.characterId === 74,
      );
      expect(guest?.copper).toBe(sequence === 13 ? 0 : 80);
      expect(guest?.items).toEqual(sequence === 13 ? [] : [{ itemId: 'treasure_map_b', count: 1 }]);
    }
  });

  it('honors guest payouts already saved before the new ledger was deployed', async () => {
    await pool.query(`INSERT INTO characters (id, realm, state) VALUES ($1, $2, $3::jsonb)`, [
      76,
      'VaultRealm',
      JSON.stringify({ worldQuests: { vaultGuestCycle: 'legacy', vaultGuestPayouts: 2 } }),
    ]);
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    for (const sequence of [30, 31]) {
      const attemptId = `72:${sequence}`;
      await db.commitVaultOutcome({
        attemptId,
        ownerCharacterId: 72,
        claims: [
          outcome.claims[0],
          { ...outcome.claims[1], characterId: 76, guestCycle: 'legacy' },
        ],
      });
      const guest = (await db.loadVaultOutcome(attemptId))?.claims.find(
        (claim) => claim.characterId === 76,
      );
      expect(guest?.copper).toBe(sequence === 30 ? 80 : 0);
    }
  });

  it('sanitizes malformed and out-of-range legacy guest counters before reserving a clear', async () => {
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    for (const [id, raw, paid] of [
      [90, 'oops', true],
      [91, -1, true],
      [92, 9999999999999, false],
    ] as const) {
      await pool.query('INSERT INTO characters (id, realm, state) VALUES ($1, $2, $3::jsonb)', [
        id,
        'VaultRealm',
        JSON.stringify({ worldQuests: { vaultGuestCycle: 'bad', vaultGuestPayouts: raw } }),
      ]);
      const attemptId = `72:bad-${id}`;
      expect(
        await db.commitVaultOutcome({
          attemptId,
          ownerCharacterId: 72,
          claims: [outcome.claims[0], { ...outcome.claims[1], characterId: id, guestCycle: 'bad' }],
        }),
      ).toBe('created');
      const guest = (await db.loadVaultOutcome(attemptId))?.claims.find(
        (claim) => claim.characterId === id,
      );
      expect(guest?.copper).toBe(paid ? 80 : 0);
    }
  });

  it('lets only one of simultaneous chest and mail transactions deliver a claim', async () => {
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    await db.commitVaultOutcome({
      attemptId: '72:20',
      ownerCharacterId: 72,
      claims: [outcome.claims[0], { ...outcome.claims[1], characterId: 75, guestCycle: 'race' }],
    });
    const claim = (await db.loadVaultOutcome('72:20'))?.claims.find(
      (row) => row.characterId === 75,
    );
    if (!claim) throw new Error('race claim missing');
    const state = {
      level: 20,
      xp: 0,
      copper: 10,
      hp: 100,
      resource: 0,
      pos: { x: 0, z: 0 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
      worldQuests: { cycle: 'race', progress: [] },
    } as unknown as CharacterState;
    await pool.query('INSERT INTO vault_test_characters VALUES ($1, $2::jsonb)', [
      75,
      JSON.stringify(state),
    ]);
    const direct = commitVaultDirectClaim(
      {
        pool,
        saveCharacter: async (client, saved) => {
          const updated = await client.query(
            'UPDATE vault_test_characters SET state = $2::jsonb WHERE character_id = $1',
            [75, JSON.stringify(saved)],
          );
          return updated.rowCount === 1;
        },
      },
      { realm: 'VaultRealm', attemptId: '72:20', claim, owner: false, state },
    );
    const mail = (async () => {
      const client = await pool.connect();
      const row = {
        custodyRef: 'vault:VaultRealm:72:20:75',
        recipient: { key: '75', name: 'Guest' },
        letter: 'vault_reward' as const,
        items: claim.items,
        copper: claim.copper,
      };
      try {
        await client.query('BEGIN');
        await insertCustodyParcelRowIn((sql, values) => client.query(sql, values), row);
        const booked = await markVaultRewardClaimBooked(client, 'VaultRealm', '72:20', 75, 'mail');
        await client.query(booked ? 'COMMIT' : 'ROLLBACK');
        return booked;
      } finally {
        client.release();
      }
    })();
    const [directResult, mailed] = await Promise.all([direct, mail]);
    expect(Number(directResult === 'delivered') + Number(mailed)).toBe(1);
    const stored = await pool.query(
      'SELECT state FROM vault_test_characters WHERE character_id = 75',
    );
    const overlay = await pool.query(
      'SELECT custody_ref FROM mail_custody_parcels WHERE custody_ref = $1',
      ['vault:VaultRealm:72:20:75'],
    );
    expect(stored.rows[0].state.copper).toBe(directResult === 'delivered' ? 90 : 10);
    expect(overlay.rowCount).toBe(mailed ? 1 : 0);
  });

  it('reloads direct-claim discovery metadata from the same committed character row', async () => {
    const db = createVaultRewardsDb(pool, 'VaultRealm');
    const baseId = HOARD_BASE_ITEM_IDS[0];
    const tierId = hoardLootVariantId(baseId, 'rare');
    await db.commitVaultOutcome({
      attemptId: '72:collection',
      ownerCharacterId: 77,
      claims: [
        {
          characterId: 77,
          recipientName: 'Collector',
          items: [{ itemId: tierId, count: 1 }],
          copper: 19,
          mailDueAt: due,
        },
      ],
    });
    const claim = (await db.loadVaultOutcome('72:collection'))?.claims[0];
    if (!claim) throw new Error('collection claim missing');
    const state = {
      level: 20,
      xp: 0,
      copper: 0,
      hp: 100,
      resource: 0,
      pos: { x: 0, z: 0 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
      worldQuests: { cycle: 'collection', progress: [] },
    } as unknown as CharacterState;
    await pool.query('INSERT INTO vault_test_characters VALUES ($1, $2::jsonb)', [
      77,
      JSON.stringify(state),
    ]);
    expect(
      await commitVaultDirectClaim(
        {
          pool,
          saveCharacter: async (client, saved) => {
            const result = await client.query(
              'UPDATE vault_test_characters SET state = $2::jsonb WHERE character_id = $1',
              [77, JSON.stringify(saved)],
            );
            return result.rowCount === 1;
          },
        },
        { realm: 'VaultRealm', attemptId: '72:collection', claim, owner: true, state },
      ),
    ).toBe('delivered');
    const reloaded = await pool.query(
      'SELECT state FROM vault_test_characters WHERE character_id = 77',
    );
    expect(reloaded.rows[0].state.deedStats.itemsDiscovered).toEqual(
      expect.arrayContaining([tierId, baseId]),
    );
    expect(reloaded.rows[0].state.reliquary.firstFind[baseId]).toEqual({ count: 1 });
    expect(reloaded.rows[0].state.copper).toBe(19);
    expect(await vaultRewardClaimChannel(pool, 'VaultRealm', '72:collection', 77)).toBe('direct');
  });

  it('runs the real service mail sweep at its due boundary, skips direct claims, and isolates bad rows', async () => {
    const realm = REALM;
    const db = createVaultRewardsDb(pool, realm);
    const attemptId = '72:service-mail';
    await db.commitVaultOutcome({
      attemptId,
      ownerCharacterId: 77,
      claims: [
        {
          characterId: 77,
          recipientName: 'Bad',
          items: [{ itemId: 'not_a_real_item', count: 1 }],
          copper: 0,
          mailDueAt: due,
        },
        {
          characterId: 78,
          recipientName: 'Good',
          items: [{ itemId: 'rusty_hatchet', count: 1 }],
          copper: 7,
          mailDueAt: due,
        },
        {
          characterId: 79,
          recipientName: 'Direct',
          items: [{ itemId: 'rusty_hatchet', count: 1 }],
          copper: 8,
          mailDueAt: due,
        },
      ],
    });
    const directClient = await pool.connect();
    try {
      await directClient.query('BEGIN');
      expect(await markVaultRewardClaimBooked(directClient, realm, attemptId, 79, 'direct')).toBe(
        true,
      );
      await directClient.query('COMMIT');
    } finally {
      directClient.release();
    }
    const live = new Set<string>();
    const mailSystemParcel = vi.fn((_recipient, _letter, _items, ref: string) => {
      live.add(ref);
      return true;
    });
    const onClaimFailure = vi.fn();
    const host = {
      sim: {
        mailSystemParcel,
        hasCustodyParcel: (ref: string) => live.has(ref),
        canBookVaultRewardMail: () => true,
      } as unknown as Sim,
      withPermit: async <T>(run: () => Promise<T>) => run(),
      saveOwner: async () => true,
      claimDirect: async () => 'retry' as const,
      characterPid: () => null,
      onClaimFailure,
    };
    const dueRead = vi.spyOn(db, 'dueVaultRewardClaims');
    const service = new VaultRewardService(host, db, pool);
    service.tick(due.getTime() - 30_000);
    await vi.waitFor(() => expect(dueRead).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect((service as unknown as { mailing: boolean }).mailing).toBe(false),
    );
    expect(mailSystemParcel).not.toHaveBeenCalled();
    service.tick(due.getTime());
    const goodRef = `vault:${realm}:${attemptId}:78`;
    await vi.waitFor(() => expect(live.has(goodRef)).toBe(true));
    expect(onClaimFailure).toHaveBeenCalledWith(77, expect.any(Error));
    expect(live.has(`vault:${realm}:${attemptId}:79`)).toBe(false);
    const claims = await pool.query(
      'SELECT character_id, direct_claimed_at, mail_booked_at FROM vault_reward_claims WHERE realm = $1 AND attempt_id = $2 ORDER BY character_id',
      [realm, attemptId],
    );
    expect(claims.rows[0].mail_booked_at).toBeNull();
    expect(claims.rows[1].mail_booked_at).not.toBeNull();
    expect(claims.rows[2].direct_claimed_at).not.toBeNull();
    expect(claims.rows[2].mail_booked_at).toBeNull();
    expect(await vaultRewardClaimChannel(pool, realm, attemptId, 77)).toBe('pending');
    expect(await vaultRewardClaimChannel(pool, realm, attemptId, 78)).toBe('mail');
    expect(await vaultRewardClaimChannel(pool, realm, attemptId, 79)).toBe('direct');
    const parcel = await pool.query(
      'SELECT realm FROM mail_custody_parcels WHERE custody_ref = $1',
      [goodRef],
    );
    expect(parcel.rows).toEqual([{ realm }]);
  });
});
