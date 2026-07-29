// Pure-core pins for the bag grid's quest-purpose mark. The painter (bags_window)
// consumes bagQuestMarkKind for the .bag-quest class, corner seal, ready variant,
// and aria key; these tests own the KIND decision only (DOM/CSS contracts live
// next to the instance-marker suite).
import { describe, expect, it } from 'vitest';
import { bagQuestMarkKind, bagQuestMarkProgressFromLog } from '../src/ui/bag_quest_mark_view';

describe('bag_quest_mark_view: mark kind', () => {
  it('marks kind===quest as quest', () => {
    expect(bagQuestMarkKind({ kind: 'quest' })).toBe('quest');
  });

  it('returns null for every non-quest ItemKind', () => {
    // Real ItemKind set from src/sim/types.ts (minus quest).
    for (const kind of [
      'weapon',
      'armor',
      'held_offhand',
      'junk',
      'food',
      'drink',
      'tool',
      'potion',
      'elixir',
      'bag',
      'mount',
    ]) {
      expect(bagQuestMarkKind({ kind }), kind).toBeNull();
    }
  });

  it('is case-sensitive: only the exact sim kind token matches', () => {
    expect(bagQuestMarkKind({ kind: 'Quest' })).toBeNull();
    expect(bagQuestMarkKind({ kind: 'QUEST' })).toBeNull();
    expect(bagQuestMarkKind({ kind: '' })).toBeNull();
  });

  // Ready/orphaned must never be invented from kind alone; progress inputs are
  // required for the ready variant (Phase 5).
  it('does not invent ready or orphaned marks from kind alone', () => {
    expect(bagQuestMarkKind({ kind: 'quest' })).not.toBe('questReady');
    expect(bagQuestMarkKind({ kind: 'quest' })).not.toBe('questOrphaned');
    expect(bagQuestMarkKind({ kind: 'quest' }, null)).toBe('quest');
    expect(bagQuestMarkKind({ kind: 'quest' }, undefined)).toBe('quest');
  });
});

describe('bag_quest_mark_view: questReady', () => {
  it('returns questReady when log state is ready', () => {
    expect(bagQuestMarkKind({ kind: 'quest' }, { state: 'ready', matchingObjectives: [] })).toBe(
      'questReady',
    );
    expect(
      bagQuestMarkKind(
        { kind: 'quest' },
        { state: 'ready', matchingObjectives: [{ current: 5, required: 5 }] },
      ),
    ).toBe('questReady');
  });

  it('stays quest when active even if matching collect objectives are complete', () => {
    // Multi-objective quests can finish the item row while the log is still
    // active (other kill/speak rows remain). Ready is turn-in only.
    expect(
      bagQuestMarkKind(
        { kind: 'quest' },
        {
          state: 'active',
          matchingObjectives: [
            { current: 5, required: 5 },
            { current: 2, required: 2 },
          ],
        },
      ),
    ).toBe('quest');
  });

  it('stays quest when active but a matching objective is incomplete', () => {
    expect(
      bagQuestMarkKind(
        { kind: 'quest' },
        {
          state: 'active',
          matchingObjectives: [
            { current: 3, required: 5 },
            { current: 2, required: 2 },
          ],
        },
      ),
    ).toBe('quest');
  });

  it('stays quest when active with no matching collect/gather objectives', () => {
    expect(bagQuestMarkKind({ kind: 'quest' }, { state: 'active', matchingObjectives: [] })).toBe(
      'quest',
    );
    expect(bagQuestMarkKind({ kind: 'quest' }, { state: 'active' })).toBe('quest');
  });

  it('never returns questReady for non-quest kinds even with ready progress', () => {
    expect(
      bagQuestMarkKind({ kind: 'junk' }, { state: 'ready', matchingObjectives: [] }),
    ).toBeNull();
  });

  it('stays quest for done or unknown log states (not held for turn-in)', () => {
    expect(bagQuestMarkKind({ kind: 'quest' }, { state: 'done' })).toBe('quest');
    expect(
      bagQuestMarkKind(
        { kind: 'quest' },
        { state: 'done', matchingObjectives: [{ current: 5, required: 5 }] },
      ),
    ).toBe('quest');
    expect(bagQuestMarkKind({ kind: 'quest' }, { state: 'abandoned' })).toBe('quest');
  });
});

describe('bag_quest_mark_view: bagQuestMarkProgressFromLog', () => {
  const objectives = [
    { type: 'collect', itemId: 'boar_hide', count: 5 },
    { type: 'kill', itemId: undefined, count: 3 },
  ] as const;

  it('returns null without a log (cannot invent ready)', () => {
    expect(bagQuestMarkProgressFromLog('boar_hide', null, objectives)).toBeNull();
    expect(bagQuestMarkProgressFromLog('boar_hide', undefined, objectives)).toBeNull();
  });

  it('returns null for done (no longer held for turn-in)', () => {
    expect(
      bagQuestMarkProgressFromLog('boar_hide', { state: 'done', counts: [5] }, objectives),
    ).toBeNull();
  });

  it('projects ready state and matching collect rows', () => {
    expect(
      bagQuestMarkProgressFromLog('boar_hide', { state: 'ready', counts: [5, 0] }, objectives),
    ).toEqual({
      state: 'ready',
      matchingObjectives: [{ current: 5, required: 5 }],
    });
  });

  it('projects active incomplete collect progress', () => {
    expect(
      bagQuestMarkProgressFromLog('boar_hide', { state: 'active', counts: [2, 1] }, objectives),
    ).toEqual({
      state: 'active',
      matchingObjectives: [{ current: 2, required: 5 }],
    });
  });

  it('uses resolvedCounts when present', () => {
    expect(
      bagQuestMarkProgressFromLog(
        'boar_hide',
        { state: 'active', counts: [4], resolvedCounts: [8] },
        objectives,
      ),
    ).toEqual({
      state: 'active',
      matchingObjectives: [{ current: 4, required: 8 }],
    });
  });

  it('ignores kill/speak objectives and other item ids', () => {
    expect(
      bagQuestMarkProgressFromLog('boar_hide', { state: 'active', counts: [5, 3] }, [
        { type: 'kill', count: 3 },
        { type: 'collect', itemId: 'greyjaw_fang', count: 1 },
      ]),
    ).toEqual({ state: 'active', matchingObjectives: [] });
  });

  it('includes gather-with-item objectives', () => {
    expect(
      bagQuestMarkProgressFromLog('herb_sample', { state: 'active', counts: [1] }, [
        { type: 'gather', itemId: 'herb_sample', count: 1 },
      ]),
    ).toEqual({
      state: 'active',
      matchingObjectives: [{ current: 1, required: 1 }],
    });
  });

  it('round-trips into bagQuestMarkKind for ready vs in-progress', () => {
    const ready = bagQuestMarkProgressFromLog(
      'boar_hide',
      { state: 'ready', counts: [5] },
      objectives,
    );
    expect(bagQuestMarkKind({ kind: 'quest' }, ready)).toBe('questReady');

    const mid = bagQuestMarkProgressFromLog(
      'boar_hide',
      { state: 'active', counts: [2] },
      objectives,
    );
    expect(bagQuestMarkKind({ kind: 'quest' }, mid)).toBe('quest');

    const completeActive = bagQuestMarkProgressFromLog(
      'boar_hide',
      { state: 'active', counts: [5] },
      objectives,
    );
    // Full collect while still active is not turn-in ready.
    expect(bagQuestMarkKind({ kind: 'quest' }, completeActive)).toBe('quest');
  });
});
