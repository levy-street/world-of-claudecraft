// Authored fields playtest from the open document, including unsaved edits.
// They never replace the production battleground's global layout.
import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { createShippedMap } from '../src/editor/shipped_maps';
import { TH_FLAG_Z, TH_HALF_X, TH_HALF_Z } from '../src/editor/shipped_thornhollow';
import { BG_BASES, battlegroundColliders } from '../src/sim/battleground_layout';
import { setActiveWorldContent } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

afterEach(() => setActiveWorldContent(null));

async function thornhollowWorld() {
  const map = await createShippedMap('thornhollow', 'field_test', 1);
  return { map, world: customMapToWorldContent(map) };
}

describe('playtest: the authored Thornhollow field', () => {
  it('starts the player inside their own keep', async () => {
    const { world } = await thornhollowWorld();
    expect(Math.abs(world.playerStart.x)).toBeLessThan(TH_HALF_X);
    expect(Math.abs(world.playerStart.z)).toBeLessThan(TH_HALF_Z);
    expect(world.playerStart.z).toBe(-TH_FLAG_Z + 22);
  });

  it('boots a Sim that actually places the player there', async () => {
    const { world } = await thornhollowWorld();
    setActiveWorldContent(world);
    const sim = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      playerName: 'Mapmaker',
      riftPortals: false,
      world,
    });
    const player = sim.entities.get(sim.playerId);
    expect(player?.pos.x).toBeCloseTo(world.playerStart.x, 1);
    expect(player?.pos.z).toBeCloseTo(world.playerStart.z, 1);
  });

  it('projects unsaved flag and rune edits from the open document', async () => {
    const { map, world: before } = await thornhollowWorld();
    const flag = map.placements.find((p) => p.regionRole === 'flag0');
    if (!flag) throw new Error('missing authored flag');
    flag.x = 12.5;
    flag.z = -150;
    map.placements.push({
      assetId: 'collider/sphere',
      x: 20,
      z: -20,
      rotY: 0,
      scale: 1,
      collide: false,
      regionRole: 'speedRune',
    });
    const after = customMapToWorldContent(map);
    expect(after.objectives?.bases[0].flag).toEqual({ x: 12.5, z: -150 });
    expect(after.objectives?.speedRunes).toEqual([
      ...(before.objectives?.speedRunes ?? []),
      { x: 20, z: -20 },
    ]);
    expect(before.objectives?.bases[0].flag).toEqual({ x: 0, z: -TH_FLAG_Z });
  });

  it('keeps document edits isolated from fresh copies and the production field', async () => {
    const bases = structuredClone(BG_BASES);
    const colliders = battlegroundColliders();
    const { map } = await thornhollowWorld();
    map.placements.push({
      assetId: 'collider/box',
      x: 33,
      z: -33,
      rotY: 0,
      scale: 1,
      collide: true,
      sizeX: 6,
      sizeY: 7,
      sizeZ: 8,
      name: 'Unsaved test wall',
    });
    const edited = customMapToWorldContent(map);
    expect(edited.colliderVolumes).toContainEqual(
      expect.objectContaining({
        kind: 'box',
        x: 33,
        z: -33,
        sizeX: 6,
        sizeY: 7,
        sizeZ: 8,
      }),
    );
    const fresh = await thornhollowWorld();
    expect(fresh.map.placements.some((p) => p.name === 'Unsaved test wall')).toBe(false);
    expect(BG_BASES).toEqual(bases);
    expect(battlegroundColliders()).toEqual(colliders);
  });
});
