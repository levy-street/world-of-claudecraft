// The item_ledger observer and its db module (server/item_ledger.ts,
// server/item_ledger_db.ts): the sim's server-only itemTracked event becomes
// exactly one validated row, the observer routes it by the recipient's
// session, the FIFO bound sheds rather than grows, the reads bound their
// inputs, and the events frame never delivers the event to a client.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_item_ledger';

import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock('../../server/item_ledger_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/item_ledger_db')>();
  return { ...actual, insertItemLedgerEvent: vi.fn(async () => {}) };
});

vi.mock('../../server/progress_events', () => ({
  recordFtueQuest: vi.fn(),
  recordFtueDeath: vi.fn(),
}));

vi.mock('../../server/craft_roll_events', () => ({
  recordCraftRoll: vi.fn(),
}));

import { filterRoutableEvents } from '../../server/event_frame';
import { observeEventRecords } from '../../server/event_record_observers';
import {
  type ItemTrackedEvent,
  itemLedgerIdle,
  itemLedgerShedCount,
  MAX_PENDING_ITEM_LEDGER_EVENTS,
  recordItemTracked,
} from '../../server/item_ledger';
import {
  ITEM_LEDGER_KINDS,
  ITEM_LEDGER_MAX_LIMIT,
  ITEM_LEDGER_SCHEMA,
  insertItemLedgerEvent,
  isItemLedgerGuid,
  itemLedgerHistory,
  listItemLedger,
  pruneItemLedgerBatch,
} from '../../server/item_ledger_db';
import type { Entity, SimEvent } from '../../src/sim/types';

const insertMock = vi.mocked(insertItemLedgerEvent);
const who = { characterId: 42, accountId: 7 };
const GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const mint: ItemTrackedEvent = {
  type: 'itemTracked',
  kind: 'mint',
  guid: GUID,
  itemId: 'duskforged_warblade',
  quality: 'epic',
  by: 'Alice',
  byId: 42,
  source: 'mob:forest_wolf',
  zone: 'eastbrook',
  at: 1_700_000_000_000,
  pid: 9,
};

beforeEach(() => {
  insertMock.mockClear();
  insertMock.mockResolvedValue(undefined);
});

describe('recordItemTracked', () => {
  it('writes one row from the event and the session identity', async () => {
    recordItemTracked(who, mint);
    await itemLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][1]).toEqual({
      realm: expect.any(String),
      guid: GUID,
      itemId: 'duskforged_warblade',
      quality: 'epic',
      kind: 'mint',
      characterId: 42,
      accountId: 7,
      characterName: 'Alice',
      source: 'mob:forest_wolf',
      zone: 'eastbrook',
      occurredAtMs: 1_700_000_000_000,
    });
  });

  it('nulls an absent zone and never throws on a failing insert', async () => {
    insertMock.mockRejectedValueOnce(new Error('down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { zone: _zone, ...noZone } = mint;
    expect(() => recordItemTracked(who, { ...noZone, kind: 'transfer' })).not.toThrow();
    await itemLedgerIdle();
    expect(insertMock.mock.calls[0][1]).toMatchObject({ zone: null, kind: 'transfer' });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('sheds past the FIFO bound instead of queueing without limit', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    insertMock.mockImplementation(() => gate);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = itemLedgerShedCount();
    for (let i = 0; i < MAX_PENDING_ITEM_LEDGER_EVENTS + 5; i++) recordItemTracked(who, mint);
    expect(itemLedgerShedCount() - before).toBe(5);
    release();
    insertMock.mockResolvedValue(undefined);
    await itemLedgerIdle();
    errorSpy.mockRestore();
  });
});

describe('observeEventRecords routing', () => {
  it('records an itemTracked event for a connected recipient and skips a departed one', async () => {
    const sim = { entities: new Map<number, Entity>() };
    const clients = new Map([[9, who]]);
    observeEventRecords(mint, sim, clients);
    observeEventRecords({ ...mint, pid: 10 }, sim, clients);
    await itemLedgerIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][1]).toMatchObject({ characterId: 42, guid: GUID });
  });
});

describe('the events frame', () => {
  it('never delivers itemTracked to a client', () => {
    const chat: SimEvent = {
      type: 'chat',
      fromPid: 9,
      from: 'Alice',
      channel: 'general',
      text: 'x',
    };
    expect(filterRoutableEvents([mint, chat])).toEqual([chat]);
  });
});

describe('item_ledger_db', () => {
  function fakePool(rows: unknown[] = []) {
    const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
    return { pool: { query } as unknown as Pool, query };
  }

  it('declares an idempotent schema with the guid and character indexes', () => {
    expect(ITEM_LEDGER_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS item_ledger');
    expect(ITEM_LEDGER_SCHEMA).toContain('item_ledger_guid');
    expect(ITEM_LEDGER_SCHEMA).toContain('item_ledger_character');
    expect(ITEM_LEDGER_KINDS).toEqual(['mint', 'transfer']);
  });

  it('inserts a validated row and refuses a bad kind, guid, or identity', async () => {
    const actual = await vi.importActual<typeof import('../../server/item_ledger_db')>(
      '../../server/item_ledger_db',
    );
    const { pool, query } = fakePool();
    const row = {
      realm: 'test',
      guid: GUID,
      itemId: 'duskforged_warblade',
      quality: 'epic',
      kind: 'mint' as const,
      characterId: 42,
      accountId: 7,
      characterName: 'Alice',
      source: 'mob:forest_wolf',
      zone: null,
      occurredAtMs: 1_700_000_000_000,
    };
    await actual.insertItemLedgerEvent(pool, row);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('INSERT INTO item_ledger');
    expect(params).toEqual([
      'test',
      GUID,
      'duskforged_warblade',
      'epic',
      'mint',
      42,
      7,
      'Alice',
      'mob:forest_wolf',
      null,
      1_700_000_000_000,
    ]);
    await expect(
      actual.insertItemLedgerEvent(pool, { ...row, kind: 'sold' as 'mint' }),
    ).rejects.toThrow(/kind/);
    await expect(actual.insertItemLedgerEvent(pool, { ...row, guid: 'nope' })).rejects.toThrow(
      /guid/,
    );
    await expect(actual.insertItemLedgerEvent(pool, { ...row, characterId: 0 })).rejects.toThrow(
      /characterId/,
    );
    await expect(
      actual.insertItemLedgerEvent(pool, { ...row, occurredAtMs: Number.NaN }),
    ).rejects.toThrow(/occurredAtMs/);
  });

  it('answers an invalid guid history without touching the database', async () => {
    const { pool, query } = fakePool();
    expect(await itemLedgerHistory(pool, 'test', 'NOPE')).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    expect(isItemLedgerGuid(GUID)).toBe(true);
    expect(isItemLedgerGuid(GUID.toUpperCase())).toBe(false);
  });

  it('maps history rows oldest first with ISO timestamps', async () => {
    const { pool, query } = fakePool([
      {
        id: '5',
        guid: GUID,
        item_id: 'duskforged_warblade',
        quality: 'epic',
        kind: 'mint',
        character_id: 42,
        account_id: 7,
        character_name: 'Alice',
        source: 'mob:forest_wolf',
        zone: 'eastbrook',
        occurred_at: new Date(1_700_000_000_000),
        created_at: new Date(1_700_000_001_000),
      },
    ]);
    const rows = await itemLedgerHistory(pool, 'test', GUID);
    expect(rows).toEqual([
      {
        id: 5,
        guid: GUID,
        itemId: 'duskforged_warblade',
        quality: 'epic',
        kind: 'mint',
        characterId: 42,
        accountId: 7,
        characterName: 'Alice',
        source: 'mob:forest_wolf',
        zone: 'eastbrook',
        occurredAt: '2023-11-14T22:13:20.000Z',
        createdAt: '2023-11-14T22:13:21.000Z',
      },
    ]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('ORDER BY id ASC');
    expect(params[1]).toBe(GUID);
  });

  it('bounds the recent-list limit and reports the cursor from the overflow row', async () => {
    const mk = (id: number) => ({
      id,
      guid: GUID,
      item_id: 'x',
      quality: 'epic',
      kind: 'transfer',
      character_id: null,
      account_id: null,
      character_name: 'A',
      source: 'trade',
      zone: null,
      occurred_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const { pool, query } = fakePool([mk(9), mk(8), mk(7)]);
    const page = await listItemLedger(pool, { realm: 'test', limit: 999, characterId: 42 });
    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(['test', null, 42, null, ITEM_LEDGER_MAX_LIMIT + 1]);
    expect(page.hasMore).toBe(false);
    expect(page.rows.map((r) => r.id)).toEqual([9, 8, 7]);

    const small = fakePool([mk(9), mk(8), mk(7)]);
    const paged = await listItemLedger(small.pool, { realm: 'test', limit: 2, beforeId: 10 });
    expect(paged.rows.map((r) => r.id)).toEqual([9, 8]);
    expect(paged.hasMore).toBe(true);
    expect(paged.nextBeforeId).toBe(8);
  });

  it('keeps every row when retention is off and deletes a bounded batch otherwise', async () => {
    const { pool, query } = fakePool();
    expect(await pruneItemLedgerBatch(pool, 0, 100)).toBe(0);
    expect(query).not.toHaveBeenCalled();
    await pruneItemLedgerBatch(pool, 30.7, 50);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('DELETE FROM item_ledger');
    expect(params).toEqual([30, 50]);
  });
});
