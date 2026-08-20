import type * as THREE from 'three';
import {
  disposeIgnivarEncounterVisuals,
  hasVisibleIgnivarEncounterTelegraph,
  syncIgnivarEncounterVisuals,
} from './ignivar_encounter';
import {
  type IgnivarVisualEntity,
  ignivarEncounterBypassesCharacterCulling,
  ignivarEncounterViewVisibleDuringCompile,
} from './ignivar_encounter_core';
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
  syncVarkhulEncounterVisuals(group, entity);
}
