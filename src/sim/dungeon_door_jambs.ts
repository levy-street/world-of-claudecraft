// Overworld dungeon door arches: only the two stone JAMBS collide, because
// walking into the mouth IS the enter trigger. The Abandoned Crypt's door
// draws no arch (an invisible click box at the mine), and two dungeons can
// share one doorway, so dedupe by position. A door whose facade is a built
// set piece hands that set piece's own colliders instead of the jambs: the
// Gravewyrm Sanctum's Seal Gate (sanctum_seal_gate.ts), whose pylons ARE the
// jambs, and the four built entrances, each its own door: the Sunken
// Bastion's Drowned Gate Tower, the Hollow Crypt's Fallen Chapel, the Drowned
// Temple's Moon Stair and the Wildheart Basin's Jaguar Maw (the
// *_entrance.ts modules beside this one). Extracted from colliders.ts under
// the monolith ratchet; the caller passes its camera-top resolver.
import type { Collider } from './colliders';
import { DUNGEON_LIST, getActiveWorldContent } from './data';
import {
  DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID,
  drownedTempleEntranceColliders,
} from './drowned_temple_entrance';
import {
  HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID,
  hollowCryptEntranceColliders,
} from './hollow_crypt_entrance';
import { dungeonDoorPos, objectRemoved } from './moved_objects';
import {
  DOOR_ARCH_HEIGHT,
  DOOR_ARCH_JAMB_HD,
  DOOR_ARCH_JAMB_HW,
  DOOR_ARCH_JAMB_X,
} from './prop_layout';
import { SANCTUM_SEAL_GATE_DUNGEON_ID, sanctumSealGateColliders } from './sanctum_seal_gate';
import {
  SUNKEN_BASTION_ENTRANCE_DUNGEON_ID,
  sunkenBastionEntranceColliders,
} from './sunken_bastion_entrance';
import {
  WILDHEART_BASIN_ENTRANCE_DUNGEON_ID,
  wildheartBasinEntranceColliders,
} from './wildheart_basin_entrance';

export function dungeonDoorJambColliders(
  seed: number,
  topY: (seed: number, x: number, z: number, height: number) => number,
): Collider[] {
  const out: Collider[] = [];
  const doorSpots = new Set<string>();
  // A Studio map may move a door (moved_objects.ts): its jambs or set-piece
  // colliders travel with it. The shipped position otherwise.
  const moves = getActiveWorldContent().objectMoves;
  for (const dungeon of DUNGEON_LIST) {
    if (dungeon.overworldDoor === false) continue;
    if (dungeon.id === 'nythraxis_crypt') continue;
    // A deleted door takes its jambs and set-piece walls with it.
    if (objectRemoved(moves, 'dungeonDoor', dungeon.id)) continue;
    const doorPos = dungeonDoorPos(moves, dungeon);
    const key = `${doorPos.x},${doorPos.z}`;
    if (doorSpots.has(key)) continue;
    doorSpots.add(key);
    if (dungeon.id === SANCTUM_SEAL_GATE_DUNGEON_ID) {
      out.push(...sanctumSealGateColliders(seed, doorPos));
      continue;
    }
    if (dungeon.id === SUNKEN_BASTION_ENTRANCE_DUNGEON_ID) {
      out.push(...sunkenBastionEntranceColliders(seed, doorPos));
      continue;
    }
    if (dungeon.id === HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID) {
      out.push(...hollowCryptEntranceColliders(seed, doorPos));
      continue;
    }
    if (dungeon.id === DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID) {
      out.push(...drownedTempleEntranceColliders(seed, doorPos));
      continue;
    }
    if (dungeon.id === WILDHEART_BASIN_ENTRANCE_DUNGEON_ID) {
      out.push(...wildheartBasinEntranceColliders(seed, doorPos));
      continue;
    }
    for (const sx of [-DOOR_ARCH_JAMB_X, DOOR_ARCH_JAMB_X]) {
      const x = doorPos.x + sx;
      out.push({
        type: 'obb',
        x,
        z: doorPos.z,
        hw: DOOR_ARCH_JAMB_HW,
        hd: DOOR_ARCH_JAMB_HD,
        rot: 0,
        cameraTopY: topY(seed, x, doorPos.z, DOOR_ARCH_HEIGHT),
      });
    }
  }
  return out;
}
