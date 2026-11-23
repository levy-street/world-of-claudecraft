// Self PvP exposure, independent of overhead badge visibility and graphics settings.
// Read live position and flag like pvp_hostile_core so a boundary crossing does
// not wait for the next self snapshot. A disarming flag is still a live flag.
import { worldPvpZonePolicyAt } from '../sim/pvp/world_pvp_zones';
import type { IWorld } from '../world_api';

export type PvpRiskWorld = Pick<
  IWorld,
  'player' | 'worldPvpInfo' | 'duelInfo' | 'arenaInfo' | 'bgInfo'
>;

export function playerPvpRisk(world: PvpRiskWorld): boolean {
  const player = world.player;
  if (player.dead) return false;
  if (
    world.duelInfo?.state === 'active' ||
    world.arenaInfo?.match?.state === 'active' ||
    world.bgInfo?.match?.state === 'active'
  )
    return true;
  if (player.jailed) return true;
  if (world.worldPvpInfo?.enabled === false) return false;
  const zone = worldPvpZonePolicyAt(player.pos.x, player.pos.z);
  return zone !== 'sanctuary' && (zone === 'ffa' || player.pvpFlag === true);
}
