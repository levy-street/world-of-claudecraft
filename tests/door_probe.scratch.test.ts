// SCRATCH (not for commit): grid-scan for a flat, dry, empty Drowned Litany doorPos
// near the marsh's north end (z 505-535).
import { it } from 'vitest';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

it('scan for flat dry door spots', () => {
  const seed = 42;
  const results: { x: number; z: number; slope: number; h: number }[] = [];
  for (let x = -130; x <= 130; x += 5) {
    for (let z = 505; z <= 535; z += 5) {
      // known occupancy: gravecaller camp + road (x -30..30), bastion door (x 35..60 z 505..525),
      // troll mounds reach (-120..-85, up to ~500), lake (-40,450) r20 is south of this band
      if (x >= -32 && x <= 32) continue;
      if (x >= 33 && x <= 62 && z <= 527) continue;
      let min = Infinity;
      let max = -Infinity;
      for (let dx = -6; dx <= 6; dx += 3) {
        for (let dz = -7; dz <= 3; dz += 2.5) {
          const hh = terrainHeight(x + dx, z + dz, seed);
          min = Math.min(min, hh);
          max = Math.max(max, hh);
        }
      }
      if (min > WATER_LEVEL + 0.5) results.push({ x, z, slope: max - min, h: terrainHeight(x, z, seed) });
    }
  }
  results.sort((a, b) => a.slope - b.slope);
  for (const r of results.slice(0, 12)) {
    console.log(`(${r.x},${r.z}) slope=${r.slope.toFixed(2)} h=${r.h.toFixed(2)}`);
  }
});
