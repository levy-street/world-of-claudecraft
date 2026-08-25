import { describe, expect, it } from 'vitest';
import { sfx } from '../src/game/sfx';

// The ambience() dynamic rift sweep: a rift portal/roller/glide source can
// vanish between frames while its loop is still mid-load, so the sweep must
// drop it from ALL THREE pending maps together (the unloop contract). Deleting
// only pendingLoops is the exact drift that once stranded a load/variant pair
// per vanished portal/roller for the rest of the session. No AudioContext
// exists in this test, which is the mid-load bookkeeping state exactly: map
// entries with no live audio graph behind them.

interface SfxPendingMaps {
  pendingLoops: Map<string, unknown>;
  pendingLoopLoads: Map<string, string>;
  pendingLoopVariants: Map<string, number>;
}

const maps = sfx as unknown as SfxPendingMaps;
const allThree = [maps.pendingLoops, maps.pendingLoopLoads, maps.pendingLoopVariants];

function seedPending(id: string, key: string): void {
  maps.pendingLoops.set(id, { key, target: 0.2, immediate: false });
  maps.pendingLoopLoads.set(id, key);
  maps.pendingLoopVariants.set(id, 0);
}

describe('ambience() dynamic rift pending sweep', () => {
  it('drops a vanished rift source from all three pending maps together', () => {
    // Arrange: a portal that vanished mid-load, a roller still present this
    // frame (the listener sits at the origin, so (0,0,0) is in range), and a
    // non-rift pending loop the sweep must never touch.
    seedPending('rift_portal:gone', 'rift_portal_drone');
    seedPending('rift_roller:active', 'rift_boulder_roll');
    seedPending('campfire:7', 'amb_campfire');
    // Act: one ambience frame whose point sources no longer include the portal.
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'rift_roller:active', kind: 'rift_roller', x: 0, y: 0, z: 0 },
    ]);
    // Assert: per map, the vanished source is gone, the survivors are intact.
    for (const map of allThree) {
      expect(map.has('rift_portal:gone')).toBe(false);
      expect(map.has('rift_roller:active')).toBe(true);
      expect(map.has('campfire:7')).toBe(true);
    }
    // Cleanup: leave the singleton's maps as we found them.
    for (const map of allThree) {
      map.delete('rift_roller:active');
      map.delete('campfire:7');
    }
  });
});
