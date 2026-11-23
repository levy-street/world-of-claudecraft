// The world editor's KEYED interior builds: the Studio's dungeon mode tears an
// interior down and rebuilds it live, so a build that passes `opts.key` records
// exactly what it added to the DungeonInteriors registries (flames, raw fire
// lights, arena hideables) and `disposeKeyedInterior` splices those back out.
// Moved out of dungeon.ts (the monolith ratchet). Untracked without a key, so
// the shipped game (which never passes one) is unchanged.
//
// The fire lights: the editor hands DungeonInteriors the RAW fire-light
// registry behind its append-only sink, plus its rank-dirty hook. A keyed build
// has to know which lights it added and splice exactly those back out, and an
// append-only sink cannot express a release (the battleground field takes the
// raw registry for the same reason). Lights still JOIN through the sink, so
// they are still hidden and ranked on the way in; this is only how they leave.

import type * as THREE from 'three';
import type { DungeonPlacementRecord, PendingArenaWalls, Placements } from './dungeon_arena_walls';
import type { WallHideable } from './dungeon_wall_occlusion';
import { pruneFireLights } from './fire_light_registry';

export interface KeyedInteriorBuild {
  group: THREE.Group;
  flames: THREE.Mesh[];
  fireLights: THREE.PointLight[];
  arenaHideables: WallHideable[];
}

/** The registries a keyed build adds to, as DungeonInteriors holds them. */
export interface KeyedBuildRegistries {
  flames: THREE.Mesh[];
  fireLightRegistry?: THREE.PointLight[];
  arenaHideables: WallHideable[];
}

/**
 * Snapshot the registry lengths at the start of a build and return the
 * finisher that records the build's additions under `key` (a no-op finisher
 * without one). Take the snapshot AFTER the build's last await: everything
 * after it is synchronous, so the slices taken at the end are exactly this
 * build's additions.
 */
export function keyedBuildTracker(
  builds: Map<string, KeyedInteriorBuild>,
  key: string | undefined,
  registries: () => KeyedBuildRegistries,
): (group: THREE.Group) => THREE.Group {
  const at = registries();
  const flamesStart = at.flames.length;
  const lightsStart = at.fireLightRegistry?.length ?? 0;
  const hideablesStart = at.arenaHideables.length;
  return (group) => {
    if (key) {
      const now = registries();
      builds.set(key, {
        group,
        flames: now.flames.slice(flamesStart),
        fireLights: now.fireLightRegistry?.slice(lightsStart) ?? [],
        arenaHideables: now.arenaHideables.slice(hideablesStart),
      });
    }
    return group;
  };
}

/**
 * Tear one keyed build's additions back out of the registries and free its
 * per-build GPU state (instance matrices and light shadow maps). Shared kit
 * geometries and materials are left alone: they are module or instance level
 * caches the next build reuses. Returns the arena hideables to keep.
 */
export function disposeKeyedInterior(
  record: KeyedInteriorBuild,
  registries: KeyedBuildRegistries,
  onFireLightsChanged?: () => void,
): WallHideable[] {
  const flames = new Set<THREE.Mesh>(record.flames);
  if (flames.size) {
    for (let i = registries.flames.length - 1; i >= 0; i--) {
      if (flames.has(registries.flames[i])) registries.flames.splice(i, 1);
    }
  }
  const lights = new Set<THREE.PointLight>(record.fireLights);
  if (lights.size && registries.fireLightRegistry) {
    // pruneFireLights reports whether the registry actually changed, and the
    // rank MUST be dirtied when it did: the rebuild guard compares
    // rank.length against a count, so a teardown that removes as many lights
    // as the following rebuild adds would otherwise leave a stale rank.
    if (pruneFireLights(registries.fireLightRegistry, lights)) onFireLightsChanged?.();
  }
  const hideables = new Set(record.arenaHideables);
  const kept = hideables.size
    ? registries.arenaHideables.filter((h) => !hideables.has(h))
    : registries.arenaHideables;
  record.group.traverse((obj) => {
    const instanced = obj as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) instanced.dispose();
    const light = obj as unknown as THREE.PointLight;
    if (light.isLight) light.dispose();
  });
  return kept;
}

/** Editor importer (`captureOnly`): park the build's exact placement plan on
 *  the group instead of emitting meshes. */
export function capturePlacementRecords(
  group: THREE.Group,
  p: Placements,
  arenaWalls: PendingArenaWalls | null | undefined,
): THREE.Group {
  const records: DungeonPlacementRecord[] = [
    ...p.records,
    ...(arenaWalls?.all.flatMap((wall) => wall.placements.records) ?? []),
  ];
  group.userData.dungeonPlacementRecords = records;
  return group;
}
