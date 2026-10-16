// dungeon_keyed_builds.ts: the world editor's live interior rebuild records a
// keyed build's additions and splices exactly those back out (moved out of
// dungeon.ts). Plain arrays stand in for the DungeonInteriors registries.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  capturePlacementRecords,
  disposeKeyedInterior,
  type KeyedBuildRegistries,
  type KeyedInteriorBuild,
  keyedBuildTracker,
} from '../src/render/dungeon_keyed_builds';
import type { WallHideable } from '../src/render/dungeon_wall_occlusion';

const hideable = (): WallHideable => ({}) as unknown as WallHideable;

function registries(): KeyedBuildRegistries {
  return {
    flames: [new THREE.Mesh()],
    fireLightRegistry: [new THREE.PointLight()],
    arenaHideables: [hideable()],
  };
}

describe('keyed interior builds', () => {
  it('records exactly the additions made after the snapshot, under the key', () => {
    const builds = new Map<string, KeyedInteriorBuild>();
    const reg = registries();
    const before = { ...reg, flames: [...reg.flames] };
    const finish = keyedBuildTracker(builds, 'room', () => reg);
    const flame = new THREE.Mesh();
    const light = new THREE.PointLight();
    const wall = hideable();
    reg.flames.push(flame);
    reg.fireLightRegistry?.push(light);
    reg.arenaHideables.push(wall);
    const group = new THREE.Group();
    expect(finish(group)).toBe(group);
    expect(builds.get('room')).toEqual({
      group,
      flames: [flame],
      fireLights: [light],
      arenaHideables: [wall],
    });
    expect(reg.flames[0]).toBe(before.flames[0]);
  });

  it('tracks nothing without a key', () => {
    const builds = new Map<string, KeyedInteriorBuild>();
    keyedBuildTracker(builds, undefined, registries)(new THREE.Group());
    expect(builds.size).toBe(0);
  });

  it('splices the build back out, dirties the rank only when lights left, and frees GPU state', () => {
    const reg = registries();
    const keepFlame = reg.flames[0];
    const keepLight = reg.fireLightRegistry?.[0];
    const keepWall = reg.arenaHideables[0];
    const group = new THREE.Group();
    const flame = new THREE.Mesh();
    const light = new THREE.PointLight();
    const wall = hideable();
    const inst = new THREE.InstancedMesh(new THREE.BufferGeometry(), undefined, 1);
    const instDispose = vi.spyOn(inst, 'dispose');
    group.add(inst, light);
    reg.flames.push(flame);
    reg.fireLightRegistry?.push(light);
    reg.arenaHideables.push(wall);
    const changed = vi.fn();
    const kept = disposeKeyedInterior(
      { group, flames: [flame], fireLights: [light], arenaHideables: [wall] },
      reg,
      changed,
    );
    expect(reg.flames).toEqual([keepFlame]);
    expect(reg.fireLightRegistry).toEqual([keepLight]);
    expect(kept).toEqual([keepWall]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(instDispose).toHaveBeenCalledTimes(1);

    const again = vi.fn();
    disposeKeyedInterior(
      { group, flames: [], fireLights: [light], arenaHideables: [] },
      reg,
      again,
    );
    expect(again).not.toHaveBeenCalled();
  });

  it('captureOnly parks the room plan and the arena wall plans on the group', () => {
    const group = new THREE.Group();
    const room = { records: [{ id: 'a' }] } as never;
    const walls = { all: [{ placements: { records: [{ id: 'b' }] } }] } as never;
    capturePlacementRecords(group, room, walls);
    expect(group.userData.dungeonPlacementRecords).toEqual([{ id: 'a' }, { id: 'b' }]);
    capturePlacementRecords(group, room, null);
    expect(group.userData.dungeonPlacementRecords).toEqual([{ id: 'a' }]);
  });
});
