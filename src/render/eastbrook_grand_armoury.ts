import * as THREE from 'three';
import { buildingTerrainEnvelope, isEastbrookGrandArmoury } from '../sim/building_layout';
import type { BuildingDef } from '../sim/types';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import {
  eastbrookMaterialUsesAtlas,
  eastbrookSemanticForMaterial,
  eastbrookSurfaceAtlasMetadata,
  eastbrookSurfaceAtlasTexture,
  eastbrookSurfaceGeometry,
  eastbrookSurfaceMaterial,
} from './eastbrook_surface_atlas';

const ASSET_URL = '/models/props/eastbrook_grand_armoury.glb';
const FOUNDATION_SKIRT_OVERLAP = 0.03;
const FOUNDATION_SKIRT_COLOR = 0x46505e;

let loadedSource: THREE.Group | null = null;
let preparedTemplate: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  registerPreload(
    loadGltf(ASSET_URL).then((gltf) => {
      loadedSource = gltf.scene;
    }),
  );
}

type GroundAt = (x: number, z: number) => number;

export interface EastbrookGrandArmouryPlacement {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
  cameraTopY: number;
  entranceGroundY: number;
  minGroundY: number;
  maxGroundY: number;
  foundationSkirtDepth: number;
}

export interface EastbrookGrandArmouryView {
  group: THREE.Group;
  cameraTopY: number;
}

function materialIsEmissive(material: THREE.Material): boolean {
  const standard = material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
  return (
    material.name.toLowerCase().includes('emissive') ||
    (standard.emissive !== undefined && standard.emissive.getHex() !== 0)
  );
}

function buildArmouryFromSource(
  source: THREE.Object3D,
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): THREE.Group {
  // The loader cache is immutable. The view gets an independent transform graph
  // and atlas-ready geometry while leaving decoded source buffers untouched.
  const instance = source.clone(true);
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const atlasSource = sourceMaterials.find((material) =>
      eastbrookMaterialUsesAtlas(material, atlas),
    );
    if (atlasSource) {
      child.geometry = eastbrookSurfaceGeometry(
        child.geometry,
        eastbrookSemanticForMaterial(atlasSource.name),
      );
    }
    const converted = sourceMaterials.map((material) => eastbrookSurfaceMaterial(material, atlas));
    child.material = Array.isArray(child.material) ? converted : converted[0];
    child.castShadow = converted.some((material) => !materialIsEmissive(material));
    child.receiveShadow = true;
    child.frustumCulled = true;
  });

  const group = new THREE.Group();
  group.name = 'eastbrookGrandArmoury';
  group.userData.decorative = false;
  group.userData.closedInterior = true;
  group.userData.landmark = 'eastbrook_grand_armoury';
  group.add(instance);
  group.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(group, atlas);
  return group;
}

function armouryTemplate(): THREE.Group {
  if (!preparedTemplate) {
    if (!loadedSource) throw new Error('Eastbrook Grand Armoury asset was not preloaded');
    preparedTemplate = buildArmouryFromSource(loadedSource, eastbrookSurfaceAtlasTexture());
    loadedSource = null;
    releaseGltf(ASSET_URL);
  }
  return preparedTemplate;
}

function stoneMaterialForArmoury(root: THREE.Object3D): THREE.Material {
  let stone: THREE.Material | null = null;
  root.traverse((child) => {
    if (stone || !(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    stone = materials.find((material) => material.name === 'ArmouryStone') ?? null;
  });
  if (!stone) throw new Error('Eastbrook Grand Armoury is missing its stone material');
  return stone;
}

function addAdaptiveFoundationSkirt(
  group: THREE.Group,
  building: BuildingDef,
  depth: number,
): THREE.Mesh | null {
  if (depth <= 1e-4) return null;

  const height = depth + FOUNDATION_SKIRT_OVERLAP;
  let geometry: THREE.BufferGeometry = new THREE.BoxGeometry(building.w, height, building.d);
  const positionCount = geometry.getAttribute('position').count;
  const tint = new THREE.Color(FOUNDATION_SKIRT_COLOR);
  const colors = new Float32Array(positionCount * 3);
  for (let index = 0; index < positionCount; index++) {
    colors[index * 3] = tint.r;
    colors[index * 3 + 1] = tint.g;
    colors[index * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const stone = stoneMaterialForArmoury(group);
  if (stone.userData.eastbrookSurfaceAtlas) {
    geometry = eastbrookSurfaceGeometry(geometry, 'darkStoneBlocks');
  }

  const skirt = new THREE.Mesh(geometry, stone);
  skirt.name = 'eastbrookGrandArmouryFoundationSkirt';
  skirt.position.y = (FOUNDATION_SKIRT_OVERLAP - depth) / 2;
  skirt.castShadow = true;
  skirt.receiveShadow = true;
  skirt.frustumCulled = true;
  skirt.userData.adaptiveFoundation = true;
  group.add(skirt);
  return skirt;
}

export function placementForEastbrookGrandArmoury(
  building: BuildingDef,
  groundAt: GroundAt,
): EastbrookGrandArmouryPlacement {
  if (!isEastbrookGrandArmoury(building)) {
    throw new Error('Eastbrook Grand Armoury placement requires its authored landmark building');
  }
  const terrain = buildingTerrainEnvelope(building, groundAt);
  return {
    x: building.x,
    y: terrain.modelBottomY,
    z: building.z,
    rotationY: building.rot,
    scale: 1,
    cameraTopY: terrain.cameraTopY,
    entranceGroundY: terrain.entranceGroundY,
    minGroundY: terrain.minGroundY,
    maxGroundY: terrain.maxGroundY,
    foundationSkirtDepth: terrain.foundationSkirtDepth,
  };
}

/** Build one static landmark view for the authored building record. */
export function buildEastbrookGrandArmouryView(
  building: BuildingDef,
  groundAt: GroundAt,
): EastbrookGrandArmouryView | null {
  if (!isEastbrookGrandArmoury(building)) return null;
  const placement = placementForEastbrookGrandArmoury(building, groundAt);
  const group = armouryTemplate().clone(true);
  const skirt = addAdaptiveFoundationSkirt(group, building, placement.foundationSkirtDepth);
  const atlas = eastbrookSurfaceAtlasTexture();
  group.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(group, atlas);
  group.userData.foundationSkirtDepth = placement.foundationSkirtDepth;
  group.userData.foundationSkirtDraws = skirt ? 1 : 0;
  group.position.set(placement.x, placement.y, placement.z);
  group.rotation.y = placement.rotationY;
  group.scale.setScalar(placement.scale);
  return { group, cameraTopY: placement.cameraTopY };
}

/** Test-only access to the immutable asset and placement contract. */
export const eastbrookGrandArmouryInternalsForTest = {
  assetUrl: ASSET_URL,
  buildArmouryFromSource,
  buildView: buildEastbrookGrandArmouryView,
  addAdaptiveFoundationSkirt,
  materialIsEmissive,
  placementForBuilding: placementForEastbrookGrandArmoury,
};
