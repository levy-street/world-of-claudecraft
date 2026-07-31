// Ravenpost mailbox prop for ground-object entities with templateId 'mailbox'.
// The stable GLB is a deterministic procedural Eastbrook asset. Every graphics
// tier keeps the complete silhouette and service cues; Standard and Lambert
// both bind the shared Eastbrook surface atlas over authored vertex colors.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  eastbrookSurfaceAtlasMetadata,
  eastbrookSurfaceAtlasTexture,
  eastbrookSurfaceGeometry,
  eastbrookSurfaceMaterial,
  eastbrookTownSemanticForColor,
} from './eastbrook_surface_atlas';
import { GFX, surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const MAILBOX_ASSET_URL = '/models/props/mailbox_pillar.glb';
const MAILBOX_TARGET_HEIGHT = 2.9;
const MAILBOX_UNREAD_SOCKET = 'Socket_UnreadGlow';
let loadedMailboxGltf: GLTF | null = null;
let preparedMailboxTemplate: THREE.Group | null = null;
let fallbackMailboxTemplate: THREE.Group | null = null;
let sharedGlowGeometry: THREE.SphereGeometry | null = null;
let sharedGlowMaterial: THREE.Material | null = null;

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(MAILBOX_ASSET_URL).then((gltf) => {
      loadedMailboxGltf = gltf;
    }),
  );
}

function materialTint(material: THREE.Material): THREE.Color {
  return (
    (material as THREE.Material & { color?: THREE.Color }).color?.clone() ??
    new THREE.Color(1, 1, 1)
  );
}

function adaptedGeometry(
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

export function buildMailboxFromSource(
  source: THREE.Object3D,
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): THREE.Group {
  // Loader-cache results are immutable. Clone the transform graph, clone and
  // atlas-adapt each geometry, then mark the prepared resources as shared.
  const instance = source.clone(true);
  instance.name = 'ravenpostMailboxBody';
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (Array.isArray(child.material)) {
      throw new Error('Ravenpost mailbox GLB must use one material per mesh');
    }
    child.geometry = markSharedGeometry(adaptedGeometry(child.geometry, child.material));
    child.material = markSharedMaterial(eastbrookSurfaceMaterial(child.material, atlas));
    child.castShadow = child.material.name === 'MailboxOpaque';
    child.receiveShadow = true;
  });

  const initialBounds = new THREE.Box3().setFromObject(instance);
  const initialHeight = initialBounds.max.y - initialBounds.min.y;
  if (initialHeight > 1e-4) instance.scale.multiplyScalar(MAILBOX_TARGET_HEIGHT / initialHeight);
  const seatedBounds = new THREE.Box3().setFromObject(instance);
  instance.position.y -= seatedBounds.min.y;

  const group = new THREE.Group();
  group.name = 'ravenpostMailboxTemplate';
  group.add(instance);
  group.userData.assetUrl = MAILBOX_ASSET_URL;
  group.userData.source = 'procedural-glb';
  group.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(group, atlas);
  return group;
}

function fallbackMaterial(
  semanticColor: number,
  options: { roughness: number; metalness: number },
  atlas: THREE.Texture | undefined,
): THREE.Material {
  return markSharedMaterial(
    surfaceMat({
      color: semanticColor,
      map: atlas,
      roughness: options.roughness,
      metalness: options.metalness,
      flatShading: !GFX.standardMaterials,
    }),
  );
}

function fallbackMesh(
  geometry: THREE.BufferGeometry,
  semantic:
    | 'darkStoneBlocks'
    | 'lightStoneBlocks'
    | 'verticalDarkTimber'
    | 'horizontalWarmTimber'
    | 'cobaltRoofShingles'
    | 'warmGoldMetal'
    | 'darkForgedMetal',
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    markSharedGeometry(eastbrookSurfaceGeometry(geometry, semantic)),
    material,
  );
  mesh.castShadow = semantic !== 'warmGoldMetal' && semantic !== 'darkForgedMetal';
  mesh.receiveShadow = true;
  return mesh;
}

function buildFallbackMailbox(
  atlas: THREE.Texture | undefined = eastbrookSurfaceAtlasTexture(),
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ravenpostMailboxTemplate';
  const stone = fallbackMaterial(0x777d80, { roughness: 0.92, metalness: 0 }, atlas);
  const wood = fallbackMaterial(0x4c3829, { roughness: 0.84, metalness: 0.02 }, atlas);
  const roof = fallbackMaterial(0x153b88, { roughness: 0.78, metalness: 0.02 }, atlas);
  const metal = fallbackMaterial(0xa27320, { roughness: 0.42, metalness: 0.62 }, atlas);
  const dark = fallbackMaterial(0x211813, { roughness: 0.88, metalness: 0.02 }, atlas);

  const base = fallbackMesh(new THREE.BoxGeometry(0.72, 0.32, 0.56), 'lightStoneBlocks', stone);
  base.position.y = 0.16;
  group.add(base);
  const post = fallbackMesh(new THREE.BoxGeometry(0.25, 1.05, 0.25), 'verticalDarkTimber', wood);
  post.position.y = 0.84;
  group.add(post);
  const box = fallbackMesh(new THREE.BoxGeometry(1.34, 0.92, 0.72), 'horizontalWarmTimber', wood);
  box.position.y = 1.63;
  group.add(box);
  const roofLeft = fallbackMesh(
    new THREE.BoxGeometry(0.94, 0.12, 1.05),
    'cobaltRoofShingles',
    roof,
  );
  roofLeft.position.set(-0.36, 2.32, 0);
  roofLeft.rotation.z = -0.58;
  group.add(roofLeft);
  const roofRight = roofLeft.clone();
  roofRight.position.x = 0.36;
  roofRight.rotation.z = 0.58;
  group.add(roofRight);
  const slotFrame = fallbackMesh(new THREE.BoxGeometry(0.72, 0.3, 0.08), 'warmGoldMetal', metal);
  slotFrame.position.set(0, 1.84, 0.405);
  group.add(slotFrame);
  const slot = fallbackMesh(new THREE.BoxGeometry(0.53, 0.13, 0.1), 'darkForgedMetal', dark);
  slot.position.set(0, 1.84, 0.455);
  group.add(slot);
  const socket = new THREE.Object3D();
  socket.name = MAILBOX_UNREAD_SOCKET;
  socket.position.set(0, 1.62, 0.478);
  group.add(socket);

  const bounds = new THREE.Box3().setFromObject(group);
  const height = bounds.max.y - bounds.min.y;
  if (height > 1e-4) group.scale.setScalar(MAILBOX_TARGET_HEIGHT / height);
  group.position.y -= new THREE.Box3().setFromObject(group).min.y;
  group.userData.assetUrl = MAILBOX_ASSET_URL;
  group.userData.source = 'procedural-fallback';
  group.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(group, atlas);
  return group;
}

function attachMailGlow(group: THREE.Group): THREE.Mesh {
  sharedGlowGeometry ??= markSharedGeometry(new THREE.SphereGeometry(0.09, 8, 6));
  sharedGlowMaterial ??= markSharedMaterial(
    surfaceMat({
      color: 0xffd27a,
      roughness: 0.3,
      metalness: 0,
      emissive: 0xffb84d,
      emissiveIntensity: 1.6,
      flatShading: !GFX.standardMaterials,
    }),
  );
  const glow = new THREE.Mesh(sharedGlowGeometry, sharedGlowMaterial);
  glow.name = 'ravenpostUnreadGlow';
  glow.visible = false;
  const socket = group.getObjectByName(MAILBOX_UNREAD_SOCKET);
  if (socket) socket.add(glow);
  else {
    glow.position.set(0, 1.62, 0.478);
    group.add(glow);
  }
  // Renderer bobbing is parent-local. Preserve the authored socket origin (0
  // when the GLB socket exists, the explicit fallback height otherwise) so
  // sync never adds a second mailbox-height offset to a socket child.
  glow.userData.mailGlowBaseLocalY = glow.position.y;
  group.userData.mailGlow = glow;
  return glow;
}

function preparedTemplate(): THREE.Group {
  const atlas = eastbrookSurfaceAtlasTexture();
  if (loadedMailboxGltf && !preparedMailboxTemplate) {
    preparedMailboxTemplate = buildMailboxFromSource(loadedMailboxGltf.scene, atlas);
    loadedMailboxGltf = null;
    releaseGltf(MAILBOX_ASSET_URL);
  }
  if (!preparedMailboxTemplate && !fallbackMailboxTemplate) {
    fallbackMailboxTemplate = buildFallbackMailbox(atlas);
  }
  return preparedMailboxTemplate ?? fallbackMailboxTemplate ?? new THREE.Group();
}

export function buildMailboxPillar(_entityId: number): { group: THREE.Group; height: number } {
  const atlas = eastbrookSurfaceAtlasTexture();
  const group = preparedTemplate().clone(true);
  group.name = 'ravenpostMailbox';
  group.userData.assetUrl = MAILBOX_ASSET_URL;
  group.userData.eastbrookSurfaceAtlas = eastbrookSurfaceAtlasMetadata(group, atlas);
  attachMailGlow(group);
  return { group, height: MAILBOX_TARGET_HEIGHT };
}

/** Test-only window into the stable preload and immutable preparation contract. */
export const mailboxPreloadInternalsForTest = {
  mailboxAssetUrl: MAILBOX_ASSET_URL,
  targetHeight: MAILBOX_TARGET_HEIGHT,
  unreadSocketName: MAILBOX_UNREAD_SOCKET,
  buildMailboxFromSource,
  buildFallbackMailbox,
};
