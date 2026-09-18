import { GLIDER_QUEST_ID } from './content/world_quest_glider';
import { GLIDER_BOOST_COOLDOWN_TICKS } from './minigames/glider_boost';
import type { GliderFlightResult, GliderFlightState } from './minigames/glider_flight';
import { gliderCourseById } from './world_quest_glider_levels';

function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function integer(value: unknown, min: number, max: number): value is number {
  return bounded(value, min, max) && Number.isSafeInteger(value);
}

/** Sanitize persisted best result for the rotation. */
export function sanitizeGliderResult(value: unknown): GliderFlightResult | undefined {
  if (!value || typeof value !== 'object') return;
  const row = value as Partial<GliderFlightResult>;
  if (
    !['bronze', 'silver', 'gold'].includes(row.rating ?? '') ||
    !integer(row.passedRings, 0, 100) ||
    !integer(row.totalRings, 1, 100) ||
    !bounded(row.elapsedSeconds, 0, 600) ||
    !integer(row.score, 0, 100000)
  ) {
    return;
  }
  return {
    passedRings: row.passedRings,
    totalRings: row.totalRings,
    elapsedSeconds: Math.round(row.elapsedSeconds * 10) / 10,
    rating: row.rating as GliderFlightResult['rating'],
    score: row.score,
  };
}

/** Owner snapshot decoding for client mirroring. */
export function decodeGliderState(value: unknown, questId: string): GliderFlightState | undefined {
  if (questId !== GLIDER_QUEST_ID || !value || typeof value !== 'object') return;
  const row = value as Partial<GliderFlightState>;
  if (
    !['countdown', 'flying', 'won', 'failed'].includes(row.phase ?? '') ||
    !integer(row.tick, 0, 20 * 600) ||
    !bounded(row.speed, 0, 100) ||
    !bounded(row.vy, -100, 100) ||
    !Array.isArray(row.passedRings) ||
    !row.passedRings.every((id) => integer(id, 1, 100))
  ) {
    return;
  }

  const result = row.result ? sanitizeGliderResult(row.result) : undefined;
  const course = gliderCourseById(row.courseId);
  const tunnels = course.windTunnels ?? [];
  const windBoosts = Array.isArray(row.windBoosts) ? row.windBoosts.slice(0, tunnels.length) : [];

  return {
    ...(row.courseId === undefined ? {} : { courseId: course.id }),
    ...(row.practiceOnly === true ? { practiceOnly: true } : {}),
    phase: row.phase as GliderFlightState['phase'],
    tick: row.tick,
    countdownTicks: integer(row.countdownTicks, 0, 20 * 60) ? row.countdownTicks : 0,
    speed: row.speed,
    boostReadyTick: integer(row.boostReadyTick, 0, row.tick + GLIDER_BOOST_COOLDOWN_TICKS)
      ? row.boostReadyTick
      : 0,
    vy: row.vy,
    passedRings: [...row.passedRings],
    windBoosts: tunnels
      .filter((tunnel) => windBoosts.includes(tunnel.id))
      .map((tunnel) => tunnel.id),
    ...(row.recentRingPassed &&
    integer(row.recentRingPassed.id, 1, 100) &&
    integer(row.recentRingPassed.tick, 0, row.tick)
      ? { recentRingPassed: { id: row.recentRingPassed.id, tick: row.recentRingPassed.tick } }
      : {}),
    ...(result ? { result } : {}),
  };
}
