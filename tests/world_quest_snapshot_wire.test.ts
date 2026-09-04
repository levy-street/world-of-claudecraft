import { describe, expect, it } from 'vitest';
import type { QuestSelfMirrors } from '../src/net/quest_snapshot_wire';
import { applyQuestSelfWire } from '../src/net/quest_snapshot_wire';
import { interactObjectCreditKey } from '../src/sim/quests/interact_object_credit';

function mirrors(): QuestSelfMirrors {
  return {
    questLog: new Map(),
    questsDone: new Set(),
    worldQuestCycle: '2026-08-31',
    worldQuestExpiresAtMs: 1_800_000_000_000,
    worldQuestLog: new Map([
      ['wq_eastbrook_bandits', { questId: 'wq_eastbrook_bandits', count: 2, state: 'active' }],
    ]),
  };
}

describe('world quest snapshot wire', () => {
  it('retains delta mirrors for omitted or malformed containers without throwing', () => {
    const target = mirrors();
    applyQuestSelfWire(target, {});
    applyQuestSelfWire(target, {
      wqday: '2026-09-03',
      wqexp: Number.NaN,
      wqlog: { nope: true },
    });
    for (const deadline of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      applyQuestSelfWire(target, { wqexp: deadline });
    }
    expect(target.worldQuestCycle).toBe('2026-08-31');
    expect(target.worldQuestExpiresAtMs).toBe(1_800_000_000_000);
    expect([...target.worldQuestLog.values()]).toEqual([
      { questId: 'wq_eastbrook_bandits', count: 2, state: 'active' },
    ]);
  });

  it('does not clear a valid mirror when an explicit cycle is malformed', () => {
    const target = mirrors();
    applyQuestSelfWire(target, {
      wqday: { hostile: true },
      wqexp: 1_900_000_000_000,
      wqlog: [{ questId: 'wq_galecrest_wisps', count: 0, state: 'active' }],
    });

    expect(target.worldQuestCycle).toBe('2026-08-31');
    expect(target.worldQuestExpiresAtMs).toBe(1_800_000_000_000);
    expect([...target.worldQuestLog.values()]).toEqual([
      { questId: 'wq_eastbrook_bandits', count: 2, state: 'active' },
    ]);
  });

  it('adopts valid empty arrays and filters malformed, future, and prototype rows', () => {
    const target = mirrors();
    applyQuestSelfWire(target, {
      wqday: '2026-09-01',
      wqexp: 1_900_000_000_000,
      wqlog: [
        { questId: 'constructor', count: 1, state: 'completed' },
        { questId: 'future_world_quest', count: 1, state: 'active' },
        { questId: 'wq_eastbrook_bandits', count: Number.NaN, state: 'active' },
      ],
    });
    expect(target.worldQuestCycle).toBe('wq3_0');
    expect(target.worldQuestExpiresAtMs).toBe(1_900_000_000_000);
    expect([...target.worldQuestLog.values()]).toEqual([
      { questId: 'wq_eastbrook_bandits', count: 0, state: 'active' },
    ]);

    applyQuestSelfWire(target, { wqlog: [] });
    expect(target.worldQuestLog.size).toBe(0);
  });

  it('retains valid puzzle rotations and normalizes hostile snapshot values', () => {
    const target = mirrors();
    applyQuestSelfWire(target, {
      wqlog: [
        {
          questId: 'wq_galecrest_wisps',
          count: 0,
          state: 'active',
          puzzleRotations: [1, 5, -1, 2, Number.NaN, 0, 3, 2, 1],
        },
      ],
    });

    expect(target.worldQuestLog.get('wq_galecrest_wisps')).toEqual({
      questId: 'wq_galecrest_wisps',
      count: 0,
      state: 'active',
      puzzleVariant: 0,
      puzzleRotations: [1, 1, 3, 2, 0, 0, 3, 2, 1],
    });
  });

  it('adopts a rollover atomically and filters rows against its active rotation', () => {
    const target = mirrors();
    applyQuestSelfWire(target, {
      wqday: '2026-09-03',
      wqlog: [
        { questId: 'wq_eastbrook_bandits', count: 1, state: 'active' },
        {
          questId: 'wq_frostveil_howlers',
          count: 2,
          state: 'active',
          creditedObjects: [
            interactObjectCreditKey(0, { x: 1, z: 2 }),
            interactObjectCreditKey(0, { x: 3, z: 4 }),
            interactObjectCreditKey(0, { x: 5, z: 6 }),
          ],
        },
      ],
    });

    expect(target.worldQuestCycle).toBe('wq3_1');
    expect([...target.worldQuestLog.values()]).toEqual([
      {
        questId: 'wq_frostveil_howlers',
        count: 2,
        state: 'active',
        creditedObjects: ['0@1.0,2.0', '0@3.0,4.0'],
      },
    ]);
  });

  it('retains the forced Farshore dev offer when its projected cycle is wired online', () => {
    const target = mirrors();
    applyQuestSelfWire(target, {
      wqday: 'wq3_2',
      wqlog: [
        {
          questId: 'wq_farshore_salvage',
          count: 0,
          state: 'active',
          puzzleVariant: 0,
        },
      ],
    });

    expect(target.worldQuestCycle).toBe('wq3_2');
    expect(target.worldQuestLog.get('wq_farshore_salvage')).toEqual({
      questId: 'wq_farshore_salvage',
      count: 0,
      state: 'active',
      puzzleVariant: 0,
    });
  });
});
