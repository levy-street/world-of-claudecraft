// Browser-side entry for the mount face-icon renderer. Bundled by esbuild into a
// self-contained IIFE and injected into a blank page by scripts/render_mount_icons.mjs.
// Exposes window.renderMountFace(base64Glb, cfg) -> transparent PNG data URL. We parse
// GLB bytes directly (no fetch) so it runs offline under headless swiftshader, mirroring
// scripts/weapon_render_entry.js. Meshopt-compressed mount GLBs (most of the set,
// valorsteed and thunderstrut_gobbler included) decode via the wired MeshoptDecoder.
//
// Framing rule: every character/mount model stands at the origin facing +Z with feet near
// y=0 (see src/render/characters/portrait.ts:35; the mount manifest defs carry no yaw
// override, so the raw GLB inherits that convention). So the head sits at the front (the
// +Z extreme by default) in the upper part of the bounding box. We anchor a "head sphere"
// there and frame a front three-quarter close-up on it. cfg lets a mount override the
// forward axis and the anchor/zoom when the generic framing misses.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { attachKtx2 } from './lib/ktx2_entry.js';

const SIZE = 512; // supersample; the driver downscales and encodes the shipped 128px WebP

const renderer = new THREE.WebGLRenderer({
  canvas: document.createElement('canvas'),
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.setClearAlpha(0); // transparent background, like portraits and the guide stills
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const loader = attachKtx2(new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), renderer);

// Soft key/fill/rim so the face reads clearly at thumbnail size (mirrors portrait.ts).
function makeLights() {
  const g = new THREE.Group();
  g.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.4));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.9);
  key.position.set(2.5, 4, 4);
  g.add(key);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.8);
  fill.position.set(-3, 1.5, 2);
  g.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  rim.position.set(0, 3, -4);
  g.add(rim);
  return g;
}

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

// Forward (facing) direction from a 'z+' | 'z-' | 'x+' | 'x-' code; +Z is the default.
function fwdVec(code) {
  switch (code) {
    case 'z-':
      return new THREE.Vector3(0, 0, -1);
    case 'x+':
      return new THREE.Vector3(1, 0, 0);
    case 'x-':
      return new THREE.Vector3(-1, 0, 0);
    default:
      return new THREE.Vector3(0, 0, 1);
  }
}

window.renderMountFace = (b64, cfg) =>
  new Promise((resolve, reject) => {
    loader.parse(
      b64ToArrayBuffer(b64),
      '',
      (gltf) => {
        try {
          const scene = new THREE.Scene();
          scene.add(makeLights());

          const obj = gltf.scene;
          // Skinned rigs frustum-cull by a bind-pose sphere that can sit off the drawn mesh;
          // disabling the cull guarantees the model renders (the game does the same).
          obj.traverse((o) => {
            if (o.isMesh) o.frustumCulled = false;
          });
          scene.add(obj);
          scene.updateMatrixWorld(true);

          const box = new THREE.Box3().setFromObject(obj);
          if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.y)) {
            throw new Error('empty or non-finite bounds');
          }
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const h = size.y || 1;

          const fov = cfg.fov ?? 30;
          const fwd = fwdVec(cfg.fwd);
          const up = new THREE.Vector3(0, 1, 0);

          // Head anchor: pushed toward the facing extreme along the forward axis and up into
          // the upper box. headFwd/headUp are 0..1 fractions of the half-extent on each axis.
          const halfFwd = 0.5 * (fwd.x !== 0 ? size.x : size.z);
          const anchor = center
            .clone()
            .addScaledVector(fwd, (cfg.headFwd ?? 0.82) * halfFwd)
            .addScaledVector(up, (cfg.headUp ?? 0.6) * 0.5 * h);

          // Frame by a head sphere; fill is the fraction of model height the head should span.
          const headR = 0.5 * (cfg.fill ?? 0.6) * h;
          const dist = (headR / Math.sin((fov * Math.PI) / 360)) * (cfg.margin ?? 1.05);

          // Camera sits in FRONT of the face (the +forward hemisphere), yawed for a
          // three-quarter angle and pitched up so it looks slightly down at the head.
          const yaw = cfg.yaw ?? 0.5;
          const pitch = cfg.pitch ?? 0.22;
          const camDir = fwd
            .clone()
            .applyAxisAngle(up, yaw)
            .multiplyScalar(Math.cos(pitch))
            .addScaledVector(up, Math.sin(pitch))
            .normalize();
          const camPos = anchor.clone().addScaledVector(camDir, dist);

          const cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 1000);
          cam.position.copy(camPos);
          cam.lookAt(anchor);
          cam.updateProjectionMatrix();

          renderer.render(scene, cam);
          const url = renderer.domElement.toDataURL('image/png');

          obj.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
            }
          });
          scene.clear();
          resolve(url);
        } catch (e) {
          reject(e);
        }
      },
      reject,
    );
  });

window.__ready = true;
