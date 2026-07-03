// Tests for the world-map quest side list pure core (map_quest_list_view.ts):
// acceptance-order numbering, tracked flags, and the defensive localStorage
// parse/serialize for the untracked set.

import { describe, expect, it } from 'vitest';
import type { QuestProgress } from '../src/sim/types';
import {
  mapQuestListView,
  parseUntrackedQuests,
  questNumbersByLog,
  serializeUntrackedQuests,
} from '../src/ui/map_quest_list_view';

function log(entries: [string, QuestProgress['state']][]): Map<string, QuestProgress> {
  return new Map(entries.map(([questId, state]) => [questId, { questId, counts: [0], state }]));
}

describe('questNumbersByLog', () => {
  it('numbers quests 1-based in acceptance (insertion) order', () => {
    const numbers = questNumbersByLog(
      log([
        ['q_wolves', 'active'],
        ['q_boars', 'active'],
        ['q_spiders', 'ready'],
      ]),
    );
    expect(numbers.get('q_wolves')).toBe(1);
    expect(numbers.get('q_boars')).toBe(2);
    expect(numbers.get('q_spiders')).toBe(3);
  });
});

describe('mapQuestListView', () => {
  it('lists every logged quest in order with number, ready and tracked flags', () => {
    const rows = mapQuestListView(
      log([
        ['q_wolves', 'active'],
        ['q_boars', 'ready'],
      ]),
      new Set(['q_boars']),
    );
    expect(rows).toEqual([
      { questId: 'q_wolves', number: 1, ready: false, tracked: true },
      { questId: 'q_boars', number: 2, ready: true, tracked: false },
    ]);
  });

  it('is empty for an empty log', () => {
    expect(mapQuestListView(new Map(), new Set())).toEqual([]);
  });
});

describe('untracked-set persistence', () => {
  it('round-trips a set', () => {
    const set = new Set(['q_wolves', 'q_boars']);
    expect(parseUntrackedQuests(serializeUntrackedQuests(set))).toEqual(set);
  });

  it('is defensive against corrupt or malformed blobs (falls back to track-all)', () => {
    expect(parseUntrackedQuests(null).size).toBe(0);
    expect(parseUntrackedQuests('not json').size).toBe(0);
    expect(parseUntrackedQuests('{"a":1}').size).toBe(0); // not an array
    expect(parseUntrackedQuests('["q_wolves", 42, null]')).toEqual(new Set(['q_wolves']));
  });
});
