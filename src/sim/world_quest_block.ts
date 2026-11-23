// The operator world quest block: an account-scoped moderation switch set from
// the admin dashboard on accounts caught botting world quests, as the lighter
// sanction short of a ban. The account keeps playing everything else; world
// quests stop starting, stop progressing, and stop paying.
//
// The server owns the flag (server/world_quest_block_runtime.ts): it stamps it on
// PlayerMeta from the account row at world join and when an operator changes it.
// Nothing here persists it, the offline Sim never sets it, and no client command
// reaches it. The two reward choke points (creditWorldQuest and
// awardWorldQuestBonusCopper) read it, so no path pays a blocked character even
// if a row survives; this module's teardown keeps a blocked character from
// holding live encounters or in-progress rows at all.

import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';
import { dropWorldQuestDeliveryCargo } from './world_quest_delivery';
import { clearForgeWorkshop } from './world_quest_forging';
import { cancelGliderForRotation, clearGliderEncounter } from './world_quest_glider';
import { clearInvestigationEncounter } from './world_quest_investigation';
import { clearShadowEncounter } from './world_quest_shadow';
import type { WorldQuestPlayerState } from './world_quest_state';
import { clearWorldQuestTracing } from './world_quest_tracing';
import { pauseWispMaze } from './world_quest_wisp_maze';

/** Whether an operator has blocked this character's account from world quests. */
export function worldQuestsBlocked(
  meta: Pick<WorldQuestPlayerState, 'worldQuestsBlocked'>,
): boolean {
  return meta.worldQuestsBlocked === true;
}

/** The server's one write: absent when unblocked, never `false`. */
export function setWorldQuestsBlocked(
  meta: Pick<WorldQuestPlayerState, 'worldQuestsBlocked'>,
  blocked: boolean,
): void {
  if (blocked) meta.worldQuestsBlocked = true;
  else delete meta.worldQuestsBlocked;
}

/**
 * The blocked character's per-tick world quest pass, in place of the normal one.
 * Every step is a no-op once there is nothing live, so after the first tick this
 * costs a handful of map reads.
 *
 * Live encounters end through their own owners first, while the rows holding
 * them still exist: an airborne glider lands at the launch instead of falling,
 * the maze pauses where it stands, the shadow cloak and a summoned suspect go,
 * carried freight drops, and an open puzzle board closes. Then every row that is
 * not completed is dropped, so the tracker shows nothing in progress and no
 * credit path finds an active row. Completed rows stay: they are the
 * once-per-cycle claim that stops a lifted block replaying today's rewards.
 */
export function suspendBlockedWorldQuests(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  cancelGliderForRotation(ctx, meta);
  pauseWispMaze(meta);
  clearShadowEncounter(ctx, meta);
  clearInvestigationEncounter(ctx, meta);
  dropWorldQuestDeliveryCargo(ctx, player);
  if (meta.openWorldQuestPuzzleId) {
    ctx.emit({
      type: 'worldQuestPuzzleClosed',
      questId: meta.openWorldQuestPuzzleId,
      pid: meta.entityId,
    });
    meta.openWorldQuestPuzzleId = null;
  }
  meta.worldQuestAreas.clear();
  let dropped = false;
  for (const [questId, progress] of meta.worldQuestLog) {
    clearGliderEncounter(meta, progress);
    clearForgeWorkshop(meta, progress);
    clearWorldQuestTracing(meta, progress);
    if (progress.state === 'completed') continue;
    meta.worldQuestLog.delete(questId);
    dropped = true;
  }
  if (dropped) meta.wireRev++;
}
