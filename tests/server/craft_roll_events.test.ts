// The server half of the craft_roll_events audit: the observer routes a
// drained craftRoll event to the writer, the writer mirrors the event fields
// into a row behind its bounded FIFO, the insert pins the literal SQL shape
// and refuses malformed rows, and the prune is the sweep's bounded contract.

import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock('../../server/craft_roll_events_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/craft_roll_events_db')>();
  return { ...actual, insertCraftRollEvent: vi.fn(async () => {}) };
});

vi.mock('../../server/progress_events', () => ({
  recordFtueQuest: vi.fn(),
  recordFtueDeath: vi.fn(),
}));

import {
  type CraftRollEvent,
  craftRollEventsIdle,
  craftRollEventsShedCount,
  MAX_PENDING_CRAFT_ROLL_EVENTS,
  recordCraftRoll,
} from '../../server/craft_roll_events';
import {
  CRAFT_ROLL_EVENTS_SCHEMA,
  CRAFT_ROLL_KINDS,
  insertCraftRollEvent,
  pruneCraftRollEventsBatch,
} from '../../server/craft_roll_events_db';
import { observeEventRecords } from '../../server/event_record_observers';
import { recordFtueDeath, recordFtueQuest } from '../../server/progress_events';
import type { Entity, SimEvent } from '../../src/sim/types';

const insertMock = vi.mocked(insertCraftRollEvent);
const who = { characterId: 42, accountId: 7 };

const attempt: CraftRollEvent = {
  type: 'craftRoll',
  kind: 'perfecting',
  recipeId: 'recipe_wyrmfall_pendant',
  itemId: 'wyrmfall_pendant',
  roll: 0.91,
  chance: 0.8,
  success: false,
  rankBefore: 2,
  rankAfter: 2,
  pid: 9,
};

beforeEach(() => {
  insertMock.mockClear();
  insertMock.mockResolvedValue(undefined);
  vi.mocked(recordFtueQuest).mockClear();
  vi.mocked(recordFtueDeath).mockClear();
});

describe('recordCraftRoll (the FIFO writer)', () => {
  it('mirrors every event field plus the caller identity into the row', async () => {
    recordCraftRoll(who, attempt);
    await craftRollEventsIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][1];
    expect(row).toMatchObject({
      characterId: 42,
      accountId: 7,
      kind: 'perfecting',
      recipeId: 'recipe_wyrmfall_pendant',
      itemId: 'wyrmfall_pendant',
      roll: 0.91,
      chance: 0.8,
      success: false,
      rankBefore: 2,
      rankAfter: 2,
    });
    expect(row.realm.length).toBeGreaterThan(0);
  });

  it('a masterwork record with no rank fields writes null ranks', async () => {
    recordCraftRoll(who, {
      type: 'craftRoll',
      kind: 'masterwork',
      recipeId: 'recipe_x',
      itemId: 'x',
      roll: 0.02,
      chance: 0.05,
      success: true,
      pid: 9,
    });
    await craftRollEventsIdle();
    expect(insertMock.mock.calls[0][1]).toMatchObject({
      kind: 'masterwork',
      success: true,
      rankBefore: null,
      rankAfter: null,
    });
  });

  it('survives a rejected insert and keeps recording later events', async () => {
    insertMock.mockRejectedValueOnce(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    recordCraftRoll(who, attempt);
    recordCraftRoll(who, { ...attempt, roll: 0.2, success: true, rankAfter: 3 });
    await craftRollEventsIdle();
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('sheds past the FIFO depth bound instead of growing the chain', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    insertMock.mockImplementation(() => gate);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = craftRollEventsShedCount();
    for (let i = 0; i < MAX_PENDING_CRAFT_ROLL_EVENTS + 5; i++) recordCraftRoll(who, attempt);
    expect(craftRollEventsShedCount() - before).toBe(5);
    release();
    insertMock.mockResolvedValue(undefined);
    await craftRollEventsIdle();
    errSpy.mockRestore();
  });
});

describe('observeEventRecords (the drain arm)', () => {
  const sim = { entities: new Map<number, Entity>() };

  it('routes a craftRoll to the writer for a connected session, by pid', async () => {
    const clients = new Map([[9, who]]);
    observeEventRecords(attempt, sim, clients);
    await craftRollEventsIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][1]).toMatchObject({ characterId: 42, accountId: 7 });
  });

  it('writes nothing for a craftRoll whose pid has no session (logged out)', async () => {
    observeEventRecords(attempt, sim, new Map());
    await craftRollEventsIdle();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('keeps the moved ftue_events arms: quest events read the live level, deaths route by entity', () => {
    const clients = new Map([[9, who]]);
    sim.entities.set(9, { level: 4 } as Entity);
    observeEventRecords({ type: 'questAccepted', questId: 'q1', pid: 9 } as SimEvent, sim, clients);
    expect(recordFtueQuest).toHaveBeenCalledWith(who, 'quest_accepted', 'q1', 4);
    observeEventRecords({ type: 'questDone', questId: 'q1', pid: 9 } as SimEvent, sim, clients);
    expect(recordFtueQuest).toHaveBeenCalledWith(who, 'quest_done', 'q1', 4);
    // A gone entity never defaults the level (the growth gate must not fail open).
    sim.entities.delete(9);
    observeEventRecords({ type: 'questDone', questId: 'q2', pid: 9 } as SimEvent, sim, clients);
    expect(recordFtueQuest).toHaveBeenCalledTimes(2);
    observeEventRecords({ type: 'death', entityId: 9, killerId: 77 } as SimEvent, sim, clients);
    expect(recordFtueDeath).toHaveBeenCalledWith(who, sim, 9, 77);
    observeEventRecords({ type: 'death', entityId: 8, killerId: 77 } as SimEvent, sim, clients);
    expect(recordFtueDeath).toHaveBeenCalledTimes(1);
  });
});

describe('the database layer', () => {
  const actualDb = async () =>
    (
      await vi.importActual<typeof import('../../server/craft_roll_events_db')>(
        '../../server/craft_roll_events_db',
      )
    ).insertCraftRollEvent;

  function fakePool(): { pool: Pool; calls: Array<[string, unknown[]]> } {
    const calls: Array<[string, unknown[]]> = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push([sql, params]);
        return { rows: [], rowCount: 3 };
      }),
    } as unknown as Pool;
    return { pool, calls };
  }

  it('the schema creates the table and its time, kind, account and character indexes', () => {
    expect(CRAFT_ROLL_EVENTS_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS craft_roll_events');
    for (const column of [
      'kind TEXT NOT NULL',
      'recipe_id TEXT',
      'item_id TEXT NOT NULL',
      'roll DOUBLE PRECISION NOT NULL',
      'chance DOUBLE PRECISION NOT NULL',
      'success BOOLEAN NOT NULL',
      'rank_before INT',
      'rank_after INT',
      'rolled_at TIMESTAMPTZ NOT NULL DEFAULT now()',
    ]) {
      expect(CRAFT_ROLL_EVENTS_SCHEMA).toContain(column);
    }
    expect(CRAFT_ROLL_EVENTS_SCHEMA).toContain('craft_roll_events_rolled');
    expect(CRAFT_ROLL_EVENTS_SCHEMA).toContain('craft_roll_events_kind_rolled');
    expect(CRAFT_ROLL_EVENTS_SCHEMA).toContain('craft_roll_events_account');
    expect(CRAFT_ROLL_EVENTS_SCHEMA).toContain('craft_roll_events_character');
    // Deliberately no CHECK constraint on kind (see the module header).
    expect(CRAFT_ROLL_EVENTS_SCHEMA).not.toContain('CHECK');
  });

  it('the kind vocabulary mirrors the sim event union', () => {
    expect([...CRAFT_ROLL_KINDS]).toEqual(['masterwork', 'perfecting']);
  });

  it('insert writes one parameterized row into craft_roll_events', async () => {
    const insert = await actualDb();
    const { pool, calls } = fakePool();
    await insert(pool, {
      realm: 'eastbrook',
      characterId: 42,
      accountId: 7,
      kind: 'perfecting',
      recipeId: 'recipe_wyrmfall_pendant',
      itemId: 'wyrmfall_pendant',
      roll: 0.91,
      chance: 0.8,
      success: false,
      rankBefore: 2,
      rankAfter: 2,
    });
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(sql).toContain('INSERT INTO craft_roll_events');
    expect(sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)');
    expect(params).toEqual([
      'eastbrook',
      42,
      7,
      'perfecting',
      'recipe_wyrmfall_pendant',
      'wyrmfall_pendant',
      0.91,
      0.8,
      false,
      2,
      2,
    ]);
  });

  it('insert refuses an unknown kind, an out-of-range roll or chance, and a bad id', async () => {
    const insert = await actualDb();
    const { pool, calls } = fakePool();
    const base = {
      realm: 'eastbrook',
      characterId: 42,
      accountId: 7,
      kind: 'masterwork' as const,
      recipeId: null,
      itemId: 'x',
      roll: 0.5,
      chance: 0.1,
      success: false,
    };
    await expect(insert(pool, { ...base, kind: 'lockpick' as never })).rejects.toThrow(/kind/);
    await expect(insert(pool, { ...base, roll: 1.5 })).rejects.toThrow(/roll/);
    await expect(insert(pool, { ...base, chance: -0.1 })).rejects.toThrow(/chance/);
    await expect(insert(pool, { ...base, roll: Number.NaN })).rejects.toThrow(/roll/);
    await expect(insert(pool, { ...base, characterId: 0 })).rejects.toThrow(/characterId/);
    await expect(insert(pool, { ...base, itemId: '' })).rejects.toThrow(/itemId/);
    await expect(insert(pool, { ...base, rankBefore: -1 })).rejects.toThrow(/rankBefore/);
    expect(calls, 'a refused row never reaches the pool').toHaveLength(0);
  });

  it('prune deletes oldest-first in a bounded batch and is a no-op at retention 0', async () => {
    const { pool, calls } = fakePool();
    expect(await pruneCraftRollEventsBatch(pool, 0, 500)).toBe(0);
    expect(calls).toHaveLength(0);
    expect(await pruneCraftRollEventsBatch(pool, 365, 500)).toBe(3);
    const [sql, params] = calls[0];
    expect(sql).toContain('DELETE FROM craft_roll_events');
    expect(sql).toContain("rolled_at < now() - ($1::int * INTERVAL '1 day')");
    expect(sql).toContain('ORDER BY rolled_at ASC, id ASC');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([365, 500]);
  });
});
