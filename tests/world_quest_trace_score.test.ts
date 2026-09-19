import { describe, expect, it } from 'vitest';
import type { WorldQuestTraceDef } from '../src/sim/types';
import {
  sanitizeWorldQuestTraceScores,
  scoreWorldQuestTraceLesson,
  scoreWorldQuestTraceRound,
} from '../src/sim/world_quest_trace_score';

const shape: WorldQuestTraceDef = {
  kind: 'square',
  points: [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
    { x: 0, z: 0 },
  ],
};
describe('optional calligraphy scoring', () => {
  it('scores exact efficient walking independently of outline acceptance', () => {
    expect(
      scoreWorldQuestTraceRound(shape, { startedAt: 6, distance: 40, deviationDistance: 0 }, 16),
    ).toEqual({ precision: 100, efficiency: 100, time: 100 });
    expect(
      scoreWorldQuestTraceRound(shape, { startedAt: 6, distance: 80, deviationDistance: 50 }, 26),
    ).toEqual({ precision: 50, efficiency: 50, time: 50 });
  });
  it.each([
    [85, 'gold'],
    [84, 'silver'],
    [65, 'silver'],
    [64, 'bronze'],
  ] as const)('pins rating threshold %s', (value, rating) => {
    expect(
      scoreWorldQuestTraceLesson(
        Array.from({ length: 3 }, () => ({ precision: value, efficiency: value, time: value })),
      ),
    ).toEqual({ precision: value, efficiency: value, time: value, score: value, rating });
  });
  it('applies the authored 60/25/15 component weights', () => {
    const lesson = (precision: number, efficiency: number, time: number) =>
      scoreWorldQuestTraceLesson(
        Array.from({ length: 3 }, () => ({ precision, efficiency, time })),
      );

    expect(lesson(100, 0, 0).score).toBe(60);
    expect(lesson(0, 100, 0).score).toBe(25);
    expect(lesson(0, 0, 100).score).toBe(15);
  });
  it('applies Gold after weighting instead of from any single strong component', () => {
    const lesson = (precision: number, efficiency: number, time: number) =>
      scoreWorldQuestTraceLesson(
        Array.from({ length: 3 }, () => ({ precision, efficiency, time })),
      );

    expect(lesson(100, 100, 0)).toMatchObject({ score: 85, rating: 'gold' });
    expect(lesson(99, 100, 0)).toMatchObject({ score: 84, rating: 'silver' });
  });
  it('does not infer Gold from absent historical rounds or untrusted score fields', () => {
    expect(
      scoreWorldQuestTraceLesson([{ precision: 100, efficiency: 100, time: 100 }]).rating,
    ).toBe('bronze');
    expect(
      sanitizeWorldQuestTraceScores([{ precision: NaN, efficiency: 100, time: 100 }], 3),
    ).toEqual([]);
    expect(
      sanitizeWorldQuestTraceScores(
        [{ precision: 100, efficiency: 100, time: 100, score: 999 }],
        1,
      ),
    ).toEqual([{ precision: 100, efficiency: 100, time: 100 }]);
  });
});
