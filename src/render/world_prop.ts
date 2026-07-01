// Renderer support for in-world Builder props (entities with templateId
// `prop:<key>`). A prop key is either a NATIVE key handled elsewhere, or an
// EXTERNAL GLB referenced as `ext:<name>` and fetched from `/props/<name>.glb`.
//
// buildPropBody returns a group SYNCHRONOUSLY (so createView can attach it the
// same frame) and swaps the real mesh in when the GLB resolves — headless/test
// builds never fetch (loadGltf no-ops without a window). Skinned/rigged GLBs are
// deep-cloned with SkeletonUtils (a plain clone severs the skeleton binding), and
// the first baked animation, if any, plays via a shared AnimationMixer registry
// the renderer ticks each frame.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGltf } from './assets/loader';

const EXT_PREFIX = 'ext:';
/** Filename of external prop assets is constrained to a safe ASCII set. */
const EXT_NAME_RE = /^[A-Za-z0-9_.-]+$/;
/** Target height (world units) the tallest axis of a loaded prop is scaled to. */
const TARGET_HEIGHT = 2;

// Live mixers for animated props, ticked by tickPropMixers each frame. Keyed by
// the prop entity's view group so removal can drop the mixer with the view.
const propMixers = new Map<THREE.Object3D, THREE.AnimationMixer>();

/** Advance every live prop animation. Call once per frame with delta seconds. */
export function tickPropMixers(dt: number): void {
  for (const mixer of propMixers.values()) mixer.update(dt);
}

/** Forget a prop view's mixer when its view is disposed. */
export function disposePropMixer(view: THREE.Object3D): void {
  propMixers.delete(view);
}

/** True when `propKey` names an external GLB asset (vs a native prop key). */
export function isExternalProp(propKey: string): boolean {
  return propKey.startsWith(EXT_PREFIX);
}

function extUrl(propKey: string): string | null {
  const name = propKey.slice(EXT_PREFIX.length);
  if (!EXT_NAME_RE.test(name)) return null;
  return `/props/${name}.glb`;
}

// Recenter the instance on x/z, drop its base to y=0, and uniformly scale so its
// tallest axis is TARGET_HEIGHT — props are authored at wildly different scales.
function normalize(root: THREE.Object3D): void {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  const tallest = Math.max(size.x, size.y, size.z);
  if (tallest > 0) {
    const s = TARGET_HEIGHT / tallest;
    root.scale.multiplyScalar(s);
  }
}

function instanceFromGltf(gltf: GLTF, view: THREE.Object3D): THREE.Object3D {
  const inner = cloneSkinned(gltf.scene);
  inner.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  const wrap = new THREE.Group();
  wrap.add(inner);
  normalize(inner);
  if (gltf.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(inner);
    mixer.clipAction(gltf.animations[0]).play();
    propMixers.set(view, mixer);
  }
  return wrap;
}

// A small neutral placeholder shown until an external GLB resolves (and the
// fallback for a native key with no dedicated mesh in this PR).
function placeholder(): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9 }),
  );
  mesh.position.y = 0.4;
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

/**
 * Build a prop's renderable body for `propKey`. Returns a group immediately; for
 * external GLBs the real mesh is swapped in asynchronously. `view` is the prop's
 * top-level view group, used to scope the animation mixer for later disposal.
 */
export function buildPropBody(propKey: string, view: THREE.Object3D): THREE.Group {
  const body = new THREE.Group();
  const ph = placeholder();
  body.add(ph);

  if (isExternalProp(propKey)) {
    const url = extUrl(propKey);
    if (url) {
      void loadGltf(url)
        .then((gltf) => {
          // The view may have been removed before the GLB resolved.
          if (!body.parent && body.children.length === 0) return;
          body.remove(ph);
          body.add(instanceFromGltf(gltf, view));
        })
        .catch(() => {
          /* keep the placeholder on a missing/invalid asset */
        });
    }
  }
  return body;
}
