import { describe, expect, it } from 'vitest';
import { savedQuestLog } from '../src/sim/quests/quest_log_persist';
import type { QuestProgress } from '../src/sim/types';

describe('extracted quest log save projection', () => {
  it('preserves optional credit fields and clones every mutable array and object', () => {
    const q = {
      questId: 'q',
      counts: [1],
      state: 'active',
      selection: 'herbalism',
      resolvedCounts: [2],
      burnedObjects: [{ key: 'a', at: 5 }],
      creditedObjects: ['b'],
      rev: 3,
    } as unknown as QuestProgress;
    const saved = savedQuestLog({ questLog: new Map([['q', q]]) });
    expect(saved).toEqual([{ ...q }]);
    saved[0].counts.push(5);
    saved[0].burnedObjects![0].at = 10;
    saved[0].creditedObjects!.push('c');
    expect(q.counts).toEqual([1]);
    expect(q.burnedObjects![0].at).toBe(5);
    expect(q.creditedObjects).toEqual(['b']);
  });
});
