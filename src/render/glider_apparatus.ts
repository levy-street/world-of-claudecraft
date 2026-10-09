// Shared flight apparatus for the course and reputation reward.
import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';

// The airborne glider itself: a Tripo-built GLB (world quests round 2 replaced
// the procedural wing-and-spars mesh). Loaded once through the deferred preload
// arm like every other GLB feature, then cloned per visual and fitted to the
// span the flight pose was tuned for: nose along +z (the flight facing), the
// wing above the pilot's chest, the control bar below.
const GLIDER_APPARATUS_URL = '/models/props/windrider_glider_flight.glb';
/** Tip-to-tip span in yards; the procedural apparatus this replaces spanned 4.8. */
const GLIDER_APPARATUS_WINGSPAN = 4.8;
/** How far the wing's top sits above the pilot's chest (the apparatus origin). */
const GLIDER_APPARATUS_TOP_Y = 0.42;
/** The built prop's keel runs along its own x axis, nose at +x, wing tips at
 *  +/-z (the pipeline's front render shows it side-on); the flight nose is +z
 *  and the span is x, so the clone turns a quarter turn about y. */
const GLIDER_APPARATUS_YAW = -Math.PI / 2;

let apparatusScene: THREE.Group | null = null;
let apparatusSettled = typeof window === 'undefined';
const apparatusWaiters: Array<() => void> = [];
const settleApparatus = (): void => {
  apparatusSettled = true;
  for (const waiter of apparatusWaiters.splice(0)) waiter();
};
if (typeof window !== 'undefined') {
  // Deferred, never eager (the affliction_familiar precedent): a module-import
  // registerPreload joins the launch fetch burst the deferred gate exists to
  // spread out. A failed load settles too, so the fallback wing below is fitted
  // instead of leaving the pilot on an invisible glider.
  registerDeferredPreload(() =>
    loadGltf(GLIDER_APPARATUS_URL)
      .then((gltf) => {
        apparatusScene = gltf.scene;
      })
      .catch(() => {})
      .then(settleApparatus),
  );
}

/** A plain wing and keel, fitted only when the prop fails to load: the pilot
 *  still reads the pitch feedback (gliderApparatusPitch) off something. */
function buildFallbackApparatus(): { object: THREE.Object3D; dispose: () => void } {
  const wingGeo = new THREE.PlaneGeometry(GLIDER_APPARATUS_WINGSPAN, 1.6);
  const wingMat = new THREE.MeshLambertMaterial({ color: 0xd8c8a0, side: THREE.DoubleSide });
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.rotation.x = -Math.PI / 2;
  wing.position.y = GLIDER_APPARATUS_TOP_Y;
  const keelGeo = new THREE.BoxGeometry(0.08, 0.08, 1.6);
  const keelMat = new THREE.MeshLambertMaterial({ color: 0x5a4632 });
  const keel = new THREE.Mesh(keelGeo, keelMat);
  keel.position.y = GLIDER_APPARATUS_TOP_Y - 0.06;
  const object = new THREE.Group();
  object.name = 'glider-apparatus-fallback';
  object.add(wing, keel);
  return {
    object,
    dispose: () => {
      wingGeo.dispose();
      wingMat.dispose();
      keelGeo.dispose();
      keelMat.dispose();
    },
  };
}

export const gliderCourseVisualPreloadInternalsForTest = {
  apparatusAssetUrl: GLIDER_APPARATUS_URL,
  apparatusWingspan: GLIDER_APPARATUS_WINGSPAN,
};

/** A clone of the loaded prop, scaled to the wingspan, centred, nose to +z. */
export function fitGliderApparatus(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone(true);
  clone.rotation.y = GLIDER_APPARATUS_YAW;
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  const span = box.max.x - box.min.x || 1;
  const scale = GLIDER_APPARATUS_WINGSPAN / span;
  const holder = new THREE.Group();
  holder.name = 'glider-apparatus-model';
  holder.add(clone);
  holder.scale.setScalar(scale);
  holder.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(holder);
  const center = fitted.getCenter(new THREE.Vector3());
  holder.position.set(-center.x, GLIDER_APPARATUS_TOP_Y - fitted.max.y, -center.z);
  return holder;
}

export function createGliderApparatusMesh(): {
  group: THREE.Group;
  readyForEntry: Promise<void>;
  dispose: () => void;
} {
  const group = new THREE.Group();
  group.name = 'glider-apparatus';
  group.visible = false;
  let disposed = false;
  let resolveReady!: () => void;
  const readyForEntry = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let fallback: { object: THREE.Object3D; dispose: () => void } | null = null;
  const attach = (): void => {
    if (disposed || group.children.length > 0) return;
    if (apparatusScene) {
      group.add(fitGliderApparatus(apparatusScene));
      resolveReady();
      return;
    }
    fallback = buildFallbackApparatus();
    group.add(fallback.object);
    resolveReady();
  };
  if (apparatusSettled) attach();
  else apparatusWaiters.push(attach);
  return {
    group,
    readyForEntry,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const index = apparatusWaiters.indexOf(attach);
      if (index !== -1) apparatusWaiters.splice(index, 1);
      resolveReady();
      // The clone shares its geometry and materials with the cached prop scene,
      // which other visuals still clone: detach only. The fallback is this
      // visual's own and goes with it.
      group.clear();
      fallback?.dispose();
      fallback = null;
    },
  };
}
