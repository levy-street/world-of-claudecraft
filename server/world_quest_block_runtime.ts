// The world quest block's server runtime (src/sim/world_quest_block.ts): the live
// apply an operator change pushes onto the account's sessions, and the join
// restore. Behind narrow structural views so the game coordinator stays a thin
// caller and a Vitest drives both with fake sessions and a fake sim.

import { setWorldQuestsBlocked } from '../src/sim/world_quest_block';
import type { WorldQuestPlayerState } from '../src/sim/world_quest_state';
import { accountWorldQuestsBlocked } from './world_quest_block_db';

/** The slice of ClientSession this runtime reads. */
export interface WorldQuestBlockSession {
  accountId: number;
  pid: number;
}

/** The sim read this runtime writes the flag through (server-side only). */
export interface WorldQuestBlockSim {
  meta(pid: number): Pick<WorldQuestPlayerState, 'worldQuestsBlocked'> | null;
}

/**
 * Push a block change onto every live session of that account, so it lands in
 * the session it was applied in rather than at the next login. The sim tears the
 * blocked character's world quest state down on its next tick. A no-op when the
 * account is offline: the join restore below reads the row.
 */
export function applyWorldQuestBlockLive(
  clients: Iterable<WorldQuestBlockSession>,
  sim: WorldQuestBlockSim,
  accountId: number,
  blocked: boolean,
): void {
  for (const live of clients) {
    if (live.accountId !== accountId) continue;
    const meta = sim.meta(live.pid);
    if (meta) setWorldQuestsBlocked(meta, blocked);
  }
}

/**
 * Stamp the account's block onto the joining character: the block is
 * account-scoped, so every alt carries it. `isCurrent` guards the player leaving
 * mid-fetch. An unblocked account (nearly all of them) writes nothing.
 */
export async function refreshWorldQuestBlock(
  session: WorldQuestBlockSession,
  sim: WorldQuestBlockSim,
  isCurrent: () => boolean,
): Promise<void> {
  if (!(await accountWorldQuestsBlocked(session.accountId))) return;
  if (!isCurrent()) return;
  const meta = sim.meta(session.pid);
  if (meta) setWorldQuestsBlocked(meta, true);
}
