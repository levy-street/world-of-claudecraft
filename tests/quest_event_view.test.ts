import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';
import { questEventPresentation } from '../src/ui/quest_event_view';
import { worldQuestDisplayName } from '../src/ui/world_quest_view';

describe('quest event presentation', () => {
  it.each(['bronze', 'silver', 'gold'] as const)(
    'keeps %s score in the durable log without changing normal completion feedback',
    (rating) => {
      const event = {
        type: 'worldQuestDone',
        questId: 'wq_eastbrook_calligraphy',
        pid: 1,
      } as const;
      const ordinary = questEventPresentation(event);
      const scored = questEventPresentation({ ...event, traceResult: { score: 87, rating } });
      expect(scored).toEqual({ ...ordinary, logText: expect.stringContaining('87/100') });
      expect(scored?.logText).toContain(ordinary?.logText);
      expect(scored?.logText).toContain('Base reward unchanged. Gold: deed, title, +10 Renown.');
      expect(scored?.bannerText).toBe(ordinary?.bannerText);
      expect(scored?.sound).toBe('quest_complete');
    },
  );

  it('announces world-quest start, progress, and completion through durable and visual paths', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const started = questEventPresentation({
      type: 'worldQuestStarted',
      questId: quest.id,
      pid: 1,
    });
    expect(started).toMatchObject({ sound: 'quest_accept' });
    expect(started?.bannerText).toBe(started?.logText);
    expect(started?.logText).toContain('World quest started:');
    expect(started?.logText).toContain(worldQuestDisplayName(quest.id));

    const progress = questEventPresentation({
      type: 'worldQuestProgress',
      questId: quest.id,
      count: 2,
      required: quest.count,
      pid: 1,
    });
    expect(progress?.logText).toBe(progress?.flashText);
    expect(progress?.logText).toContain(`2/${quest.count}`);

    const done = questEventPresentation({
      type: 'worldQuestDone',
      questId: quest.id,
      pid: 1,
    });
    expect(done).toMatchObject({ sound: 'quest_complete' });
    expect(done?.bannerText).toBe(done?.logText);
    expect(done?.logText).toContain('Quest completed:');
  });

  it('preserves the ordinary quest event actions moved out of Hud', () => {
    const accepted = questEventPresentation({
      type: 'questAccepted',
      questId: 'q_wolves',
      pid: 1,
    } as SimEvent);
    expect(accepted).toEqual({ sound: 'quest_accept', refreshQuestDialog: true });

    const progress = questEventPresentation({
      type: 'questProgress',
      questId: 'q_wolves',
      objectiveIndex: 0,
      current: 2,
      required: 8,
      text: 'legacy fallback',
      pid: 1,
    } as SimEvent);
    expect(progress).toEqual({
      logText: 'Forest Wolf slain: 2/8',
      flashText: 'Forest Wolf slain: 2/8',
      refreshQuestDialog: true,
    });

    expect(
      questEventPresentation({ type: 'questReady', questId: 'q_wolves', pid: 1 } as SimEvent),
    ).toEqual({
      bannerText: 'Wolves at the Door (Complete)',
      sound: 'quest_ready',
      refreshQuestDialog: true,
    });

    const riding = questEventPresentation({
      type: 'questDone',
      questId: 'q_riding_lessons',
      pid: 1,
    } as SimEvent);
    expect(riding).toMatchObject({
      sound: 'quest_complete',
      refreshQuestDialog: true,
      mountOwnedPrompt: true,
    });

    expect(
      questEventPresentation({ type: 'questDone', questId: 'q_wolves', pid: 1 } as SimEvent),
    ).toEqual({
      sound: 'quest_complete',
      refreshQuestDialog: true,
      mountOwnedPrompt: false,
    });

    expect(questEventPresentation({ type: 'error', text: 'none' } as SimEvent)).toBeNull();
  });

  it('routes beam rotation receipts and keeps authoritative victory visible', () => {
    const questId = WORLD_QUESTS_BY_ID.wq_galecrest_wisps.id;

    expect(questEventPresentation({ type: 'worldQuestPuzzleOpened', questId, pid: 1 })).toEqual({
      openWorldQuestPuzzle: questId,
    });
    expect(
      questEventPresentation({
        type: 'worldQuestPuzzleUpdated',
        questId,
        tileIndex: 4,
        rotation: 1,
        pid: 1,
      }),
    ).toEqual({ updateWorldQuestPuzzle: { questId, tileIndex: 4, rotation: 1 } });
    expect(questEventPresentation({ type: 'worldQuestPuzzleClosed', questId, pid: 1 })).toEqual({
      closeWorldQuestPuzzle: questId,
    });
    expect(questEventPresentation({ type: 'worldQuestPuzzleFailed', questId, pid: 1 })).toEqual({
      failWorldQuestPuzzle: questId,
    });

    const done = questEventPresentation({ type: 'worldQuestDone', questId, pid: 1 });
    expect(done).toMatchObject({
      sound: 'quest_complete',
      completeWorldQuestPuzzle: questId,
    });
  });

  it('routes confection completion to its retained victory presentation', () => {
    const questId = 'wq_palmreach_confections';
    const done = questEventPresentation({ type: 'worldQuestDone', questId, pid: 1 });
    expect(done).toMatchObject({ sound: 'quest_complete', completeWorldQuestPuzzle: questId });
    expect(done?.closeWorldQuestPuzzle).toBeUndefined();
    expect(questEventPresentation({ type: 'worldQuestPuzzleClosed', questId, pid: 1 })).toEqual({
      closeWorldQuestPuzzle: questId,
    });
  });
});
