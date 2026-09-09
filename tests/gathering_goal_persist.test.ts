import { describe, expect, it } from 'vitest';
import {
  loadGatheringGoal,
  saveGatheringGoal,
  validGatheringGoalCount,
  validGatheringGoalOrderId,
} from '../src/sim/professions/gathering_goal_persist';

describe('compact gathering goal persistence', () => {
  it('leaves old saves and explicitly cleared goals absent', () => {
    expect(loadGatheringGoal(undefined)).toBeUndefined();
    expect(loadGatheringGoal(null)).toBeUndefined();
    expect(saveGatheringGoal(undefined)).toBeUndefined();
  });

  it.each([1, 50])('retains a recipe quantity of %i without sharing mutable state', (count) => {
    const input = { kind: 'recipe', recipeId: 'retired_recipe', count };
    const loaded = loadGatheringGoal(input);
    expect(loaded).toEqual({ kind: 'recipe', recipeId: 'retired_recipe', count });
    expect(loaded).not.toBe(input);
    input.count = 2;
    expect(loaded?.kind === 'recipe' && loaded.count).toBe(count);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(saveGatheringGoal(loaded)).toEqual(loaded);
  });

  it('keeps commission display identity without any live binding', () => {
    const input = { kind: 'commission', recipeId: 'copper_blade', orderId: 7, count: 1 };
    const loaded = loadGatheringGoal(input);
    expect(loaded).toEqual(input);
    expect(loaded).not.toBe(input);
    expect(Object.keys(loaded!)).toEqual(['kind', 'recipeId', 'orderId', 'count']);
    expect(saveGatheringGoal(loaded)).toEqual(input);
  });

  it.each([0, -1, 1.5, 51, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1'])(
    'retains an invalid recipe count %s as unavailable instead of clamping',
    (count) => {
      expect(validGatheringGoalCount(count)).toBe(false);
      const loaded = loadGatheringGoal({ kind: 'recipe', recipeId: 'copper_blade', count });
      expect(loaded).toEqual({ kind: 'invalid' });
      expect(saveGatheringGoal(loaded)).toEqual({ kind: 'invalid' });
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])(
    'refuses malformed commission identity %s',
    (orderId) => {
      expect(validGatheringGoalOrderId(orderId)).toBe(false);
      expect(
        loadGatheringGoal({ kind: 'commission', recipeId: 'copper_blade', orderId, count: 1 }),
      ).toEqual({ kind: 'invalid' });
    },
  );

  it('does not permit a multi-item commission or persisted live-order payload', () => {
    expect(
      loadGatheringGoal({ kind: 'commission', recipeId: 'copper_blade', orderId: 1, count: 2 }),
    ).toEqual({ kind: 'invalid' });
    expect(
      loadGatheringGoal({
        kind: 'commission',
        recipeId: 'copper_blade',
        orderId: 1,
        count: 1,
        binding: { acceptedBy: 42 },
      }),
    ).toEqual({ kind: 'invalid' });
  });

  it.each([false, [], new Date(0), {}, { kind: 'other' }, { kind: 'recipe', count: 1 }])(
    'rejects unsupported stored shapes',
    (raw) => {
      expect(loadGatheringGoal(raw)).toEqual({ kind: 'invalid' });
    },
  );

  it('requires own closed fields and refuses control or unbounded identifiers', () => {
    expect(
      loadGatheringGoal(Object.create({ kind: 'recipe', recipeId: 'copper_blade', count: 1 })),
    ).toEqual({ kind: 'invalid' });
    for (const recipeId of ['', 'a'.repeat(129), 'a' + String.fromCharCode(0)]) {
      expect(loadGatheringGoal({ kind: 'recipe', recipeId, count: 1 })).toEqual({
        kind: 'invalid',
      });
    }
    expect(
      loadGatheringGoal(
        JSON.parse('{"kind":"recipe","recipeId":"copper_blade","count":1,"__proto__":{}}'),
      ),
    ).toEqual({ kind: 'invalid' });
  });
});
