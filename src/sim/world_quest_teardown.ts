// Ends one world quest's live session for one player: the borrowed auras,
// personal summons, open puzzle board, and carried freight a quest can hold
// while it is in progress. Used when an in-progress quest leaves the player's
// slate mid-run (a reroll), so nothing it started is left behind once its
// progress row is gone. The per-tick area sweep only tears down quests that
// are still on the slate, so it cannot do this after the fact.

import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { WorldQuestDef } from './types';
import { dropWorldQuestDeliveryCargo } from './world_quest_delivery';
import { cancelGliderForRotation } from './world_quest_glider';
import { clearInvestigationEncounter } from './world_quest_investigation';
import { clearShadowEncounter } from './world_quest_shadow';
import { returnToWispMazeKeeper } from './world_quest_wisp_maze';

/** Tear down every live encounter `quest` owns for this player. Call before
 *  its progress row is deleted: the clear helpers read that row. */
export function endWorldQuestSession(
  ctx: SimContext,
  meta: PlayerMeta,
  quest: WorldQuestDef,
): void {
  switch (quest.objective.type) {
    case 'glider':
      cancelGliderForRotation(ctx, meta);
      break;
    case 'shadow':
      clearShadowEncounter(ctx, meta);
      break;
    case 'investigation':
      clearInvestigationEncounter(ctx, meta);
      break;
    case 'wisp_maze': {
      // A run in play holds the player at a maze-local spot; walk them out.
      const state = meta.worldQuestLog.get(quest.id)?.wispMaze;
      const player = ctx.entities.get(meta.entityId);
      if (player && !player.dead && state && !state.paused && state.phase !== 'won')
        returnToWispMazeKeeper(ctx, player);
      break;
    }
    case 'delivery': {
      // Freight is only picked up inside the quest's own area.
      const player = ctx.entities.get(meta.entityId);
      if (player && meta.worldQuestAreas.has(quest.id)) dropWorldQuestDeliveryCargo(ctx, player);
      break;
    }
  }
  if (meta.openWorldQuestPuzzleId === quest.id) {
    ctx.emit({ type: 'worldQuestPuzzleClosed', questId: quest.id, pid: meta.entityId });
    meta.openWorldQuestPuzzleId = null;
  }
  meta.wireRev++;
}
