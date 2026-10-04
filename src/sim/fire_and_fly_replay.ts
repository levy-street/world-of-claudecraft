// Fire and Fly's Replay: the result card's second button, routed as the seat's
// `turret_replay` action. It acts only on the player's own ended seat, still on
// its roof, and starts the same trial again in place (turret_defense_session.ts);
// an instructor's seat first gets its run context again under the current day's
// rules (world_quest_fire_and_fly.ts), so a replay after the day's reward is
// practice and one after the rollover belongs to the new day. Every refusal is
// silent: the card only offers Replay on an ended seat.

import { WORLD_QUEST_FIRE_AND_FLY } from './content/world_quest_fire_and_fly';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { replayTurretSeat, turretSeatReplayable } from './turret_defense_session';
import type { Entity, TurretSession, TurretWorldQuestRun } from './types';
import { fireAndFlyReplayRun } from './world_quest_fire_and_fly';
import { mintWorldQuestRow, resetCycleIfNeeded } from './world_quests';

/** True when the seat started again. */
export function replayFireAndFlySeat(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  session: TurretSession,
): boolean {
  if (!turretSeatReplayable(meta, player, session)) return false;
  let run: TurretWorldQuestRun | undefined;
  if (session.worldQuest) {
    resetCycleIfNeeded(ctx, meta);
    const next = fireAndFlyReplayRun(meta, player, () =>
      mintWorldQuestRow(ctx, meta, WORLD_QUEST_FIRE_AND_FLY),
    );
    if (!next) return false;
    run = next;
  }
  replayTurretSeat(ctx, meta, session, run);
  return true;
}
