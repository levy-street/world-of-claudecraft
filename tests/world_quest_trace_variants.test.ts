import { describe, expect, it } from 'vitest';
import {
  WORLD_QUEST_CALLIGRAPHY_ADVANCED,
  WORLD_QUEST_CALLIGRAPHY_QUEST,
} from '../src/sim/content/world_quest_calligraphy';
import {
  createWorldQuestTrace,
  stepWorldQuestTrace,
  worldQuestTracePreviewSeconds,
} from '../src/sim/world_quest_trace_geometry';
import {
  sanitizeWorldQuestTraceVariant,
  WORLD_QUEST_TRACE_VARIANTS,
  worldQuestTraceShape,
  worldQuestTraceVariantForCycle,
  worldQuestTraceVariantForStudent,
} from '../src/sim/world_quest_trace_variants';

describe('deterministic advanced calligraphy variants', () => {
  it('authors an advanced outline for every variant id, append-only', () => {
    expect(WORLD_QUEST_TRACE_VARIANTS.slice(0, 5)).toEqual([
      'star',
      'hourglass',
      'lightning',
      'spiral',
      'double-triangle',
    ]);
    expect(WORLD_QUEST_TRACE_VARIANTS.length).toBeGreaterThanOrEqual(10);
    for (const kind of WORLD_QUEST_TRACE_VARIANTS) {
      expect(worldQuestTraceShape(WORLD_QUEST_CALLIGRAPHY_QUEST, 2, kind)?.kind, kind).toBe(kind);
    }
  });
  it('offers different students different figures on the same day, stably', () => {
    const students = Array.from({ length: 40 }, (_, i) => 1000 + i * 17);
    const picks = students.map((id) => worldQuestTraceVariantForStudent('wq1_12', id));
    expect(new Set(picks).size).toBeGreaterThanOrEqual(6);
    expect(picks).toEqual(students.map((id) => worldQuestTraceVariantForStudent('wq1_12', id)));
    for (const pick of picks) expect(WORLD_QUEST_TRACE_VARIANTS).toContain(pick);
    // The same student meets a new figure across the week.
    const days = Array.from({ length: 14 }, (_, i) =>
      worldQuestTraceVariantForStudent(`wq1_${i}`, 1000),
    );
    expect(new Set(days).size).toBeGreaterThanOrEqual(4);
    expect(worldQuestTraceVariantForStudent('wq1_12', Number.NaN)).toBe(
      worldQuestTraceVariantForStudent('wq1_12', 0),
    );
  });
  it('selects stable cycle variants without consuming a simulation RNG', () => {
    const selected = Array.from({ length: 30 }, (_, i) =>
      worldQuestTraceVariantForCycle(`wq3_${6 + i * 7}`),
    );
    expect(new Set(selected)).toEqual(new Set(WORLD_QUEST_TRACE_VARIANTS));
    expect(selected).toEqual(
      Array.from({ length: 30 }, (_, i) => worldQuestTraceVariantForCycle(`wq3_${6 + i * 7}`)),
    );
    expect(sanitizeWorldQuestTraceVariant('future-rune', 'wq3_6')).toBe('future-rune');
    expect(worldQuestTraceShape(WORLD_QUEST_CALLIGRAPHY_QUEST, 2, 'future-rune')).toBeUndefined();
    expect(sanitizeWorldQuestTraceVariant({}, 'wq3_6')).toBe(
      worldQuestTraceVariantForCycle('wq3_6'),
    );
  });
  it.each(WORLD_QUEST_CALLIGRAPHY_ADVANCED)(
    'walks every edge of $kind in both directions',
    (shape) => {
      for (const reverse of [false, true]) {
        const points = reverse ? [...shape.points].reverse() : shape.points;
        const state = createWorldQuestTrace('q', shape, points[0], 0, 2);
        const drawAt = worldQuestTracePreviewSeconds(shape);
        stepWorldQuestTrace(state, shape, points[0], drawAt);
        let time = drawAt;
        for (let edge = 1; edge < points.length; edge++) {
          const a = points[edge - 1];
          const b = points[edge];
          const samples = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
          for (let i = 1; i <= samples; i++) {
            time += 0.05;
            stepWorldQuestTrace(
              state,
              shape,
              { x: a.x + ((b.x - a.x) * i) / samples, z: a.z + ((b.z - a.z) * i) / samples },
              time,
            );
          }
        }
        expect(state, `${shape.kind} reverse=${reverse}`).toMatchObject({
          phase: 'success',
          segment: points.length - 1,
        });
        expect(state.trail.length).toBeLessThanOrEqual(256);
      }
    },
  );
});
