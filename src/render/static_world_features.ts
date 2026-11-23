// The world-spanning static dressing the renderer attaches once at boot, like
// the per-zone features (gated attach, frozen matrices, the fog cull): the
// lily-and-reed water flora on every temperate lake, the Farshore's palm
// strand, the Gravewyrm Sanctum's Seal Gate and the four built dungeon
// entrances (the Sunken Bastion's Drowned Gate Tower, the Hollow Crypt's
// Fallen Chapel, the Drowned Temple's Moon Stair and the Wildheart Basin's
// Jaguar Maw). A new static set piece joins this list, never a new line in
// renderer.ts (the monolith ratchet).
import { getActiveWorldContent } from '../sim/data';
import { DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID } from '../sim/drowned_temple_entrance';
import { HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID } from '../sim/hollow_crypt_entrance';
import { objectRemoved } from '../sim/moved_objects';
import { SANCTUM_SEAL_GATE_DUNGEON_ID } from '../sim/sanctum_seal_gate';
import { SUNKEN_BASTION_ENTRANCE_DUNGEON_ID } from '../sim/sunken_bastion_entrance';
import { WILDHEART_BASIN_ENTRANCE_DUNGEON_ID } from '../sim/wildheart_basin_entrance';
import { buildDrownedTempleEntrance } from './drowned_temple_entrance';
import { buildFarshoreFeatures } from './farshore_features';
import { buildHollowCryptEntrance } from './hollow_crypt_entrance';
import { buildSanctumSealGate } from './sanctum_seal_gate';
import { clearSetPieceOccluders } from './set_piece_occluders';
import { buildSunkenBastionEntrance } from './sunken_bastion_entrance';
import { buildWaterFlora } from './water_flora';
import { buildWildheartBasinEntrance } from './wildheart_basin_entrance';

// The set pieces register what they put between the camera and the character
// (set_piece_occluders.ts); the renderer drives the pass through this module.
export { updateSetPieceOccluders } from './set_piece_occluders';

function isDoorKept(dungeonId: string): boolean {
  return !objectRemoved(getActiveWorldContent().objectMoves, 'dungeonDoor', dungeonId);
}

export function buildStaticWorldFeatures(seed: number) {
  // a rebuilt renderer builds its set pieces afresh: forget the old meshes
  clearSetPieceOccluders();
  return [
    buildWaterFlora(seed),
    buildFarshoreFeatures(seed),
    ...(isDoorKept(SANCTUM_SEAL_GATE_DUNGEON_ID) ? [buildSanctumSealGate(seed)] : []),
    ...(isDoorKept(SUNKEN_BASTION_ENTRANCE_DUNGEON_ID) ? [buildSunkenBastionEntrance(seed)] : []),
    ...(isDoorKept(HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID) ? [buildHollowCryptEntrance(seed)] : []),
    ...(isDoorKept(DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID) ? [buildDrownedTempleEntrance(seed)] : []),
    ...(isDoorKept(WILDHEART_BASIN_ENTRANCE_DUNGEON_ID) ? [buildWildheartBasinEntrance(seed)] : []),
  ];
}
