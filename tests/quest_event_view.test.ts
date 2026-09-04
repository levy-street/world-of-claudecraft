import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';
import { questEventPresentation } from '../src/ui/quest_event_view';
import { worldQuestDisplayName } from '../src/ui/world_quest_view';

describe('quest event presentation', () => {
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

  it('opens and closes the beam puzzle from authoritative area events', () => {
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
    ).toEqual({});
    expect(questEventPresentation({ type: 'worldQuestPuzzleClosed', questId, pid: 1 })).toEqual({
      closeWorldQuestPuzzle: questId,
    });

    const done = questEventPresentation({ type: 'worldQuestDone', questId, pid: 1 });
    expect(done).toMatchObject({
      sound: 'quest_complete',
      closeWorldQuestPuzzle: questId,
    });
  });
});
