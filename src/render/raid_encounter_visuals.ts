import type * as THREE from 'three';
import {
  disposeIgnivarEncounterVisuals,
  hasVisibleIgnivarEncounterTelegraph,
  syncIgnivarEncounterVisuals,
  syncIgnivarPlayerChainVisual,
} from './ignivar_encounter';
import {
  type IgnivarVisualEntity,
  ignivarEncounterBypassesCharacterCulling,
  ignivarEncounterViewVisibleDuringCompile,
} from './ignivar_encounter_core';
import type {
  IgnivarForgeChainVisualPosition,
  IgnivarForgeChainVisualView,
} from './ignivar_forge_chains';
import {
  disposeVarkhulEncounterVisuals,
  hasVisibleVarkhulEncounterTelegraph,
  syncVarkhulEncounterVisuals,
} from './varkhul_encounter';
import {
  varkhulEncounterBypassesCharacterCulling,
  varkhulEncounterViewVisibleDuringCompile,
} from './varkhul_encounter_core';
import type { Vfx } from './vfx';

type RaidEncounterEntity = IgnivarVisualEntity & {
  pos?: { x: number; z: number };
  dead?: boolean;
};

export function disposeRaidEncounterVisuals(group: THREE.Group): void {
  disposeIgnivarEncounterVisuals(group);
  disposeVarkhulEncounterVisuals(group);
}

export function hasVisibleRaidEncounterTelegraph(group: THREE.Group): boolean {
  return hasVisibleIgnivarEncounterTelegraph(group) || hasVisibleVarkhulEncounterTelegraph(group);
}

export function raidEncounterBypassesCharacterCulling(entity: RaidEncounterEntity): boolean {
  return (
    ignivarEncounterBypassesCharacterCulling(entity) ||
    varkhulEncounterBypassesCharacterCulling(entity)
  );
}

export function raidEncounterViewVisibleDuringCompile(
  entity: RaidEncounterEntity,
  compilePending: boolean,
): boolean {
  return (
    ignivarEncounterViewVisibleDuringCompile(entity.templateId, compilePending) ||
    varkhulEncounterViewVisibleDuringCompile(entity, compilePending)
  );
}

export function syncRaidEncounterVisuals(
  group: THREE.Group,
  entity: RaidEncounterEntity,
  dt = 0,
  vfx?: Vfx,
  bodyRoot?: THREE.Object3D,
  syncModelVfx = true,
  chainViews?: ReadonlyMap<number, { group: THREE.Group }>,
  encounterEntities?: ReadonlyMap<number, RaidEncounterEntity>,
  reducedMotion = false,
): void {
  syncIgnivarEncounterVisuals(
    group,
    entity,
    dt,
    vfx,
    bodyRoot,
    syncModelVfx,
    chainViews,
    encounterEntities,
    reducedMotion,
  );
  syncVarkhulEncounterVisuals(group, entity, dt, reducedMotion, encounterEntities);
}

/**
 * The per-entity raid overlays the renderer runs BEFORE its rig branch: the
 * actionable Ignivar player chain always (it must survive a still-compiling
 * body), plus, for a view with no character rig, the culling-bypass telegraph
 * sync so a marked player's overlay never vanishes with its unbuilt body.
 * Moved verbatim from the renderer's entity loop.
 */
export function syncRaidEncounterAnchorVisuals(
  group: THREE.Group,
  entity: RaidEncounterEntity,
  views: ReadonlyMap<number, IgnivarForgeChainVisualView>,
  dt: number,
  vfx: Vfx,
  entities: ReadonlyMap<number, RaidEncounterEntity & IgnivarForgeChainVisualPosition>,
  reducedMotion: boolean,
  hasCharacterRig: boolean,
): void {
  syncIgnivarPlayerChainVisual(group, entity, views, dt, entities, reducedMotion);
  if (!hasCharacterRig && raidEncounterBypassesCharacterCulling(entity)) {
    syncRaidEncounterVisuals(
      group,
      entity,
      dt,
      vfx,
      undefined,
      false,
      undefined,
      entities,
      reducedMotion,
    );
  }
}

/**
 * The rig-attached telegraph sync: runs whenever character presentation work
 * runs, and also while a live telegraph is still visible on a culled body so
 * an off-screen mark keeps animating (the telegraph itself can be on screen).
 * Moved verbatim from the renderer's entity loop.
 */
export function syncRaidEncounterRigVisuals(
  group: THREE.Group,
  entity: RaidEncounterEntity,
  dt: number,
  vfx: Vfx,
  bodyRoot: THREE.Object3D,
  // The renderer passes its frustum verdict here: an off-screen body keeps
  // its rig-attached model VFX asleep while the telegraphs stay live.
  syncModelVfx: boolean,
  runPresentation: boolean,
  entities: ReadonlyMap<number, RaidEncounterEntity>,
  reducedMotion: boolean,
): void {
  if (!runPresentation && !hasVisibleRaidEncounterTelegraph(group)) return;
  syncRaidEncounterVisuals(
    group,
    entity,
    dt,
    vfx,
    bodyRoot,
    syncModelVfx,
    undefined,
    entities,
    reducedMotion,
  );
}
