import { afterEach, describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import type {
  WorldQuestProgress,
  WorldQuestTraceDef,
  WorldQuestTraceState,
} from '../src/sim/types';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import {
  worldQuestTraceInstruction,
  worldQuestTraceProgressInstruction,
  worldQuestTraceRatingLabel,
  worldQuestTraceRoundInstruction,
  worldQuestTraceScoreText,
  worldQuestTraceShapeName,
} from '../src/ui/world_quest_trace_view';
import { worldQuestDisplayName, worldQuestObjectiveLabel } from '../src/ui/world_quest_view';

function trace(fields: Partial<WorldQuestTraceState>): WorldQuestTraceState {
  return {
    questId: 'wq_eastbrook_calligraphy',
    shapeIndex: 0,
    phase: 'drawing',
    previewUntil: 6,
    expiresAt: 80,
    trail: [],
    lastPosition: { x: 0, z: 0 },
    segment: 0,
    direction: 0,
    started: false,
    ...fields,
  };
}

afterEach(() => setLanguage('en'));

const shapes: WorldQuestTraceDef[] = [
  { kind: 'triangle', points: [] },
  { kind: 'square', points: [] },
  { kind: 'star', points: [] },
];

describe('calligraphy instructions', () => {
  it.each(['star', 'hourglass', 'lightning', 'spiral', 'double-triangle'] as const)(
    'names the authoritative advanced variant %s in round three and after reconnect',
    (variant) => {
      const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_calligraphy;
      const progress: WorldQuestProgress = {
        questId: quest.id,
        count: 2,
        state: 'active',
        traceVariant: variant,
        tracing: trace({ shapeIndex: 2, started: true }),
      };
      const before = structuredClone(progress);
      expect(worldQuestTraceProgressInstruction(progress, quest)).toContain(
        `Round 3 of 3: ${worldQuestTraceShapeName(variant)}. Follow golden sparkles`,
      );
      expect(progress).toEqual(before);
      delete progress.tracing;
      expect(worldQuestTraceProgressInstruction(progress, quest)).toContain(
        `Round 3 of 3: ${worldQuestTraceShapeName(variant)}. Speak to the instructor`,
      );
      progress.traceVariant = 'future-rune';
      expect(worldQuestTraceProgressInstruction(progress, quest)).toBe(
        'This rune needs a newer game version.',
      );
    },
  );

  it.each(['bronze', 'silver', 'gold'] as const)(
    'shows cosmetic %s score without conditioning the reward',
    (rating) => {
      const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_calligraphy;
      const traceResult = { score: 87, rating, precision: 80, efficiency: 90, time: 91 };
      expect(
        worldQuestTraceProgressInstruction(
          { questId: quest.id, state: 'completed', count: 3, traceResult },
          quest,
        ),
      ).toBe(
        `Complete! ${worldQuestTraceRatingLabel(rating)}: 87/100. Base reward unchanged. Gold: deed, title, +10 Renown.`,
      );
    },
  );

  it.each(['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const)(
    'localizes every advanced shape and rating in %s',
    async (language) => {
      const kinds = ['star', 'hourglass', 'lightning', 'spiral', 'double-triangle'] as const;
      const ratings = ['bronze', 'silver', 'gold'] as const;
      setLanguage('en');
      const englishNames = kinds.map(worldQuestTraceShapeName);
      const englishRatings = ratings.map(worldQuestTraceRatingLabel);
      await ensureLocaleLoaded(language);
      setLanguage(language);
      kinds.forEach((kind, index) => {
        expect(worldQuestTraceShapeName(kind)).not.toBe(englishNames[index]);
      });
      ratings.forEach((rating, index) => {
        expect(worldQuestTraceRatingLabel(rating)).not.toBe(englishRatings[index]);
        const text = worldQuestTraceScoreText({ score: 87, rating });
        expect(text).toContain('87/100');
        expect(text).toContain(worldQuestTraceRatingLabel(rating));
        expect(text).not.toMatch(/questUi|Base reward|Gold:/);
      });
    },
  );

  it('advances round and shape only when authoritative state changes', () => {
    const state = trace({ phase: 'preview' });
    expect(worldQuestTraceRoundInstruction(state, shapes)).toMatch(/^Round 1 of 3: Triangle\./);
    state.shapeIndex = 1;
    expect(worldQuestTraceRoundInstruction(state, shapes)).toMatch(/^Round 2 of 3: Square\./);
    state.phase = 'failed';
    state.reason = 'off-path';
    expect(worldQuestTraceRoundInstruction(state, shapes)).toContain(
      'Round 2 of 3: Square. You left',
    );
    state.shapeIndex = 2;
    state.phase = 'preview';
    expect(worldQuestTraceRoundInstruction(state, shapes)).toContain('Round 3 of 3: Star. Watch');
    state.phase = 'success';
    expect(worldQuestTraceRoundInstruction(state, shapes)).toBe(
      'Round 3 of 3: Star. Outline complete!',
    );
  });

  it('shows saved round progress before restarting the lesson, without a local clock', () => {
    expect(worldQuestTraceRoundInstruction(undefined, shapes, 1)).toBe(
      'Round 2 of 3: Square. Speak to the instructor to begin.',
    );
    expect(worldQuestTraceRoundInstruction(undefined, shapes, Number.NaN)).toMatch(
      /^Round 1 of 3:/,
    );
    expect(worldQuestTraceRoundInstruction(undefined, shapes, 99)).toMatch(/^Round 3 of 3:/);
    expect(worldQuestTraceRoundInstruction(undefined, [])).toBe(
      'Speak to the instructor to begin.',
    );
  });
  it('explains the guide, next corner and drawn trail instead of testing memory', () => {
    const preview = worldQuestTraceInstruction(trace({ phase: 'preview' }));
    const drawing = worldQuestTraceInstruction(trace({ started: true, direction: 1 }));
    expect(preview).toBe('Watch the outline. Golden sparkles will guide you.');
    expect(preview).not.toMatch(/remember|memor|fade/i);
    expect(drawing).toBe('Follow golden sparkles to the bright corner. Blue marks your trail.');
    expect(worldQuestTraceInstruction(trace({ started: false }))).toContain('Trace either way.');
    expect(worldQuestTraceInstruction(trace({ started: true, direction: -1 }))).toBe(drawing);
  });

  it('names the movement quest independently of the generic zone title', () => {
    expect(worldQuestDisplayName('wq_eastbrook_calligraphy')).toBe('Arcane Calligraphy');
    expect(worldQuestObjectiveLabel('wq_eastbrook_calligraphy')).toBe(
      'Trace the outline with your footsteps',
    );
    expect(worldQuestTraceInstruction(undefined)).toBe('Speak to the instructor to begin.');
  });

  it.each([
    [{ phase: 'preview' }, 'tracePreview'],
    [{ phase: 'drawing', started: false }, 'traceStart'],
    [{ phase: 'drawing', started: true, direction: 1 }, 'traceDrawing'],
    [{ phase: 'drawing', started: true, direction: -1 }, 'traceDrawing'],
    [{ phase: 'success' }, 'traceSuccess'],
    [{ phase: 'failed', reason: 'off-path' }, 'traceOffPath'],
    [{ phase: 'failed', reason: 'movement' }, 'traceMovement'],
    [{ phase: 'failed', reason: 'timeout' }, 'traceTimeout'],
    [{ phase: 'failed', reason: 'combat' }, 'traceCombat'],
    [{ phase: 'failed' }, 'traceRetry'],
  ] as const)('projects authoritative phase %j', (fields, key) => {
    const state = trace(fields);
    const before = structuredClone(state);
    expect(worldQuestTraceInstruction(state)).toBe(t(`questUi.worldQuest.${key}`));
    expect(state).toEqual(before);
  });

  it.each(['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const)(
    'translates every phase into %s',
    async (language) => {
      const states = [
        undefined,
        trace({ phase: 'preview' }),
        trace({}),
        trace({ started: true }),
        trace({ phase: 'success' }),
        ...(['off-path', 'movement', 'timeout', 'combat'] as const).map((reason) =>
          trace({ phase: 'failed', reason }),
        ),
      ];
      setLanguage('en');
      const english = states.map(worldQuestTraceInstruction);
      await ensureLocaleLoaded(language);
      setLanguage(language);
      states.forEach((state, i) => {
        expect(worldQuestTraceInstruction(state)).not.toBe(english[i]);
      });
      for (const shapeIndex of [0, 1, 2]) {
        const text = worldQuestTraceRoundInstruction(trace({ shapeIndex }), shapes);
        expect(text).not.toMatch(/Round|Triangle|Square|Star/);
        expect(text).toContain(String(shapeIndex + 1));
        expect(text).toContain('3');
      }
    },
  );
});
