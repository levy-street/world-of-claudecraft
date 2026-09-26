// The ONE client-side "is this player hostile to me right now" verdict, shared
// by the renderer (nameplate colour, hostile selection) and the HUD (the target
// frame's colour, the auto-attack-on-ability gate). The instanced arms (duel,
// ranked arena, Thornhollow Fields) come from isPvpHostileTarget, which reads
// the IWorld readouts those modes publish; the open-world arm reads the two
// entities' /pvp flags and the zone policy under each of them through the
// sim's own pair rule (src/sim/pvp/world_pvp_rules.ts worldPvpPairHostile,
// src/sim/pvp/world_pvp_zones.ts worldPvpZonePolicyAt) with the party check
// answered by the party readout, so the client can never colour a player red
// whom the sim would refuse to let it hit: a sanctuary is grey for everyone,
// a free-for-all zone is red for every stranger in it, and a realm whose
// World PvP switch is off (the self readout's `enabled`) has no world arm.
//
// Extracted the day the third copy of the verdict appeared (the renderer's
// private isHostilePlayer and the action bar's isPvpHostileTarget were the
// first two; the World PvP flag was the third), exactly as the action bar's
// comment asked. Pure and host-agnostic: no DOM, no i18n, no Sim reference.
//
// Deliberately narrower than the sim's isHostileTo, like both predecessors:
// no jail brawl, no warden arm, and a pet resolves to its owner in the callers
// (the renderer's isOwnedPetHostile), never here.

import { worldPvpPairHostile } from '../sim/pvp/world_pvp_rules';
import { worldPvpZonePolicyAt } from '../sim/pvp/world_pvp_zones';
import type { Entity } from '../sim/types';
import type { IWorld } from '../world_api';
import { isPvpHostileTarget } from './hud/action_bar/attack_on_ability';

/** The readouts the verdict needs; the offline Sim and the online ClientWorld
 *  both satisfy it structurally. */
export type PvpHostileWorld = Pick<
  IWorld,
  'playerId' | 'entities' | 'duelInfo' | 'arenaInfo' | 'bgInfo' | 'partyInfo' | 'worldPvpInfo'
>;

/** Is `target` (an entity record) a player the local player may attack? Never
 *  the local player, never a corpse. */
export function isPvpHostilePlayer(world: PvpHostileWorld, target: Entity): boolean {
  if (target.kind !== 'player' || target.dead || target.id === world.playerId) return false;
  if (isPvpHostileTarget(target.id, world.duelInfo, world.arenaInfo, world.bgInfo)) return true;
  // Inside a live battleground or arena the sim's world arm is off for both
  // sides (they are under that mode's rules), so the client verdict must be
  // too: a flagged teammate is never red.
  if (world.bgInfo?.match?.state === 'active' || world.arenaInfo?.match?.state === 'active')
    return false;
  // The realm switch (null before the first self snapshot reads as open).
  const info = world.worldPvpInfo;
  if (info?.enabled === false) return false;
  const self = world.entities.get(world.playerId);
  if (!self) return false;
  // A plain loop: this runs on the per-frame target-frame path.
  let sameParty = false;
  const members = world.partyInfo?.members;
  if (members) for (const member of members) if (member.pid === target.id) sameParty = true;
  // Both grounds are read off the entity positions, the local player's
  // included, rather than the readout's `zone`: the readout lags the local
  // player's own movement by a snapshot, and a stranger who can already open
  // on you the moment you step over a free-for-all line must read red that
  // frame, not the next. The World PvP tab paints the readout, so the two can
  // disagree for one snapshot after a crossing, never longer.
  return worldPvpPairHostile(
    self,
    target,
    sameParty,
    worldPvpZonePolicyAt(self.pos.x, self.pos.z),
    worldPvpZonePolicyAt(target.pos.x, target.pos.z),
  );
}

/** The id-taking twin for callers that hold a target id (the action bar). */
export function isPvpHostileTargetId(
  world: PvpHostileWorld,
  targetId: number | null | undefined,
): boolean {
  if (targetId === null || targetId === undefined) return false;
  const target = world.entities.get(targetId);
  return target !== undefined && isPvpHostilePlayer(world, target);
}
