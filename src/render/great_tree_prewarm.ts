// Boot-prewarm coverage for the GREAT-TREE landmark material variants. The
// four zone-feature modules (realm_flora, garden_features, haunt_features,
// jungle_features) each clone the shared twisted-elder GLB and give its bark
// materials the coarse landmark surface-detail layer (worn_stone.ts
// GREAT_TREE_BARK_DETAIL) with NO prior onBeforeCompile hook, so their
// program cache key differs from the foliage bucket bark (which chains the
// instance-collapse hook) and from every other worn variant the existing
// prewarm groups compile. Those features stream in with their zones, so the
// programs otherwise link synchronously the first time a giant enters the
// frustum mid-travel: a measured multi-frame stall (the program-count probe
// showed `Bark_TwistedTree surface-detail|bark|...` linking on a peaks
// visit). One tiny decorated clone in the boot prewarm scene compiles the
// exact programs (tint clones only change uniforms, never the program), for
// all four modules at once; the plain leaf materials of the same clone ride
// along for free.
//
// The GLB is already in the boot preload set (realm_flora and the other
// feature modules preload the same URL; the loader cache dedupes), so the
// group builds synchronously inside the prewarm window. The construction
// mirrors realm_flora's barkify exactly: clone(true), swap only bark-named
// materials for detailed CLONES (the loader cache is immutable), shadows on
// both ways so the depth/shadow variant compiles too.
import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX, type GfxSettings } from './gfx';
import { applySurfaceDetail, GREAT_TREE_BARK_DETAIL, isBarkMaterialName } from './worn_stone';

/** Same asset the four zone-feature modules clone their giants from. */
const GREAT_TREE_URL = '/models/foliage/twisted_1.glb';

let greatTreeScene: THREE.Group | null = null;
let greatTreeTask: Promise<void> | null = null;

/** Prepare the great-tree prewarm source selected by an explicit target profile. */
export function prepareGreatTreeProfileAssets(target: Readonly<GfxSettings>): Promise<void> {
  if (!target.surfaceDetail || greatTreeScene) return Promise.resolve();
  if (greatTreeTask) return greatTreeTask;
  greatTreeTask = loadGltf(GREAT_TREE_URL)
    .then((gltf) => {
      greatTreeScene = gltf.scene;
    })
    .catch((err) => {
      greatTreeTask = null;
      throw err;
    });
  return greatTreeTask;
}

registerDeferredPreload(() => prepareGreatTreeProfileAssets(GFX));

// media-manifest coverage hook (tests/render_glb_replacement_assets.test.ts)
export const greatTreePrewarmPreloadInternalsForTest = { urls: [GREAT_TREE_URL] };

/**
 * One decorated great-tree clone for the boot prewarm scene: compiles the
 * landmark-bark surface-detail program (and the plain leaf program of the
 * same model) before any zone can stream a giant in. Empty group on the
 * Lambert tier (the layer never compiles there) or if the model failed to
 * resolve (fail-soft, the preload gate already surfaced the error).
 */
export function buildGreatTreePrewarmGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'great-tree-material-prewarm';
  group.position.set(0, -1000, 0); // off-screen; compile ignores position
  if (!GFX.surfaceDetail || !greatTreeScene) return group;
  const tree = greatTreeScene.clone(true);
  const barked = new Map<string, THREE.Material>();
  const barkify = (source: THREE.Material): THREE.Material => {
    if (!isBarkMaterialName(source.name)) return source;
    let m = barked.get(source.uuid);
    if (!m) {
      m = source.clone();
      applySurfaceDetail(m as THREE.MeshStandardMaterial, 'bark', GREAT_TREE_BARK_DETAIL);
      barked.set(source.uuid, m);
    }
    return m;
  };
  tree.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(barkify)
      : barkify(mesh.material);
  });
  group.add(tree);
  return group;
}
