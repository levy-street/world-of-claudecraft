import type * as THREE from 'three';
import { IGNIVAR_BRAND_AURA_ID } from '../sim/encounters/ignivar';
import {
  VARKHUL_BOSS_ID,
  VARKHUL_CINDER_ORBS_AURA_ID,
  VARKHUL_MAKERS_BRAND_AURA_ID,
} from '../sim/encounters/varkhul';
import { IGNIVAR_FORGE_CHAINS_AURA_ID } from '../sim/ignivar_forge_chains';
import { IGNIVAR_BOSS_ID } from '../sim/types';
import { VARKHUL_SHARED_PYRE_AURA_ID } from '../sim/varkhul_shared_pyre';
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

/** The player auras whose telegraphs the two encounter syncs attach to a
 *  player rig (each sync's own plan reads exactly these ids). */
const RAID_TELEGRAPH_PLAYER_AURA_IDS: ReadonlySet<string> = new Set([
  IGNIVAR_BRAND_AURA_ID,
  IGNIVAR_FORGE_CHAINS_AURA_ID,
  VARKHUL_CINDER_ORBS_AURA_ID,
  VARKHUL_MAKERS_BRAND_AURA_ID,
  VARKHUL_SHARED_PYRE_AURA_ID,
]);

/** userData mark on a group the encounter syncs have run on: it may carry
 *  telegraph children, so it keeps its per-frame sync until it is disposed
 *  (a pooled group is disposed before its next tenant). */
const RAID_TELEGRAPH_SYNCED_KEY = 'raidTelegraphSynced';

/**
 * Whether the encounter syncs would attach or drive a telegraph for this
 * entity right now: a raid boss (its telegraphs are attached on sight and
 * its body lock and model VFX ride the same sync) or a player carrying one of
 * the encounter marks. Everything else has nothing to sync, and the syncs
 * themselves are several recursive getObjectByName walks of the rig, so a rig
 * outside an encounter must not pay them every frame.
 */
export function raidEncounterEntityWantsTelegraph(entity: RaidEncounterEntity): boolean {
  if (entity.templateId === IGNIVAR_BOSS_ID || entity.templateId === VARKHUL_BOSS_ID) return true;
  if (entity.kind !== 'player') return false;
  for (const aura of entity.auras) {
    if (RAID_TELEGRAPH_PLAYER_AURA_IDS.has(aura.id)) return true;
  }
  return false;
}

function raidEncounterGroupNeedsSync(group: THREE.Group, entity: RaidEncounterEntity): boolean {
  if (group.userData[RAID_TELEGRAPH_SYNCED_KEY] === true) return true;
  if (!raidEncounterEntityWantsTelegraph(entity)) return false;
  group.userData[RAID_TELEGRAPH_SYNCED_KEY] = true;
  return true;
}

export function disposeRaidEncounterVisuals(group: THREE.Group): void {
  disposeIgnivarEncounterVisuals(group);
  disposeVarkhulEncounterVisuals(group);
  delete group.userData[RAID_TELEGRAPH_SYNCED_KEY];
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
    // A culling-bypass mark is one of the telegraph marks, so the group is
    // marked here for the rig sync that takes over once the body exists.
    group.userData[RAID_TELEGRAPH_SYNCED_KEY] = true;
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
  // A rig that never entered an encounter walks nothing (the syncs and the
  // visible-telegraph check below are recursive rig walks).
  if (!raidEncounterGroupNeedsSync(group, entity)) return;
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
