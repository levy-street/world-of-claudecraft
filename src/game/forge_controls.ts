// Client-side routing for the forge workshop bar (Strike / Stoke).
//
// The two slots are the anvil and the woodpile: pressing one is the same
// authoritative pickup interaction as walking up and clicking the object, so
// no new wire verb exists and the server keeps every check it already had
// (range, the offer, the live session). Keys 1 and 2 reach here through the
// vehicle bar while the workshop is live, exactly like the cloak's slots.

import { FORGE_QUEST_ID, FORGE_STATIONS } from '../sim/content/world_quest_forging';
import type { WorldQuestProgress } from '../sim/types';
import type { IWorld } from '../world_api';

export type ForgeControlWorld = Pick<IWorld, 'player' | 'worldQuestLog' | 'pickUpObject'>;

export function forgeControlsActive(world: {
  worldQuestLog?: ReadonlyMap<string, WorldQuestProgress>;
}): boolean {
  const phase = world.worldQuestLog?.get(FORGE_QUEST_ID)?.forging?.phase;
  return phase === 'countdown' || phase === 'working';
}

const ANVIL = FORGE_STATIONS.find((station) => station.id === 'tools');
const WOODPILE = FORGE_STATIONS.find((station) => station.id === 'fuel');

/** Slot 0 strikes (the anvil), slot 1 stokes (the woodpile). */
export function forgeChooseSlot(world: ForgeControlWorld, slot: number): void {
  if (world.player.dead || !forgeControlsActive(world)) return;
  const station = slot === 0 ? ANVIL : slot === 1 ? WOODPILE : undefined;
  if (station) world.pickUpObject(station.entityId);
}
