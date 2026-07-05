// Browser-side entry for the Guide model-still renderer. Bundled by esbuild into a
// self-contained IIFE and served into a localhost page by render_model_stills.mjs, which
// also serves public/ so loadGltf can fetch the real GLBs same-origin. Exposes
// window.renderStill(spec, tint) returning a transparent PNG data URL.
//
// It reuses the Guide viewer's OWN model assembly (buildModel), the same shared posed,
// skin-aware bounds (skinAwareBounds), and the same head-on bounding-sphere framing RULE as
// scene.ts, so a baked still closely approximates the live "View in 3D" turntable. It is not
// pixel-identical: the still freezes one fixed three-quarter yaw, while the turntable spins.
// Everything is pinned for determinism: a fixed canvas size, pixelRatio 1, a fixed idle
// pose time, and a fixed three-quarter yaw, so reruns produce the same framing.
import * as THREE from 'three';
import { buildModel, skinAwareBounds } from '../../src/guide/viewer/model';

const SIZE = 512; // supersample; the driver downscales and encodes the shipped WebP
const STILL_YAW = -0.6; // radians; a three-quarter portrait reads better than dead-on
const POSE_TIME = 0.6; // seconds into the idle clip, so the rig leaves its bind pose

const renderer = new THREE.WebGLRenderer({
  canvas: document.createElement('canvas'),
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.setClearAlpha(0); // transparent background, like the live viewer (scene.ts alpha:true)
renderer.outputColorSpace = THREE.SRGBColorSpace;

// The exact light rig the live turntable uses (src/guide/viewer/scene.ts:51-57), so a
// still is lit identically to the interactive model.
function makeLights() {
  const g = new THREE.Group();
  g.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.5));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.7);
  key.position.set(3, 6, 4);
  g.add(key);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 0.8);
  rim.position.set(-4, 3, -4);
  g.add(rim);
  return g;
}

// The TRUE posed, skin-aware world bounds come from the SHARED skinAwareBounds (model.ts),
// the same measurement the live turntable (scene.ts) uses, so a still and its interactive
// model frame identically and cannot drift. It applies each skinned vertex's bone transform
// then its world matrix (the game's prepareVisual approach), falling back to a plain world
// walk for non-skinned props. buildModel's bind-pose box is NOT enough: several creature rigs
// have a scaled armature whose idle clip flings the skinned mesh far from the bind box, so
// framing the bind box renders a blank.

// The scene.ts camera rule (fov 40, frame by bounding sphere), aimed at an explicit center.
function frameCamera(camera, radius, center) {
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (radius / Math.sin(fov / 2)) * 1.15;
  camera.position.set(center.x, center.y, center.z + dist);
  camera.lookAt(center);
  camera.near = Math.max(0.01, dist / 50);
  camera.far = dist * 12;
  camera.updateProjectionMatrix();
}

window.renderStill = (spec, tint) =>
  new Promise((resolve, reject) => {
    buildModel(spec, tint ?? null).then((built) => {
      try {
        const scene = new THREE.Scene();
        scene.add(makeLights());
        // A pivot carries the three-quarter yaw; the model sits inside it. We frame the camera
        // to the model's ACTUAL posed bounds (yaw included), so a rig the idle clip flings far
        // from its bind box is still centered.
        const pivot = new THREE.Group();
        pivot.rotation.y = STILL_YAW;
        pivot.add(built.root);
        // Skinned rigs frustum-cull by a bind-pose sphere that can sit off the posed mesh;
        // disabling the cull guarantees the model is drawn (the game does the same).
        built.root.traverse((o) => {
          if (o.isMesh) o.frustumCulled = false;
        });
        scene.add(pivot);

        // Advance the idle clip a fixed amount so the pose is natural (not the bind pose) and
        // deterministic across runs, THEN measure where the posed mesh actually is.
        built.mixer?.update(POSE_TIME);
        scene.updateMatrixWorld(true);
        const bounds = skinAwareBounds(built.root);
        const center = bounds.getCenter(new THREE.Vector3());
        const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius || built.radius || 1;

        const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
        // Lift the framing center a touch so the subject sits slightly low with headroom above.
        // frameCamera keeps the camera level with the center, so this reframes vertically; it is
        // not a downward tilt.
        center.y += radius * 0.08;
        frameCamera(camera, radius, center);

        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL('image/png');

        pivot.remove(built.root);
        built.dispose();
        scene.clear();
        resolve(url);
      } catch (e) {
        reject(e);
      }
    }, reject);
  });

window.__ready = true;
