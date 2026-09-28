// Where precipitation stops falling: indoors (the fog state's call: dungeons, delves) and
// under the Mirefen tavern's roof (mirefen_tavern_core.ts tavernShelters), where the player
// walks in off the open world without any indoor fog. Returns the biome whose weather falls
// on the player, or null to clear it (weather.ts update's suppression channel).

import { zoneBiomeAt } from '../sim/world';
import { tavernShelters } from './mirefen_tavern_core';

export function precipBiomeAt(outdoor: boolean, x: number, y: number, z: number) {
  return outdoor && !tavernShelters(x, y, z) ? zoneBiomeAt(x, z) : null;
}
