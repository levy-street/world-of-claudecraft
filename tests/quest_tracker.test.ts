import { describe, expect, it } from 'vitest';
import { questTrackerView, type TrackedQuest } from '../src/ui/quest_tracker';

// Titles/labels are already resolved before the tracker receives them.
const QUESTS: TrackedQuest[] = [
  {
    id: 'wolves',
    number: 1,
    title: 'Wolves at the Door',
    complete: false,
    objectives: [{ label: 'Forest Wolf slain', current: 0, total: 8 }],
  },
  {
    id: 'webwood',
    number: 2,
    title: 'Webwood Menace',
    complete: true,
    objectives: [
      { label: 'Webwood Lurker slain', current: 6, total: 6 },
      { label: 'Sableweb Silk Gland', current: 4, total: 4 },
    ],
  },
];

describe('questTrackerView', () => {
  it('is hidden when no quests are tracked', () => {
    const v = questTrackerView([], false);
    expect(v.visible).toBe(false);
    expect(v.count).toBe(0);
    expect(v.quests).toEqual([]);
  });

  it('stays hidden when collapsed with no quests (nothing to show)', () => {
    expect(questTrackerView([], true).visible).toBe(false);
  });

  it('expanded: emits every quest + objective with done computed', () => {
    const v = questTrackerView(QUESTS, false);
    expect(v.visible).toBe(true);
    expect(v.collapsed).toBe(false);
    expect(v.count).toBe(2);
    expect(v.quests).toHaveLength(2);
    // the acceptance-order number rides through (matches the map badges)
    expect(v.quests.map((q) => q.number)).toEqual([1, 2]);
    expect(v.quests[0].objectives[0].done).toBe(false); // 0/8
    expect(v.quests[1].complete).toBe(true);
    expect(v.quests[1].objectives.map((o) => o.done)).toEqual([true, true]); // 6/6, 4/4
  });

  it('collapsed: header only, but keeps the quest count', () => {
    const v = questTrackerView(QUESTS, true);
    expect(v.visible).toBe(true);
    expect(v.collapsed).toBe(true);
    expect(v.count).toBe(2);
    expect(v.quests).toEqual([]);
  });

  it('marks an objective done when current meets or exceeds total', () => {
    const over = questTrackerView(
      [
        {
          id: 'x',
          number: 1,
          title: 'X',
          complete: false,
          objectives: [{ label: 'o', current: 9, total: 8 }],
        },
      ],
      false,
    );
    expect(over.quests[0].objectives[0].done).toBe(true);
  });

  it('treats an objective with a zero total as done (0 >= 0)', () => {
    const v = questTrackerView(
      [
        {
          id: 'x',
          number: 1,
          title: 'X',
          complete: false,
          objectives: [{ label: 'o', current: 0, total: 0 }],
        },
      ],
      false,
    );
    expect(v.quests[0].objectives[0].done).toBe(true);
  });

  it('does not mutate the caller input and returns distinct copies', () => {
    const input: TrackedQuest[] = [
      {
        id: 'a',
        number: 1,
        title: 'A',
        complete: false,
        objectives: [{ label: 'o', current: 1, total: 2 }],
      },
    ];
    const snapshot = JSON.stringify(input);
    const v = questTrackerView(input, false);
    expect(JSON.stringify(input)).toBe(snapshot);
    // The consumer relies on getting its own quest/objective objects (never
    // references back into the caller's records), so a future refactor that
    // returned shared references would be a bug; assert the copy is distinct.
    expect(v.quests[0]).not.toBe(input[0]);
    expect(v.quests[0].objectives[0]).not.toBe(input[0].objectives[0]);
  });
});
