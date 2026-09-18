import type {
  WorldQuestTraceDef,
  WorldQuestTraceMetrics,
  WorldQuestTraceResult,
  WorldQuestTraceRoundScore,
} from './types';

export const WORLD_QUEST_TRACE_GOLD_SCORE = 85;
export const WORLD_QUEST_TRACE_SILVER_SCORE = 65;
const clamp = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;

/** Optional style marks only. This never determines whether an outline is valid. */
export function scoreWorldQuestTraceRound(
  shape: WorldQuestTraceDef,
  metrics: WorldQuestTraceMetrics | undefined,
  time: number,
): WorldQuestTraceRoundScore {
  if (!metrics || metrics.distance <= 0 || !Number.isFinite(metrics.distance))
    return { precision: 0, efficiency: 0, time: 0 };
  const perimeter = shape.points
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + Math.hypot(point.x - shape.points[index].x, point.z - shape.points[index].z),
      0,
    );
  return {
    precision: clamp(100 * (1 - metrics.deviationDistance / metrics.distance / 1.25)),
    efficiency: clamp((100 * perimeter) / metrics.distance),
    time: clamp((100 * (perimeter / 4)) / Math.max(0.05, time - metrics.startedAt)),
  };
}

export function scoreWorldQuestTraceLesson(
  rounds: readonly WorldQuestTraceRoundScore[],
): WorldQuestTraceResult {
  const mean = (key: keyof WorldQuestTraceRoundScore) =>
    rounds.length === 3
      ? Math.round(rounds.reduce((sum, round) => sum + clamp(round[key]), 0) / 3)
      : 0;
  const precision = mean('precision');
  const efficiency = mean('efficiency');
  const time = mean('time');
  const score = Math.round(precision * 0.6 + efficiency * 0.25 + time * 0.15);
  return {
    precision,
    efficiency,
    time,
    score,
    rating:
      score >= WORLD_QUEST_TRACE_GOLD_SCORE
        ? 'gold'
        : score >= WORLD_QUEST_TRACE_SILVER_SCORE
          ? 'silver'
          : 'bronze',
  };
}

export function sanitizeWorldQuestTraceScores(
  value: unknown,
  count: number,
): WorldQuestTraceRoundScore[] {
  if (!Array.isArray(value)) return [];
  const scores: WorldQuestTraceRoundScore[] = [];
  for (const raw of value.slice(0, Math.min(3, Math.max(0, count)))) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !['precision', 'efficiency', 'time'].every(
        (key) =>
          typeof raw[key] === 'number' &&
          Number.isFinite(raw[key]) &&
          raw[key] >= 0 &&
          raw[key] <= 100,
      )
    )
      return [];
    scores.push({ precision: raw.precision, efficiency: raw.efficiency, time: raw.time });
  }
  return scores;
}
