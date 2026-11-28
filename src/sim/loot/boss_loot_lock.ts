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
// The corpse CUE reads this same gate, per viewer, through
// IWorld.corpseBossLootDenied: the satchel and minimap square, the Smith's
// Heart coffer's open mood, the popup and the interact prompt
// (corpse_loot_state.ts corpseIndicatorFor, src/game/corpse_loot_availability.ts).
// The offline Sim answers from the viewer's PlayerMeta
// (instances/raid_boss_lockout.ts viewerBossLootDenied); the online ClientWorld
// from the corpse's lock mirrored off the wire (the `bll` key,
// server/corpse_loot_wire.ts) against its own mirrored lockouts. The fresh ids
// ride with the lock, so a raider the kill itself saved still reads as fresh.
// Both worlds call bossLootLockDenies, so they cannot disagree.
//
// Pure leaf: no Sim, no rng; the caller passes the lockout clock
// (ctx.lockoutNowMs()).

import type { PlayerMeta } from '../sim';
import type { Entity } from '../types';

/** The lock a per-boss raid corpse was judged on (Entity.bossLootLock). */
export type BossLootLock = NonNullable<Entity['bossLootLock']>;

/** The gate on primitives: `lockedUntilMs` is the viewer's own unlock epoch for
 *  `lock.lockId` (undefined when they hold none). Denied only while that lock
 *  runs and the death did not find the viewer fresh. */
export function bossLootLockDenies(
  lock: BossLootLock | undefined,
  viewerId: number,
  lockedUntilMs: number | undefined,
  nowMs: number,
): boolean {
  if (!lock || lock.freshIds.includes(viewerId)) return false;
  return (lockedUntilMs ?? 0) > nowMs;
}

/** Is this player kept off this corpse's loot by a per-boss raid lockout? */
export function bossLootDenied(
  mob: Pick<Entity, 'bossLootLock'>,
  meta: Pick<PlayerMeta, 'entityId' | 'raidLockouts'>,
  nowMs: number,
): boolean {
  const lock = mob.bossLootLock;
  return bossLootLockDenies(lock, meta.entityId, lock && meta.raidLockouts.get(lock.lockId), nowMs);
}
