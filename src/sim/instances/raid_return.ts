// The raid return route: a player who helped clear a raid run, and still holds
// its lockout, walks back into THAT run's cleared boss room even when they no
// longer belong to a raid that owns it.
//
// A claim is keyed on the owning group (`party:<id>`, instanceKeyFor), and
// party ids are ephemeral: a raider who leaves the raid, is removed from it,
// or whose raid disbanded and reformed under a new id, holds a key that no
// longer matches the run they cleared, and one whose leader converted the
// raid back to a party fails the raid-group gate. Their lockout bars every
// fresh claim, so before this route they could reach neither the old run nor
// a new one, and anything the run left them on a corpse (a full-bags award
// held by loot/awarded_loot_hold.ts, an unlooted drop) rotted out of reach.
//
// Admission rides the claim's own durable ledger, never party membership:
// raidReturnKeys holds exactly the kill's participants who stepped through
// the door and took their FIRST lock for it, keyed on the durable character id
// so a relog after the kill does not lose the way back. The route admits a
// returner only to rooms of the run they cleared (final boss down, ledger
// naming them) and the exits behind them, never forward into a room of the
// run they did not clear: a raider who left or was removed must not walk into
// the raid's live progression. Pure helpers over live SimContext views;
// instances/dungeons.ts owns the door and every mutation.

import { HEROIC_DUNGEON_TUNING } from '../content/dungeon_difficulty';
import { IGNIVAR_RAID_ROOM_IDS, isIgnivarRaidRoom } from '../ignivar_raid_ids';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { claimDifficultyForDungeon } from './difficulty';
import { RAID_REQUIRED_DUNGEON_IDS } from './reset_cooldown_policy';

// The Nythraxis raid's two linked claims: the approach crypt the overworld
// door opens onto, and the boss arena behind its royal door.
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

/** Where a returning raider's door entry goes. */
export interface RaidReturnRoute {
  /** The owning group key the entry is routed under. */
  partyKey: string;
  /** The cleared boss room an entrant from outside the run lands in. */
  roomId: string;
}

/**
 * The route the door takes for an entrant into a raid room, or null for the
 * ordinary door. `standsIn` answers whether the entrant stands inside a claim
 * (the door's own claim-footprint test). In order:
 * - one standing INSIDE a run they cleared under another key stays on that
 *   run's key, so its interior doors and backtrack exits keep working even if
 *   their own new group claims a room of the same raid meanwhile, or their
 *   lock lapses at a reset mid-visit (forward doors then refuse them, since
 *   isClearedReturnRoom wants the lock, but the way out stays open);
 * - one whose own key holds NO claim in this raid and whom a cleared claim of
 *   it names (raidReturnClaimFor below): they left the raid, were removed, or
 *   it reformed under a new party id. Two exceptions keep their own run: a
 *   five-player party entering a room it may claim for itself (the Nythraxis
 *   approach crypt doubles as an attunement dungeon), and a raid group set to
 *   the OTHER difficulty, which is starting a fresh run the returner's lock
 *   does not cover;
 * - one whose own key still owns the cleared claim but whose group is no
 *   longer a raid (the leader converted it back to a party): same party id,
 *   so only the raid-group gate stood between them and the room they cleared.
 * Every other member of an owning raid takes the ordinary door.
 */
export function raidReturnRoute(
  ctx: SimContext,
  entityId: number,
  dungeonId: string,
  ownKey: string,
  standsIn: (inst: InstanceSlot) => boolean,
): RaidReturnRoute | null {
  const family = raidFamilyOf(dungeonId);
  if (family === null) return null;
  const memberKey = durableMemberKey(ctx, entityId);
  const standingIn = ctx.instances.find(
    (inst) =>
      inst.partyKey !== null &&
      inst.partyKey !== ownKey &&
      family.includes(inst.dungeonId) &&
      standsIn(inst),
  );
  if (standingIn?.partyKey) {
    const runKey = standingIn.partyKey;
    const claim = latestClearedClaim(ctx, entityId, memberKey, family, (key) => key === runKey);
    if (claim !== null) return routeTo(claim);
    const named = ctx.instances.some(
      (inst) => inst.partyKey === runKey && inst.raidReturnKeys.has(memberKey),
    );
    if (named) return { partyKey: runKey, roomId: standingIn.dungeonId };
  }
  const party = ctx.partyOf(entityId);
  if (ctx.instances.some((i) => i.partyKey === ownKey && family.includes(i.dungeonId))) {
    if (party?.raid) return null;
    const claim = latestClearedClaim(ctx, entityId, memberKey, family, (key) => key === ownKey);
    return claim === null ? null : routeTo(claim);
  }
  if (party && !party.raid && !RAID_REQUIRED_DUNGEON_IDS.has(dungeonId)) return null;
  const claim = raidReturnClaimFor(ctx, entityId, dungeonId, ownKey);
  if (claim === null) return null;
  if (
    party?.raid &&
    claimDifficultyForDungeon(claim.dungeonId, ctx.dungeonDifficulty(entityId)) !== claim.difficulty
  ) {
    return null;
  }
  return routeTo(claim);
}

function routeTo(claim: InstanceSlot): RaidReturnRoute | null {
  return claim.partyKey === null ? null : { partyKey: claim.partyKey, roomId: claim.dungeonId };
}

/** Is `roomId` a room of the run under `partyKey` this player cleared and is
 *  still locked to? The only forward move a routed returner standing inside
 *  the run may make. */
export function isClearedReturnRoom(
  ctx: SimContext,
  entityId: number,
  partyKey: string,
  roomId: string,
): boolean {
  const memberKey = durableMemberKey(ctx, entityId);
  return ctx.instances.some(
    (inst) =>
      inst.partyKey === partyKey &&
      inst.dungeonId === roomId &&
      clearedFor(ctx, entityId, memberKey, inst),
  );
}

/**
 * The cleared raid claim an entrant may return to although their CURRENT
 * group key does not own it: a live claim in the same raid as `dungeonId`,
 * owned by another key, whose final boss is down, whose return ledger names
 * this player, and whose lockout they still hold. When several qualify (a
 * normal and a heroic clear the same week), the most recently claimed run
 * wins. Null when there is none.
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
  return latestClearedClaim(ctx, entityId, memberKey, family, (key) => key !== ownKey);
}

// The most recently claimed live claim in `family` whose owning key passes
// `keyAllowed` and which this player cleared (clearedFor); null when none does.
function latestClearedClaim(
  ctx: SimContext,
  entityId: number,
  memberKey: string,
  family: readonly string[],
  keyAllowed: (partyKey: string) => boolean,
): InstanceSlot | null {
  let best: InstanceSlot | null = null;
  for (const inst of ctx.instances) {
    if (inst.partyKey === null || !keyAllowed(inst.partyKey)) continue;
    if (!family.includes(inst.dungeonId)) continue;
    if (!clearedFor(ctx, entityId, memberKey, inst)) continue;
    if (best === null || (inst.claimedAt ?? -Infinity) > (best.claimedAt ?? -Infinity)) {
      best = inst;
    }
  }
  return best;
}

// A claim this player cleared and can still return to: its final boss is
// down, its return ledger names them, and the lock that kill stamped on them
// has not lapsed. After the reset they are free to start a fresh run, so the
// door must stop pulling them back into the old one. The lock id is the
// instances/dungeons.ts heroicLockoutId format for a heroic claim.
function clearedFor(
  ctx: SimContext,
  entityId: number,
  memberKey: string,
  inst: InstanceSlot,
): boolean {
  if (!inst.raidReturnKeys.has(memberKey) || finalBossAlive(ctx, inst)) return false;
  const lockId = inst.difficulty === 'heroic' ? `${inst.dungeonId}:heroic` : inst.dungeonId;
  const until = ctx.players.get(entityId)?.raidLockouts.get(lockId) ?? 0;
  return until > ctx.lockoutNowMs();
}
