import { readFileSync } from 'node:fs';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  addRefundToInventory,
  COMPLETION_MARKER_KEY,
  type RiftForgeRollbackRuntime,
  rollbackCharacterState,
  rollbackInstance,
  runRiftForgeRollbackMigration,
  upgradeEssenceSpent,
} from '../scripts/rift_forge_rollback_migration';
import { RIFT_ITEMS } from '../src/sim/content/rift/items';

function forgedRing(overrides: Record<string, unknown> = {}) {
  return {
    rolled: { quality: 'epic', stats: { str: 11, sta: 9, int: 4 } } as Record<string, unknown>,
    rift: {
      sourceEventId: 'rift-1-test',
      tier: 'S',
      power: 4,
      upgradeLevel: 5,
      maxUpgradeLevel: 5,
      baseStats: { str: 4, sta: 2 },
      enchant: { stat: 'str', value: 2 },
      gemSlots: 2,
      gems: ['rift_gem_crimson', 'rift_gem_azure'],
      ...overrides,
    },
  };
}

function queryResult<Row extends QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return { command: '', rowCount: rows.length, oid: 0, fields: [], rows };
}

interface MigrationHarnessOptions {
  activeLeases?: string;
  marker?: unknown;
  remaining?: string;
  updateRowCount?: number;
  characters?: Array<{ id: number; name: string; realm: string; state: unknown }>;
}

function migrationHarness(options: MigrationHarnessOptions = {}) {
  const statements: string[] = [];
  const querySpy = vi.fn(async (text: string, _values?: unknown[]) => {
    statements.push(text);
    if (text.includes('SELECT data FROM world_state')) {
      return queryResult(options.marker === undefined ? [] : [{ data: options.marker }]);
    }
    if (text.includes('FROM character_leases')) {
      return queryResult([{ count: options.activeLeases ?? '0' }]);
    }
    if (text.includes('SELECT id, name, realm, state')) {
      return queryResult(options.characters ?? []);
    }
    if (text.includes('SELECT count(*)::text AS count')) {
      return queryResult([{ count: options.remaining ?? '0' }]);
    }
    if (text.startsWith('UPDATE characters')) {
      return { ...queryResult(), rowCount: options.updateRowCount ?? 1 };
    }
    return queryResult();
  });
  const release = vi.fn();
  const client = {
    query: querySpy as unknown as PoolClient['query'],
    release,
  } as unknown as PoolClient;
  const poolQuery = vi.fn(() => {
    throw new Error('runner must not use pool.query');
  });
  const connect = vi.fn(async () => client);
  const end = vi.fn(async () => undefined);
  const pool = { connect, end, query: poolQuery } as unknown as Pool;
  const runtime: RiftForgeRollbackRuntime = {
    loadEnvFile: vi.fn(),
    databaseUrl: () => 'postgres://unit.test/rift',
    createPool: vi.fn(() => pool),
  };
  return { client, connect, end, poolQuery, querySpy, release, runtime, statements };
}

function statementKind(text: string): string {
  if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return text;
  if (text.includes('pg_advisory_xact_lock')) return 'LOCK';
  if (text.includes('SELECT data FROM world_state')) return 'MARKER';
  if (text === 'LOCK TABLE characters IN ACCESS EXCLUSIVE MODE') return 'CHARACTERS_TABLE_LOCK';
  if (text === 'LOCK TABLE character_leases IN SHARE MODE') return 'LEASE_TABLE_LOCK';
  if (text === 'DELETE FROM character_leases WHERE expires_at <= now()') {
    return 'EXPIRED_LEASE_DELETE';
  }
  if (text.includes('FROM character_leases')) return 'LEASE_CHECK';
  if (text.includes('SELECT id, name, realm, state')) return 'CHARACTERS';
  if (text.startsWith('UPDATE characters')) return 'UPDATE';
  if (text.includes('SELECT count(*)::text AS count')) return 'VERIFY';
  if (text.includes('INSERT INTO world_state')) return 'INSERT_MARKER';
  return text;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('one-off contract', () => {
  test('the completion marker key is namespaced and date-stamped', () => {
    expect(COMPLETION_MARKER_KEY).toMatch(/^migration:rift-forge-rollback-\d{4}-\d{2}-\d{2}$/);
  });

  test('rejects a scoped apply before loading env or opening a database pool', async () => {
    const harness = migrationHarness();
    await expect(
      runRiftForgeRollbackMigration(['--apply', '--realm', 'Claudemoon'], harness.runtime),
    ).rejects.toThrow('--realm is dry-run-only');
    expect(harness.runtime.loadEnvFile).not.toHaveBeenCalled();
    expect(harness.runtime.createPool).not.toHaveBeenCalled();
  });

  test.each([['--realm'], ['--realm='], ['--realm', '--apply']])(
    'rejects a missing realm value in argv %j before opening a database pool',
    async (...argv) => {
      const harness = migrationHarness();
      await expect(runRiftForgeRollbackMigration(argv, harness.runtime)).rejects.toThrow(
        '--realm requires a realm name',
      );
      expect(harness.runtime.createPool).not.toHaveBeenCalled();
    },
  );

  test('allows a scoped dry run and rolls its transaction back', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const harness = migrationHarness();

    await runRiftForgeRollbackMigration(['--realm', 'Claudemoon'], harness.runtime);

    expect(harness.statements.map(statementKind)).toEqual([
      'BEGIN',
      'LOCK',
      'MARKER',
      'CHARACTERS',
      'ROLLBACK',
    ]);
    const selection = harness.querySpy.mock.calls.find(([text]) =>
      String(text).includes('SELECT id, name, realm, state'),
    );
    expect(selection?.[0]).toContain('AND realm = $2');
    expect(selection?.[1]).toEqual(['%"rift":%', 'Claudemoon']);
  });

  test('pins every apply statement to one client and commits marker after verification', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const selectedState = {
      inventory: [{ itemId: 'riftbound_band_of_might', count: 1, instance: forgedRing() }],
    };
    const harness = migrationHarness({
      characters: [
        {
          id: 7,
          name: 'Tester',
          realm: 'Claudemoon',
          state: selectedState,
        },
      ],
    });

    await runRiftForgeRollbackMigration(['--apply'], harness.runtime);

    expect(harness.statements.map(statementKind)).toEqual([
      'BEGIN',
      'LOCK',
      'MARKER',
      'CHARACTERS_TABLE_LOCK',
      'LEASE_TABLE_LOCK',
      'EXPIRED_LEASE_DELETE',
      'LEASE_CHECK',
      'CHARACTERS',
      'UPDATE',
      'VERIFY',
      'INSERT_MARKER',
      'COMMIT',
    ]);
    expect(harness.poolQuery).not.toHaveBeenCalled();
    expect(harness.connect).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(1);
    expect(harness.end).toHaveBeenCalledTimes(1);

    const advisoryLock = harness.querySpy.mock.calls.find(([text]) =>
      String(text).includes('pg_advisory_xact_lock'),
    );
    expect(advisoryLock?.[0]).toBe('SELECT pg_advisory_xact_lock($1, $2)');
    expect(advisoryLock?.[1]).toEqual([3354, 20260813]);

    const markerInsert = harness.querySpy.mock.calls.find(([text]) =>
      String(text).includes('INSERT INTO world_state'),
    );
    const markerData = JSON.parse(String(markerInsert?.[1]?.[1])) as { realmScope?: string };
    expect(markerData.realmScope).toBe('all');

    const characterUpdate = harness.querySpy.mock.calls.find(([text]) =>
      String(text).startsWith('UPDATE characters'),
    );
    expect(characterUpdate?.[0]).toContain('state IS NOT DISTINCT FROM $3::jsonb');
    expect(characterUpdate?.[1]?.[2]).toBe(JSON.stringify(selectedState));
  });

  test('rolls back on the same client when verification fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const harness = migrationHarness({
      remaining: '1',
      characters: [
        {
          id: 8,
          name: 'Rollback',
          realm: 'Claudemoon',
          state: {
            inventory: [{ itemId: 'riftbound_band_of_might', count: 1, instance: forgedRing() }],
          },
        },
      ],
    });

    await expect(runRiftForgeRollbackMigration(['--apply'], harness.runtime)).rejects.toThrow(
      'Migration verification failed',
    );

    expect(harness.statements.map(statementKind)).toEqual([
      'BEGIN',
      'LOCK',
      'MARKER',
      'CHARACTERS_TABLE_LOCK',
      'LEASE_TABLE_LOCK',
      'EXPIRED_LEASE_DELETE',
      'LEASE_CHECK',
      'CHARACTERS',
      'UPDATE',
      'VERIFY',
      'ROLLBACK',
    ]);
    expect(harness.poolQuery).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledTimes(1);
    expect(harness.end).toHaveBeenCalledTimes(1);
  });

  test('takes the transaction lock before marker arbitration and refuses a completed run', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const harness = migrationHarness({ marker: { realmScope: 'all' } });

    await runRiftForgeRollbackMigration(['--apply'], harness.runtime);

    expect(harness.statements.map(statementKind)).toEqual(['BEGIN', 'LOCK', 'MARKER', 'ROLLBACK']);
    expect(harness.poolQuery).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledTimes(1);
  });

  test('refuses apply while any character lease remains and rolls back', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const harness = migrationHarness({ activeLeases: '2' });

    await expect(runRiftForgeRollbackMigration(['--apply'], harness.runtime)).rejects.toThrow(
      'all game servers stopped and drained',
    );

    expect(harness.statements.map(statementKind)).toEqual([
      'BEGIN',
      'LOCK',
      'MARKER',
      'CHARACTERS_TABLE_LOCK',
      'LEASE_TABLE_LOCK',
      'EXPIRED_LEASE_DELETE',
      'LEASE_CHECK',
      'ROLLBACK',
    ]);
  });

  test('aborts and rolls back when a selected character changed before its update', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const harness = migrationHarness({
      updateRowCount: 0,
      characters: [
        {
          id: 9,
          name: 'Concurrent',
          realm: 'Claudemoon',
          state: {
            inventory: [{ itemId: 'riftbound_band_of_might', count: 1, instance: forgedRing() }],
          },
        },
      ],
    });

    await expect(runRiftForgeRollbackMigration(['--apply'], harness.runtime)).rejects.toThrow(
      'changed after migration selection',
    );
    expect(harness.statements.map(statementKind)).toEqual([
      'BEGIN',
      'LOCK',
      'MARKER',
      'CHARACTERS_TABLE_LOCK',
      'LEASE_TABLE_LOCK',
      'EXPIRED_LEASE_DELETE',
      'LEASE_CHECK',
      'CHARACTERS',
      'UPDATE',
      'ROLLBACK',
    ]);
  });

  test('orchestrates concurrent runners so only one can write the completion marker', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let lockHeld = false;
    const lockWaiters: Array<() => void> = [];
    let durableMarker: string | undefined;

    const acquireLock = async (): Promise<void> => {
      if (!lockHeld) {
        lockHeld = true;
        return;
      }
      await new Promise<void>((resolve) => lockWaiters.push(resolve));
    };
    const releaseLock = (): void => {
      const next = lockWaiters.shift();
      if (next) next();
      else lockHeld = false;
    };

    const makeRuntime = () => {
      const statements: string[] = [];
      let pendingMarker: string | undefined;
      const querySpy = vi.fn(async (text: string, values?: unknown[]) => {
        statements.push(text);
        if (text.includes('pg_advisory_xact_lock')) await acquireLock();
        if (text.includes('SELECT data FROM world_state')) {
          return queryResult(durableMarker ? [{ data: JSON.parse(durableMarker) }] : []);
        }
        if (text.includes('FROM character_leases')) return queryResult([{ count: '0' }]);
        if (text.includes('SELECT id, name, realm, state')) return queryResult();
        if (text.includes('SELECT count(*)::text AS count')) return queryResult([{ count: '0' }]);
        if (text.includes('INSERT INTO world_state')) pendingMarker = String(values?.[1]);
        if (text === 'COMMIT') {
          durableMarker = pendingMarker;
          releaseLock();
        } else if (text === 'ROLLBACK') {
          releaseLock();
        }
        return queryResult();
      });
      const client = {
        query: querySpy as unknown as PoolClient['query'],
        release: vi.fn(),
      } as unknown as PoolClient;
      const pool = {
        connect: vi.fn(async () => client),
        query: vi.fn(() => {
          throw new Error('runner must not use pool.query');
        }),
        end: vi.fn(async () => undefined),
      } as unknown as Pool;
      const runtime: RiftForgeRollbackRuntime = {
        loadEnvFile: vi.fn(),
        databaseUrl: () => 'postgres://unit.test/rift',
        createPool: () => pool,
      };
      return { querySpy, runtime, statements };
    };

    const first = makeRuntime();
    const second = makeRuntime();
    await Promise.all([
      runRiftForgeRollbackMigration(['--apply'], first.runtime),
      runRiftForgeRollbackMigration(['--apply'], second.runtime),
    ]);

    const sequences = [first, second].map(({ statements }) => statements.map(statementKind));
    expect(sequences.filter((sequence) => sequence.includes('INSERT_MARKER'))).toHaveLength(1);
    expect(sequences.filter((sequence) => sequence.includes('COMMIT'))).toHaveLength(1);
    expect(sequences.filter((sequence) => sequence.at(-1) === 'ROLLBACK')).toHaveLength(1);
    for (const sequence of sequences) {
      expect(sequence.indexOf('LOCK')).toBeLessThan(sequence.indexOf('MARKER'));
    }
    for (const runner of [first, second]) {
      const advisoryLock = runner.querySpy.mock.calls.find(([text]) =>
        String(text).includes('pg_advisory_xact_lock'),
      );
      expect(advisoryLock?.[0]).toBe('SELECT pg_advisory_xact_lock($1, $2)');
      expect(advisoryLock?.[1]).toEqual([3354, 20260813]);
    }
  });
});

describe('cost model parity with src/sim/rift/progression.ts', () => {
  const progressionSource = readFileSync('src/sim/rift/progression.ts', 'utf8');

  test('upgrade step cost in the sim is 2 + 2 * level', () => {
    expect(progressionSource).toContain('const cost = 2 + gear.upgradeLevel * 2;');
  });

  test('enchant cost in the sim is a flat 4', () => {
    expect(progressionSource).toContain('const cost = 4;');
  });

  test('socketing consumes exactly one gem item and no essence', () => {
    expect(progressionSource).toContain('ctx.removeItem(gemId, 1, r.meta.entityId);');
  });

  test('refund stack size matches the essence and gem item stack size', () => {
    expect(RIFT_ITEMS.rift_essence.stackSize).toBe(20);
    expect(RIFT_ITEMS.rift_gem_crimson.stackSize).toBe(20);
  });
});

describe('upgradeEssenceSpent', () => {
  test('sums the per-step ladder: reaching level N cost N * (N + 1)', () => {
    // Steps cost 2, 4, 6, 8, 10: cumulative 2, 6, 12, 20, 30.
    expect(upgradeEssenceSpent(0)).toBe(0);
    expect(upgradeEssenceSpent(1)).toBe(2);
    expect(upgradeEssenceSpent(2)).toBe(6);
    expect(upgradeEssenceSpent(3)).toBe(12);
    expect(upgradeEssenceSpent(4)).toBe(20);
    expect(upgradeEssenceSpent(5)).toBe(30);
  });

  test('tolerates junk input', () => {
    expect(upgradeEssenceSpent(Number.NaN)).toBe(0);
    expect(upgradeEssenceSpent(-3)).toBe(0);
  });
});

describe('rollbackInstance', () => {
  test('fully forged ring refunds 34 essence and both gems', () => {
    const result = rollbackInstance(forgedRing());
    expect(result.changed).toBe(true);
    expect(result.refund.essence).toBe(34);
    expect(result.refund.gems).toEqual(['rift_gem_crimson', 'rift_gem_azure']);
  });

  test('resets the payload to its as-dropped state', () => {
    const result = rollbackInstance(forgedRing());
    const rift = result.value.rift as Record<string, unknown>;
    expect(rift.upgradeLevel).toBe(0);
    expect(rift.gems).toEqual([]);
    expect('enchant' in rift).toBe(false);
    expect(rift.baseStats).toEqual({ str: 4, sta: 2 });
    expect(rift.maxUpgradeLevel).toBe(5);
    expect(rift.sourceEventId).toBe('rift-1-test');
  });

  test('rebuilds rolled stats to base stats, materializing sta like the live rebuild', () => {
    const result = rollbackInstance(forgedRing({ baseStats: { int: 4, spi: 2 } }));
    expect(result.value.rolled).toEqual({
      quality: 'epic',
      stats: { int: 4, spi: 2, sta: 0 },
    });
  });

  test('preserves unrelated rolled fields and instance fields', () => {
    const instance = { ...forgedRing(), signer: 'Somebody' };
    instance.rolled = { ...instance.rolled, masterwork: true };
    const result = rollbackInstance(instance);
    expect(result.value.signer).toBe('Somebody');
    expect((result.value.rolled as Record<string, unknown>).masterwork).toBe(true);
  });

  test('does not mutate the input instance', () => {
    const instance = forgedRing();
    const snapshot = JSON.parse(JSON.stringify(instance));
    rollbackInstance(instance);
    expect(instance).toEqual(snapshot);
  });

  test('an unforged rift item is untouched', () => {
    const result = rollbackInstance(forgedRing({ upgradeLevel: 0, enchant: undefined, gems: [] }));
    expect(result.changed).toBe(false);
    expect(result.refund.essence).toBe(0);
  });

  test('a non-rift instance is untouched', () => {
    const instance = { rolled: { quality: 'rare', stats: { agi: 3 } } };
    const result = rollbackInstance(instance);
    expect(result.changed).toBe(false);
  });

  test('upgrade-only ring refunds essence with no gems', () => {
    const result = rollbackInstance(forgedRing({ enchant: undefined, gems: [] }));
    expect(result.refund.essence).toBe(30);
    expect(result.refund.gems).toEqual([]);
  });
});

describe('addRefundToInventory', () => {
  test('tops up an existing plain stack before appending', () => {
    const inventory = [{ itemId: 'rift_essence', count: 15 }];
    const result = addRefundToInventory(inventory, 'rift_essence', 30) as Array<{
      itemId: string;
      count: number;
    }>;
    expect(result).toEqual([
      { itemId: 'rift_essence', count: 20 },
      { itemId: 'rift_essence', count: 20 },
      { itemId: 'rift_essence', count: 5 },
    ]);
  });

  test('never tops up a stack that carries an instance payload', () => {
    const inventory = [{ itemId: 'rift_essence', count: 1, instance: { signer: 'X' } }];
    const result = addRefundToInventory(inventory, 'rift_essence', 2) as Array<{ count: number }>;
    expect(result[0].count).toBe(1);
    expect(result[1]).toEqual({ itemId: 'rift_essence', count: 2 });
  });

  test('appends past capacity rather than dropping a refund', () => {
    const inventory = Array.from({ length: 16 }, (_, i) => ({ itemId: `filler_${i}`, count: 1 }));
    const result = addRefundToInventory(inventory, 'rift_essence', 68) as unknown[];
    expect(result.length).toBe(20);
  });

  test('does not mutate the input inventory', () => {
    const inventory = [{ itemId: 'rift_essence', count: 15 }];
    addRefundToInventory(inventory, 'rift_essence', 30);
    expect(inventory).toEqual([{ itemId: 'rift_essence', count: 15 }]);
  });
});

describe('rollbackCharacterState', () => {
  test('covers equipped, bagged, banked, and buyback instances without refunding a legacy shadow', () => {
    const state = {
      inventory: [
        { itemId: 'riftbound_band_of_might', count: 1, instance: forgedRing() },
        { itemId: 'rift_essence', count: 3 },
      ],
      vendorBuyback: [{ itemId: 'riftbound_band_of_guile', count: 1, instance: forgedRing() }],
      bank: {
        inventory: [{ itemId: 'riftbound_band_of_insight', count: 1, instance: forgedRing() }],
        purchasedSlots: 0,
        bonusSlots: 0,
      },
      equipmentInstance: { ring1: forgedRing() },
      equipmentInstances: { ring2: forgedRing() },
    };

    const result = rollbackCharacterState(state);
    expect(result.changed).toBe(true);
    expect(result.report.instancesReset).toBe(4);
    expect(result.report.essenceRefunded).toBe(136);
    expect(result.report.gemsReturned).toEqual({
      rift_gem_crimson: 4,
      rift_gem_azure: 4,
    });
    expect(result.value).not.toHaveProperty('equipmentInstances');

    const inventory = (result.value as Record<string, unknown>).inventory as Array<{
      itemId: string;
      count: number;
    }>;
    const essenceTotal = inventory
      .filter((slot) => slot.itemId === 'rift_essence')
      .reduce((sum, slot) => sum + slot.count, 0);
    expect(essenceTotal).toBe(139);
  });

  test('falls back to and refunds the legacy equipment key when the current key is absent', () => {
    const result = rollbackCharacterState({
      inventory: [],
      equipmentInstances: { ring1: forgedRing() },
    });

    expect(result.report.instancesReset).toBe(1);
    expect(result.report.essenceRefunded).toBe(34);
    expect(result.value).toHaveProperty('equipmentInstances.ring1.rift.upgradeLevel', 0);
  });

  test('uses current equipment precedence and never double-refunds a duplicated logical copy', () => {
    const current = forgedRing({ upgradeLevel: 1, enchant: undefined, gems: [] });
    const result = rollbackCharacterState({
      inventory: [],
      equipmentInstance: { ring1: current },
      equipmentInstances: { ring1: structuredClone(current) },
    });

    expect(result.report.instancesReset).toBe(1);
    expect(result.report.essenceRefunded).toBe(2);
    expect(result.value).not.toHaveProperty('equipmentInstances');
    expect(rollbackCharacterState(result.value).changed).toBe(false);
  });

  test('drops a forged legacy shadow without a refund when the current record is active', () => {
    const result = rollbackCharacterState({
      inventory: [],
      equipmentInstance: {},
      equipmentInstances: { ring1: forgedRing() },
    });

    expect(result.changed).toBe(true);
    expect(result.report.instancesReset).toBe(0);
    expect(result.report.essenceRefunded).toBe(0);
    expect(result.report.gemsReturned).toEqual({});
    expect(result.value).not.toHaveProperty('equipmentInstances');
  });

  test('is idempotent: a second pass changes nothing', () => {
    const state = {
      inventory: [{ itemId: 'riftbound_band_of_might', count: 1, instance: forgedRing() }],
    };
    const first = rollbackCharacterState(state);
    const second = rollbackCharacterState(first.value);
    expect(second.changed).toBe(false);
  });

  test('a character with no forge effects is untouched', () => {
    const state = {
      inventory: [
        {
          itemId: 'riftbound_band_of_might',
          count: 1,
          instance: forgedRing({ upgradeLevel: 0, enchant: undefined, gems: [] }),
        },
      ],
    };
    const result = rollbackCharacterState(state);
    expect(result.changed).toBe(false);
    expect(result.value).toBe(state);
  });

  test('does not mutate the input state', () => {
    const state = {
      inventory: [{ itemId: 'riftbound_band_of_might', count: 1, instance: forgedRing() }],
    };
    const snapshot = JSON.parse(JSON.stringify(state));
    rollbackCharacterState(state);
    expect(state).toEqual(snapshot);
  });
});
