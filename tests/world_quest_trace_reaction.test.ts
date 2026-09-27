import { afterEach, describe, expect, it } from 'vitest';
import {
  WORLD_QUEST_CALLIGRAPHY_NPC_IDS,
  WORLD_QUEST_CALLIGRAPHY_NPCS,
} from '../src/sim/content/world_quest_calligraphy';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';
import { emitWorldQuestTraceRoundSpeech } from '../src/sim/world_quest_trace_speech';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeAuthoredYellSpeakerName, localizeAuthoredYellText } from '../src/ui/sim_i18n';

afterEach(() => setLanguage('en'));

function authoredReactions() {
  const events: SimEvent[] = [];
  const entities = new Map<number, Entity>();
  entities.set(1, { id: 1, pos: { x: 0, y: 0, z: 0 } } as Entity);
  for (const [templateId, id] of Object.entries(WORLD_QUEST_CALLIGRAPHY_NPC_IDS)) {
    entities.set(id, {
      id,
      name: WORLD_QUEST_CALLIGRAPHY_NPCS[templateId].name,
      templateId,
      kind: 'npc',
      pos: { x: 0, y: 0, z: 0 },
    } as Entity);
  }
  const ctx = {
    entities,
    players: new Map([[1, { entityId: 1 }]]),
    emit: (event: SimEvent) => events.push(event),
  } as unknown as SimContext;
  emitWorldQuestTraceRoundSpeech(ctx, 0);
  emitWorldQuestTraceRoundSpeech(ctx, 1);
  emitWorldQuestTraceRoundSpeech(ctx, 2, true);
  emitWorldQuestTraceRoundSpeech(ctx, 2, false);
  return events.flatMap((event) => {
    if (event.type !== 'chat') return [];
    const entity = entities.get(event.fromPid);
    if (!entity) throw new Error('missing authored speaker');
    return [{ text: event.text, entity }];
  });
}

describe('authored calligraphy reactions', () => {
  it.each(['en', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const)(
    'localizes actual sim speech and names in %s but never player chat',
    async (language) => {
      const reactions = authoredReactions();
      expect(reactions).toHaveLength(5);
      await ensureLocaleLoaded(language);
      setLanguage(language);
      for (const { text, entity } of reactions) {
        const translated = localizeAuthoredYellText(text, 'npc');
        const name = localizeAuthoredYellSpeakerName(entity.name, 'npc', entity.templateId);
        if (language === 'en') expect(translated).toBe(text);
        else {
          expect(translated).not.toBe(text);
          expect(name).not.toBe(entity.name);
        }
        expect(translated).not.toMatch(/questUi\./);
        expect(localizeAuthoredYellText(text, 'player')).toBe(text);
        expect(localizeAuthoredYellText(text, 'npc', 'warrior')).toBe(text);
        expect(localizeAuthoredYellSpeakerName(entity.name, 'player', entity.templateId)).toBe(
          entity.name,
        );
      }
      expect(localizeAuthoredYellText('An unrecognized future line.', 'npc')).toBe(
        'An unrecognized future line.',
      );
    },
  );
});
