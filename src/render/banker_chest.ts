import * as THREE from 'three';
import {
  BANKER_CHEST_HALF_DEPTH,
  BANKER_CHEST_HALF_WIDTH,
  BANKER_CHEST_PLACEMENTS,
  BANKER_CHEST_TARGET_HEIGHT,
  bankerChestCenterWorld,
  resolveBankerChestLocalPlacement,
} from '../sim/banker_chest_layout';
import { bankerChestSpots, isBlocked } from '../sim/colliders';
import { getActiveWorldContent } from '../sim/data';
import type { Entity, NpcDef } from '../sim/types';
import { groundHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  eastbrookMaterialUsesAtlas,
  eastbrookSemanticForMaterial,
  eastbrookSurfaceAtlasMetadata,
  eastbrookSurfaceAtlasTexture,
  eastbrookSurfaceGeometry,
  eastbrookSurfaceMaterial,
} from './eastbrook_surface_atlas';
import { surfaceMat } from './gfx';

// The chest's dimensions, ordered local candidates, and placement resolution
// all live in the sim leaf src/sim/banker_chest_layout.ts: the sim resolves
// the spot ONCE while building the static colliders (the chest is solid and
// standable now), and this module places the mesh from the same record.
const BANKER_CHEST_ASSET_URL = '/models/props/banker_chest.glb';

let loadedBankerChestGltf: THREE.Group | null = null;
let preparedBankerChestTemplate: THREE.Group | null = null;
let fallbackBankerChestTemplate: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(BANKER_CHEST_ASSET_URL).then((gltf) => {
      loadedBankerChestGltf = gltf.scene;
    }),
  );
}

type BankerNpcRef = Pick<Entity, 'kind' | 'templateId'>;
type PlacedBankerNpcRef = BankerNpcRef & Pick<Entity, 'pos' | 'facing'>;
type BankerChestPlacement = Readonly<{
  x: number;
  y: number;
  z: number;
  rotationY: number;
}>;
type BlockedAt = (
  seed: number,
  x: number,
  z: number,
  radius: number,
  ignoreFences: boolean,
) => boolean;
type GroundAt = (x: number, z: number, seed: number) => number;
function resolveBankerChestPlacement(
  entity: PlacedBankerNpcRef,
  worldSeed: number,
  blockedAt: BlockedAt = isBlocked,
  groundAt: GroundAt = groundHeight,
): BankerChestPlacement {
  // Prefer the spot the SIM resolved while building the static colliders:
  // that spot has the solid, standable chest collider on it, so the mesh must
  // stand exactly there. The local fallback covers bankers the sim skipped
  // (a custom world whose banker spawn relocated); those chests keep the old
  // decorative, non-colliding behavior against a chest-free grid.
  const anchor = { pos: entity.pos, facing: entity.facing };
  const spot =
    blockedAt === isBlocked
      ? bankerChestSpots(worldSeed).find(
          (s) => Math.hypot(s.anchorX - entity.pos.x, s.anchorZ - entity.pos.z) < 0.75,
        )
      : undefined;
  const best =
    spot?.localPlacement ?? resolveBankerChestLocalPlacement(anchor, worldSeed, blockedAt);
  const center = bankerChestCenterWorld(anchor, best);
  return {
    ...best,
    y: groundAt(center.x, center.z, worldSeed) - entity.pos.y,
  };
}

function buildChestFromSource(
  source: THREE.Object3D,
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): THREE.Group {
  // The loader cache is immutable. clone(true) gives this view its own transform
  // graph; atlas UVs are added only to cloned geometry.
  const instance = source.clone(true);
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const atlasSource = materials.find((material) => eastbrookMaterialUsesAtlas(material, atlas));
    if (atlasSource) {
      child.geometry = eastbrookSurfaceGeometry(
        child.geometry,
        eastbrookSemanticForMaterial(atlasSource.name),
      );
    }
    const converted = materials.map((material) => eastbrookSurfaceMaterial(material, atlas));
    child.material = Array.isArray(child.material) ? converted : converted[0];
    child.castShadow = true;
    child.receiveShadow = true;
  });

  const initialBounds = new THREE.Box3().setFromObject(instance);
  const initialHeight = initialBounds.max.y - initialBounds.min.y;
  if (initialHeight > 1e-4) {
    instance.scale.multiplyScalar(BANKER_CHEST_TARGET_HEIGHT / initialHeight);
  }
  const seatedBounds = new THREE.Box3().setFromObject(instance);
  instance.position.y -= seatedBounds.min.y;

  const group = new THREE.Group();
  group.add(instance);
  group.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(group, atlas);
  return group;
}

function buildFallbackChest(
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): THREE.Group {
  const group = new THREE.Group();
  const wood = surfaceMat({ color: 0x5a351b, map: atlas, roughness: 0.82, metalness: 0 });
  const iron = surfaceMat({ color: 0x6b5b3e, map: atlas, roughness: 0.52, metalness: 0.7 });
  const parts = [
    new THREE.Mesh(
      eastbrookSurfaceGeometry(new THREE.BoxGeometry(1.5, 0.78, 0.86), 'horizontalWarmTimber'),
      wood,
    ),
    new THREE.Mesh(
      eastbrookSurfaceGeometry(new THREE.BoxGeometry(1.58, 0.48, 0.94), 'horizontalWarmTimber'),
      wood,
    ),
    new THREE.Mesh(
      eastbrookSurfaceGeometry(new THREE.BoxGeometry(0.18, 0.28, 0.05), 'darkForgedMetal'),
      iron,
    ),
  ];
  parts[0].position.y = 0.39;
  parts[1].position.y = 1.02;
  parts[2].position.set(0, 0.88, 0.495);
  for (const part of parts) {
    part.castShadow = true;
    part.receiveShadow = true;
    group.add(part);
  }
  group.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(group, atlas);
  return group;
}

function buildBankerChest(): THREE.Group {
  const atlas = eastbrookSurfaceAtlasTexture();
  if (loadedBankerChestGltf && !preparedBankerChestTemplate) {
    preparedBankerChestTemplate = buildChestFromSource(loadedBankerChestGltf, atlas);
  }
  if (!loadedBankerChestGltf && !fallbackBankerChestTemplate) {
    fallbackBankerChestTemplate = buildFallbackChest(atlas);
  }
  const template = preparedBankerChestTemplate ?? fallbackBankerChestTemplate;
  const chest = template?.clone(true) ?? new THREE.Group();
  chest.name = 'bankerChestDecoration';
  chest.userData.decorative = true;
  chest.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(chest, atlas);
  return chest;
}

export function isBankerNpcForRender(
  entity: BankerNpcRef,
  npcDefs: Readonly<Record<string, NpcDef>> = getActiveWorldContent().npcs,
): boolean {
  if (entity.kind !== 'npc') return false;
  const direct = npcDefs[entity.templateId];
  const definition =
    direct?.id === entity.templateId
      ? direct
      : Object.values(npcDefs).find((npc) => npc.id === entity.templateId);
  return definition?.banker === true;
}

/** Adds a cosmetic sibling of the live NPC rig. It is deliberately not returned
 * to the renderer as a click target and does not participate in height math. */
export function attachBankerChestToNpcView(
  viewGroup: THREE.Group,
  entity: PlacedBankerNpcRef,
  worldSeed: number,
  npcDefs?: Readonly<Record<string, NpcDef>>,
): THREE.Group | null {
  if (!isBankerNpcForRender(entity, npcDefs)) return null;
  const chest = buildBankerChest();
  const placement = resolveBankerChestPlacement(entity, worldSeed);
  chest.position.set(placement.x, placement.y, placement.z);
  chest.rotation.y = placement.rotationY;
  viewGroup.add(chest);
  return chest;
}

/** Test-only window into preload and immutable placement metadata. */
export const bankerChestPreloadInternalsForTest = {
  bankerChestAssetUrl: BANKER_CHEST_ASSET_URL,
  targetHeight: BANKER_CHEST_TARGET_HEIGHT,
  halfWidth: BANKER_CHEST_HALF_WIDTH,
  halfDepth: BANKER_CHEST_HALF_DEPTH,
  placements: BANKER_CHEST_PLACEMENTS,
  buildChestFromSource,
  resolveBankerChestPlacement,
};
