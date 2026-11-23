import { afterEach, describe, expect, test, vi } from 'vitest';
import { CensusExporter } from '../server/parse/census';
import {
  CENSUS_BATCH_SIZE,
  CENSUS_RUN_RETRIES,
  type CensusRowRaw,
  walkCensusBatches,
} from '../server/parse/census_db';
import type { CensusRecord } from '../server/parse/contract';
import { createParseCounters } from '../server/parse/counters';

function censusRow(characterId: number): CensusRecord {
  return {
    t: 'census',
    snapshotDate: '2026-08-05',
    characterId,
    name: `Char${characterId}`,
    class: 'mage',
    level: 20,
    vlevel: 34,
    spec: 'frost',
    talents: { ranks: { icy_veins: 2 }, choices: {} },
    equipment: { chest: { id: 'recruit_tunic', name: 'Recruit Tunic' } },
    prestigeRank: 1,
    counters: { kills: 100 },
    arena: { wins_2v2: 3 },
    dungeonClears: null,
    delveClears: null,
    playtimeSeconds: 3600,
    playSessions: 12,
    createdAt: '2026-01-01',
    lastLogin: '2026-08-04',
  };
}

describe('CensusExporter', () => {
  test('runOnce enqueues every loaded row and counts the run', async () => {
    const records: Record<string, unknown>[] = [];
    const counters = createParseCounters();
    const exporter = new CensusExporter(
      async (day) => {
        expect(day).toBe('2026-08-05');
        return [censusRow(1), censusRow(2)];
      },
      { enqueue: (r) => records.push(r) },
      counters,
      9,
    );

    const count = await exporter.runOnce('2026-08-05');

    expect(count).toBe(2);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ t: 'census', characterId: 1, snapshotDate: '2026-08-05' });
    expect(counters.censusRuns).toBe(1);
    expect(counters.censusRows).toBe(2);
  });

  test('a loader failure degrades to a counter, never a throw', async () => {
    const counters = createParseCounters();
    const exporter = new CensusExporter(
      async () => {
        throw new Error('db down');
      },
      { enqueue: () => undefined },
      counters,
      9,
    );

    const count = await exporter.runOnce('2026-08-05');

    expect(count).toBe(0);
    expect(counters.censusFailures).toBe(1);
    expect(counters.censusRuns).toBe(0);
  });

  test('a snapshot date defaults to today in YYYY-MM-DD form', async () => {
    let seenDay = '';
    const exporter = new CensusExporter(
      async (day) => {
        seenDay = day;
        return [];
      },
      { enqueue: () => undefined },
      createParseCounters(),
      9,
    );

    await exporter.runOnce();

    expect(seenDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('CensusExporter schedule', () => {
  function exporterAt(iso: string, hour: number, loads: string[]) {
    const counters = createParseCounters();
    const exporter = new CensusExporter(
      async (day) => {
        loads.push(day);
        return [];
      },
      { enqueue: () => undefined },
      counters,
      hour,
      () => new Date(iso),
    );
    return exporter;
  }

  test('fires only at the configured UTC hour', async () => {
    const loads: string[] = [];
    const off = exporterAt('2026-08-06T08:59:00Z', 9, loads);
    expect(await off.maybeRun()).toBe(false);
    const on = exporterAt('2026-08-06T09:10:00Z', 9, loads);
    expect(await on.maybeRun()).toBe(true);
    expect(loads).toEqual(['2026-08-06']);
  });

  test('runs at most once per day, then again the next day', async () => {
    const loads: string[] = [];
    let iso = '2026-08-06T09:10:00Z';
    const counters = createParseCounters();
    const exporter = new CensusExporter(
      async (day) => {
        loads.push(day);
        return [];
      },
      { enqueue: () => undefined },
      counters,
      9,
      () => new Date(iso),
    );

    expect(await exporter.maybeRun()).toBe(true);
    iso = '2026-08-06T09:55:00Z';
    expect(await exporter.maybeRun()).toBe(false);
    iso = '2026-08-07T09:01:00Z';
    expect(await exporter.maybeRun()).toBe(true);
    expect(loads).toEqual(['2026-08-06', '2026-08-07']);
  });
});

describe('census batch walk', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function rawRows(firstId: number, count: number): CensusRowRaw[] {
    return Array.from({ length: count }, (_, i) => ({
      id: String(firstId + i),
      name: `Char${firstId + i}`,
      class: 'mage',
      level: 20,
      state: null,
      created_at: null,
      last_login: null,
      playtime: '0',
      sessions: 0,
    }));
  }

  test('keysets from the last id of each full batch until a short one', async () => {
    const seen: number[] = [];
    const records = await walkCensusBatches(async (lastId) => {
      seen.push(lastId);
      return lastId === 0 ? rawRows(1, CENSUS_BATCH_SIZE) : rawRows(lastId + 1, 2);
    }, '2026-10-05');

    expect(seen).toEqual([0, CENSUS_BATCH_SIZE]);
    expect(records).toHaveLength(CENSUS_BATCH_SIZE + 2);
    expect(records.at(-1)).toMatchObject({ characterId: CENSUS_BATCH_SIZE + 2 });
  });

  test('a batch that fails once is retried at the same keyset, not the day', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: number[] = [];
    let retries = 0;
    let failed = false;
    const records = await walkCensusBatches(
      async (lastId) => {
        seen.push(lastId);
        if (lastId === CENSUS_BATCH_SIZE && !failed) {
          failed = true;
          throw new Error('canceling statement due to statement timeout');
        }
        return lastId === 0 ? rawRows(1, CENSUS_BATCH_SIZE) : rawRows(lastId + 1, 3);
      },
      '2026-10-05',
      () => retries++,
    );

    expect(seen).toEqual([0, CENSUS_BATCH_SIZE, CENSUS_BATCH_SIZE]);
    expect(records).toHaveLength(CENSUS_BATCH_SIZE + 3);
    expect(retries).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a batch that keeps failing throws once the run budget is spent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    await expect(
      walkCensusBatches(async () => {
        calls++;
        throw new Error('canceling statement due to statement timeout');
      }, '2026-10-05'),
    ).rejects.toThrow('statement timeout');
    expect(calls).toBe(CENSUS_RUN_RETRIES + 1);
  });

  test('the retry budget is shared by the whole run, not granted per batch', async () => {
    // Two failures per batch: the first batch spends two retries, the second
    // spends the last one, and its next failure ends the run. A per-batch
    // budget would instead retry every batch of a systemically slow plan.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failuresLeft = new Map([
      [0, 2],
      [CENSUS_BATCH_SIZE, 2],
    ]);
    const seen: number[] = [];
    let retries = 0;
    await expect(
      walkCensusBatches(
        async (lastId) => {
          seen.push(lastId);
          const left = failuresLeft.get(lastId) ?? 0;
          if (left > 0) {
            failuresLeft.set(lastId, left - 1);
            throw new Error('canceling statement due to statement timeout');
          }
          return lastId === 0 ? rawRows(1, CENSUS_BATCH_SIZE) : rawRows(lastId + 1, 3);
        },
        '2026-10-05',
        () => retries++,
      ),
    ).rejects.toThrow('statement timeout');
    expect(seen).toEqual([0, 0, 0, CENSUS_BATCH_SIZE, CENSUS_BATCH_SIZE]);
    expect(retries).toBe(CENSUS_RUN_RETRIES);
  });
});
