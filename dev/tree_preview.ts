// Dev-only harness for the Tree Generator: renders every preset in a row on
// flat ground under a plain sun, so a generator change can be judged without
// opening a map. NOT a build entry point (vite.config.ts lists its inputs
// explicitly); reachable at /dev/tree_preview.html while `npm run dev` is up.
//
//   ?preset=magic_ancient   one tree, framed close
//   ?spin=1                 slow orbit
//   ?volumes=1              draw the canopy spheres
//   ?plants=1               the FOLIAGE presets (bush/fern/vine/grass) instead
//   ?dist= ?ty= ?tx= ?yaw= ?pitch=   frame the camera without a pointer

import * as THREE from 'three';
import { loadGltf } from '../src/render/assets/loader';
import { buildFoliageModel, FOLIAGE_PRESETS, type FoliageParams } from '../src/render/foliage_gen';
import { sharedUniforms } from '../src/render/gfx';
import {
  buildTreeModel,
  setTreeVolumeOverlay,
  TREE_PRESETS,
  treeSeed,
} from '../src/render/tree_gen';
import { updateTreeSwayPlayer } from '../src/render/tree_sway';

const params = new URLSearchParams(location.search);
const only = params.get('preset');
const spin = params.get('spin') === '1';
if (params.get('volumes') === '1') setTreeVolumeOverlay(true);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x93b7d6);
scene.fog = new THREE.Fog(0x93b7d6, 120, 420);

// Roughly the game's daylight: a warm key sun plus a sky/ground hemisphere.
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.position.set(-40, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const cam0 = sun.shadow.camera as THREE.OrthographicCamera;
cam0.left = -90;
cam0.right = 90;
cam0.top = 90;
cam0.bottom = -90;
cam0.far = 250;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbcd8f0, 0x3f4a2c, 1.15));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(800, 800),
  new THREE.MeshStandardMaterial({ color: 0x4d6a2e, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// The bushes, ferns and vines grow the SAME leaf canopy off a different
// skeleton, so a canopy change has to be judged on them too.
const plants = params.get('plants') === '1';
type PreviewPreset = { key: string; label: string; params: FoliageParams };
const allPresets: readonly PreviewPreset[] = plants
  ? FOLIAGE_PRESETS.map((p) => ({ key: p.key, label: p.label, params: p.params }))
  : TREE_PRESETS.map((p) => ({ key: p.key, label: p.label, params: p.params }));
const presets = only ? allPresets.filter((p) => p.key === only) : allPresets;
const SPACING = plants ? 5 : 16;
const builds = presets.map((preset, i) => {
  const x = (i - (presets.length - 1) / 2) * SPACING;
  const build = buildFoliageModel({ ...preset.params, seed: treeSeed(x, 0) }, (path) =>
    loadGltf(path).then((gltf) => gltf.scene.clone(true)),
  );
  build.group.position.set(x, 0, 0);
  scene.add(build.group);
  const label = preset.label;
  return { preset, build, x, label };
});

// ?ref=1 stands a SHIPPED foliage tree beside the generated ones under exactly
// the same lights: the only honest way to judge whether a generated canopy is
// too dark, since "dark" is meaningless without the thing it sits next to.
if (params.get('ref') === '1') {
  const refX = presets.length * SPACING * 0.5 + 10;
  for (const [i, url] of ['models/foliage/oak_1.glb', 'models/foliage/pine_1.glb'].entries()) {
    void loadGltf(url).then((gltf) => {
      const o = gltf.scene.clone(true);
      // The kit authors its trees small; the game scales them on placement.
      o.scale.setScalar(3.2);
      o.position.set(refX + i * 14, 0, 0);
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      scene.add(o);
    });
  }
}

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 900);
const span = Math.max(plants ? 8 : 24, presets.length * SPACING);
let camDist = only ? (plants ? 5 : 26) : span * 0.72;
const camHeight = only ? (plants ? 1.5 : 8) : span * 0.24;
const camDistParam = params.get('dist');
if (camDistParam !== null && Number.isFinite(Number(camDistParam))) {
  camDist = Number(camDistParam);
}
const defaultTargetY = only ? (plants ? 0.8 : 6) : span * (plants ? 0.05 : 0.14);
camera.position.set(0, camHeight, camDist);
camera.lookAt(0, defaultTargetY, 0);

const hud = document.getElementById('hud') as HTMLElement;
hud.textContent = builds
  .map(
    (b) =>
      `${b.label.padEnd(18)} ${String(b.build.leafCount).padStart(4)} leaves  ` +
      `${String(b.build.branchCount).padStart(3)} branches  ` +
      `${b.build.height.toFixed(1)}yd  r=${b.build.collideRadius.toFixed(2)}`,
  )
  .join('\n');

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Scroll zooms, drag orbits: enough to inspect a canopy from any side. The
// same four values are settable from the URL (?dist=&ty=&yaw=&pitch=) so a
// close-up on one crown can be framed without a pointer, the browser pane
// throttles rAF while it is hidden, which makes drag/scroll unusable there.
const num = (key: string, fallback: number): number => {
  const raw = params.get(key);
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? v : fallback;
};
let yaw = num('yaw', 0);
let pitch = num('pitch', only ? 0.12 : 0.2);
let dragging = false;
let lastX = 0;
let lastY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
addEventListener('pointerup', () => {
  dragging = false;
});
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= (e.clientX - lastX) * 0.005;
  pitch = Math.max(-0.2, Math.min(1.2, pitch + (e.clientY - lastY) * 0.004));
  lastX = e.clientX;
  lastY = e.clientY;
});
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    camDist = Math.max(6, Math.min(400, camDist * (1 + Math.sign(e.deltaY) * 0.1)));
    e.preventDefault();
  },
  { passive: false },
);

const clock = new THREE.Clock();
const target = new THREE.Vector3(num('tx', 0), num('ty', defaultTargetY), 0);
// Exposed so a debug session can reframe and poke at the scene from a console.
(window as unknown as Record<string, unknown>).__treePreview = {
  scene,
  renderer,
  sun,
  builds,
  camera,
  THREE,
  setView: (dist: number, ty: number, tx = 0) => {
    camDist = dist;
    target.set(tx, ty, 0);
  },
};
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  // The sway shaders read these two: uTime drives the wave, uSwayPlayer gates
  // it by distance to the player, so park the "player" at the camera.
  sharedUniforms.uTime.value = t;
  if (spin) yaw = t * 0.12;
  const cp = Math.cos(pitch);
  camera.position.set(
    target.x + Math.sin(yaw) * camDist * cp,
    target.y + Math.sin(pitch) * camDist + camHeight * 0.2,
    target.z + Math.cos(yaw) * camDist * cp,
  );
  camera.lookAt(target);
  updateTreeSwayPlayer(camera.position.x, camera.position.z);
  renderer.render(scene, camera);
});
