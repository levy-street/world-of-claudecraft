// Regression pin for the calm-anchor door roster: interior-only dungeon rooms
// (overworldDoor: false) have no walk-up entrance in the open world, so they
// must not register a dungeonDoor terrain calm pad. The d14e94fad fix added
// the overworldDoor skip to dungeon_door_clearance.ts, colliders.ts, sim.ts,
// and map_dungeon_portals.ts but missed this fifth site, so the Ignivar raid
// rooms' placeholder doorPos baked a flat 7/15 pad into Eastbrook Vale at the
// world origin.
import { describe, expect, it } from 'vitest';
import { DUNGEONS } from '../src/sim/data';
import { collectCalmAnchorPads } from '../src/sim/terrain_calm_anchors';

describe('terrain calm anchor door roster', () => {
  const doorPads = collectCalmAnchorPads().filter((pad) => pad.category === 'dungeonDoor');
  const dungeons = Object.values(DUNGEONS);
  const visible = dungeons.filter((dungeon) => dungeon.overworldDoor !== false);
  const interiorOnly = dungeons.filter((dungeon) => dungeon.overworldDoor === false);

  it('registers one pad per dungeon with a real overworld door', () => {
    expect(doorPads).toHaveLength(visible.length);
    for (const dungeon of visible) {
      const padded = doorPads.some(
        (pad) => pad.x === dungeon.doorPos.x && pad.z === dungeon.doorPos.z,
      );
      expect(padded, dungeon.id).toBe(true);
    }
  });

  it('registers no pad for interior-only rooms', () => {
    for (const dungeon of interiorOnly) {
      const sharedWithVisibleDoor = visible.some(
        (other) => other.doorPos.x === dungeon.doorPos.x && other.doorPos.z === dungeon.doorPos.z,
      );
      if (sharedWithVisibleDoor) continue;
      const padded = doorPads.some(
        (pad) => pad.x === dungeon.doorPos.x && pad.z === dungeon.doorPos.z,
      );
      expect(padded, dungeon.id).toBe(false);
    }
  });

  it('leaves the world origin uncalmed', () => {
    expect(doorPads.some((pad) => pad.x === 0 && pad.z === 0)).toBe(false);
  });
});
