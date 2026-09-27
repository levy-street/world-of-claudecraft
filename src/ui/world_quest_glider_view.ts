import { TICK_RATE, type WorldQuestProgress } from '../sim/types';
import { gliderCourseById } from '../sim/world_quest_glider_levels';
import { formatNumber, t } from './i18n';

const number = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });

export function gliderInstructionLines(progress: WorldQuestProgress): string[] {
  const session = progress.glider;
  const course = gliderCourseById(session?.courseId);
  if (session?.phase === 'failed') {
    return [t('questUi.worldQuest.glider.failed'), t('questUi.worldQuest.glider.retry')];
  }
  const result =
    session?.phase === 'won'
      ? session.result
      : !session && progress.state === 'completed'
        ? progress.gliderResult
        : null;
  if (result) {
    return [
      t('questUi.worldQuest.glider.landed', {
        rating: t(`questUi.worldQuest.glider.medals.${result.rating}`),
        rings: number(result.passedRings),
        total: number(result.totalRings),
        time: formatNumber(result.elapsedSeconds, { maximumFractionDigits: 1 }),
      }),
      t('questUi.worldQuest.glider.score', { score: number(result.score) }),
      t('questUi.worldQuest.glider.retry'),
    ];
  }
  if (session?.phase === 'won' || (!session && progress.state === 'completed')) {
    return [t('questUi.worldQuest.glider.complete'), t('questUi.worldQuest.glider.retry')];
  }
  if (!session) {
    return [t('questUi.worldQuest.glider.ready'), t('questUi.worldQuest.glider.controls')];
  }
  if (session.phase === 'countdown') {
    const secondsLeft = Math.max(1, Math.ceil(session.countdownTicks / TICK_RATE));
    return [
      t('questUi.worldQuest.glider.countdown', { count: number(secondsLeft) }),
      t('questUi.worldQuest.glider.controls'),
    ];
  }
  return [
    t('questUi.worldQuest.glider.flying', {
      rings: number(session.passedRings.length),
      total: number(course.rings.length),
      time: formatNumber(session.tick / TICK_RATE, { maximumFractionDigits: 1 }),
      speed: number(session.speed),
    }),
    session.passedRings.length === course.rings.length
      ? t('questUi.worldQuest.glider.landing')
      : t('questUi.worldQuest.glider.nextRing', { minimum: number(course.minRings) }),
    t('questUi.worldQuest.glider.controls'),
  ];
}
