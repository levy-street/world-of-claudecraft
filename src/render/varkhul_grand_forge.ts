import * as THREE from 'three';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';

const ASSET_URL = '/models/props/varkhul_grand_forge.glb';
const TARGET_HEIGHT = 8.5;

let loadedSource: THREE.Group | null = null;
let preparedTemplate: THREE.Group | null = null;
let sourceLoadTask: Promise<void> | null = null;

export function prepareVarkhulGrandForgeAssets(): Promise<void> {
  if (loadedSource || preparedTemplate) return Promise.resolve();
  if (sourceLoadTask) return sourceLoadTask;
  sourceLoadTask = loadGltf(ASSET_URL)
    .then((gltf) => {
      loadedSource = gltf.scene;
      sourceLoadTask = null;
    })
    .catch((error) => {
      sourceLoadTask = null;
      throw error;
    });
  return sourceLoadTask;
}

if (typeof window !== 'undefined') {
  registerDeferredPreload(prepareVarkhulGrandForgeAssets);
}

export function resetVarkhulGrandForgeCaches(): void {
  loadedSource = null;
  preparedTemplate = null;
  sourceLoadTask = null;
}

export function buildVarkhulGrandForgeFromSource(source: THREE.Object3D): THREE.Group {
  const instance = source.clone(true);
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
  });

  const initialBounds = new THREE.Box3().setFromObject(instance);
  const initialHeight = initialBounds.max.y - initialBounds.min.y;
  if (initialHeight > 1e-4) instance.scale.multiplyScalar(TARGET_HEIGHT / initialHeight);
  const seatedBounds = new THREE.Box3().setFromObject(instance);
  instance.position.y -= seatedBounds.min.y;

  const group = new THREE.Group();
  group.name = 'varkhulGrandForge';
  group.userData.landmark = 'varkhul_grand_forge';
  group.userData.actionable = true;
  group.userData.collision = 'none';
  group.userData.targetHeight = TARGET_HEIGHT;
  group.add(instance);
  return group;
}

function forgeTemplate(): THREE.Group | null {
  if (!preparedTemplate) {
    if (!loadedSource) return null;
    preparedTemplate = buildVarkhulGrandForgeFromSource(loadedSource);
    loadedSource = null;
    releaseGltf(ASSET_URL);
  }
  return preparedTemplate;
}

export function buildVarkhulGrandForge(x: number, z: number): THREE.Group {
  const template = forgeTemplate();
  const forge = template?.clone(true) ?? new THREE.Group();
  forge.name = 'varkhulGrandForge';
  forge.userData.landmark = 'varkhul_grand_forge';
  forge.userData.actionable = true;
  forge.userData.collision = 'none';
  forge.userData.assetAvailable = template !== null;
  forge.position.set(x, 0, z);
  forge.rotation.y = Math.PI;
  return forge;
}

export const varkhulGrandForgeInternalsForTest = {
  assetUrl: ASSET_URL,
  targetHeight: TARGET_HEIGHT,
  buildFromSource: buildVarkhulGrandForgeFromSource,
};
