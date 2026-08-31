// Overworld dungeon door arches: only the two stone JAMBS collide, because
// walking into the mouth IS the enter trigger. The Abandoned Crypt's door
// draws no arch (an invisible click box at the mine), and two dungeons can
// share one doorway, so dedupe by position. Extracted from colliders.ts
// under the monolith ratchet; the caller passes its camera-top resolver.
import type { Collider } from './colliders';
import { DUNGEON_LIST } from './data';
import {
  DOOR_ARCH_HEIGHT,
  DOOR_ARCH_JAMB_HD,
  DOOR_ARCH_JAMB_HW,
  DOOR_ARCH_JAMB_X,
} from './prop_layout';

export function dungeonDoorJambColliders(
  seed: number,
  topY: (seed: number, x: number, z: number, height: number) => number,
): Collider[] {
  const out: Collider[] = [];
  const doorSpots = new Set<string>();
  for (const dungeon of DUNGEON_LIST) {
    if (dungeon.overworldDoor === false) continue;
    if (dungeon.id === 'nythraxis_crypt') continue;
    const key = `${dungeon.doorPos.x},${dungeon.doorPos.z}`;
    if (doorSpots.has(key)) continue;
    doorSpots.add(key);
    for (const sx of [-DOOR_ARCH_JAMB_X, DOOR_ARCH_JAMB_X]) {
      const x = dungeon.doorPos.x + sx;
      out.push({
        type: 'obb',
        x,
        z: dungeon.doorPos.z,
        hw: DOOR_ARCH_JAMB_HW,
        hd: DOOR_ARCH_JAMB_HD,
        rot: 0,
        cameraTopY: topY(seed, x, dungeon.doorPos.z, DOOR_ARCH_HEIGHT),
      });
    }
  }
  return out;
}
