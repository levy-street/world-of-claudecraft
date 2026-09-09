// Opt-in REAL-Postgres MECHANISM proof for the material source journal
// (server/material_source_journal_db.ts).
//
// SCOPE, read this before trusting it: this suite proves only that the schema
// and the one batched statement behave the way the module claims (lazy anchor
// at revision 1, established-anchor opening omission, safe false negatives,
// stale-proof rollback, the two deletion stories, and a journal that replays
// through the shared ledger core). It is NOT proof of save integration: no
// ensureSchema, no GameServer, no character-save adapter, no guild book merge
// and no realm boot runs here, and no lock-strength, growth-budget or latency
// claim is measured. The concurrency case below locks a stand-in container row
// directly; concurrency of the ACTUAL save paths is the parent's to prove.
//
// Isolation: everything happens inside one disposable schema whose name is
// generated locally from hex (a trusted identifier, shape-asserted before it is
// ever interpolated) and dropped in `finally`. `characters` here is a MINIMAL
// stand-in carrying the id the foreign key needs and the state used by the
// rollback proof; no real public table is created, replaced or dropped. The
// module's own SQL is unqualified,
// so every connection that runs it has search_path set to the disposable schema
// ALONE and can never resolve a public table; that guarantee is checked against
// a BASELINE of public taken before anything is applied.
//
// Gated on TEST_DATABASE_URL like every other *_pg_integration.test.ts: without
// it the file skips green and CI's DB-free floor is unchanged.

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MATERIAL_SOURCE_CONTAINERS_TABLE,
  MATERIAL_SOURCE_JOURNAL_SCHEMA,
  MATERIAL_SOURCE_JOURNAL_TABLE,
  type MaterialSourceContainerChange,
  type MaterialSourceJournalWriteResult,
  writeMaterialSourceJournal,
} from '../server/material_source_journal_db';
import {
  applyMaterialContainerDeltas,
  type MaterialContainerProjection,
  type MaterialMovementRow,
  projectMaterialContainer,
} from '../server/material_source_ledger';
import type { MaterialComposition, MaterialSource } from '../src/sim/material_sources';
import type { MaterialStackSlot } from '../src/sim/material_stack';

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

/** Generated locally, never caller-supplied; the shape is asserted before use. */
const SCHEMA = `woc_msj_test_${randomBytes(8).toString('hex')}`;
const REALM = 'woc-msj';
const MATERIALS: ReadonlySet<string> = new Set(['ore', 'herb']);

const A: MaterialSource = { gatherer: { kind: 'character', id: 1, name: 'Ayla' } };
const B: MaterialSource = { gatherer: { kind: 'character', id: 2, name: 'Bran' } };

const held = (source: MaterialSource, count: number) => ({ source, count });

const slot = (itemId: string, count: number, sources: MaterialComposition): MaterialStackSlot => ({
  itemId,
  count,
  materialSources: sources,
});

const qualified = (table: string): string => `${SCHEMA}.${table}`;

/** Character ids are per-case so no two cases can share a container. */
const CHARACTERS = [11, 12, 13, 14, 15, 16, 17, 18] as const;
const MISSING_CHARACTER = 999_001;
const GUILD_ID = 42;

function change(
  overrides: Partial<MaterialSourceContainerChange> & { readonly ownerId: number },
): MaterialSourceContainerChange {
  return {
    realm: REALM,
    container: 'personal',
    before: [slot('ore', 3, [held(A, 3)])],
    after: [slot('ore', 4, [held(A, 4)])],
    ...overrides,
  };
}

/** The proof shape returned by a locked live character pre-image. */
function establishedChange(
  overrides: Partial<MaterialSourceContainerChange> & { readonly ownerId: number },
): MaterialSourceContainerChange {
  return change({ ...overrides, anchorExists: true });
}

async function writeOk(
  client: Client,
  changes: readonly MaterialSourceContainerChange[],
): Promise<MaterialSourceJournalWriteResult> {
  const result = await writeMaterialSourceJournal(client, changes, MATERIALS);
  if (!result.ok) throw new Error(`expected a write, got ${result.error}`);
  return result.value;
}

const ANCHOR_INSERT_SQL = `INSERT INTO ${qualified(MATERIAL_SOURCE_CONTAINERS_TABLE)}
    (realm, container, owner_id, owner_character_id, opening, current_revision)
  VALUES ($1, $2, $3, $4, $5::jsonb, 1)`;

interface InsertRefusal {
  readonly code?: string;
  readonly constraint?: string;
}

/**
 * A direct anchor INSERT that bypasses the writer entirely, so the DDL has to
 * answer for itself. Autocommit: a refusal aborts only its own statement, so
 * each ownership case is isolated from the next.
 */
async function insertAnchorDirect(
  admin: Client,
  container: string,
  ownerId: number,
  ownerCharacterId: number | null,
): Promise<InsertRefusal | null> {
  try {
    await admin.query(ANCHOR_INSERT_SQL, [
      REALM,
      container,
      ownerId,
      ownerCharacterId,
      '{"entries":[]}',
    ]);
    return null;
  } catch (err) {
    const raised = err as { code?: string; constraint?: string };
    return { code: raised.code, constraint: raised.constraint };
  }
}

interface AnchorRow {
  readonly opening: MaterialContainerProjection;
  readonly revision: string;
  readonly ownerCharacterId: number | null;
}

async function anchorOf(
  admin: Client,
  container: string,
  ownerId: number,
): Promise<AnchorRow | null> {
  const read = await admin.query(
    `SELECT opening, current_revision::text AS revision, owner_character_id
       FROM ${qualified(MATERIAL_SOURCE_CONTAINERS_TABLE)}
      WHERE realm = $1 AND container = $2 AND owner_id = $3`,
    [REALM, container, ownerId],
  );
  const row = read.rows[0];
  if (row === undefined) return null;
  return {
    opening: row.opening as MaterialContainerProjection,
    revision: String(row.revision),
    ownerCharacterId: row.owner_character_id === null ? null : Number(row.owner_character_id),
  };
}

async function journalOf(
  admin: Client,
  container: string,
  ownerId: number,
): Promise<{ revision: string; movements: readonly MaterialMovementRow[] }[]> {
  const read = await admin.query(
    `SELECT revision::text AS revision, movements
       FROM ${qualified(MATERIAL_SOURCE_JOURNAL_TABLE)}
      WHERE realm = $1 AND container = $2 AND owner_id = $3
      ORDER BY revision`,
    [REALM, container, ownerId],
  );
  return read.rows.map((row) => ({
    revision: String(row.revision),
    movements: row.movements as readonly MaterialMovementRow[],
  }));
}

/** Sorted names of THIS feature's tables inside one schema. */
async function featureTablesIn(admin: Client, schema: string): Promise<string[]> {
  const read = await admin.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = ANY($2::text[])`,
    [schema, [MATERIAL_SOURCE_CONTAINERS_TABLE, MATERIAL_SOURCE_JOURNAL_TABLE]],
  );
  return read.rows.map((row) => String(row.table_name)).sort();
}

async function openWriter(): Promise<Client> {
  const client = new Client({ connectionString: TEST_URL });
  await client.connect();
  // The module's SQL is unqualified: this is what makes it resolve to the
  // disposable schema, and ONLY to it.
  await client.query(`SET search_path = ${SCHEMA}`);
  return client;
}

describeDb('material source journal (REAL Postgres)', () => {
  let admin: Client;
  let writer: Client;
  let rival: Client;
  let minted = false;
  let publicBaseline: string[] = [];

  beforeAll(async () => {
    expect(SCHEMA).toMatch(/^woc_msj_test_[0-9a-f]{16}$/);

    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    publicBaseline = await featureTablesIn(admin, 'public');
    // A collision would mean adopting someone else's schema; refuse instead.
    const existing = await admin.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [SCHEMA]);
    expect(existing.rowCount).toBe(0);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    minted = true;

    // The minimal stand-in the schema's foreign key and rollback proof need.
    await admin.query(
      `CREATE TABLE ${qualified('characters')} (
         id SERIAL PRIMARY KEY,
         name TEXT NOT NULL,
         state JSONB NOT NULL DEFAULT '{"saved":"old"}'::jsonb
       )`,
    );
    for (const id of CHARACTERS) {
      await admin.query(`INSERT INTO ${qualified('characters')} (id, name) VALUES ($1, $2)`, [
        id,
        `msj-${id}`,
      ]);
    }

    await admin.query(`SET search_path = ${SCHEMA}`);
    await admin.query(MATERIAL_SOURCE_JOURNAL_SCHEMA);

    writer = await openWriter();
    rival = await openWriter();
  }, 120_000);

  afterAll(async () => {
    await writer?.end().catch(() => {});
    await rival?.end().catch(() => {});
    try {
      if (minted) await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await admin?.end().catch(() => {});
    }
  }, 60_000);

  it('creates the feature tables in the disposable schema only', async () => {
    expect(await featureTablesIn(admin, SCHEMA)).toEqual(
      [MATERIAL_SOURCE_CONTAINERS_TABLE, MATERIAL_SOURCE_JOURNAL_TABLE].sort(),
    );
    expect(await featureTablesIn(admin, 'public')).toEqual(publicBaseline);
  });

  it('re-applies its schema idempotently', async () => {
    await admin.query(MATERIAL_SOURCE_JOURNAL_SCHEMA);
    expect(await featureTablesIn(admin, SCHEMA)).toEqual(
      [MATERIAL_SOURCE_CONTAINERS_TABLE, MATERIAL_SOURCE_JOURNAL_TABLE].sort(),
    );
  });

  // The ownership CHECK is written as one OR of two arms. A three-valued arm
  // that evaluates to NULL is NOT a violation in SQL, so an arm comparing a
  // NULL owning character to the owner id passes the constraint instead of
  // failing it. These cases ask the database directly, because a writer that
  // always fills the column can never reveal it. Owner ids here are outside
  // every other case's range, so a wrongly ADMITTED row cannot disturb them.
  const OWNERSHIP_CHECK = 'material_source_containers_owner_character';

  it('refuses a personal anchor whose owning character is NULL', async () => {
    const refusal = await insertAnchorDirect(admin, 'personal', 8101, null);
    expect(refusal?.code).toBe('23514');
    expect(refusal?.constraint).toBe(OWNERSHIP_CHECK);
  });

  it('refuses a vault anchor whose owning character is NULL', async () => {
    const refusal = await insertAnchorDirect(admin, 'vault', 8102, null);
    expect(refusal?.code).toBe('23514');
    expect(refusal?.constraint).toBe(OWNERSHIP_CHECK);
  });

  it('refuses a guild anchor that names an owning character', async () => {
    // A real, existing character id, so the CHECK is unambiguously what refuses
    // this row rather than the foreign key.
    const refusal = await insertAnchorDirect(admin, 'guild', 8103, CHARACTERS[0]);
    expect(refusal?.code).toBe('23514');
    expect(refusal?.constraint).toBe(OWNERSHIP_CHECK);
  });

  it('mints the anchor lazily at revision 1 with the exact opening, then only increments', async () => {
    const owner = CHARACTERS[0];
    const opening = projectMaterialContainer([slot('ore', 3, [held(A, 3)])], MATERIALS);
    expect(opening.ok).toBe(true);

    const first = await writeOk(writer, [change({ ownerId: owner })]);
    expect(first.writes[0].revision).toBe('1');
    expect(first.writes[0].anchorCreated).toBe(true);
    expect(first.anchorsCreated).toBe(1);

    const anchor = await anchorOf(admin, 'personal', owner);
    expect(anchor?.revision).toBe('1');
    expect(anchor?.ownerCharacterId).toBe(owner);
    expect(anchor?.opening).toEqual(opening.ok ? opening.value : null);

    // A second save whose before-state is the first save's after-state. The
    // opening must stay the ORIGINAL one, whatever this write's before is.
    const second = await writeOk(writer, [
      establishedChange({
        ownerId: owner,
        before: [slot('ore', 4, [held(A, 4)])],
        after: [slot('ore', 4, [held(A, 3), held(B, 1)])],
      }),
    ]);
    expect(second.writes[0].revision).toBe('2');
    expect(second.writes[0].anchorCreated).toBe(false);
    expect(second.anchorsCreated).toBe(0);

    const after = await anchorOf(admin, 'personal', owner);
    expect(after?.revision).toBe('2');
    expect(after?.opening).toEqual(anchor?.opening);
    expect((await journalOf(admin, 'personal', owner)).map((row) => row.revision)).toEqual([
      '1',
      '2',
    ]);

    // A false negative is safe: it resends the whole current before-state, and
    // the conflict arm still preserves the original opening.
    const third = await writeOk(writer, [
      change({
        ownerId: owner,
        anchorExists: false,
        before: [slot('ore', 4, [held(A, 3), held(B, 1)])],
        after: [slot('ore', 5, [held(A, 4), held(B, 1)])],
      }),
    ]);
    expect(third.writes[0].revision).toBe('3');
    expect((await anchorOf(admin, 'personal', owner))?.opening).toEqual(anchor?.opening);
  });

  it('rolls back the blob when a proven anchor vanishes before the journal write', async () => {
    const owner = CHARACTERS[7];
    await writeOk(writer, [change({ ownerId: owner })]);
    const originalAnchor = await anchorOf(admin, 'personal', owner);

    await writer.query('BEGIN');
    await writer.query(`UPDATE ${qualified('characters')} SET state = $2::jsonb WHERE id = $1`, [
      owner,
      '{"saved":"new"}',
    ]);
    await writer.query(
      `DELETE FROM ${qualified(MATERIAL_SOURCE_CONTAINERS_TABLE)}
        WHERE realm = $1 AND container = $2 AND owner_id = $3`,
      [REALM, 'personal', owner],
    );

    let code: string | undefined;
    try {
      await writeOk(writer, [
        establishedChange({
          ownerId: owner,
          before: [slot('ore', 4, [held(A, 4)])],
          after: [slot('ore', 5, [held(A, 5)])],
        }),
      ]);
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe('23502');
    await writer.query('ROLLBACK');

    const state = await admin.query(`SELECT state FROM ${qualified('characters')} WHERE id = $1`, [
      owner,
    ]);
    expect(state.rows[0]?.state).toEqual({ saved: 'old' });
    expect(await anchorOf(admin, 'personal', owner)).toEqual(originalAnchor);
    expect(await journalOf(admin, 'personal', owner)).toHaveLength(1);
  });

  it('rolls anchor and journal back together, and the next write reuses revision 1', async () => {
    const owner = CHARACTERS[1];
    await writer.query('BEGIN');
    const rolled = await writeOk(writer, [change({ ownerId: owner })]);
    expect(rolled.writes[0].revision).toBe('1');
    await writer.query('ROLLBACK');

    expect(await anchorOf(admin, 'personal', owner)).toBeNull();
    expect(await journalOf(admin, 'personal', owner)).toEqual([]);

    const again = await writeOk(writer, [change({ ownerId: owner })]);
    expect(again.writes[0].revision).toBe('1');
    expect((await anchorOf(admin, 'personal', owner))?.revision).toBe('1');
  });

  it('allocates nothing at all for a container that moved nothing', async () => {
    const owner = CHARACTERS[2];
    const idle = await writeOk(writer, [
      change({
        ownerId: owner,
        before: [slot('ore', 3, [held(A, 3)])],
        after: [slot('ore', 1, [held(A, 1)]), slot('ore', 2, [held(A, 2)])],
      }),
    ]);

    expect(idle).toEqual({
      writes: [],
      unchangedContainers: 1,
      anchorsCreated: 0,
      movementRows: 0,
    });
    expect(await anchorOf(admin, 'personal', owner)).toBeNull();
    expect(await journalOf(admin, 'personal', owner)).toEqual([]);
  });

  it('fails the whole batch when one container violates its foreign key', async () => {
    const good = CHARACTERS[3];
    let code: string | undefined;
    try {
      await writeOk(writer, [change({ ownerId: good }), change({ ownerId: MISSING_CHARACTER })]);
    } catch (err) {
      code = (err as { code?: string }).code;
    }

    expect(code).toBe('23503');
    expect(await anchorOf(admin, 'personal', good)).toBeNull();
    expect(await anchorOf(admin, 'personal', MISSING_CHARACTER)).toBeNull();
    expect(await journalOf(admin, 'personal', good)).toEqual([]);
  });

  it('keeps guild history when the contributing character is deleted, and reaps personal', async () => {
    const owner = CHARACTERS[4];
    await writeOk(writer, [
      change({ ownerId: owner }),
      change({ container: 'guild', ownerId: GUILD_ID }),
    ]);
    expect((await anchorOf(admin, 'guild', GUILD_ID))?.ownerCharacterId).toBeNull();

    await admin.query(`DELETE FROM ${qualified('characters')} WHERE id = $1`, [owner]);

    // The guild book's audit outlives the actor entirely.
    expect((await anchorOf(admin, 'guild', GUILD_ID))?.revision).toBe('1');
    expect(await journalOf(admin, 'guild', GUILD_ID)).toHaveLength(1);
    // The character's own storage takes its anchor AND its journal with it.
    expect(await anchorOf(admin, 'personal', owner)).toBeNull();
    expect(await journalOf(admin, 'personal', owner)).toEqual([]);
  });

  it('replays a count-0 descriptor swap exactly, through the shared ledger core', async () => {
    const owner = CHARACTERS[5];
    const before = [slot('ore', 2, [held(A, 2)])];
    const after = [slot('ore', 2, [held(A, 1), held(B, 1)])];

    const written = await writeOk(writer, [change({ ownerId: owner, before, after })]);
    expect(written.movementRows).toBe(1);

    const anchor = await anchorOf(admin, 'personal', owner);
    const rows = (await journalOf(admin, 'personal', owner)).flatMap((row) => row.movements);
    expect(rows).toEqual([
      {
        itemId: 'ore',
        count: 0,
        sourceDeltas: [
          { source: A, count: -1 },
          { source: B, count: 1 },
        ],
      },
    ]);

    const replayed = applyMaterialContainerDeltas(
      anchor?.opening as MaterialContainerProjection,
      rows,
    );
    const expected = projectMaterialContainer(after, MATERIALS);
    expect(replayed.ok && expected.ok).toBe(true);
    if (!replayed.ok || !expected.ok) return;
    expect(replayed.value).toEqual(expected.value);
  });

  it('serializes behind the container row lock the caller is required to hold', async () => {
    // The stand-in for the real container row is the character row itself. The
    // point proven here is the DISCIPLINE, not the save path: while one
    // transaction holds the row and journals, a second cannot take the row, and
    // once the first commits the second gets the NEXT revision, never a
    // duplicate one.
    const owner = CHARACTERS[6];
    const lock = `SELECT id FROM ${qualified('characters')} WHERE id = $1 FOR NO KEY UPDATE`;

    await writer.query('BEGIN');
    await writer.query(lock, [owner]);
    const first = await writeOk(writer, [change({ ownerId: owner })]);
    expect(first.writes[0].revision).toBe('1');

    await rival.query('BEGIN');
    await rival.query("SET LOCAL lock_timeout = '250ms'");
    let blocked: string | undefined;
    try {
      await rival.query(lock, [owner]);
    } catch (err) {
      blocked = (err as { code?: string }).code;
    }
    expect(blocked).toBe('55P03');
    await rival.query('ROLLBACK');

    await writer.query('COMMIT');

    await rival.query('BEGIN');
    await rival.query(lock, [owner]);
    const second = await writeOk(rival, [
      change({
        ownerId: owner,
        before: [slot('ore', 4, [held(A, 4)])],
        after: [slot('ore', 5, [held(A, 5)])],
      }),
    ]);
    await rival.query('COMMIT');

    expect(second.writes[0].revision).toBe('2');
    expect((await journalOf(admin, 'personal', owner)).map((row) => row.revision)).toEqual([
      '1',
      '2',
    ]);
  });

  it('leaves the public schema exactly as it found it', async () => {
    expect(await featureTablesIn(admin, 'public')).toEqual(publicBaseline);
  });
});
