import { describe, expect, it } from 'vitest';
import {
  questTrackerSectionOf,
  questTrackerSections,
  questTrackerView,
  type TrackedQuest,
} from '../src/ui/hud/quest/quest_tracker';

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
    expect(v.quests[0].objectives[0]).toMatchObject({ done: false, counted: true }); // 0/8
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

  it('marks single-step objectives as muted rows without a numeric value', () => {
    const v = questTrackerView(
      [
        {
          id: 'x',
          number: 1,
          title: 'X',
          complete: false,
          objectives: [{ label: 'Return to Brandt', current: 0, total: 1 }],
        },
      ],
      false,
    );
    expect(v.quests[0].objectives[0]).toMatchObject({ done: false, counted: false });
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

describe('questTrackerSections', () => {
  const WORLD_QUEST: TrackedQuest = {
    id: 'wq_bandits',
    number: 3,
    title: 'Bandit Trouble',
    complete: false,
    worldQuest: true,
    objectives: [{ label: 'Bandits defeated', current: 2, total: 10 }],
  };

  it('splits a world quest and a normal quest into their own sections, Quests first', () => {
    const sections = questTrackerSections([WORLD_QUEST, QUESTS[0]], () => false);
    expect(sections.map((s) => s.section)).toEqual(['quests', 'worldQuests']);
    expect(sections[0].quests.map((q) => q.id)).toEqual(['wolves']);
    expect(sections[0].count).toBe(1);
    expect(sections[1].quests.map((q) => q.id)).toEqual(['wq_bandits']);
    expect(sections[1].count).toBe(1);
    expect(sections[1].quests[0].objectives[0]).toMatchObject({
      current: 2,
      total: 10,
      done: false,
      counted: true,
    });
  });

  it('keeps arrival order inside a section and leaves an empty section out', () => {
    const only = questTrackerSections(QUESTS, () => false);
    expect(only.map((s) => s.section)).toEqual(['quests']);
    expect(only[0].quests.map((q) => q.id)).toEqual(['wolves', 'webwood']);
    const wqOnly = questTrackerSections([WORLD_QUEST], () => false);
    expect(wqOnly.map((s) => s.section)).toEqual(['worldQuests']);
    expect(questTrackerSections([], () => false)).toEqual([]);
  });

  it('collapses each section independently while keeping its count', () => {
    const sections = questTrackerSections(
      [...QUESTS, WORLD_QUEST],
      (section) => section === 'worldQuests',
    );
    expect(sections[0]).toMatchObject({ section: 'quests', collapsed: false, count: 2 });
    expect(sections[0].quests).toHaveLength(2);
    expect(sections[1]).toMatchObject({ section: 'worldQuests', collapsed: true, count: 1 });
    expect(sections[1].quests).toEqual([]);
  });

  it('maps a header section attribute back to its section', () => {
    expect(questTrackerSectionOf('worldQuests')).toBe('worldQuests');
    expect(questTrackerSectionOf(undefined)).toBe('quests');
    expect(questTrackerSectionOf('bogus')).toBe('quests');
  });
});
