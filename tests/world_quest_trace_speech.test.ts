import { describe, expect, it } from 'vitest';
import {
  WORLD_QUEST_CALLIGRAPHY_NPC_IDS,
  WORLD_QUEST_CALLIGRAPHY_NPCS,
} from '../src/sim/content/world_quest_calligraphy';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';
import { emitWorldQuestTraceRoundSpeech } from '../src/sim/world_quest_trace_speech';

describe('nearby calligraphy instructor reactions', () => {
  it('uses actual NPC identities and nearby yell routing for each authored reaction', () => {
    const entities = new Map<number, Entity>();
    for (const def of Object.values(WORLD_QUEST_CALLIGRAPHY_NPCS)) {
      const id = WORLD_QUEST_CALLIGRAPHY_NPC_IDS[def.id];
      entities.set(id, { id, name: def.name, pos: { ...def.pos, y: 0 }, dead: false } as Entity);
    }
    entities.set(1, { id: 1, pos: { x: 172, y: 0, z: -30 } } as Entity);
    entities.set(2, { id: 2, pos: { x: 172, y: 0, z: 10 } } as Entity);
    const events: SimEvent[] = [];
    const ctx = {
      entities,
      players: new Map([
        [1, { entityId: 1 }],
        [2, { entityId: 2 }],
      ]),
      emit: (event: SimEvent) => events.push(event),
    } as unknown as SimContext;
    emitWorldQuestTraceRoundSpeech(ctx, 0);
    emitWorldQuestTraceRoundSpeech(ctx, 1);
    emitWorldQuestTraceRoundSpeech(ctx, 2);
    emitWorldQuestTraceRoundSpeech(ctx, 2, true);
    expect(events).toHaveLength(5);
    expect(
      events.every((event) => event.type === 'chat' && event.pid === 1 && event.channel === 'yell'),
    ).toBe(true);
    expect(events).toMatchObject([
      { from: 'Apprentice Tessa', text: 'Three corners, and every one in its place!' },
      { from: 'Apprentice Pip', text: 'Four sides! I think I can do that too!' },
      {
        from: 'Instructor Elian',
        text: 'Final rune. A line may cross or revisit a point; follow the bright marker to the next corner.',
      },
      {
        from: 'Instructor Elian',
        text: 'A complete rune! Care and practice will make your next one even finer.',
      },
      {
        from: 'Instructor Elian',
        text: 'Beautifully traced! Your steps have earned their place in gold.',
      },
    ]);
  });
});
