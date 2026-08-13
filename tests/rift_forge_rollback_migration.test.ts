import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  addRefundToInventory,
  COMPLETION_MARKER_KEY,
  rollbackCharacterState,
  rollbackInstance,
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

describe('one-off contract', () => {
  const migrationSource = readFileSync('scripts/rift_forge_rollback_migration.ts', 'utf8');

  test('the completion marker key is namespaced and date-stamped', () => {
    expect(COMPLETION_MARKER_KEY).toMatch(/^migration:rift-forge-rollback-\d{4}-\d{2}-\d{2}$/);
  });

  test('the runner refuses while the marker exists and writes it inside the apply transaction', () => {
    // Source pins rather than a live database: the refusal must happen before
    // BEGIN, and the marker insert must happen between verification and COMMIT,
    // so a failed apply never records completion.
    const refusalIndex = migrationSource.indexOf('Refusing to run: completion marker');
    const beginIndex = migrationSource.indexOf("await pool.query('BEGIN')");
    const markerInsertIndex = migrationSource.indexOf('INSERT INTO world_state');
    const commitIndex = migrationSource.indexOf("await pool.query('COMMIT')");
    expect(refusalIndex).toBeGreaterThan(-1);
    expect(beginIndex).toBeGreaterThan(refusalIndex);
    expect(markerInsertIndex).toBeGreaterThan(beginIndex);
    expect(commitIndex).toBeGreaterThan(markerInsertIndex);
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
  test('covers equipped, bagged, banked, buyback, and legacy-key instances', () => {
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
    expect(result.report.instancesReset).toBe(5);
    expect(result.report.essenceRefunded).toBe(170);
    expect(result.report.gemsReturned).toEqual({
      rift_gem_crimson: 5,
      rift_gem_azure: 5,
    });

    const inventory = (result.value as Record<string, unknown>).inventory as Array<{
      itemId: string;
      count: number;
    }>;
    const essenceTotal = inventory
      .filter((slot) => slot.itemId === 'rift_essence')
      .reduce((sum, slot) => sum + slot.count, 0);
    expect(essenceTotal).toBe(173);
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
