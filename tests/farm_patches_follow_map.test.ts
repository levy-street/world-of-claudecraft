// Garden beds a map moves (WorldContent.objectMoves, sim/moved_objects.ts)
// stand at the same spot in BOTH worlds: the offline/server Sim seats, plants
// and harvests crops on its own world's beds, and the online ClientWorld draws
// those crops on IWorld.farmPatches, so the two must agree on every bed. No
// realm runs a map today (the server runs the built-in world), but if one
// ever does, its crops must not draw at the shipped spots. Also pins the
// published maps themselves: a headless Sim on each map that moves a bed
// serves the moved positions the crops are drawn on.

import { afterEach, describe, expect, it } from 'vitest';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import {
  BASE_WORLD,
  BUILTIN_WORLD,
  farmPatchesInActiveWorld,
  setActiveWorldContent,
} from '../src/sim/data';
import { PUBLISHED_MAPS } from '../src/sim/maps/index.generated';
import { freezeObjectMoves, objectMoveKey, parseObjectMoveKey } from '../src/sim/moved_objects';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

const bedRows = (patches: readonly { beds: readonly { id: string }[] }[]) =>
  patches.flatMap((patch) => patch.beds);

afterEach(() => setActiveWorldContent(null));

describe('farm patches: Sim and ClientWorld agree on a moved world', () => {
  it('both serve the shipped table itself on the base world', () => {
    setActiveWorldContent(BASE_WORLD);
    const sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true, world: BASE_WORLD });
    expect(sim.farmPatches).toBe(FARM_PATCHES);
    expect(bareClient(1).farmPatches).toBe(FARM_PATCHES);
    expect(farmPatchesInActiveWorld()).toBe(FARM_PATCHES);
  });

  it('both serve the moved, turned and deleted beds of the loaded world', () => {
    const [first, second, third] = bedRows(FARM_PATCHES);
    const world: WorldContent = {
      ...BUILTIN_WORLD,
      objectMoves: freezeObjectMoves({
        [objectMoveKey('farmBed', first.id)]: { x: -84.25, z: -74.75 },
        [objectMoveKey('farmBed', second.id)]: { x: -78.5, z: -82.25, rotY: 1.2, scale: 1.5 },
        [objectMoveKey('farmBed', third.id)]: { x: 0, z: 0, removed: true },
      }),
    };
    setActiveWorldContent(world);
    const sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true, world });
    const client = bareClient(1);
    expect(client.farmPatches).toEqual(sim.farmPatches);
    const beds = bedRows(client.farmPatches);
    expect(beds.find((b) => b.id === first.id)).toMatchObject({ x: -84.25, z: -74.75 });
    expect(beds.find((b) => b.id === second.id)).toMatchObject({ rotY: 1.2, scale: 1.5 });
    expect(beds.some((b) => b.id === third.id)).toBe(false);
  });
});

describe('farm patches: every published map that moves a bed', () => {
  it('a headless Sim on the map serves the moved bed positions', async () => {
    for (const entry of PUBLISHED_MAPS) {
      const world = await entry.load();
      const moves = Object.entries(world.objectMoves ?? {}).filter(
        ([key]) => parseObjectMoveKey(key)?.kind === 'farmBed',
      );
      if (moves.length === 0) continue;
      setActiveWorldContent(world);
      const sim = new Sim({ seed: entry.seed, playerClass: 'warrior', noPlayer: true, world });
      const beds = bedRows(sim.farmPatches);
      for (const [key, move] of moves) {
        const id = parseObjectMoveKey(key)?.id;
        const bed = beds.find((b) => b.id === id);
        if (move.removed) {
          expect(bed, `${entry.slug}: ${key} is deleted`).toBeUndefined();
        } else {
          expect(bed, `${entry.slug}: ${key}`).toMatchObject({ x: move.x, z: move.z });
        }
      }
      expect(bareClient(1).farmPatches).toEqual(sim.farmPatches);
      setActiveWorldContent(null);
    }
  });
});
