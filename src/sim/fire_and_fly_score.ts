// A won Fire and Fly run's score: once per run, for a seat the instructor seated
// for today's row (a paid run or a practice replay: practice feeds the ladders, as
// the glider's does), never for a dev seat or a loss. The sim decides the medal and
// the points; the server only mirrors the event onto the trial's ladders
// (server/world_quest_leaderboard.ts), and the offline host keeps its own records.

import { FIRE_AND_FLY_QUEST_ID } from './content/world_quest_fire_and_fly';
import {
  fireAndFlyScoreValid,
  recordPersonalFireAndFlyScore,
} from './fire_and_fly_personal_records';
import { fireAndFlyScoreboardId } from './fire_and_fly_scoreboards';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { TurretSession } from './types';

/** Emits the run's `worldQuestScore` the first time it can; true when it did. */
export function reportFireAndFlyScore(
  ctx: Pick<SimContext, 'emit' | 'entities' | 'resetDay'>,
  meta: Pick<PlayerMeta, 'entityId' | 'worldQuestCycle' | 'fireAndFlyRecords'>,
  session: TurretSession,
): boolean {
  const run = session.worldQuest;
  const result = session.defense.result;
  if (!run || run.scored || !result?.won || !result.medal) return false;
  if (run.questId !== FIRE_AND_FLY_QUEST_ID || run.cycle !== meta.worldQuestCycle) return false;
  const player = ctx.entities.get(meta.entityId);
  if (!player || player.dead) return false;
  run.scored = true;
  const scenarioId = session.defense.plan.scenarioId;
  const board = fireAndFlyScoreboardId(scenarioId, 'lifetime');
  if (!board || !fireAndFlyScoreValid(result.medal, result.points)) return false;
  recordPersonalFireAndFlyScore(
    meta.fireAndFlyRecords,
    scenarioId,
    ctx.resetDay,
    result.medal,
    result.points,
  );
  ctx.emit({
    type: 'worldQuestScore',
    pid: meta.entityId,
    board,
    medal: result.medal,
    metric: result.points,
    resetDay: ctx.resetDay,
  });
  return true;
}
