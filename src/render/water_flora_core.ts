// Placement walk for the still-water dressing (water_flora.ts), kept apart so
// the decision half is pure: no Three, no DOM, unit-testable in Node
// (tests/water_flora_core.test.ts). Same walk as before the split, but the
// spots come back grouped PER ZONE: the renderer distance-culls each zone's
// flora on its own footprint, where the old single world-spanning mesh could
// never be culled at all (10.96M triangles submitted from every realm).

import { ZONES } from '../sim/data';
import { hash2 } from '../sim/rng';
import { roadDistance, terrainHeight, WATER_LEVEL } from '../sim/world';

export interface WaterFloraPlacement {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
}

export interface WaterFloraRegion {
  zoneId: string;
  lilies: WaterFloraPlacement[];
  reeds: WaterFloraPlacement[];
}

const SKIP_BIOMES = new Set(['frost', 'ember']);
const SKIP_ZONES = new Set(['willowfen', 'palmreach']); // dress their own water

export function waterFloraRegions(seed: number): WaterFloraRegion[] {
  const regions: WaterFloraRegion[] = [];
  for (const zone of ZONES) {
    if (SKIP_BIOMES.has(zone.biome)) continue;
    if (SKIP_ZONES.has(zone.id)) continue;
    const lilySpots: WaterFloraPlacement[] = [];
    const reedSpots: WaterFloraPlacement[] = [];
    for (const lake of zone.lakes ?? []) {
      const lilies = 2 + Math.floor(hash2(lake.z, lake.x, seed + 6201) * 3);
      for (let k = 0; k < lilies; k++) {
        const ang = hash2(k * 3, lake.x, seed + 6211) * Math.PI * 2;
        const dist = Math.sqrt(hash2(lake.z, k * 5, seed + 6221)) * lake.radius * 0.7;
        const x = lake.x + Math.sin(ang) * dist;
        const z = lake.z + Math.cos(ang) * dist;
        if (terrainHeight(x, z, seed) > WATER_LEVEL - 0.7) continue;
        if (roadDistance(x, z) < 4) continue;
        lilySpots.push({
          x,
          z,
          y: WATER_LEVEL + 0.03,
          s: 3.5 + hash2(lake.x, k + 11, seed + 6241) * 2,
          rot: hash2(k, lake.x + 7, seed + 6231) * Math.PI * 2,
        });
      }
      const reeds = 4 + Math.floor(hash2(lake.x + 3, lake.z, seed + 6251) * 3);
      for (let k = 0; k < reeds; k++) {
        const ang = hash2(k * 7, lake.z, seed + 6261) * Math.PI * 2;
        for (let dist = lake.radius * 0.9; dist < lake.radius * 1.7; dist += 0.6) {
          const x = lake.x + Math.sin(ang) * dist;
          const z = lake.z + Math.cos(ang) * dist;
          const y = terrainHeight(x, z, seed);
          if (y < WATER_LEVEL - 0.45 || y > WATER_LEVEL + 0.25) continue;
          if (roadDistance(x, z) < 4) break;
          reedSpots.push({
            x,
            z,
            y: y - 0.1,
            s: 2.6 + hash2(lake.z, k + 5, seed + 6271) * 1.2,
            rot: hash2(k, lake.x + 13, seed + 6281) * Math.PI * 2,
          });
          break;
        }
      }
    }
    if (lilySpots.length + reedSpots.length > 0) {
      regions.push({ zoneId: zone.id, lilies: lilySpots, reeds: reedSpots });
    }
  }
  return regions;
}
