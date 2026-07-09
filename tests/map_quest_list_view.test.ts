// Tests for the world-map quest numbering pure core (map_quest_list_view.ts):
// acceptance-order numbering of the map's gold objective badges.

import { describe, expect, it } from 'vitest';
import type { QuestProgress } from '../src/sim/types';
import { questNumbersByLog } from '../src/ui/map_quest_list_view';

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

  it('is empty for an empty log', () => {
    expect(questNumbersByLog(new Map()).size).toBe(0);
  });
});
