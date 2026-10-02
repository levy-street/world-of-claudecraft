// A won Fire and Fly run's score: once per run, for a seat the instructor seated
// for today's row (a paid run or a practice replay: practice feeds the ladders, as
// the glider's does), never for a dev seat or a loss. The sim decides the medal and
// the points; the server only mirrors the event onto the scenario's ladders
// (server/world_quest_leaderboard.ts), and every host keeps the character's records.
// Every scored mission run also emits the character's Gunner's Mastery (their best
// mission rows summed), whole, changed or not: the server keeps it per character on
// the one Mastery board, replacing only a lower one, so a repeat is a no-op there and
// a fresh Mastery version or a write the server shed fills in on the next mission win.

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
  const mastery = mission ? fireAndFlyMastery(meta.fireAndFlyRecords) : null;
  if (mastery && mastery.missions > 0) {
    ctx.emit({
      type: 'worldQuestMastery',
      pid: meta.entityId,
      board: FIRE_AND_FLY_MASTERY_BOARD_ID,
      ...mastery,
    });
  }
  return true;
}
