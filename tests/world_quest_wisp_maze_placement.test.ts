import { describe, expect, it } from 'vitest';
import { WISP_MAZE_SITE } from '../src/sim/content/world_quest_wisp_maze';
import { CAMPS, zoneAt } from '../src/sim/data';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('private maze trial site', () => {
  it('occupies dry Evergarden lawn outside public encounter camps', () => {
    for (let dx = -22; dx <= 22; dx += 4)
      for (let dz = -22; dz <= 22; dz += 4) {
        const x = WISP_MAZE_SITE.x + dx,
          z = WISP_MAZE_SITE.z + dz;
        expect(groundHeight(x, z, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL + 1);
        expect(zoneAt(x, z)?.id).toBe('evergarden');
      }
    for (const camp of CAMPS) {
      if (!camp.count) continue;
      expect(
        Math.hypot(camp.center.x - WISP_MAZE_SITE.x, camp.center.z - WISP_MAZE_SITE.z) -
          camp.radius,
      ).toBeGreaterThan(45);
    }
  });
});
