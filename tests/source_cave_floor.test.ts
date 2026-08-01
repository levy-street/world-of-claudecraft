// The Source Cave arena room keeps a swept floor.
//
// The room is a working server hall (racks, desks, bookcases) whose centre seal
// is a flat disc laid straight over the floor tiles. The shared crypt kit ships
// two rock-BEARING tiles (floor_tile_large_rocks, floor_dirt_large_rocky) whose
// modelled stones pushed through that disc and littered the whole room, so the
// cave takes its own floor mix and skips the legacy collapsed-masonry corners.
// Both guards are scoped: the other delve modules are ruins and keep their rock.

import { describe, expect, it } from 'vitest';
import { DungeonInteriors, floorKindFor } from '../src/render/dungeon';
import { SOURCE_CAVE_ARENA_LAYOUT } from '../src/sim/delve_layout';

// Every kit tile that carries modelled loose rock on its surface.
const ROCK_BEARING_TILES = ['floor_tile_large_rocks', 'floor_dirt_large_rocky'];

// Dense enough that a weight as small as 1/1000 of the table would be hit.
function sweep(variant: Parameters<typeof floorKindFor>[0]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 4000; i++) out.push(floorKindFor(variant, i / 4000));
  return out;
}

describe('Source Cave arena floor', () => {
  it('never draws a rock-bearing tile anywhere in the room', () => {
    const kinds = new Set(sweep('source_cave_library'));
    for (const rocky of ROCK_BEARING_TILES) {
      expect(kinds, `${rocky} must not reach the server hall floor`).not.toContain(rocky);
    }
  });

  it('still tiles the room from the crypt kit (flags, dirt patches, subdivisions)', () => {
    // Pins the mix itself, so re-adding a rocky kind to this arm reds here too,
    // not only in the negative check above.
    expect(new Set(sweep('source_cave_library'))).toEqual(
      new Set(['floor_tile_large', 'floor_dirt_large', 'quad']),
    );
  });

  it('leaves the other delve modules their rubble (the guard is cave-scoped)', () => {
    for (const variant of ['delve_ossuary', 'delve_bell', 'delve_hall', 'delve_finale'] as const) {
      const kinds = new Set(sweep(variant));
      for (const rocky of ROCK_BEARING_TILES) {
        expect(kinds, `${variant} is a ruin and keeps ${rocky}`).toContain(rocky);
      }
    }
  });

  it('places no collapsed-masonry corner blocks in the cave', () => {
    const calls: string[] = [];
    const placements = { add: (kind: string) => calls.push(kind) };
    const interiors = Object.create(DungeonInteriors.prototype) as DungeonInteriors;
    (
      interiors as unknown as {
        placeWallDressing(
          sink: typeof placements,
          layout: typeof SOURCE_CAVE_ARENA_LAYOUT,
          variant: 'source_cave_library',
        ): void;
      }
    ).placeWallDressing(placements, SOURCE_CAVE_ARENA_LAYOUT, 'source_cave_library');

    expect(calls).not.toContain('rubble_half');
    // The dressing pass still runs: the library bookcases are its whole point,
    // so an empty call list would mean this test passes for the wrong reason.
    expect(calls.length).toBeGreaterThan(0);
  });
});
