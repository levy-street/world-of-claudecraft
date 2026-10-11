// The raid return route: a player who helped clear a raid run, and took its
// lockout, walks back into THAT run's live claim even when they are no longer
// in the group that owns it.
//
// A claim is keyed on the owning group (`party:<id>`, instanceKeyFor), and
// party ids are ephemeral: a raider who leaves the raid, is removed from it,
// or whose raid disbanded and reformed under a new id, holds a key that no
// longer matches the run they cleared. Their lockout then bars every fresh
// claim, so before this route they could reach neither the old run nor a new
// one, and anything the run left them on a corpse (a full-bags award held by
// loot/awarded_loot_hold.ts, an unlooted drop) rotted out of reach.
//
// Admission rides the claim's own durable ledger, never party membership:
// raidReturnKeys holds exactly the kill's participants who stepped through
// the door and took their FIRST lock for it, keyed on the durable character id
// so a relog after the kill does not lose the way back. A returner is routed
// only to a claim whose final boss is down, so the route can never join a
// fresh farm. Pure helpers over live SimContext views; instances/dungeons.ts
// owns the door and every mutation.

import { HEROIC_DUNGEON_TUNING } from '../content/dungeon_difficulty';
import { IGNIVAR_RAID_ROOM_IDS, isIgnivarRaidRoom } from '../ignivar_raid_ids';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { DungeonDifficulty } from '../types';
import { claimDifficultyForDungeon } from './difficulty';

// The Nythraxis raid's two linked claims: the approach crypt the overworld
// door opens onto, and the boss arena behind its royal door. A returner must
// cross the crypt under the same group key to reach the arena.
const NYTHRAXIS_RAID_ROOM_IDS: readonly string[] = ['nythraxis_crypt', 'nythraxis_boss_arena'];

/** Every room of the raid `dungeonId` belongs to (the claims one run spans),
 *  or null for a standard dungeon. */
export function raidFamilyOf(dungeonId: string): readonly string[] | null {
  if (isIgnivarRaidRoom(dungeonId)) return IGNIVAR_RAID_ROOM_IDS;
  if (NYTHRAXIS_RAID_ROOM_IDS.includes(dungeonId)) return NYTHRAXIS_RAID_ROOM_IDS;
  return null;
}

// The durable per-player membership key for a claim's session ledgers: the
// server's stable character id when present (it survives the relog or
// character-select Take Over that mints a new entity id), the entity id for
// offline and sim-only callers (the raidBossWelcomeKeys idiom).
export function durableMemberKey(ctx: SimContext, entityId: number): string {
  const characterId = ctx.players.get(entityId)?.characterId;
  return characterId === undefined ? `entity:${entityId}` : `character:${characterId}`;
}

// Is the claimed instance's final boss still up? Difficulty-agnostic (the
// tuning table names the final boss for both difficulties). Gates the
// locked-player door rules in enterDungeon: a cleared run (boss down, or its
// corpse already swept) stays re-enterable for loot and corpse-runs; a run
// with the boss alive is a fresh farm a locked player must not join.
export function finalBossAlive(ctx: SimContext, inst: InstanceSlot): boolean {
  const tuning = HEROIC_DUNGEON_TUNING[inst.dungeonId];
  if (!tuning) return false;
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && e.templateId === tuning.finalBossId && !e.dead) return true;
  }
  return false;
}

/** Where a returning raider's door entry goes: the owning group key it is
 *  routed under, and the difficulty any room of that run it still has to
 *  claim (a freed approach crypt, say) is minted at. */
export interface RaidReturnRoute {
  partyKey: string;
  difficulty: DungeonDifficulty;
}

/**
 * The route the door takes for an entrant into a raid room, or null to keep
 * the entrant's own group key. Routes only when ALL hold:
 * - their own key holds no live claim anywhere in this raid (a member of the
 *   run's group, or of a group already running this raid, keeps that run);
 * - a cleared claim of this raid names them in its return ledger
 *   (raidReturnClaimFor below);
 * - they are not in a raid group set to the OTHER difficulty: that group is
 *   about to start a fresh run the returner's lock does not cover, so the
 *   door must let them claim it rather than pull them back into the old one.
 */
export function raidReturnRoute(
  ctx: SimContext,
  entityId: number,
  dungeonId: string,
  ownKey: string,
): RaidReturnRoute | null {
  const family = raidFamilyOf(dungeonId);
  if (family === null) return null;
  if (ctx.instances.some((i) => i.partyKey === ownKey && family.includes(i.dungeonId))) return null;
  const claim = raidReturnClaimFor(ctx, entityId, dungeonId, ownKey);
  if (claim === null || claim.partyKey === null) return null;
  if (
    ctx.partyOf(entityId)?.raid &&
    claimDifficultyForDungeon(claim.dungeonId, ctx.dungeonDifficulty(entityId)) !== claim.difficulty
  ) {
    return null;
  }
  return { partyKey: claim.partyKey, difficulty: claim.difficulty };
}

/**
 * The cleared raid claim an entrant may return to although their CURRENT
 * group key does not own it: a live claim in the same raid as `dungeonId`,
 * owned by another key, whose final boss is down and whose return ledger
 * names this player. When several qualify (a normal and a heroic clear the
 * same week), the most recently claimed run wins. Null when there is none.
 */
export function raidReturnClaimFor(
  ctx: SimContext,
  entityId: number,
  dungeonId: string,
  ownKey: string,
): InstanceSlot | null {
  const family = raidFamilyOf(dungeonId);
  if (family === null) return null;
  const memberKey = durableMemberKey(ctx, entityId);
  let best: InstanceSlot | null = null;
  for (const inst of ctx.instances) {
    if (inst.partyKey === null || inst.partyKey === ownKey) continue;
    if (!family.includes(inst.dungeonId)) continue;
    if (!inst.raidReturnKeys.has(memberKey) || finalBossAlive(ctx, inst)) continue;
    if (best === null || (inst.claimedAt ?? -Infinity) > (best.claimedAt ?? -Infinity)) {
      best = inst;
    }
  }
  return best;
}
