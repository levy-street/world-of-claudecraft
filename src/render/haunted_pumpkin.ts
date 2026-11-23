import * as THREE from 'three';
import { GOURDLIGHT_EVE_ID } from '../sim/content/gourdlight_eve';
import { hauntedPumpkinForEntity } from '../sim/seasonal';
import type { Entity } from '../sim/types';
import type { IWorld } from '../world_api';
import {
  HAUNTED_PUMPKIN_HEIGHT,
  HAUNTED_PUMPKIN_SCALE,
  hauntedPumpkinGlow,
} from './haunted_pumpkin_core';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { gourdlightAssets, type SeasonalPart } from './seasonal_decor_assets';
import { markOwnedMaterial, markSharedGeometry } from './shared_resource';
import type { Vfx } from './vfx';

type GlowMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
interface PumpkinState {
  found: boolean | null;
  materials: GlowMaterial[];
}
const states = new WeakMap<THREE.Object3D, PumpkinState>();
type DiscoveryVfx = Pick<Vfx, 'burst' | 'burstLater' | 'buffSwirl'>;
const discoveryPosition = new THREE.Vector3();

/** Reuses the already-prewarmed particle atlas and bounded Vfx pools. The
 * layered ignition has an amber flame core, spectral wisps circling upward,
 * then a delayed shower of embers, each lifted with the pumpkin's size so the
 * flame still sits in its cavity. No new materials, textures or lights. */
function ignitePumpkin(vfx: DiscoveryVfx, entity: Entity): void {
  const s = HAUNTED_PUMPKIN_SCALE;
  discoveryPosition.set(entity.pos.x, entity.pos.y + 0.28 * s, entity.pos.z);
  vfx.burst(discoveryPosition, 'fire', 32, 0.65, 0xff8a22, 0.7);
  vfx.buffSwirl(entity.id, 0x81efbc);
  vfx.burstLater(
    0.12,
    entity.pos.x,
    entity.pos.y + 0.45 * s,
    entity.pos.z,
    'arcane',
    22,
    0.45,
    0x81efbc,
  );
  vfx.burstLater(
    0.28,
    entity.pos.x,
    entity.pos.y + 0.62 * s,
    entity.pos.z,
    'holy',
    16,
    0.35,
    0xffba57,
  );
}

/** Independent materials: discovery must never light another player's pumpkin
 * or modify the city's shared, flickering candles. Geometry stays kit-owned.
 * The whole group is scaled up (HAUNTED_PUMPKIN_SCALE), so the pick volume and
 * the nameplate height grow with it and the kit geometry stays untouched.
 * The renderer gates this complete object through its existing live-view gate. */
export function buildHauntedPumpkinParts(parts: readonly SeasonalPart[]) {
  const group = new THREE.Group();
  group.name = 'haunted-pumpkin';
  group.scale.setScalar(HAUNTED_PUMPKIN_SCALE);
  const materials: GlowMaterial[] = [];
  const clones = new Map<THREE.Material, THREE.Material>();
  for (const part of parts) {
    let material = clones.get(part.material);
    if (!material) {
      material = markOwnedMaterial(cloneMaterialWithHooks(part.material));
      // The seasonal kit's shape patch is closure-only (no material bindings).
      // Preserve its full shape+haze chain and exact program identity too.
      material.onBeforeCompile = part.material.onBeforeCompile;
      material.customProgramCacheKey = part.material.customProgramCacheKey;
      clones.set(part.material, material);
      if (
        material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshLambertMaterial
      ) {
        material.emissiveIntensity = 0;
        materials.push(material);
      }
    }
    const mesh = new THREE.Mesh(markSharedGeometry(part.geometry), material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  states.set(group, { found: null, materials });
  return { group, height: HAUNTED_PUMPKIN_HEIGHT };
}

/** No event, no fetch. A cold kit is retried by the normal missing-view scan. */
export function buildHauntedPumpkin(
  world: Pick<IWorld, 'activeSeasonalEvent' | 'hauntedPumpkinsFound'>,
  entity: Entity,
) {
  if (world.activeSeasonalEvent !== GOURDLIGHT_EVE_ID) return null;
  const assets = gourdlightAssets();
  if (!assets || assets.decor.pumpkin_lit.length === 0) return null;
  const built = buildHauntedPumpkinParts(assets.decor.pumpkin_lit);
  syncHauntedPumpkin(built.group, world, entity);
  return built;
}

export function syncHauntedPumpkin(
  group: THREE.Object3D,
  world: Pick<IWorld, 'hauntedPumpkinsFound'>,
  entity: Entity,
  time = 0,
  reducedMotion = false,
  vfx?: DiscoveryVfx,
): void {
  const state = states.get(group);
  if (!state) return;
  const pumpkin = hauntedPumpkinForEntity(entity);
  const found = pumpkin !== undefined && world.hauntedPumpkinsFound.includes(pumpkin.id);
  if (found && state.found === false && !reducedMotion && vfx) ignitePumpkin(vfx, entity);
  state.found = found;
  // Written every frame in both states: the beacon breathes until found, the
  // candle flickers after. A handful of scalar writes per visible pumpkin.
  for (const material of state.materials) {
    material.emissiveIntensity = hauntedPumpkinGlow(material.name, found, time, reducedMotion);
  }
}
