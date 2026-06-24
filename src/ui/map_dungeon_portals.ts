// Which dungeons get an overworld portal dot + label on the world map, for a
// given zone band. Pure data logic, no DOM: the HUD map loop is the thin consumer.
//
// This mirrors the door-spawn rule in sim.ts (a dungeon with overworldDoor ===
// false has no physical overworld entrance, so it must not appear as an overworld
// map portal either). Without this filter, dungeons that deliberately share a
// doorPos with their parent (the Nythraxis raid arena reuses the Abandoned Crypt
// door, since it is reached through a sealed door inside the crypt) stamp a second
// label at the identical map point, so the dungeon and raid names overlap.
import type { DungeonDef } from '../sim/types';

export interface MapDungeonPortal {
  id: string;
  x: number;
  z: number;
}

// Portals to draw for the zone whose band is [zMin, zMax). Matches the map loop's
// own bounds test (door z in [zMin, zMax)).
export function overworldDungeonPortals(
  dungeons: readonly DungeonDef[],
  zMin: number,
  zMax: number,
): MapDungeonPortal[] {
  const portals: MapDungeonPortal[] = [];
  for (const d of dungeons) {
    if (d.overworldDoor === false) continue;
    if (d.doorPos.z < zMin || d.doorPos.z >= zMax) continue;
    portals.push({ id: d.id, x: d.doorPos.x, z: d.doorPos.z });
  }
  return portals;
}
