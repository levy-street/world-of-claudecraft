// Thin adapter for the rift course kit GLBs (launch pad, gem crystal,
// waybrazier): deferred preload, one template per asset, clones that carry
// only transforms, materials rebuilt through surfaceMat so the tier system
// owns shading. The glow bucket (mesh name suffix `_warm`) gets an emissive
// push so ember seams and crystal hearts read in dungeon light.
import * as THREE from 'three';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { surfaceMat } from './gfx';

export const RIFT_COURSE_PROP_URLS = Object.freeze({
  rift_launch_pad: '/models/props/rift_launch_pad.glb',
  rift_gem_crystal: '/models/props/rift_gem_crystal.glb',
  rift_waybrazier: '/models/props/rift_waybrazier.glb',
});

export type RiftCoursePropKey = keyof typeof RIFT_COURSE_PROP_URLS;

const templates = new Map<RiftCoursePropKey, THREE.Group>();

const GLOW_EMISSIVE = 0xa64f18;

function templateFor(key: RiftCoursePropKey, gltfScene: THREE.Group): THREE.Group {
  const root = new THREE.Group();
  gltfScene.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh) return;
    const mesh = node as THREE.Mesh;
    const warm = mesh.name.endsWith('_warm');
    const clone = new THREE.Mesh(
      mesh.geometry,
      surfaceMat({
        color: 0xffffff,
        vertexColors: true,
        roughness: warm ? 0.35 : 0.62,
        metalness: warm ? 0.1 : 0.35,
        emissive: warm ? GLOW_EMISSIVE : undefined,
        emissiveIntensity: warm ? 0.85 : 0,
      }),
    );
    clone.name = mesh.name;
    mesh.updateWorldMatrix(true, false);
    clone.applyMatrix4(mesh.matrixWorld);
    root.add(clone);
  });
  return root;
}

async function preloadAll(): Promise<void> {
  for (const [key, url] of Object.entries(RIFT_COURSE_PROP_URLS)) {
    const gltf = await loadGltf(url);
    templates.set(key as RiftCoursePropKey, templateFor(key as RiftCoursePropKey, gltf.scene));
    releaseGltf(url);
  }
}

registerDeferredPreload(() => preloadAll());

/** Media-manifest / preload coverage seam (tests/render_glb_replacement_assets). */
export function riftCoursePropsPreloadInternalsForTest(): readonly string[] {
  return Object.values(RIFT_COURSE_PROP_URLS);
}

/** A fresh instance of one kit prop; transforms only, geometry shared. */
export function buildRiftCourseProp(key: RiftCoursePropKey): THREE.Group | null {
  const template = templates.get(key);
  if (!template) return null;
  return template.clone(true);
}
