import * as THREE from 'three';
import { isBlocked } from '../sim/colliders';
import { getActiveWorldContent } from '../sim/data';
import type { Entity, NpcDef } from '../sim/types';
import { groundHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import {
  eastbrookMaterialUsesAtlas,
  eastbrookSemanticForMaterial,
  eastbrookSurfaceAtlasMetadata,
  eastbrookSurfaceAtlasTexture,
  eastbrookSurfaceGeometry,
  eastbrookSurfaceMaterial,
} from './eastbrook_surface_atlas';
import { surfaceMat } from './gfx';

const BANKER_CHEST_ASSET_URL = '/models/props/banker_chest.glb';
const BANKER_CHEST_TARGET_HEIGHT = 1.3;
const BANKER_CHEST_HALF_WIDTH = 1.09;
const BANKER_CHEST_HALF_DEPTH = 0.65;
const BANKER_CHEST_SAMPLE_COLUMNS = 9;
const BANKER_CHEST_SAMPLE_ROWS = 5;

// Local +z is the NPC's forward/approach direction. Keep the decoration behind
// and to one side when space permits so the banker remains the clear target.
// The ordered alternatives let cramped authored or custom-world locations use
// the other side, then a front-side position, without moving into the banker.
const BANKER_CHEST_PLACEMENTS = Object.freeze([
  Object.freeze({ x: 1.15, y: 0, z: -0.7, rotationY: 0 }),
  Object.freeze({ x: -1.15, y: 0, z: -0.7, rotationY: 0 }),
  Object.freeze({ x: 1.15, y: 0, z: 0.7, rotationY: 0 }),
  Object.freeze({ x: -1.15, y: 0, z: 0.7, rotationY: 0 }),
]);

let loadedBankerChestGltf: THREE.Group | null = null;
let preparedBankerChestTemplate: THREE.Group | null = null;
let fallbackBankerChestTemplate: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  registerPreload(
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
function placementCenterWorld(
  entity: PlacedBankerNpcRef,
  placement: BankerChestPlacement,
): { x: number; z: number } {
  const facingCos = Math.cos(entity.facing);
  const facingSin = Math.sin(entity.facing);
  return {
    x: entity.pos.x + placement.x * facingCos + placement.z * facingSin,
    z: entity.pos.z - placement.x * facingSin + placement.z * facingCos,
  };
}

function blockedSampleCount(
  entity: PlacedBankerNpcRef,
  worldSeed: number,
  placement: BankerChestPlacement,
  blockedAt: BlockedAt,
  bestSoFar: number,
): number {
  const facingCos = Math.cos(entity.facing);
  const facingSin = Math.sin(entity.facing);
  const localCos = Math.cos(placement.rotationY);
  const localSin = Math.sin(placement.rotationY);
  let blocked = 0;

  for (let column = 0; column < BANKER_CHEST_SAMPLE_COLUMNS; column++) {
    const across =
      -BANKER_CHEST_HALF_WIDTH +
      (2 * BANKER_CHEST_HALF_WIDTH * column) / (BANKER_CHEST_SAMPLE_COLUMNS - 1);
    for (let row = 0; row < BANKER_CHEST_SAMPLE_ROWS; row++) {
      const depth =
        -BANKER_CHEST_HALF_DEPTH +
        (2 * BANKER_CHEST_HALF_DEPTH * row) / (BANKER_CHEST_SAMPLE_ROWS - 1);
      const localX = placement.x + across * localCos + depth * localSin;
      const localZ = placement.z - across * localSin + depth * localCos;
      const worldX = entity.pos.x + localX * facingCos + localZ * facingSin;
      const worldZ = entity.pos.z - localX * facingSin + localZ * facingCos;
      if (blockedAt(worldSeed, worldX, worldZ, 0, false)) {
        blocked++;
        if (blocked >= bestSoFar) return blocked;
      }
    }
  }
  return blocked;
}

function resolveBankerChestPlacement(
  entity: PlacedBankerNpcRef,
  worldSeed: number,
  blockedAt: BlockedAt = isBlocked,
  groundAt: GroundAt = groundHeight,
): BankerChestPlacement {
  let best = BANKER_CHEST_PLACEMENTS[0];
  let bestBlocked = Number.POSITIVE_INFINITY;
  for (const placement of BANKER_CHEST_PLACEMENTS) {
    const blocked = blockedSampleCount(entity, worldSeed, placement, blockedAt, bestBlocked);
    if (blocked < bestBlocked) {
      best = placement;
      bestBlocked = blocked;
      if (blocked === 0) break;
    }
  }
  const center = placementCenterWorld(entity, best);
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
