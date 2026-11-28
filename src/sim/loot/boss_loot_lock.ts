// The corpse half of a per-boss raid lockout (src/sim/raid_boss_lockout_id.ts):
// a character saved to a boss this week may stand in the fight and help, but
// its corpse holds nothing for them. The kill itself already keeps them out of
// the roll (instances/raid_boss_lockout.ts filters the death-time loot roster
// before rollLoot, so no personal or quest drop is made for them); this gate
// keeps them off whatever the corpse does hold: the shared loot rights, the
// open-to-all slots, the owner-lock lapse into free-for-all, the need/greed
// and master-loot candidate list, the fair copper split and the bind-on-pickup
// trade group (every one of them reads partyLootCandidatesForMob or
// corpseLootRights, the two callers of this gate).
//
// The corpse records the lock its death was judged on and the players that
// death found unlocked (Entity.bossLootLock). A looter is denied when they hold
// that lock now and were NOT one of them: a raider saved by an earlier run,
// whether they stood in the fight or came in later. A player the kill found
// unlocked keeps their loot even though the same kill then saved them; a
// player who holds no lock (a stranger after the free-for-all lapse) is not
// this gate's business.
//
// KNOWN GAP (presentation only): the corpse indicators and the corpse popup
// (corpse_loot_state.ts, corpse_interaction.ts) do not read this gate, so a
// saved raider in the tapping party may still see the loot cue on a corpse
// with shared slots, and a press is refused with the sim's line. Reading the
// gate there would split the worlds: the online client cannot rebuild it from
// raidLockouts (the kill stamps the same expiry on the raiders it found
// fresh), so a faithful fix needs a per-viewer signal from the server.
//
// Pure leaf: no Sim, no rng; the caller passes the lockout clock
// (ctx.lockoutNowMs()).

import type { PlayerMeta } from '../sim';
import type { Entity } from '../types';

/** Is this player kept off this corpse's loot by a per-boss raid lockout? */
export function bossLootDenied(
  mob: Pick<Entity, 'bossLootLock'>,
  meta: Pick<PlayerMeta, 'entityId' | 'raidLockouts'>,
  nowMs: number,
): boolean {
  const lock = mob.bossLootLock;
  if (!lock || lock.freshIds.includes(meta.entityId)) return false;
  return (meta.raidLockouts.get(lock.lockId) ?? 0) > nowMs;
}
