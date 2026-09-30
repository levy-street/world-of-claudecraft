// A won Fire and Fly run's score: once per run, for a seat the instructor seated
// for today's row (a paid run or a practice replay: practice feeds the ladders, as
// the glider's does), never for a dev seat or a loss. The sim decides the medal and
// the points; the server only mirrors the event onto the scenario's ladders
// (server/world_quest_leaderboard.ts), and every host keeps the character's records.
// A mission's run that moves the character's Gunner's Mastery (their best mission
// rows summed) also emits the new Mastery row, whole: the server keeps it per
// character on the one Mastery board, replacing a lower one.

import { FIRE_AND_FLY_QUEST_ID } from './content/world_quest_fire_and_fly';
import {
  fireAndFlyMastery,
  fireAndFlyScoreValid,
  recordPersonalFireAndFlyScore,
} from './fire_and_fly_personal_records';
import {
  FIRE_AND_FLY_MASTERY_BOARD_ID,
  fireAndFlyScoreboardId,
  fireAndFlyScoreboardInfo,
} from './fire_and_fly_scoreboards';
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
  const mission = fireAndFlyScoreboardInfo(board)?.kind === 'mission';
  const before = mission ? fireAndFlyMastery(meta.fireAndFlyRecords) : null;
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
  const after = before && fireAndFlyMastery(meta.fireAndFlyRecords);
  if (before && after && (after.stars !== before.stars || after.points !== before.points)) {
    ctx.emit({
      type: 'worldQuestMastery',
      pid: meta.entityId,
      board: FIRE_AND_FLY_MASTERY_BOARD_ID,
      ...after,
    });
  }
  return true;
}
