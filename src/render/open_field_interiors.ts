// The open-field interiors: instance bands whose scenery is a builder of its
// own (sunlit fields under the sky dome) rather than the room-kit layout path
// of dungeon.ts. The dungeon builder asks here first and attaches whatever
// comes back through attachOpenFieldInterior, behind its compile gate, so a new
// field is one row, never a new branch in the coordinator.
//
// The Fire and Fly arena is prebuilt hidden at its instructor
// (fire_and_fly_arena_prebuild.ts), so the copy the player lands in links as a
// cache hit. An entry with no intent before it (the dev command teleports and
// seats in one tick) still links here, so a field with a stand-in shows it
// first: its first child reveals on its own gate, one program queued ahead of
// the rest, so the player lands on that ground rather than above an empty sky
// while the trees and the cover link.

import type * as THREE from 'three';
import { buildFireAndFlyArenaInterior } from './fire_and_fly_arena';
import { FIRE_AND_FLY_INTERIOR } from './fire_and_fly_arena_core';
import { attachSceneGroupGated } from './gated_scene_attach';
import { disposeGhostHideGeometry, ghostHideAttribute } from './instanced_dither_fade';
import type { OwnedInteriorResourceRegistry } from './interior_resource_lifecycle';
import { buildWildheartFieldInterior, type WildheartFieldInteriorDeps } from './wildheart_props';

/** What an open-field builder may borrow from the dungeon builder, plus the
 *  slot origin the returned group is seated at. */
export interface OpenFieldInteriorDeps extends WildheartFieldInteriorDeps {
  origin: { x: number; z: number };
}

export interface OpenFieldInterior {
  /** Builds the field, seated at the slot origin. */
  build(deps: OpenFieldInteriorDeps): THREE.Group;
  /** The group's first child reveals on its own gate ahead of the rest. */
  standInFirst: boolean;
}

function row(
  build: (deps: OpenFieldInteriorDeps) => THREE.Group,
  standInFirst: boolean,
): OpenFieldInterior {
  return {
    build: (deps) => {
      const group = build(deps);
      group.position.set(deps.origin.x, 0, deps.origin.z);
      group.userData.renderCategory = 'dungeon';
      return group;
    },
    standInFirst,
  };
}

const OPEN_FIELDS: Readonly<Record<string, OpenFieldInterior>> = {
  wildheart: row(buildWildheartFieldInterior, false),
  [FIRE_AND_FLY_INTERIOR]: row(buildFireAndFlyArenaInterior, true),
};

/** The open field of an interior id, or null for a room-kit interior. */
export function openFieldInteriorBuilder(interior: string): OpenFieldInterior | null {
  return Object.hasOwn(OPEN_FIELDS, interior) ? OPEN_FIELDS[interior] : null;
}

/**
 * What one field owns: its batches' per-build instance buffers and the
 * ghost-hide shells over the open world's parts. Everything else it draws is a
 * page-lifetime cache or borrowed from the open world, never released with a
 * slot.
 */
export function collectOpenFieldResources(
  group: THREE.Object3D,
  registry: OwnedInteriorResourceRegistry,
): void {
  group.traverse((node) => {
    const mesh = node as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    registry.add(mesh);
    if (!ghostHideAttribute(mesh)) return;
    const shell = mesh.geometry;
    registry.add({ dispose: () => disposeGhostHideGeometry(shell) });
  });
}

/** Attach a built field behind the compile gate; resolves once all of it shows. */
export async function attachOpenFieldInterior(
  scene: { add(object: THREE.Object3D): unknown },
  group: THREE.Group,
  field: OpenFieldInterior,
  compileGate: ((target: THREE.Object3D) => Promise<unknown>) | undefined,
  registry: OwnedInteriorResourceRegistry,
): Promise<void> {
  collectOpenFieldResources(group, registry);
  const cancelled = () => registry.isRetired;
  const [standIn, ...rest] = group.children;
  if (!field.standInFirst || !compileGate || !standIn) {
    await attachSceneGroupGated(scene, group, compileGate, cancelled);
    return;
  }
  // The group shows on the stand-in's link alone; each other root stays
  // hidden behind its own gate until its programs link.
  const shown = attachSceneGroupGated(scene, group, () => compileGate(standIn), cancelled);
  const dressed = rest.map((root) => attachSceneGroupGated(group, root, compileGate, cancelled));
  await Promise.all([shown, ...dressed]);
}
