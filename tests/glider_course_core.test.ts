import { describe, expect, it } from 'vitest';
import { gliderCourseVisible } from '../src/render/glider_course_core';
import type { WorldQuestProgress } from '../src/sim/types';

describe('local glider course visibility', () => {
  it('requires acceptance and a live attempt rather than an active log entry alone', () => {
    expect(gliderCourseVisible(undefined)).toBe(false);
    expect(gliderCourseVisible({ questId: 'glider', state: 'active', count: 0 })).toBe(false);
  });

  it.each(['countdown', 'flying', 'failed', 'won'] as const)(
    'shows only live %s attempts, never completed quests',
    (phase) => {
      const progress = {
        questId: 'glider',
        state: 'active',
        count: 0,
        glider: { phase },
      } as WorldQuestProgress;
      expect(gliderCourseVisible(progress)).toBe(phase === 'countdown' || phase === 'flying');
      progress.state = 'completed';
      expect(gliderCourseVisible(progress)).toBe(false);
    },
  );
});
