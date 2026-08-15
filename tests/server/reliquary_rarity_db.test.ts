import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so
// the real modules load and every query goes through a spy (the deeds_db
// idiom). This pins the actual SQL the reliquary rarity boundary issues, not a
// mock of it.
const dbMock = vi.hoisted(() => ({ query: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    // reliquaryRarityCounts runs inside runWithStatementTimeout (server/db.ts):
    // a dedicated pooled client issues BEGIN, SET LOCAL statement_timeout, the
    // four real reads, then COMMIT. Model connect() as a client that answers the
    // control statements itself and forwards the real queries back through the
    // pool's own query, so the dbMock spy records exactly the four reads in order.
    const poolObj = {
      query: dbMock.query,
      connect: async () => ({
        query: (text: string, values?: unknown[]) =>
          text === 'BEGIN' ||
          text === 'COMMIT' ||
          text === 'ROLLBACK' ||
          text.startsWith('SET LOCAL')
            ? Promise.resolve({ rows: [] })
            : poolObj.query(text, values),
        release() {},
      }),
    };
    return poolObj;
  },
}));

import { ELIGIBLE_ACCOUNT_SQL } from '../../server/db';
import { DEED_RARITY_MIN_LEVEL } from '../../server/deeds_db';
import { reliquaryRarityCounts } from '../../server/reliquary_rarity_db';
import {
  RELIQUARY_ITEM_TO_PAGES,
  RELIQUARY_MARK_IDS,
  RELIQUARY_PAGE_ORDER,
} from '../../src/sim/content/reliquary';

// Real catalogued ids, one per relic kind, so a row fixture can never describe a
// shape the catalog does not actually carry.
const ITEM_RELIC_ID = 'cryptbone_helm';
const MARK_RELIC_ID = 'slain:old_greyjaw';
const PAGE_ID = 'conquerors_hollow_crypt';

/** Seed the four arms in issue order: items, marks, illuminated pages, denominator. */
function seedFullAggregate(): void {
  dbMock.query
    .mockResolvedValueOnce({ rows: [{ id: ITEM_RELIC_ID, found: 3 }] } as never)
    .mockResolvedValueOnce({ rows: [{ id: MARK_RELIC_ID, found: 2 }] } as never)
    .mockResolvedValueOnce({ rows: [{ id: PAGE_ID, illuminated: 1 }] } as never)
    .mockResolvedValueOnce({ rows: [{ eligible: 120 }] } as never);
}

/**
 * Every arm must draw from the SAME eligible population on BOTH axes. Without
 * the level floor a sub-floor holder pushes a relic's count past totalEligible
 * and the line renders over 100 percent; without the accounts join plus
 * ELIGIBLE_ACCOUNT_SQL (the board-read contract), a banned or suspended account
 * feeds one arm but not the other and desyncs them the same way. So all four
 * arms embed the fragment VERBATIM.
 */
function expectEligibilityAxes(sql: string): void {
  expect(sql).toContain('JOIN accounts a ON a.id = c.account_id');
  expect(sql).toContain('WHERE c.level >= $1 AND c.state IS NOT NULL');
  expect(sql).toContain(ELIGIBLE_ACCOUNT_SQL);
}

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('reliquaryRarityCounts', () => {
  it('folds the three numerators and the eligible denominator into one aggregate', async () => {
    seedFullAggregate();
    expect(await reliquaryRarityCounts()).toEqual({
      totalEligible: 120,
      found: { [ITEM_RELIC_ID]: 3, [MARK_RELIC_ID]: 2 },
      illuminated: { [PAGE_ID]: 1 },
    });
    // Four statements, no more: a fifth read would be a per-relic or per-page
    // fan-out inside the walk.
    expect(dbMock.query).toHaveBeenCalledTimes(4);
  });

  it('unnests the itemsDiscovered blob path with the catalogued item ids bound as text[]', async () => {
    seedFullAggregate();
    await reliquaryRarityCounts();
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('jsonb_array_elements_text');
    // The single-reference detoast guard: strict jsonpath with silent-on-error
    // answers [] for a missing path, a scalar, or an object (all four shapes
    // verified on a live Postgres 16), and names c.state exactly once so the
    // blob detoasts once per arm, not twice.
    expect(sql).toContain(
      "jsonb_path_query_array(c.state, 'strict $.deedStats.itemsDiscovered[*]', '{}', true)",
    );
    expect((sql.match(/c\.state/g) ?? []).length).toBe(2);
    expect(sql).toContain('ANY($2::text[])');
    expect(sql).toContain('GROUP BY x.id');
    expectEligibilityAxes(sql);
    // Not a sibling arm's blob path: a copy-paste that leaves this arm reading
    // reliquary.marks still satisfies every pin above.
    expect(sql).not.toContain('$.reliquary');
    expect(params[0]).toBe(DEED_RARITY_MIN_LEVEL);
    // The bound set is DERIVED from the catalog, so growing the catalog cannot
    // stale this pin. The floor is what keeps the derivation honest: an import
    // that resolved to an empty map would satisfy the length equality alone.
    const itemIds: string[] = params[1];
    expect(itemIds).toContain(ITEM_RELIC_ID);
    expect(itemIds).toHaveLength([...RELIQUARY_ITEM_TO_PAGES.keys()].length);
    expect(itemIds.length).toBeGreaterThanOrEqual(200);
  });

  it('unnests the reliquary marks blob path with the catalogued mark ids bound as text[]', async () => {
    seedFullAggregate();
    await reliquaryRarityCounts();
    const [sql, params] = dbMock.query.mock.calls[1];
    expect(sql).toContain('jsonb_array_elements_text');
    expect(sql).toContain(
      "jsonb_path_query_array(c.state, 'strict $.reliquary.marks[*]', '{}', true)",
    );
    expect((sql.match(/c\.state/g) ?? []).length).toBe(2);
    expect(sql).toContain('ANY($2::text[])');
    expect(sql).toContain('GROUP BY x.id');
    expectEligibilityAxes(sql);
    expect(sql).not.toContain('itemsDiscovered');
    expect(sql).not.toContain('illuminatedPages');
    expect(params[0]).toBe(DEED_RARITY_MIN_LEVEL);
    const markIds: string[] = params[1];
    expect(markIds).toEqual([...RELIQUARY_MARK_IDS]);
    expect(markIds).toContain(MARK_RELIC_ID);
    expect(markIds.length).toBeGreaterThanOrEqual(29);
  });

  it('unnests the illuminatedPages blob path with the page ids bound as text[]', async () => {
    seedFullAggregate();
    await reliquaryRarityCounts();
    const [sql, params] = dbMock.query.mock.calls[2];
    expect(sql).toContain('jsonb_array_elements_text');
    expect(sql).toContain(
      "jsonb_path_query_array(c.state, 'strict $.reliquary.illuminatedPages[*]', '{}', true)",
    );
    expect((sql.match(/c\.state/g) ?? []).length).toBe(2);
    expect(sql).toContain('ANY($2::text[])');
    expect(sql).toContain('GROUP BY x.id');
    expectEligibilityAxes(sql);
    expect(sql).not.toContain('itemsDiscovered');
    expect(sql).not.toContain('.marks');
    expect(params[0]).toBe(DEED_RARITY_MIN_LEVEL);
    const pageIds: string[] = params[1];
    expect(pageIds).toEqual([...RELIQUARY_PAGE_ORDER]);
    expect(pageIds).toContain(PAGE_ID);
    expect(pageIds.length).toBeGreaterThanOrEqual(35);
  });

  it('counts the denominator over the same population with no blob unnest and no catalog bind', async () => {
    seedFullAggregate();
    await reliquaryRarityCounts();
    const [sql, params] = dbMock.query.mock.calls[3];
    expect(sql).toContain('COUNT(*)::int AS eligible');
    expect(sql).toContain('FROM characters c');
    expectEligibilityAxes(sql);
    // The denominator counts characters, so it never touches the blob: an
    // unnest here would multiply a character by its relic count.
    expect(sql).not.toContain('jsonb_array_elements_text');
    expect(sql).not.toContain('$2');
    expect(params).toEqual([DEED_RARITY_MIN_LEVEL]);
  });

  it('an empty population reads as a zero aggregate, never undefined', async () => {
    expect(await reliquaryRarityCounts()).toEqual({
      totalEligible: 0,
      found: {},
      illuminated: {},
    });
  });

  it('item relics and mark relics land in ONE found map; page ids never join it', async () => {
    // The client reads `found` by relic id without knowing which ledger proved
    // it, so the two numerator arms must merge rather than nest, and the page
    // arm must stay in its own map (a page id is not a relic id).
    seedFullAggregate();
    const { found, illuminated } = await reliquaryRarityCounts();
    expect(Object.keys(found).sort()).toEqual([ITEM_RELIC_ID, MARK_RELIC_ID].sort());
    expect(Object.keys(illuminated).sort()).toEqual([PAGE_ID]);
  });
});

describe('the same-refresh denominator handoff', () => {
  it('skips the eligible COUNT and passes the handed-over number through', async () => {
    // main.ts hands the deeds denominator over (same predicate constants), so
    // the shared refresh never walks characters JOIN accounts twice for the
    // same number; only a standalone call pays for its own COUNT.
    dbMock.query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    const result = await reliquaryRarityCounts(345);
    expect(result.totalEligible).toBe(345);
    expect(dbMock.query).toHaveBeenCalledTimes(3);
    for (const [sql] of dbMock.query.mock.calls) {
      expect(sql).not.toContain('AS eligible');
    }
  });
});

describe('the SQL blob paths match the sim serializer layout', () => {
  // The scan depends on the persisted blob's key names, and a save-shape
  // rename would silently ZERO every count rather than fail (the
  // migration-safety concern the db review named). Derive the pinned segments
  // from the REAL serializers, so the rename reds here first.
  it('every SQL sub-key is a key the real serializers write', async () => {
    const { readFileSync } = await import('node:fs');
    const { freshDeedStats, serializeDeedStats } = await import('../../src/sim/deeds');
    const { freshReliquaryState, serializeReliquaryState } = await import(
      '../../src/sim/reliquary'
    );
    const src = readFileSync(
      new URL('../../server/reliquary_rarity_db.ts', import.meta.url),
      'utf8',
    );
    const state = freshReliquaryState();
    state.marks.add('slain:old_greyjaw');
    state.illuminatedPages.add('conquerors_hollow_crypt');
    const savedReliquary = serializeReliquaryState(state);
    expect(savedReliquary ? Object.keys(savedReliquary) : []).toEqual(
      expect.arrayContaining(['marks', 'illuminatedPages']),
    );
    expect(src).toContain('$.reliquary.marks');
    expect(src).toContain('$.reliquary.illuminatedPages');
    const stats = freshDeedStats();
    stats.itemsDiscovered.add('cryptbone_helm');
    const savedStats = serializeDeedStats(stats);
    expect(savedStats ? Object.keys(savedStats) : []).toEqual(
      expect.arrayContaining(['itemsDiscovered']),
    );
    expect(src).toContain('$.deedStats.itemsDiscovered');
    // Top-level segments: the sim.ts save composition writes these exact keys
    // through shorthand spreads (source pin; the runtime save path is
    // exercised end to end by the sim suites).
    const simSrc = readFileSync(new URL('../../src/sim/sim.ts', import.meta.url), 'utf8');
    expect(simSrc).toContain('return deedStats ? { deedStats } : {}');
    expect(simSrc).toContain('return reliquary ? { reliquary } : {}');
  });
});
