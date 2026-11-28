// Browser-side entry for the raid atlas boss portraits
// (scripts/raid_atlas/render_boss_portraits.mjs). Bundled by esbuild into an
// IIFE and served into a localhost page beside public/, so the real GLBs load
// same-origin. Exposes window.renderBust(spec, tint, framing): a transparent
// PNG data URL of the model's head and shoulders.
//
// It assembles each boss exactly as the guide viewer and the mob portraits do
// (buildModel, the posed skin-aware bounds), so the bust is the in-game model,
// then frames a head-and-shoulders view from the posed bounds: the camera aims
// at `aim` (a share of the posed height, from the feet) and frames a sphere of
// `radius` (a share of the posed height); `body` picks one of a multi-body
// rig's bodies. Everything is pinned for
// determinism: a fixed canvas, pixel ratio 1, a fixed idle pose time and yaw.
import * as THREE from 'three';
import { buildModel, skinAwareBounds } from '../../src/guide/viewer/model';
import {
  FINAL_BODY_FORMS,
  FINAL_BODY_NODES,
} from '../../src/render/smith_heart_fx/final_body_core';

const SIZE = 768; // supersample; the driver downscales and encodes the shipped WebP
const BASE_YAW = -0.45; // a soft three-quarter turn
const POSE_TIME = 0.6; // seconds into the idle clip, off the bind pose

const renderer = new THREE.WebGLRenderer({
  canvas: document.createElement('canvas'),
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.setClearAlpha(0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

/** The guide turntable's light rig, plus a camera-side fill so a face reads
 *  at map size and a coloured rim that cuts the silhouette off the field. */
function makeLights(rim, warm) {
  const g = new THREE.Group();
  g.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.5));
  const key = new THREE.DirectionalLight(warm ?? 0xfff4e0, 1.9);
  key.position.set(3, 6, 4);
  g.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-1, 1, 6);
  g.add(fill);
  const back = new THREE.DirectionalLight(rim ?? 0xbfd4ff, 1.6);
  back.position.set(-4, 4, -5);
  g.add(back);
  return g;
}

window.renderBust = (spec, tint, framing) =>
  new Promise((resolve, reject) => {
    buildModel(spec, tint ?? null).then((built) => {
      try {
        const scene = new THREE.Scene();
        scene.add(makeLights(framing.rim, framing.key));
        const pivot = new THREE.Group();
        pivot.rotation.y = BASE_YAW + (framing.yaw ?? 0);
        pivot.add(built.root);
        // A model listing its one body once per painting (the Masterless
        // Strength's five forms, final_body_core.ts) shows only the one the
        // framing names, the way the game toggles them.
        if (framing.body) {
          for (const form of FINAL_BODY_FORMS) {
            if (form === framing.body) continue;
            for (const name of FINAL_BODY_NODES[form]) {
              const node = built.root.getObjectByName(name);
              if (node) node.visible = false;
            }
          }
        }
        built.root.traverse((o) => {
          if (o.isMesh) o.frustumCulled = false;
        });
        scene.add(pivot);
        built.mixer?.update(POSE_TIME);
        scene.updateMatrixWorld(true);
        const bounds = skinAwareBounds(built.root);
        const size = bounds.getSize(new THREE.Vector3());
        const height = size.y || built.radius || 1;
        const center = bounds.getCenter(new THREE.Vector3());
        center.y = bounds.min.y + height * framing.aim;
        center.x += (framing.dx ?? 0) * height;
        const r = height * framing.radius;
        const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
        const fov = (camera.fov * Math.PI) / 180;
        const dist = r / Math.sin(fov / 2);
        // A touch above the aim, looking slightly down, as a portrait painter would.
        camera.position.set(center.x, center.y + r * (framing.tilt ?? 0.12), center.z + dist);
        camera.lookAt(center);
        camera.near = Math.max(0.01, dist / 50);
        camera.far = dist * 12;
        camera.updateProjectionMatrix();
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
