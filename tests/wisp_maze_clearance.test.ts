import { expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { WISP_MAZE_NPC_DEF, WISP_MAZE_SITE } from '../src/sim/content/world_quest_wisp_maze';
import { CAMPS, zoneAt } from '../src/sim/data';
import { isExcludedDecoration, isExcludedStreetlamp } from '../src/sim/decoration_exclusions';
import { generateDecorationsInBounds, groundHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

it('checks the authored wisp maze clearing', () => {
  const scatter = generateDecorationsInBounds(WORLD_SEED, {
    minX: 426,
    maxX: 474,
    minZ: 1016,
    maxZ: 1064,
  });
  expect(scatter).toEqual([]);
  expect(isExcludedDecoration(470.83139702072367, 1049.3634334169328)).toBe(true);
  expect(isExcludedDecoration(472.05, 1049.3634334169328)).toBe(false);
  // The old Great Maze ends at x=427.5; keep the trial's west edge east of it.
  expect(WISP_MAZE_SITE.x - 22).toBeGreaterThan(427.5);
  for (let x = WISP_MAZE_SITE.x - 22; x <= WISP_MAZE_SITE.x + 22; x += 1) {
    for (let z = WISP_MAZE_SITE.z - 22; z <= WISP_MAZE_SITE.z + 22; z += 1) {
      expect(groundHeight(x, z, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL + 1);
      expect(zoneAt(x, z)?.id).toBe('evergarden');
      const resolved = resolvePosition(WORLD_SEED, x, z, 0.5);
      expect(Math.hypot(resolved.x - x, resolved.z - z), `${x},${z}`).toBeLessThan(0.05);
    }
  }
  for (const camp of CAMPS) {
    if (!camp.count) continue;
    expect(
      Math.hypot(camp.center.x - WISP_MAZE_SITE.x, camp.center.z - WISP_MAZE_SITE.z) - camp.radius,
    ).toBeGreaterThan(45);
  }
  const npc = WISP_MAZE_NPC_DEF.pos;
  expect(resolvePosition(WORLD_SEED, npc.x, npc.z, 0.5)).toEqual({ x: npc.x, z: npc.z });
  expect(groundHeight(npc.x, npc.z, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL + 1);
  expect(isExcludedStreetlamp(460.6305996347541, 1028.5178347589988)).toBe(true);
  expect(isExcludedStreetlamp(460.65, 1028.5178347589988)).toBe(false);
});
