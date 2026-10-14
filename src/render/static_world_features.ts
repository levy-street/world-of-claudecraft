// The world-spanning static dressing the renderer attaches once at boot, like
// the per-zone features (gated attach, frozen matrices, the fog cull): the
// lily-and-reed water flora on every temperate lake, the Farshore's palm
// strand, the Gravewyrm Sanctum's Seal Gate and the four built dungeon
// entrances (the Sunken Bastion's Drowned Gate Tower, the Hollow Crypt's
// Fallen Chapel, the Drowned Temple's Moon Stair and the Wildheart Basin's
// Jaguar Maw). A new static set piece joins this list, never a new line in
// renderer.ts (the monolith ratchet). The four entrances are overworld SITE
// dressing at fixed coordinates, so an authored map (the Deepglass's Tidehold
// stands Castle B where the Drowned Gate Tower would) gets none of them, the
// same rule that keeps the dungeon doors and the hollow gates off it
// (sim/map_presentation.ts usesOverworldSiteDressing); the sim's
// dungeon_door_jambs.ts gates their colliders on the same rule.
import { getActiveWorldContent } from '../sim/data';
import { usesOverworldSiteDressing } from '../sim/map_presentation';
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

export function buildStaticWorldFeatures(seed: number) {
  // a rebuilt renderer builds its set pieces afresh: forget the old meshes
  clearSetPieceOccluders();
  const entrances = usesOverworldSiteDressing(getActiveWorldContent().presentationMode)
    ? [
        buildSunkenBastionEntrance(seed),
        buildHollowCryptEntrance(seed),
        buildDrownedTempleEntrance(seed),
        buildWildheartBasinEntrance(seed),
      ]
    : [];
  return [
    buildWaterFlora(seed),
    buildFarshoreFeatures(seed),
    buildSanctumSealGate(seed),
    ...entrances,
  ];
}
