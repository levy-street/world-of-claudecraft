import type { Entity } from './types';

/** The entry corridor is inside the instance claim but outside Varkhul's
 * arena. A raider waiting there cannot keep a damaged pull alive after
 * everyone in the arena has died or retreated. */
export function varkhulArenaPlayers(players: readonly Entity[], arenaSouthEdgeZ: number): Entity[] {
  return players.filter((player) => player.pos.z >= arenaSouthEdgeZ);
}
