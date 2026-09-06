// DB-free contract tests for the material source journal leaf
// (server/material_source_journal_db.ts): what it refuses before any SQL, the
// exact records one statement carries, and the canonical write result it
// returns. No Postgres, no pool, no transaction: the client is a double that
// records what it was asked, or refuses to be asked at all.

import { describe, expect, it } from 'vitest';
import {
  MATERIAL_SOURCE_CONTAINERS_TABLE,
  MATERIAL_SOURCE_JOURNAL_SCHEMA,
  MATERIAL_SOURCE_JOURNAL_TABLE,
  MATERIAL_SOURCE_JOURNAL_WRITE_SQL,
  type MaterialSourceContainerChange,
  type MaterialSourceJournalClient,
  type MaterialSourceJournalRecord,
  type MaterialSourceJournalWrite,
  planMaterialSourceJournalWrite,
  writeMaterialSourceJournal,
} from '../server/material_source_journal_db';
import type { MaterialComposition, MaterialSource } from '../src/sim/material_sources';
import type { MaterialStackSlot } from '../src/sim/material_stack';
import type { ItemInstancePayload } from '../src/sim/types';

const MATERIALS: ReadonlySet<string> = new Set(['ore', 'herb']);
const REALM = 'woc-1';

const A: MaterialSource = { gatherer: { kind: 'character', id: 1, name: 'Ayla' } };
const B: MaterialSource = { gatherer: { kind: 'character', id: 2, name: 'Bran' } };

const held = (source: MaterialSource, count: number) => ({ source, count });

const slot = (itemId: string, count: number, sources: MaterialComposition): MaterialStackSlot => ({
  itemId,
  count,
  materialSources: sources,
});

const change = (
  overrides: Partial<MaterialSourceContainerChange> = {},
): MaterialSourceContainerChange => ({
  realm: REALM,
  container: 'personal',
  ownerId: 7,
  before: [slot('ore', 3, [held(A, 3)])],
  after: [slot('ore', 4, [held(A, 4)])],
  ...overrides,
});

/** Refuses to be queried at all: any SQL from the leaf fails the test. */
const refusingClient: MaterialSourceJournalClient = {
  async query(): Promise<never> {
    throw new Error('the leaf must refuse before sending SQL');
  },
};

interface Recorded {
  readonly text: string;
  readonly values: unknown[];
}

/**
 * Answers each sent record the way the real statement does: one row per record,
 * echoing its identity with the revision the caller chose for it.
 */
function answeringClient(revisionOf: (record: MaterialSourceJournalRecord) => string = () => '1') {
  const calls: Recorded[] = [];
  const client: MaterialSourceJournalClient = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      const records = JSON.parse(String(values[0])) as MaterialSourceJournalRecord[];
      const rows = records.map((record) => ({
        ord: record.ord,
        realm: record.realm,
        container: record.container,
        owner_id: String(record.owner_id),
        revision: revisionOf(record),
      }));
      return { rows, rowCount: rows.length };
    },
  };
  return { client, calls };
}

function sentRecords(calls: readonly Recorded[]): MaterialSourceJournalRecord[] {
  expect(calls).toHaveLength(1);
  return JSON.parse(String(calls[0].values[0])) as MaterialSourceJournalRecord[];
}

async function expectRefusal(
  changes: readonly MaterialSourceContainerChange[],
  error: string,
): Promise<void> {
  const result = await writeMaterialSourceJournal(refusingClient, changes, MATERIALS);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe(error);
}

describe('material source journal movement records', () => {
  it('journals a one-unit top-up as exactly one delta, not a whole-stack rewrite', async () => {
    const { client, calls } = answeringClient();

    const result = await writeMaterialSourceJournal(client, [change()], MATERIALS);

    const records = sentRecords(calls);
    expect(records).toHaveLength(1);
    expect(records[0].movements).toEqual([
      { itemId: 'ore', count: 1, sourceDeltas: [{ source: A, count: 1 }] },
    ]);
    expect(result.ok && result.value.movementRows).toBe(1);
    expect(result.ok && result.value.writes).toEqual([
      {
        realm: REALM,
        container: 'personal',
        ownerId: 7,
        revision: '1',
        anchorCreated: true,
        movementCount: 1,
      },
    ]);
  });

  it('keeps a count-0 re-attribution, with both of its legs', async () => {
    const { client, calls } = answeringClient();

    await writeMaterialSourceJournal(
      client,
      [
        change({
          before: [slot('ore', 2, [held(A, 2)])],
          after: [slot('ore', 2, [held(A, 1), held(B, 1)])],
        }),
      ],
      MATERIALS,
    );

    const [record] = sentRecords(calls);
    expect(record.movements).toEqual([
      {
        itemId: 'ore',
        count: 0,
        sourceDeltas: [
          { source: A, count: -1 },
          { source: B, count: 1 },
        ],
      },
    ]);
  });

  it('carries the opening projection of the exact locked before-state', async () => {
    const { client, calls } = answeringClient();

    await writeMaterialSourceJournal(client, [change()], MATERIALS);

    const [record] = sentRecords(calls);
    expect(record.opening).toEqual({
      entries: [{ itemId: 'ore', count: 3, sources: [{ source: A, count: 3 }] }],
    });
  });

  it('replaces the opening with null only for an explicit established-anchor proof', () => {
    const plan = planMaterialSourceJournalWrite(
      [
        change({ ownerId: 7, anchorExists: true }),
        change({ ownerId: 8, anchorExists: false }),
        change({ ownerId: 9 }),
        change({ ownerId: 42, container: 'guild' }),
      ],
      MATERIALS,
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.records[0].opening).toBeNull();
    for (const record of plan.value.records.slice(1)) {
      expect(record.opening).toEqual({
        entries: [{ itemId: 'ore', count: 3, sources: [{ source: A, count: 3 }] }],
      });
    }
  });

  it('sends the exact canonical JSON, legacy signer and own __proto__ payload included', async () => {
    // JSON.parse mints an OWN '__proto__' data property; an object literal never
    // does. It is persisted payload data, so it must survive into both the
    // opening and the movement row byte for byte.
    const instance = JSON.parse('{"signer":"Ayla","__proto__":{"k":1}}') as ItemInstancePayload;
    const legacy = (count: number): MaterialStackSlot => ({
      itemId: 'ore',
      count,
      instance: JSON.parse(JSON.stringify(instance)) as ItemInstancePayload,
    });
    const { client, calls } = answeringClient();

    await writeMaterialSourceJournal(
      client,
      [change({ before: [legacy(2)], after: [legacy(3)] })],
      MATERIALS,
    );

    expect(calls[0].values).toHaveLength(1);
    expect(calls[0].values[0]).toBe(
      '[{"ord":0,"realm":"woc-1","container":"personal","owner_id":7,' +
        '"owner_character_id":7,' +
        '"opening":{"entries":[{"itemId":"ore","instance":{"__proto__":{"k":1}},' +
        '"count":2,"sources":[{"source":{"signer":"Ayla"},"count":2}]}]},' +
        '"movements":[{"itemId":"ore","instance":{"__proto__":{"k":1}},"count":1,' +
        '"sourceDeltas":[{"source":{"signer":"Ayla"},"count":1}]}]}]',
    );
  });

  it('stamps the owning character on personal and vault, and NULL on guild', () => {
    const plan = planMaterialSourceJournalWrite(
      [
        change({ container: 'personal', ownerId: 7 }),
        change({ container: 'vault', ownerId: 7 }),
        change({ container: 'guild', ownerId: 42 }),
      ],
      MATERIALS,
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.records.map((record) => record.owner_character_id)).toEqual([7, 7, null]);
  });
});

describe('material source journal refusals, before any SQL', () => {
  it('refuses a stack whose source counts do not sum to its own count', async () => {
    await expectRefusal([change({ after: [slot('ore', 4, [held(A, 3)])] })], 'sum-mismatch');
  });

  it('refuses a malformed gatherer id', async () => {
    const bad: MaterialSource = { gatherer: { kind: 'character', id: 0, name: 'Ayla' } };
    await expectRefusal([change({ after: [slot('ore', 4, [held(bad, 4)])] })], 'invalid-source');
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2, Number.NaN])(
    'refuses the owner id %p',
    async (ownerId) => {
      await expectRefusal([change({ ownerId })], 'invalid-owner');
    },
  );

  it('refuses an empty realm', async () => {
    await expectRefusal([change({ realm: '' })], 'invalid-realm');
  });

  it('refuses an unknown container kind', async () => {
    await expectRefusal(
      [change({ container: 'mailbox' as MaterialSourceContainerChange['container'] })],
      'invalid-container',
    );
  });

  it('refuses two inputs for the same container', async () => {
    await expectRefusal([change(), change()], 'duplicate-container');
  });

  it('accepts the same owner id in two DIFFERENT containers', async () => {
    const { client } = answeringClient();
    const result = await writeMaterialSourceJournal(
      client,
      [change({ container: 'personal' }), change({ container: 'vault' })],
      MATERIALS,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a before or after that is not a slot list', async () => {
    await expectRefusal(
      [change({ before: undefined as unknown as readonly MaterialStackSlot[] })],
      'invalid-input',
    );
  });

  it('refuses one malformed container without journalling the healthy ones', async () => {
    await expectRefusal(
      [change(), change({ ownerId: 8, after: [slot('ore', 4, [held(A, 3)])] })],
      'sum-mismatch',
    );
  });

  // A slot list is persisted data reaching this leaf from a save path, so a row
  // that is not an object at all is malformed input, not a slot to interpret.
  // Today those rows reach `slot.itemId` inside the shared core: null and
  // undefined throw a raw TypeError, a primitive reads `undefined` for its item
  // id and is SILENTLY DROPPED from the projection. Both answers are wrong for
  // an audit; the leaf owes an explicit refusal before any SQL. Nothing here
  // restricts a row's FIELDS: an ordinary object whose item id is not a
  // material stays the core's business and is still skipped.
  const MALFORMED_SLOT_ROWS: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 5],
    ['a string', 'ore'],
  ];

  it.each(MALFORMED_SLOT_ROWS)('refuses %s in the before list', async (_label, row) => {
    await expectRefusal(
      [change({ before: [row] as unknown as readonly MaterialStackSlot[] })],
      'invalid-input',
    );
  });

  it.each(MALFORMED_SLOT_ROWS)('refuses %s in the after list', async (_label, row) => {
    await expectRefusal(
      [change({ after: [row] as unknown as readonly MaterialStackSlot[] })],
      'invalid-input',
    );
  });

  it('sends nothing at all when one container in a batch carries a malformed slot row', async () => {
    // The FIRST container is valid and really moved, so this proves the refusal
    // beats the statement rather than merely aborting it.
    const { client, calls } = answeringClient();

    const result = await writeMaterialSourceJournal(
      client,
      [change(), change({ ownerId: 8, after: [null as unknown as MaterialStackSlot] })],
      MATERIALS,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('invalid-input');
    expect(calls).toHaveLength(0);
  });
});

describe('material source journal statement shape', () => {
  it('ignores containers that moved nothing: no query, no anchor, no revision', async () => {
    const idle = [
      change({ ownerId: 7, after: [slot('ore', 3, [held(A, 3)])] }),
      // A pure regrouping across two slots moves no payload and no descriptor.
      change({
        ownerId: 8,
        before: [slot('herb', 4, [held(A, 4)])],
        after: [slot('herb', 1, [held(A, 1)]), slot('herb', 3, [held(A, 3)])],
      }),
    ];

    const result = await writeMaterialSourceJournal(refusingClient, idle, MATERIALS);

    expect(result).toEqual({
      ok: true,
      value: { writes: [], unchangedContainers: 2, anchorsCreated: 0, movementRows: 0 },
    });
  });

  it('never lets a mutated no-change result corrupt the next one', async () => {
    const idle = [change({ after: [slot('ore', 3, [held(A, 3)])] })];
    const first = await writeMaterialSourceJournal(refusingClient, idle, MATERIALS);
    expect(first.ok && first.value.writes).toEqual([]);
    if (!first.ok) return;

    // The caller owns what it was handed. A fresh list per answer and a frozen
    // one both satisfy that; SHARING one mutable array across answers does not.
    try {
      (first.value.writes as MaterialSourceJournalWrite[]).push({
        realm: REALM,
        container: 'personal',
        ownerId: 7,
        revision: '99',
        anchorCreated: true,
        movementCount: 1,
      });
    } catch {
      // A frozen empty list refuses the push, which keeps the same promise.
    }

    const second = await writeMaterialSourceJournal(refusingClient, idle, MATERIALS);
    expect(second.ok && second.value).toEqual({
      writes: [],
      unchangedContainers: 1,
      anchorsCreated: 0,
      movementRows: 0,
    });
  });

  it('rides ONE statement for every changed container, in the caller input order', async () => {
    const { client, calls } = answeringClient((record) => (record.ord === 0 ? '1' : '2'));
    const changes = [
      change({ ownerId: 9 }),
      // Unchanged, and therefore absent from the statement entirely.
      change({ ownerId: 8, after: [slot('ore', 3, [held(A, 3)])] }),
      change({ container: 'guild', ownerId: 42 }),
      change({ container: 'vault', ownerId: 9 }),
    ];

    const result = await writeMaterialSourceJournal(client, changes, MATERIALS);

    expect(calls).toHaveLength(1);
    const records = sentRecords(calls);
    expect(records.map((record) => [record.ord, record.container, record.owner_id])).toEqual([
      [0, 'personal', 9],
      [1, 'guild', 42],
      [2, 'vault', 9],
    ]);
    expect(result.ok && result.value.unchangedContainers).toBe(1);
    expect(result.ok && result.value.anchorsCreated).toBe(1);
    expect(result.ok && result.value.writes.map((write) => write.revision)).toEqual([
      '1',
      '2',
      '2',
    ]);
    expect(result.ok && result.value.writes.map((write) => write.anchorCreated)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('issues no transaction control and no per-container round trip of its own', () => {
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i);
    // One recordset unnest for the whole batch, one bind parameter, no loop.
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL.match(/jsonb_to_recordset/g)).toHaveLength(1);
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL.match(/\$\d/g)).toEqual(['$1']);
  });

  it('increments an existing revision without replacing the opening', () => {
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL).toContain(
      `ON CONFLICT (realm, container, owner_id) DO UPDATE\n     SET current_revision = ${MATERIAL_SOURCE_CONTAINERS_TABLE}.current_revision + 1`,
    );
    const conflictArm = MATERIAL_SOURCE_JOURNAL_WRITE_SQL.slice(
      MATERIAL_SOURCE_JOURNAL_WRITE_SQL.indexOf('ON CONFLICT'),
    );
    expect(conflictArm).not.toContain('opening');
  });

  it('uses an exact-PK fallback for an omitted opening in the same statement', () => {
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL).toContain(
      'CASE WHEN i.opening IS NOT NULL THEN i.opening',
    );
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL).toContain(
      'SELECT 1 FROM material_source_containers AS established',
    );
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL).toContain('established.realm = i.realm');
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL).toContain('established.container = i.container');
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL).toContain('established.owner_id = i.owner_id');
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL).toContain('THEN \'{"entries":[]}\'::jsonb');
    expect(MATERIAL_SOURCE_JOURNAL_WRITE_SQL).toContain('ELSE NULL');
    // The target column remains NOT NULL: a stale true proof whose exact anchor
    // vanished aborts the statement and therefore its caller's outer save.
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain('opening JSONB NOT NULL');
  });

  it('throws rather than reporting a write the statement did not make', async () => {
    const silent: MaterialSourceJournalClient = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };
    await expect(writeMaterialSourceJournal(silent, [change()], MATERIALS)).rejects.toThrow(
      /wrote 0 of 1 container revisions/,
    );
  });

  it('throws when a returned row answers a different container', async () => {
    const wrong: MaterialSourceJournalClient = {
      async query() {
        const rows = [{ ord: 0, realm: REALM, container: 'guild', owner_id: '7', revision: '1' }];
        return { rows, rowCount: rows.length };
      },
    };
    await expect(writeMaterialSourceJournal(wrong, [change()], MATERIALS)).rejects.toThrow(
      /container ordinal 0/,
    );
  });
});

describe('material source journal schema', () => {
  it('creates both tables additively and idempotently', () => {
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain(
      `CREATE TABLE IF NOT EXISTS ${MATERIAL_SOURCE_CONTAINERS_TABLE} (`,
    );
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain(
      `CREATE TABLE IF NOT EXISTS ${MATERIAL_SOURCE_JOURNAL_TABLE} (`,
    );
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).not.toMatch(/\bALTER TABLE\b|\bDROP\b/);
  });

  it('keys a container by realm, kind and owner, and a journal row by its revision', () => {
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain('PRIMARY KEY (realm, container, owner_id)');
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain(
      'PRIMARY KEY (realm, container, owner_id, revision)',
    );
  });

  it('cascades character-owned history with its character and journal rows with their anchor', () => {
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain(
      'owner_character_id INT REFERENCES characters(id) ON DELETE CASCADE',
    );
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain(
      `REFERENCES ${MATERIAL_SOURCE_CONTAINERS_TABLE} (realm, container, owner_id)\n    ON DELETE CASCADE`,
    );
    // A guild book must have NO actor, account or guild foreign key: that is
    // what lets its audit outlive a contributing character or the guild itself.
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).not.toMatch(/REFERENCES\s+(accounts|guilds)\b/);
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).not.toMatch(
      /\b(account_id|actor_id|actor_name|character_name)\b/,
    );
  });

  it('constrains kind, ownership and positivity in the database itself', () => {
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain(
      "CHECK (container IN ('personal', 'vault', 'guild'))",
    );
    // Whitespace-normalized: what matters is that the character-owned arm
    // demands a NON-NULL owning character before comparing it, not how the DDL
    // happens to wrap the three conjuncts. Without the IS NOT NULL the arm
    // evaluates to NULL for a NULL column and the constraint admits the row;
    // the refusal itself is proven against real Postgres in the pg suite.
    const oneLine = MATERIAL_SOURCE_JOURNAL_SCHEMA.replace(/\s+/g, ' ');
    expect(oneLine).toContain(
      "(container IN ('personal', 'vault') AND owner_character_id IS NOT NULL " +
        'AND owner_character_id = owner_id)',
    );
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain(
      "(container = 'guild' AND owner_character_id IS NULL)",
    );
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain('CHECK (owner_id > 0)');
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain('CHECK (current_revision > 0)');
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain('CHECK (revision > 0)');
  });

  it('indexes the nullable owning character so a delete never scans the table', () => {
    expect(MATERIAL_SOURCE_JOURNAL_SCHEMA).toContain(
      `CREATE INDEX IF NOT EXISTS material_source_containers_character\n  ON ${MATERIAL_SOURCE_CONTAINERS_TABLE} (owner_character_id)\n  WHERE owner_character_id IS NOT NULL;`,
    );
  });
});
