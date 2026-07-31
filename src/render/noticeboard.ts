// Eastbrook's future-facing civic noticeboard. The gameplay interaction stays
// in sim/content; this module owns only the stable visual GLB and its fallback.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  type EastbrookSurfaceSemantic,
  eastbrookSurfaceAtlasMetadata,
  eastbrookSurfaceAtlasTexture,
  eastbrookSurfaceGeometry,
  eastbrookSurfaceMaterial,
  eastbrookTownSemanticForColor,
} from './eastbrook_surface_atlas';
import { GFX, surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const NOTICEBOARD_ASSET_URL = '/models/props/eastbrook_noticeboard.glb';
const NOTICEBOARD_TARGET_WIDTH = 2.4;
const NOTICEBOARD_TARGET_HEIGHT = 2.6;
const NOTICEBOARD_TARGET_DEPTH = 0.6;
const NOTICEBOARD_FRONT = Object.freeze([0, 0, 1] as const);
const NOTICEBOARD_SOCKETS = Object.freeze(['Socket_Interaction', 'Socket_Notices'] as const);

let loadedNoticeboardGltf: GLTF | null = null;
let preparedNoticeboardTemplate: THREE.Group | null = null;
let fallbackNoticeboardTemplate: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(NOTICEBOARD_ASSET_URL).then((gltf) => {
      loadedNoticeboardGltf = gltf;
    }),
  );
}

function materialTint(material: THREE.Material): THREE.Color {
  return (
    (material as THREE.Material & { color?: THREE.Color }).color?.clone() ??
    new THREE.Color(1, 1, 1)
  );
}

function atlasGeometry(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.BufferGeometry {
  const color = geometry.getAttribute('color');
  const tint = materialTint(material);
  return eastbrookSurfaceGeometry(geometry, (index) =>
    eastbrookTownSemanticForColor(
      (color?.getX(index) ?? 1) * tint.r,
      (color?.getY(index) ?? 1) * tint.g,
      (color?.getZ(index) ?? 1) * tint.b,
    ),
  );
}

function normalizeNoticeboard(instance: THREE.Object3D): void {
  const initialBounds = new THREE.Box3().setFromObject(instance);
  const initialHeight = initialBounds.max.y - initialBounds.min.y;
  if (initialHeight > 1e-4) {
    instance.scale.multiplyScalar(NOTICEBOARD_TARGET_HEIGHT / initialHeight);
  }
  const seatedBounds = new THREE.Box3().setFromObject(instance);
  const center = seatedBounds.getCenter(new THREE.Vector3());
  instance.position.x -= center.x;
  instance.position.y -= seatedBounds.min.y;
  instance.position.z -= center.z;
}

function setRootMetadata(
  group: THREE.Group,
  atlas: THREE.Texture | undefined,
  source: 'procedural-glb' | 'procedural-fallback',
): void {
  group.userData.assetUrl = NOTICEBOARD_ASSET_URL;
  group.userData.noticeboardAssetUrl = NOTICEBOARD_ASSET_URL;
  group.userData.source = source;
  group.userData.noticeboardFront = [...NOTICEBOARD_FRONT];
  group.userData.noticeboardSockets = [...NOTICEBOARD_SOCKETS];
  group.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(group, atlas);
}

export function buildNoticeboardFromSource(
  source: THREE.Object3D,
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): THREE.Group {
  // Loader cache results are immutable. The prepared template owns cloned,
  // atlas-adapted geometry while all view clones share those final resources.
  const instance = source.clone(true);
  instance.name = 'eastbrookNoticeboardBody';
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (Array.isArray(child.material)) {
      throw new Error('Eastbrook noticeboard GLB must use one material per mesh');
    }
    child.geometry = markSharedGeometry(atlasGeometry(child.geometry, child.material));
    child.material = markSharedMaterial(eastbrookSurfaceMaterial(child.material, atlas));
    child.castShadow = child.material.name === 'EastbrookNoticeboardSurface';
    child.receiveShadow = true;
  });
  normalizeNoticeboard(instance);

  const group = new THREE.Group();
  group.name = 'eastbrookNoticeboardTemplate';
  group.add(instance);
  setRootMetadata(group, atlas, 'procedural-glb');
  return group;
}

function fallbackMaterial(
  color: number,
  atlas: THREE.Texture | undefined,
  options: { roughness: number; metalness: number },
): THREE.Material {
  return markSharedMaterial(
    surfaceMat({
      color,
      map: atlas,
      roughness: options.roughness,
      metalness: options.metalness,
      flatShading: !GFX.standardMaterials,
    }),
  );
}

function fallbackMesh(
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  semantic: EastbrookSurfaceSemantic,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    markSharedGeometry(eastbrookSurfaceGeometry(new THREE.BoxGeometry(...size), semantic)),
    material,
  );
  mesh.position.fromArray(position);
  mesh.castShadow = semantic !== 'warmGoldMetal';
  mesh.receiveShadow = true;
  return mesh;
}

function buildFallbackNoticeboard(
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'eastbrookNoticeboardTemplate';
  const stone = fallbackMaterial(0x555b61, atlas, { roughness: 0.94, metalness: 0 });
  const timber = fallbackMaterial(0x33251c, atlas, { roughness: 0.86, metalness: 0 });
  const roof = fallbackMaterial(0x153b88, atlas, { roughness: 0.8, metalness: 0 });
  const parchment = fallbackMaterial(0xd6c29a, atlas, { roughness: 0.92, metalness: 0 });
  const gold = fallbackMaterial(0xb48335, atlas, { roughness: 0.48, metalness: 0.62 });

  for (const x of [-0.96, 0.96]) {
    group.add(fallbackMesh([0.42, 0.34, 0.42], [x, 0.17, 0], 'mediumGrayStone', stone));
    group.add(fallbackMesh([0.18, 2.08, 0.18], [x, 1.38, 0], 'verticalDarkTimber', timber));
    group.add(fallbackMesh([0.24, 0.18, 0.24], [x, 2.51, 0], 'warmGoldMetal', gold));
  }
  group.add(fallbackMesh([1.82, 1.02, 0.14], [0, 1.49, 0.01], 'horizontalWarmTimber', timber));
  group.add(fallbackMesh([2.4, 0.24, 0.6], [0, 2.18, 0], 'cobaltRoofShingles', roof));
  for (const [x, y] of [
    [-0.48, 1.63],
    [-0.12, 1.48],
    [0.27, 1.67],
    [0.57, 1.38],
  ] as const) {
    group.add(fallbackMesh([0.3, 0.38, 0.02], [x, y, 0.1], 'blueCreamCanvas', parchment));
  }
  for (const name of NOTICEBOARD_SOCKETS) {
    const socket = new THREE.Object3D();
    socket.name = name;
    socket.position.set(
      0,
      name === 'Socket_Interaction' ? 1.3 : 1.51,
      name === 'Socket_Interaction' ? 0.31 : 0.15,
    );
    group.add(socket);
  }
  normalizeNoticeboard(group);
  setRootMetadata(group, atlas, 'procedural-fallback');
  return group;
}

function preparedTemplate(): THREE.Group {
  const atlas = eastbrookSurfaceAtlasTexture();
  if (loadedNoticeboardGltf && !preparedNoticeboardTemplate) {
    preparedNoticeboardTemplate = buildNoticeboardFromSource(loadedNoticeboardGltf.scene, atlas);
    loadedNoticeboardGltf = null;
    releaseGltf(NOTICEBOARD_ASSET_URL);
  }
  if (!preparedNoticeboardTemplate && !fallbackNoticeboardTemplate) {
    fallbackNoticeboardTemplate = buildFallbackNoticeboard(atlas);
  }
  return preparedNoticeboardTemplate ?? fallbackNoticeboardTemplate ?? new THREE.Group();
}

export function buildEastbrookNoticeboard(): { group: THREE.Group; height: number } {
  const atlas = eastbrookSurfaceAtlasTexture();
  const group = preparedTemplate().clone(true);
  group.name = 'eastbrookNoticeboard';
  setRootMetadata(
    group,
    atlas,
    preparedNoticeboardTemplate ? 'procedural-glb' : 'procedural-fallback',
  );
  return { group, height: NOTICEBOARD_TARGET_HEIGHT };
}

/** Test-only access to stable preload, scale, and immutable preparation contracts. */
export const noticeboardPreloadInternalsForTest = {
  assetUrl: NOTICEBOARD_ASSET_URL,
  targetWidth: NOTICEBOARD_TARGET_WIDTH,
  targetHeight: NOTICEBOARD_TARGET_HEIGHT,
  targetDepth: NOTICEBOARD_TARGET_DEPTH,
  front: NOTICEBOARD_FRONT,
  socketNames: NOTICEBOARD_SOCKETS,
  buildNoticeboardFromSource,
  buildFallbackNoticeboard,
};
