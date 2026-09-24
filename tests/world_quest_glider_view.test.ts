import { describe, expect, it } from 'vitest';
import {
  GLIDER_COURSE,
  GLIDER_COURSE_RINGS,
  GLIDER_QUEST_ID,
} from '../src/sim/content/world_quest_glider';
import { createGliderFlightState, scoreGliderFlight } from '../src/sim/minigames/glider_flight';
import type { WorldQuestProgress } from '../src/sim/types';
import { formatNumber, t } from '../src/ui/i18n';
import { gliderInstructionLines } from '../src/ui/world_quest_glider_view';

function fixture(): WorldQuestProgress {
  return { questId: GLIDER_QUEST_ID, state: 'active', count: 0, glider: createGliderFlightState() };
}
describe('glider tracker instructions', () => {
  it('explains camera pitch, energy loss and the wind tunnel attempt limit', () => {
    const controls = t('questUi.worldQuest.glider.controls');
    expect(controls).toContain('Hold right mouse');
    expect(controls).toContain('climb at the cost of speed');
    expect(controls).toContain('dive and gain speed');
    expect(controls).toContain('Slow flight loses lift');
    expect(controls).toContain('once per tunnel per attempt');
    expect(controls).not.toContain('height assist');
    expect(gliderInstructionLines(fixture())).toContain(controls);
  });

  it('reports a failed flight even when no score was produced', () => {
    const progress = fixture();
    if (!progress.glider) throw new Error('missing fixture');
    progress.glider.phase = 'failed';
    expect(gliderInstructionLines(progress)[0]).toBe(t('questUi.worldQuest.glider.failed'));
    expect(gliderInstructionLines(progress)).toContain(t('questUi.worldQuest.glider.retry'));
    expect(gliderInstructionLines(progress)).not.toContain(t('questUi.worldQuest.glider.ready'));
  });
});

it('countdown rounds live ticks up and never shows a previous medal', () => {
  const progress = fixture();
  if (!progress.glider) throw new Error('missing fixture');
  progress.glider.countdownTicks = 21;
  progress.gliderResult = scoreGliderFlight(6, 6, 20);
  expect(gliderInstructionLines(progress)).toEqual([
    t('questUi.worldQuest.glider.countdown', { count: formatNumber(2) }),
    t('questUi.worldQuest.glider.controls'),
  ]);
});
it('shows progress and the next ring instruction without pointing to a missed ring behind', () => {
  const progress = fixture();
  if (!progress.glider) throw new Error('missing fixture');
  progress.glider.phase = 'flying';
  progress.glider.passedRings = [2, 3];
  progress.glider.speed = 22;
  progress.glider.tick = 250;
  progress.gliderResult = scoreGliderFlight(6, 6, 20);
  const lines = gliderInstructionLines(progress);
  expect(lines[0]).toBe(
    t('questUi.worldQuest.glider.flying', {
      rings: formatNumber(2),
      total: formatNumber(GLIDER_COURSE_RINGS.length),
      time: formatNumber(12.5, { maximumFractionDigits: 1 }),
      speed: formatNumber(22),
    }),
  );
  expect(lines[0]).toContain('12.5');
  expect(lines[1]).toBe(
    t('questUi.worldQuest.glider.nextRing', { minimum: formatNumber(GLIDER_COURSE.minRings) }),
  );
  progress.glider.passedRings = GLIDER_COURSE_RINGS.map((ring) => ring.id);
  expect(gliderInstructionLines(progress)[1]).toBe(t('questUi.worldQuest.glider.landing'));
});
it('shows the actual terminal medal and score and preserves a failed retry over a past gold', () => {
  const progress = fixture();
  if (!progress.glider) throw new Error('missing fixture');
  progress.glider.phase = 'won';
  progress.glider.result = scoreGliderFlight(4, 6, 31);
  const result = progress.glider.result;
  expect(gliderInstructionLines(progress)[0]).toBe(
    t('questUi.worldQuest.glider.landed', {
      rating: t('questUi.worldQuest.glider.medals.bronze'),
      rings: formatNumber(4),
      total: formatNumber(6),
      time: formatNumber(31, { maximumFractionDigits: 1 }),
    }),
  );
  expect(gliderInstructionLines(progress)[1]).toBe(
    t('questUi.worldQuest.glider.score', { score: formatNumber(result.score) }),
  );
  progress.glider.phase = 'failed';
  progress.gliderResult = scoreGliderFlight(6, 6, 20);
  expect(gliderInstructionLines(progress)).toEqual([
    t('questUi.worldQuest.glider.failed'),
    t('questUi.worldQuest.glider.retry'),
  ]);
});
it('keeps completion truthful if a terminal score is absent', () => {
  const progress = fixture();
  if (!progress.glider) throw new Error('missing fixture');
  progress.glider.phase = 'won';
  expect(gliderInstructionLines(progress)[0]).toBe(t('questUi.worldQuest.glider.complete'));
});
