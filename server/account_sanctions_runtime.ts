// The account-scoped operator sanctions a character picks up at world join: the
// Cheater mark (server/cheater_mark_runtime.ts) and the world quest block
// (server/world_quest_block_runtime.ts). Each is its own read with its own
// failure handler, so one failing never skips the other, and neither is awaited:
// a sanction read must never affect joining the world.
//
// Both fail OPEN (joining unsanctioned) rather than closed, because the
// alternative is locking a player out of a game they paid for over one
// moderation read. For the mark that delays the sanction rather than cancelling
// it: the budget is not burned while the tag is absent. For the block it lasts
// until the next join or the next operator change re-stamps it.

import {
  type CheaterMarkSession,
  type CheaterMarkSim,
  refreshCheaterMark,
} from './cheater_mark_runtime';
import {
  refreshWorldQuestBlock,
  type WorldQuestBlockSession,
  type WorldQuestBlockSim,
} from './world_quest_block_runtime';

export function restoreAccountSanctions(
  session: CheaterMarkSession & WorldQuestBlockSession,
  sim: CheaterMarkSim & WorldQuestBlockSim,
  isCurrent: () => boolean,
): void {
  void refreshCheaterMark(session, sim, isCurrent).catch((err) =>
    console.error('cheater mark refresh failed:', err),
  );
  void refreshWorldQuestBlock(session, sim, isCurrent).catch((err) =>
    console.error('world quest block refresh failed:', err),
  );
}
